import { DEMO_USER } from "../config.js";
import { getConn } from "../db.js";
import { BY_CODE, MAIN_STAGES, SIDE_STAGES, label, nextCode, normalizeStage } from "../stages.js";
import { taskDefinitions, type TaskDefinition } from "../tasks/registry.js";
import type { Json, Row } from "../types.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { currentFollowScope, matchesFollowedMailbox } from "./starry-bind.js";
import { restoreOfficialCollaborationStages } from "../starrykol/library-sync.js";
import { stageMailAction } from "./compose-loop.js";
import { threadsByCollaborationIds } from "../starrykol/mail-sync.js";
import { readFollowStyleTags } from "../follow-style-tags.js";
import { PLANNING_TASK_TYPES, PLANNING_TASK_TYPES_SET, TODO_EXCLUDED_TASK_TYPES } from "./planning-types.js";

/**
 * `taskDefinitions()` re-stats every skill directory on each call — that scan is
 * what keeps publishing live. A board or task list projects hundreds of rows, so
 * it must scan once per request and then look ids up in this Map: calling
 * `taskDefinition()` per row repeats the same directory scan per row and
 * dominates the response time.
 */
export type TaskDefinitionIndex = Map<string, TaskDefinition>;

export function taskDefinitionIndex(): TaskDefinitionIndex {
  return new Map(taskDefinitions().map((definition) => [definition.id, definition]));
}

/** Board list caps: the projection is an overview, not the full archive. */
// Each cap below is a presentation budget for one board render — not a business
// rule, and never the source of a count, stage or approval decision.
/** Related tasks kept on one 红人 card in the board payload. */
export const MAX_KOL_TASKS = 3;
/** Mail threads kept on one 红人 card in the board payload. */
export const MAX_KOL_MAIL_THREADS = 3;
/** Rows kept in each workbench list (open/todo/today/insights). */
export const MAX_WORKBENCH_TASKS = 50;
/** Board task rows, newest first (work_items are read ORDER BY updated_at DESC). */
export const MAX_BOARD_TASKS = 50;

/**
 * Collaboration columns no frontend file *reads* (grepped frontend/src and
 * frontend/e2e). A field stays when any module dereferences it — e.g.
 * `last_conversation_id` drives `hasConversation()` in
 * frontend/src/home/kolContract.ts, which the board pool adapter applies — and
 * when `cardFields` folds it into rendered copy, as `group_brand_overlap` does
 * for the collab_summary of board task rows.
 */
const KOL_FIELDS_DROPPED = [
  "lifecycle_id",
  "last_lifecycle_id",
  "last_skip_kind",
  "last_skip_reason",
  "last_skipped_stages",
  "recipient_name",
  "address_line",
  "country",
  "postal",
  "risk_tag",
  "kol_id",
  "list_in_projects",
  "sku",
  "qty",
  // `coarse` has no frontend reader: the lifecycle domain counts it fed were
  // dropped with `workbench.lifecycle`.
  "coarse",
  // Reachability/ownership columns. `owner_mailbox` stays: `isUnownedRow` in
  // frontend/src/home/kolContract.ts classifies a row as 无主 only when *every*
  // owner key present is empty, so dropping it would turn a 有主 KOL into 公海.
  "locked",
  "contact_email_masked",
  "wechat",
  // `duplicate_checked` is already folded into the `已查重` profile tag below.
  "duplicate_checked",
  // Duplicate of `recent_followup` (same string) with no reader in frontend/src
  // or frontend/e2e.
  "task_history",
] as const;

function publicKol(kol: Json): Json {
  const out: Json = { ...kol };
  for (const field of KOL_FIELDS_DROPPED) delete out[field];
  return out;
}

function capped<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(0, max) : list;
}

function mailThreadsOf(kol: Json): Json[] {
  return Array.isArray(kol.mail_threads) ? kol.mail_threads as Json[] : [];
}

const NICHE_LABEL: Record<string, string> = {
  beauty: "美妆",
  "consumer-electronics": "数码",
  parenting: "母婴",
  vanlife: "户外",
};

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: "小红书",
  小红书: "小红书",
  bilibili: "B站",
  B站: "B站",
  douyin: "抖音",
  抖音: "抖音",
  youtube: "YouTube",
  YouTube: "YouTube",
};

function parseJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  return DEMO_USER.id;
}

function statusText(status?: string) {
  if (status === "completed" || status === "done") return "已完成";
  if (status === "running" || status === "in_progress") return "进行中";
  if (status === "waiting" || status === "queued") return "等待中";
  if (status === "failed") return "有风险";
  if (status === "cancelled") return "已取消";
  return "待处理";
}

export function historySummary(events: Array<{ label?: unknown; safe_summary?: unknown; status?: unknown }>): string {
  if (!events.length) return "暂无任务历史";
  const last = events[events.length - 1];
  const text = String(last.safe_summary || last.label || "").trim();
  const status = statusText(String(last.status || ""));
  return text ? `${text} · ${status}` : status;
}

function pushTag(tags: { id: string; label: string }[], id: string, labelText?: string | null) {
  const value = String(labelText || "").trim();
  if (!value) return;
  if (tags.some((tag) => tag.label === value || tag.id === id)) return;
  tags.push({ id, label: value });
}

