import type { Task, TodoLayoutItem } from "../api";
import { applyLayoutWhy, isClosedTask, isOpenTask, isPlanningTask, sortTodayTodos, todoPaneRows } from "./homeModel";
import { isTodayScheduled } from "./schedule";
import type { PlanScope } from "./todayPlan";

/**
 * Row projection per pane. 今日任务 and 我的待办 render one workspace over the
 * same open-task memory, so the only difference left is which slice each pane
 * answers for: today = 高风险 / 今天开始 / 临期到期 / 逾期; todo = all other
 * unfinished items. The split is mutually exclusive and complete.
 *
 * Lives outside homeModel because the date split is `schedule.ts`, which already
 * imports homeModel — keeping the slice here avoids a cycle.
 */
export function scopeRows(scope: PlanScope, tasks: Task[], layout?: TodoLayoutItem[] | null): Task[] {
  const open = tasks.filter((task) => isOpenTask(task) && !isPlanningTask(task));
  if (scope === "todo") {
    const activeRows = todoPaneRows(open.filter((task) => !isTodayScheduled(task)), "all", layout);
    // Discovery result history is a task record, not content inside the current result page.
    // Terminal discovery runs remain clickable here, while ordinary completed work stays out
    // of the active todo list as before.
    const discoveryHistory = tasks.filter((task) => (
      String(task.task_type || "") === "discovery_crawl"
      && Boolean(task.discovery_run_id)
      && isClosedTask(task)
      && !task.dismissed_at
    ));
    return [...activeRows, ...discoveryHistory];
  }
  return applyLayoutWhy(sortTodayTodos(open.filter((task) => isTodayScheduled(task))), layout);
}
