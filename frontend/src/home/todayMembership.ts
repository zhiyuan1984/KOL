import type { Task } from "../api";
import { dueDayDiff } from "./homeModel";

function isPlanningTask(task: Task): boolean {
  return task.source === "planning" || task.task_type === "today_plan" || task.skill === "today_plan";
}

function isClosed(task: Task): boolean {
  const status = String(task.status || "").toLowerCase();
  return Boolean(task.dismissed_at) || status === "completed" || status === "cancelled" || status === "canceled" || status === "done";
}

function startAtOf(task: Task): string {
  return String(task.start_at || task.started_at || task.start_on || "").trim();
}

function dueAtOf(task: Task): string {
  return String(task.due_at || task.end_at || task.end_on || "").trim();
}

function isHotPriority(task: Task): boolean {
  const value = String(task.priority || "").toLowerCase();
  return value === "critical" || value === "important" || value === "urgent" || value === "high" || value === "重要紧急" || value === "重要" || value === "紧急";
}

/** No start and no due → today. Otherwise due_at is the deadline. Hot priority also stays on today. */
export function belongsOnToday(task: Task): boolean {
  if (isPlanningTask(task) || isClosed(task)) return false;
  if (isHotPriority(task)) return true;
  const start = startAtOf(task);
  const due = dueAtOf(task);
  if (!start && !due) return true;
  if (due) {
    const diff = dueDayDiff(due);
    return diff != null && diff <= 0;
  }
  return false;
}

export function belongsOnTodo(task: Task): boolean {
  if (isPlanningTask(task) || isClosed(task)) return false;
  return !belongsOnToday(task);
}
