/** Date split for Today vs Todo. Constitution does not encode this. */
import type { Task } from "../api";
import {
  dueDayDiff,
  isApprovalStatus,
  isClosedTask,
  isHighRiskTask,
  isRunningStatus,
  taskPriorityRank,
} from "./homeModel";

function isStartToday(value?: string | null, now = new Date()): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return dueDayDiff(raw, now) === 0;
}

/** Today = high priority (重要紧急/重要/紧急) ∪ start today ∪ overdue/due today ∪ running ∪ approval ∪ high risk. */
export function isTodayScheduled(task: Task): boolean {
  if (isClosedTask(task) || task.dismissed_at) return false;
  if (taskPriorityRank(task) <= 2) return true;
  if (isStartToday(task.start_date || String(task.start_at || ""))) return true;
  const diff = dueDayDiff(task.due_at);
  if (diff != null && diff <= 0) return true;
  if (isRunningStatus(task.status)) return true;
  if (isApprovalStatus(task.status)) return true;
  if (isHighRiskTask(task)) return true;
  return false;
}
