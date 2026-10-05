import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_ADMIN } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { ensureStarryHomeLibrary, resetStarryHomeLibrarySync } from "../src/starrykol/library-sync.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let app: Hono;
let cookie = "";

async function call(method: string, url: string, body?: unknown, useCookie = cookie) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (useCookie) headers.Cookie = useCookie;
  const response = await app.request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: (text ? JSON.parse(text) : {}) as Json,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

beforeEach(async () => {
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "17".repeat(32);
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-identity-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.AUTH_MODE = "enabled";
  resetConn();
  resetStarryHomeLibrarySync();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  const setup = await call("POST", "/api/auth/setup", {
    name: DEMO_ADMIN.name,
    email: DEMO_ADMIN.email,
    username: DEMO_ADMIN.email,
    password: "123456789",
  }, "");
  expect(setup.status).toBe(201);
  cookie = setup.cookie;
  getConn().prepare("UPDATE users SET phone=? WHERE username=?").run("13800138000", DEMO_ADMIN.handle);
});

afterEach(() => {
  resetConn();
  resetStarryHomeLibrarySync();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
  process.env.CODEX_MODE = "stub";
});

describe("admin identity and Starry mailbox bind", () => {
  it(`lets ${DEMO_ADMIN.name} sign in with email or phone and stay admin`, async () => {
    for (const ident of [DEMO_ADMIN.email, "13800138000", DEMO_ADMIN.name, DEMO_ADMIN.handle, "+86 138-0013-8000"]) {
      const login = await call("POST", "/api/auth/login", { email: ident, password: "123456789" }, "");
      expect(login.status, ident).toBe(200);
      expect(login.cookie).toContain("lingong_session=");
      const status = await call("GET", "/api/auth/status", undefined, login.cookie);
      const user = status.json.user as Json;
      expect(user.roles).toEqual(["employee", "admin"]);
      expect(user.name).toBe(DEMO_ADMIN.name);
      expect(user.username).toBe(DEMO_ADMIN.handle);
      expect(user.email).toBe(DEMO_ADMIN.email);
    }
    getConn().prepare("UPDATE users SET email='' WHERE username=?").run(DEMO_ADMIN.handle);
    const withoutColumn = await call("POST", "/api/auth/login", {
      email: DEMO_ADMIN.email,
      password: "123456789",
    }, "");
    expect(withoutColumn.status).toBe(200);
    const rejected = await call("POST", "/api/auth/login", { username: "test", password: "123456789" }, "");
    expect(rejected.status).toBe(401);
    expect(rejected.json.detail).toMatch(/账号不存在|账号或密码不对/);
  });

  it("accepts the product-manager login aliases on /api/login", async () => {
    for (const ident of [DEMO_ADMIN.email, "13800138000", DEMO_ADMIN.name]) {
      const email = await call("POST", "/api/login", { username: ident, password: "123456789" }, "");
      expect(email.status, ident).toBe(200);
      expect(email.json).toMatchObject({ ok: true, handle: DEMO_ADMIN.handle, name: DEMO_ADMIN.name });
    }
  });

  it("keeps 鄢棽's name login as an alias to his own account after the handover", async () => {
    const { hashPassword } = await import("../src/auth.js");
    getConn().prepare(
      `INSERT INTO users (id,username,name,password_hash,roles,brands,active,email,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run("sriphy", "sriphy", "鄢棽", await hashPassword("123456789"), JSON.stringify(["employee", "admin"]), "[]", 1, "sriphy.yan@amperetime.com", "now", "now");
    for (const ident of ["鄢棽", "sriphy", "sriphy.yan@amperetime.com"]) {
      const login = await call("POST", "/api/auth/login", { email: ident, password: "123456789" }, "");
      expect(login.status, ident).toBe(200);
      const status = await call("GET", "/api/auth/status", undefined, login.cookie);
      const user = status.json.user as Json;
      expect(user.username).toBe("sriphy");
      expect(user.name).toBe("鄢棽");
    }
  });

  it("binds larry.zhao without echoing the JWT and scopes the home board", async () => {
    const unbound = await call("GET", "/api/home/board");
    expect(unbound.json.follow_scope).toMatchObject({ required: true, bound: false });
    expect(unbound.json.kols as Json[]).toEqual([]);

    const probe = await call("POST", "/api/me/starry-binding/probe", {});
    expect(probe.status).toBe(200);
    const boxes = probe.json.mailboxes as Json[];
    expect(boxes.some((row) => row.mailbox_email === "larry.zhao@amperetime.com" && row.owner_name === "赵良玉")).toBe(true);

    const bound = await call("POST", "/api/me/starry-binding", {
      mailbox_email: "larry.zhao@amperetime.com",
      bearer: "user-jwt-does-not-echo",
    });
    expect(bound.status).toBe(200);
    expect(bound.json).toMatchObject({
      bound: true,
      mailbox_email: "larry.zhao@amperetime.com",
      owner_name: "赵良玉",
      has_token: true,
    });
    expect(JSON.stringify(bound.json)).not.toContain("user-jwt-does-not-echo");

    const publicBind = await call("GET", "/api/me/starry-binding");
    expect(JSON.stringify(publicBind.json)).not.toContain("user-jwt-does-not-echo");
    const me = await call("GET", "/api/me");
    expect(me.json.starry_binding).toMatchObject({
      bound: true,
      mailbox_email: "larry.zhao@amperetime.com",
      owner_name: "赵良玉",
    });
    expect(JSON.stringify(me.json)).not.toContain("user-jwt-does-not-echo");

    await ensureStarryHomeLibrary();
    const board = await call("GET", "/api/home/board");
    const kols = board.json.kols as Json[];
    expect(board.json.follow_scope).toMatchObject({
      required: true,
      bound: true,
      mailbox_email: "larry.zhao@amperetime.com",
      owner_name: "赵良玉",
    });
    expect(kols.map((row) => row.handle)).toEqual(["营地灯测评娘"]);
    expect(kols[0].owner_name).toBe("赵良玉");
    expect(String(kols[0].current_stage)).toContain("初步接触");
    expect(kols.some((row) => row.handle === "户外电源达人")).toBe(false);

    const other = await call("POST", "/api/admin/users", {
      username: "zhong",
      name: "钟槿年",
      password: "employee-password",
      roles: ["employee"],
      brands: ["LT"],
    });
    expect(other.status).toBe(201);
    const otherLogin = await call("POST", "/api/auth/login", {
      username: "zhong",
      password: "employee-password",
    }, "");
    const otherBoard = await call("GET", "/api/home/board", undefined, otherLogin.cookie);
    expect(otherBoard.json.follow_scope).toMatchObject({ required: true, bound: false });
    expect(otherBoard.json.kols as Json[]).toEqual([]);
    expect(JSON.stringify(otherBoard.json)).not.toContain("user-jwt-does-not-echo");
  });

  it("binds a second mailbox without moving the default and unbinds by mailbox", async () => {
    const bound = await call("POST", "/api/me/starry-binding", {
      mailbox_email: "larry.zhao@amperetime.com",
      bearer: "user-jwt-does-not-echo",
    });
    expect(bound.status).toBe(200);
    const user = getConn().prepare("SELECT id FROM users WHERE username=?").get(DEMO_ADMIN.handle) as { id: string };
    saveStarryBinding(user.id, {
      mailbox_email: "second.mailbox@amperetime.com",
      owner_name: "赵良玉",
    });

    const pub = await call("GET", "/api/me/starry-binding");
    const bindings = pub.json.bindings as Json[];
    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toMatchObject({
      mailbox_email: "larry.zhao@amperetime.com",
      owner_name: "赵良玉",
      is_default: true,
    });
    expect(bindings[1]).toMatchObject({
      mailbox_email: "second.mailbox@amperetime.com",
      is_default: false,
    });

    const box = await call("GET", "/api/queries/mail.box");
    expect((box.json.bindings as Json[]).map((row) => row.mailbox))
      .toEqual(["larry.zhao@amperetime.com", "second.mailbox@amperetime.com"]);
    expect(typeof box.json.total_unread).toBe("number");

    const removed = await call("DELETE", "/api/me/starry-binding", {
      mailbox_email: "second.mailbox@amperetime.com",
    });
    expect(removed.status).toBe(200);
    const remaining = getConn().prepare("SELECT mailbox_email FROM user_starry_bindings").all() as Json[];
    expect(remaining).toEqual([{ mailbox_email: "larry.zhao@amperetime.com" }]);
  });
});
