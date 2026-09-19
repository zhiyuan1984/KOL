import { useEffect, useMemo, useRef } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import PlanBriefCard from "./PlanBriefCard";
import TodayPlanBoard from "./TodayPlanBoard";
import TodayPlanProgress from "./TodayPlanProgress";
import { whyLine } from "./homeModel";
import { TODAY_PLAN_REFRESH_EVENT, type TodayPlanPhase } from "./todayPlan";
import "./today-display-row.css";

export default function TodayPane({
  todayTodos,
  busy,
  onAct,
  onEdit,
  brief,
  phase = "idle",
  events,
  planCollapsed,
  onPlanCollapsedChange,
}: {
  todayTodos: Task[];
  busy: boolean;
  onAct: (task: Task) => void;
  onEdit?: (task: Task) => void;
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  planCollapsed?: boolean;
  onPlanCollapsedChange?: (collapsed: boolean) => void;
}) {
  const rows = useMemo(
    () => todayTodos.map((task) => ({
      ...task,
      layout_why: String(task.layout_why || "").trim() || whyLine(task),
    })),
    [todayTodos],
  );
  const loading = phase === "loading-memory" && !rows.length;
  const planCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onRefresh = () => {
      planCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TODAY_PLAN_REFRESH_EVENT, onRefresh);
  }, []);
  return (
    <section className="home-mode-pane" data-home-pane="today">
      <div ref={planCardRef} className="today-plan-card-anchor">
        <TodayPlanProgress
          phase={phase}
          events={events}
          collapsed={planCollapsed}
          onCollapsedChange={onPlanCollapsedChange}
          scope="today"
        />
      </div>

      <PlanBriefCard brief={brief} phase={phase} events={events} busy={busy} onAct={onAct} rows={rows} />

      <TodayPlanBoard rows={rows} busy={busy} loading={loading} onAct={onAct} onEdit={onEdit} />
    </section>
  );
}
