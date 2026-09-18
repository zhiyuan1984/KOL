import type { Task, TaskEvent, TodoLayoutItem } from "../api";
import MemoryWorkRow from "./MemoryWorkRow";
import TodayPlanProgress from "./TodayPlanProgress";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import {
  OPEN_FILTERS,
  openBucket,
  todoPaneRows,
  type TodoListFilter,
} from "./homeModel";
import type { TodayPlanPhase } from "./todayPlan";

export default function TodoPane({
  tasks,
  filter,
  onFilter,
  dedupeNotice,
  busy,
  onAct,
  todoLayout,
  phase = "idle",
  events,
}: {
  tasks: Task[];
  filter: TodoListFilter;
  onFilter: (next: TodoListFilter) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
  todoLayout?: TodoLayoutItem[] | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  const official = todoPaneRows(tasks, filter, todoLayout);
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo">
      <TodayPlanProgress phase={phase} events={events} />
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <div className="task-filters" data-todo-filters aria-label="筛选未了结工作">
        {OPEN_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            data-todo-filter={value}
            onClick={() => onFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        className="today-todo-list"
        data-todo-md
        data-todo-list
        data-list-total={official.length}
        aria-label="未了结工作"
      >
        {official.length ? (
          <ol className="today-todo-ol">
            {official.map((task) => {
              const bucket = openBucket(task);
              if (!bucket) return null;
              return (
                <MemoryWorkRow
                  key={task.id}
                  task={task}
                  bucket={bucket}
                  busy={busy}
                  onAct={onAct}
                  pane="todo"
                />
              );
            })}
          </ol>
        ) : (
          <div className="task-empty" data-todo-empty="no-data">
            <strong>{HOME_TODO_EMPTY}</strong>
          </div>
        )}
      </section>
    </section>
  );
}
