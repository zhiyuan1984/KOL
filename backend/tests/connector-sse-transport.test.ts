import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { resetConn } from "../src/db.js";
import { RemoteMcpClient } from "../src/mcp/remote.js";
import { connectorOptions, type RuntimeContext } from "../src/runtime/execution.js";
import { validateConnectorConfig } from "../src/runtime/store.js";

const fixtureTool = {
  name: "lookup_record",
  description: "Reads a record from the SSE fixture.",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
};

type RecordedRequest = { method: string; url: string; authorization: string | null };

let tmp = "";
let httpServer: http.Server | null = null;
let sseUrl = "";
let sseTransports = new Map<string, SSEServerTransport>();
let fixtureServers: Server[] = [];
/** Requests the client issued through its injected fetch. */
let dispatched: RecordedRequest[] = [];
/** Requests the fixture server actually received. */
let received: RecordedRequest[] = [];

function fixtureServer(): Server {
  const server = new Server(
    { name: "connector-sse-fixture", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [fixtureTool] }));
  server.setRequestHandler(CallToolRequestSchema, (request) => ({
    content: [{ type: "text", text: JSON.stringify({ result: { id: request.params.arguments?.id } }) }],
  }));
  return server;
}

async function handleFixtureRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const authorization = req.headers.authorization;
  received.push({ method: req.method || "", url: req.url || "", authorization: typeof authorization === "string" ? authorization : null });

  if (req.method === "GET" && url.pathname === "/sse") {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);
    res.on("close", () => sseTransports.delete(transport.sessionId));
    const server = fixtureServer();
    fixtureServers.push(server);
    await server.connect(transport);
    return;
  }
  if (req.method === "POST" && url.pathname === "/messages") {
    const transport = sseTransports.get(url.searchParams.get("sessionId") || "");
    if (!transport) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("unknown session");
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}

