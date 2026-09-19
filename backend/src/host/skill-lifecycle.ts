/**
 * Skill lifecycle: stage transitions, version snapshots, test cases/runs,
 * and usage metrics aggregation for the admin lifecycle workbench.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, publishedSkillsDir } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { HttpFail } from "./errors.js";
import { currentUser } from "./persona.js";
import { activateSkillForHarness, deletePublishedSkill } from "./skill-publish.js";
import { catalogSkill, isBundledSkill } from "./skill-sop.js";

export const SKILL_STAGES = ["draft", "editing", "testing", "published", "disabled"] as const;
export type SkillStage = (typeof SKILL_STAGES)[number];

export const SKILL_STAGE_LABELS: Record<SkillStage, string> = {
  draft: "新建草稿",
  editing: "编辑配置",
  testing: "测试验证",
  published: "发布上线",
  disabled: "已停用",
};

/** Happy path is adjacent forward; humans may fall back one step with a reason. */
const ALLOWED_TRANSITIONS: Record<SkillStage, SkillStage[]> = {
  draft: ["editing"],
  editing: ["testing", "draft"],
  testing: ["published", "editing"],
  published: ["disabled", "testing"],
  disabled: ["testing"],
};

function skillDir(id: string): string {
  return path.join(publishedSkillsDir(), id);
}

