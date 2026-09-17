import { useState } from "react";
import type { RecommendedTask, Task } from "../api";
import { recIcon } from "../recommendedTasks";
import { recommendationSourceLabel } from "./modes";
import { findDuplicateTodo, recommendationIdentity } from "./todoDedupe";
import {
  canOpenExistingTaskFlow,
  handleLine,
  isHighValueInsight,
  nextStepLine,
  todoBucket,
  urgencyLabel,
  dueLabel,
  whyLine,
} from "./homeModel";
import "./today-rec-row.css";

const TODAY_FOLD_LIMIT = 3;

function GoArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FoldMore({
  total,
  limit = TODAY_FOLD_LIMIT,
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

function useFoldedItems<T>(items: T[], limit = TODAY_FOLD_LIMIT) {
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

function isExceptionTask(task: Task) {
  if (task.risk || String(task.status || "") === "failed") return true;
  const blob = `${task.title || ""} ${task.current_stage || ""} ${task.history_summary || ""}`;
  return /异常|拒绝|暂缓/.test(blob);
}

function statusIcon(task: Task) {
  if (isExceptionTask(task)) return "⚠";
  const bucket = todoBucket(task);
  if (bucket === "overdue") return "⏰";
  if (bucket === "today") return "📅";
  if (bucket === "approval" || bucket === "waiting") return "⏸";
  if (bucket === "running") return "⟳";
  return "○";
}

function pickPrimary(tasks: Task[]): Task | null {
  if (!tasks.length) return null;
  return (
    tasks.find(isExceptionTask) ||
    tasks.find((task) => todoBucket(task) === "overdue") ||
    tasks.find((task) => todoBucket(task) === "today") ||
    tasks.find((task) => todoBucket(task) === "approval") ||
    tasks[0]
  );
}

function primaryCta(task: Task) {
  if (isExceptionTask(task)) return { icon: "⚠", label: "去处理这条异常" };
  const bucket = todoBucket(task);
  if (bucket === "overdue") return { icon: "⏰", label: "先补上这条逴期" };
  if (bucket === "today") return { icon: "📅", label: "今天先做完这条" };
  if (bucket === "approval") return { icon: "⏸", label: "去审批" };
  if (canOpenExistingTaskFlow(task)) return { icon: "▶", label: "打开这条继续" };
  return { icon: "▶", label: "打开这条看看" };
}

function briefingCopy(tasks: Task[]) {
  const todayCount = tasks.length;
  const overdue = tasks.filter((task) => todoBucket(task) === "overdue").length;
  const dueToday = tasks.filter((task) => todoBucket(task) === "today").length;
  const exceptions = tasks.filter(isExceptionTask).length;
  const stats = exceptions
    ? `${todayCount}项今天待处理 · ${overdue}逴期 · ${dueToday}今天到期 · ${exceptions}条异常`
    : `${todayCount}项今天待处理 · ${overdue}逴期 · ${dueToday}今天到期`;
  if (exceptions) return { lead: "今天先处理异常。", stats };
  if (overdue) return { lead: "今天先补逴期。", stats };
  if (dueToday) return { lead: "今天没有异常，按到期顺序做。", stats };
  return { lead: "今天没有火烧事项，下面 1、2、3 按顺序做。", stats };
}

function duplicateIndex(todos: Task[], item: RecommendedTask, official: Task[]) {
  const hit = findDuplicateTodo(todos, recommendationIdentity(item));
  if (!hit) return 0;
  const idx = official.findIndex((task) => task.id === hit.id);
  if (idx >= 0) return idx + 1;
  const byTitle = official.findIndex((task) => task.title === item.title);
  return byTitle >= 0 ? byTitle + 1 : 0;
}

function RecommendedTaskList({
  items,
  todos,
  official,
  busy,
  onPick,
  onConvert,
}: {
  items: RecommendedTask[];
  todos: Task[];
  official: Task[];
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
      <p className="home-lane-label">2. 今天推荐</p>
      <ol className="recommend-md-list">
        {fold.visible.map((item, index) => {
          const n = index + 1;
          const icon = item.icon || recIcon(item.intent);
          const source = recommendationSourceLabel(item);
          const alreadyN = duplicateIndex(todos, item, official);
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
                aria-label={`推荐 ${n} ${item.title}`}
                disabled={busy}
                onClick={() => onPick(item)}
              >
                <span className="recommend-md-n" data-task-n-label>
                  {n}.
                </span>
                <span className="recommend-md-icon" aria-hidden>
                  {alreadyN ? "✓" : icon}
                </span>
                <span className="recommend-md-copy">
                  <strong>{item.title}</strong>
                  <span className="recommend-md-reason" data-recommended-reason>
                    {alreadyN ? `已在上面第 ${alreadyN} 条` : `${item.reason} · ${source}`}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={"recommend-to-todo recommend-to-todo-go" + (alreadyN ? " is-done" : "")}
                data-suggestion-to-todo={item.id}
                data-suggest-cta="todo"
                data-home-entry="adopt-recommendation"
                disabled={busy || Boolean(alreadyN)}
                onClick={() => onConvert(item)}
                aria-label={alreadyN ? `已在上面第 ${alreadyN} 条` : "开始这条"}
              >
                {alreadyN ? "✓" : <GoArrow />}
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
                {isHighValueInsight(task) ? <span className="insight-high">高价值</span> : null}
              </div>
              {handleLine(task) ? <p className="todo-handle">{handleLine(task)}</p> : null}
              <p className="todo-reason">{whyLine(task)}</p>
            </div>
            <div className="insight-actions">
              <button
                type="button"
                className="is-ghost"
                data-promote-task={task.id}
                data-home-entry="adopt-recommendation"
                disabled={busy}
                onClick={() => onPromote(task)}
              >
                开始这条
              </button>
              <button type="button" className="is-ghost" data-open-insight={task.id} disabled={busy} onClick={() => onOpen(task)}>
                查看
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
  const official = todayTodos;
  const primary = pickPrimary(official);
  const cta = primary ? primaryCta(primary) : null;
  const brief = briefingCopy(official);
  const fold = useFoldedItems(official);
  const showInsights = recommendedItems.length === 0 && insightItems.length > 0;

  return (
    <section className="home-mode-pane" data-home-pane="today" data-ai-insights data-ai-list-total={recommendedItems.length + insightItems.length}>
      <section className="today-brief" data-today-brief aria-label="今日简报">
        <p className="today-brief-lead">
          <span aria-hidden>📋</span> {brief.lead}
        </p>
        <p className="today-brief-stats">{brief.stats}</p>
        {primary && cta ? (
          <div className="today-primary" data-today-primary={primary.id}>
            <p className="today-primary-kicker">现在做这一件</p>
            <p className="today-primary-title">
              <span aria-hidden>{cta.icon}</span> {primary.title}
            </p>
            {handleLine(primary) || nextStepLine(primary) ? (
              <p className="today-primary-meta">
                {[handleLine(primary), nextStepLine(primary)].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <button
              type="button"
              className="todo-card-act today-primary-cta"
              data-today-todo-act
              data-home-entry="list-todos"
              disabled={busy}
              onClick={() => onOpen(primary)}
              aria-label={cta.label}
            >
              <span aria-hidden>{cta.icon}</span> {cta.label}
            </button>
          </div>
        ) : null}
      </section>

      <section className="today-formal-todos" data-today-formal data-today-existing-todos aria-label="已入队">
        <p className="home-lane-label">1. 已入队</p>
        {official.length ? (
          <ol className="recommend-md-list">
            {fold.visible.map((task, index) => (
              <li key={task.id} data-today-todo={task.id} data-candidate="false">
                <button type="button" className="recommend-md-item" data-home-entry="list-todos" onClick={() => onOpen(task)}>
                  <span className="recommend-md-n">{index + 1}.</span>
                  <span className="recommend-md-icon" aria-hidden>
                    {statusIcon(task)}
                  </span>
                  <span className="recommend-md-copy">
                    <strong>{task.title}</strong>
                    <span className="recommend-md-reason">
                      {[handleLine(task), nextStepLine(task) || urgencyLabel(task), dueLabel(task)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="task-empty" data-today-formal-empty="no-data">
            <strong>今天还没有正式事项</strong>
            <p>今天推荐需要你采纳后才会出现在这里，确认后才会进入已入队。</p>
          </div>
        )}
        <FoldMore total={fold.total} limit={fold.limit} expanded={fold.expanded} onToggle={fold.toggle} />
      </section>

      <RecommendedTaskList
        items={recommendedItems}
        todos={todos}
        official={official}
        busy={busy}
        onPick={onPick}
        onConvert={onConvert}
      />

      {showInsights ? (
        <InsightList tasks={insightItems} busy={busy} onPromote={onPromote} onDismiss={onDismiss} onOpen={onOpen} />
      ) : recommendedItems.length === 0 && official.length === 0 ? (
        <div className="task-empty" data-today-candidates-empty="no-data">
          <strong>暂时没有新的建议</strong>
          <p>邮件和阶段建议会先停在这里，确认后才会进入已入队。</p>
        </div>
      ) : null}
    </section>
  );
}
