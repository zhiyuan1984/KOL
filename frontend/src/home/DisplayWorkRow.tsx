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
  const label = String(task.display_label || "").trim();
  const verb = String(task.display_verb || task.next_action_code || "open");
  return (
    <li
      className="today-display-row"
      data-today-todo={task.id}
      data-open-item={task.id}
      data-today-display="codex"
      data-today-verb={verb}
    >
      <div className="today-display-line">
        <div className="today-display-copy">
          <strong className="today-display-title">{task.title}</strong>
          {why ? <p className="today-display-why">{why}</p> : null}
        </div>
        <button
          type="button"
          className="today-display-go"
          data-today-todo-act
          data-today-act={verb}
          data-home-entry="acknowledge-task"
          aria-label={label || "打开"}
          title={label || "打开"}
          disabled={busy}
          onClick={() => onAct(task)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h12M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </li>
  );
}
