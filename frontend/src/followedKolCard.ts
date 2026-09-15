/**
 * Homepage 「我跟进的红人」 work-card projection.
 * Goals (not a layout dogma): CONSTITUTION §4.2 + specs/UX-EMPLOYEE.md.
 * Home followed list is an object list of followed Collaboration/KOL records,
 * not a todo-status bar and not Pipeline.
 *
 * Board bags stay source material. Cards only render this model.
 */
import type { Task } from "./api";
import { MAIN_STAGE_TABS } from "./kolStages";
import { isMailHeaderDump, latestMailThread, summarizeMailSnippet } from "./mailPreview";

export type FollowedKolRecord = {
  id: string;
  handle: string;
  brand?: string;
  stage_code?: string;
  stage_label?: string;
  owner_name?: string;
  platform?: string;
  days_in_stage?: number;
  notes?: string;
  exception?: boolean;
  unbound?: boolean;
  overdue?: boolean | number;
  audience_geo?: string;
  mailbox_from?: string;
  stage_version?: number | string;
  updated_at?: string | null;
  last_updated?: string | null;
  profile_tags?: { id: string; label: string }[];
  follow_style_tags?: { id: string; label: string }[];
  task_history?: string;
  kol_name?: string;
  collab_summary?: string;
  recent_followup?: string;
  current_stage?: string;
  suggested_stage?: string;
  suggested_stage_code?: string | null;
  next_action?: string;
  tasks?: { id: string; title: string; status?: string; history_summary?: string }[];
  unread_count?: number;
  session_id?: string | null;
  mail_threads?: FollowedMailThread[];
};

export type FollowedMailThread = {
  conversation_id: string;
  subject?: string;
  unread_count?: number;
  last_snippet?: string;
  last_from?: string;
  last_from_name?: string;
  last_direction?: string;
  last_at?: string | null;
};

export type ActionOwner = "me" | "them" | "approver" | "exception" | "none";
export type KolSortMode = "need" | "recent" | "stay" | "unread";
export type FactKind = "inbound" | "outbound" | "confirmed" | "none";
export type RecommendedKind =
  | "confirm-stage"
  | "confirm-send"
  | "compose"
  | "open-session"
  | "approval"
  | "profile"
  | "insufficient";

export type FollowedKolCardModel = {
  id: string;
  handle: string;
  identity: { display: string; platform: string };
  scope: { brand: string; region: string; owner: string; mailbox: string };
  current_state: {
    stage_code: string;
    stage_label: string;
    days_in_stage: number | null;
    exception: boolean;
    unbound: boolean;
  };
  latest_fact: {
    kind: FactKind;
    summary: string;
    at: string | null;
    at_ms: number;
    source: string;
    thread_id: string;
  };
  recommended_action: {
    kind: RecommendedKind;
    label: string;
    target_stage_code: string;
    target_stage_label: string;
    why: string;
    can_write_stage: boolean;
  };
  evidence: {
    kind: "mail" | "task" | "session" | "stage_version" | "none";
    label: string;
    task_id: string;
    thread_id: string;
    session_id: string;
    stage_version: string;
  };
  risk: {
    exception: boolean;
    high_risk: boolean;
    overdue: boolean;
    unbound: boolean;
    chips: { id: string; label: string }[];
  };
  owner: ActionOwner;
  last_updated: number;
  unread_inbound: boolean;
  unread_count: number;
  waiting_confirm: boolean;
  days_in_stage: number;
  follow_style_tags: { id: string; label: string }[];
  task?: Task;
  focus_thread: string;
  source: FollowedKolRecord;
};

const CLOSED = new Set(["completed", "done", "cancelled"]);

/** Quiet badge / CTA stage copy: 已回复-有兴趣 → 已回复 · 有兴趣. */
export function formatStageBadge(label: string): string {
  return String(label || "").replace(/(\S)-(\S)/g, "$1 · $2").trim();
}

/** Primary stage CTA. Drop 「确认」 unless the write is irreversible (it is not). */
export function confirmStageCtaLabel(stageLabel: string): string {
  const stage = formatStageBadge(stageLabel);
  return stage ? `进入${stage} →` : "进入下一阶段 →";
}

