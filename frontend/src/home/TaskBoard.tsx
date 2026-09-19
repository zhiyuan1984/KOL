import { useMemo, useState } from "react";
import type { Task } from "../api";
import BoardRow from "./BoardRow";
import { dueDayDiff, taskPriorityRank } from "./homeModel";
import { TODAY_PLAN_REFRESH_EVENT } from "./todayPlan";
import "./today-plan-board.css";

type BoardFilter = "all" | "iu" | "in" | "ui" | "nn";
type TaskBoardScope = "today" | "todo";

const FILTERS: Array<{ value: BoardFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "iu", label: "重要且紧急" },
  { value: "in", label: "重要不紧急" },
  { value: "ui", label: "紧急不重要" },
  { value: "nn", label: "不紧急不重要" },
];

const COLLAPSED_ROWS = 5;

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

export default function TaskBoard({
  title,
  scope,
  rows,
  busy,
  loading,
  onAct,
  onEdit,
  showPlanButton = scope === "today",
}: {
  title: string;
  scope: TaskBoardScope;
  rows: Task[];
  busy: boolean;
  loading: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  showPlanButton?: boolean;
}) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);

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

  const onCheck = (id: string, on: boolean) => {
    setCheckedIds((current) => (on ? [...new Set([...current, id])] : current.filter((row) => row !== id)));
  };
  const allVisibleChecked = visible.length > 0 && visible.every((task) => checkedIds.includes(task.id));
  const toggleAll = (on: boolean) => {
    setCheckedIds((current) => {
      const visibleIds = visible.map((task) => task.id);
      return on
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.includes(id));
    });
  };

  const emptyCopy = SCOPE_EMPTY_COPY[scope];
  const filterLabel = scope === "todo" ? "筛选待办任务" : "筛选今日任务";

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
          {showPlanButton ? (
            <button
              type="button"
              className="today-board-plan-btn"
              onClick={() => window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT))}
            >
              自动启今日任务计划
            </button>
          ) : null}
        </div>
      </header>

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
            {label} {counts[value]}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <table className="today-board-table">
          <thead>
            <tr>
              <th className="today-board-cell-check">
                <input
                  type="checkbox"
                  className="today-board-check"
                  checked={allVisibleChecked}
                  aria-label="选择全部任务"
                  onChange={(event) => toggleAll(event.target.checked)}
                />
              </th>
              <th className="today-board-cell-index">#</th>
              <th>优先级</th>
              <th>任务标题</th>
              <th>来源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((task, index) => (
              <BoardRow
                key={task.id}
                task={task}
                index={index}
                checked={checkedIds.includes(task.id)}
                busy={busy}
                onCheck={onCheck}
                onAct={onAct}
                onEdit={onEdit}
              />
            ))}
          </tbody>
        </table>
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
