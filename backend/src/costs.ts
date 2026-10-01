/**
 * 成本与预算：记录模型运行用量（估计值，来源 app-server `account/usage/read`），
 * 按公司、Agent 与员工个人（2026-09-29 追加）月度汇总；预算警示与硬停由程序执行（CONST-03）。
 * 金额字段预留：缺版本化价格来源时恒为 NULL，不得以估算金额冒充（PROD-PLAT-08）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit, getConn, nowIso, tx } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";

export const COST_MONTH_TZ = "Asia/Shanghai";
const COST_MONTH_OFFSET = "+08:00";
export const COST_SOURCE_THREAD_USAGE = "codex_account_usage_estimated";
export const COST_NOTES = [
  "usage_estimated_source",
  "auxiliary_codex_calls_unmetered",
  "cost_cents_unavailable",
];

export type CostMonthWindow = { month: string; timezone: string; startIso: string; endIso: string };
export type CostTotals = { input_tokens: number; output_tokens: number; total_tokens: number; events: number };
export type BudgetScope = "company" | "agent" | "user";
export type BudgetState = "unconfigured" | "disabled" | "ok" | "warn" | "stopped";

export type BudgetRow = {
  scope: BudgetScope;
  scope_ref: string;
  limit_tokens: number | null;
  warn_percent: number;
  hard_stop_percent: number;
  enabled: number;
  version: number;
  updated_at: string;
  updated_by: string | null;
};

export type BudgetBlockReason = {
  scope: BudgetScope;
  scope_ref: string;
  used_tokens: number;
  limit_tokens: number;
  warn_percent: number;
  hard_stop_percent: number;
  percent: number;
};

export type ParsedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  provider: string | null;
};

export type UsageRpc = { request(method: string, params?: Json, timeout?: number): Promise<Json> };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function sumRow(row: Row | undefined): CostTotals {
  const source = (row || {}) as Record<string, unknown>;
  return {
    input_tokens: Number(source.input_tokens || 0),
    output_tokens: Number(source.output_tokens || 0),
    total_tokens: Number(source.total_tokens || 0),
    events: Number(source.events || 0),
  };
}

function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentCostMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COST_MONTH_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  return `${year}-${month}`;
}

export function monthWindow(month?: string | null): CostMonthWindow {
  const key = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : currentCostMonth();
  const start = new Date(`${key}-01T00:00:00${COST_MONTH_OFFSET}`);
  const end = new Date(`${shiftMonth(key, 1)}-01T00:00:00${COST_MONTH_OFFSET}`);
  return { month: key, timezone: COST_MONTH_TZ, startIso: start.toISOString(), endIso: end.toISOString() };
}

const TOTALS_SQL = `SELECT IFNULL(SUM(input_tokens),0) AS input_tokens,
       IFNULL(SUM(output_tokens),0) AS output_tokens,
       IFNULL(SUM(total_tokens),0) AS total_tokens,
       COUNT(*) AS events
  FROM cost_events
 WHERE occurred_at >= ? AND occurred_at < ?`;

export function companyUsage(window: CostMonthWindow): CostTotals {
  return sumRow(getConn().prepare(TOTALS_SQL).get(window.startIso, window.endIso) as Row | undefined);
}

export function agentUsage(agentId: string, window: CostMonthWindow): CostTotals {
  return sumRow(
    getConn().prepare(`${TOTALS_SQL} AND agent_id = ?`).get(window.startIso, window.endIso, agentId) as Row | undefined,
  );
}

export function userUsage(userId: string, window: CostMonthWindow): CostTotals {
  return sumRow(
    getConn().prepare(`${TOTALS_SQL} AND user_id = ?`).get(window.startIso, window.endIso, userId) as Row | undefined,
  );
}

export type CostEventInput = {
  agentId?: string | null;
  userId?: string | null;
  skillId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  workItemId?: string | null;
  taskRunId?: string | null;
  threadId?: string | null;
  projectId?: string | null;
  source: string;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costCents?: number | null;
  raw?: string | null;
  occurredAt?: string | null;
};

export function recordCostEvent(input: CostEventInput): Row {
  const id = nid("cost");
  const inputTokens = intOrNull(input.inputTokens);
  const outputTokens = intOrNull(input.outputTokens);
  const totalTokens = intOrNull(input.totalTokens) ?? ((inputTokens || 0) + (outputTokens || 0));
  const occurredAt = input.occurredAt || nowIso();
  getConn().prepare(
    `INSERT INTO cost_events
       (id, occurred_at, agent_id, user_id, skill_id, session_id, run_id, work_item_id, task_run_id, thread_id,
        project_id, source, provider, model, input_tokens, output_tokens, total_tokens, cost_cents, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    occurredAt,
    input.agentId ?? null,
    input.userId ?? null,
    input.skillId ?? null,
    input.sessionId ?? null,
    input.runId ?? null,
    input.workItemId ?? null,
    input.taskRunId ?? null,
    input.threadId ?? null,
    input.projectId ?? null,
    input.source,
    input.provider ?? null,
    input.model ?? null,
    inputTokens,
    outputTokens,
    totalTokens,
    intOrNull(input.costCents),
    input.raw ? String(input.raw).slice(0, 2000) : null,
    nowIso(),
  );
  return { id, occurred_at: occurredAt, total_tokens: totalTokens };
}

export function listCostEvents(limit = 50, agentId?: string | null): Row[] {
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
  const rows = agentId
    ? getConn().prepare("SELECT * FROM cost_events WHERE agent_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .all(agentId, bounded)
    : getConn().prepare("SELECT * FROM cost_events ORDER BY occurred_at DESC, id DESC LIMIT ?").all(bounded);
  return rows as Row[];
}

let cachedCompanyRef: string | null = null;
export function companyScopeRef(): string {
  if (cachedCompanyRef) return cachedCompanyRef;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8")) as {
      companies?: { id?: unknown }[];
    };
    const id = (parsed.companies || []).find((company) => typeof company?.id === "string")?.id;
    cachedCompanyRef = typeof id === "string" && id.trim() ? id.trim() : "primary";
  } catch {
    cachedCompanyRef = "primary";
  }
  return cachedCompanyRef;
}

export function getBudget(scope: BudgetScope, scopeRef: string): BudgetRow | undefined {
  return getConn().prepare("SELECT * FROM cost_budgets WHERE scope = ? AND scope_ref = ?")
    .get(scope, scopeRef) as BudgetRow | undefined;
}

export function listBudgets(): BudgetRow[] {
  return getConn().prepare("SELECT * FROM cost_budgets ORDER BY scope, scope_ref").all() as BudgetRow[];
}

export function budgetStateFor(row: BudgetRow | null | undefined, usedTokens: number): {
  percent: number | null;
  state: BudgetState;
} {
  if (!row || row.limit_tokens == null || row.limit_tokens <= 0) return { percent: null, state: "unconfigured" };
  if (!row.enabled) return { percent: Math.round((usedTokens * 100) / row.limit_tokens), state: "disabled" };
  const percent = Math.round((usedTokens * 100) / row.limit_tokens);
  if (usedTokens * 100 >= row.limit_tokens * row.hard_stop_percent) return { percent, state: "stopped" };
  if (usedTokens * 100 >= row.limit_tokens * row.warn_percent) return { percent, state: "warn" };
  return { percent, state: "ok" };
}

function scopeUsage(scope: BudgetScope, scopeRef: string, window: CostMonthWindow): number {
  if (scope === "company") return companyUsage(window).total_tokens;
  if (scope === "agent") return agentUsage(scopeRef, window).total_tokens;
  return userUsage(scopeRef, window).total_tokens;
}

/** 运行前闸门：命中硬停返回原因；不判定警示（警示只用于展示）。判定顺序：公司 → Agent → 员工。 */
export function budgetBlockFor(agentId: string, userId?: string | null, now = new Date()): BudgetBlockReason | null {
  const window = monthWindow(currentCostMonth(now));
  const candidates: { scope: BudgetScope; scopeRef: string }[] = [
    { scope: "company", scopeRef: companyScopeRef() },
    { scope: "agent", scopeRef: agentId },
  ];
  if (userId && String(userId).trim()) candidates.push({ scope: "user", scopeRef: String(userId).trim() });
  for (const candidate of candidates) {
    const row = getBudget(candidate.scope, candidate.scopeRef);
    if (!row || !row.enabled || row.limit_tokens == null || row.limit_tokens <= 0) continue;
    const used = scopeUsage(candidate.scope, candidate.scopeRef, window);
    if (used * 100 >= row.limit_tokens * row.hard_stop_percent) {
      return {
        scope: candidate.scope,
        scope_ref: candidate.scopeRef,
        used_tokens: used,
        limit_tokens: row.limit_tokens,
        warn_percent: row.warn_percent,
        hard_stop_percent: row.hard_stop_percent,
        percent: Math.round((used * 100) / row.limit_tokens),
      };
    }
  }
  return null;
}

