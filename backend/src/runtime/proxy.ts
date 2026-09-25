import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Json } from "../types.js";
import { SkillExecution, runtimeErrorCode } from "./execution.js";

export type RuntimeProxy = { spec: Json; close: () => Promise<void> };

/** Protocol-only proxy: no business tool implementation, supplier switch, or reasoning loop. */
export async function startRuntimeProxy(execution: SkillExecution): Promise<RuntimeProxy> {
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  const active = new Set<{ server: Server; transport: StreamableHTTPServerTransport }>();
  let stopped = false;
  const httpServer = http.createServer(async (req, res) => {
    const auth = Buffer.from(String(req.headers.authorization || ""));
    if (stopped || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      res.writeHead(401).end(); return;
    }
    // Local-only, no browser origins, no DNS-rebinding route and no alternate paths.
    if (req.url !== "/mcp" || req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(String(req.headers.host || ""))) {
      res.writeHead(403).end(); return;
    }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    let pair: { server: Server; transport: StreamableHTTPServerTransport } | undefined;
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 1_100_000) { res.writeHead(413).end(); return; }
        chunks.push(Buffer.from(part));
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { res.writeHead(400).end(); return; }
      const server = new Server({ name: "skill-runtime", version: "1.0.0" }, { capabilities: { tools: {} } });
      // Stateless transport per request. Tool lists are refreshed explicitly every tools/list.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      pair = { server, transport };
      active.add(pair);
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        const catalog = await execution.discover();
        return { tools: catalog.tools.map((tool) => tool.exposed as Tool) };
      });
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try { return await execution.invoke(request.params.name, (request.params.arguments || {}) as Json) as CallToolResult; }
        catch (error) { return { content: [{ type: "text", text: runtimeErrorCode(error) }], isError: true }; }
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({ error: "runtime_proxy_failed" }));
    } finally {
      if (pair) { active.delete(pair); await pair.server.close().catch(() => undefined); }
    }
  });
  httpServer.requestTimeout = 120_000;
  httpServer.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => { httpServer.off("error", reject); resolve(); });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("runtime proxy could not bind");
  return {
    spec: { url: `http://127.0.0.1:${address.port}/mcp`, http_headers: { Authorization: `Bearer ${token}` },
      enabled: true, startup_timeout_sec: 30, tool_timeout_sec: 120 },
    async close() {
      if (stopped) return;
      stopped = true;
      execution.close();
      await Promise.all([...active].map(({ server }) => server.close().catch(() => undefined)));
      active.clear();
      await new Promise<void>((resolve) => { httpServer.close(() => resolve()); httpServer.closeAllConnections(); });
    },
  };
}
