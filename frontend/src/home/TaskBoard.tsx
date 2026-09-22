import { useMemo, useState, type ReactNode } from "react";
import type { Task } from "../api";
import BoardRow from "./BoardRow";
import { dueDayDiff, taskPriorityRank } from "./homeModel";
import { planStartEvent, SCOPE_CONFIG, type PlanScope, type TodayPlanPhase } from "./todayPlan";
import "./today-plan-board.css";

type BoardFilter = "all" | "iu" | "in" | "ui" | "nn";
type TaskBoardScope = PlanScope;

const FILTERS: Array<{ value: BoardFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "iu", label: "重要紧急" },
  { value: "in", label: "重要" },
  { value: "ui", label: "紧急" },
  { value: "nn", label: "一般" },
];

const COLLAPSED_ROWS = 5;

function FilterIcon({ value }: { value: BoardFilter }) {
  const path = value === "all"
    ? <path d="M4 7h16M7 12h10M10 17h4" />
    : value === "iu"
      ? <path d="m12 4 8 15H4L12 4Zm0 5v4M12 16h.01" />
      : value === "in"
        ? <path d="m12 4 2.4 4.8 5.3.8-3.8 3.7.9 5.2-4.8-2.5-4.8 2.5.9-5.2-3.8-3.7 5.3-.8L12 4Z" />
        : value === "ui"
          ? <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>
          : <circle cx="12" cy="12" r="6" />;
  return <svg className="today-board-filter-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{path}</svg>;
}

const SCOPE_EMPTY_COPY: Record<TaskBoardScope, { title: string; hint: string }> = {
  today: {
    title: "今天没有需要处理的任务",
    hint: "逾期、今天开始或到期、进行中和高优先的任务会出现在这里。",
  },
  todo: {
    title: "没有待办任务",
    hint: "今日范围之外的未了结任务会出现在这里。",
  },
};

function isImportant(task: Task): boolean {
  return taskPriorityRank(task) <= 2;
}

function isUrgent(task: Task): boolean {
  const diff = dueDayDiff(task.due_at);
  return diff != null && diff <= 0;
}

function matchesBoardFilter(task: Task, filter: BoardFilter): boolean {
  if (filter === "all") return true;
  const important = isImportant(task);
  const urgent = isUrgent(task);
  if (filter === "iu") return important && urgent;
  if (filter === "in") return important && !urgent;
  if (filter === "ui") return !important && urgent;
  return !important && !urgent;
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
  if (phase === "loading-memory") return { label: "正在启动…", busy: true, state: "starting" };
  if (phase === "planning") return { label: "正在规划…", busy: true, state: "planning" };
  if (phase === "refreshed" || phase === "failed") return { label: copy.boardAgainLabel, busy: false, state: "again" };
  return { label: copy.boardIdleLabel, busy: false, state: "idle" };
}

export default function TaskBoard({
  title,
  scope,
  rows,
  busy,
  loading,
  onAct,
  onEdit,
  showPlanButton = true,
  planPhase = "idle",
  stream,
}: {
  title: string;
  scope: TaskBoardScope;
  rows: Task[];
  busy: boolean;
  loading: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  showPlanButton?: boolean;
  planPhase?: TodayPlanPhase;
  /** The Codex stream + plan summary, rendered inside this workspace. */
  stream?: ReactNode;
}) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<BoardFilter, number> = { all: rows.length, iu: 0, in: 0, ui: 0, nn: 0 };
    for (const task of rows) {
      if (matchesBoardFilter(task, "iu")) tally.iu += 1;
      if (matchesBoardFilter(task, "in")) tally.in += 1;
      if (matchesBoardFilter(task, "ui")) tally.ui += 1;
      if (matchesBoardFilter(task, "nn")) tally.nn += 1;
    }
    return tally;
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((task) => matchesBoardFilter(task, filter) && matchesQuery(task, query)),
    [rows, filter, query],
  );
  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_ROWS);

  const emptyCopy = SCOPE_EMPTY_COPY[scope];
  const filterLabel = scope === "todo" ? "筛选待办任务" : "筛选今日任务";
  const planButton = planButtonState(planPhase, scope);

  return (
    <section
      className="today-board"
      data-today-list={scope === "today" ? true : undefined}
      data-todo-list={scope === "todo" ? true : undefined}
      data-today-formal
      data-today-source="work_items"
      data-list-total={rows.length}
      aria-label={scope === "todo" ? "待办任务" : "今日任务"}
    >
      <header className="today-board-head">
        <span className="today-board-head-icon" aria-hidden>
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="5" fill="#1a1a1a" />
            <path d="M8 12.2l2.6 2.6L16.4 9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 className="today-board-title">{title}</h2>
        <span className="today-board-count">· {rows.length} 项任务</span>
        <div className="today-board-tools">
          <input
            type="search"
            className="today-board-search"
            placeholder="搜索任务、红人或内容..."
            aria-label="搜索任务、红人或内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {showPlanButton && scope !== "today" ? (
            <button
              type="button"
              className={"today-board-plan-btn is-" + planButton.state}
              data-plan-state={planButton.state}
              data-home-entry={`plan-${scope}`}
              disabled={planButton.busy}
              aria-busy={planButton.busy ? true : undefined}
              onClick={() => window.dispatchEvent(new Event(
                planStartEvent(scope),
              ))}
            >
              {planButton.busy ? <span className="today-board-plan-spin" aria-hidden /> : null}
              {!planButton.busy ? <svg className="today-board-plan-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d={planButton.state === "again" ? "M15 6a6 6 0 1 0 1 6" : "m8 5 6 5-6 5Z"} /><path d={planButton.state === "again" ? "M15 3v3h-3" : undefined} /></svg> : null}
              {planButton.label}
            </button>
          ) : null}
        </div>
      </header>

      {stream ? <div className="today-board-stream" data-board-stream>{stream}</div> : null}

      <div className="today-board-filters" role="group" aria-label={filterLabel}>
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="today-board-pill"
            aria-pressed={filter === value}
            data-board-filter={value}
            onClick={() => setFilter(value)}
          >
            <FilterIcon value={value} />
            <span>{label} {counts[value]}</span>
          </button>
        ))}
      </div>

      {filtered.length ? (
        <div className="today-board-table-scroll" tabIndex={0} aria-label="任务表，可横向滚动">
        <table className="today-board-table">
          <thead>
            <tr>
              <th className="today-board-cell-index">#</th>
              <th>优先级</th>
              <th>任务标题</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((task, index) => (
              <BoardRow
                key={task.id}
                task={task}
                index={index}
                busy={busy}
                onAct={onAct}
                onEdit={onEdit}
              />
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="task-empty" data-today-list-empty={loading ? "loading" : "none"}>
          <strong>{loading ? "正在读取当前任务" : rows.length ? "没有符合筛选条件的任务" : emptyCopy.title}</strong>
          <p>{loading ? "正在读取任务记忆。" : emptyCopy.hint}</p>
        </div>
      )}

      {filtered.length > COLLAPSED_ROWS ? (
        <button
          type="button"
          className="today-board-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起任务列表" : `查看全部 ${filtered.length} 项任务`}
          <span aria-hidden className={"today-board-expand-chevron" + (expanded ? " is-up" : "")}>⌄</span>
        </button>
      ) : null}
    </section>
  );
}
