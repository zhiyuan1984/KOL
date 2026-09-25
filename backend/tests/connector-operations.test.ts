import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit, getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { setConnectorConfig } from "../src/runtime/store.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
let tmp: string;
let env: Record<string, string | undefined>;
beforeEach(() => {
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map(k => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "connector-probe-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  resetConn();
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('probe_fixture','Fixture',1,'configured','now')").run();
  setConnectorConfig("probe_fixture", { url: "https://fixture.example/mcp", allow_unauthenticated: true }, 0);
});
afterEach(() => {
  resetConn(); fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
function app(inspect = async () => [{ name: "lookup", inputSchema: { type: "object" } }]) {
  const a = new Hono();
  a.onError((e,c) => e instanceof HttpFail ? c.json({detail:e.detail}, e.status as 400|403|404|409|502) : c.json({detail:"unexpected"},500));
  a.route("/api", createConnectorOperationsRouter(inspect));
  return a;
}
const root = "/api/admin/runtime/connectors/probe_fixture";
describe("connector operations (isolated inspector, no external service)", () => {
  it("records a time-, actor- and config-scoped directory probe without invoking business tools", async () => {
    const a = app(); const response = await a.request(root + "/probe", {method:"POST"});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status:"succeeded", config_version:1, probe_kind:"mcp_tools_list", tool_count:1, live_verified:true });
    const result = await (await a.request(root + "/activity")).json();
    expect(result.probes).toHaveLength(1); expect(result.probes[0].actor_id).toBeTruthy();
    expect(result.events[0].event_type).toBe("runtime.connector.probed");
  });
  it("never returns or audits raw upstream failures", async () => {
    const secret = "Bearer private-sensitive-probe-token";
    const a = app(async () => { throw new Error(secret); });
    const response = await a.request(root + "/probe", {method:"POST"});
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(secret);
    const result = await (await a.request(root + "/activity")).text();
    expect(result).toContain("runtime_remote_failed"); expect(result).not.toContain(secret);
    expect(JSON.stringify(getConn().prepare("SELECT payload FROM audit_events").all())).not.toContain(secret);
  });
  it("invalidates probe success when configuration changes during inspection", async () => {
    const a = app(async () => { setConnectorConfig("probe_fixture", {url:"https://changed.example/mcp", allow_unauthenticated:true},1); return []; });
    const response = await a.request(root + "/probe", {method:"POST"});
    expect(await response.json()).toMatchObject({status:"failed", error_code:"runtime_binding_changed",live_verified:false});
  });
  it("blocks disabled connectors and rejects anonymous production governance", async () => {
    let called = false;
    const a = app(async () => { called = true; return []; });
    getConn().prepare("UPDATE connectors SET enabled=0 WHERE id='probe_fixture'").run();
    expect((await a.request(root + "/probe", {method:"POST"})).status).toBe(403); expect(called).toBe(false);
    process.env.NODE_ENV = "production";
    expect((await a.request(root + "/activity")).status).toBe(403);
  });
  it("filters connector audit histories and only exposes permitted trace fields", async () => {
    audit("tester", "runtime.tool.completed", {connector_id:"probe_fixture", tool:"lookup", run_id:"run-1", input:{secret:"do-not-leak"}, config:{url:"private-endpoint"}, headers:{Authorization:"secret"}});
    audit("tester", "runtime.tool.completed", {connector_id:"different", tool:"other"});
    const a = app(); const result = await (await a.request(root + "/activity")).json();
    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual({connector_id:"probe_fixture", tool:"lookup", run_id:"run-1"});
    expect((await a.request(root + "/activity?limit=999")).status).toBe(400);
  });
});
