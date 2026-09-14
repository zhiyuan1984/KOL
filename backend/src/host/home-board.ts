import { DEMO_USER } from "../config.js";
import { getConn } from "../db.js";
import { BY_CODE, MAIN_STAGES, PIPELINE_COLUMNS, SIDE_STAGES, coarse, label, nextCode, normalizeStage } from "../stages.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import type { Json, Row } from "../types.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { currentFollowScope, matchesFollowedMailbox } from "./starry-bind.js";
import { restoreOfficialCollaborationStage } from "../starrykol/library-sync.js";
import { stageMailAction } from "./compose-loop.js";
import { threadsForCollaboration, unreadCountForCollaboration } from "../starrykol/mail-sync.js";
import { readFollowStyleTags } from "../follow-style-tags.js";
import { listPendingDiscoveryCandidates } from "../discovery.js";

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
const DOMAIN_LABEL: Record<string, string> = {
  Lead: "线索",
  Opportunity: "商机",
  Negotiation: "谈判",
  Execution: "履约",
  "Settlement-Growth": "增长",
};

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

export function isTodoWorkItem(task: {
  source?: unknown;
  status?: unknown;
  promoted_at?: unknown;
  dismissed_at?: unknown;
}): boolean {
  if (isClosedWorkItem(task) || task.dismissed_at) return false;
  const source = String(task.source || "manual");
  if (source === "ai" || source === "discovery") return Boolean(task.promoted_at);
  return true;
}

export function dueFlags(dueAt: unknown): { overdue: boolean; due_today: boolean } {
  const day = dueDay(dueAt);
  if (!day) return { overdue: false, due_today: false };
  const today = startOfDay();
  return {
    overdue: day.getTime() < today.getTime(),
    due_today: day.getTime() === today.getTime(),
  };
}

export const MAX_RECOMMENDED_TASKS = 8;

function recPrompt(intent: string, handle: string, stage = ""): string {
  const definition = taskDefinition(intent);
  if (intent === "email_compose") {
    return handle
      ? stageMailAction(handle, stage).prompt
      : (definition?.aliases[0] || definition?.title || "写合作邮件");
  }
  const title = definition?.aliases[0] || definition?.title || intent;
  return handle ? `${title} @${handle}` : title;
}

function recTitle(intent: string, handle: string, days?: number, stage = ""): string {
  const who = handle ? `@${handle}` : "这位红人";
  const stay = Number(days) > 0 ? `停留 ${days} 天的 ` : "";
  if (intent === "email_compose") return `给${stay}${who} ${stageMailAction(handle, stage).label}`;
  const definition = taskDefinition(intent);
  const verb = definition?.title || intent;
  if (!handle) return verb;
  return `给 ${who} ${verb}`;
}

function insightIntent(task: Json, kol?: Json): string | null {
  const type = String(task.skill || task.skill_id || task.task_type || "");
  if (taskDefinition(type)) return type;
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
  return task.priority === "high" || task.priority === "urgent" || Boolean(task.risk) || String(task.status || "") === "failed";
}

function inboundUnread(kol: Json): Json | undefined {
  const threads = Array.isArray(kol.mail_threads) ? kol.mail_threads as Json[] : [];
  return threads.find((thread) => String(thread.last_direction || "") === "inbound" && Number(thread.unread_count || 0) > 0);
}

function decorateRecommended(row: Json, index: number): Json {
  const n = index + 1;
  const icon = recIcon(String(row.intent || ""));
  const sourceLabel = String(row.source_label || (row.source === "ai" ? "AI发现" : row.source === "catalog" ? "任务模板" : "按阶段"));
  return {
    ...row,
    act: "ask",
    n,
    icon,
    source_label: sourceLabel,
    markdown: `${n}. ${icon} **${row.title}**  \n${row.reason} · ${sourceLabel}`,
  };
}

