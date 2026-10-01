/**
 * 公海问题模板：四个入口的提问正文住在管理端知识库，而不是前端写死。
 * 覆盖「可治理、可发布」——种子已发布可见；draft 不可见；审批后可见；隐藏后消失。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<Json>; text: () => Promise<string> }> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text: async () => text,
    json: async () => (text ? (JSON.parse(text) as Json) : {}),
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-q-"));
  process.env.LINGONG_DB = path.join(tmp, "q.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("public pool question templates", () => {
  it("seeds four published templates with a body for every slot", async () => {
    const rows = await (await request("GET", "/api/knowledge/question-templates")).json() as unknown as Json[];
    expect(rows.map((row) => row.slot).sort()).toEqual(["completeness", "potential", "risk", "score"]);
    for (const row of rows) {
      expect(String(row.body || "").trim().length).toBeGreaterThan(0);
      expect(String(row.knowledge_id || "")).toBeTruthy();
      expect(String(row.title || "")).toBeTruthy();
    }
    const potential = rows.find((row) => row.slot === "potential") as Json;
    expect(potential.knowledge_id).toBe("kb_q_pool_potential");
    expect(String(potential.body)).toContain("合作潜力");
  });

  it("keeps unpublished drafts out until an admin approves them", async () => {
    const created = await (await request("POST", "/api/admin/knowledge", {
      title: "公海 · 自定义评分模板",
      body: "请按自定义口径评分。",
      kind: "question_template",
      base_id: "kbase_legacy",
      tags: "pool-question:score",
      status: "draft",
    })).json();
    expect(created.kind).toBe("question_template");

    const before = await (await request("GET", "/api/knowledge/question-templates")).json() as unknown as Json[];
    expect(before.map((row) => row.knowledge_id)).not.toContain(created.id);

    const approved = await (await request("POST", `/api/admin/knowledge/${created.id}/approve`, {
      expected_version: created.current_version,
    })).json();
    expect(approved.status).toBe("published");

    const after = await (await request("GET", "/api/knowledge/question-templates")).json() as unknown as Json[];
    const scoreRows = after.filter((row) => row.slot === "score");
    expect(scoreRows.map((row) => row.knowledge_id)).toContain(created.id);
  });

  it("drops a template the employee hides, and skips rows without a known slot", async () => {
    await request("POST", "/api/knowledge/kb_q_pool_risk/deprecate", { reason: "内容过时" });
    const rows = await (await request("GET", "/api/knowledge/question-templates")).json() as unknown as Json[];
    expect(rows.map((row) => row.knowledge_id)).not.toContain("kb_q_pool_risk");

    const bogus = await (await request("POST", "/api/admin/knowledge", {
      title: "无槽位模板",
      body: "不应出现。",
      kind: "question_template",
      base_id: "kbase_legacy",
      tags: "pool-question:not-a-slot",
      status: "published",
    })).json();
    const again = await (await request("GET", "/api/knowledge/question-templates")).json() as unknown as Json[];
    expect(again.map((row) => row.knowledge_id)).not.toContain(bogus.id);
  });

  it("rejects an unknown kind so the four slots stay the only contract", async () => {
    const bad = await request("POST", "/api/admin/knowledge", {
      title: "x",
      body: "y",
      kind: "not_a_kind",
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("question_template");
  });
});
