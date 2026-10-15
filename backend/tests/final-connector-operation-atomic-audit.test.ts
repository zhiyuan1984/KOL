import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { postgresQuery } from "../src/postgres/pool.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
import { setConnectorConfig } from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";

const connectorId = "atomic_audit_probe";
const route = `/api/admin/runtime/connectors/${connectorId}/probe`;
let tmp = "";
let env: Record<string, string | undefined>;

function app() {
  const instance = new Hono();
  instance.onError((error, context) => error instanceof HttpFail
    ? context.json({ detail: error.detail }, error.status as 400 | 403 | 404 | 409 | 502)
    : context.json({ detail: "unexpected" }, 500));
  // This is the external discovery adapter only; the database and audit paths are real PostgreSQL.
  instance.route("/api", createConnectorOperationsRouter(async () => [{ name: "lookup", inputSchema: { type: "object" } }]));
  return instance;
}

async function prepareConnector(): Promise<void> {
  await postgresQuery(
    "INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES($1,$2,1,'configured',$3)",
    [connectorId, "Atomic audit fixture", new Date().toISOString()],
  );
  await setConnectorConfig(connectorId, { url: "https://fixture.example/mcp", allow_unauthenticated: true }, 0);
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const [row] = await postgresQuery<{ n: string }>(sql, values);
  return Number(row?.n || 0);
}

beforeEach(async () => {
  await freshTestDatabase();
  env = Object.fromEntries(["LINGONG_DB", "LINGONG_DATA", "AUTH_MODE", "NODE_ENV"].map((key) => [key, process.env[key]]));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "connector-atomic-audit-"));
  Object.assign(process.env, { LINGONG_DB: path.join(tmp, "db.sqlite"), LINGONG_DATA: tmp, AUTH_MODE: "disabled", NODE_ENV: "test" });
  await resetConn();
  await prepareConnector();
});

afterEach(async () => {
  await resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe("connector probe audit atomicity (isolated PostgreSQL)", () => {
  it("rolls back connector, probe and discovered-policy writes when the real audit insert fails", async () => {
    await postgresQuery(`CREATE FUNCTION reject_atomic_probe_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'runtime.connector.probed' THEN
          RAISE EXCEPTION 'audit receipt rejected for atomicity test';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await postgresQuery("CREATE TRIGGER reject_atomic_probe_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_atomic_probe_audit()");

    const response = await app().request(route, { method: "POST" });
    expect(response.status).toBe(500);
    expect(await count("SELECT COUNT(*)::text AS n FROM runtime_connector_probes WHERE connector_id=$1", [connectorId])).toBe(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM runtime_tool_policies WHERE connector_id=$1", [connectorId])).toBe(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM audit_events WHERE event_type IN ('runtime.connector.probed','runtime.tool_catalog.registered')")).toBe(0);
    const [connector] = await postgresQuery<{ enabled: number; status: string; last_verified_at: string | null; last_error: string | null }>(
      "SELECT enabled,status,last_verified_at,last_error FROM connectors WHERE id=$1", [connectorId],
    );
    expect(connector).toEqual({ enabled: 1, status: "configured", last_verified_at: null, last_error: null });
  });

  it("commits a successful probe with discoverable policy, probe and receipt references", async () => {
    const response = await app().request(route, { method: "POST" });
    expect(response.status).toBe(200);
    const receipt = await response.json() as { actor_id: string; config_version: number; status: string };
    expect(receipt).toMatchObject({ config_version: 1, status: "succeeded" });

    const [connector] = await postgresQuery<{ enabled: number; status: string }>("SELECT enabled,status FROM connectors WHERE id=$1", [connectorId]);
    expect(connector).toEqual({ enabled: 1, status: "verified" });
    expect(await count("SELECT COUNT(*)::text AS n FROM runtime_connector_probes WHERE connector_id=$1 AND config_version=1 AND status='succeeded'", [connectorId])).toBe(1);
    expect(await count("SELECT COUNT(*)::text AS n FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name='lookup'", [connectorId])).toBe(1);

    const events = await postgresQuery<{ actor: string; event_type: string; payload: string }>(
      "SELECT actor,event_type,payload FROM audit_events WHERE event_type IN ('runtime.connector.probed','runtime.tool_catalog.registered') ORDER BY id", [],
    );
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.event_type)).toEqual(["runtime.tool_catalog.registered", "runtime.connector.probed"]);
    expect(events.every((event) => event.actor === receipt.actor_id)).toBe(true);
    expect(JSON.parse(events[0]!.payload)).toMatchObject({ connector_id: connectorId, config_version: 1, total: 1, created: 1 });
    expect(JSON.parse(events[1]!.payload)).toMatchObject({ connector_id: connectorId, version: 1, status: "succeeded", tool_count: 1, code: null });
  });
});