function discoveryRec(candidate: Json): Json {
  const handle = bareHandle(candidate.handle || candidate.nickname);
  const followers = Number(candidate.followers || 0);
  const platform = String(candidate.platform || "");
  const score = Number(candidate.score || 0);
  const reasonBits = [
    platform || "海外平台",
    followers ? `${followers}粉` : "",
    score ? `评分 ${score}` : "",
    "待确认跟进，确认后才建合作",
  ].filter(Boolean);
  return {
    id: `rec-disc-${candidate.id}`,
    title: handle ? `发现 @${handle}` : "发现新达人",
    reason: reasonBits.join(" · "),
    source: "ai",
    source_label: "AI发现",
    intent: "creator_profile",
    prompt: recPrompt("creator_profile", handle),
    handle,
    collaboration_id: null,
    candidate_id: candidate.id,
    insight: true,
  };
}

export function buildRecommendedTasks(tasks: Json[], kols: Json[], discovery: Json[] = []): Json[] {
  const insights = tasks.filter(isInsightWorkItem).sort((a, b) => Number(highValueInsight(b)) - Number(highValueInsight(a)));
  const picked: Json[] = [];
  const seen = new Set<string>();
  const take = (row: Json, handle: string) => {
    if (picked.length >= MAX_RECOMMENDED_TASKS) return;
    const key = bareHandle(handle) || String(row.id);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ ...row, act: "ask" });
  };

  for (const kol of kols) {
    const handle = bareHandle(kol.handle || kol.kol_name);
    const unread = inboundUnread(kol);
    if (!unread || !handle) continue;
    const snippet = String(unread.last_snippet || "").replace(/\s+/g, " ").trim();
    take({
      id: `rec-mail-${kol.id}`,
      title: recTitle("reply_analysis", handle),
      reason: snippet ? `${snippet.slice(0, 48)}${snippet.length > 48 ? "…" : ""} · 待判断` : "有未读来信，先做回复分析",
      source: "ai",
      source_label: "AI发现",
      intent: "reply_analysis",
      prompt: recPrompt("reply_analysis", handle),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  for (const task of insights) {
    const handle = bareHandle(task.kol_name || (task.entities as { handle?: unknown } | undefined)?.handle);
    const kol = kols.find((row) => bareHandle(row.handle || row.kol_name) === handle);
    const intent = insightIntent(task, kol);
    if (!intent) continue;
    const days = Number(kol?.days_in_stage || 0);
    const reason = String(task.risk || task.history_summary || task.description || task.context || "").trim()
      || (days ? `停留 ${days} 天，建议跟进` : "系统注意到信号，确认后才进待办");
    take({
      id: `rec-ai-${task.id}`,
      title: recTitle(intent, handle, days, String(kol?.stage_code || "")),
      reason,
      source: "ai",
      source_label: "AI发现",
      intent,
      prompt: recPrompt(intent, handle, String(kol?.stage_code || "")),
      handle,
      collaboration_id: task.collaboration_id || kol?.id || null,
    }, handle);
  }

  for (const candidate of discovery) {
    const handle = bareHandle(candidate.handle || candidate.nickname);
    take(discoveryRec(candidate), handle);
  }

  for (const kol of kols) {
    const handle = bareHandle(kol.handle || kol.kol_name);
    if (!handle) continue;
    if (kol.unbound) {
      take({
        id: `rec-stage-${kol.id}`,
        title: recTitle("creator_profile", handle),
        reason: "尚未进入生命周期",
        source: "stage",
        source_label: "按阶段",
        intent: "creator_profile",
        prompt: recPrompt("creator_profile", handle),
        handle,
        collaboration_id: null,
      }, handle);
      continue;
    }
    if (kol.exception) {
      const notes = String(kol.notes || "").trim();
      take({
        id: `rec-stage-${kol.id}`,
        title: recTitle("risk_scan", handle),
        reason: [notes, "需人选回到主流程"].filter(Boolean).join(" · "),
        source: "stage",
        source_label: "按阶段",
        intent: "risk_scan",
        prompt: recPrompt("risk_scan", handle),
        handle,
        collaboration_id: kol.id,
      }, handle);
      continue;
    }
    if (Number(kol.days_in_stage || 0) < 7) continue;
    const intent = "email_compose";
    take({
      id: `rec-stage-${kol.id}`,
      title: recTitle(intent, handle, Number(kol.days_in_stage || 0), String(kol.stage_code || "")),
      reason: `停留 ${kol.days_in_stage} 天 · 所处 ${String(kol.stage_label || "").trim() || "当前阶段"}`,
      source: "stage",
      source_label: "按阶段",
      intent,
      prompt: recPrompt(intent, handle, String(kol.stage_code || "")),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  const rest = [...kols].sort((a, b) => Number(b.days_in_stage || 0) - Number(a.days_in_stage || 0));
  for (const kol of rest) {
    const handle = bareHandle(kol.handle || kol.kol_name);
    if (!handle || kol.unbound || kol.exception) continue;
    const intent = "email_compose";
    const days = Number(kol.days_in_stage || 0);
    take({
      id: `rec-stage-${kol.id}`,
      title: recTitle(intent, handle, days || undefined, String(kol.stage_code || "")),
      reason: days
        ? `停留 ${days} 天 · 所处 ${String(kol.stage_label || "").trim() || "当前阶段"}`
        : `${String(kol.stage_label || "当前阶段")}，可以继续跟进`,
      source: "stage",
      source_label: "按阶段",
      intent,
      prompt: recPrompt(intent, handle, String(kol.stage_code || "")),
      handle,
      collaboration_id: kol.id,
    }, handle);
  }

  for (const definition of taskDefinitions()) {
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
      prompt: recPrompt(definition.id, ""),
      handle: "",
      collaboration_id: null,
      act: "ask",
    });
  }

  return picked.slice(0, MAX_RECOMMENDED_TASKS).map(decorateRecommended);
}

export function buildWorkbench(tasks: Json[], kols: Json[], discovery: Json[] = []): Json {
  const todo = tasks.filter((task) => isTodoWorkItem(task));
  const insights = tasks.filter((task) => isInsightWorkItem(task));
  const waiting = todo.filter((task) => ["waiting", "queued"].includes(String(task.status || "")));
  const overdue = todo.filter((task) => dueFlags(task.due_at).overdue);
  const dueToday = todo.filter((task) => dueFlags(task.due_at).due_today);
  const stayTooLong = kols.filter((kol) => !kol.unbound && Number(kol.days_in_stage || 0) >= 7);
  const stages = MAIN_STAGES.map((stage) => ({
    code: stage.code,
    label: stage.label,
    count: kols.filter((kol) => !kol.unbound && String(kol.stage_code) === stage.code).length,
  }));
  const domains = PIPELINE_COLUMNS.map((id) => ({
    id,
    label: DOMAIN_LABEL[id] || id,
    count: kols.filter((kol) => !kol.unbound && !kol.exception && String(kol.coarse) === id).length,
  }));
  return {
    summary: {
      open: todo.length,
      overdue: overdue.length,
      due_today: dueToday.length,
      waiting: waiting.length,
      insights: insights.length,
    },
    todo,
    insights,
    recommendations: buildRecommendedTasks(tasks, kols, discovery),
    discovery: {
      pending_count: discovery.length,
      ready: discovery.length > 0,
      candidates: discovery,
    },
    lifecycle: {
      stages,
      domains,
      exception_count: kols.filter((kol) => Boolean(kol.exception)).length,
      stay_too_long: stayTooLong.map((kol) => ({
        id: kol.id,
        handle: kol.handle,
        stage_code: kol.stage_code,
        stage_label: kol.stage_label,
        days_in_stage: kol.days_in_stage,
        current_stage: kol.current_stage,
      })),
    },
  };
}

function taskMatchesKol(task: Json, kol: { id: string; handle: string }): boolean {
  if (String(task.collaboration_id || "") === kol.id || String(task.project_id || "") === kol.id) return true;
  const entities = (task.entities && typeof task.entities === "object" ? task.entities : {}) as Record<string, unknown>;
  if (String(entities.handle || entities.kol_handle || "") === kol.handle) return true;
  const title = String(task.title || "");
  return title.includes(`@${kol.handle}`) || title.includes(kol.handle);
}

export function buildHomeBoard(): Json {
  const conn = getConn();
  const owner = ownerId();
  const followScope = currentFollowScope();
  const collabs = (conn.prepare(
    "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != '' ORDER BY display_name",
  ).all() as Row[]).filter((row) => {
    if (!followScope.required) return true;
    if (!followScope.bound || followScope.status === "expired") return false;
    return matchesFollowedMailbox(row, followScope);
  });
  const allCollabs = conn.prepare("SELECT * FROM collaborations").all() as Row[];
  for (const row of collabs) restoreOfficialCollaborationStage(row);
  for (const row of allCollabs) restoreOfficialCollaborationStage(row);
  const creators = conn.prepare("SELECT * FROM claw_creators ORDER BY name").all() as Row[];
  const creatorByHandle = new Map(creators.map((row) => [String(row.handle || row.name || ""), row]));

  const taskRows = conn.prepare(
    "SELECT * FROM work_items WHERE owner_user_id=? ORDER BY updated_at DESC",
  ).all(owner) as Row[];
  const taskIds = taskRows.map((row) => String(row.id));
  const eventsByTask = new Map<string, Row[]>();
  if (taskIds.length) {
    const placeholders = taskIds.map(() => "?").join(",");
    const eventRows = conn.prepare(
      `SELECT * FROM task_events WHERE work_item_id IN (${placeholders}) ORDER BY work_item_id, sequence`,
    ).all(...taskIds) as Row[];
    for (const event of eventRows) {
      const list = eventsByTask.get(String(event.work_item_id)) || [];
      list.push(event);
      eventsByTask.set(String(event.work_item_id), list);
    }
  }

  const tasks: Json[] = taskRows.map((row) => {
    const definition = taskDefinition(String(row.task_type));
    const events = (eventsByTask.get(String(row.id)) || []).map((event) => ({
      id: event.id,
      type: event.event_type,
      label: event.label,
      status: event.status,
      summary: event.safe_summary,
      safe_summary: event.safe_summary,
      time: event.time,
      created_at: event.time,
    }));
    return {
      id: String(row.id),
      title: String(row.title || ""),
      status: String(row.status || ""),
      source: String(row.source || "manual"),
      priority: String(row.priority || "normal"),
      skill: String(row.skill || row.task_type || ""),
      profile: String(row.profile || ""),
      task_type: String(row.task_type || ""),
      project_id: row.project_id || null,
      collaboration_id: row.collaboration_id || null,
      session_id: row.session_id || null,
      owner_user_id: row.owner_user_id || null,
      due_at: row.due_at || null,
      promoted_at: row.promoted_at || null,
      dismissed_at: row.dismissed_at || null,
      description: definition?.description || "",
      suggested_actions: definition?.actions || [],
      input: parseJson(row.input),
      entities: parseJson(row.entities),
      history: events,
      history_summary: historySummary(events),
    } as Json;
  });

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
      coarse: coarse(String(row.stage_code)),
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
    };
    const related = tasks.filter((task) => taskMatchesKol(task, { id: String(row.id), handle: String(row.handle) }));
    const recent = related.length
      ? related.slice(0, 3).map((task) => `${task.title} · ${task.history_summary}`).join("；")
      : "暂无任务历史";
    const session = conn.prepare(
      "SELECT id FROM sessions WHERE collaboration_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
    ).get(String(row.id)) as { id: string } | undefined;
    const mailThreads = threadsForCollaboration(String(row.id)).map((thread) => ({
      conversation_id: String(thread.conversation_id || ""),
      subject: String(thread.subject || "(无主题)"),
      unread_count: Number(thread.unread_count || 0),
      last_snippet: String(thread.last_snippet || ""),
      last_from: String(thread.last_from || ""),
      last_from_name: String(thread.last_from_name || ""),
      last_at: thread.last_at ? String(thread.last_at) : null,
      last_direction: String(thread.last_direction || ""),
    }));
    const unreadCount = unreadCountForCollaboration(String(row.id));
    kols.push({
      ...kol,
      session_id: session?.id || null,
      unread_count: unreadCount,
      mail_threads: mailThreads,
      profile_tags: profileTags(kol),
      follow_style_tags: readFollowStyleTags(row),
      tasks: related.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        history_summary: task.history_summary,
      })),
      task_history: recent,
      ...cardFields(kol, recent),
    });
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

  return {
    kols,
    tasks: decoratedTasks,
    tabs,
    workbench: buildWorkbench(decoratedTasks, kols, listPendingDiscoveryCandidates(owner)),
    stages: MAIN_STAGES.map((stage) => ({ code: stage.code, label: stage.label })),
    side_stages: SIDE_STAGES.map((stage) => ({ code: stage.code, label: stage.label })),
    creators_loaded: kols.length,
    tasks_loaded: decoratedTasks.length,
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
