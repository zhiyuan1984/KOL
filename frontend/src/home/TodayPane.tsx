import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import PlanSummary from "./PlanSummary";
import TaskBoard from "./TaskBoard";
import TodayPlanProgress from "./TodayPlanProgress";
import { whyLine } from "./homeModel";
import { TODAY_PLAN_REFRESH_EVENT, type TodayPlanPhase } from "./todayPlan";

function candidateCount(brief?: TodayBrief | null): number | null {
  const stats = brief?.stats || {};
  for (const key of ["candidates", "candidate_count", "candidateCount"]) {
    const value = Number(stats[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * One workspace: header (title / search / 启动今日任务) → Codex stream →
 * summary → filters → task list. The stream is a slot, not a sibling card, so the
 * pane never grows a second frame or a second scroll container.
 */
export default function TodayPane({
  todayTodos,
  busy,
  onAct,
  onEdit,
  brief,
  phase = "idle",
  events,
  previousBrief,
  previousEvents,
  memoryPending = false,
  centerHeader,
  centerFooter,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  previousBrief?: TodayBrief | null;
  previousEvents?: TaskEvent[] | null;
  /** Entering the pane reads memory without planning, so the empty state must not lie. */
  memoryPending?: boolean;
  centerHeader?: ReactNode;
  centerFooter?: ReactNode;
}) {
  const [taskRailCollapsed, setTaskRailCollapsed] = useState(() =>
    localStorage.getItem("ui:home-today-task-rail-collapsed") === "true"
  );
  const rows = useMemo(
    () => todayTodos.map((task) => ({
      ...task,
      layout_why: String(task.layout_why || "").trim() || whyLine(task),
    })),
    [todayTodos],
  );
  const loading = memoryPending || (phase === "loading-memory" && !rows.length);
  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onRefresh = () => {
      streamRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
  }, []);
  const toggleTaskRail = () => {
    setTaskRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem("ui:home-today-task-rail-collapsed", String(next));
      return next;
    });
  };
  return (
    <section
      className={"home-mode-pane today-workspace" + (taskRailCollapsed ? " is-task-rail-collapsed" : "")}
      data-home-pane="today"
      data-today-workspace
    >
      <div className="today-workspace-center" data-today-ai-workspace>
        <div className="today-workspace-center-content">
          {centerHeader}
          <div ref={streamRef} className="today-plan-anchor today-workspace-center-scroll">
            <header className="today-workspace-center-head">
              <span>AI 规划与执行</span>
              <small>过程与结论</small>
            </header>
            <TodayPlanProgress
              phase={phase}
              events={events}
              candidates={candidateCount(brief)}
              plannedTasks={rows.length}
              previousBrief={previousBrief}
              previousEvents={previousEvents}
              scope="today"
            />
            <PlanSummary brief={brief} />
            {phase === "idle" && !brief && !(events || []).length ? (
              <div className="today-workspace-empty" data-today-ai-empty>
                <strong>从今天的工作开始</strong>
                <p>启动今日任务后，这里会展示 Codex 的真实规划过程与结果摘要。</p>
              </div>
            ) : null}
          </div>
          {centerFooter}
        </div>
      </div>

      <aside
        className={"today-task-rail" + (taskRailCollapsed ? " is-collapsed" : "")}
        data-today-task-rail
        aria-label="今日任务表"
      >
        <button
          type="button"
          className="today-task-rail-toggle"
          aria-expanded={!taskRailCollapsed}
          aria-label={taskRailCollapsed ? "展开今日任务表" : "收起今日任务表"}
          onClick={toggleTaskRail}
        >
          <svg className="today-task-rail-toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d={taskRailCollapsed ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
          </svg>
          {taskRailCollapsed ? <strong>今日任务</strong> : null}
          {taskRailCollapsed ? <em>{rows.length}</em> : null}
        </button>
        <TaskBoard
          title="今日工作计划"
          scope="today"
          rows={rows}
          busy={busy}
          loading={loading}
          onAct={onAct}
          onEdit={onEdit}
          planPhase={phase === "idle" && (Boolean(brief) || Boolean((events || []).length)) ? "refreshed" : phase}
        />
      </aside>
    </section>
  );
}
