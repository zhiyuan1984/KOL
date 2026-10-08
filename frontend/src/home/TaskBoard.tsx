import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Task } from "../api";
import BoardRow from "./BoardRow";
import { dueDayDiff, isClosedTask, isTaskException, taskPriorityRank } from "./homeModel";
import { planStartEvent, SCOPE_CONFIG, TODAY_PLAN_REFRESH_EVENT, type PlanScope, type TodayPlanPhase } from "./todayPlan";
import "./today-plan-board.css";

type BoardFilter = "all" | "iu" | "in" | "ui" | "overdue" | "exception" | "normal";
type TaskBoardScope = PlanScope;

const FILTERS: Array<{ value: BoardFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "iu", label: "重要紧急" },
  { value: "in", label: "重要" },
  { value: "ui", label: "紧急" },
  { value: "overdue", label: "逾期" },
  { value: "exception", label: "异常" },
  { value: "normal", label: "正常" },
];

type BoardPreferences = { filter: BoardFilter; query: string };
function preferenceKey(scope: PlanScope): string { return `ui:home-${scope}-task-board`; }
function readPreferences(scope: PlanScope): BoardPreferences {
  try {
    const value = JSON.parse(sessionStorage.getItem(preferenceKey(scope)) || "null") as Partial<BoardPreferences> | null;
    const filter = FILTERS.some((item) => item.value === value?.filter) ? value!.filter! : "all";
    return { filter, query: String(value?.query || "") };
  } catch {
    return { filter: "all", query: "" };
  }
}

