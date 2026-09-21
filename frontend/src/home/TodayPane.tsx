import { useEffect, useMemo, useRef } from "react";
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
}) {
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
  return (
    <section className="home-mode-pane" data-home-pane="today">
      <div ref={streamRef} className="today-plan-anchor">
        <TaskBoard
          title="今日工作计划"
          scope="today"
          rows={rows}
          busy={busy}
          loading={loading}
          onAct={onAct}
          onEdit={onEdit}
          planPhase={phase}
          stream={<>
            <TodayPlanProgress
              phase={phase}
              events={events}
              candidates={candidateCount(brief)}
              previousBrief={previousBrief}
              previousEvents={previousEvents}
              scope="today"
            />
            <PlanSummary brief={brief} />
          </>}
        />
      </div>
    </section>
  );
}
