import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { setAgentSkill, setConnectorConfig, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { SkillExecution, toolSchemaHash, type RuntimeContext } from "../src/runtime/execution.js";
import { previewOpenApi } from "../src/runtime/openapi.js";
import { assertSafeConnectorEndpoint } from "../src/runtime/http.js";
import type { Json } from "../src/types.js";

let tmp = "";
let server: http.Server | undefined;
const context: RuntimeContext = { agentId: "agent:runtime-test", skillId: "creator_profile", userId: "user-a", runId: "configurable-test" };
const tool = { name: "list_records", description: "Read permitted records", inputSchema: {
  type: "object", properties: { query: { type: "string" }, id: { type: "string" } }, required: ["query"], additionalProperties: false,
} } as Json;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "configurable-connectors-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "test.db"), LINGONG_DATA: tmp, AUTH_MODE: "enabled", NODE_ENV: "test" });
  resetConn();
  const db = getConn();
  for (const [id, role] of [["user-a", "employee"], ["admin-a", "admin"]]) db.prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, id, id, "hash", JSON.stringify([role]), "[]", "", 1, "now", "now");
  db.prepare("INSERT INTO user_skill_grants(user_id,skill_id,created_at) VALUES(?,?,?)").run(context.userId, context.skillId, "now");
  db.prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('http_fixture','HTTP Fixture',1,'configured','now')").run();
  db.prepare("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES(?,?,?,?)").run(context.userId, "http_fixture", "read", "now");
  setAgentSkill(context.agentId, context.skillId, true, 0);
  setSkillConnector(context.skillId, "http_fixture", true, 0);
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined; resetConn(); fs.rmSync(tmp, { recursive: true, force: true });
  for (const key of ["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV", "RUNTIME_CREDENTIAL_MASTER_KEY"]) delete process.env[key];
});
async function localApi() {
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
    calls.push({ url: String(req.url), method: String(req.method), auth: req.headers.authorization || null,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null });
    if (req.url === "/v1/records?q=outdoor") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: { items: [{ id: "r1" }] } })); return; }
    res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, calls };
}
function configure(url: string) {
  setConnectorConfig("http_fixture", { protocol: "http", url, allow_unauthenticated: true, http_tools: [{
    name: "list_records", description: "Read permitted records", inputSchema: tool.inputSchema as Record<string, unknown>, method: "GET", path: "/v1/records", query: { q: "query" }, output_path: "$.data.items",
  }] }, 0);
  setToolPolicy("http_fixture", "list_records", { enabled: true, risk: "L1", access: "read", schema_hash: toolSchemaHash(tool) }, 0);
  setSkillTool(context.skillId, "http_fixture", "list_records", true, 0);
}

describe("configuration-driven HTTP connector", () => {
  it("lists and calls an HTTP action through a Skill binding without a vendor adapter", async () => {
    const remote = await localApi(); configure(remote.url);
    const runtime = new SkillExecution(context);
    const catalog = await runtime.discover(); expect(catalog.tools).toHaveLength(1);
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "outdoor" });
    expect(result.structuredContent).toEqual([{ id: "r1" }]);
    expect(remote.calls).toEqual([{ url: "/v1/records?q=outdoor", method: "GET", auth: null, body: null }]);
  });
  it("requires an explicit per-tool Skill mount even when connector and policy are enabled", async () => {
    const remote = await localApi(); configure(remote.url);
    setSkillTool(context.skillId, "http_fixture", "list_records", false, 1);
    const catalog = await new SkillExecution(context).discover();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.unavailable).toContainEqual({ connector_id: "http_fixture", code: "runtime_no_authorized_tools" });
    expect(remote.calls).toHaveLength(0);
  });
  it("rejects old handles after a per-tool binding revoke before HTTP dispatch", async () => {
    const remote = await localApi(); configure(remote.url);
    const runtime = new SkillExecution(context); const catalog = await runtime.discover();
    setSkillTool(context.skillId, "http_fixture", "list_records", false, 1);
    await expect(runtime.invoke(String(catalog.tools[0].exposed.name), { query: "outdoor" })).rejects.toMatchObject({ detail: { code: "runtime_tool_unbound" } });
    expect(remote.calls).toHaveLength(0);
  });
  it("rejects dangerous HTTP paths and unknown OpenAPI forms before an endpoint is called", () => {
    expect(() => setConnectorConfig("http_fixture", {
      protocol: "http", url: "http://127.0.0.1:1234", allow_unauthenticated: true, http_tools: [{
        name: "bad", description: "bad", inputSchema: { type: "object" }, method: "GET", path: "/v1/../secret",
      }],
    }, 0)).toThrow();
    expect(() => previewOpenApi({ openapi: "3.1.0", paths: { "/x": { get: { operationId: "x", parameters: [{ in: "header", name: "X", schema: { type: "string" } }] } } } })).not.toThrow();
    const external = previewOpenApi({ openapi: "3.1.0", paths: { "/x": { get: { operationId: "x", parameters: [{ $ref: "https://bad.example/p" }] } } } });
    expect(external.tools).toEqual([]); expect(external.warnings.join(" ")).toMatch(/不受支持/);
    const yaml = previewOpenApi("openapi: 3.1.0\npaths:\n  /records/{id}:\n    get:\n      operationId: getRecord\n      parameters:\n        - in: path\n          name: id\n          required: true\n          schema:\n            type: string\n");
    expect(yaml.tools).toMatchObject([{ name: "getRecord", method: "GET", path: "/records/{id}" }]);
    expect(() => previewOpenApi("openapi: 3.1.0\na: &a { value: 1 }\npaths: { /x: { get: { operationId: x, x: *a } } }"))
      .toThrow();
  });
  it("rejects loopback and cloud-metadata endpoints outside the isolated test mode", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => assertSafeConnectorEndpoint("http://127.0.0.1:8765")).toThrow();
      expect(() => assertSafeConnectorEndpoint("http://169.254.169.254/latest/meta-data")).toThrow();
      expect(() => assertSafeConnectorEndpoint("https://api.example.test/mcp")).not.toThrow();
    } finally { process.env.NODE_ENV = previous; }
  });
});
