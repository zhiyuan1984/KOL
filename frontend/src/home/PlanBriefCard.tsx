import { useMemo } from "react";
import type { Task, TaskEvent, TodayBrief } from "../api";
import { briefPrimaryLabel } from "./homeModel";
import { TODAY_PLAN_REFRESH_EVENT, type TodayPlanPhase } from "./todayPlan";

function isPolicySection(section: { title?: string; body?: string }): boolean {
  const blob = `${section.title || ""}${section.body || ""}`;
  return /原则|缺一条就整轮|关闭的任务不会再出现/.test(blob);
}

function candidateCount(brief?: TodayBrief | null): number | null {
  const stats = brief?.stats || {};
  for (const key of ["candidates", "candidate_count", "candidateCount"]) {
    const value = Number(stats[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function planFailureReason(phase: TodayPlanPhase, events?: TaskEvent[] | null): string {
  if (phase !== "failed") return "";
  const list = events || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const event = list[i];
    const type = String(event.type || event.event_type || "").toLowerCase();
    const status = String(event.status || "").toLowerCase();
    if (type === "run.failed" || type === "failed" || status === "failed") {
      return String(event.summary || event.label || event.title || "").trim();
    }
  }
  return "";
}

/**
 * 优化结论 card shared by Today and Todo panes. Renders the Codex brief when
 * present, otherwise an empty/failed state with a re-plan action.
 */
export default function PlanBriefCard({
  brief,
  phase = "idle",
  events,
  busy,
  onAct,
  rows = [],
}: {
  brief?: TodayBrief | null;
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  busy: boolean;
  onAct: (task: Task) => void;
  rows?: Task[];
}) {
  const sections = (Array.isArray(brief?.sections) ? brief.sections : []).filter((section) => !isPolicySection(section));
  const note = sections[0]?.body || "";
  const primaryLabel = briefPrimaryLabel(brief?.primary);
  const bannedPrimary = /处理|待补阶段/.test(primaryLabel);
  const primaryObjectId = String(brief?.primary?.object_id || "").trim();
  const primaryTask = primaryObjectId ? rows.find((task) => task.id === primaryObjectId) : undefined;
  const candidates = candidateCount(brief);
  const failureReason = useMemo(() => planFailureReason(phase, events), [phase, events]);
  const planning = phase === "planning" || phase === "loading-memory";

  if (!brief) {
    return (
      <section className="today-brief today-brief-card today-brief-empty" data-today-brief-empty>
        <header className="today-brief-head">
          <span className="today-brief-badge" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M12 8v5h5M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <strong className="today-brief-title">优化结论</strong>
        </header>
        <p className="today-brief-lead">
          {phase === "failed" ? "规划失败，暂无优化结论。" : "还没有优化结论。"}
        </p>
        {failureReason ? <p className="today-brief-note" data-today-failure-reason>{failureReason}</p> : null}
        <button
          type="button"
          className="today-brief-primary today-brief-primary-btn today-display-go"
          disabled={busy || planning}
          onClick={() => window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT))}
        >
          <span className="today-display-act-label">{phase === "failed" ? "重新规划" : "立即规划"}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="today-brief today-brief-card" data-today-brief>
      <header className="today-brief-head">
        <span className="today-brief-badge" aria-hidden>
          <svg viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <strong className="today-brief-title">优化结论</strong>
        {candidates ? <span className="today-brief-meta">基于 {candidates} 项候选任务</span> : null}
      </header>
      {brief.lead ? <p className="today-brief-lead" data-today-lead>{brief.lead}</p> : null}
      {primaryLabel && !bannedPrimary ? (
        primaryTask ? (
          <button
            type="button"
            className="today-brief-primary today-brief-primary-btn today-display-go"
            data-today-primary
            data-today-primary-verb={brief.primary?.verb}
            disabled={busy}
            onClick={() => onAct(primaryTask)}
          >
            <span className="today-display-act-label">{primaryLabel}</span>
          </button>
        ) : (
          <p className="today-brief-primary" data-today-primary data-today-primary-verb={brief.primary?.verb}>
            {primaryLabel}
          </p>
        )
      ) : null}
      {note ? <p className="today-brief-note" data-today-sections>{note}</p> : null}
    </section>
  );
}
