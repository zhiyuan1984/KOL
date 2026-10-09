/**
 * Skill lifecycle: stage transitions, version snapshots, test cases/runs,
 * and usage metrics aggregation for the admin lifecycle workbench.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, publishedSkillsDir, codexMode } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { nid } from "../ids.js";
import { skillToolProfile, unmountedDeclaredTools, unregisteredDeclaredTools } from "../runtime/skill-coverage.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import { HttpFail } from "./errors.js";
import { currentUser } from "./persona.js";
import { activateSkillForHarness, applySkillDraft, deletePublishedSkill, getSkillDraft } from "./skill-publish.js";
import { catalogSkill, isBundledSkill, overlayRow, packagedSkillDir } from "./skill-sop.js";

export const SKILL_STAGES = ["draft", "editing", "testing", "published", "disabled"] as const;
export type SkillStage = (typeof SKILL_STAGES)[number];
export type SkillOrigin = "official" | "third_party";
/**
 * What employees run today. A bundled skill that is live but has never been
 * snapshotted runs its packaged SKILL.md; that is a real release, not "unpublished".
 */
export type SkillRelease =
  | { kind: "versioned"; version: number }
  | { kind: "bundled_baseline" }
  | { kind: "none" };

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

function lifecycleRow(id: string): { skill_id: string; stage: string; origin: SkillOrigin | null; owner: string | null; business_stage: string | null; tags: string | null; biz_family: string | null; biz_domain: string | null; updated_at: string } | undefined {
  return getConn().prepare("SELECT * FROM skill_lifecycle WHERE skill_id = ?").get(id) as
    | { skill_id: string; stage: string; origin: SkillOrigin | null; owner: string | null; business_stage: string | null; tags: string | null; biz_family: string | null; biz_domain: string | null; updated_at: string }
    | undefined;
}

function currentStage(id: string): SkillStage {
  const row = lifecycleRow(id);
  const stage = (row?.stage || "draft") as SkillStage;
  return SKILL_STAGES.includes(stage) ? stage : "draft";
}

/** 待发布的「所需工具」：有草稿改动时以草稿为准（发布会应用草稿），否则取现行技能声明。 */
function pendingDeclaredTools(id: string): string[] {
  const drafted = getSkillDraft(id).patch.mcp;
  if (Array.isArray(drafted)) return drafted.map(String);
  if (typeof drafted === "string") return drafted.split(/[,，]/).map((tool) => tool.trim()).filter(Boolean);
  return [...(taskDefinition(id)?.mcp || [])];
}

/**
 * 技能风险等级：读取时从声明工具的风险策略派生（取最高），不另存列，
 * 保证「工具风险变了，技能风险自动跟着变」的单一事实源。
 */
export function skillRiskLevel(id: string): "L1" | "L2" | "L3" | null {
  return skillToolProfile(id, pendingDeclaredTools(id)).risk;
}

export function skillDependencyIssues(id: string): { unregistered: string[]; unmounted: string[] } {
  const tools = pendingDeclaredTools(id);
  return {
    unregistered: unregisteredDeclaredTools(tools).map((tool) => tool.declared_as),
    unmounted: unmountedDeclaredTools(id, tools).map((tool) => tool.declared_as),
  };
}

/**
 * 进入测试或发布前：所需工具必须已登记并已挂载，宁可拦住不放行。
 * stub 模式不走挂载链（执行由本地桩完成），因此只在真实执行模式下拦截。
 */
function assertDeclaredToolsReady(id: string): void {
  if (codexMode() === "stub") return;
  const issues = skillDependencyIssues(id);
  if (issues.unregistered.length) {
    throw new HttpFail(409, {
      code: "skill_tools_unregistered",
      message: `所需工具尚未登记：${issues.unregistered.join("、")}。请先在连接器里发现工具并确定风险档。`,
      tools: issues.unregistered,
    });
  }
  if (issues.unmounted.length) {
    throw new HttpFail(409, {
      code: "skill_tools_unmounted",
      message: `所需工具尚未挂载到本技能：${issues.unmounted.join("、")}。请在「工具与知识」里挂载后再继续。`,
      tools: issues.unmounted,
    });
  }
}

