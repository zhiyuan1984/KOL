import type { Task } from "../api";
import {
  dueLabel,
  isTodayActionableTodo,
  sortTodayTodos,
  todayBucket,
  todayBucketLabel,
  todayContentLine,
  todayPrimaryAction,
  type TodayBucket,
} from "./homeModel";

function TodayTodoRow({
  task,
  bucket,
  busy,
  onAct,
}: {
  task: Task;
  bucket: TodayBucket;
  busy: boolean;
  onAct: (task: Task) => void;
}) {
  const due = dueLabel(task);
  const content = todayContentLine(task);
  const action = todayPrimaryAction(bucket);
  const status = todayBucketLabel(bucket);
  return (
    <li
      className="today-todo-row"
      data-today-todo={task.id}
      data-today-bucket={bucket}
      data-today-status={status}
      data-candidate="false"
    >
      <div className="today-todo-line today-todo-line1">
        <span className="today-todo-label" data-today-label={bucket}>{status}</span>
        <span className="today-todo-title">
          <strong>{task.title}</strong>
          {due ? <span className="today-todo-due" data-today-due={task.due_at}> · {due}</span> : null}
        </span>
        <button
          type="button"
          className="today-todo-act"
          data-today-todo-act
          data-today-act={bucket === "approval" ? "approve" : "handle"}
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

export default function TodayPane({
  todayTodos,
  busy,
  onAct,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
}) {
  const official = sortTodayTodos(todayTodos.filter(isTodayActionableTodo));
  return (
    <section className="home-mode-pane" data-home-pane="today">
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
                <TodayTodoRow
                  key={task.id}
                  task={task}
                  bucket={bucket}
                  busy={busy}
                  onAct={onAct}
                />
              );
            })}
          </ol>
        ) : (
          <div className="task-empty" data-today-list-empty="no-data">
            <strong>今天没有待处理事项</strong>
            <p>高风险、已逾期、今天到期、进行中和审批中的正式待办会出现在这里。</p>
          </div>
        )}
      </section>
    </section>
  );
}
