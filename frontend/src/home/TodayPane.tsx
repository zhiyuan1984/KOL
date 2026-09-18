import type { Task, TaskEvent, TodayBrief } from "../api";
import MemoryWorkRow from "./MemoryWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { briefPrimaryLabel, isTodayActionableTodo, sortTodayTodos, todayBucket } from "./homeModel";
import type { TodayPlanPhase } from "./todayPlan";

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
  const official = sortTodayTodos(todayTodos.filter(isTodayActionableTodo));
  const sections = Array.isArray(brief?.sections) ? brief.sections : [];
  const primaryLabel = briefPrimaryLabel(brief?.primary);
  const bannedPrimary = /处理|待补阶段/.test(primaryLabel);
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
        data-list-total={official.length}
        aria-label="今日任务"
      >
        {official.length ? (
          <ol className="today-todo-ol">
            {official.map((task) => {
              const bucket = todayBucket(task);
              if (!bucket) return null;
              return (
                <MemoryWorkRow
                  key={task.id}
                  task={task}
                  bucket={bucket}
                  busy={busy}
                  onAct={onAct}
                  pane="today"
                />
              );
            })}
          </ol>
        ) : (
          <div className="task-empty" data-today-list-empty="no-data">
            <strong>今天没有待处理事项</strong>
            <p>高风险、已逾期、今天到期、进行中和审批中的事项会出现在这里。</p>
          </div>
        )}
      </section>
    </section>
  );
}
