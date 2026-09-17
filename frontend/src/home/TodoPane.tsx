import type { Task } from "../api";
import MemoryWorkRow from "./MemoryWorkRow";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import {
  OPEN_FILTERS,
  isOpenTask,
  matchesTodoFilter,
  openBucket,
  sortOpenWorkItems,
  type TodoListFilter,
} from "./homeModel";

export default function TodoPane({
  tasks,
  filter,
  onFilter,
  dedupeNotice,
  busy,
  onAct,
}: {
  tasks: Task[];
  filter: TodoListFilter;
  onFilter: (next: TodoListFilter) => void;
  dedupeNotice: string;
  busy: boolean;
  onAct: (task: Task) => void;
}) {
  const official = sortOpenWorkItems(tasks.filter((task) => isOpenTask(task) && matchesTodoFilter(task, filter)));
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo">
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
