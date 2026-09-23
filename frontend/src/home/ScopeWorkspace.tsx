import { useMemo, type ReactNode } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import type { TaskRecommendationView } from "./workspace/result-contract";
import PlanSummary from "./PlanSummary";
import TaskBoard from "./TaskBoard";
import TodayPlanProgress from "./TodayPlanProgress";
import WorkspaceShell from "./WorkspaceShell";
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
 * The geometry lives in WorkspaceShell — AI发现 composes the same shell, so a
 * fix to the two-column workspace reaches all three panes.
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
  recommendations = [],
  onAdoptRecommendation,
  centerHeader,
  centerSupplement,
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
  recommendations?: TaskRecommendationView[];
  onAdoptRecommendation?: (recommendation: TaskRecommendationView) => void;
  centerHeader?: ReactNode;
  /** Composer 产生的澄清、排队、失败或恢复信息，属于中栏交互时间线。 */
  centerSupplement?: ReactNode;
  centerFooter?: ReactNode;
}) {
  const cfg = SCOPE_CONFIG[scope];
  const stamped = useMemo(
    () => rows.map((task) => ({
      ...task,
      layout_why: String(task.layout_why || "").trim() || whyLine(task),
    })),
    [rows],
  );
  const loading = memoryPending || (phase === "loading-memory" && !stamped.length);
  const hasStream = Boolean(brief) || Boolean((events || []).length);
  return (
    <WorkspaceShell
      pane={scope}
      railLabel={cfg.railLabel}
      railToggleLabel={cfg.railToggleLabel}
      railStorageKey={cfg.railStorageKey}
      railBadge={stamped.length}
      resultView={{
        resultType: scope === "today" ? "today_tasks" : "todo_tasks",
        status: phase === "failed" ? "failed" : phase === "planning" || phase === "loading-memory"
          ? "running" : hasStream ? "completed" : stamped.length ? "ready" : "idle",
        updatedAt: undefined,
        freshness: brief ? "current" : "unknown",
        recommendations,
        onAdoptRecommendation,
      }}
      scrollAnchorEvent={TODAY_PLAN_REFRESH_EVENT}
      centerHeader={(
        <>
          {centerHeader}
          {notice ? (
            <p className="home-dedupe-notice" data-todo-deduped role="status">{notice}</p>
          ) : null}
        </>
      )}
      centerScroll={(
        <>
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
          {centerSupplement}
          {phase === "idle" && !hasStream ? (
            <div className="scope-workspace-empty" data-scope-ai-empty>
              <strong>{cfg.streamEmpty.title}</strong>
              <p>{cfg.streamEmpty.body}</p>
            </div>
          ) : null}
        </>
      )}
      centerFooter={centerFooter}
      rail={(
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
      )}
    />
  );
}
