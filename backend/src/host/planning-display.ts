import type { Json } from "../types.js";
import type { SourceItem, TodayPlanPack } from "./today-plan-context.js";
import { isTodayWorkItem, todayDateStr } from "./home-board.js";

const DISPLAY_VERBS = new Set(["retry_crawl", "open_batch", "analyze", "open", "approve", "edit", "handle"]);
function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function severity(item: SourceItem): number {
  const priority = String(item.priority || "").toLowerCase();
  return priority === "important_urgent" ? 0 : priority === "important" || priority === "high" ? 1 : priority === "urgent" ? 2 : priority === "normal" || priority === "medium" ? 3 : priority === "low" ? 4 : 5;
}

/** Published today_plan contract: the Host owns the complete authorized task
 * projection; the real model owns lead/sections/primary and optional wording.
 * This function never creates an AI result when a structured model brief is absent. */
export function withHostPlanningDisplay(brief: Json | null, pack: TodayPlanPack): Json | null {
  if (!brief) return null;
  const candidates = Array.isArray(brief.display_tasks) ? brief.display_tasks : [];
  const byId = new Map<string, Json>();
  for (const value of candidates) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Json;
    byId.set(String(row.work_item_id || ""), row);
  }
  const today = todayDateStr();
  const rankOf = (item: SourceItem): number => {
    const due = String(item.due_at || "");
    const urgency = due && due.slice(0, 10) < today ? 0 : due.startsWith(today) ? 1 : item.status === "running" || item.status === "in_progress" ? 2 : 3;
    return severity(item) * 10 + urgency;
  };
  const seen = new Set<string>();
  const formal = pack.catalog.filter((item) => {
    const id = String(item.work_item_id || "").trim();
    if (item.kind !== "formal_task" || !id || seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((a, b) => rankOf(a) - rankOf(b) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const display = formal.map((item, index): Json => {
    const id = String(item.work_item_id);
    const candidate = byId.get(id) || {};
    const requested = text(candidate.verb || candidate.action, "open");
    const verb = DISPLAY_VERBS.has(requested) ? requested : "open";
    const proposedLabel = text(candidate.label || candidate.next_action, "打开任务");
    const label = /待补阶段/.test(proposedLabel) || (verb !== "handle" && proposedLabel === "处理") ? "打开任务" : proposedLabel;
    const group = severity(item) === 0 ? "重要紧急" : severity(item) === 1 ? "重要" : severity(item) === 2 ? "紧急" : "其他";
    return { work_item_id: id, title: text(candidate.title, item.title || "打开任务"), why: text(candidate.why, item.reason || "未了结正式任务"), rank: index + 1, verb, label, next_action: label, icon: text(candidate.icon, item.status === "failed" || item.risk ? "⚠️" : "📋"), group, view: isTodayWorkItem(item) ? "today" : "todo" };
  });
  const previousStats = brief.stats && typeof brief.stats === "object" && !Array.isArray(brief.stats) ? brief.stats as Json : {};
  return { ...brief, display_tasks: display, source_cursor: pack.source_cursor,
    stats: { ...previousStats, ...pack.now_counts, unfinished: formal.length, candidates: pack.catalog.length, today_tasks: formal.filter(isTodayWorkItem).length, todo_tasks: formal.filter(item => !isTodayWorkItem(item)).length, stage_counts: pack.stage_counts, stage_counts_source: "starry_local_mirror" },
    increment_summary: `来源新增 ${pack.delta.added.length} 项、移除 ${pack.delta.removed.length} 项；展示 ${formal.length} 项正式任务` };
}
