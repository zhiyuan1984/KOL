import { useState } from "react";
import Markdown from "../components/Markdown";
import type { Task } from "../api";
import { waitProgressHint, waitStatusLabel } from "../waitStatus";
import { HOME_TODO_EMPTY } from "./entryRegistry";
import {
  HOME_FOLD_LIMIT,
  HOME_TODO_BUCKETS,
  basisLine,
  dueLabel,
  handleLine,
  nextStepLine,
  objectLine,
  todoBucket,
  todoMark,
  urgencyLabel,
  whyLine,
  type TodoBucket,
  type TodoListFilter,
} from "./homeModel";

function FoldMore({
  total,
  limit = HOME_FOLD_LIMIT,
  expanded,
  onToggle,
}: {
  total: number;
  limit?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= limit) return null;
  const hidden = total - limit;
  return (
    <button type="button" className="home-fold-more" data-fold-more data-fold-expanded={expanded ? "true" : "false"} onClick={onToggle}>
      {expanded ? "收起" : `展开更多（${hidden}）`}
    </button>
  );
}

function useFoldedItems<T>(items: T[], limit = HOME_FOLD_LIMIT) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || items.length <= limit ? items : items.slice(0, limit);
  return {
    expanded,
    visible,
    toggle: () => setExpanded((value) => !value),
    total: items.length,
    limit,
  };
}

function TodoMarkdownRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const handle = handleLine(task);
  const object = objectLine(task);
  const due = dueLabel(task);
  const urgency = urgencyLabel(task);
  const progress = waitProgressHint(task);
  const why = whyLine(task);
  const basis = basisLine(task);
  const next = nextStepLine(task);
  return (
    <li
      className={`task-${task.source || "manual"} status-${task.status || "pending"}`}
      data-todo-card
      data-task-source={task.source || "manual"}
      data-task-status={task.status || "pending"}
      data-wait-status={waitStatusLabel(task.status)}
      data-candidate="false"
    >
      <button type="button" className="todo-card-act" data-todo-act data-home-entry="list-todos" onClick={onOpen}>
        <span className="todo-card-mark" aria-hidden>{todoMark(task)}</span>
        <div className="todo-card-copy">
          <div className="todo-card-main">
            <strong>{task.title}</strong>
            {handle ? <p className="todo-card-kicker">{handle}</p> : null}
          </div>
          {urgency || due ? (
            <p className="todo-card-status" data-todo-status>{[urgency, due].filter(Boolean).join(" · ")}</p>
          ) : null}
          {progress ? <p className="todo-card-progress">{progress}</p> : null}
          {why ? <p className="todo-card-why" data-todo-reason>{why}</p> : null}
          <p className="todo-card-biz16" data-todo-fields>
            {[
              object ? `对象 ${object}` : "",
              basis ? `依据 ${basis}` : "",
              due ? `期限 ${due}` : "",
              `状态 ${waitStatusLabel(task.status)}`,
              next ? `下一步 ${next}` : "",
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
      </button>
    </li>
  );
}

function TodoBucketBlock({
  bucket,
  label,
  tasks,
  onOpen,
}: {
  bucket: TodoBucket;
  label?: string;
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const fold = useFoldedItems(tasks);
  if (!tasks.length) return null;
  return (
    <div className="work-day-group" data-todo-bucket={bucket}>
      {label ? <Markdown>{`*${label}*`}</Markdown> : null}
      <ol className="recommend-md-list">
        {fold.visible.map((task) => (
          <TodoMarkdownRow key={task.id} task={task} onOpen={() => onOpen(task)} />
        ))}
      </ol>
      <FoldMore total={fold.total} limit={fold.limit} expanded={fold.expanded} onToggle={fold.toggle} />
    </div>
  );
}

function TodoActionList({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const grouped: Record<Exclude<TodoBucket, "waiting">, Task[]> = {
    overdue: [],
    today: [],
    approval: [],
    queued: [],
    running: [],
    open: [],
  };
  for (const task of tasks) {
    const bucket = todoBucket(task);
    if (bucket === "waiting") grouped.open.push(task);
    else grouped[bucket].push(task);
  }
  if (!tasks.length) {
    return (
      <div className="todo-md-empty" data-todo-empty="no-data">
        <Markdown>{HOME_TODO_EMPTY}</Markdown>
      </div>
    );
  }
  return (
    <section className="todo-md process-md" data-todo-md>
      {HOME_TODO_BUCKETS.map(([bucket, label]) => (
        <TodoBucketBlock key={bucket} bucket={bucket} label={label} tasks={grouped[bucket]} onOpen={onOpen} />
      ))}
      <TodoBucketBlock bucket="open" tasks={grouped.open} onOpen={onOpen} />
    </section>
  );
}

export default function TodoPane({
  tasks,
  filter,
  onFilter,
  dedupeNotice,
  onOpen,
}: {
  tasks: Task[];
  filter: TodoListFilter;
  onFilter: (next: TodoListFilter) => void;
  dedupeNotice: string;
  onOpen: (task: Task) => void;
}) {
  return (
    <section className="home-mode-pane today-work-inline" data-today-work data-home-pane="todo">
      {dedupeNotice ? (
        <p className="home-dedupe-notice" data-todo-deduped role="status">{dedupeNotice}</p>
      ) : null}
      <div className="task-filters" data-todo-filters aria-label="筛选待办">
        {([["all", "全部"], ["open", "待处理"], ["high", "高优先"]] as const).map(([value, label]) => (
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
      <TodoActionList tasks={tasks} onOpen={onOpen} />
    </section>
  );
}
