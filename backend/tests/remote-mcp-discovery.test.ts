import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { RemoteMcpClient } from "../src/mcp/remote.js";

type Tool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

type ToolPage = {
  cursor?: string;
  tools: Tool[];
  nextCursor?: string;
};

let httpServer: http.Server | null = null;
let baseUrl = "";
let requireConnectorHeader = false;
let receivedConnectorHeaders: string[] = [];
let receivedAuthorizationHeaders: string[] = [];
let listCalls: Array<string | undefined> = [];
let catalog: Tool[] = [];
let configuredPages: ToolPage[] | null = null;

const searchableTool: Tool = {
  name: "search_records",
  description: "Searches the current connector catalog.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
    additionalProperties: false,
  },
  _meta: { bindingVersion: "2026-09-25" },
};

function pageFor(cursor: string | undefined): ToolPage {
  if (configuredPages) {
    return configuredPages.find((page) => page.cursor === cursor) || { tools: [] };
  }
  if (cursor === undefined) {
    return {
      tools: catalog.slice(0, 1),
      ...(catalog.length > 1 ? { nextCursor: "catalog-page-2" } : {}),
    };
  }
  return cursor === "catalog-page-2" ? { tools: catalog.slice(1) } : { tools: [] };
}

async function startFixture(): Promise<void> {
  const app = createMcpExpressApp();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.use((req: any, res: any, next: () => void) => {
    const connectorHeader = req.headers["x-connector-secret"];
    if (typeof connectorHeader === "string") receivedConnectorHeaders.push(connectorHeader);
    const authorization = req.headers.authorization;
    if (typeof authorization === "string") receivedAuthorizationHeaders.push(authorization);
    if (requireConnectorHeader && connectorHeader !== "fixture-secret") {
      res.status(401).json({ error: "missing connector authentication" });
      return;
    }
    next();
  });

  app.post("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;
    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (id) => { transports[id] = transport!; },
      });
      const server = new Server(
        { name: "remote-mcp-discovery-fixture", version: "1.0.0" },
        { capabilities: { tools: { listChanged: true } } },
      );
      server.setRequestHandler(ListToolsRequestSchema, (request) => {
        const cursor = request.params?.cursor;
        listCalls.push(cursor);
        return pageFor(cursor);
      });
      server.setRequestHandler(CallToolRequestSchema, (request) => {
        if (request.params.name === "fail") {
          return {
            content: [{ type: "text", text: "remote failure" }],
            structuredContent: { reason: "policy denied", code: "denied" },
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify({ result: { ok: true } }) }] };
      });
      await server.connect(transport);
    }
    if (!transport) {
      res.status(400).json({ error: "missing session" });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  });
  app.delete("/mcp", async (req: any, res: any) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
      delete transports[sessionId];
      return;
    }
    res.status(200).end();
  });

  httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
}

beforeEach(async () => {
  requireConnectorHeader = false;
  receivedConnectorHeaders = [];
  receivedAuthorizationHeaders = [];
  listCalls = [];
  catalog = [];
  configuredPages = null;
  await startFixture();
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer?.close(() => resolve()) || resolve());
  httpServer = null;
});

describe("RemoteMcpClient discovery proxy", () => {
  it("follows every cursor and preserves tool descriptions and JSON schemas", async () => {
    catalog = [
      searchableTool,
      {
        name: "get_record",
        description: "Reads a record by stable ID.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", pattern: "^rec_" } },
          required: ["id"],
        },
      },
    ];
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).resolves.toEqual(catalog);
    expect(listCalls).toEqual([undefined, "catalog-page-2"]);
    await client.close();
  });

  it("rejects a repeated pagination cursor instead of looping forever", async () => {
    configuredPages = [
      { tools: [searchableTool], nextCursor: "again" },
      { cursor: "again", tools: [], nextCursor: "again" },
    ];
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).rejects.toThrow("repeated cursor");
    expect(listCalls).toEqual([undefined, "again"]);
    await client.close();
  });

  it("bounds malformed pagination chains by maximum page count", async () => {
    configuredPages = Array.from({ length: 100 }, (_, index) => ({
      ...(index > 0 ? { cursor: `page-${index}` } : {}),
      tools: [],
      nextCursor: `page-${index + 1}`,
    }));
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).rejects.toThrow("exceeded 100 pages");
    expect(listCalls).toHaveLength(100);
    await client.close();
  });

  it("bounds malformed catalogs by total tool count", async () => {
    configuredPages = [{ tools: Array.from({ length: 10_001 }, () => searchableTool) }];
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).rejects.toThrow("exceeded 10000 tools");
    expect(listCalls).toEqual([undefined]);
    await client.close();
  });

  it("returns an empty remote catalog", async () => {
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).resolves.toEqual([]);
    expect(listCalls).toEqual([undefined]);
    await client.close();
  });

  it("refreshes from the first page on each listTools call so new tools are discoverable", async () => {
    catalog = [searchableTool];
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.listTools()).resolves.toEqual([searchableTool]);
    const addedTool: Tool = {
      name: "created_after_bind",
      description: "Appears after the first discovery refresh.",
      inputSchema: { type: "object", properties: {} },
    };
    catalog.push(addedTool);

    await expect(client.listTools()).resolves.toEqual([searchableTool, addedTool]);
    expect(listCalls).toEqual([undefined, undefined, "catalog-page-2"]);
    await client.close();
  });

  it("forwards raw tool results including isError while callTool keeps normalization behavior", async () => {
    const client = new RemoteMcpClient({ url: baseUrl, allowUnauthenticated: true });

    await expect(client.callToolRaw("fail", { record: "rec_1" })).resolves.toMatchObject({
      content: [{ type: "text", text: "remote failure" }],
      structuredContent: { reason: "policy denied", code: "denied" },
      isError: true,
    });
    await expect(client.callTool("success")).resolves.toEqual({ ok: true });
    await expect(client.callTool("fail")).rejects.toThrow("remote MCP tool fail failed");
    await client.close();
  });

  it("requires explicit opt-in for unauthenticated endpoints and forwards generic connector headers", async () => {
    requireConnectorHeader = true;
    expect(() => new RemoteMcpClient({ url: baseUrl })).toThrow("MCP auth header is required");

    const authenticated = new RemoteMcpClient({
      url: baseUrl,
      headers: { "X-Connector-Secret": "fixture-secret" },
    });
    await expect(authenticated.listTools()).resolves.toEqual([]);
    expect(receivedConnectorHeaders).toContain("fixture-secret");
    await authenticated.close();

    requireConnectorHeader = false;
    process.env.MEDIACRAWLER_MCP_TOKEN = "never-forward-this-business-secret";
    const publicClient = new RemoteMcpClient({
      url: baseUrl,
      token: "",
      allowUnauthenticated: true,
    });
    await expect(publicClient.listTools()).resolves.toEqual([]);
    expect(receivedAuthorizationHeaders).not.toContain("Bearer never-forward-this-business-secret");
    await publicClient.close();
    delete process.env.MEDIACRAWLER_MCP_TOKEN;
  });
});
