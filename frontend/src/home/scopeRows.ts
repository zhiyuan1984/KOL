import type { Task, TodoLayoutItem } from "../api";
import { applyLayoutWhy, isClosedTask, isOpenTask, isPlanningTask, sortTodayTodos, todoPaneRows } from "./homeModel";
import { isTodayScheduled } from "./schedule";
import type { PlanScope } from "./todayPlan";

/**
 * Row projection per pane. 今日任务 and 我的待办 render one workspace over the
 * same service-owned todo memory. Today is a focused subset; My Todo keeps the
 * full open-todo set, including the rows highlighted in Today.
 *
 * Lives outside homeModel because the date split is `schedule.ts`, which already
 * imports homeModel — keeping the slice here avoids a cycle.
 */
export function scopeRows(scope: PlanScope, tasks: Task[], layout?: TodoLayoutItem[] | null): Task[] {
  const open = tasks.filter((task) => isOpenTask(task) && !isPlanningTask(task));
  const hasPlanView = open.some((task) => task.plan_view === "today" || task.plan_view === "todo");
  const inScope = (task: Task, expected: PlanScope) => expected === "todo"
    ? true
    : hasPlanView ? task.plan_view === "today" : isTodayScheduled(task);
  if (scope === "todo") {
    const activeRows = todoPaneRows(open.filter((task) => inScope(task, "todo")), "all", layout);
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
  return applyLayoutWhy(sortTodayTodos(open.filter((task) => inScope(task, "today"))), layout);
}
