import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { setAgentSkill, setConnectorConfig, setSkillConnector, setSkillTool, setToolPolicy, validateConnectorConfig } from "../src/runtime/store.js";
import { SkillExecution, toolSchemaHash, type RuntimeContext } from "../src/runtime/execution.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { previewOpenApi } from "../src/runtime/openapi.js";
import { assertSafeConnectorEndpoint } from "../src/runtime/http.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";

let tmp = "";
let server: http.Server | undefined;
const context: RuntimeContext = { agentId: "agent:runtime-test", skillId: "creator_profile", userId: "user-a", runId: "configurable-test" };
const tool = { name: "list_records", description: "Read permitted records", inputSchema: {
  type: "object", properties: { query: { type: "string" }, id: { type: "string" } }, required: ["query"], additionalProperties: false,
} } as Json;

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "configurable-connectors-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "test.db"), LINGONG_DATA: tmp, AUTH_MODE: "enabled", NODE_ENV: "test" });
  (await resetConn());
  const db = getConn();
  for (const [id, role] of [["user-a", "employee"], ["admin-a", "admin"]]) (await db.query("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)\n    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,id,id,"hash",JSON.stringify([role]),"[]","",1,"now","now"]));
  // 人员资格锚点是「人 → Agent」绑定（CONST-05 / ADR-2026-10-03）：Agent 先发布，
  // 账号挂到组织人员上，再把被测 Agent 绑定到该人员所在的三级组。
  (await seedPublishedAgent(context.agentId, "运行时测试 Agent"));
  (await createAgentBinding({
    agent_id: context.agentId, target_type: "organization_unit", target_id: "org:lt_team",
    company_id: "company:amperetime", source: "test",
  }));
  (await db.query("UPDATE organization_people SET user_id = $1 WHERE person_ref = $2",[context.userId,"person:ye_guanwang"]));
  (await db.query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('http_fixture','HTTP Fixture',1,'configured','now')",[]));
  (await setAgentSkill(context.agentId, context.skillId, true, 0));
  (await setSkillConnector(context.skillId, "http_fixture", true, 0));
});
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined; (await resetConn()); fs.rmSync(tmp, { recursive: true, force: true });
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
async function configure(url: string) {
  (await setConnectorConfig("http_fixture", { protocol: "http", url, allow_unauthenticated: true, http_tools: [{
    name: "list_records", description: "Read permitted records", inputSchema: tool.inputSchema as Record<string, unknown>, method: "GET", path: "/v1/records", query: { q: "query" }, output_path: "$.data.items",
  }] }, 0));
  (await setToolPolicy("http_fixture", "list_records", { enabled: true, risk: "L1", access: "read", schema_hash: toolSchemaHash(tool) }, 0));
  (await setSkillTool(context.skillId, "http_fixture", "list_records", true, 0));
}

describe("configuration-driven HTTP connector", () => {
  it("lists and calls an HTTP action through a Skill binding without a vendor adapter", async () => {
    const remote = await localApi(); (await configure(remote.url));
    const runtime = new SkillExecution(context);
    const catalog = await runtime.discover(); expect(catalog.tools).toHaveLength(1);
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "outdoor" });
    expect(result.structuredContent).toEqual([{ id: "r1" }]);
    expect(remote.calls).toEqual([{ url: "/v1/records?q=outdoor", method: "GET", auth: null, body: null }]);
  });
  it("requires an explicit per-tool Skill mount even when connector and policy are enabled", async () => {
    const remote = await localApi(); (await configure(remote.url));
    (await setSkillTool(context.skillId, "http_fixture", "list_records", false, 1));
    const catalog = await new SkillExecution(context).discover();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.unavailable).toContainEqual({ connector_id: "http_fixture", code: "runtime_no_authorized_tools" });
    expect(remote.calls).toHaveLength(0);
  });
  it("rejects old handles after a per-tool binding revoke before HTTP dispatch", async () => {
    const remote = await localApi(); (await configure(remote.url));
    const runtime = new SkillExecution(context); const catalog = await runtime.discover();
    (await setSkillTool(context.skillId, "http_fixture", "list_records", false, 1));
    await expect(runtime.invoke(String(catalog.tools[0].exposed.name), { query: "outdoor" })).rejects.toMatchObject({ detail: { code: "runtime_tool_unbound" } });
    expect(remote.calls).toHaveLength(0);
  });
  it("rejects dangerous HTTP paths and unknown OpenAPI forms before an endpoint is called", async () => {
    await expect((async () => (setConnectorConfig("http_fixture", {
      protocol: "http", url: "http://127.0.0.1:1234", allow_unauthenticated: true, http_tools: [{
        name: "bad", description: "bad", inputSchema: { type: "object" }, method: "GET", path: "/v1/../secret",
      }],
    }, 0)))()).rejects.toThrow();
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
  it("keeps an endpoint-less HTTP draft saveable and fails closed at runtime", async () => {
    await expect((async () => (setConnectorConfig("http_fixture", { protocol: "http", allow_unauthenticated: true, http_tools: [] }, 0)))()).resolves.not.toBeInstanceOf(Error);
    expect(() => validateConnectorConfig({ protocol: "http" })).toThrow("credential reference required unless allow_unauthenticated is true");
    expect(() => validateConnectorConfig({ allow_unauthenticated: true })).toThrow("exactly one of url or url_env is required");
    expect(() => validateConnectorConfig({ protocol: "http", url: "https://api.example.test", url_env: "API_URL", allow_unauthenticated: true }))
      .toThrow("url and url_env cannot be combined");
    const catalog = await new SkillExecution(context).discover();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.unavailable).toContainEqual({ connector_id: "http_fixture", code: "runtime_endpoint_invalid" });
  });
});