/** Short in-card AI headline. Action verb lives on the button only. */
export function recommendedActionHeadline(rec: FollowedKolCardModel["recommended_action"]): string {
  if (rec.kind === "confirm-stage" && rec.target_stage_label) {
    return `建议进入「${formatStageBadge(rec.target_stage_label)}」`;
  }
  return rec.label;
}

/** Product-language judgment. Never leak support_transition / 「支撑进入」. */
export function inboundJudgmentWhy(summary: string): string {
  const text = String(summary || "");
  if (/合作|品牌|有兴趣|感兴趣|意愿|collab|interested/i.test(text)) {
    return "明确表达品牌合作意愿";
  }
  if (/报价|价格|rate\s*card|fee|报价单/i.test(text)) {
    return "来信涉及报价或商务条件";
  }
  if (/样品|sample|寄样|签收/i.test(text)) {
    return "来信提到样品或寄送";
  }
  if (text && !isMailHeaderDump(text)) {
    return "来信内容足以判断阶段";
  }
  return "来信显示可推进阶段";
}

export function stageLabelForCode(code?: string): string {
  const hit = MAIN_STAGE_TABS.find((stage) => stage.code === code);
  return hit?.label || "";
}

function bare(value: unknown): string {
  return String(value || "").replace(/^@/, "").trim();
}

function timeMs(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? 0 : ms;
}

function isClosedTask(task: Task): boolean {
  return CLOSED.has(String(task.status || ""));
}

function isTodoTask(task: Task): boolean {
  if (isClosedTask(task) || task.dismissed_at) return false;
  return task.source !== "ai" || Boolean(task.promoted_at);
}

function taskSkill(task: Task): string {
  return String(task.skill_id || task.skill || task.task_type || "").toLowerCase();
}

export function kolMatchesTask(kol: FollowedKolRecord, task: Task): boolean {
  const collabId = String(task.collaboration_id || task.project_id || "");
  if (collabId && collabId === kol.id) return true;
  const handle = bare(kol.handle);
  const taskHandle = bare(task.kol_name);
  return Boolean(handle && taskHandle && handle === taskHandle);
}

function relatedOpenTask(kol: FollowedKolRecord, tasks: Task[]): Task | undefined {
  return tasks.find((task) => {
    if (isClosedTask(task) || task.dismissed_at) return false;
    if (!isTodoTask(task) && String(task.status || "") !== "waiting_approval") return false;
    return kolMatchesTask(kol, task);
  });
}

function isApprovalTask(task: Task): boolean {
  const skill = taskSkill(task);
  const status = String(task.status || "");
  return status === "waiting_approval" || skill === "business_approval" || /审批/.test(task.title || "");
}

function isMailTask(task: Task): boolean {
  const skill = taskSkill(task);
  return skill === "email_compose" || skill === "stage_mail"
    || /确认发送|跟进邮件|报价信|草稿|催大纲/.test(`${task.title} ${task.next_action || ""}`);
}

function isStageTask(task: Task): boolean {
  const skill = taskSkill(task);
  return skill === "confirm_stage" || /记状态|阶段/.test(task.title || "");
}

function heuristicTarget(kol: FollowedKolRecord): { code: string; label: string } {
  const explicitCode = String(kol.suggested_stage_code || "").trim();
  const explicitLabel = String(kol.suggested_stage || "").trim();
  if (explicitCode) {
    return { code: explicitCode, label: explicitLabel || stageLabelForCode(explicitCode) };
  }
  if (explicitLabel && !/无需推进|待补阶段|已完成|^—$|需人选回到主流程/.test(explicitLabel)) {
    const fromLabel = MAIN_STAGE_TABS.find((stage) => stage.label === explicitLabel);
    return { code: fromLabel?.code || "", label: explicitLabel };
  }
  if (kol.unbound) return { code: "INITIAL_CONTACT", label: "初步接触" };
  if (kol.exception) return { code: "", label: "" };
  const index = MAIN_STAGE_TABS.findIndex((stage) => stage.code === kol.stage_code);
  if (index < 0 || index === MAIN_STAGE_TABS.length - 1) return { code: "", label: "" };
  const next = MAIN_STAGE_TABS[index + 1];
  return { code: next.code, label: next.label };
}

