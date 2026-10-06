import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { clearTaskRegistryCache, taskDefinition } from "../src/tasks/registry.js";
import { ensureRuntimeSchema, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { dataDir, DEMO_ADMIN } from "../src/config.js";
import { freshTestDatabase } from "./support/pg.js";

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
  const auth = await request("POST", "/api/login", { username: DEMO_ADMIN.name, password: "123456789" });
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
  await freshTestDatabase();
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

  it("reports a live bundled skill without snapshots as the bundled baseline, not unpublished", async () => {
    await loginPm();
    ensureRuntimeSchema();
    const list = await request("GET", "/api/admin/skills");
    expect(list.status).toBe(200);
    const lifecycle = (list.body.skills as Json[]).find((s) => s.id === "creator_library_all")?.lifecycle as Json;
    expect(lifecycle.stage).toBe("published");
    expect(lifecycle.current_version).toBeNull();
    expect(lifecycle.release).toEqual({ kind: "bundled_baseline" });

    const created = await request("POST", "/api/admin/skills", NEW_SKILL);
    expect((created.body.lifecycle as Json).release).toEqual({ kind: "none" });
  });

  it("bundled skills take presentation overrides through draft → publish, never runtime contract fields", async () => {
    await loginPm();
    ensureRuntimeSchema();
    const id = "creator_library_all";
    const before = taskDefinition(id)!;
    expect(before.icon).toBe("database");
    expect(before.badge).toBe("达人库");
    expect((await request("PUT", `/api/admin/skills/${id}/draft`, { icon: "Not A Key" })).status).toBe(400);
    expect((await request("PUT", `/api/admin/skills/${id}/draft`, { mcp: ["starrykol.pageKolProfiles"] })).status).toBe(400);
    const saved = await request("PUT", `/api/admin/skills/${id}/draft`, { icon: "search", badge: "红人库", aliases: ["全部红人"] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(taskDefinition(id)!.icon).toBe("database");
    expect((await request("POST", `/api/admin/skills/${id}/stage`, { stage: "testing", reason: "改展示" })).status).toBe(200);
    const published = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published", reason: "发布展示" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const after = taskDefinition(id)!;
    expect(after).toMatchObject({ icon: "search", badge: "红人库", aliases: ["全部红人"] });
    expect(after.mcp).toEqual(before.mcp);
    const list = await request("GET", "/api/admin/skills");
    expect((list.body.skills as Json[]).find((s) => s.id === id)).toMatchObject({ icon: "search", badge: "红人库" });
  });

  it("declared tools are checked against the registered catalog at testing/publish time, not a code allowlist", async () => {
    await loginPm();
    ensureRuntimeSchema();
    const id = "catalog_probe";
    const created = await request("POST", "/api/admin/skills", { ...NEW_SKILL, id, mcp: ["starrykol.brandNewRemoteTool"] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((created.body.lifecycle as Json).dependencies).toEqual({
      unregistered: ["starrykol.brandNewRemoteTool"],
      unmounted: ["starrykol.brandNewRemoteTool"],
    });
    const previousMode = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "real";
    try {
      expect((await request("POST", `/api/admin/skills/${id}/stage`, { stage: "editing" })).status).toBe(200);
      const unregistered = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "testing" });
      expect(unregistered.status).toBe(409);
      expect(JSON.stringify(unregistered.body)).toContain("skill_tools_unregistered");

      setToolPolicy("starrykol", "brandNewRemoteTool", { enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64) }, 0);
      const unmounted = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "testing" });
      expect(unmounted.status).toBe(409);
      expect(JSON.stringify(unmounted.body)).toContain("skill_tools_unmounted");

      setSkillConnector(id, "starrykol", true, 0);
      setSkillTool(id, "starrykol", "brandNewRemoteTool", true, 0);
      const ready = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "testing" });
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    } finally {
      process.env.CODEX_MODE = previousMode;
    }
  });
});