export function profileTags(kol: {
  platform?: string;
  brand?: string;
  followers?: string | number;
  audience_geo?: string;
  engagement_rate?: string;
  niche?: string;
  unbound?: boolean;
  exception?: boolean;
  duplicate_checked?: number;
}): { id: string; label: string }[] {
  const tags: { id: string; label: string }[] = [];
  pushTag(tags, "platform", PLATFORM_LABEL[String(kol.platform || "")] || kol.platform);
  pushTag(tags, "niche", NICHE_LABEL[String(kol.niche || "")] || (kol.niche && !/^[a-z-]+$/.test(kol.niche) ? kol.niche : ""));
  pushTag(tags, "brand", kol.brand ? `${kol.brand}品牌` : "");
  const followers = kol.followers;
  if (followers != null && String(followers) !== "") {
    const raw = String(followers);
    pushTag(tags, "followers", /[万kK]/.test(raw) || Number.isNaN(Number(raw)) ? `${raw}粉`.replace(/粉粉/, "粉") : `${raw}粉`);
  }
  pushTag(tags, "geo", kol.audience_geo ? `${kol.audience_geo}受众` : "");
  if (kol.engagement_rate) {
    const rate = Number(kol.engagement_rate);
    pushTag(tags, "engagement", Number.isFinite(rate) ? `互动 ${(rate * 100).toFixed(1)}%` : `互动 ${kol.engagement_rate}`);
  }
  if (kol.unbound) pushTag(tags, "unbound", "未建联");
  if (kol.exception) pushTag(tags, "exception", "异常");
  if (Number(kol.duplicate_checked)) pushTag(tags, "dup", "已查重");
  return tags;
}

function formatFollowers(value: unknown): string {
  if (value == null || value === "") return "";
  const raw = String(value);
  if (/[万kK]/.test(raw)) return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (n >= 10000) return `${Math.round(n / 10000)}万`;
  return String(n);
}

function clampText(value: unknown, max = 88): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function collabSummary(kol: {
  unbound?: boolean;
  brand?: unknown;
  owner_name?: unknown;
  sku?: unknown;
  qty?: unknown;
  group_brand_overlap?: unknown;
  notes?: unknown;
}): string {
  const parts: string[] = [];
  if (kol.unbound) parts.push("尚未进入生命周期");
  if (kol.brand) parts.push(`${kol.brand}品牌合作`);
  if (kol.owner_name) parts.push(`负责人 ${kol.owner_name}`);
  const sku = String(kol.sku || "").trim();
  const qty = String(kol.qty || "").trim();
  if (sku) parts.push(qty ? `${sku} × ${qty}` : sku);
  if (kol.group_brand_overlap) parts.push(String(kol.group_brand_overlap));
  const notes = clampText(kol.notes);
  if (notes) parts.push(notes);
  return parts.join(" · ") || "暂无合作摘要";
}

function currentStageText(kol: {
  unbound?: boolean;
  stage_label?: unknown;
  days_in_stage?: unknown;
  exception?: boolean;
}): string {
  if (kol.unbound) return "未进入生命周期";
  const bits = [String(kol.stage_label || "").trim()].filter(Boolean);
  if (kol.days_in_stage != null && String(kol.days_in_stage) !== "") bits.push(`停留 ${kol.days_in_stage} 天`);
  if (kol.exception) bits.push("异常");
  return bits.join(" · ") || "阶段未知";
}

export function suggestedStage(kol: {
  stage_code?: unknown;
  unbound?: boolean;
  exception?: boolean;
}): { code: string | null; label: string } {
  if (kol.unbound) return { code: "INITIAL_CONTACT", label: "初步接触" };
  const current = normalizeStage(String(kol.stage_code || ""));
  const stage = BY_CODE[current];
  if (!stage) return { code: null, label: "待补阶段" };
  if (stage.terminal) return { code: null, label: "无需推进" };
  if (!stage.main || kol.exception) return { code: null, label: "需人选回到主流程" };
  const next = nextCode(current);
  if (!next) return { code: null, label: "无需推进" };
  return { code: next, label: label(next) };
}

export function cardFields(kol: {
  handle?: unknown;
  display_name?: unknown;
  unbound?: boolean;
  brand?: unknown;
  owner_name?: unknown;
  sku?: unknown;
  qty?: unknown;
  group_brand_overlap?: unknown;
  notes?: unknown;
  stage_code?: unknown;
  stage_label?: unknown;
  days_in_stage?: unknown;
  exception?: boolean;
}, recentFollowup?: string): Json {
  const suggested = suggestedStage(kol);
  const handle = String(kol.handle || kol.display_name || "").trim();
  return {
    kol_name: handle || "未指定红人",
    collab_summary: collabSummary(kol),
    recent_followup: recentFollowup || "暂无任务历史",
    current_stage: currentStageText(kol),
    suggested_stage: suggested.label,
    suggested_stage_code: suggested.code,
    next_action: suggested.code ? `进入${suggested.label}` : suggested.label,
  };
}