function versionsRoot(id: string): string {
  const root = path.join(dataDir(), "skill-versions", id);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function requireSkill(id: string): void {
  if (!catalogSkill(id)) throw new HttpFail(404, "unknown skill");
}

function lifecycleRow(id: string): { skill_id: string; stage: string; owner: string | null; business_stage: string | null; tags: string | null; updated_at: string } | undefined {
  return getConn().prepare("SELECT * FROM skill_lifecycle WHERE skill_id = ?").get(id) as
    | { skill_id: string; stage: string; owner: string | null; business_stage: string | null; tags: string | null; updated_at: string }
    | undefined;
}

function currentStage(id: string): SkillStage {
  const row = lifecycleRow(id);
  const stage = (row?.stage || "draft") as SkillStage;
  return SKILL_STAGES.includes(stage) ? stage : "draft";
}

export function skillLifecycleMeta(id: string): {
  stage: SkillStage;
  stage_label: string;
  owner: string | null;
  business_stage: string | null;
  tags: string[];
  current_version: number | null;
  test_summary: { total: number; pass_rate: number | null; failing: number; last_run_at: string | null };
} {
  requireSkill(id);
  const stage = currentStage(id);
  const row = lifecycleRow(id);
  const conn = getConn();
  const version = conn
    .prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ? AND status = 'published'")
    .get(id) as { v: number | null };
  const tests = conn.prepare("SELECT COUNT(*) AS n FROM skill_tests WHERE skill_id = ?").get(id) as { n: number };
  const lastRuns = conn
    .prepare(
      "SELECT passed, ran_at FROM skill_test_runs WHERE skill_id = ? AND id IN (SELECT MAX(id) FROM skill_test_runs WHERE skill_id = ? GROUP BY test_id)",
    )
    .all(id, id) as { passed: number; ran_at: string }[];
  const lastRunAt = (
    conn.prepare("SELECT MAX(ran_at) AS t FROM skill_test_runs WHERE skill_id = ?").get(id) as { t: string | null }
  ).t;
  const failing = lastRuns.filter((r) => !r.passed).length;
  return {
    stage,
    stage_label: SKILL_STAGE_LABELS[stage],
    owner: row?.owner || null,
    business_stage: row?.business_stage || null,
    tags: row?.tags ? (JSON.parse(row.tags) as string[]) : [],
    current_version: version.v ?? null,
    test_summary: {
      total: tests.n,
      pass_rate: lastRuns.length ? Math.round(((lastRuns.length - failing) / lastRuns.length) * 1000) / 10 : null,
      failing,
      last_run_at: lastRunAt,
    },
  };
}

export function skillStageHistory(id: string): Json[] {
  return getConn()
    .prepare("SELECT * FROM skill_stage_history WHERE skill_id = ? ORDER BY at DESC")
    .all(id) as Json[];
}

export function transitionSkillStage(id: string, toStage: string, reason?: string): { stage: SkillStage } {
  requireSkill(id);
  const to = toStage as SkillStage;
  if (!SKILL_STAGES.includes(to)) throw new HttpFail(400, `unknown stage ${toStage}`);
  const from = currentStage(id);
  if (from === to) return { stage: from };
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new HttpFail(400, `cannot move from ${from} to ${to}`);
  }
  if (from !== "draft" && to === "disabled" && !String(reason || "").trim()) {
    throw new HttpFail(400, "reason required to disable a published skill");
  }
  const conn = getConn();
  const operator = currentUser().handle;
  conn
    .prepare(
      "INSERT INTO skill_stage_history (id, skill_id, from_stage, to_stage, operator, reason, at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(nid("ssh"), id, from, to, operator, reason || null, nowIso());
  conn
    .prepare(
      "INSERT INTO skill_lifecycle (skill_id, stage, updated_at) VALUES (?,?,?) ON CONFLICT(skill_id) DO UPDATE SET stage=excluded.stage, updated_at=excluded.updated_at",
    )
    .run(id, to, nowIso());
  if (to === "published") {
    publishSkillVersion(id, reason);
  }
  audit(operator, "skill.stage", { skill: id, from, to, reason: reason || null });
  return { stage: to };
}

export function updateSkillLifecycleMeta(
  id: string,
  patch: { owner?: string; business_stage?: string; tags?: string[] },
): void {
  requireSkill(id);
  const row = lifecycleRow(id);
  const stage = row?.stage || "draft";
  getConn()
    .prepare(
      "INSERT INTO skill_lifecycle (skill_id, stage, owner, business_stage, tags, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET owner=excluded.owner, business_stage=excluded.business_stage, tags=excluded.tags, updated_at=excluded.updated_at",
    )
    .run(
      id,
      stage,
      patch.owner ?? row?.owner ?? null,
      patch.business_stage ?? row?.business_stage ?? null,
      JSON.stringify(patch.tags ?? (row?.tags ? JSON.parse(row.tags) : [])),
      nowIso(),
    );
}

// ---------------------------------------------------------------- versions

export function listSkillVersions(id: string): Json[] {
  requireSkill(id);
  return getConn()
    .prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC")
    .all(id) as Json[];
}

export function publishSkillVersion(id: string, description?: string, version?: number): { version: number } {
  requireSkill(id);
  if (isBundledSkill(id)) throw new HttpFail(400, "bundled skills cannot be versioned");
  const dir = skillDir(id);
  if (!fs.existsSync(path.join(dir, "SKILL.md"))) throw new HttpFail(400, "skill pack not found");
  const conn = getConn();
  const maxRow = conn.prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?").get(id) as {
    v: number | null;
  };
  const next = version ?? (maxRow.v || 0) + 1;
  const snapshot = path.join(versionsRoot(id), `v${next}`);
  fs.rmSync(snapshot, { recursive: true, force: true });
  fs.cpSync(dir, snapshot, { recursive: true });
  conn
    .prepare(
      "INSERT INTO skill_versions (id, skill_id, version, status, description, snapshot_path, published_by, published_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(skill_id, version) DO UPDATE SET status='published', description=excluded.description, snapshot_path=excluded.snapshot_path, published_by=excluded.published_by, published_at=excluded.published_at",
    )
    .run(
      nid("sv"),
      id,
      next,
      "published",
      description || null,
      snapshot,
      currentUser().handle,
      nowIso(),
    );
  audit(currentUser().handle, "skill.version.publish", { skill: id, version: next });
  return { version: next };
}

export function rollbackSkillVersion(id: string, version: number): { version: number } {
  requireSkill(id);
  const row = getConn()
    .prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?")
    .get(id, version) as { snapshot_path: string } | undefined;
  if (!row || !row.snapshot_path || !fs.existsSync(path.join(row.snapshot_path, "SKILL.md"))) {
    throw new HttpFail(404, `version ${version} snapshot not found`);
  }
  const dir = skillDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(row.snapshot_path, dir, { recursive: true });
  activateSkillForHarness(id);
  audit(currentUser().handle, "skill.version.rollback", { skill: id, version });
  return { version };
}

export function deleteSkillVersionSnapshots(id: string): void {
  fs.rmSync(path.join(dataDir(), "skill-versions", id), { recursive: true, force: true });
}

// ---------------------------------------------------------------- tests

export type SkillTestInput = { name?: string; input?: string; expected?: string };

