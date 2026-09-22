import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import PlanSummary from "./PlanSummary";
import TaskBoard from "./TaskBoard";
import TodayPlanProgress from "./TodayPlanProgress";
import { whyLine } from "./homeModel";
import {
  SCOPE_CONFIG,
  TODAY_PLAN_REFRESH_EVENT,
  type PlanScope,
  type TodayPlanPhase,
} from "./todayPlan";

function candidateCount(brief?: TodayBrief | null): number | null {
  const stats = brief?.stats || {};
  for (const key of ["candidates", "candidate_count", "candidateCount"]) {
    const value = Number(stats[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * One workspace per plan scope: header (title / stats) → Codex stream →
 * summary → task rail. 今日任务 and 我的待办 render this same component, so the
 * only differences left are the scope config (copy, storage key, cache key) and
 * the data client behind usePlanScope.
 *
 * The stream is a slot, not a sibling card, so the pane never grows a second
 * frame or a second scroll container.
 */
export default function ScopeWorkspace({
  scope,
  rows,
  busy,
  onAct,
  onEdit,
  notice = "",
  brief,
  phase = "idle",
  events,
  previousBrief,
  previousEvents,
  memoryPending = false,
  centerHeader,
  centerFooter,
}: {
  scope: PlanScope;
  rows: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  /** A data fact (e.g. the todo dedupe feedback). Today leaves it empty. */
  notice?: string;
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
  const cfg = SCOPE_CONFIG[scope];
  const [railCollapsed, setRailCollapsed] = useState(() =>
    localStorage.getItem(cfg.railStorageKey) === "true"
  );
  const stamped = useMemo(
    () => rows.map((task) => ({
      ...task,
      layout_why: String(task.layout_why || "").trim() || whyLine(task),
    })),
    [rows],
  );
  const loading = memoryPending || (phase === "loading-memory" && !stamped.length);
  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onRefresh = () => {
      streamRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
  }, []);
  const toggleRail = () => {
    setRailCollapsed((current) => {
      const next = !current;
      localStorage.setItem(cfg.railStorageKey, String(next));
      return next;
    });
  };
  const hasStream = Boolean(brief) || Boolean((events || []).length);
  return (
    <section
      className={"home-mode-pane scope-workspace" + (railCollapsed ? " is-task-rail-collapsed" : "")}
      data-home-pane={scope}
      data-scope-workspace={scope}
    >
      <div className="scope-workspace-center" data-scope-ai-workspace>
        <div className="scope-workspace-center-content">
          {centerHeader}
          {notice ? (
            <p className="home-dedupe-notice" data-todo-deduped role="status">{notice}</p>
          ) : null}
          <div ref={streamRef} className="scope-plan-anchor scope-workspace-center-scroll">
            <TodayPlanProgress
              phase={phase}
              events={events}
              candidates={candidateCount(brief)}
              plannedTasks={stamped.length}
              previousBrief={previousBrief}
              previousEvents={previousEvents}
              scope={scope}
            />
            <PlanSummary brief={brief} label={cfg.planSummaryLabel} />
            {phase === "idle" && !hasStream ? (
              <div className="scope-workspace-empty" data-scope-ai-empty>
                <strong>{cfg.streamEmpty.title}</strong>
                <p>{cfg.streamEmpty.body}</p>
              </div>
            ) : null}
          </div>
          {centerFooter}
        </div>
      </div>

      <aside
        className={"scope-task-rail" + (railCollapsed ? " is-collapsed" : "")}
        data-scope-task-rail
        aria-label={cfg.railLabel}
      >
        <button
          type="button"
          className="scope-task-rail-toggle"
          aria-expanded={!railCollapsed}
          aria-label={`${railCollapsed ? "展开" : "收起"}${cfg.railLabel}`}
          onClick={toggleRail}
        >
          <svg className="scope-task-rail-toggle-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d={railCollapsed ? "m7 4 6 6-6 6" : "m13 4-6 6 6 6"} />
          </svg>
          {railCollapsed ? <strong>{cfg.railToggleLabel}</strong> : null}
          {railCollapsed ? <em>{stamped.length}</em> : null}
        </button>
        <TaskBoard
          title={cfg.boardTitle}
          scope={scope}
          rows={stamped}
          busy={busy}
          loading={loading}
          onAct={onAct}
          onEdit={onEdit}
          planPhase={phase === "idle" && hasStream ? "refreshed" : phase}
        />
      </aside>
    </section>
  );
}
