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
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim()))) return Number(value.trim());
  return null;
}

function safeCounter(value: unknown): number {
  const n = Number(value || 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpFail(422, "cost counter exceeds the safe integer range");
  return n;
}
function sumRow(row: Row | undefined): CostTotals {
  const source = (row || {}) as Record<string, unknown>;
  return {
    input_tokens: safeCounter(source.input_tokens),
    output_tokens: safeCounter(source.output_tokens),
    total_tokens: safeCounter(source.total_tokens),
    events: safeCounter(source.events),
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

export async function companyUsage(window: CostMonthWindow): Promise<CostTotals> {
  return sumRow((await getConn().query("SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,\n       COALESCE(SUM(output_tokens),0) AS output_tokens,\n       COALESCE(SUM(total_tokens),0) AS total_tokens,\n       COUNT(*) AS events\n  FROM cost_events\n WHERE occurred_at >= $1 AND occurred_at < $2", [window.startIso,window.endIso])).rows[0] as Row | undefined);
}

export async function agentUsage(agentId: string, window: CostMonthWindow): Promise<CostTotals> {
  return sumRow(
    (await getConn().query("SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,\n       COALESCE(SUM(output_tokens),0) AS output_tokens,\n       COALESCE(SUM(total_tokens),0) AS total_tokens,\n       COUNT(*) AS events\n  FROM cost_events\n WHERE occurred_at >= $1 AND occurred_at < $2 AND agent_id = $3", [window.startIso,window.endIso,agentId])).rows[0] as Row | undefined,
  );
}

export async function userUsage(userId: string, window: CostMonthWindow): Promise<CostTotals> {
  return sumRow(
    (await getConn().query("SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,\n       COALESCE(SUM(output_tokens),0) AS output_tokens,\n       COALESCE(SUM(total_tokens),0) AS total_tokens,\n       COUNT(*) AS events\n  FROM cost_events\n WHERE occurred_at >= $1 AND occurred_at < $2 AND user_id = $3", [window.startIso,window.endIso,userId])).rows[0] as Row | undefined,
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

export async function recordCostEvent(input: CostEventInput): Promise<Row> {
  const id = nid("cost");
  const inputTokens = intOrNull(input.inputTokens);
  const outputTokens = intOrNull(input.outputTokens);
  const totalTokens = intOrNull(input.totalTokens) ?? ((inputTokens || 0) + (outputTokens || 0));
  const occurredAt = input.occurredAt || nowIso();
  (await getConn().query("INSERT INTO cost_events\n       (id, occurred_at, agent_id, user_id, skill_id, session_id, run_id, work_item_id, task_run_id, thread_id,\n        project_id, source, provider, model, input_tokens, output_tokens, total_tokens, cost_cents, raw, created_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)", [id,occurredAt,input.agentId ?? null,input.userId ?? null,input.skillId ?? null,input.sessionId ?? null,input.runId ?? null,input.workItemId ?? null,input.taskRunId ?? null,input.threadId ?? null,input.projectId ?? null,input.source,input.provider ?? null,input.model ?? null,inputTokens,outputTokens,totalTokens,intOrNull(input.costCents),input.raw ? String(input.raw).slice(0, 2000) : null,nowIso()]));
  return { id, occurred_at: occurredAt, total_tokens: totalTokens };
}

export async function listCostEvents(limit = 50, agentId?: string | null): Promise<Row[]> {
  const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
  const rows = agentId
    ? (await getConn().query("SELECT * FROM cost_events WHERE agent_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT $2", [agentId,bounded])).rows
    : (await getConn().query("SELECT * FROM cost_events ORDER BY occurred_at DESC, id DESC LIMIT $1", [bounded])).rows;
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

export async function getBudget(scope: BudgetScope, scopeRef: string): Promise<BudgetRow | undefined> {
  return (await getConn().query("SELECT * FROM cost_budgets WHERE scope = $1 AND scope_ref = $2", [scope,scopeRef])).rows[0] as BudgetRow | undefined;
}

export async function listBudgets(): Promise<BudgetRow[]> {
  return (await getConn().query("SELECT * FROM cost_budgets ORDER BY scope, scope_ref", [])).rows as BudgetRow[];
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

async function scopeUsage(scope: BudgetScope, scopeRef: string, window: CostMonthWindow): Promise<number> {
  if (scope === "company") return (await companyUsage(window)).total_tokens;
  if (scope === "agent") return (await agentUsage(scopeRef, window)).total_tokens;
  return (await userUsage(scopeRef, window)).total_tokens;
}

/** 运行前闸门：命中硬停返回原因；不判定警示（警示只用于展示）。判定顺序：公司 → Agent → 员工。 */
export async function budgetBlockFor(agentId: string, userId?: string | null, now = new Date()): Promise<BudgetBlockReason | null> {
  const window = monthWindow(currentCostMonth(now));
  const candidates: { scope: BudgetScope; scopeRef: string }[] = [
    { scope: "company", scopeRef: companyScopeRef() },
    { scope: "agent", scopeRef: agentId },
  ];
  if (userId && String(userId).trim()) candidates.push({ scope: "user", scopeRef: String(userId).trim() });
  for (const candidate of candidates) {
    const row = (await getBudget(candidate.scope, candidate.scopeRef));
    if (!row || !row.enabled || row.limit_tokens == null || row.limit_tokens <= 0) continue;
    const used = (await scopeUsage(candidate.scope, candidate.scopeRef, window));
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

export async function upsertBudget(input: BudgetUpsertInput): Promise<BudgetRow> {
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

  return (await tx(async (conn) => {
    await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["cost-budget",input.scope,scopeRef])]);
    const existing = (await conn.query("SELECT * FROM cost_budgets WHERE scope = $1 AND scope_ref = $2 FOR UPDATE", [input.scope,scopeRef])).rows[0] as BudgetRow | undefined;
    if (existing) {
      if (expectedVersion != null && expectedVersion !== existing.version) {
        throw new HttpFail(409, { code: "cost_budget_version_conflict", message: "预算已被其他操作更新，请刷新后重试。", current_version: existing.version });
      }
    } else if (expectedVersion != null && expectedVersion !== 0) {
      throw new HttpFail(409, { code: "cost_budget_version_conflict", message: "预算不存在，无法按给定版本更新。", current_version: null });
    }
    const version = existing ? existing.version + 1 : 0;
    const updatedAt = nowIso();
    (await conn.query("INSERT INTO cost_budgets (scope, scope_ref, limit_tokens, warn_percent, hard_stop_percent, enabled, version, updated_at, updated_by)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)\n       ON CONFLICT(scope, scope_ref) DO UPDATE SET\n         limit_tokens = excluded.limit_tokens,\n         warn_percent = excluded.warn_percent,\n         hard_stop_percent = excluded.hard_stop_percent,\n         enabled = excluded.enabled,\n         version = excluded.version,\n         updated_at = excluded.updated_at,\n         updated_by = excluded.updated_by", [input.scope,scopeRef,limitTokens,warnPercent,hardStopPercent,enabled,version,updatedAt,input.actor]));
    (await audit(input.actor, "cost.budget.updated", {
      scope: input.scope,
      scope_ref: scopeRef,
      limit_tokens: limitTokens,
      warn_percent: warnPercent,
      hard_stop_percent: hardStopPercent,
      enabled,
      version,
      before_version: existing?.version ?? null,
    }, conn));
    return (await conn.query("SELECT * FROM cost_budgets WHERE scope = $1 AND scope_ref = $2", [input.scope,scopeRef])).rows[0] as BudgetRow;
  }));
}

async function budgetEntry(scope: BudgetScope, scopeRef: string, window: CostMonthWindow): Promise<Json> {
  const row = (await getBudget(scope, scopeRef));
  const used = (await scopeUsage(scope, scopeRef, window));
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

async function agentCandidates(): Promise<string[]> {
  const set = new Set<string>();
  const rows = (await getConn().query("SELECT DISTINCT agent_id FROM runtime_agent_skills", [])).rows as { agent_id: string }[];
  for (const row of rows) if (row.agent_id) set.add(String(row.agent_id));
  const used = (await getConn().query("SELECT DISTINCT agent_id FROM cost_events WHERE agent_id IS NOT NULL", [])).rows as { agent_id: string }[];
  for (const row of used) if (row.agent_id) set.add(String(row.agent_id));
  const budgeted = (await getConn().query("SELECT scope_ref FROM cost_budgets WHERE scope = 'agent'", [])).rows as { scope_ref: string }[];
  for (const row of budgeted) if (row.scope_ref) set.add(String(row.scope_ref));
  return [...set].sort();
}

/** 个人预算候选：本月出现过用量的员工 ∪ 已配置个人预算的员工。 */
async function userCandidates(): Promise<string[]> {
  const set = new Set<string>();
  const used = (await getConn().query("SELECT DISTINCT user_id FROM cost_events WHERE user_id IS NOT NULL", [])).rows as { user_id: string }[];
  for (const row of used) if (row.user_id) set.add(String(row.user_id));
  const budgeted = (await getConn().query("SELECT scope_ref FROM cost_budgets WHERE scope = 'user'", [])).rows as { scope_ref: string }[];
  for (const row of budgeted) if (row.scope_ref) set.add(String(row.scope_ref));
  return [...set].sort();
}

export async function costsSummary(month?: string | null): Promise<Json> {
  const window = monthWindow(month);
  const totals = (await companyUsage(window));
  const byAgent = (await getConn().query("SELECT agent_id,\n            COALESCE(SUM(input_tokens),0) AS input_tokens,\n            COALESCE(SUM(output_tokens),0) AS output_tokens,\n            COALESCE(SUM(total_tokens),0) AS total_tokens,\n            COUNT(*) AS events\n       FROM cost_events\n      WHERE occurred_at >= $1 AND occurred_at < $2 AND agent_id IS NOT NULL\n      GROUP BY agent_id\n      ORDER BY total_tokens DESC, agent_id", [window.startIso,window.endIso])).rows as Row[];
  const agents = byAgent.map((row) => ({
    agent_id: String(row.agent_id),
    input_tokens: safeCounter(row.input_tokens),
    output_tokens: safeCounter(row.output_tokens),
    total_tokens: safeCounter(row.total_tokens),
    events: safeCounter(row.events),
  }));
  const byUser = (await getConn().query("SELECT user_id,\n            COALESCE(SUM(input_tokens),0) AS input_tokens,\n            COALESCE(SUM(output_tokens),0) AS output_tokens,\n            COALESCE(SUM(total_tokens),0) AS total_tokens,\n            COUNT(*) AS events\n       FROM cost_events\n      WHERE occurred_at >= $1 AND occurred_at < $2 AND user_id IS NOT NULL\n      GROUP BY user_id\n      ORDER BY total_tokens DESC, user_id", [window.startIso,window.endIso])).rows as Row[];
  const users = byUser.map((row) => ({
    user_id: String(row.user_id),
    input_tokens: safeCounter(row.input_tokens),
    output_tokens: safeCounter(row.output_tokens),
    total_tokens: safeCounter(row.total_tokens),
    events: safeCounter(row.events),
  }));
  const budgets = [
    (await budgetEntry("company", companyScopeRef(), window)),
    ...await Promise.all((await agentCandidates()).map(async (agentId) => (await budgetEntry("agent", agentId, window)))),
    ...await Promise.all((await userCandidates()).map(async (userId) => (await budgetEntry("user", userId, window)))),
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
        if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
      }
      const nested = objectAt(candidate.usage);
      if (nested) {
        for (const key of keys) {
          const value = nested[key];
          if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
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
    (await recordCostEvent({
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
    }));
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
