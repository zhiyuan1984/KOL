import type { Task } from "../api";

export default function DisplayWorkRow({
  task,
  busy,
  onAct,
}: {
  task: Task;
  busy: boolean;
  onAct: (task: Task) => void;
}) {
  const why = String(task.layout_why || task.display_why || "").trim();
  const canAct = Boolean(task.id) && !String(task.id).startsWith("display:");
  return (
    <li className="today-todo-row today-display-row" data-today-todo={task.id} data-open-item={task.id} data-memory-kind="task_result">
      <div className="today-todo-line today-todo-line1">
        <span className="today-todo-title">
          <strong>{task.title}</strong>
        </span>
        <button
          type="button"
          className="today-todo-go"
          data-today-todo-act
          data-today-act={String(task.display_verb || "open")}
          data-home-entry="acknowledge-task"
          disabled={busy || !canAct}
          aria-label={String(task.display_label || task.next_action || "打开")}
          onClick={() => canAct && onAct(task)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {why ? <p className="today-todo-line today-todo-line2">{why}</p> : null}
    </li>
  );
}
