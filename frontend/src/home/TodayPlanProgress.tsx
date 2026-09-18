import type { TaskEvent } from "../api";
import { todayPlanEventLabels, todayPlanStatusCopy, type TodayPlanPhase } from "./todayPlan";

export default function TodayPlanProgress({
  phase = "idle",
  events,
}: {
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
}) {
  const status = todayPlanStatusCopy(phase);
  const labels = todayPlanEventLabels(events);
  if (!status && !labels.length) return null;
  return (
    <div
      className="today-plan-progress"
      data-today-plan-phase={phase}
      data-today-plan-events={labels.length}
      data-today-planning={phase === "planning" || phase === "loading-memory" ? true : undefined}
      role="status"
    >
      {status ? <p className="today-plan-progress-lead">{status}</p> : null}
      {labels.length ? (
        <ol className="today-plan-events">
          {labels.map((label, index) => (
            <li key={`${label}-${index}`} data-today-plan-event={label}>{label}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
