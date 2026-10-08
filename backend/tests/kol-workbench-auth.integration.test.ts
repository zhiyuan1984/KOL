import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { postgresPool } from "../src/postgres/pool.js";
import { freshTestDatabase } from "./support/pg.js";

let app: Hono;
let tmp = "";
let cookie = "";
let userId = "";
const paths = ["/api/kol/leads?limit=1", "/api/kol/cooperations?limit=1"];

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-workbench-auth-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "enabled";
  resetConn();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const setup = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "kol-auth-admin", name: "KOL Auth Admin", password: "isolated-test-password", brands: ["LT"] }),
  });
  expect(setup.status).toBe(201);
  cookie = setup.headers.get("set-cookie")?.split(";")[0] || "";
  userId = String((await setup.json()).user.id);
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  process.env.CODEX_MODE = "stub";
});

describe("KOL workbench session authentication", () => {
  it("serves both real KOL list routes with the existing workbench cookie, including concurrent reads", async () => {
    const responses = await Promise.all(paths.flatMap(url => Array.from({ length: 3 }, () =>
      app.request(url, { headers: { Cookie: cookie } }),
    )));
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ total: 0, schema_version: "kol-api.v1" });
    }
    const state = await postgresPool().query(
      "SELECT identity_provider,password_hash FROM ticket_accounts WHERE id=$1", [userId],
    );
    expect(state.rows[0]).toMatchObject({ identity_provider: "workbench_session", password_hash: "workbench-session-only" });
    const sessions = await postgresPool().query("SELECT COUNT(*)::int AS n FROM ticket_auth_sessions");
    expect(sessions.rows[0].n).toBe(0);
  });

  it("does not bypass authentication for anonymous, expired, disabled or logged-out sessions", async () => {
    for (const url of paths) expect((await app.request(url)).status).toBe(401);
    getConn().prepare("UPDATE users SET active=0 WHERE id=?").run(userId);
    for (const url of paths) expect((await app.request(url, { headers: { Cookie: cookie } })).status).toBe(401);
    getConn().prepare("UPDATE users SET active=1 WHERE id=?").run(userId);
    getConn().prepare("UPDATE auth_sessions SET expires_at=? WHERE user_id=?").run("2000-01-01T00:00:00.000Z", userId);
    for (const url of paths) expect((await app.request(url, { headers: { Cookie: cookie } })).status).toBe(401);
    getConn().prepare("UPDATE auth_sessions SET expires_at=? WHERE user_id=?").run("2099-01-01T00:00:00.000Z", userId);
    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(logout.status).toBe(200);
    for (const url of paths) expect((await app.request(url, { headers: { Cookie: cookie } })).status).toBe(401);
  });
});