export function skillLifecycleMeta(id: string): {
  stage: SkillStage;
  stage_label: string;
  origin: SkillOrigin;
  owner: string | null;
  business_stage: string | null;
  tags: string[];
  /** 业务族 / 业务域：复用知识侧字典，治理与复用盘点用。 */
  biz_family: string | null;
  biz_domain: string | null;
  /** 风险等级：读取时从工具风险派生（L1/L2/L3），不存储。 */
  risk: "L1" | "L2" | "L3" | null;
  current_version: number | null;
  release: SkillRelease;
  /** 读取时派生：所需工具里未登记 / 未挂载的项（编写时提示，进入测试或发布时拦截）。 */
  dependencies: { unregistered: string[]; unmounted: string[] };
  test_summary: { total: number; pass_rate: number | null; failing: number; last_run_at: string | null };
} {
  requireSkill(id);
  const stage = currentStage(id);
  const row = lifecycleRow(id);
  const tags = row?.tags ? (JSON.parse(row.tags) as string[]) : [];
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
    origin: row?.origin || (tags.includes("第三方") ? "third_party" : "official"),
    owner: row?.owner || null,
    business_stage: row?.business_stage || null,
    tags,
    biz_family: row?.biz_family || null,
    biz_domain: row?.biz_domain || null,
    risk: skillRiskLevel(id),
    current_version: version.v ?? null,
    release: version.v
      ? { kind: "versioned", version: version.v }
      : stage === "published" && isBundledSkill(id)
        ? { kind: "bundled_baseline" }
        : { kind: "none" },
    dependencies: skillDependencyIssues(id),
    test_summary: {
      total: tests.n,
      pass_rate: lastRuns.length ? Math.round(((lastRuns.length - failing) / lastRuns.length) * 1000) / 10 : null,
      failing,
      last_run_at: lastRunAt,
    },
  };
}

