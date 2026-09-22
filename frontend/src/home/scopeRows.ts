import type { Task, TodoLayoutItem } from "../api";
import { applyLayoutWhy, isOpenTask, isPlanningTask, sortTodayTodos, todoPaneRows } from "./homeModel";
import { isTodayScheduled } from "./schedule";
import type { PlanScope } from "./todayPlan";

/**
 * Row projection per pane. 今日任务 and 我的待办 render one workspace over the
 * same open-task memory, so the only difference left is which slice each pane
 * answers for: today = 今日范围 (逾期/今天到期/进行中/高优先), todo = 今日范围之外.
 *
 * Lives outside homeModel because the date split is `schedule.ts`, which already
 * imports homeModel — keeping the slice here avoids a cycle.
 */
export function scopeRows(scope: PlanScope, tasks: Task[], layout?: TodoLayoutItem[] | null): Task[] {
  const open = tasks.filter((task) => isOpenTask(task) && !isPlanningTask(task));
  if (scope === "todo") {
    return todoPaneRows(open.filter((task) => !isTodayScheduled(task)), "all", layout);
  }
  return applyLayoutWhy(sortTodayTodos(open.filter((task) => isTodayScheduled(task))), layout);
}