function digestMailQuote(thread: FollowedMailThread): string {
  const snippet = isMailHeaderDump(thread.last_snippet || "")
    ? ""
    : summarizeMailSnippet(thread.last_snippet || "");
  if (snippet) return snippet;
  const subject = String(thread.subject || "").trim();
  if (subject && !isMailHeaderDump(subject) && !/^re:\s*$/i.test(subject)) {
    return subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "").trim() || subject;
  }
  return "";
}

function latestFact(kol: FollowedKolRecord, related?: Task): FollowedKolCardModel["latest_fact"] {
  const thread = latestMailThread(kol.mail_threads);
  if (thread) {
    const direction = thread.last_direction === "outbound" ? "outbound" : thread.last_direction === "inbound" ? "inbound" : "none";
    const kind: FactKind = direction === "outbound" ? "outbound" : direction === "inbound" ? "inbound" : "none";
    const quote = digestMailQuote(thread);
    return {
      kind: kind === "none" ? "inbound" : kind,
      summary: quote || "最近一封往来邮件",
      at: thread.last_at || null,
      at_ms: timeMs(thread.last_at),
      source: "邮件",
      thread_id: String(thread.conversation_id || ""),
    };
  }
  if (related) {
    const when = String(related.due_at || "") || null;
    return {
      kind: "confirmed",
      summary: String(related.history_summary || related.title || "最近任务"),
      at: when,
      at_ms: timeMs(when),
      source: "任务",
      thread_id: "",
    };
  }
  return { kind: "none", summary: "暂无最新事实", at: null, at_ms: 0, source: "", thread_id: "" };
}

function riskOf(kol: FollowedKolRecord, related?: Task): FollowedKolCardModel["risk"] {
  const exception = Boolean(kol.exception);
  const unbound = Boolean(kol.unbound);
  const overdue = Boolean(Number(kol.overdue)) || Boolean(related && related.due_at && timeMs(related.due_at) && timeMs(related.due_at) < Date.now() - 86_400_000);
  const highRisk = exception
    || Boolean(related?.risk)
    || String(related?.status || "") === "failed"
    || /争议|失联|旁路|高风险/.test(`${kol.notes || ""} ${kol.stage_label || ""}`);
  const chips: { id: string; label: string }[] = [];
  if (exception) chips.push({ id: "exception", label: "异常" });
  if (highRisk && !exception) chips.push({ id: "high-risk", label: "高风险" });
  if (overdue) chips.push({ id: "overdue", label: "逾期跟进" });
  if (unbound) chips.push({ id: "unbound", label: "未绑定" });
  return { exception, high_risk: highRisk, overdue, unbound, chips };
}

function platformOf(kol: FollowedKolRecord): string {
  const raw = String(kol.platform || "").trim();
  if (raw) return raw;
  return kol.profile_tags?.find((tag) => tag.id === "platform")?.label || "";
}

function regionOf(kol: FollowedKolRecord): string {
  const raw = String(kol.audience_geo || "").trim();
  if (raw) return raw;
  const tag = kol.profile_tags?.find((tag) => tag.id === "geo")?.label || "";
  return tag.replace(/受众$/, "");
}

