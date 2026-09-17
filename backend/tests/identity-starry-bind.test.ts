import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_ADMIN } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { ensureStarryHomeLibrary, resetStarryHomeLibrarySync } from "../src/starrykol/library-sync.js";
import type { Json } from "../src/types.js";

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
    name: "鄢棽",
    email: DEMO_ADMIN.email,
    username: "sriphy.yan@amperetime.com",
    password: "123456789",
  }, "");
  expect(setup.status).toBe(201);
  cookie = setup.cookie;
  getConn().prepare("UPDATE users SET phone=? WHERE username=?").run("13800138000", "sriphy");
});

afterEach(() => {
  resetConn();
  resetStarryHomeLibrarySync();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  process.env.CODEX_MODE = "stub";
});

describe("admin identity and Starry mailbox bind", () => {
  it("lets 鄢棽 sign in with email or phone and stay admin", async () => {
    for (const ident of [DEMO_ADMIN.email, "13800138000", "鄢棽", "sriphy", "+86 138-0013-8000"]) {
      const login = await call("POST", "/api/auth/login", { email: ident, password: "123456789" }, "");
      expect(login.status, ident).toBe(200);
      expect(login.cookie).toContain("lingong_session=");
      const status = await call("GET", "/api/auth/status", undefined, login.cookie);
      const user = status.json.user as Json;
      expect(user.roles).toEqual(["employee", "admin"]);
      expect(user.name).toBe("鄢棽");
      expect(user.username).toBe("sriphy");
      expect(user.email).toBe(DEMO_ADMIN.email);
    }
    getConn().prepare("UPDATE users SET email='' WHERE username=?").run("sriphy");
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
    for (const ident of [DEMO_ADMIN.email, "13800138000", "鄢棽"]) {
      const email = await call("POST", "/api/login", { username: ident, password: "123456789" }, "");
      expect(email.status, ident).toBe(200);
      expect(email.json).toMatchObject({ ok: true, handle: "sriphy", name: "鄢棽" });
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
});
