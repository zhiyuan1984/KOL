import { useMemo, type ReactNode } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import PlanSummary from "./PlanSummary";
import TaskBoard from "./TaskBoard";
import TaskDetailRail, { type TaskDetailFocus } from "./TaskDetailRail";
import TodayPlanProgress from "./TodayPlanProgress";
import WorkspaceShell from "./WorkspaceShell";
import { isTaskException, whyLine } from "./homeModel";
import {
  SCOPE_CONFIG,
  TODAY_PLAN_REFRESH_EVENT,
  type PlanSnapshotInfo,
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

function taskSessionId(task: Task): string {
  const direct = String(task.session_id || "").trim();
  if (direct) return direct;
  const runs = Array.isArray(task.runs) ? task.runs as Array<Record<string, unknown>> : [];
  for (const run of [...runs].reverse()) {
    const sessionId = String(run.session_id || "").trim();
    if (sessionId) return sessionId;
  }
  return "";
}

/**
 * One workspace per plan scope: header (title / stats) → Codex stream →
 * summary → task rail. 今日任务 and 我的待办 render this same component, so the
 * only differences left are the scope config (copy, storage key, cache key) and
 * the data client behind usePlanScope.
 */
export default function ScopeWorkspace({
  scope,
  rows,
  taskCatalog = [],
  busy,
  onAct,
  onOpen,
  onEdit,
  selectedTask = null,
  detailFocus,
  detailFocusToken,
  onCloseDetail,
  onStartExecution,
  notice = "",
  brief,
  phase = "idle",
  events,
  previousBrief,
  previousEvents,
  snapshot,
  memoryPending = false,
  centerHeader,
  centerSupplement,
  centerFooter,
}: {
  scope: PlanScope;
  rows: Task[];
  /** Full memory is used only to name a removed/completed task in the plan diff. */
  taskCatalog?: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  selectedTask?: Task | null;
  detailFocus?: TaskDetailFocus;
  detailFocusToken?: number;
  onCloseDetail?: () => void;
  onStartExecution?: (task: Task) => Promise<void> | void;
  /** A data fact (e.g. the todo dedupe feedback). Today leaves it empty. */
  notice?: string;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  previousBrief?: TodayBrief | null;
  previousEvents?: TaskEvent[] | null;
  snapshot?: PlanSnapshotInfo;
  /** Entering the pane reads memory without planning, so the empty state must not lie. */
  memoryPending?: boolean;
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
  const selectedAvailable = Boolean(selectedTask && stamped.some((task) => task.id === selectedTask.id));
  // 摘要里的任务数/异常数必须和用户眼前的任务表一致：从当前行派生，不用规划快照。
  const exceptionCount = useMemo(
    () => stamped.filter(isTaskException).length,
    [stamped],
  );
  return (
    <WorkspaceShell
      key={scope}
      pane={scope}
      railLabel={cfg.railLabel}
      railToggleLabel={cfg.railToggleLabel}
      railStorageKey={cfg.railStorageKey}
      railBadge={stamped.length}
      preserveRailPosition
      streamStick={phase === "loading-memory" || phase === "planning"}
      resultView={{
        resultType: cfg.resultType,
        status: phase === "failed" ? "failed" : phase === "planning" || phase === "loading-memory"
          ? "running" : hasStream ? "completed" : stamped.length ? "ready" : "idle",
        freshness: "unknown",
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
            brief={brief}
            candidates={candidateCount(brief)}
            currentRows={stamped}
            taskCatalog={taskCatalog}
            previousBrief={previousBrief}
            previousEvents={previousEvents}
            snapshot={snapshot}
            scope={scope}
          />
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
      rail={selectedTask ? (
        <TaskDetailRail
          task={selectedTask}
          sessionId={taskSessionId(selectedTask)}
          available={selectedAvailable}
          focus={detailFocus}
          focusToken={detailFocusToken}
          starting={busy}
          onClose={() => onCloseDetail?.()}
          onStartExecution={(task) => onStartExecution?.(task)}
        />
      ) : (
        <TaskBoard
          key={scope}
          title={cfg.boardTitle}
          scope={scope}
          rows={stamped}
          busy={busy}
          loading={loading}
          onAct={onAct}
          onOpen={onOpen}
          onEdit={onEdit}
          planPhase={phase === "idle" && hasStream ? "refreshed" : phase}
          summary={<PlanSummary brief={brief} label={cfg.planSummaryLabel} snapshot={snapshot} taskCount={stamped.length} exceptionCount={exceptionCount} />}
        />
      )}
    />
  );
}
