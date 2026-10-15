import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";

let tmp = "";
let databaseUrl: string | undefined;

beforeEach(async () => {
  databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL; // The reconnect migration only runs for SQLite.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-managed-connectors-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  (await resetConn());
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  delete process.env.NODE_ENV;
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;
});

describe("managed MCP connector catalog", () => {
  it("removes legacy connector records and canonicalizes sriphy on the next database open", async () => {
    const db = getConn();
    (await db.query("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",["usr_sriphy","sriphy","鄢棽","x",'["employee","admin"]',"[]","",1,"now","now"]));
    (await db.query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES ($1,$2,$3,$4,$5)",["enterprise_mail","企业邮箱",1,"configured","now"]));
    (await db.query("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES ($1,$2,$3,$4)",["usr_sriphy","enterprise_mail","admin","now"]));
    (await db.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)",["now","usr_sriphy","admin.connector.update",'{"connector_id":"enterprise_mail","actor":"usr_sriphy"}']));

    (await resetConn());
    const migrated = getConn();
    expect(((await migrated.query("SELECT id,label FROM connectors ORDER BY id",[])).rows as Array<{ id: string; label: string }>)).toEqual([
      { id: "claw", label: "MediaCrawler MCP" },
      { id: "starrykol", label: "Starry KOL MCP" },
    ]);
    expect((await migrated.query("SELECT id FROM users WHERE id='usr_sriphy'",[])).rows[0]).toBeUndefined();
    expect((await migrated.query("SELECT id FROM users WHERE id='sriphy'",[])).rows[0]).toBeTruthy();
    expect((await migrated.query("SELECT access FROM user_connector_grants WHERE user_id='sriphy' AND connector_id='starrykol'",[])).rows[0])
      .toMatchObject({ access: "write" });
    expect((await migrated.query("SELECT actor,payload FROM audit_events WHERE event_type='admin.connector.update'",[])).rows[0])
      .toMatchObject({ actor: "sriphy", payload: expect.stringContaining("sriphy") });
  });
});
