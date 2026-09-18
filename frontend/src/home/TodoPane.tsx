import { useEffect, useMemo, useState } from "react";
import type { Task, TaskEvent } from "../api";
import DisplayWorkRow from "./DisplayWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import { projectDisplayTasks, type DisplayTaskRow } from "./displayTasks";
import { fetchTodayTasks } from "./todayTasksApi";
import { isTodayScheduled } from "./schedule";
import type { TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";

export default function TodoPane({
  tasks,
  dedupeNotice,
  busy,
  onAct,
  phase = "idle",
  events,
}: {
  tasks: Task[];
  filter?: string;
  onFilter?: (next: string) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
  todoLayout?: unknown;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  const [displayRows, setDisplayRows] = useState<DisplayTaskRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchTodayTasks().then((rows) => {
      if (!cancelled) setDisplayRows(rows);
    }).catch(() => {
      if (!cancelled) setDisplayRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const official = useMemo(
    () => projectDisplayTasks(displayRows, tasks).filter((task) => !isTodayScheduled(task)),
    [displayRows, tasks],
  );
  const waiting = displayRows == null || phase === "loading-memory" || phase === "planning";
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo" data-todo-source="task_result">
      <TodayPlanProgress phase={phase} events={events} />
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <section
        className="today-todo-list"
        data-todo-md
        data-todo-list
        data-todo-display="codex"
        data-list-total={official.length}
        aria-label="待办任务"
      >
        {official.length ? (
          <ol className="today-todo-ol">
            {official.map((task) => (
              <DisplayWorkRow key={task.id} task={task} busy={busy} onAct={onAct} />
            ))}
          </ol>
        ) : (
          <div className="task-empty" data-todo-empty={waiting ? "planning" : "no-display"}>
            <strong>{waiting ? "正在生成待办展示" : HOME_TODO_EMPTY}</strong>
            <p>{waiting ? "规划结束后这里只显示模型处理后的任务行。" : "没有截止日期在今天之后的展示任务。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}