export function setSkillOrigin(id: string, origin: SkillOrigin): void {
  requireSkill(id);
  const row = lifecycleRow(id);
  const previous = row?.origin || (row?.tags?.includes("第三方") ? "third_party" : "official");
  if (previous === origin) return;
  const operator = currentUser().handle;
  getConn().prepare(
    `INSERT INTO skill_lifecycle (skill_id, stage, origin, owner, business_stage, tags, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(skill_id) DO UPDATE SET origin=excluded.origin, updated_at=excluded.updated_at`,
  ).run(id, row?.stage || "draft", origin, row?.owner || null, row?.business_stage || null, row?.tags || "[]", nowIso());
  audit(operator, "skill.origin.change", { skill: id, from: previous, to: origin });
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
  if (to === "testing" || to === "published") assertDeclaredToolsReady(id);
  if (to === "published") assertSkillPublishAllowed(id);
  if (to === "published") applySkillDraft(id);
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

function currentPublishedVersion(id: string): number {
  const row = getConn()
    .prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ? AND status = 'published'")
    .get(id) as { v: number | null };
  return row.v || 0;
}

export type SkillPublishApprovalSummary = {
  approval_id: string;
  status: string;
  base_version: number;
} | null;

/** 审批引擎终态中文（consumed=链走完通过）。 */
export function approvalStatusLabel(status: string): string {
  return { pending: "待审批", consumed: "已通过", rejected: "已驳回" }[status] || status;
}

/** 该技能最新一条技能发布审批（走统一审批引擎，kind=skill_publish，CEO 终审链）。 */
export function latestSkillPublishApproval(id: string): SkillPublishApprovalSummary {
  const rows = getConn()
    .prepare("SELECT id, status, payload FROM approvals WHERE kind = 'skill_publish' ORDER BY created_at DESC")
    .all() as { id: string; status: string; payload: string | null }[];
  for (const row of rows) {
    let payload: { skill_id?: string; base_version?: number } = {};
    try {
      payload = JSON.parse(row.payload || "{}") as { skill_id?: string; base_version?: number };
    } catch {
      /* 审批 payload 解析失败就跳过，不拦发布检查 */
    }
    if (payload.skill_id === id) {
      return { approval_id: row.id, status: row.status, base_version: Number(payload.base_version || 0) };
    }
  }
  return null;
}

/**
 * 发布门禁（P0）：
 * 1. 负责人必填；
 * 2. R3（L3）技能发布必须持有「已通过」的技能发布审批（审批引擎终态 consumed），
 *    且该审批的 base_version 必须等于当前已发布版本（一次审批只放行一次发布，发布后即失效）。
 * 未通过时抛 403/400 中文原因，前端直接展示。
 */
export function assertSkillPublishAllowed(id: string): void {
  requireSkill(id);
  const row = lifecycleRow(id);
  if (!row?.owner || !row.owner.trim()) {
    throw new HttpFail(400, { code: "skill_owner_required", message: "请先设置技能负责人，再发布。" });
  }
  if (skillRiskLevel(id) !== "L3") return;
  const base = currentPublishedVersion(id);
  const approval = latestSkillPublishApproval(id);
  if (approval && approval.status === "consumed" && approval.base_version === base) return;
  throw new HttpFail(403, {
    code: "skill_publish_approval_required",
    message: "该技能为 R3 高风险技能，发布前必须先发起发布审批并获得通过（CEO 终审）。",
  });
}

export type SkillPublishCheck = {
  id: string;
  risk: "L1" | "L2" | "L3" | null;
  owner: string | null;
  biz_family: string | null;
  biz_domain: string | null;
  checks: {
    tests: { ok: boolean; total: number; pass_rate: number | null; failing: number; detail: string };
    tools: { ok: boolean; unregistered: string[]; unmounted: string[]; detail: string };
    knowledge: { ok: boolean; detail: string };
    approval: { required: boolean; ok: boolean; status: string; approval_id: string | null; detail: string };
    owner: { ok: boolean; detail: string };
  };
  can_publish: boolean;
  reasons: string[];
};

/** 发布前检查：有一项不通过就不能发布，前端逐项展示中文原因。 */
export function skillPublishCheck(id: string): SkillPublishCheck {
  requireSkill(id);
  const meta = skillLifecycleMeta(id);
  const reasons: string[] = [];

  const t = meta.test_summary;
  const testsOk = t.total > 0 && t.failing === 0;
  if (t.total === 0) reasons.push("暂无测试用例，请先添加并运行测试");
  else if (t.failing > 0) reasons.push(`有 ${t.failing} 个测试未通过`);

  const dep = meta.dependencies;
  const toolsOk = dep.unregistered.length === 0 && dep.unmounted.length === 0;
  if (dep.unregistered.length > 0) reasons.push(`${dep.unregistered.length} 个声明工具未在平台登记`);
  if (dep.unmounted.length > 0) reasons.push(`${dep.unmounted.length} 个声明工具未挂载到本技能`);

  let knowledgeOk = true;
  let knowledgeDetail = "无知识依赖";
  const kc = getConn()
    .prepare("SELECT revision, published_revision, update_policy FROM skill_knowledge_configs WHERE skill_id = ?")
    .get(id) as { revision: number; published_revision: number | null; update_policy: string } | undefined;
  if (kc) {
    if (kc.published_revision == null) {
      knowledgeOk = false;
      knowledgeDetail = "知识配置尚未发布";
      reasons.push("知识配置尚未发布");
    } else if (kc.update_policy === "follow_published" && kc.published_revision !== kc.revision) {
      knowledgeOk = false;
      knowledgeDetail = `知识依赖有未发布的新版本（草稿 r${kc.revision}，已发布 r${kc.published_revision}）`;
      reasons.push("知识依赖有未发布的新版本");
    } else {
      knowledgeDetail = `知识依赖已发布（r${kc.published_revision}）`;
    }
  }

  const needApproval = meta.risk === "L3";
  const approval = latestSkillPublishApproval(id);
  const base = currentPublishedVersion(id);
  // 审批引擎终态：consumed=链走完（通过），rejected=驳回，pending=待审批。
  const approvalOk = !needApproval || Boolean(approval && approval.status === "consumed" && approval.base_version === base);
  if (!approvalOk) {
    reasons.push(
      approval && approval.status === "pending"
        ? "发布审批待 CEO 终审，通过后才能发布"
        : "R3 高风险技能发布前必须先发起发布审批并获得通过（CEO 终审）",
    );
  }

  const ownerOk = Boolean(meta.owner && meta.owner.trim());
  if (!ownerOk) reasons.push("请先设置技能负责人");

  return {
    id,
    risk: meta.risk,
    owner: meta.owner,
    biz_family: meta.biz_family,
    biz_domain: meta.biz_domain,
    checks: {
      tests: {
        ok: testsOk,
        total: t.total,
        pass_rate: t.pass_rate,
        failing: t.failing,
        detail: t.total ? `用例 ${t.total} · 通过率 ${t.pass_rate ?? "—"}% · 未通过 ${t.failing}` : "暂无测试用例",
      },
      tools: {
        ok: toolsOk,
        unregistered: dep.unregistered,
        unmounted: dep.unmounted,
        detail: toolsOk ? "声明工具全部已登记并挂载" : "有工具未就绪",
      },
      knowledge: { ok: knowledgeOk, detail: knowledgeDetail },
      approval: {
        required: needApproval,
        ok: approvalOk,
        status: approval ? approval.status : "none",
        approval_id: approval ? approval.approval_id : null,
        detail: needApproval
          ? approval
            ? `审批单 ${approval.approval_id} · ${approvalStatusLabel(approval.status)}`
            : "R3 发布必须先走发布审批"
          : "R1/R2 无需审批",
      },
      owner: { ok: ownerOk, detail: ownerOk ? `负责人：${meta.owner}` : "未设置负责人" },
    },
    can_publish: reasons.length === 0,
    reasons,
  };
}

export function updateSkillLifecycleMeta(
  id: string,
  patch: { owner?: string; business_stage?: string; tags?: string[]; biz_family?: string; biz_domain?: string },
): void {
  requireSkill(id);
  const row = lifecycleRow(id);
  const stage = row?.stage || "draft";
  const owner = patch.owner ?? row?.owner ?? null;
  const businessStage = patch.business_stage ?? row?.business_stage ?? null;
  const tags = JSON.stringify(patch.tags ?? (row?.tags ? JSON.parse(row.tags) : []));
  const bizFamily = patch.biz_family ?? row?.biz_family ?? null;
  const bizDomain = patch.biz_domain ?? row?.biz_domain ?? null;
  getConn()
    .prepare(
      "INSERT INTO skill_lifecycle (skill_id, stage, origin, owner, business_stage, tags, biz_family, biz_domain, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET owner=excluded.owner, business_stage=excluded.business_stage, tags=excluded.tags, biz_family=excluded.biz_family, biz_domain=excluded.biz_domain, updated_at=excluded.updated_at",
    )
    .run(
      id,
      stage,
      row?.origin || (row?.tags?.includes("第三方") ? "third_party" : "official"),
      owner,
      businessStage,
      tags,
      bizFamily,
      bizDomain,
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
  // 发布门禁：负责人必填；R3 无已通过审批单时 403。两条发布路径（阶段流转 / 直接发版）都走这里。
  assertSkillPublishAllowed(id);
  const bundled = isBundledSkill(id);
  const dir = bundled ? packagedSkillDir(id) : skillDir(id);
  if (!dir || !fs.existsSync(path.join(dir, "SKILL.md"))) throw new HttpFail(400, "skill pack not found");
  const conn = getConn();
  const maxRow = conn.prepare("SELECT MAX(version) AS v FROM skill_versions WHERE skill_id = ?").get(id) as {
    v: number | null;
  };
  const next = version ?? (maxRow.v || 0) + 1;
  const snapshot = path.join(versionsRoot(id), `v${next}`);
  fs.rmSync(snapshot, { recursive: true, force: true });
  fs.cpSync(dir, snapshot, { recursive: true });
  if (bundled) {
    fs.writeFileSync(path.join(snapshot, ".skill-sop-overlay.json"), JSON.stringify(overlayRow(id)), "utf8");
  }
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
  if (isBundledSkill(id)) {
    const overlayFile = path.join(row.snapshot_path, ".skill-sop-overlay.json");
    if (fs.existsSync(overlayFile)) {
      const overlay = JSON.parse(fs.readFileSync(overlayFile, "utf8")) as { summary?: string; body?: string; updated_at?: string } | null;
      if (overlay?.summary && overlay.body) {
        getConn().prepare(
          "INSERT INTO skill_sops (id,summary,body,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,body=excluded.body,updated_at=excluded.updated_at",
        ).run(id, overlay.summary, overlay.body, overlay.updated_at || nowIso());
      } else {
        getConn().prepare("DELETE FROM skill_sops WHERE id=?").run(id);
      }
    }
  } else {
    const dir = skillDir(id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(row.snapshot_path, dir, { recursive: true });
  }
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
      "SELECT COUNT(*) AS calls, SUM(CASE WHEN status IN ('completed','approved','done','succeeded') THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) AS failed FROM tickets WHERE skill = ? AND created_at >= ?",
    )
    .get(id, since) as { calls: number; ok: number | null; failed: number | null };
  const calls = totals.calls || 0;
  const ok = totals.ok || 0;
  const daily = conn
    .prepare(
      "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM tickets WHERE skill = ? AND created_at >= ? GROUP BY day ORDER BY day",
    )
    .all(id, since) as { day: string; n: number }[];
  const durationRows = conn
    .prepare(
      "SELECT r.created_at AS created_at, r.completed_at AS completed_at FROM task_runs r JOIN tickets w ON w.id = r.work_item_id WHERE w.skill = ? AND r.created_at >= ? AND r.completed_at IS NOT NULL",
    )
    .all(id, since) as { created_at: string; completed_at: string }[];
  // 在 TS 侧求平均：SQLite 的 julianday() 在 PostgreSQL 不存在，避免引擎分支。
  const durationSamples = durationRows
    .map((row) => Date.parse(row.completed_at) - Date.parse(row.created_at))
    .filter((ms) => Number.isFinite(ms));
  const avgDurationMs = durationSamples.length
    ? durationSamples.reduce((total, ms) => total + ms, 0) / durationSamples.length
    : null;
  const alerts = conn
    .prepare(
      "SELECT COUNT(*) AS n FROM tickets WHERE skill = ? AND created_at >= ? AND status IN ('failed','error','blocked')",
    )
    .get(id, since) as { n: number };
  return {
    days,
    calls,
    success_rate: calls ? Math.round((ok / calls) * 1000) / 10 : null,
    avg_duration_ms: avgDurationMs === null ? null : Math.round(avgDurationMs),
    alerts: alerts.n,
    trend: daily,
  };
}

