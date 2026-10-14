import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audit, postgresDb, resetDatabase } from "../src/postgres/access.js";
import { HttpFail } from "../src/host/errors.js";
import { runtimeErrorCode } from "../src/runtime/execution.js";
import { setConnectorConfig } from "../src/runtime/store.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp: string;
let env: Record<string, string | undefined>;
beforeEach(async () => {
  await freshTestDatabase();
  env = Object.fromEntries(["AUTH_MODE", "NODE_ENV", "MEDIACRAWLER_MCP_URL"].map(k => [k, process.env[k]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "connector-probe-"));
  Object.assign(process.env, { AUTH_MODE: "disabled", NODE_ENV: "test" });
  (await resetDatabase());
  (await postgresDb().execute("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('probe_fixture','Fixture',1,'configured','now')"));
  (await setConnectorConfig("probe_fixture", { url: "https://fixture.example/mcp", allow_unauthenticated: true }, 0));
});
afterEach(async () => {
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined)
      delete process.env[k];
    else
      process.env[k] = v;
  }
});
function app(inspect = async () => [{ name: "lookup", inputSchema: { type: "object" } }], startProbe?: () => Promise<void>) {
  const a = new Hono();
  a.onError((e, c) => e instanceof HttpFail ? c.json({ detail: e.detail }, e.status as 400 | 403 | 404 | 409 | 502) : c.json({ detail: "unexpected" }, 500));
  a.route("/api", createConnectorOperationsRouter(inspect, startProbe));
  return a;
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
    expect(Number(((await postgresDb().one("SELECT COUNT(*) AS n FROM runtime_tool_policies WHERE connector_id=$1", "probe_fixture")) as {
      n: unknown;
    }).n))
      .toBe(1);
    expect((await postgresDb().one("SELECT enabled,risk FROM runtime_tool_policies WHERE connector_id='probe_fixture' AND tool_name='start_crawl'"))).toMatchObject({ enabled: 1, risk: "L3" });
    const activity = await (await a.request(root + "/activity")).json();
    expect(activity.probes[0].probe_kind).toBe("mcp_tools_list");
  });
  it("records a time-, actor- and config-scoped directory probe without invoking business tools", async () => {
    const a = app();
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "succeeded", config_version: 1, probe_kind: "mcp_tools_list", tool_count: 1, live_verified: true });
    const result = await (await a.request(root + "/activity")).json();
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0].actor_id).toBeTruthy();
    expect(result.events[0].event_type).toBe("runtime.connector.probed");
  });
  it("keeps verification separate from explicit enablement", async () => {
    (await postgresDb().execute("UPDATE connectors SET enabled=0,status='pending_verification' WHERE id='probe_fixture'"));
    const a = app();
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(response.status).toBe(200);
    expect((await postgresDb().one("SELECT enabled,status FROM connectors WHERE id='probe_fixture'")))
      .toMatchObject({ enabled: 0, status: "verified" });
    (await postgresDb().execute("UPDATE connectors SET enabled=1,status='verified' WHERE id='probe_fixture'"));
    const reprobe = await a.request(root + "/probe", { method: "POST" });
    expect(reprobe.status).toBe(200);
    expect((await postgresDb().one("SELECT enabled,status FROM connectors WHERE id='probe_fixture'")))
      .toMatchObject({ enabled: 1, status: "verified" });
  });
  it("registers derived tool policies when a directory probe passes", async () => {
    const a = app();
    expect((await a.request(root + "/probe", { method: "POST" })).status).toBe(200);
    const policy = (await postgresDb().one("SELECT * FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2", "probe_fixture", "lookup")) as {
      risk?: unknown;
      access?: unknown;
      enabled?: unknown;
      schema_hash?: unknown;
    } | undefined;
    expect(policy).toMatchObject({ risk: "L2", access: "write", enabled: 1 });
    expect(String(policy?.schema_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(((await postgresDb().one("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='runtime.tool_catalog.registered'")) as {
      n: unknown;
    }).n)).toBe(1);
  });
  it("does not register tools when the probe fails", async () => {
    const a = app(async () => { throw new Error("down"); });
    expect((await a.request(root + "/probe", { method: "POST" })).status).toBe(502);
    expect(Number(((await postgresDb().one("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='runtime.tool_catalog.registered'")) as {
      n: unknown;
    }).n)).toBe(0);
  });
  it("never returns or audits raw upstream failures", async () => {
    const secret = "Bearer private-sensitive-probe-token";
    const a = app(async () => { throw new Error(secret); });
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(secret);
    const result = await (await a.request(root + "/activity")).text();
    expect(result).toContain("runtime_remote_failed");
    expect(result).not.toContain(secret);
    expect(JSON.stringify((await postgresDb().many("SELECT payload FROM audit_events")))).not.toContain(secret);
  });
  it("invalidates probe success when configuration changes during inspection", async () => {
    const a = app(async () => { (await setConnectorConfig("probe_fixture", { url: "https://changed.example/mcp", allow_unauthenticated: true }, 1)); return []; });
    const response = await a.request(root + "/probe", { method: "POST" });
    expect(await response.json()).toMatchObject({ status: "failed", error_code: "runtime_binding_changed", live_verified: false });
  });
  it("blocks disabled connectors and rejects anonymous production governance", async () => {
    let called = false;
    const a = app(async () => { called = true; return []; });
    (await postgresDb().execute("UPDATE connectors SET enabled=0 WHERE id='probe_fixture'"));
    expect((await a.request(root + "/probe", { method: "POST" })).status).toBe(403);
    expect(called).toBe(false);
    process.env.NODE_ENV = "production";
    expect((await a.request(root + "/activity")).status).toBe(403);
  });
  it("filters connector audit histories and only exposes permitted trace fields", async () => {
    (await audit("tester", "runtime.tool.completed", { connector_id: "probe_fixture", tool: "lookup", run_id: "run-1", input: { secret: "do-not-leak" }, config: { url: "private-endpoint" }, headers: { Authorization: "secret" } }));
    (await audit("tester", "runtime.tool.completed", { connector_id: "different", tool: "other" }));
    const a = app();
    const result = await (await a.request(root + "/activity")).json();
    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload).toEqual({ connector_id: "probe_fixture", tool: "lookup", run_id: "run-1" });
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
