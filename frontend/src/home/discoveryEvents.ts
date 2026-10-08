import type { TaskEvent } from "../api";
import { thinkTail } from "./streamText";

export type DiscoveryProcessKind =
  | "queued"
  | "search"
  | "collecting"
  | "received"
  | "deduped"
  | "analyzing"
  | "collect_done"
  | "scoring"
  | "briefing"
  | "step"
  | "ranked"
  | "stopped"
  | "failed";

export type DiscoveryProcessStep = {
  id: string;
  kind: DiscoveryProcessKind;
  label: string;
  /** Backend event time, absent when the event does not carry a usable timestamp. */
  time?: string;
};

/** 最新一段 Codex 推理；更早的段只折算成计数（面板不自带滚动条）。 */
export type DiscoveryThink = {
  body: string;
  truncated: boolean;
  state: "running" | "done" | "failed";
  folded: number;
  /** Latest reasoning event time, shown only when persisted by the backend. */
  time?: string;
};

const FAILED_TYPES = /fail|error|cancel/;

/**
 * 只有采集服务自己的事件（`crawl.*` / `claw.*`）才是「正在采集」的依据。
 * 交付任务（harness）的 `run.*` 承载的是准备过程，它的 safe_summary 常是技能 id
 * （`crawler_collect`）：整条 blob 匹配 /crawl|采集/ 会把 `run.started`（「任务开始处理」）
 * 写成「正在采集」，于是在员工确认之前，采集块就开始宣称远端在采集。
 */
const CRAWL_SCOPED = /^(crawl|claw)([._-]|$)/;
/** 交付任务自己的过程行 → 过程状态行；如实转写它的标签，不冒充采集进度。 */
const PREP_LABEL: Record<string, string> = {
  "run.pending": "任务已加入队列",
  "run.queued": "任务已加入队列",
  "run.started": "任务开始处理",
  "run.progress": "任务处理中",
  "run.phase": "任务处理中",
};
const PREP_QUEUED = new Set(["run.pending", "run.queued"]);
/** 交付任务自己的终态事件（`run.completed` / `run.failed`）不占过程行：它不是采集结果。 */
const PREP_TERMINAL = new Set(["run.completed", "run.failed"]);

function eventBlob(event: TaskEvent): string {
  return [
    event.type,
    event.status,
    event.title,
    event.label,
    event.summary,
    event.message,
    event.phase,
    event.kind,
  ].map((item) => String(item || "")).join(" ").toLowerCase();
}

function eventTypeOf(event: TaskEvent): string {
  return String(event.type || event.event_type || "").toLowerCase();
}