function matchesBoardFilter(task: Task, filter: BoardFilter): boolean {
  if (filter === "all") return true;
  const rank = taskPriorityRank(task);
  if (filter === "iu") return rank === 0;
  if (filter === "in") return rank === 1;
  if (filter === "ui") return rank === 2;
  if (filter === "overdue") return !isClosedTask(task) && dueDayDiff(task.due_at) != null && dueDayDiff(task.due_at)! < 0;
  if (filter === "exception") return isTaskException(task);
  const dayDiff = dueDayDiff(task.due_at);
  return rank >= 3 && !isTaskException(task) && (dayDiff == null || dayDiff >= 0);
}
function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: BoardFilter, select: (value: BoardFilter) => void) {
  const index = FILTERS.findIndex((item) => item.value === current);
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  const target = event.key === "Home" ? 0 : event.key === "End" ? FILTERS.length - 1 : (index + direction + FILTERS.length) % FILTERS.length;
  if (!direction && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const next = FILTERS[target];
  select(next.value);
  document.querySelector<HTMLButtonElement>(`[data-board-filter="${next.value}"]`)?.focus();
}

function matchesQuery(task: Task, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [task.title, task.kol_name, task.layout_why, task.display_why, task.description]
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
    .includes(needle);
}

/**
 * Planning runs only when this button is pressed, so the idle label names the
 * action instead of describing an automatic one. The button must answer the
 * click immediately, before any poll returns.
 */
export function planButtonState(phase: TodayPlanPhase, scope: TaskBoardScope = "today"): { label: string; busy: boolean; state: string } {
  const copy = SCOPE_CONFIG[scope];
  if (phase === "loading-memory") return { label: "正在读取…", busy: true, state: "starting" };
  if (phase === "planning") return { label: "正在整理…", busy: true, state: "planning" };
  // 失败后按钮说"重新规划"：和中栏失败卡是同一个动作，不要装作从零"生成"。
  if (phase === "failed") return { label: copy.boardRetryLabel, busy: false, state: "again" };
  if (phase === "refreshed") return { label: copy.boardAgainLabel, busy: false, state: "again" };
  return { label: copy.boardIdleLabel, busy: false, state: "idle" };
}

export default function TaskBoard({
  title,
  scope,
  rows,
  busy,
  loading,
  onAct,
  onOpen,
  onEdit,
  showPlanButton = true,
  planPhase = "idle",
  summary,
}: {
  title: string;
  scope: TaskBoardScope;
  rows: Task[];
  busy: boolean;
  loading: boolean;
  onAct: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  showPlanButton?: boolean;
  planPhase?: TodayPlanPhase;
  summary?: ReactNode;
}) {
  const [filter, setFilter] = useState<BoardFilter>(() => readPreferences(scope).filter);
  const [query, setQuery] = useState(() => readPreferences(scope).query);

  useEffect(() => {
    try { sessionStorage.setItem(preferenceKey(scope), JSON.stringify({ filter, query })); } catch { /* Storage is optional. */ }
  }, [scope, filter, query]);

  const counts = useMemo(() => {
    const tally: Record<BoardFilter, number> = { all: rows.length, iu: 0, in: 0, ui: 0, overdue: 0, exception: 0, normal: 0 };
    for (const task of rows) {
      if (matchesBoardFilter(task, "iu")) tally.iu += 1;
      if (matchesBoardFilter(task, "in")) tally.in += 1;
      if (matchesBoardFilter(task, "ui")) tally.ui += 1;
      if (matchesBoardFilter(task, "overdue")) tally.overdue += 1;
      if (matchesBoardFilter(task, "exception")) tally.exception += 1;
      if (matchesBoardFilter(task, "normal")) tally.normal += 1;
    }
    return tally;
  }, [rows]);

  const cfg = SCOPE_CONFIG[scope];
  const emptyCopy = cfg.emptyCopy;
  const filterLabel = `筛选${cfg.railToggleLabel}`;
  const filtered = useMemo(
    () => rows.filter((task) => matchesBoardFilter(task, filter) && matchesQuery(task, query)),
    [rows, filter, query],
  );
  const planButton = planButtonState(planPhase, scope);

  return (
    <section
      className="task-board"
      data-today-list={scope === "today" ? true : undefined}
      data-todo-list={scope === "todo" ? true : undefined}
      data-today-formal
      data-today-source="work_items"
      data-list-total={rows.length}
      aria-label={cfg.railToggleLabel}
    >
      <header className="task-board-head">
        <div className="task-board-heading">
          <h2>{title}</h2>
          <span className="task-board-count">{rows.length} 项</span>
          <span className="task-board-scope-note">{scope === "today" ? "今日安排与进展" : "当前未结责任清单"}</span>
        </div>
        <div className="task-board-tools">
          <input
            type="search"
            className="task-board-search"
            placeholder={cfg.boardSearchLabel}
            aria-label={cfg.boardSearchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="task-board-refresh" aria-label="刷新任务数据" title="刷新任务数据"
            disabled={loading || planButton.busy}
            onClick={() => window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT))}>刷新</button>
          {showPlanButton ? (
            <button
              type="button"
              className={"task-board-plan-btn is-" + planButton.state}
              data-plan-state={planButton.state}
              data-home-entry={`plan-${scope}`}
              disabled={planButton.busy}
              aria-busy={planButton.busy ? true : undefined}
              onClick={() => window.dispatchEvent(new Event(
                planStartEvent(scope),
              ))}
            >
              {planButton.busy ? <span className="task-board-plan-spin" aria-hidden /> : null}
              {!planButton.busy ? <svg className="task-board-plan-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d={planButton.state === "again" ? "M15 6a6 6 0 1 0 1 6" : "m8 5 6 5-6 5Z"} /><path d={planButton.state === "again" ? "M15 3v3h-3" : undefined} /></svg> : null}
              {planButton.label}
            </button>
          ) : null}
        </div>
      </header>

      <div className="task-board-filters" role="tablist" aria-label={filterLabel}>
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="task-board-tab"
            id={`task-board-tab-${scope}-${value}`}
            aria-selected={filter === value}
            aria-pressed={filter === value}
            aria-controls={`task-board-panel-${scope}`}
            tabIndex={filter === value ? 0 : -1}
            data-board-filter={value}
            data-attention-filter={value === "overdue" || value === "exception" ? value : undefined}
            onKeyDown={(event) => onTabKeyDown(event, filter, setFilter)}
            onClick={() => setFilter(value)}
          >
            <span>{label} {counts[value]}</span>
          </button>
        ))}
        {(filter !== "all" || query) ? <button type="button" className="task-board-clear-filter" onClick={() => {
          setFilter("all"); setQuery("");
        }}>清除筛选</button> : null}
        <span className="task-board-result-count" aria-live="polite">显示 {filtered.length} / {rows.length} 项</span>
      </div>
      {summary}

      <div id={`task-board-panel-${scope}`} className="task-board-panel" role="tabpanel" tabIndex={0} aria-labelledby={`task-board-tab-${scope}-${filter}`} aria-label="任务表">
      {filtered.length ? (
        <div className="task-board-table-scroll">
        <table className="task-board-table">
          <thead aria-hidden="true"><tr><th /><th /><th /></tr></thead>
          <tbody>
            {filtered.map((task, index) => (
              <BoardRow
                key={task.id}
                task={task}
                index={index}
                busy={busy}
                onAct={onAct}
                onOpen={onOpen}
                onEdit={onEdit}
              />
            ))}
          </tbody>
        </table>
        </div>
      ) : loading ? null : (
        <div className="task-empty" data-today-list-empty="none">
          <strong>{rows.length ? "没有符合筛选条件的任务" : emptyCopy.title}</strong>
          <p>{emptyCopy.hint}</p>
        </div>
      )}
      </div>
    </section>
  );
}
