import type { Task } from "../api";
import {
  dueLabel,
  openBucketLabel,
  openPrimaryAction,
  todayContentLine,
  type OpenBucket,
} from "./homeModel";

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
  const content = todayContentLine(task);
  const action = openPrimaryAction(bucket);
  const status = openBucketLabel(bucket);
  const actKind = bucket === "approval" ? "approve" : bucket === "later" ? "open" : "handle";
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
          className="today-todo-act"
          data-today-todo-act={pane === "today" ? true : undefined}
          data-todo-act
          data-today-act={actKind}
          data-home-entry="acknowledge-task"
          disabled={busy}
          onClick={() => onAct(task)}
        >
          {action}
        </button>
      </div>
      {content ? <p className="today-todo-line today-todo-line2">{content}</p> : null}
    </li>
  );
}
