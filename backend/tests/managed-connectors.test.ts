import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { authenticatedTestApp, seedPublishedAgent, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp = "";
let rawApp: Hono;
let app: Hono;
let cookie = "";
let environment: Record<string, string | undefined>;

const ACTOR_ID = "usr_runtime_fixture";
const ENVIRONMENT_KEYS = ["LINGONG_DB", "LINGONG_DATA", "DATABASE_URL", "CODEX_MODE", "AUTH_MODE", "NODE_ENV"] as const;

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await app.request(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

beforeEach(async () => {
  environment = Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  // A native clone already carries the complete, versioned schema and reference
  // catalog; do not recreate retired SQLite DDL or a compatibility bridge here.
  await freshTestDatabase({ reclaimPrevious: true });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-managed-connectors-"));
  Object.assign(process.env, {
    LINGONG_DB: path.join(tmp, "test.db"),
    LINGONG_DATA: tmp,
    CODEX_MODE: "stub",
    AUTH_MODE: "enabled",
    NODE_ENV: "test",
  });
  (await resetConn());
  const { createApp } = await import("../src/app.js");
  rawApp = (await createApp());
  // This fixture creates an authenticated local session, then uses the formal
  // organization sync and a published Agent binding. It does not bypass runtime
  // authorization or borrow an administrator identity from another tenant.
  await seedPublishedAgent("agent:kol", "本地目录资格验证 Agent");
  cookie = await seedRuntimeTestActor(["creator_library_query"], true);
  app = authenticatedTestApp(rawApp, cookie);
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("managed MCP connector catalog", () => {
  it("retains the native builtin and organization-managed catalog over a reconnect, with authenticated audit and builtin protection", async () => {
    // No credentials or MCP calls are needed to read governance data. A locally
    // authenticated, qualified current-organization actor remains required.
    const anonymous = await rawApp.fetch(new Request("http://localhost/api/admin/connectors"));
    expect(anonymous.status).toBe(401);
    expect(await pgVisibleSkillIdsForUser(ACTOR_ID, new Date().toISOString())).toContain("creator_library_query");

    const initial = await call("GET", "/api/admin/connectors");
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual([
      expect.objectContaining({ id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据", kind: "app", protocol: "mcp" }),
      expect.objectContaining({ id: "starrykol", label: "Starry KOL MCP", purpose: "红人库、负责人、品牌邮箱与合作往来事实", kind: "app", protocol: "mcp" }),
    ]);

    const created = await call("POST", "/api/admin/connectors", {
      id: "retained-catalog-fixture",
      label: "Retained catalog fixture",
      purpose: "仅用于本地原生目录持久性验证",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: "retained-catalog-fixture", label: "Retained catalog fixture", status: "draft", enabled: false, kind: "custom_mcp", protocol: "mcp",
    });

    // Closing the native pool must not erase a valid organization-managed row.
    // The next application instance reads the same isolated PostgreSQL authority.
    await resetConn();
    const { createApp } = await import("../src/app.js");
    rawApp = (await createApp());
    app = authenticatedTestApp(rawApp, cookie);
    const reopened = await call("GET", "/api/admin/connectors");
    expect(reopened.status).toBe(200);
    expect(reopened.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "claw", label: "MediaCrawler MCP" }),
      expect.objectContaining({ id: "starrykol", label: "Starry KOL MCP" }),
      expect.objectContaining({ id: "retained-catalog-fixture", label: "Retained catalog fixture", purpose: "仅用于本地原生目录持久性验证", status: "draft", enabled: false }),
    ]));

    const builtinDelete = await call("DELETE", "/api/admin/connectors/starrykol");
    expect(builtinDelete.status).toBe(405);
    expect(builtinDelete.body).toMatchObject({ detail: { code: "builtin_managed_connector_cannot_delete" } });
    expect((await getConn().query("SELECT id FROM connectors WHERE id=$1", ["starrykol"])).rows).toEqual([{ id: "starrykol" }]);

    // Persisted audit is checked from the authority store, rather than a response
    // echo, and contains the local actor plus only the non-secret catalog fields.
    const audit = (await getConn().query<{ actor: string; payload: string }>(
      "SELECT actor,payload FROM audit_events WHERE event_type='admin.connector.create' AND actor=$1 ORDER BY id DESC LIMIT 1",
      [ACTOR_ID],
    )).rows[0];
    expect(audit).toMatchObject({ actor: ACTOR_ID, payload: expect.stringContaining("retained-catalog-fixture") });
    expect(String(audit?.payload || "")).not.toMatch(/secret|bearer|password/i);
  });
});
