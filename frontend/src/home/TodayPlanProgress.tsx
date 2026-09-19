import { useEffect, useState } from "react";
import type { TaskEvent } from "../api";
import {
  formatTodayPlanElapsed,
  todayPlanEventLabels,
  todayPlanStatusCopy,
  type TodayPlanPhase,
} from "./todayPlan";
import "./today-plan-progress.css";

function usePlanningElapsed(active: boolean): number | null {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const tick = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [active]);

  return active ? elapsed : null;
}

export default function TodayPlanProgress({
  phase = "idle",
  events,
}: {
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  const planning = phase === "planning";
  const elapsed = usePlanningElapsed(planning);
  const status = todayPlanStatusCopy(phase);
  const labels = todayPlanEventLabels(events);
  const streamEvent = planning
    ? [...(events || [])].reverse().find((event) => String(event.type || "") === "run.stream")
    : undefined;
  const streamText = String(streamEvent?.summary || "").trim();
  if (!status && !labels.length) return null;
  return (
    <div
      className="today-plan-progress"
      data-today-plan-phase={phase}
      data-today-plan-events={labels.length}
      data-today-planning={phase === "planning" || phase === "loading-memory" ? true : undefined}
      role="status"
    >
      {status ? (
        <p className="today-plan-progress-lead">
          <span data-today-plan-lead>{status}</span>
          {elapsed != null ? (
            <span
              className="today-plan-elapsed"
              data-today-plan-elapsed={elapsed}
              aria-label={`已用时 ${formatTodayPlanElapsed(elapsed)}`}
            >
              {formatTodayPlanElapsed(elapsed)}
            </span>
          ) : null}
        </p>
      ) : null}
      {labels.length ? (
        <ol className="today-plan-events">
          {labels.map((label, index) => (
            <li key={`${label}-${index}`} data-today-plan-event={label}>{label}</li>
          ))}
        </ol>
      ) : null}
      {streamText ? (
        <div className="today-plan-stream" data-today-plan-stream>
          <span className="today-plan-stream-label">Codex 推理过程</span>
          <p className="today-plan-stream-text">{streamText}</p>
        </div>
      ) : null}
    </div>
  );
}