async function startFixture(): Promise<void> {
  httpServer = http.createServer((req, res) => {
    void handleFixtureRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end();
    });
  });
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  sseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/sse`;
}

/** Records every outbound call and delegates to the real fetch, like the runtime egress guard does. */
const guardedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  dispatched.push({
    method: String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase(),
    url: input instanceof Request ? input.url : String(input),
    authorization: headers.get("authorization"),
  });
  return fetch(input, init);
};

const context: RuntimeContext = { agentId: "agent:connector-sse", skillId: "connector_sse_probe", userId: "usr_sse", runId: "run_sse" };

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-connector-sse-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  resetConn();
  sseTransports = new Map();
  fixtureServers = [];
  dispatched = [];
  received = [];
  await startFixture();
});

afterEach(async () => {
  for (const transport of sseTransports.values()) await transport.close().catch(() => undefined);
  for (const server of fixtureServers) await server.close().catch(() => undefined);
  const server = httpServer;
  httpServer = null;
  sseTransports = new Map();
  fixtureServers = [];
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  delete process.env.NODE_ENV;
});

describe("managed connector SSE transport", () => {
  it("accepts the sse transport only for MCP connectors", () => {
    expect(validateConnectorConfig({
      protocol: "mcp", transport: "sse", url: "https://example.test/sse", allow_unauthenticated: true,
    })).toEqual({
      protocol: "mcp", transport: "sse", url: "https://example.test/sse", allow_unauthenticated: true,
    });
    expect(validateConnectorConfig({
      protocol: "mcp", transport: "streamable-http", url: "https://example.test/mcp", allow_unauthenticated: true,
    })).toMatchObject({ transport: "streamable-http" });
    expect(validateConnectorConfig({ url: "https://example.test/mcp", allow_unauthenticated: true })).not.toHaveProperty("transport");
  });

  it("rejects the sse transport on non-MCP connectors and unknown transport values", () => {
    expect(() => validateConnectorConfig({
      protocol: "http", transport: "sse", url: "https://example.test", allow_unauthenticated: true,
    })).toThrow("transport is supported only for mcp connectors");
    expect(() => validateConnectorConfig({
      protocol: "mcp", transport: "grpc", url: "https://example.test/sse", allow_unauthenticated: true,
    })).toThrow("transport must be streamable-http or sse");
  });

  it("passes the configured MCP transport through connectorOptions and drops it for http connectors", async () => {
    const mcpOptions = connectorOptions(context, validateConnectorConfig({
      protocol: "mcp", transport: "sse", url: "https://example.test/sse", allow_unauthenticated: true,
    }));
    expect(mcpOptions.transport).toBe("sse");
    expect(connectorOptions(context, validateConnectorConfig({
      url: "https://example.test/mcp", allow_unauthenticated: true,
    })).transport).toBeUndefined();
    expect(connectorOptions(context, validateConnectorConfig({
      protocol: "http", url: "https://example.test/api", allow_unauthenticated: true,
    })).transport).toBeUndefined();
    // connectorOptions hands out the egress guard, and it refuses origin drift
    // on every request the transport will issue.
    await expect(mcpOptions.fetch!("https://other.example.test/sse")).rejects
      .toMatchObject({ detail: { code: "runtime_endpoint_invalid" } });
  });

  it("requires a credential header for the sse transport like every other connector", () => {
    expect(() => new RemoteMcpClient({ url: sseUrl, transport: "sse" })).toThrow("MCP auth header is required");
    expect(() => new RemoteMcpClient({ url: sseUrl, transport: "sse", allowUnauthenticated: true })).not.toThrow();
  });

  it("lists tools and calls a tool over SSE through the guarded fetch, forwarding headers on both legs", async () => {
    const client = new RemoteMcpClient({
      url: sseUrl,
      transport: "sse",
      headers: { Authorization: "Bearer test-token" },
      allowUnauthenticated: false,
      fetch: guardedFetch,
    });
    try {
      await expect(client.listTools()).resolves.toEqual([fixtureTool]);
      await expect(client.callTool("lookup_record", { id: "rec_42" })).resolves.toEqual({ id: "rec_42" });
      await expect(client.callToolRaw("lookup_record", { id: "rec_7" })).resolves.toMatchObject({
        content: [{ type: "text", text: JSON.stringify({ result: { id: "rec_7" } }) }],
      });

      const streamRequests = dispatched.filter((entry) => entry.method === "GET");
      const postRequests = dispatched.filter((entry) => entry.method === "POST");
      const receivedStreams = received.filter((entry) => entry.method === "GET");
      const receivedPosts = received.filter((entry) => entry.method === "POST");
      // The long-lived event stream and the POST channel are separate requests;
      // both must reach the caller's egress-guarded fetch with the credential.
      expect(streamRequests).toEqual([{ method: "GET", url: sseUrl, authorization: "Bearer test-token" }]);
      expect(postRequests.length).toBeGreaterThan(0);
      expect(postRequests.every((entry) => entry.authorization === "Bearer test-token")).toBe(true);
      expect(postRequests.some((entry) => entry.url.includes("/messages?sessionId="))).toBe(true);
      // The fixture sees the same credential on both legs, so neither one was bypassed.
      expect(receivedStreams).toEqual([{ method: "GET", url: "/sse", authorization: "Bearer test-token" }]);
      expect(receivedPosts.length).toBeGreaterThan(0);
      expect(receivedPosts.every((entry) => entry.authorization === "Bearer test-token")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("runs the managed path end to end: config -> connectorOptions egress guard -> SSE client", async () => {
    const options = connectorOptions(context, validateConnectorConfig({
      protocol: "mcp", transport: "sse", url: sseUrl, allow_unauthenticated: true,
    }));
    expect(options.transport).toBe("sse");
    const client = new RemoteMcpClient(options);
    try {
      await expect(client.listTools()).resolves.toEqual([fixtureTool]);
      await expect(client.callTool("lookup_record", { id: "rec_guard" })).resolves.toEqual({ id: "rec_guard" });
      expect(received.filter((entry) => entry.authorization !== null)).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