export function listSkillTests(id: string): Json[] {
  requireSkill(id);
  return getConn()
    .prepare("SELECT * FROM skill_tests WHERE skill_id = ? ORDER BY created_at DESC")
    .all(id) as Json[];
}

export function createSkillTest(id: string, input: SkillTestInput): Json {
  requireSkill(id);
  const name = String(input.name || "").trim();
  if (!name) throw new HttpFail(400, "test name required");
  const row = {
    id: nid("st"),
    skill_id: id,
    name,
    input: String(input.input || ""),
    expected: String(input.expected || ""),
    created_by: currentUser().handle,
    created_at: nowIso(),
  };
  getConn()
    .prepare("INSERT INTO skill_tests (id, skill_id, name, input, expected, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(row.id, row.skill_id, row.name, row.input, row.expected, row.created_by, row.created_at);
  return row as unknown as Json;
}

export function deleteSkillTest(id: string, testId: string): { ok: true } {
  requireSkill(id);
  getConn().prepare("DELETE FROM skill_tests WHERE id = ? AND skill_id = ?").run(testId, id);
  getConn().prepare("DELETE FROM skill_test_runs WHERE test_id = ?").run(testId);
  return { ok: true };
}

/**
 * Record a test run. v1 records the operator's verdict per case; wiring the
 * agent runtime for automatic grading is a follow-up.
 */
export function recordSkillTestRun(
  id: string,
  results: { test_id: string; passed: boolean; fail_reason?: string; duration_ms?: number }[],
  version?: number,
): { total: number; passed: number; failed: number } {
  requireSkill(id);
  const conn = getConn();
  const operator = currentUser().handle;
  const tx = conn.transaction(() => {
    for (const r of results) {
      const test = conn.prepare("SELECT name FROM skill_tests WHERE id = ? AND skill_id = ?").get(r.test_id, id) as
        | { name: string }
        | undefined;
      if (!test) throw new HttpFail(404, `unknown test ${r.test_id}`);
      conn
        .prepare(
          "INSERT INTO skill_test_runs (id, skill_id, test_id, test_name, version, passed, fail_reason, ran_by, ran_at, duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          nid("str"),
          id,
          r.test_id,
          test.name,
          version ?? null,
          r.passed ? 1 : 0,
          r.passed ? null : String(r.fail_reason || "未通过"),
          operator,
          nowIso(),
          r.duration_ms ?? null,
        );
    }
  });
  tx();
  audit(operator, "skill.test.run", { skill: id, total: results.length });
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, failed: results.length - passed };
}

export function listSkillTestRuns(id: string, limit = 50): Json[] {
  requireSkill(id);
  return getConn()
    .prepare("SELECT * FROM skill_test_runs WHERE skill_id = ? ORDER BY ran_at DESC LIMIT ?")
    .all(id, limit) as Json[];
}

// ---------------------------------------------------------------- metrics

export function skillMetrics(id: string, days = 7): Json {
  requireSkill(id);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const conn = getConn();
  const totals = conn
    .prepare(
      "SELECT COUNT(*) AS calls, SUM(CASE WHEN status IN ('completed','approved','done','succeeded') THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) AS failed FROM work_items WHERE skill = ? AND created_at >= ?",
    )
    .get(id, since) as { calls: number; ok: number | null; failed: number | null };
  const calls = totals.calls || 0;
  const ok = totals.ok || 0;
  const daily = conn
    .prepare(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM work_items WHERE skill = ? AND created_at >= ? GROUP BY day ORDER BY day",
    )
    .all(id, since) as { day: string; n: number }[];
  const durations = conn
    .prepare(
      "SELECT AVG((julianday(r.completed_at) - julianday(r.created_at)) * 86400000) AS avg_ms FROM task_runs r JOIN work_items w ON w.id = r.work_item_id WHERE w.skill = ? AND r.created_at >= ? AND r.completed_at IS NOT NULL",
    )
    .get(id, since) as { avg_ms: number | null };
  const alerts = conn
    .prepare(
      "SELECT COUNT(*) AS n FROM work_items WHERE skill = ? AND created_at >= ? AND status IN ('failed','error','blocked')",
    )
    .get(id, since) as { n: number };
  return {
    days,
    calls,
    success_rate: calls ? Math.round((ok / calls) * 1000) / 10 : null,
    avg_duration_ms: durations.avg_ms ? Math.round(durations.avg_ms) : null,
    alerts: alerts.n,
    trend: daily,
  };
}

