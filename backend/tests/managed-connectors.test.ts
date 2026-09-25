import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-managed-connectors-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.NODE_ENV = "test";
  resetConn();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
  delete process.env.NODE_ENV;
});

describe("managed MCP connector catalog", () => {
  it("removes legacy connector records and canonicalizes sriphy on the next database open", () => {
    const db = getConn();
    db.prepare(
      "INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run("usr_sriphy", "sriphy", "鄢棽", "x", '["employee","admin"]', "[]", "", 1, "now", "now");
    db.prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES (?,?,?,?,?)")
      .run("enterprise_mail", "企业邮箱", 1, "configured", "now");
    db.prepare("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES (?,?,?,?)")
      .run("usr_sriphy", "enterprise_mail", "admin", "now");
    db.prepare("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES (?,?,?,?)")
      .run("now", "usr_sriphy", "admin.connector.update", '{"connector_id":"enterprise_mail","actor":"usr_sriphy"}');

    resetConn();
    const migrated = getConn();
    expect((migrated.prepare("SELECT id,label FROM connectors ORDER BY id").all() as Array<{ id: string; label: string }>)).toEqual([
      { id: "claw", label: "MediaCrawler MCP" },
      { id: "starrykol", label: "Starry KOL MCP" },
    ]);
    expect(migrated.prepare("SELECT id FROM users WHERE id='usr_sriphy'").get()).toBeUndefined();
    expect(migrated.prepare("SELECT id FROM users WHERE id='sriphy'").get()).toBeTruthy();
    expect(migrated.prepare("SELECT access FROM user_connector_grants WHERE user_id='sriphy' AND connector_id='starrykol'").get())
      .toMatchObject({ access: "write" });
    expect(migrated.prepare("SELECT actor,payload FROM audit_events WHERE event_type='admin.connector.update'").get())
      .toMatchObject({ actor: "sriphy", payload: expect.stringContaining("sriphy") });
  });
});
