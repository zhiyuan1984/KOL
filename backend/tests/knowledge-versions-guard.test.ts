import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { setPersona } from "../src/host/persona.js";
import { setKnowledgeGrants } from "../src/host/knowledge.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

let tmp: string;
let app: Hono;
let previousEnv: { AUTH_MODE?: string; CODEX_MODE?: string };

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
}

async function versions(id: string) {
  const response = await request("GET", `/api/knowledge/${id}/versions`);
  return { status: response.status, rows: (response.body as unknown as Json[]) || [], detail: response.body.detail };
}

async function createDraft(title: string): Promise<string> {
  const created = await request("POST", "/api/admin/knowledge", {
    title,
    body: "draft body",
    kind: "policy",
    base_id: "kbase_legacy",
    status: "draft",
  });
  expect(created.status).toBe(201);
  expect(created.body.status).toBe("draft");
  return String(created.body.id);
}

beforeEach(async () => {
  if (process.env.TEST_DATABASE_URL) await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-kb-versions-"));
  process.env.LINGONG_DB = path.join(tmp, "kb-versions.db");
  process.env.LINGONG_DATA = tmp;
  // 免登录演示口径（scripts/test.mjs 的 runner 默认值）：persona 切换与演示管理身份都依赖它。
  // 直接 `npx vitest run` 时环境带 AUTH_MODE=enabled，必须显式关掉，否则请求先被 401 拦下。
  previousEnv = { AUTH_MODE: process.env.AUTH_MODE, CODEX_MODE: process.env.CODEX_MODE };
  process.env.AUTH_MODE = "disabled";
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (previousEnv?.AUTH_MODE === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = previousEnv.AUTH_MODE;
  if (previousEnv?.CODEX_MODE === undefined) delete process.env.CODEX_MODE;
  else process.env.CODEX_MODE = previousEnv.CODEX_MODE;
});

describe("knowledge version history visibility", () => {
  it("hides a draft's version rows from employees but keeps them for the admin workspace", async () => {
    const draftId = await createDraft("草稿版本历史");

    setPersona("employee"); // lingong
    const denied = await versions(draftId);
    expect(denied.status).toBe(404);
    expect(String(denied.detail)).toBe("知识不存在或不可访问");

    // 管理侧身份与前端 admin workspace（EntryView / DetailRail）同一口径。
    setPersona("sriphy");
    const allowed = await versions(draftId);
    expect(allowed.status).toBe(200);
    expect(allowed.rows.map((row) => Number(row.version))).toEqual([1]);
    expect(String(allowed.rows[0].body)).toBe("draft body");
  });

  it("serves published and visible knowledge to employees", async () => {
    setPersona("employee");
    const visible = await versions("kb_addr");
    expect(visible.status).toBe(200);
    expect(visible.rows.length).toBeGreaterThan(0);
    expect(visible.rows.every((row) => String(row.knowledge_id) === "kb_addr")).toBe(true);
  });

  it("hides published rows narrowed away by grants and unknown ids", async () => {
    // 授权写入走 host 函数：`/api/admin/knowledge/:id/grants` 被 knowledge-publication 的
    // authorizeEntry 中间件包着，那一段读 PostgreSQL（本文件是 sqlite 口径）。
    setPersona("sriphy");
    setKnowledgeGrants("kb_addr", { team: ["team_kol"] });

    setPersona("employee"); // lingong: org_litime only
    expect((await versions("kb_addr")).status).toBe(404);
    expect((await versions("kb_missing")).status).toBe(404);

    setPersona("sriphy"); // jeffrey: org_litime + team_kol
    expect((await versions("kb_addr")).status).toBe(200);
  });
});