const CLOSED_STATUSES = new Set(["completed", "done", "cancelled"]);

export function isPlanningWorkItem(task: {
  task_type?: unknown;
  skill?: unknown;
  source?: unknown;
}): boolean {
  const type = String(task.task_type || task.skill || "");
  return PLANNING_TASK_TYPES_SET.has(type) || String(task.source || "") === "planning";
}

const PLANNING_TYPES_SQL = PLANNING_TASK_TYPES.map((t) => `'${t}'`).join(",");
const TODO_TYPES_SQL = TODO_EXCLUDED_TASK_TYPES.map((t) => `'${t}'`).join(",");

function startOfDay(value?: Date): Date {
  const day = value ? new Date(value) : new Date();
  day.setHours(0, 0, 0, 0);
  return day;
}

function dueDay(value: unknown): Date | null {
  if (!value) return null;
  const due = new Date(String(value));
  if (Number.isNaN(due.getTime())) return null;
  return startOfDay(due);
}

export function isClosedWorkItem(task: { status?: unknown }): boolean {
  return CLOSED_STATUSES.has(String(task.status || ""));
}

export function isInsightWorkItem(task: {
  source?: unknown;
  status?: unknown;
  promoted_at?: unknown;
  dismissed_at?: unknown;
}): boolean {
  return String(task.source || "") === "ai"
    && !task.promoted_at
    && !task.dismissed_at
    && !isClosedWorkItem(task);
}

const HIGH_RISK_TEXT = /异常|拒绝|暂缓/;

export function isHighRiskWorkItem(task: {
  risk?: unknown;
  status?: unknown;
  title?: unknown;
  current_stage?: unknown;
  risk_level?: unknown;
}): boolean {
  if (task.risk || String(task.status || "") === "failed") return true;
  if (String(task.risk_level || "").toLowerCase() === "high") return true;
  return HIGH_RISK_TEXT.test(`${task.title || ""} ${task.current_stage || ""}`);
}

export function isTodayWorkItem(task: {
  source?: unknown;
  status?: unknown;
  promoted_at?: unknown;
  dismissed_at?: unknown;
  due_at?: unknown;
  risk?: unknown;
  risk_level?: unknown;
  priority?: unknown;
  start_date?: unknown;
  title?: unknown;
  current_stage?: unknown;
  task_type?: unknown;
  skill?: unknown;
}): boolean {
  if (isPlanningWorkItem(task)) return false;
  if (isClosedWorkItem(task) || task.dismissed_at) return false;
  if (isHighRiskWorkItem(task)) return true;
  if (datePartOf(task.start_date) === todayDateStr()) return true;
  const flags = dueFlags(task.due_at);
  return flags.overdue || flags.due_today || flags.due_soon;
}

/** Full open memory list — not closed / not dismissed. No promote gate. */
export function isOpenWorkItem(task: {
  status?: unknown;
  dismissed_at?: unknown;
  task_type?: unknown;
  skill?: unknown;
  source?: unknown;
  title?: unknown;
}): boolean {
  if (isPlanningWorkItem(task)) return false;
  return !isClosedWorkItem(task) && !task.dismissed_at;
}

/** SQL equivalent of isOpenWorkItem. view=open and compat view=todo. */
export const OPEN_WORK_ITEM_SQL = `
  status NOT IN ('completed','done','cancelled')
  AND dismissed_at IS NULL
  AND COALESCE(source, 'manual') != 'planning'
  AND task_type NOT IN (${PLANNING_TYPES_SQL})
`;

export function isTodoWorkItem(task: {
  source?: unknown;
  status?: unknown;
  promoted_at?: unknown;
  dismissed_at?: unknown;
  task_type?: unknown;
  skill?: unknown;
}): boolean {
  if (isPlanningWorkItem(task)) return false;
  if (isClosedWorkItem(task) || task.dismissed_at) return false;
  const source = String(task.source || "manual");
  if (source === "ai" || source === "discovery") return Boolean(task.promoted_at);
  return true;
}

/** SQL equivalent of isTodoWorkItem — open pending/waiting/queued/running/failed + promoted AI. */
export const TODO_WORK_ITEM_SQL = `
  status NOT IN ('completed','done','cancelled')
  AND dismissed_at IS NULL
  AND COALESCE(source, 'manual') != 'planning'
  AND task_type NOT IN (${TODO_TYPES_SQL})
  AND (COALESCE(source, 'manual') NOT IN ('ai', 'discovery') OR promoted_at IS NOT NULL)
`;

const SLIM_WORKBENCH_KEYS = [
  "id", "title", "status", "source", "priority", "candidate", "due_at",
  "promoted_at", "dismissed_at", "history_summary", "kol_name", "collab_summary",
  "recent_followup", "current_stage", "suggested_stage", "suggested_stage_code",
  "collaboration_id", "next_action", "task_type", "skill",
  "risk", "session_id", "description", "context", "last_acted_at", "acknowledged_at",
  "start_date", "risk_level", "display_status", "display_status_label",
] as const;

function slimWorkbenchTask(task: Json): Json {
  const slim: Json = {};
  for (const key of SLIM_WORKBENCH_KEYS) {
    if (task[key] !== undefined) slim[key] = task[key];
  }
  return slim;
}

