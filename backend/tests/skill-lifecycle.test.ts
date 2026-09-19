import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { clearTaskRegistryCache } from "../src/tasks/registry.js";
import { dataDir } from "../src/config.js";

type Json = Record<string, unknown>;

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

async function loginPm() {
  const auth = await request("POST", "/api/login", { username: "鄢棽", password: "123456789" });
  expect(auth.status, JSON.stringify(auth.body)).toBe(200);
}

const NEW_SKILL = {
  id: "lifecycle_probe",
  title: "生命周期探针",
  description: "用于生命周期流转测试",
  category: "管理",
  profile: "commander",
  output: "task_result",
  funnel: "reach",
  body: "# 探针\n\n测试用。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skill-life-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  clearTaskRegistryCache();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("skill lifecycle", () => {
  it("walks stages, snapshots versions, rolls back, and records tests", async () => {
    await loginPm();
    const created = await request("POST", "/api/admin/skills", NEW_SKILL);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = "lifecycle_probe";

    const blocked = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(blocked.status).toBe(400);

    const list = await request("GET", "/api/admin/skills");
    expect(list.status).toBe(200);
    const entry = (list.body.skills as Json[]).find((s) => s.id === id);
    expect((entry?.lifecycle as Json).stage).toBe("draft");

    for (const stage of ["editing", "testing"]) {
      const moved = await request("POST", `/api/admin/skills/${id}/stage`, { stage });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(moved.body.stage).toBe(stage);
    }

    const published = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const versions = await request("GET", `/api/admin/skills/${id}/versions`);
    expect(versions.body.versions).toEqual([expect.objectContaining({ version: 1, status: "published" })]);
    expect(fs.existsSync(path.join(dataDir(), "skill-versions", id, "v1", "SKILL.md"))).toBe(true);

    const rewritten = await request("PATCH", `/api/admin/skills/${id}`, {
      body: "# 探针\n\n第二版内容。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
    });
    expect(rewritten.status, JSON.stringify(rewritten.body)).toBe(200);

    const history = await request("GET", `/api/admin/skills/${id}/stage-history`);
    expect((history.body.history as Json[]).map((h) => h.to_stage)).toEqual([
      "published",
      "testing",
      "editing",
      "draft",
    ]);

    const tests = await request("POST", `/api/admin/skills/${id}/tests`, { name: "海外达人场景", input: "生成话术" });
    expect(tests.status).toBe(201);
    const testId = String(tests.body.id);
    await request("POST", `/api/admin/skills/${id}/tests`, { name: "敏感词过滤", input: "过滤" });

    const run = await request("POST", `/api/admin/skills/${id}/tests/run`, {
      results: [
        { test_id: testId, passed: true },
        { test_id: "missing", passed: false },
      ],
    });
    expect(run.status).toBe(404);

    const testsAfter = await request("GET", `/api/admin/skills/${id}/tests`);
    const allIds = (testsAfter.body.tests as Json[]).map((t) => String(t.id));
    const recorded = await request("POST", `/api/admin/skills/${id}/tests/run`, {
      results: [
        { test_id: allIds[0], passed: true },
        { test_id: allIds[1], passed: false, fail_reason: "敏感词未过滤" },
      ],
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body).toEqual(expect.objectContaining({ total: 2, passed: 1, failed: 1 }));

    const metrics = await request("GET", `/api/admin/skills/${id}/metrics?days=7`);
    expect(metrics.status).toBe(200);
    expect(metrics.body).toHaveProperty("calls");
    expect(metrics.body).toHaveProperty("trend");

    const noReason = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "disabled" });
    expect(noReason.status).toBe(400);
    const disabled = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "disabled", reason: "下线观察" });
    expect(disabled.status).toBe(200);

    const invalidVersion = await request("POST", `/api/admin/skills/${id}/versions/rollback`, { version: 99 });
    expect(invalidVersion.status).toBe(404);
    const rollback = await request("POST", `/api/admin/skills/${id}/versions/rollback`, { version: 1 });
    expect(rollback.status, JSON.stringify(rollback.body)).toBe(200);
    const runtimeBody = fs.readFileSync(path.join(dataDir(), "published-skills", id, "SKILL.md"), "utf8");
    expect(runtimeBody).toContain("测试用");
  });
});