export function projectFollowedKolCard(kol: FollowedKolRecord, tasks: Task[] = []): FollowedKolCardModel {
  const handle = bare(kol.handle || kol.kol_name);
  const related = relatedOpenTask(kol, tasks);
  const unreadInbound = (kol.mail_threads || []).find((thread) => (
    thread.last_direction === "inbound" && Number(thread.unread_count || 0) > 0
  ));
  const unreadCount = Number(kol.unread_count || unreadInbound?.unread_count || 0);
  const fact = latestFact(kol, related);
  const risk = riskOf(kol, related);
  const target = heuristicTarget(kol);
  const stageLabel = kol.unbound
    ? "未进入生命周期"
    : String(kol.stage_label || "").trim() || "阶段未知";
  const days = kol.days_in_stage == null || String(kol.days_in_stage) === "" ? null : Number(kol.days_in_stage);
  const mailEvidence = Boolean(fact.thread_id && fact.kind !== "none");
  const taskEvidence = Boolean(related);
  const hasEvidence = mailEvidence || taskEvidence;
  const lastUpdated = Math.max(
    fact.at_ms,
    timeMs(kol.last_updated),
    timeMs(kol.updated_at),
  );

  let recommended: FollowedKolCardModel["recommended_action"] = {
    kind: "insufficient",
    label: "建议依据不足",
    target_stage_code: "",
    target_stage_label: "",
    why: "没有邮件或任务证据，不能把下一正式格当成建议。",
    can_write_stage: false,
  };
  let evidence: FollowedKolCardModel["evidence"] = {
    kind: "none",
    label: "暂无证据指针",
    task_id: "",
    thread_id: "",
    session_id: String(kol.session_id || ""),
    stage_version: kol.stage_version == null || kol.stage_version === "" ? "" : String(kol.stage_version),
  };
  let owner: ActionOwner = "none";
  let waitingConfirm = false;
  let focusThread = "";
  let task: Task | undefined;

  if (kol.unbound) {
    recommended = {
      kind: "profile",
      label: "补画像",
      target_stage_code: "",
      target_stage_label: "",
      why: "尚未进入生命周期，先补齐达人画像。",
      can_write_stage: false,
    };
    owner = "me";
  } else if (related && isApprovalTask(related)) {
    recommended = {
      kind: "approval",
      label: "去审批",
      target_stage_code: "",
      target_stage_label: "",
      why: related.history_summary || related.title || "审批在他人处",
      can_write_stage: false,
    };
    evidence = {
      ...evidence,
      kind: "task",
      label: related.title || "审批任务",
      task_id: related.id,
    };
    owner = "approver";
    task = related;
  } else if (related && isMailTask(related)) {
    const send = /确认发送|待确认发送|报价/.test(`${related.title} ${related.history_summary || ""} ${related.next_action || ""}`)
      || String(related.status || "") === "waiting";
    recommended = {
      kind: send ? "confirm-send" : "compose",
      label: send ? "确认发送" : "起草",
      target_stage_code: "",
      target_stage_label: "",
      why: related.history_summary || related.title || "待处理邮件任务",
      can_write_stage: false,
    };
    evidence = {
      ...evidence,
      kind: "task",
      label: related.title || "邮件任务",
      task_id: related.id,
    };
    owner = "me";
    waitingConfirm = send;
    task = related;
  } else if (unreadInbound) {
    recommended = {
      kind: "open-session",
      label: "查看来信",
      target_stage_code: "",
      target_stage_label: "",
      why: "有未读来信，先看事实再决定是否改阶段。",
      can_write_stage: false,
    };
    evidence = {
      ...evidence,
      kind: "mail",
      label: unreadInbound.subject || "未读来信",
      thread_id: String(unreadInbound.conversation_id || ""),
    };
    owner = "me";
    focusThread = String(unreadInbound.conversation_id || "");
  } else if (related && isStageTask(related) && target.code && target.label && hasEvidence) {
    recommended = {
      kind: "confirm-stage",
      label: confirmStageCtaLabel(target.label),
      target_stage_code: target.code,
      target_stage_label: target.label,
      why: inboundJudgmentWhy(fact.summary || related.title || ""),
      can_write_stage: true,
    };
    evidence = {
      ...evidence,
      kind: "task",
      label: related.title || "阶段确认任务",
      task_id: related.id,
      thread_id: fact.thread_id,
    };
    owner = "me";
    waitingConfirm = true;
    task = related;
  } else if (fact.kind === "inbound" && target.code && target.label && mailEvidence) {
    recommended = {
      kind: "confirm-stage",
      label: confirmStageCtaLabel(target.label),
      target_stage_code: target.code,
      target_stage_label: target.label,
      why: inboundJudgmentWhy(fact.summary),
      can_write_stage: true,
    };
    evidence = {
      ...evidence,
      kind: "mail",
      label: fact.summary,
      thread_id: fact.thread_id,
    };
    owner = "me";
    waitingConfirm = true;
    focusThread = fact.thread_id;
  } else if (related && isStageTask(related) && (!target.code || !target.label)) {
    recommended = {
      kind: "insufficient",
      label: "建议依据不足",
      target_stage_code: "",
      target_stage_label: "",
      why: "有阶段任务，但缺少目标阶段码，不能在首页启用写入。",
      can_write_stage: false,
    };
    evidence = {
      ...evidence,
      kind: "task",
      label: related.title || "阶段任务",
      task_id: related.id,
    };
    owner = "me";
    task = related;
  } else if (risk.exception || risk.high_risk) {
    owner = "exception";
    recommended = {
      kind: "insufficient",
      label: "建议依据不足",
      target_stage_code: "",
      target_stage_label: "",
      why: String(kol.notes || "").trim() || "异常旁路，需人选回到主流程，不能按下一正式格写入。",
      can_write_stage: false,
    };
  } else if (fact.kind === "outbound" || (!hasEvidence && !unreadCount)) {
    owner = fact.kind === "outbound" ? "them" : "them";
    recommended = {
      kind: "insufficient",
      label: fact.kind === "outbound" ? "等待对方" : "建议依据不足",
      target_stage_code: "",
      target_stage_label: "",
      why: fact.kind === "outbound"
        ? "已去信，先等对方。"
        : "没有邮件或任务证据，不能把下一正式格当成建议。",
      can_write_stage: false,
    };
    if (mailEvidence) {
      evidence = { ...evidence, kind: "mail", label: fact.summary, thread_id: fact.thread_id };
    }
  }

  if (risk.exception || risk.high_risk) owner = "exception";

  return {
    id: String(kol.id),
    handle,
    identity: {
      display: handle ? `@${handle}` : String(kol.kol_name || "未指定红人"),
      platform: platformOf(kol),
    },
    scope: {
      brand: String(kol.brand || "").trim(),
      region: regionOf(kol),
      owner: String(kol.owner_name || "").trim(),
      mailbox: String(kol.mailbox_from || "").trim(),
    },
    current_state: {
      stage_code: String(kol.stage_code || ""),
      stage_label: stageLabel,
      days_in_stage: Number.isFinite(Number(days)) ? Number(days) : null,
      exception: Boolean(kol.exception),
      unbound: Boolean(kol.unbound),
    },
    latest_fact: fact,
    recommended_action: recommended,
    evidence,
    risk,
    owner,
    last_updated: lastUpdated,
    unread_inbound: Boolean(unreadInbound) || unreadCount > 0,
    unread_count: unreadCount,
    waiting_confirm: waitingConfirm,
    days_in_stage: Number.isFinite(Number(days)) ? Number(days) : 0,
    follow_style_tags: kol.follow_style_tags || [],
    task,
    focus_thread: focusThread,
    source: kol,
  };
}