const SCOPE_LABEL: Record<BudgetScope, string> = { company: "公司", agent: "Agent", user: "员工" };

export class BudgetBlocked extends Error {
  reason: BudgetBlockReason;

  constructor(reason: BudgetBlockReason) {
    super(`本月用量已达预算上限（${SCOPE_LABEL[reason.scope]} ${reason.used_tokens} / ${reason.limit_tokens} tokens，${reason.percent}%），本次运行未开始。`);
    this.name = "BudgetBlocked";
    this.reason = reason;
  }

  asDict(): Json {
    return {
      code: "budget_exceeded",
      message: this.message,
      scope: this.reason.scope,
      scope_ref: this.reason.scope_ref,
      used_tokens: this.reason.used_tokens,
      limit_tokens: this.reason.limit_tokens,
      percent: this.reason.percent,
      next_action: "等待下月或由管理员在「成本」治理面调整预算后重试。",
    };
  }
}

export type BudgetUpsertInput = {
  scope: string;
  scopeRef: string;
  limitTokens: number | null;
  warnPercent?: number | null;
  hardStopPercent?: number | null;
  enabled?: boolean | null;
  expectedVersion?: number | null;
  actor: string;
};

function percentOrFail(value: unknown, field: string, fallback: number): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new HttpFail(400, `${field} must be an integer between 0 and 100`);
  }
  return value;
}

