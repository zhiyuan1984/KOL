import { useEffect, useMemo, useState } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import DisplayWorkRow from "./DisplayWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { briefPrimaryLabel } from "./homeModel";
import { projectDisplayTasks, type DisplayTaskRow } from "./displayTasks";
import { fetchTodayTasks } from "./todayTasksApi";
import type { TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";

export default function TodayPane({
  todayTodos,
  busy,
  onAct,
  brief,
  phase = "idle",
  events,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  brief?: TodayBrief | null;
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
  }, [phase, brief?.lead, brief?.increment_summary]);

  const official = useMemo(
    () => projectDisplayTasks(displayRows, todayTodos),
    [displayRows, todayTodos],
  );
  const sections = Array.isArray(brief?.sections) ? brief.sections : [];
  const primaryLabel = briefPrimaryLabel(brief?.primary);
  const bannedPrimary = /处理|待补阶段/.test(primaryLabel);
  const waiting = displayRows == null || phase === "loading-memory" || phase === "planning";
  return (
    <section className="home-mode-pane" data-home-pane="today">
      <TodayPlanProgress phase={phase} events={events} />

      {brief ? (
        <section className="today-brief" data-today-brief>
          {brief.lead ? <p className="today-brief-lead" data-today-lead>{brief.lead}</p> : null}
          {primaryLabel && !bannedPrimary ? (
            <p className="today-brief-primary" data-today-primary data-today-primary-verb={brief.primary?.verb}>
              {primaryLabel}
            </p>
          ) : null}
          {sections.length ? (
            <div className="today-brief-sections" data-today-sections>
              {sections.map((section, index) => (
                <article key={`${section.title || "sec"}-${index}`} className="today-brief-section" data-today-section>
                  {section.title ? <h3>{section.title}</h3> : null}
                  {section.body ? <p>{section.body}</p> : null}
                  {Array.isArray(section.items) && section.items.length ? (
                    <ul>
                      {section.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        className="today-todo-list"
        data-today-list
        data-today-formal
        data-today-source="task_result"
        data-today-display="codex"
        data-list-total={official.length}
        aria-label="今日任务"
      >
        {official.length ? (
          <ol className="today-todo-ol">
            {official.map((task) => (
              <DisplayWorkRow key={task.id} task={task} busy={busy} onAct={onAct} />
            ))}
          </ol>
        ) : (
          <div className="task-empty" data-today-list-empty={waiting ? "planning" : "no-display"}>
            <strong>{waiting ? "正在规划今天的任务" : "还没有 Codex 展示任务"}</strong>
            <p>{waiting ? "规划结束后这里只显示模型处理后的任务行。" : "原料任务不会直接出现在今日列表。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}
