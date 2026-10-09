import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "antd";
import { HighlightOutlined } from "@ant-design/icons";
import type { Task } from "../api";
import BoardRow from "./BoardRow";
import { LifecycleNavigation } from "../components/LifecycleNavigation";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { ATTENTION_FILTERS, BOARD_FILTERS, matchesAttentionFilter, matchesBoardFilter, matchesBoardQuery, type AttentionFilter, type BoardFilter } from "./taskBoardFilters";
import "../components/lifecycle-workspace.css";
import { planStartEvent, SCOPE_CONFIG, type PlanScope, type TodayPlanPhase } from "./todayPlan";
import "./today-plan-board.css";

type TaskBoardScope = PlanScope;
type BoardPreferences = { filter: BoardFilter; attention: AttentionFilter | null; query: string };
function preferenceKey(scope: PlanScope): string { return `ui:home-${scope}-task-board`; }
function readPreferences(scope: PlanScope): BoardPreferences {
  try {
    const value = JSON.parse(sessionStorage.getItem(preferenceKey(scope)) || "null") as Partial<BoardPreferences> | null;
    const filter = BOARD_FILTERS.some(item => item.id === value?.filter) ? value!.filter! : "all";
    const attention = ATTENTION_FILTERS.some(item => item.id === value?.attention) ? value!.attention! : null;
    return { filter, attention, query: String(value?.query || "") };
  } catch {
    return { filter: "all", attention: null, query: "" };
  }
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
  const [attention, setAttention] = useState<AttentionFilter | null>(() => readPreferences(scope).attention);
  const [query, setQuery] = useState(() => readPreferences(scope).query);

  useEffect(() => {
    try { sessionStorage.setItem(preferenceKey(scope), JSON.stringify({ filter, attention, query })); } catch { /* Storage is optional. */ }
  }, [scope, filter, attention, query]);

  const cfg = SCOPE_CONFIG[scope];
  const emptyCopy = cfg.emptyCopy;
  const queryRows = useMemo(() => rows.filter(task => matchesBoardQuery(task, query)), [rows, query]);
  const counts = useMemo(() => Object.fromEntries(BOARD_FILTERS.map(({ id }) => [id,
    queryRows.filter(task => matchesBoardFilter(task, id) && matchesAttentionFilter(task, attention)).length,
  ])) as Record<BoardFilter, number>, [queryRows, attention]);
  const attentionCounts = useMemo(() => Object.fromEntries(ATTENTION_FILTERS.map(({ id }) => [id,
    queryRows.filter(task => matchesBoardFilter(task, filter) && matchesAttentionFilter(task, id)).length,
  ])) as Record<AttentionFilter, number>, [queryRows, filter]);
  const filtered = useMemo(() => queryRows.filter(task => matchesBoardFilter(task, filter)
    && matchesAttentionFilter(task, attention)), [queryRows, filter, attention]);
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
          <div className="task-board-search-slot">
            <WorkspaceSearchInput
              className="task-board-search"
              placeholder={cfg.boardSearchLabel}
              aria-label={cfg.boardSearchLabel}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {showPlanButton ? (
            <Button
              type="text"
              size="small"
              className={"task-board-plan-btn is-" + planButton.state}
              data-plan-state={planButton.state}
              data-home-entry={`plan-${scope}`}
              disabled={planButton.busy}
              aria-busy={planButton.busy ? true : undefined}
              icon={planButton.busy
                ? <span className="task-board-plan-spin" aria-hidden />
                : <HighlightOutlined className="task-board-plan-icon" aria-hidden />}
              onClick={() => window.dispatchEvent(new Event(
                planStartEvent(scope),
              ))}
            >
              {planButton.label}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="task-board-filters">
        <LifecycleNavigation
          label={`按优先级筛选${cfg.railToggleLabel}`}
          mode="filter"
          idPrefix={`task-board-${scope}`}
          value={filter}
          onChange={value => setFilter(value as BoardFilter)}
          options={BOARD_FILTERS.filter(({ id }) => counts[id] > 0 || filter === id)
            .map(({ id, label }) => ({ id, label, count: counts[id], dataAttributes: { "data-board-filter": id } }))}
        />
      </div>
      <div className="task-board-attention" role="group" aria-label="任务提醒筛选">
        {ATTENTION_FILTERS.filter(({ id }) => attentionCounts[id] > 0 || attention === id).map(({ id, label }) => <button key={id} type="button"
          className="task-board-attention-filter" data-attention-filter={id}
          aria-pressed={attention === id} onClick={() => setAttention(attention === id ? null : id)}>
          {label} {attentionCounts[id]}
        </button>)}
        {(filter !== "all" || attention || query) ? <button type="button" className="task-board-clear-filter"
          onClick={() => { setFilter("all"); setAttention(null); setQuery(""); }}>清除筛选</button> : null}
        <span className="sr-only" role="status">{filtered.length} 项符合当前筛选；提醒可重叠，不作合计</span>
      </div>
      {summary}

      <div id={`task-board-panel-${scope}`} className="task-board-panel" role="region" tabIndex={0} aria-label="任务表">
      {filtered.length ? (
        <div className="task-board-table-scroll">
        <table className="task-board-table">
          <colgroup>
            <col className="task-board-col-title" />
            <col className="task-board-col-status" />
            <col className="task-board-col-due" />
            <col className="task-board-col-actions" />
          </colgroup>
          <thead className="sr-only"><tr><th scope="col">任务</th><th scope="col">任务状态与执行</th><th scope="col">到期</th><th scope="col">操作</th></tr></thead>
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
          <p>{rows.length ? "调整搜索词或清除筛选查看其他任务。" : emptyCopy.hint}</p>
        </div>
      )}
      </div>
    </section>
  );
}