export function dueFlags(dueAt: unknown): { overdue: boolean; due_today: boolean; due_soon: boolean } {
  const day = dueDay(dueAt);
  if (!day) return { overdue: false, due_today: false, due_soon: false };
  const today = startOfDay();
  const dayDiff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  return {
    overdue: dayDiff < 0,
    due_today: dayDiff === 0,
    due_soon: dayDiff > 0 && dayDiff <= 2,
  };
}

export const TASK_PRIORITY_CODES = ["important_urgent", "important", "urgent", "normal", "low"] as const;
export const TASK_RISK_LEVELS = ["none", "low", "medium", "high"] as const;

/** Canonical priority code; legacy high/medium map onto important/normal. */
export function normalizePriority(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "high") return "important";
  if (raw === "medium") return "normal";
  return (TASK_PRIORITY_CODES as readonly string[]).includes(raw) ? raw : null;
}

export function todayDateStr(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Date part of a stored date/datetime string; "" when absent or unparseable. */
export function datePartOf(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (iso) {
    if (raw.length === 10) return iso[1];
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      return `${parsed.getFullYear()}-${month}-${day}`;
    }
    return iso[1];
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

const DISPLAY_STATUS_LABELS: Record<string, string> = {
  overdue: "延期",
  due_soon: "临期",
  in_progress: "进行中",
  not_started: "未开始",
  completed: "完成",
  cancelled: "取消",
  failed: "失败",
};

/** Derived display status — never stored. */
export function displayStatusOf(task: {
  status?: unknown;
  due_at?: unknown;
  started_at?: unknown;
}): { display_status: string; display_status_label: string } {
  const status = String(task.status || "").toLowerCase();
  let code = "";
  if (status === "completed" || status === "done") code = "completed";
  else if (status === "cancelled") code = "cancelled";
  else if (status === "failed") code = "failed";
  else {
    const due = dueDay(task.due_at);
    if (due) {
      const diff = Math.round((due.getTime() - startOfDay().getTime()) / 86_400_000);
      if (diff < 0) code = "overdue";
      else if (diff <= 2) code = "due_soon";
    }
    if (!code) {
      code = String(task.started_at || "").trim()
        || ["running", "in_progress", "starting", "waiting", "queued"].includes(status)
        ? "in_progress"
        : "not_started";
    }
  }
  return { display_status: code, display_status_label: DISPLAY_STATUS_LABELS[code] };
}

/** Recommended-task rows kept on the board; a presentation budget, not a business rule. */
export const MAX_RECOMMENDED_TASKS = 8;

function recPrompt(intent: string, handle: string, stage = "", definitions = taskDefinitionIndex()): string {
  const definition = definitions.get(intent);
  if (intent === "email_compose") {
    return handle
      ? stageMailAction(handle, stage).prompt
      : (definition?.aliases[0] || definition?.title || "写合作邮件");
  }
  const title = definition?.aliases[0] || definition?.title || intent;
  return handle ? `${title} @${handle}` : title;
}

function recTitle(intent: string, handle: string, days?: number, stage = "", definitions = taskDefinitionIndex()): string {
  const who = handle ? `@${handle}` : "这位红人";
  const stay = Number(days) > 0 ? `停留 ${days} 天的 ` : "";
  if (intent === "email_compose") return `给${stay}${who} ${stageMailAction(handle, stage).label}`;
  const definition = definitions.get(intent);
  const verb = definition?.title || intent;
  if (!handle) return verb;
  return `给 ${who} ${verb}`;
}

function insightIntent(task: Json, kol?: Json, definitions = taskDefinitionIndex()): string | null {
  const type = String(task.skill || task.skill_id || task.task_type || "");
  if (definitions.has(type)) return type;
  if (kol?.unbound) return "creator_profile";
  if (kol?.exception) return "risk_scan";
  if (kol || String(task.kol_name || "").trim()) return "email_compose";
  return null;
}

const INTENT_ICON: Record<string, string> = {
  email_compose: "✉️",
  reply_analysis: "💬",
  creator_profile: "👤",
  confirm_stage: "📍",
  risk_scan: "⚠",
  deal_memory: "📝",
  creator_budget_report: "📊",
  creator_discovery: "🔎",
  creator_daily_tasks: "📋",
};

function recIcon(intent?: string): string {
  return INTENT_ICON[String(intent || "")] || "○";
}

function bareHandle(value: unknown): string {
  return String(value || "").replace(/^@/, "").trim();
}

function highValueInsight(task: Json): boolean {
  const priority = normalizePriority(task.priority);
  return priority === "important_urgent" || priority === "important" || priority === "urgent"
    || Boolean(task.risk) || String(task.status || "") === "failed";
}

function inboundUnread(kol: Json): Json | undefined {
  return mailThreadsOf(kol).find((thread) => (
    String(thread.last_direction || "") === "inbound" && Number(thread.unread_count || 0) > 0
  ));
}

function decorateRecommended(row: Json, index: number): Json {
  const n = index + 1;
  const icon = recIcon(String(row.intent || ""));
  const rawLabel = String(row.source_label || (row.source === "ai" ? "今天推荐" : row.source === "catalog" ? "任务模板" : "按阶段"));
  const sourceLabel = rawLabel === "AI发现" || rawLabel === "AI 发现" || rawLabel === "今日任务" ? "今天推荐" : rawLabel;
  return {
    ...row,
    act: "ask",
    n,
    icon,
    source_label: sourceLabel,
    markdown: `${n}. ${icon} **${row.title}**  \n${row.reason} · ${sourceLabel}`,
  };
}

export function buildRecommendedTasks(tasks: Json[], kols: Json[], definitions = taskDefinitionIndex()): Json[] {
  const insights = tasks.filter((task) => (
    isInsightWorkItem(task)
    || (String(task.source || "") === "ai" && Boolean(task.promoted_at) && !isClosedWorkItem(task) && !task.dismissed_at)
  )).sort((a, b) => Number(highValueInsight(b)) - Number(highValueInsight(a)));
  const picked: Json[] = [];
  const seen = new Set<string>();
  const take = (row: Json, handle: string) => {
    if (picked.length >= MAX_RECOMMENDED_TASKS) return;
    const key = bareHandle(handle) || String(row.id);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ ...row, act: "ask" });
  };

  const handleOf = (kol: Json) => bareHandle(kol.handle || kol.kol_name);

  for (const kol of kols) {
    if (picked.length >= MAX_RECOMMENDED_TASKS) break;
    const handle = handleOf(kol);
    const unread = inboundUnread(kol);
    if (!unread || !handle) continue;
    const snippet = String(unread.last_snippet || "").replace(/\s+/g, " ").trim();
    take({
      id: `rec-mail-${kol.id}`,
      title: recTitle("reply_analysis", handle, undefined, "", definitions),
      reason: snippet ? `${snippet.slice(0, 48)}${snippet.length > 48 ? "…" : ""} · 待判断` : "有未读来信，先做回复分析",
      source: "ai",
      source_label: "今天推荐",
      intent: "reply_analysis",
      prompt: recPrompt("reply_analysis", handle, "", definitions),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  const kolByHandle = new Map<string, Json>();
  for (const kol of kols) {
    const handle = handleOf(kol);
    if (handle && !kolByHandle.has(handle)) kolByHandle.set(handle, kol);
  }

  for (const task of insights) {
    if (picked.length >= MAX_RECOMMENDED_TASKS) break;
    const handle = bareHandle(task.kol_name || (task.entities as { handle?: unknown } | undefined)?.handle);
    const kol = kolByHandle.get(handle);
    const intent = insightIntent(task, kol, definitions);
    if (!intent) continue;
    const days = Number(kol?.days_in_stage || 0);
    const reason = String(task.risk || task.history_summary || task.description || task.context || "").trim()
      || (days ? `停留 ${days} 天，建议跟进` : "系统注意到信号，确认后才进待办");
    take({
      id: `rec-ai-${task.id}`,
      title: recTitle(intent, handle, days, String(kol?.stage_code || ""), definitions),
      reason,
      source: "ai",
      source_label: "今天推荐",
      intent,
      prompt: recPrompt(intent, handle, String(kol?.stage_code || ""), definitions),
      handle,
      collaboration_id: task.collaboration_id || kol?.id || null,
    }, handle);
  }

  for (const kol of kols) {
    if (picked.length >= MAX_RECOMMENDED_TASKS) break;
    const handle = handleOf(kol);
    if (!handle) continue;
    if (kol.unbound) {
      take({
        id: `rec-stage-${kol.id}`,
        title: recTitle("creator_profile", handle, undefined, "", definitions),
        reason: "尚未进入生命周期",
        source: "stage",
        source_label: "按阶段",
        intent: "creator_profile",
        prompt: recPrompt("creator_profile", handle, "", definitions),
        handle,
        collaboration_id: null,
      }, handle);
      continue;
    }
    if (kol.exception) {
      const notes = String(kol.notes || "").trim();
      take({
        id: `rec-stage-${kol.id}`,
        title: recTitle("risk_scan", handle, undefined, "", definitions),
        reason: [notes, "需人选回到主流程"].filter(Boolean).join(" · "),
        source: "stage",
        source_label: "按阶段",
        intent: "risk_scan",
        prompt: recPrompt("risk_scan", handle, "", definitions),
        handle,
        collaboration_id: kol.id,
      }, handle);
      continue;
    }
    if (Number(kol.days_in_stage || 0) < 7) continue;
    const intent = "email_compose";
    take({
      id: `rec-stage-${kol.id}`,
      title: recTitle(intent, handle, Number(kol.days_in_stage || 0), String(kol.stage_code || ""), definitions),
      reason: `停留 ${kol.days_in_stage} 天 · 所处 ${String(kol.stage_label || "").trim() || "当前阶段"}`,
      source: "stage",
      source_label: "按阶段",
      intent,
      prompt: recPrompt(intent, handle, String(kol.stage_code || ""), definitions),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  const rest = [...kols].sort((a, b) => Number(b.days_in_stage || 0) - Number(a.days_in_stage || 0));
  for (const kol of rest) {
    if (picked.length >= MAX_RECOMMENDED_TASKS) break;
    const handle = handleOf(kol);
    if (!handle || kol.unbound || kol.exception) continue;
    const intent = "email_compose";
    const days = Number(kol.days_in_stage || 0);
    take({
      id: `rec-stage-${kol.id}`,
      title: recTitle(intent, handle, days || undefined, String(kol.stage_code || ""), definitions),
      reason: days
        ? `停留 ${days} 天 · 所处 ${String(kol.stage_label || "").trim() || "当前阶段"}`
        : `${String(kol.stage_label || "当前阶段")}，可以继续跟进`,
      source: "stage",
      source_label: "按阶段",
      intent,
      prompt: recPrompt(intent, handle, String(kol.stage_code || ""), definitions),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  for (const definition of definitions.values()) {
    if (picked.length >= MAX_RECOMMENDED_TASKS) break;
    if (!definition.in_market || definition.id.startsWith("sop_")) continue;
    const id = `rec-catalog-${definition.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push({
      id,
      title: definition.title,
      reason: definition.description,
      source: "catalog",
      source_label: "任务模板",
      intent: definition.id,
      prompt: recPrompt(definition.id, "", "", definitions),
      handle: "",
      collaboration_id: null,
      act: "ask",
    });
  }

  return picked.slice(0, MAX_RECOMMENDED_TASKS).map((row, index) => ({
    ...decorateRecommended(row, index),
    candidate: true,
  }));
}

/** BIZ-06 14-day timer fields — read-only projection. No scheduler, no auto-release. */
export function followReleaseTimer(lastInteractionAt?: string | null): {
  last_interaction_at: string | null;
  days_since_interaction: number | null;
  release_due_at: string | null;
  release_scheduler: false;
} {
  const raw = String(lastInteractionAt || "").trim();
  if (!raw) {
    return {
      last_interaction_at: null,
      days_since_interaction: null,
      release_due_at: null,
      release_scheduler: false,
    };
  }
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) {
    return {
      last_interaction_at: raw,
      days_since_interaction: null,
      release_due_at: null,
      release_scheduler: false,
    };
  }
  const days = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86_400_000));
  const due = new Date(start.getTime() + 14 * 86_400_000);
  return {
    last_interaction_at: start.toISOString(),
    days_since_interaction: days,
    release_due_at: due.toISOString(),
    release_scheduler: false,
  };
}

export function buildWorkbench(tasks: Json[], kols: Json[], definitions = taskDefinitionIndex()): Json {
  const open = tasks.filter((task) => isOpenWorkItem(task)).map((task) => ({ ...task } as Json));
  const todo = tasks.filter((task) => isTodoWorkItem(task)).map((task) => ({ ...task, candidate: false } as Json));
  const insights = tasks.filter((task) => isInsightWorkItem(task)).map((task) => ({ ...task, candidate: true } as Json));
  const today = tasks.filter((task) => isTodayWorkItem(task)).map((task) => ({ ...task } as Json));
  const waiting = open.filter((task) => ["waiting", "queued"].includes(String(task.status || "")));
  const overdue = open.filter((task) => dueFlags(task.due_at).overdue);
  const dueToday = open.filter((task) => dueFlags(task.due_at).due_today);
  return {
    summary: {
      open: open.length,
      overdue: overdue.length,
      due_today: dueToday.length,
      waiting: waiting.length,
      insights: insights.length,
    },
    // Counts above stay exact; the row lists are capped like every other board list.
    open: capped(open, MAX_WORKBENCH_TASKS).map(slimWorkbenchTask),
    todo: capped(todo, MAX_WORKBENCH_TASKS).map(slimWorkbenchTask),
    today: capped(today, MAX_WORKBENCH_TASKS).map(slimWorkbenchTask),
    insights: capped(insights, MAX_WORKBENCH_TASKS).map(slimWorkbenchTask),
    recommendations: buildRecommendedTasks(tasks, kols, definitions),
  };
}

function taskMatchesKol(task: Json, kol: { id: string; handle: string }): boolean {
  if (String(task.collaboration_id || "") === kol.id || String(task.project_id || "") === kol.id) return true;
  const entities = (task.entities && typeof task.entities === "object" ? task.entities : {}) as Record<string, unknown>;
  if (String(entities.handle || entities.kol_handle || "") === kol.handle) return true;
  const title = String(task.title || "");
  return title.includes(`@${kol.handle}`) || title.includes(kol.handle);
}

export function buildHomeBoard(options: { restoreOfficialStages?: boolean } = {}): Json {
  const conn = getConn();
  const owner = ownerId();
  const followScope = currentFollowScope();
  const definitions = taskDefinitionIndex();
  const collabs = (conn.prepare(
    "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != '' ORDER BY display_name",
  ).all() as Row[]).filter((row) => {
    if (!followScope.required) return true;
    if (!followScope.bound || followScope.status === "expired") return false;
    return matchesFollowedMailbox(row, followScope);
  });
  const allCollabs = conn.prepare("SELECT * FROM collaborations").all() as Row[];
  // A creator can have more than one Collaboration. Keep the count in the
  // home projection so the assistant can describe the relationship without
  // leaking internal IDs into the employee surface.
  const collaborationCounts = new Map<string, number>();
  for (const row of allCollabs) {
    const key = String(row.kol_uid || row.handle || row.display_name || "").trim();
    if (!key) continue;
    collaborationCounts.set(key, (collaborationCounts.get(key) || 0) + 1);
  }
  if (options.restoreOfficialStages !== false) restoreOfficialCollaborationStages([...allCollabs, ...collabs]);
  const creators = conn.prepare("SELECT * FROM claw_creators ORDER BY name").all() as Row[];
  const creatorByHandle = new Map(creators.map((row) => [String(row.handle || row.name || ""), row]));

  const taskRows = conn.prepare(
    "SELECT * FROM work_items WHERE owner_user_id=? ORDER BY updated_at DESC",
  ).all(owner) as Row[];
  const taskIds = taskRows.map((row) => String(row.id));
  const lastEventByTask = new Map<string, Row>();
  if (taskIds.length) {
    const placeholders = taskIds.map(() => "?").join(",");
    const eventRows = conn.prepare(
      `SELECT te.* FROM task_events te
       INNER JOIN (
         SELECT work_item_id, MAX(sequence) AS sequence
         FROM task_events WHERE work_item_id IN (${placeholders})
         GROUP BY work_item_id
       ) last ON last.work_item_id = te.work_item_id AND last.sequence = te.sequence`,
    ).all(...taskIds) as Row[];
    for (const event of eventRows) lastEventByTask.set(String(event.work_item_id), event);
  }

  const tasks: Json[] = taskRows.map((row) => {
    const definition = definitions.get(String(row.task_type));
    const last = lastEventByTask.get(String(row.id));
    const events = last ? [{
      id: last.id,
      type: last.event_type,
      label: last.label,
      status: last.status,
      summary: last.safe_summary,
      safe_summary: last.safe_summary,
      time: last.time,
      created_at: last.time,
    }] : [];
    return {
      id: String(row.id),
      title: String(row.title || ""),
      status: String(row.status || ""),
      source: String(row.source || "manual"),
      priority: normalizePriority(row.priority) || "normal",
      skill: String(row.skill || row.task_type || ""),
      profile: String(row.profile || ""),
      task_type: String(row.task_type || ""),
      project_id: row.project_id || null,
      collaboration_id: row.collaboration_id || null,
      session_id: row.session_id || null,
      owner_user_id: row.owner_user_id || null,
      due_at: row.due_at || null,
      start_date: row.start_date || null,
      content: String(row.content || ""),
      risk_level: String(row.risk_level || "none"),
      ...displayStatusOf(row),
      promoted_at: row.promoted_at || null,
      dismissed_at: row.dismissed_at || null,
      description: definition?.description || "",
      // `suggested_actions` is not read by any frontend module (nor by
      // /api/tasks/adopt-recommendation); the definition's actions stay on
      // GET /api/tasks rows only.
      input: parseJson(row.input),
      entities: parseJson(row.entities),
      history_summary: historySummary(events),
    } as Json;
  });

  const collabIds = collabs.map((row) => String(row.id));
  const sessionByCollab = new Map<string, string>();
  if (collabIds.length) {
    const placeholders = collabIds.map(() => "?").join(",");
    const sessionRows = conn.prepare(
      `SELECT collaboration_id, id FROM sessions
       WHERE collaboration_id IN (${placeholders}) AND deleted_at IS NULL AND archived_at IS NULL
       ORDER BY updated_at DESC`,
    ).all(...collabIds) as { collaboration_id: string; id: string }[];
    for (const row of sessionRows) {
      const id = String(row.collaboration_id);
      if (!sessionByCollab.has(id)) sessionByCollab.set(id, String(row.id));
    }
  }
  const mailByCollab = threadsByCollaborationIds(collabIds);

  const kols: Json[] = [];
  for (const row of collabs) {
    const creator = creatorByHandle.get(String(row.handle));
    const payload = parseJson(creator?.payload);
    const stageCode = normalizeStage(String(row.stage_code || ""));
    const exception = !BY_CODE[stageCode]?.main;
    const kol = {
      ...row,
      stage_code: stageCode,
      stage_label: label(String(row.stage_code)),
      exception,
      unbound: false,
      niche: String(payload.niche || row.niche || row.notes || ""),
      score: creator?.score ?? null,
      creator_id: creator?.id || null,
      creator_status: creator?.status || null,
      followers: String(row.followers || formatFollowers(creator?.followers) || ""),
      platform: String(row.platform || creator?.platform || ""),
      brand: String(row.brand || ""),
      audience_geo: String(row.audience_geo || ""),
      engagement_rate: String(row.engagement_rate || ""),
      duplicate_checked: Number(row.duplicate_checked || 0),
      collaboration_count: collaborationCounts.get(String(row.kol_uid || row.handle || row.display_name || "").trim()) || 1,
    };
    const related = tasks.filter((task) => taskMatchesKol(task, { id: String(row.id), handle: String(row.handle) }));
    const recent = related.length
      ? related.slice(0, 3).map((task) => `${task.title} · ${task.history_summary}`).join("；")
      : "暂无任务历史";
    const allThreads = mailByCollab.get(String(row.id)) || [];
    const unreadCount = allThreads.reduce((sum, thread) => sum + Number(thread.unread_count || 0), 0);
    const lastInteraction = allThreads.find((thread) => thread.last_at)?.last_at || null;
    // The full list stays on the in-memory kol because buildRecommendedTasks
    // reads it (`inboundUnread`) to decide the 有未读来信 recommendation; only
    // the serialized projection is capped, further down.
    const mailThreads = allThreads.map((thread) => ({
      conversation_id: String(thread.conversation_id || ""),
      subject: String(thread.subject || "(无主题)"),
      unread_count: Number(thread.unread_count || 0),
      last_snippet: String(thread.last_snippet || ""),
      last_from: String(thread.last_from || ""),
      last_from_name: String(thread.last_from_name || ""),
      last_at: thread.last_at ? String(thread.last_at) : null,
      last_direction: String(thread.last_direction || ""),
    }));
    kols.push(publicKol({
      ...kol,
      session_id: sessionByCollab.get(String(row.id)) || null,
      unread_count: unreadCount,
      mail_threads: mailThreads,
      ...followReleaseTimer(lastInteraction ? String(lastInteraction) : null),
      profile_tags: profileTags(kol),
      follow_style_tags: readFollowStyleTags(row),
      tasks: capped(related, MAX_KOL_TASKS).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        history_summary: task.history_summary,
      })),
      task_history: recent,
      ...cardFields(kol, recent),
    }));
  }

  const tabCodes = ["all", ...MAIN_STAGES.map((stage) => stage.code), "exception"];
  const tabs = tabCodes.map((code) => {
    const members = kols.filter((kol) => {
      if (code === "all") return true;
      if (code === "exception") return Boolean(kol.exception);
      return !kol.unbound && String(kol.stage_code) === code;
    });
    const relatedTasks = tasks.filter((task) => members.some((kol) => taskMatchesKol(task, { id: String(kol.id), handle: String(kol.handle) })));
    return {
      code,
      count: members.length,
      task_count: relatedTasks.length,
    };
  });

  const decoratedTasks = tasks.map((task) => {
    const kol = kols.find((row) => taskMatchesKol(task, { id: String(row.id), handle: String(row.handle) }));
    const collab = allCollabs.find((row) => taskMatchesKol(task, { id: String(row.id), handle: String(row.handle) }));
    const entities = (task.entities && typeof task.entities === "object" ? task.entities : {}) as Record<string, unknown>;
    const stageCode = normalizeStage(String((kol || collab)?.stage_code || ""));
    return {
      ...task,
      candidate: isInsightWorkItem(task),
      ...cardFields(kol || (collab ? {
        handle: collab.handle,
        display_name: collab.display_name,
        brand: collab.brand,
        owner_name: collab.owner_name,
        sku: collab.sku,
        qty: collab.qty,
        notes: collab.notes,
        stage_code: stageCode,
        stage_label: label(String(collab.stage_code || "")),
        days_in_stage: collab.days_in_stage,
        exception: Boolean(stageCode) && !BY_CODE[stageCode]?.main,
      } : { handle: entities.handle || entities.kol_handle }), String(task.history_summary || "暂无任务历史")),
    };
  });

  // Recommendations read the whole per-kol thread list above; the emitted board
  // caps it only now, so no board logic ever sees the truncated array.
  const workbench = buildWorkbench(decoratedTasks, kols, definitions);
  for (const kol of kols) {
    kol.mail_threads = capped(mailThreadsOf(kol), MAX_KOL_MAIL_THREADS);
  }

  return {
    entry: "memory",
    creates_session: false,
    kols,
    tasks: capped(decoratedTasks, MAX_BOARD_TASKS),
    tabs,
    workbench,
    stages: MAIN_STAGES.map((stage) => ({ code: stage.code, label: stage.label })),
    side_stages: SIDE_STAGES.map((stage) => ({ code: stage.code, label: stage.label })),
    creators_loaded: kols.length,
    tasks_loaded: Math.min(decoratedTasks.length, MAX_BOARD_TASKS),
    follow_scope: followScope,
  };
}

export function decorateTaskFromCollab(task: Json, collab?: Row): Json {
  const recent = String(task.history_summary || "暂无任务历史");
  if (!collab) {
    const entities = (task.entities && typeof task.entities === "object" ? task.entities : {}) as Record<string, unknown>;
    return { ...task, ...cardFields({ handle: entities.handle || entities.kol_handle }, recent) };
  }
  const stageCode = normalizeStage(String(collab.stage_code || ""));
  return {
    ...task,
    ...cardFields({
      handle: collab.handle,
      display_name: collab.display_name,
      brand: collab.brand,
      owner_name: collab.owner_name,
      sku: collab.sku,
      qty: collab.qty,
      group_brand_overlap: collab.group_brand_overlap,
      notes: collab.notes,
      stage_code: stageCode,
      stage_label: label(String(collab.stage_code || "")),
      days_in_stage: collab.days_in_stage,
      exception: !BY_CODE[stageCode]?.main,
    }, recent),
  };
}
