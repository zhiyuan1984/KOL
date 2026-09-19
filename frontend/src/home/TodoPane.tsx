import { useMemo } from "react";
import type { Task, TaskEvent } from "../api";
import DisplayWorkRow from "./DisplayWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import { groupDisplayTasks } from "./displayTasks";
import { isTodayScheduled } from "./schedule";
import { whyLine } from "./homeModel";
import type { TodoListFilter } from "./homeModel";
import type { TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";

export default function TodoPane({
  tasks,
  dedupeNotice,
  busy,
  onAct,
  onEdit,
  phase = "idle",
  events,
}: {
  tasks: Task[];
  filter?: TodoListFilter;
  onFilter?: (next: TodoListFilter) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  todoLayout?: unknown;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  // Rows are fixed frontend projections of base work items — no Codex output needed.
  const rows = useMemo(
    () => tasks
      .filter((task) => !isTodayScheduled(task))
      .map((task) => ({
        ...task,
        layout_why: String(task.layout_why || "").trim() || whyLine(task),
      })),
    [tasks],
  );
  const groups = useMemo(() => groupDisplayTasks(rows), [rows]);
  const loading = phase === "loading-memory" && !rows.length;
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo" data-todo-source="work_items">
      <TodayPlanProgress phase={phase} events={events} />
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <section
        className="today-todo-list"
        data-todo-md
        data-todo-list
        data-list-total={rows.length}
        aria-label="待办任务"
      >
        {rows.length ? (
          groups.map(({ group, rows: groupRows }) => (
            <section className="today-display-group" data-todo-group={group} key={group}>
              <h3 className="today-display-group-title">{group}</h3>
              <ol className="today-todo-ol">
                {groupRows.map((task) => (
                  <DisplayWorkRow key={task.id} task={task} busy={busy} onAct={onAct} onEdit={onEdit} />
                ))}
              </ol>
            </section>
          ))
        ) : (
          <div className="task-empty" data-todo-empty={loading ? "loading" : "none"}>
            <strong>{loading ? "正在读取当前任务" : HOME_TODO_EMPTY}</strong>
            <p>{loading ? "正在读取任务记忆。" : "今日范围之外的未了结任务会出现在这里。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}
