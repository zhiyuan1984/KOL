import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authMiddleware } from "../src/auth.js";
import { audit, getConn, nowIso, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { runtimeErrorCode } from "../src/runtime/execution.js";
import { setConnectorConfig } from "../src/runtime/store.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
import { authenticatedTestApp, seedPublishedAgent, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import { freshTestDatabase } from "./support/pg.js";

let env: Record<string, string | undefined>;
let cookie = "";

beforeEach(async () => {
  env = Object.fromEntries(["AUTH_MODE", "NODE_ENV", "MEDIACRAWLER_MCP_URL", "RUNTIME_CREDENTIAL_MASTER_KEY"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { AUTH_MODE: "enabled", NODE_ENV: "test" });
  await freshTestDatabase({ reclaimPrevious: true });
  (await resetConn());
  await seedPublishedAgent("agent:kol");
  cookie = await seedRuntimeTestActor(["creator_discovery"], true);
  expect(await pgVisibleSkillIdsForUser("usr_runtime_fixture", nowIso())).toContain("creator_discovery");
  (await getConn().query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('probe_fixture','Fixture',1,'configured','now')",[]));
  (await setConnectorConfig("probe_fixture", { url: "https://fixture.example/mcp", allow_unauthenticated: true }, 0));
});
afterEach(async () => {
  (await resetConn());
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
function app(inspect = async () => [{ name: "lookup", inputSchema: { type: "object" } }], startProbe?: () => Promise<void>, authenticated = true) {
  const a = new Hono();
  a.use("/api/*", authMiddleware);
  a.onError((e,c) => e instanceof HttpFail ? c.json({detail:e.detail}, e.status as 400|401|403|404|409|502) : c.json({detail:"unexpected"},500));
  a.route("/api", createConnectorOperationsRouter(inspect, startProbe));
  return authenticated ? authenticatedTestApp(a, cookie) : a;
}
const root = "/api/admin/runtime/connectors/probe_fixture";
describe("connector operations (isolated inspector, no external service)", () => {
  it("uses read-only discovery even for MediaCrawler URLs and never starts a crawl", async () => {
    process.env.MEDIACRAWLER_MCP_URL = "https://fixture.example/mcp";
    (await configureCrawlerFixture("https://fixture.example/mcp"));
    let starts = 0;
    const a = app(async () => [{ name: "start_crawl", inputSchema: { type: "object" } }], async () => { starts += 1; });
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ probe_kind: "mcp_tools_list", tool_count: 1, live_verified: true });
    expect(starts).toBe(0);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM runtime_tool_policies WHERE connector_id=$1",["probe_fixture"])).rows[0] as { n: unknown }).n))
      .toBe(1);
    expect((await getConn().query("SELECT enabled,risk FROM runtime_tool_policies WHERE connector_id='probe_fixture' AND tool_name='start_crawl'",[])).rows[0]).toMatchObject({ enabled: 1, risk: "L3" });
    const activity = await (await a.request(root + "/activity")).json();
    expect(activity.probes[0].probe_kind).toBe("mcp_tools_list");
  });

  it("records a time-, actor- and config-scoped directory probe without invoking business tools", async () => {
    const a = app(); const response = await a.request(root + "/probe", {method:"POST"});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status:"succeeded", config_version:1, probe_kind:"mcp_tools_list", tool_count:1, live_verified:true });
    const result = await (await a.request(root + "/activity")).json();
    expect(result.probes).toHaveLength(1); expect(result.probes[0].actor_id).toBeTruthy();
    expect(result.events[0].event_type).toBe("runtime.connector.probed");
  });

  it("keeps verification separate from explicit enablement", async () => {
    (await getConn().query("UPDATE connectors SET enabled=0,status='pending_verification' WHERE id='probe_fixture'",[]));
    const a = app();
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(response.status).toBe(200);
    expect((await getConn().query("SELECT enabled,status FROM connectors WHERE id='probe_fixture'",[])).rows[0])
      .toMatchObject({ enabled: 0, status: "verified" });

    (await getConn().query("UPDATE connectors SET enabled=1,status='verified' WHERE id='probe_fixture'",[]));
    const reprobe = await a.request(root + "/probe", { method: "POST" });
    expect(reprobe.status).toBe(200);
    expect((await getConn().query("SELECT enabled,status FROM connectors WHERE id='probe_fixture'",[])).rows[0])
      .toMatchObject({ enabled: 1, status: "verified" });
  });
  it("registers derived tool policies when a directory probe passes", async () => {
    const a = app();
    expect((await a.request(root + "/probe", { method: "POST" })).status).toBe(200);
    const policy = (await getConn().query("SELECT * FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2",["probe_fixture","lookup"])).rows[0] as
      { risk?: unknown; access?: unknown; enabled?: unknown; schema_hash?: unknown } | undefined;
    expect(policy).toMatchObject({ risk: "L2", access: "write", enabled: 1 });
    expect(String(policy?.schema_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='runtime.tool_catalog.registered'",[])).rows[0] as { n: unknown }).n)).toBe(1);
  });
  it("does not register tools when the probe fails", async () => {
    const a = app(async () => { throw new Error("down"); });
    expect((await a.request(root + "/probe", { method: "POST" })).status).toBe(502);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='runtime.tool_catalog.registered'",[])).rows[0] as { n: unknown }).n)).toBe(0);
  });
  it("never returns or audits raw upstream failures", async () => {
    const secret = "Bearer private-sensitive-probe-token";
    const a = app(async () => { throw new Error(secret); });
    const response = await a.request(root + "/probe", {method:"POST"});
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(secret);
    const result = await (await a.request(root + "/activity")).text();
    expect(result).toContain("runtime_remote_failed"); expect(result).not.toContain(secret);
    expect(JSON.stringify((await getConn().query("SELECT payload FROM audit_events",[])).rows)).not.toContain(secret);
  });
  it("invalidates probe success when configuration changes during inspection", async () => {
    const a = app(async () => { (await setConnectorConfig("probe_fixture", {url:"https://changed.example/mcp", allow_unauthenticated:true},1)); return []; });
    const response = await a.request(root + "/probe", {method:"POST"});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({detail:{code:"runtime_binding_changed"}});
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM runtime_connector_probes WHERE connector_id='probe_fixture'",[])).rows[0] as { n: unknown }).n)).toBe(0);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM runtime_tool_policies WHERE connector_id='probe_fixture'",[])).rows[0] as { n: unknown }).n)).toBe(0);
    expect(Number(((await getConn().query("SELECT COUNT(*) AS n FROM audit_events WHERE event_type LIKE 'runtime.%' AND (payload::jsonb ->> 'connector_id')='probe_fixture'",[])).rows[0] as { n: unknown }).n)).toBe(0);
  });
  it("blocks disabled connectors and rejects anonymous production governance", async () => {
    let called = false;
    const a = app(async () => { called = true; return []; });
    (await getConn().query("UPDATE connectors SET enabled=0 WHERE id='probe_fixture'",[]));
    expect((await a.request(root + "/probe", {method:"POST"})).status).toBe(403); expect(called).toBe(false);
    process.env.NODE_ENV = "production";
    expect((await app(async () => { called = true; return []; }, undefined, false).request(root + "/activity")).status).toBe(401);
    expect(called).toBe(false);
  });
  it("filters connector audit histories and only exposes permitted trace fields", async () => {
    (await audit("tester", "runtime.tool.completed", {connector_id:"probe_fixture", tool:"lookup", run_id:"run-1", input:{secret:"do-not-leak"}, config:{url:"private-endpoint"}, headers:{Authorization:"secret"}}));
    (await audit("tester", "runtime.tool.completed", {connector_id:"different", tool:"other"}));
    const a = app(); const result = await (await a.request(root + "/activity")).json();
    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual({connector_id:"probe_fixture", tool:"lookup", run_id:"run-1"});
    expect((await a.request(root + "/activity?limit=999")).status).toBe(400);
  });
  it("classifies transport failures into actionable sanitized probe codes", async () => {
    const unauthorized = app(async () => { throw Object.assign(new Error("upstream body text"), { remoteStatus: 401 }); });
    const denied = await unauthorized.request(root + "/probe", { method: "POST" });
    expect(await denied.json()).toMatchObject({ status: "failed", error_code: "runtime_remote_unauthorized" });
    const outage = app(async () => { throw Object.assign(new Error("upstream body text"), { remoteStatus: 503 }); });
    const down = await outage.request(root + "/probe", { method: "POST" });
    expect(await down.json()).toMatchObject({ status: "failed", error_code: "runtime_remote_unavailable" });
  });
  it("maps every transport classification without echoing remote text", () => {
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 401 }))).toBe("runtime_remote_unauthorized");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 403 }))).toBe("runtime_remote_forbidden");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 404 }))).toBe("runtime_remote_not_found");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 408 }))).toBe("runtime_remote_timeout");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 429 }))).toBe("runtime_remote_rate_limited");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 500 }))).toBe("runtime_remote_unavailable");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteStatus: 418 }))).toBe("runtime_remote_rejected");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteKind: "timeout" }))).toBe("runtime_remote_timeout");
    expect(runtimeErrorCode(Object.assign(new Error("x"), { remoteKind: "unreachable" }))).toBe("runtime_remote_unreachable");
    expect(runtimeErrorCode(new Error("Bearer private-token is not echoed"))).toBe("runtime_remote_failed");
  });
});
