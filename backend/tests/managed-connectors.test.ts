import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp = "";
let databaseUrl: string | undefined;
beforeEach(async () => {
  databaseUrl = process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-managed-connectors-"));
  process.env.NODE_ENV = "test";
  await freshTestDatabase();
  (await resetDatabase());
});
afterEach(async () => {
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.NODE_ENV;
  if (databaseUrl === undefined)
    delete process.env.DATABASE_URL;
  else
    process.env.DATABASE_URL = databaseUrl;
});
describe("managed MCP connector catalog", () => {
  it("persists the managed connector catalog and audit chain across a native PostgreSQL pool reset", async () => {
    const db = postgresDb();
    expect(process.env.DATABASE_URL).toMatch(/^postgres(?:ql)?:\/\//i);
    (await db.execute("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", "sriphy", "sriphy", "鄢棽", "x", '["employee","admin"]', "[]", "", 1, "now", "now"));
    (await db.execute("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES ($1,$2,$3,$4,$5)", "starrykol", "Starry KOL MCP", 1, "configured", "now"));
    (await db.execute("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES ($1,$2,$3,$4)", "sriphy", "starrykol", "write", "now"));
    (await db.execute("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)", "now", "sriphy", "admin.connector.update", '{"connector_id":"starrykol","actor":"sriphy"}'));
    (await resetDatabase());
    const migrated = postgresDb();
    expect(((await migrated.many("SELECT id,label FROM connectors ORDER BY id")) as Array<{
      id: string;
      label: string;
    }>)).toEqual([
      { id: "starrykol", label: "Starry KOL MCP" },
    ]);
    expect((await migrated.one("SELECT id FROM users WHERE id='sriphy'"))).toBeTruthy();
    expect((await migrated.one("SELECT access FROM user_connector_grants WHERE user_id='sriphy' AND connector_id='starrykol'")))
      .toMatchObject({ access: "write" });
    expect((await migrated.one("SELECT actor,payload FROM audit_events WHERE event_type='admin.connector.update'")))
      .toMatchObject({ actor: "sriphy", payload: expect.stringContaining("sriphy") });
  });
});