export function upsertBudget(input: BudgetUpsertInput): BudgetRow {
  if (input.scope !== "company" && input.scope !== "agent" && input.scope !== "user") {
    throw new HttpFail(400, "scope must be company, agent or user");
  }
  const scopeRef = String(input.scopeRef || "").trim();
  if (!scopeRef) throw new HttpFail(400, "scope_ref is required");
  const limitTokens = input.limitTokens == null ? null : intOrNull(input.limitTokens);
  if (input.limitTokens != null && (limitTokens == null || limitTokens <= 0)) {
    throw new HttpFail(400, "limit_tokens must be a positive integer or null");
  }
  const warnPercent = percentOrFail(input.warnPercent, "warn_percent", 80);
  const hardStopPercent = percentOrFail(input.hardStopPercent, "hard_stop_percent", 100);
  if (hardStopPercent < warnPercent) throw new HttpFail(400, "hard_stop_percent must be >= warn_percent");
  const enabled = input.enabled === false ? 0 : 1;
  const expectedVersion = input.expectedVersion == null ? null : Number(input.expectedVersion);

  return tx((conn) => {
    const existing = conn.prepare("SELECT * FROM cost_budgets WHERE scope = ? AND scope_ref = ?")
      .get(input.scope, scopeRef) as BudgetRow | undefined;
    if (existing) {
      if (expectedVersion != null && expectedVersion !== existing.version) {
        throw new HttpFail(409, { code: "cost_budget_version_conflict", message: "预算已被其他操作更新，请刷新后重试。", current_version: existing.version });
      }
    } else if (expectedVersion != null && expectedVersion !== 0) {
      throw new HttpFail(409, { code: "cost_budget_version_conflict", message: "预算不存在，无法按给定版本更新。", current_version: null });
    }
    const version = existing ? existing.version + 1 : 0;
    const updatedAt = nowIso();
    conn.prepare(
      `INSERT INTO cost_budgets (scope, scope_ref, limit_tokens, warn_percent, hard_stop_percent, enabled, version, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scope, scope_ref) DO UPDATE SET
         limit_tokens = excluded.limit_tokens,
         warn_percent = excluded.warn_percent,
         hard_stop_percent = excluded.hard_stop_percent,
         enabled = excluded.enabled,
         version = excluded.version,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).run(input.scope, scopeRef, limitTokens, warnPercent, hardStopPercent, enabled, version, updatedAt, input.actor);
    audit(input.actor, "cost.budget.updated", {
      scope: input.scope,
      scope_ref: scopeRef,
      limit_tokens: limitTokens,
      warn_percent: warnPercent,
      hard_stop_percent: hardStopPercent,
      enabled,
      version,
      before_version: existing?.version ?? null,
    });
    return conn.prepare("SELECT * FROM cost_budgets WHERE scope = ? AND scope_ref = ?")
      .get(input.scope, scopeRef) as BudgetRow;
  });
}

function budgetEntry(scope: BudgetScope, scopeRef: string, window: CostMonthWindow): Json {
  const row = getBudget(scope, scopeRef);
  const used = scopeUsage(scope, scopeRef, window);
  const state = budgetStateFor(row, used);
  return {
    scope,
    scope_ref: scopeRef,
    limit_tokens: row?.limit_tokens ?? null,
    warn_percent: row?.warn_percent ?? 80,
    hard_stop_percent: row?.hard_stop_percent ?? 100,
    enabled: row ? row.enabled : null,
    version: row ? row.version : null,
    used_tokens: used,
    percent: state.percent,
    state: state.state,
  };
}

function agentCandidates(): string[] {
  const set = new Set<string>();
  try {
    const rows = getConn().prepare("SELECT DISTINCT agent_id FROM runtime_agent_skills").all() as { agent_id: string }[];
    for (const row of rows) if (row.agent_id) set.add(String(row.agent_id));
  } catch {
    // runtime governance table may be absent in isolated module tests
  }
  const used = getConn().prepare("SELECT DISTINCT agent_id FROM cost_events WHERE agent_id IS NOT NULL").all() as { agent_id: string }[];
  for (const row of used) if (row.agent_id) set.add(String(row.agent_id));
  const budgeted = getConn().prepare("SELECT scope_ref FROM cost_budgets WHERE scope = 'agent'").all() as { scope_ref: string }[];
  for (const row of budgeted) if (row.scope_ref) set.add(String(row.scope_ref));
  return [...set].sort();
}

/** 个人预算候选：本月出现过用量的员工 ∪ 已配置个人预算的员工。 */
function userCandidates(): string[] {
  const set = new Set<string>();
  const used = getConn().prepare("SELECT DISTINCT user_id FROM cost_events WHERE user_id IS NOT NULL").all() as { user_id: string }[];
  for (const row of used) if (row.user_id) set.add(String(row.user_id));
  const budgeted = getConn().prepare("SELECT scope_ref FROM cost_budgets WHERE scope = 'user'").all() as { scope_ref: string }[];
  for (const row of budgeted) if (row.scope_ref) set.add(String(row.scope_ref));
  return [...set].sort();
}

export function costsSummary(month?: string | null): Json {
  const window = monthWindow(month);
  const totals = companyUsage(window);
  const byAgent = getConn().prepare(
    `SELECT agent_id,
            IFNULL(SUM(input_tokens),0) AS input_tokens,
            IFNULL(SUM(output_tokens),0) AS output_tokens,
            IFNULL(SUM(total_tokens),0) AS total_tokens,
            COUNT(*) AS events
       FROM cost_events
      WHERE occurred_at >= ? AND occurred_at < ? AND agent_id IS NOT NULL
      GROUP BY agent_id
      ORDER BY total_tokens DESC, agent_id`,
  ).all(window.startIso, window.endIso) as Row[];
  const agents = byAgent.map((row) => ({
    agent_id: String(row.agent_id),
    input_tokens: Number(row.input_tokens || 0),
    output_tokens: Number(row.output_tokens || 0),
    total_tokens: Number(row.total_tokens || 0),
    events: Number(row.events || 0),
  }));
  const byUser = getConn().prepare(
    `SELECT user_id,
            IFNULL(SUM(input_tokens),0) AS input_tokens,
            IFNULL(SUM(output_tokens),0) AS output_tokens,
            IFNULL(SUM(total_tokens),0) AS total_tokens,
            COUNT(*) AS events
       FROM cost_events
      WHERE occurred_at >= ? AND occurred_at < ? AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY total_tokens DESC, user_id`,
  ).all(window.startIso, window.endIso) as Row[];
  const users = byUser.map((row) => ({
    user_id: String(row.user_id),
    input_tokens: Number(row.input_tokens || 0),
    output_tokens: Number(row.output_tokens || 0),
    total_tokens: Number(row.total_tokens || 0),
    events: Number(row.events || 0),
  }));
  const budgets = [
    budgetEntry("company", companyScopeRef(), window),
    ...agentCandidates().map((agentId) => budgetEntry("agent", agentId, window)),
    ...userCandidates().map((userId) => budgetEntry("user", userId, window)),
  ];
  return {
    month: window.month,
    timezone: window.timezone,
    window: { start: window.startIso, end: window.endIso },
    totals,
    agents,
    users,
    budgets,
    notes: [...COST_NOTES],
  };
}

function objectAt(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 解析 app-server `account/usage/read` 返回值；形状不符返回 null（按缺口处理，不得以 0 冒充）。 */
export function parseThreadUsage(result: Json | null | undefined): ParsedUsage | null {
  const root = objectAt(result);
  if (!root) return null;
  const threadUsage = objectAt(root.threadUsage);
  const candidates = [threadUsage, objectAt(root.usage)].filter(Boolean) as Record<string, unknown>[];
  if (!candidates.length) return null;
  const pick = (keys: string[]): number | null => {
    for (const candidate of candidates) {
      for (const key of keys) {
        const value = candidate[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
      }
      const nested = objectAt(candidate.usage);
      if (nested) {
        for (const key of keys) {
          const value = nested[key];
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
        }
      }
    }
    return null;
  };
  const inputTokens = pick(["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  const outputTokens = pick(["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  let totalTokens = pick(["totalTokens", "total_tokens", "total"]);
  if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
    totalTokens = (inputTokens || 0) + (outputTokens || 0);
  }
  if (inputTokens == null && outputTokens == null && totalTokens == null) return null;
  const modelHolder = candidates.find((candidate) => typeof candidate.model === "string");
  const providerHolder = candidates.find((candidate) => typeof candidate.provider === "string")
    || (typeof root.provider === "string" ? root : null);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    model: modelHolder ? String(modelHolder.model) : null,
    provider: providerHolder ? String(providerHolder.provider) : null,
  };
}

export type ThreadUsageCapture = {
  rpc: UsageRpc;
  threadId: string;
  log: Json[];
  agentId: string;
  userId?: string | null;
  skillId: string;
  sessionId: string;
  runId: string;
  workItemId?: string | null;
  taskRunId?: string | null;
};

/** 采集线程级估计用量；任何失败只写 contract_log，绝不 throw、不影响运行结果。 */
export async function captureThreadUsage(capture: ThreadUsageCapture): Promise<void> {
  const { rpc, threadId, log } = capture;
  try {
    const result = await rpc.request("account/usage/read", { threadId }, 5);
    const usage = parseThreadUsage(result);
    if (!usage) {
      log.push({ method: "account/usage/read", params: { thread_id: threadId, captured: false, reason: "usage_unavailable" } });
      return;
    }
    recordCostEvent({
      agentId: capture.agentId,
      userId: capture.userId ?? null,
      skillId: capture.skillId,
      sessionId: capture.sessionId,
      runId: capture.runId,
      workItemId: capture.workItemId ?? null,
      taskRunId: capture.taskRunId ?? null,
      threadId,
      source: COST_SOURCE_THREAD_USAGE,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      raw: JSON.stringify(result),
    });
    log.push({
      method: "account/usage/read",
      params: {
        thread_id: threadId,
        captured: true,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        source: COST_SOURCE_THREAD_USAGE,
      },
    });
  } catch (error) {
    log.push({
      method: "account/usage/read",
      params: {
        thread_id: threadId,
        captured: false,
        reason: String(error instanceof Error ? error.message : error).slice(0, 200),
      },
    });
  }
}
