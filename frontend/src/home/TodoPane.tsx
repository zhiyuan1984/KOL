import { useMemo } from "react";
import type { Task, TaskEvent, TodayBrief, TodoLayoutItem } from "../api";
import PlanSummary from "./PlanSummary";
import TaskBoard from "./TaskBoard";
import TodayPlanProgress from "./TodayPlanProgress";
import { isTodayScheduled } from "./schedule";
import { applyTodoLayout, whyLine } from "./homeModel";
import type { TodoListFilter } from "./homeModel";
import type { TodayPlanPhase } from "./todayPlan";

export default function TodoPane({
  tasks,
  dedupeNotice,
  busy,
  onAct,
  onEdit,
  brief,
  phase = "idle",
  events,
  previousBrief,
  previousEvents,
  todoLayout,
}: {
  tasks: Task[];
  filter?: TodoListFilter;
  onFilter?: (next: TodoListFilter) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  previousBrief?: TodayBrief | null;
  previousEvents?: TaskEvent[] | null;
  todoLayout?: TodoLayoutItem[] | null;
}) {
  // Rows are fixed frontend projections of base work items — todo layout (if any)
  // only stamps Codex's why and ordering on top.
  const rows = useMemo(
    () => applyTodoLayout(
      tasks
        .filter((task) => !isTodayScheduled(task))
        .map((task) => ({
          ...task,
          layout_why: String(task.layout_why || "").trim() || whyLine(task),
        })),
      todoLayout,
    ),
    [tasks, todoLayout],
  );
  const loading = phase === "loading-memory" && !rows.length;
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo" data-todo-source="work_items">
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <TaskBoard
        title="我的待办"
        scope="todo"
        rows={rows}
        busy={busy}
        loading={loading}
        onAct={onAct}
        onEdit={onEdit}
        showPlanButton={false}
        planPhase={phase}
        stream={<>
          <TodayPlanProgress
            phase={phase}
            events={events}
            previousBrief={previousBrief}
            previousEvents={previousEvents}
            scope="todo"
          />
          <PlanSummary brief={brief} />
        </>}
      />
    </section>
  );
}
