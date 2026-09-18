import type { TaskEvent } from "../api";

export type DiscoveryProcessStep = {
  id: string;
  kind:
    | "queued"
    | "search"
    | "received"
    | "deduped"
    | "scoring"
    | "ranked"
    | "failed";
  label: string;
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

export function discoveryEventCopy(event: TaskEvent): DiscoveryProcessStep | null {
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
  if (/rank|shortlist|排出候选|已排出/.test(blob)) {
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
  if (/queue|排队/.test(blob)) {
    return { id, kind: "queued", label: "排队" };
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
    steps.push(step);
  }
  return steps;
}
