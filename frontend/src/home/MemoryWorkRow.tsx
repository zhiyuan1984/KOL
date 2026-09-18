import type { Task } from "../api";
import {
  dueLabel,
  openBucketLabel,
  todayContentLine,
  todayActKind,
  todayGoLabel,
  type OpenBucket,
} from "./homeModel";

function GoRightArrow() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden data-send-arrow="ready">
      <path
        d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MemoryWorkRow({
  task,
  bucket,
  busy,
  onAct,
  pane,
}: {
  task: Task;
  bucket: OpenBucket;
  busy: boolean;
  onAct: (task: Task) => void;
  pane: "today" | "todo";
}) {
  const due = dueLabel(task);
  const content = String(task.layout_why || "").trim() || todayContentLine(task);
  const status = openBucketLabel(bucket);
  const actKind = todayActKind(bucket);
  const label = todayGoLabel(bucket);
  return (
    <li
      className="today-todo-row"
      data-today-todo={pane === "today" ? task.id : undefined}
      data-todo-card={pane === "todo" ? task.id : undefined}
      data-open-item={task.id}
      data-today-bucket={pane === "today" ? bucket : undefined}
      data-todo-bucket={pane === "todo" ? bucket : undefined}
      data-today-status={status}
      data-todo-status={status}
    >
      <div className="today-todo-line today-todo-line1">
        <span className="today-todo-label" data-today-label={bucket} data-todo-label={bucket}>{status}</span>
        <span className="today-todo-title">
          <strong>{task.title}</strong>
          {due ? <span className="today-todo-due" data-today-due={task.due_at}> · {due}</span> : null}
        </span>
        <button
          type="button"
          className="today-todo-act today-todo-go"
          data-today-todo-act={pane === "today" ? true : undefined}
          data-todo-act
          data-today-act={actKind}
          data-home-entry="acknowledge-task"
          disabled={busy}
          aria-label={label}
          onClick={() => onAct(task)}
        >
          <GoRightArrow />
        </button>
      </div>
      {content ? <p className="today-todo-line today-todo-line2">{content}</p> : null}
    </li>
  );
}
