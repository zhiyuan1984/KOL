import { useState } from "react";
import type { RecommendedTask, Task } from "../api";
import { recIcon } from "../recommendedTasks";
import { recommendationSourceLabel } from "./modes";
import { findDuplicateTodo, recommendationIdentity } from "./todoDedupe";
import { HOME_FOLD_LIMIT, handleLine, isHighValueInsight, todoMark, urgencyLabel, dueLabel, whyLine } from "./homeModel";

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

function RecommendedTaskList({
  items,
  todos,
  busy,
  onPick,
  onConvert,
}: {
  items: RecommendedTask[];
  todos: Task[];
  busy: boolean;
  onPick: (item: RecommendedTask) => void;
  onConvert: (item: RecommendedTask) => void;
}) {
  const fold = useFoldedItems(items);
  if (!items.length) return null;
  return (
    <section
      className="recommended-tasks process-md"
      data-recommended-tasks
      data-today-suggestions
      data-today-candidates
      data-list-total={items.length}
      aria-label="今天推荐"
    >
      <p className="home-lane-label">今天推荐</p>
      <ol className="recommend-md-list">
        {fold.visible.map((item) => {
          const n = item.n || 0;
          const icon = item.icon || recIcon(item.intent);
          const source = recommendationSourceLabel(item);
          const alreadyTodo = Boolean(findDuplicateTodo(todos, recommendationIdentity(item)));
          return (
            <li key={item.id} className="recommend-md-row" data-today-suggestion={item.id} data-candidate="true">
              <button
                type="button"
                className="recommend-md-item"
                data-recommended-task={item.id}
                data-task-n={n}
                data-recommended-source={item.source || "stage"}
                data-home-entry="composer-analyze"
                data-suggest-cta="prefill"
                data-act="ask"
                data-intent={item.intent || ""}
                data-prompt={item.prompt || item.title}
                aria-label={`推荐 ${n}`}
                disabled={busy}
                onClick={() => onPick(item)}
              >
                <span className="recommend-md-n" data-task-n-label>{n}.</span>
                <span className="recommend-md-icon" aria-hidden>{icon}</span>
                <span className="recommend-md-copy">
                  <strong>{item.title}</strong>
                  <span className="recommend-md-reason" data-recommended-reason>
                    {item.reason} · {source}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="recommend-to-todo"
                data-suggestion-to-todo={item.id}
                data-suggest-cta="todo"
                data-home-entry="adopt-recommendation"
                disabled={busy || alreadyTodo}
                onClick={() => onConvert(item)}
              >
                {alreadyTodo ? "已在待办" : "加入待办"}
              </button>
            </li>
          );
        })}
      </ol>
      <FoldMore total={fold.total} limit={fold.limit} expanded={fold.expanded} onToggle={fold.toggle} />
    </section>
  );
}

function InsightList({
  tasks,
  busy,
  onPromote,
  onDismiss,
  onOpen,
}: {
  tasks: Task[];
  busy: boolean;
  onPromote: (task: Task) => void;
  onDismiss: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const fold = useFoldedItems(tasks);
  if (!tasks.length) return null;
  return (
    <section className="insight-confirm process-md" data-insight-list data-list-total={tasks.length} aria-label="待确认建议">
      <p className="home-lane-label">待确认建议</p>
      <ol className="insight-card-list">
        {fold.visible.map((task) => (
          <li
            key={task.id}
            className={"insight-card" + (isHighValueInsight(task) ? " is-high" : "")}
            data-insight-card
            data-task-source="ai"
            data-candidate="true"
          >
            <div className="insight-card-body">
              <div className="todo-card-head">
                <strong>{task.title}</strong>
                <span className="todo-urgency">今天推荐</span>
                {isHighValueInsight(task) ? <span className="insight-high">高价值</span> : null}
              </div>
              {handleLine(task) ? <p className="todo-handle">{handleLine(task)}</p> : null}
              <p className="todo-reason">{whyLine(task)}</p>
            </div>
            <div className="insight-actions">
              <button
                type="button"
                className="insight-primary"
                data-promote-task={task.id}
                data-home-entry="adopt-recommendation"
                disabled={busy}
                onClick={() => onPromote(task)}
              >
                转为我的待办
              </button>
              <button type="button" className="is-ghost" data-open-insight={task.id} disabled={busy} onClick={() => onOpen(task)}>
                查看沟通记录
              </button>
              <button type="button" className="is-ghost" data-dismiss-insight={task.id} disabled={busy} onClick={() => onDismiss(task)}>
                忽略
              </button>
            </div>
          </li>
        ))}
      </ol>
      <FoldMore total={fold.total} limit={fold.limit} expanded={fold.expanded} onToggle={fold.toggle} />
    </section>
  );
}

export default function TodayPane({
  recommendedItems,
  todayTodos,
  insightItems,
  todos,
  busy,
  onPick,
  onConvert,
  onPromote,
  onDismiss,
  onOpen,
}: {
  recommendedItems: RecommendedTask[];
  todayTodos: Task[];
  insightItems: Task[];
  todos: Task[];
  busy: boolean;
  onPick: (item: RecommendedTask) => void;
  onConvert: (item: RecommendedTask) => void;
  onPromote: (task: Task) => void;
  onDismiss: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const showInsightList = insightItems.length > 0 || recommendedItems.length === 0;
  const insightCount = recommendedItems.length + (showInsightList ? insightItems.length : 0);
  return (
    <section
      className="home-mode-pane"
      data-home-pane="today"
      data-ai-insights
      data-ai-list-total={insightCount}
    >
      <section className="today-formal-todos" data-today-formal data-today-existing-todos aria-label="今日正式事项">
        <p className="home-lane-label">今日正式事项</p>
        {todayTodos.length ? (
          <ol className="recommend-md-list">
            {todayTodos.slice(0, HOME_FOLD_LIMIT).map((task) => (
              <li key={task.id} data-today-todo={task.id} data-candidate="false">
                <button type="button" className="todo-card-act" data-today-todo-act data-home-entry="list-todos" onClick={() => onOpen(task)}>
                  <span className="todo-card-mark" aria-hidden>{todoMark(task)}</span>
                  <div className="todo-card-copy">
                    <div className="todo-card-main">
                      <strong>{task.title}</strong>
                      {handleLine(task) ? <p className="todo-card-kicker">{handleLine(task)}</p> : null}
                    </div>
                    <p className="todo-card-status" data-todo-status>
                      {[urgencyLabel(task), dueLabel(task)].filter(Boolean).join(" · ") || "待处理"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="task-empty" data-today-formal-empty="no-data">
            <strong>今天还没有正式事项</strong>
            <p>今天推荐需要你采纳后才会出现在这里，不会自动写成待办。</p>
          </div>
        )}
      </section>
      <RecommendedTaskList
        items={recommendedItems}
        todos={todos}
        busy={busy}
        onPick={onPick}
        onConvert={onConvert}
      />
      {showInsightList ? (
        insightItems.length ? (
          <InsightList
            tasks={insightItems}
            busy={busy}
            onPromote={onPromote}
            onDismiss={onDismiss}
            onOpen={onOpen}
          />
        ) : recommendedItems.length === 0 ? (
          <div className="task-empty" data-today-candidates-empty="no-data">
            <strong>暂时没有新的建议</strong>
            <p>邮件和阶段建议会先停在这里，确认后才进入我的待办。</p>
          </div>
        ) : null
      ) : null}
    </section>
  );
}
