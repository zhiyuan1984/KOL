import { useMemo } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import DisplayWorkRow from "./DisplayWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { briefPrimaryLabel, whyLine } from "./homeModel";
import { groupDisplayTasks } from "./displayTasks";
import type { TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";

export default function TodayPane({
  todayTodos,
  busy,
  onAct,
  onEdit,
  brief,
  phase = "idle",
  events,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  // Rows are fixed frontend projections of base work items — no Codex output needed.
  const rows = useMemo(
    () => todayTodos.map((task) => ({
      ...task,
      layout_why: String(task.layout_why || "").trim() || whyLine(task),
    })),
    [todayTodos],
  );
  const groups = useMemo(() => groupDisplayTasks(rows), [rows]);
  const sections = Array.isArray(brief?.sections) ? brief.sections : [];
  const primaryLabel = briefPrimaryLabel(brief?.primary);
  const bannedPrimary = /处理|待补阶段/.test(primaryLabel);
  const primaryObjectId = String(brief?.primary?.object_id || "").trim();
  const primaryTask = primaryObjectId ? rows.find((task) => task.id === primaryObjectId) : undefined;
  const loading = phase === "loading-memory" && !rows.length;
  return (
    <section className="home-mode-pane" data-home-pane="today">
      <TodayPlanProgress phase={phase} events={events} />

      {brief ? (
        <section className="today-brief" data-today-brief>
          {brief.lead ? <p className="today-brief-lead" data-today-lead>{brief.lead}</p> : null}
          {primaryLabel && !bannedPrimary ? (
            primaryTask ? (
              <button
                type="button"
                className="today-brief-primary today-brief-primary-btn"
                data-today-primary
                data-today-primary-verb={brief.primary?.verb}
                disabled={busy}
                onClick={() => onAct(primaryTask)}
              >
                {primaryLabel} →
              </button>
            ) : (
              <p className="today-brief-primary" data-today-primary data-today-primary-verb={brief.primary?.verb}>
                {primaryLabel}
              </p>
            )
          ) : null}
          {sections.length ? (
            <div className="today-brief-sections" data-today-sections key={String(brief.increment_summary || brief.lead || "")}>
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
        data-today-source="work_items"
        data-list-total={rows.length}
        aria-label="今日任务"
      >
        {rows.length ? (
          groups.map(({ group, rows: groupRows }) => (
            <section className="today-display-group" data-today-group={group} key={group}>
              <h3 className="today-display-group-title">{group}</h3>
              <ol className="today-todo-ol">
                {groupRows.map((task) => (
                  <DisplayWorkRow key={task.id} task={task} busy={busy} onAct={onAct} onEdit={onEdit} />
                ))}
              </ol>
            </section>
          ))
        ) : (
          <div className="task-empty" data-today-list-empty={loading ? "loading" : "none"}>
            <strong>{loading ? "正在读取当前任务" : "今天没有需要处理的任务"}</strong>
            <p>{loading ? "正在读取任务记忆。" : "逾期、今天开始或到期、进行中和高优先的任务会出现在这里。"}</p>
          </div>
        )}
      </section>
    </section>
  );
}
