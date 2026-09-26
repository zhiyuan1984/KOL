/** Date split for Today vs Todo. Constitution does not encode this. */
import type { Task } from "../api";
import {
  dueDayDiff,
  isClosedTask,
  isHighRiskTask,
} from "./homeModel";

function isStartToday(value?: string | null, now = new Date()): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return dueDayDiff(raw, now) === 0;
}

/**
 * Today = high risk ∪ starts today ∪ due today/within two days ∪ overdue.
 * Every other unfinished item belongs to My Todo, regardless of priority or
 * execution state. Keep this rule in sync with backend isTodayWorkItem().
 */
export function isTodayScheduled(task: Task): boolean {
  if (isClosedTask(task) || task.dismissed_at) return false;
  if (isHighRiskTask(task)) return true;
  if (isStartToday(task.start_date || String(task.start_at || ""))) return true;
  const diff = dueDayDiff(task.due_at);
  return diff != null && diff <= 2;
}
