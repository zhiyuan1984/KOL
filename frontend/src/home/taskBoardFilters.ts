import type { Task } from "../api";
import { dueDayDiff, isClosedTask, isTaskException, taskPriorityRank } from "./homeModel";

export type BoardFilter = "all" | "iu" | "in" | "ui" | "normal" | "unclassified";
export type AttentionFilter = "overdue" | "due_today" | "exception";
export const BOARD_FILTERS: Array<{ id: BoardFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "iu", label: "重要紧急" },
  { id: "in", label: "重要" },
  { id: "ui", label: "紧急" },
  { id: "normal", label: "一般" },
  { id: "unclassified", label: "未分类" },
];
export const ATTENTION_FILTERS: Array<{ id: AttentionFilter; label: string }> = [
  { id: "overdue", label: "逾期" },
  { id: "due_today", label: "今天到期" },
  { id: "exception", label: "异常" },
];

export function matchesBoardFilter(task: Task, filter: BoardFilter): boolean {
  if (filter === "all") return true;
  const rank = taskPriorityRank(task);
  if (filter === "iu") return rank === 0;
  if (filter === "in") return rank === 1;
  if (filter === "ui") return rank === 2;
  if (filter === "normal") return rank === 3 || rank === 4;
  return rank === 5;
}

export function matchesAttentionFilter(task: Task, filter: AttentionFilter | null): boolean {
  if (!filter) return true;
  if (isClosedTask(task)) return false;
  if (filter === "exception") return isTaskException(task);
  const diff = dueDayDiff(task.due_at);
  return filter === "overdue" ? diff != null && diff < 0 : diff === 0;
}

export function matchesBoardQuery(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || [task.title, task.kol_name, task.layout_why, task.display_why, task.description]
    .map(value => String(value || "").toLowerCase()).join(" ").includes(needle);
}
