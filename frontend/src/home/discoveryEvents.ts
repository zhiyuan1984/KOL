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
  const keys = ["count", "n", "received", "raw_count", "deduped", "shortlist_count", "candidate_count"];
  for (const key of keys) {
    const value = Number(event[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const blob = `${event.label || ""} ${event.summary || ""} ${event.message || ""}`;
  const match = blob.match(/(\d+)\s*条/);
  if (match) return Number(match[1]);
  return null;
}

/**
 * Host 的真实事件 → 一行过程。映射要与后端写的类型对得上
 * （`crawl.*` 来自采集服务、`discovery.*` / `crawl_*` 来自 home-discovery、
 * `run.think` / `run.step` 来自简报 worker），否则过程流会装作跑得比实际快：
 * 「已排出候选」只在 artifact_ready 之后出现。
 */
export function discoveryEventCopy(event: TaskEvent): DiscoveryProcessStep | null {
  const type = eventTypeOf(event);
  // 推理单独走 think 块，不占步骤位。
  if (type === "run.think" || type === "run.stream") return null;
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
    return { id, kind: "collecting", label: "正在采集" };
  }
  if (/result_ready|采集完成/.test(blob)) {
    return { id, kind: "collect_done", label: "采集完成" };
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
  if (/queue|排队/.test(blob)) {
    return { id, kind: "queued", label: "排队" };
  }
  if (/crawl|采集/.test(blob)) {
    return { id, kind: "collecting", label: "正在采集" };
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