export function matchesKolSearch(card: FollowedKolCardModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    card.handle,
    card.identity.display,
    card.identity.platform,
    card.scope.brand,
    card.scope.region,
    card.scope.owner,
    card.scope.mailbox,
    card.current_state.stage_code,
    card.current_state.stage_label,
    card.source.kol_name,
    card.source.collab_summary,
    card.source.notes,
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

export function matchesStageFilter(card: FollowedKolCardModel, stageCode: string): boolean {
  if (!stageCode) return true;
  if (stageCode === "exception") {
    return Boolean(card.source.exception || card.current_state.exception || card.risk.exception);
  }
  return card.current_state.stage_code === stageCode;
}

/** Secondary stage filter helper. Exception cards stay off their formal stage tab. */
export function matchesStageTab(card: FollowedKolCardModel, tab: string): boolean {
  if (!tab || tab === "all") return true;
  if (tab === "exception") return Boolean(card.source.exception || card.current_state.exception || card.risk.exception);
  if (card.source.exception || card.current_state.exception) return false;
  return card.current_state.stage_code === tab;
}

export type FollowedKolCtaEmphasis = "quiet" | "strong";

/** L3 stage-enter is the only auto-emphasized list action (ADR-031 one-strong-CTA). */
export function isTopPriorityWorkAction(card: FollowedKolCardModel): boolean {
  return card.recommended_action.kind === "confirm-stage"
    && card.recommended_action.can_write_stage
    && Boolean(card.recommended_action.target_stage_label);
}

export function isDraftWorkAction(card: FollowedKolCardModel): boolean {
  return card.recommended_action.kind === "compose";
}

/** At most one auto-strong CTA: unique writable stage-enter in the viewport. */
export function soleTopPriorityCardId(cards: FollowedKolCardModel[]): string | null {
  const hits = cards.filter(isTopPriorityWorkAction);
  return hits.length === 1 ? hits[0].id : null;
}

/** Hover/focus beat selection; selection beats the sole list-priority. One card only. */
export function pickFollowedListCtaEmphasis(input: {
  cardId: string;
  hoveredId?: string | null;
  focusedId?: string | null;
  selectedId?: string | null;
  solePriorityId?: string | null;
}): FollowedKolCtaEmphasis {
  const active = input.hoveredId || input.focusedId || input.selectedId || input.solePriorityId || "";
  return active && active === input.cardId ? "strong" : "quiet";
}

function flag(value: boolean): number {
  return value ? 1 : 0;
}

function compareId(a: FollowedKolCardModel, b: FollowedKolCardModel): number {
  return String(a.id).localeCompare(String(b.id));
}

function keysNeed(a: FollowedKolCardModel, b: FollowedKolCardModel): number {
  return (
    flag(b.risk.exception || b.risk.high_risk) - flag(a.risk.exception || a.risk.high_risk)
    || flag(b.waiting_confirm) - flag(a.waiting_confirm)
    || flag(b.unread_inbound) - flag(a.unread_inbound)
    || flag(b.risk.overdue) - flag(a.risk.overdue)
    || b.days_in_stage - a.days_in_stage
    || b.latest_fact.at_ms - a.latest_fact.at_ms
    || b.last_updated - a.last_updated
    || compareId(a, b)
  );
}

/** Deterministic 1→8 keys. `visibleKols` must sort, not only filter. */
export function sortFollowedKolCards(cards: FollowedKolCardModel[], mode: KolSortMode = "need"): FollowedKolCardModel[] {
  return [...cards].sort((a, b) => {
    if (mode === "recent") {
      const aFresh = Math.max(a.last_updated, a.latest_fact.at_ms);
      const bFresh = Math.max(b.last_updated, b.latest_fact.at_ms);
      return (
        bFresh - aFresh
        || flag(b.risk.exception || b.risk.high_risk) - flag(a.risk.exception || a.risk.high_risk)
        || flag(b.waiting_confirm) - flag(a.waiting_confirm)
        || flag(b.unread_inbound) - flag(a.unread_inbound)
        || flag(b.risk.overdue) - flag(a.risk.overdue)
        || b.days_in_stage - a.days_in_stage
        || compareId(a, b)
      );
    }
    if (mode === "stay") {
      return (
        b.days_in_stage - a.days_in_stage
        || flag(b.risk.exception || b.risk.high_risk) - flag(a.risk.exception || a.risk.high_risk)
        || flag(b.waiting_confirm) - flag(a.waiting_confirm)
        || flag(b.unread_inbound) - flag(a.unread_inbound)
        || flag(b.risk.overdue) - flag(a.risk.overdue)
        || b.latest_fact.at_ms - a.latest_fact.at_ms
        || b.last_updated - a.last_updated
        || compareId(a, b)
      );
    }
    if (mode === "unread") {
      return (
        flag(b.unread_inbound) - flag(a.unread_inbound)
        || flag(b.risk.exception || b.risk.high_risk) - flag(a.risk.exception || a.risk.high_risk)
        || flag(b.waiting_confirm) - flag(a.waiting_confirm)
        || flag(b.risk.overdue) - flag(a.risk.overdue)
        || b.days_in_stage - a.days_in_stage
        || b.latest_fact.at_ms - a.latest_fact.at_ms
        || b.last_updated - a.last_updated
        || compareId(a, b)
      );
    }
    return keysNeed(a, b);
  });
}
