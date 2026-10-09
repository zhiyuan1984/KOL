import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { clearTaskRegistryCache } from "../src/tasks/registry.js";
import { ensureRuntimeSchema, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { DEMO_ADMIN } from "../src/config.js";
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
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
}

async function loginPm() {
  const auth = await request("POST", "/api/login", { username: DEMO_ADMIN.name, password: "123456789" });
  expect(auth.status, JSON.stringify(auth.body)).toBe(200);
}

const R3_SKILL = {
  id: "r3_gate_probe",
  title: "R3 门禁探针",
  description: "R3 发布审批门禁测试",
  category: "管理",
  profile: "commander",
  output: "task_result",
  funnel: "reach",
  mcp: ["starrykol.dangerTool"],
  body: "# 探针\n\n测试用。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
};

const R1_SKILL = {
  id: "r1_gate_probe",
  title: "R1 门禁探针",
  description: "R1 无需审批测试",
  category: "管理",
  profile: "commander",
  output: "task_result",
  funnel: "reach",
  body: "# 探针\n\n测试用。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n",
};

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-skill-gate-"));
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

type ProbeSkill = typeof R3_SKILL | typeof R1_SKILL;

async function prepareSkill(skill: ProbeSkill, risk?: "L3") {
  const created = await request("POST", "/api/admin/skills", skill);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = skill.id;
  if (risk) {
    ensureRuntimeSchema();
    setToolPolicy("starrykol", "dangerTool", { enabled: true, risk, access: "write", schema_hash: "a".repeat(64) }, 0);
    setSkillConnector(id, "starrykol", true, 0);
    setSkillTool(id, "starrykol", "dangerTool", true, 0);
  }
  const owner = await request("PATCH", `/api/admin/skills/${id}/lifecycle`, { owner: "测试负责人" });
  expect(owner.status, JSON.stringify(owner.body)).toBe(200);
  // 加一个通过的测试，让发布前检查全绿（只差审批时）
  const t = await request("POST", `/api/admin/skills/${id}/tests`, { name: "冒烟", input: "{}", expected: "ok" });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const run = await request("POST", `/api/admin/skills/${id}/tests/run`, {
    results: [{ test_id: (t.body as Json).id, passed: true }],
  });
  expect(run.status, JSON.stringify(run.body)).toBe(200);
  for (const stage of ["editing", "testing"]) {
    const moved = await request("POST", `/api/admin/skills/${id}/stage`, { stage });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  }
  return id;
}

describe("skill publish gate (P0)", () => {
  it("R3 发布无审批单时 403 中文拦截；审批通过后放行，且一次审批只放行一次", async () => {
    await loginPm();
    const id = await prepareSkill(R3_SKILL, "L3");

    const check = await request("GET", `/api/admin/skills/${id}/publish-check`);
    expect(check.status, JSON.stringify(check.body)).toBe(200);
    expect(check.body.risk).toBe("L3");
    const approvalCheck = (check.body.checks as Json).approval as Json;
    expect(approvalCheck.required).toBe(true);
    expect(approvalCheck.status).toBe("none");
    expect(check.body.can_publish).toBe(false);
    expect(JSON.stringify((check.body as Json).reasons)).toContain("R3");

    const blocked = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.body)).toContain("R3");

    const appr = await request("POST", `/api/admin/skills/${id}/publish-approvals`, {});
    expect(appr.status, JSON.stringify(appr.body)).toBe(201);
    const approvalId = String((appr.body as Json).approval_id || "");
    expect(approvalId).toBeTruthy();

    // 待审批时仍拦
    const stillBlocked = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(stillBlocked.status).toBe(403);

    // CEO 在审批引擎里终审通过
    const detail = await request("GET", `/api/approvals/${approvalId}`);
    expect((detail.body as Json).kind).toBe("skill_publish");
    const version = Number((detail.body as Json).version || 0);
    const decided = await request("POST", `/api/approvals/${approvalId}/decide`, {
      decision: "approve",
      actor: "emp_zhang",
      expected_version: version,
      idempotency_key: `test-r3-${approvalId}`,
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect((decided.body as Json).status).toBe("consumed");

    const check2 = await request("GET", `/api/admin/skills/${id}/publish-check`);
    expect((check2.body as Json).can_publish).toBe(true);

    const published = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    // 同一审批不能复用：发布后 base_version 已推进，检查重新变红
    const check3 = await request("GET", `/api/admin/skills/${id}/publish-check`);
    expect((check3.body as Json).can_publish).toBe(false);
    expect(((check3.body as Json).checks as Json).approval).toMatchObject({ ok: false });
  });

  it("R1 技能无需审批直接发布", async () => {
    await loginPm();
    const id = await prepareSkill(R1_SKILL);
    const check = await request("GET", `/api/admin/skills/${id}/publish-check`);
    expect(check.body.risk).not.toBe("L3");
    expect(((check.body as Json).checks as Json).approval).toMatchObject({ required: false, ok: true });
    expect((check.body as Json).can_publish).toBe(true);
    // R1 发起审批应被拒绝
    const appr = await request("POST", `/api/admin/skills/${id}/publish-approvals`, {});
    expect(appr.status).toBe(400);
    const published = await request("POST", `/api/admin/skills/${id}/stage`, { stage: "published" });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
  });

  it("user_skill_grants 废止迁移清单接口", async () => {
    await loginPm();
    getConn().prepare("INSERT INTO users (id, username, name, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run("ghost-user", "ghost", "幽灵用户", "x", "2026-10-10T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    getConn()
      .prepare("INSERT INTO user_skill_grants (user_id, skill_id, created_at) VALUES (?,?,?)")
      .run("ghost-user", "kb-qa", "2026-10-10T00:00:00.000Z");
    const res = await request("GET", "/api/admin/skills/legacy-grants");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as Json).deprecated).toBe(true);
    expect((res.body as Json).count).toBe(1);
    const grants = (res.body as Json).grants as Json[];
    expect(grants[0]).toMatchObject({ user_id: "ghost-user", skill_id: "kb-qa" });
    expect(String((res.body as Json).notice || "")).toContain("退役");
  });
});