function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Use the event's persisted time only; never substitute local receipt time. */
function eventTime(event: TaskEvent): string {
  const raw = String(event.created_at || event.time || event.timestamp || event.updated_at || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : formatClock(date);
}

/**
 * 计数优先读事件自带的字段（e2e 与历史事件用它），真实事件由 Host 写进
 * label / safe_summary 的「N 条」文案里——两条路都要能读到，缺了就写占位。
 */
function eventCount(event: TaskEvent): number | null {
  const keys = [
    "count", "n", "received", "raw_count", "deduped", "shortlist_count", "candidate_count",
    "collected_count", "fetched_count", "creator_count", "profile_count",
  ];
  for (const key of keys) {
    const value = Number(event[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const blob = `${event.label || ""} ${event.summary || ""} ${event.message || ""}`;
  const match = blob.match(/(\d+)\s*条/) || blob.match(/(\d+)\s*(?:creators?|profiles?|items?|posts?)/i);
  if (match) return Number(match[1]);
  return null;
}
function collectingLabel(count: number | null): string {
  return count == null ? "正在采集" : `已采集 ${count} 条`;
}
function crawlStatusLabel(event: TaskEvent, count: number | null): string {
  const blob = eventBlob(event);
  if (/upload/.test(blob)) return "正在上传采集结果";
  if (/analyz|processing_results|整理候选/.test(blob)) return "正在整理候选";
  return collectingLabel(count);
}

/**
 * Host 的真实事件 → 一行过程。映射要与后端写的类型对得上
 * （`crawl.*` 来自采集服务、`discovery.*` / `crawl_*` 来自 home-discovery、
 * `run.think` / `run.step` 来自简报 worker），否则过程流会装作跑得比实际快：
 * 「已排出候选」只在 artifact_ready 之后出现。
 */
export function discoveryEventCopy(event: TaskEvent): DiscoveryProcessStep | null {
  const type = eventTypeOf(event);
  // 推理单独走 think 块、说明单独走说明段，都不占步骤位（说明正文可能碰巧含「打分」「去重」等词）。
  if (type === "run.think" || type === "run.stream" || type === "run.say") return null;
  const blob = eventBlob(event);
  const count = eventCount(event);
  const id = String(event.id || event.type || event.status || event.label || Math.random());
  if (FAILED_TYPES.test(blob) && !/dedup/.test(blob)) {
    const reason = String(event.message || event.summary || event.label || event.title || "").trim();
    return {
      id,
      kind: "failed",
      label: reason ? `失败原因：${reason}` : "失败原因：检索没有完成",
    };
  }
  if (/stopped|已停止|已取消/.test(blob)) {
    return { id, kind: "stopped", label: "采集已停止" };
  }
  // 采集服务的操作行（「去重并写入达人库…」）——先认出来，别被下面的去重口径吃掉。
  if (/crawl[._]operation/.test(blob)) {
    return { id, kind: "collecting", label: collectingLabel(count) };
  }
  if (/result_ready|采集完成/.test(blob)) {
    return { id, kind: "collect_done", label: "采集完成" };
  }
  if (/crawl[._]status/.test(blob)) {
    return { id, kind: "collecting", label: crawlStatusLabel(event, count) };
  }
  if (/analyz|整理候选/.test(blob)) {
    return { id, kind: "analyzing", label: "整理候选" };
  }
  // 简报阶段：开始与结束是两件事，不能提前报「已排出候选」。
  if (/ranking_started|plan_started|生成发现简报/.test(blob)) {
    return { id, kind: "briefing", label: "正在生成发现简报" };
  }
  if (/artifact_ready|shortlist|已排出候选|\branked\b/.test(blob)) {
    return { id, kind: "ranked", label: "已排出候选" };
  }
  if (/scor|打分/.test(blob)) {
    return { id, kind: "scoring", label: "正在打分" };
  }
  if (/dedup|去重/.test(blob)) {
    return {
      id,
      kind: "deduped",
      label: count != null ? `采集结束去重后 ${count} 条` : "采集结束去重后 M 条",
    };
  }
  // crawl.progress / crawl.logs often carry the only trustworthy live count.
  // Handle it before the generic crawl branch so the count is not discarded.
  if (/crawl[._](?:progress|logs|status)/.test(blob) && count != null) {
    return { id, kind: "collecting", label: collectingLabel(count) };
  }
  if (/crawl[._]logs/.test(blob)) {
    return { id, kind: "collecting", label: "采集日志已更新" };
  }
  if (/queue|排队/.test(blob)) {
    return { id, kind: "queued", label: "排队" };
  }
  if (CRAWL_SCOPED.test(type)) {
    return { id, kind: "collecting", label: collectingLabel(count) };
  }
  if (/receiv|已收到|raw_count|got_\d|collected/.test(blob)) {
    return {
      id,
      kind: "received",
      label: count != null ? `已收到 ${count} 条` : "已收到 N 条",
    };
  }
  if (/search|keyword|开始搜索/.test(blob)) {
    return { id, kind: "search", label: "开始搜索关键词" };
  }
  // 交付任务自己的准备过程：照它的原文显示。run.completed / run.failed 是这一轮
  // 任务的收尾（不是采集结果），只用于判断过程流是否还会增长，不进过程行。
  if (PREP_LABEL[type]) {
    const label = String(event.label || event.title || "").trim();
    return { id, kind: PREP_QUEUED.has(type) ? "queued" : "step", label: label || PREP_LABEL[type] };
  }
  if (PREP_TERMINAL.has(type)) return null;
  if (type === "run.step") {
    const label = String(event.label || event.title || "").trim();
    return { id, kind: "step", label: label || "处理中" };
  }
  return null;
}

export function presentDiscoveryEvents(events: TaskEvent[]): DiscoveryProcessStep[] {
  const seen = new Set<string>();
  const steps: DiscoveryProcessStep[] = [];
  for (const event of events) {
    const step = discoveryEventCopy(event);
    if (!step) continue;
    const key = `${step.kind}:${step.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({ ...step, ...(eventTime(event) ? { time: eventTime(event) } : {}) });
    // A collector/brief failure is terminal for this run. Later asynchronous
    // trace writes must not be painted as successful follow-up milestones.
    if (step.kind === "failed" || step.kind === "stopped") break;
  }
  return steps;
}

export type DiscoveryNarrative = { body: string; running: boolean };

/** 简报 worker 先逐字写给员工看的说明（`run.say`），过程流里作为一段正文显示。 */
export function presentDiscoveryNarrative(events: TaskEvent[]): DiscoveryNarrative | null {
  let latest: TaskEvent | null = null;
  for (const event of events) {
    if (eventTypeOf(event) === "run.say" && String(event.summary || event.safe_summary || "").trim()) latest = event;
  }
  if (!latest) return null;
  return {
    body: String(latest.summary || latest.safe_summary || "").trim(),
    running: String(latest.status || "").toLowerCase() === "running",
  };
}

function thinkStateOf(event: TaskEvent): DiscoveryThink["state"] {
  const status = String(event.status || "").toLowerCase();
  if (/fail|error/.test(status)) return "failed";
  if (/running|streaming|started|pending/.test(status)) return "running";
  return "done";
}

/** 简报 worker 的推理流（`run.think`）→ 中栏的「Codex 推理」块。 */
export function presentDiscoveryThink(events: TaskEvent[]): DiscoveryThink | null {
  const rows: Array<{ body: string; state: DiscoveryThink["state"]; time: string }> = [];
  for (const event of events) {
    const step = discoveryEventCopy(event);
    if (step?.kind === "failed" || step?.kind === "stopped") break;
    const type = eventTypeOf(event);
    if (type !== "run.think" && type !== "run.stream") continue;
    const body = String(event.summary || event.safe_summary || "").trim();
    if (!body) continue;
    rows.push({ body, state: thinkStateOf(event), time: eventTime(event) });
  }
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const tail = thinkTail(last.body);
  return {
    body: tail.body,
    truncated: tail.truncated,
    state: last.state,
    folded: rows.length - 1,
    ...(last.time ? { time: last.time } : {}),
  };
}

/**
 * 远端采集状态（runtime 采集路径）。
 *
 * 后端 monitor 每次轮询远端都会刷新 `runtime_crawl_jobs.status_json` 与
 * `updated_at`，前端经 runtime action 视图（`startAction.crawl`，2s 轮询）拿到。
 * 这里只回答「远端还活着吗」：远端状态原文 → 中文标签 + 最后更新时间；
 * 超过阈值未更新即判停滞，不再让 UI 静默冻在「搜索中（已找到 0 个）」。
 */

/** 远端状态多久未更新算停滞。 */
export const REMOTE_CRAWL_STALE_MS = 120_000;

/** 仍在推进的远端作业状态（`runtime_crawl_jobs.state`）。 */
const REMOTE_CRAWL_ACTIVE = new Set(["queued", "starting", "running", "stopping"]);

const REMOTE_STATUS_LABEL: Record<string, string> = {
  running: "采集中",
  crawling: "采集中",
  queued: "排队中",
  pending: "排队中",
  starting: "启动中",
  stopping: "停止中",
  uploading: "上传结果中",
  analyzing: "整理结果中",
  idle: "远端空闲",
  completed: "远端已完成",
  done: "远端已完成",
  succeeded: "远端已完成",
  error: "远端失败",
  failed: "远端失败",
  timeout: "远端超时",
  timed_out: "远端超时",
  stopped: "远端已停止",
  cancelled: "远端已取消",
  canceled: "远端已取消",
};

export function remoteCrawlLabel(status: string): string {
  const key = String(status || "").toLowerCase();
  return REMOTE_STATUS_LABEL[key] || key || "未知";
}

export function formatAgo(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total} 秒前`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

export type RuntimeCrawlSnapshot = {
  state?: string | null;
  remote_status?: string | null;
  updated_at?: string | null;
  remote_task_id?: string | null;
  error_code?: string | null;
  result_state?: string | null;
  result_json?: { candidates?: unknown[] | null; complete?: boolean | null } | null;
  status_json?: { last_activity_at?: string | null; task_elapsed_seconds?: number | null } | null;
} | null | undefined;

export type RemoteCrawlView = {
  /** 中文标签，如"采集中"。 */
  label: string;
  /** 远端状态原文（小写），如"running"。 */
  status: string;
  /** "N 秒前"文案；尚无更新时间时为 ""。 */
  ago: string;
  /** 超过阈值未更新：采集可能停滞。 */
  stale: boolean;
  resultState: string;
  resultCount: number | null;
} | null;

/**
 * 由 runtime action 的 crawl 快照推导远端状态展示。终态也必须返回，
 * 否则中栏会在远端完成后丢失最终状态和候选回执。
 */
export function discoveryRemoteCrawlView(
  crawl: RuntimeCrawlSnapshot,
  nowMs: number,
): RemoteCrawlView {
  if (!crawl) return null;
  const state = String(crawl.state || "").toLowerCase();
  const resultState = String(crawl.result_state || "").toLowerCase();
  const status = String(crawl.remote_status || "").toLowerCase();
  const atMs = Date.parse(String(crawl.updated_at || ""));
  const hasAt = Number.isFinite(atMs);
  const ageMs = hasAt ? Math.max(0, nowMs - atMs) : -1;
  const terminal = state === "succeeded" || resultState === "ready";
  const failed = ["failed", "cancelled", "uncertain"].includes(state) || ["failed", "uncertain"].includes(resultState);
  const label = terminal ? "已完成" : failed ? "失败" : status ? remoteCrawlLabel(status) : "连接中";
  return {
    label,
    status,
    ago: hasAt ? `${formatAgo(ageMs)}更新` : "",
    stale: !terminal && hasAt && ageMs >= REMOTE_CRAWL_STALE_MS,
    resultState,
    resultCount: Array.isArray(crawl.result_json?.candidates) ? crawl.result_json.candidates.length : null,
  };
}
