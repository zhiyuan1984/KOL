import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskEvent } from "../api";
import {
  formatTodayPlanElapsed,
  todayPlanEventLabels,
  todayPlanStatusCopy,
  type PlanScope,
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

function formatClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function eventTime(event?: TaskEvent): string {
  const raw = String(event?.created_at || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return formatClock(date);
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="today-plan-gear-svg">
      <path
        d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.2.6a8 8 0 0 0-1.7-1L15 4h-4l-.6 2a8 8 0 0 0-1.7 1l-2.2-.6-2 3.4 2 1.2a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.4 2.2-.6a8 8 0 0 0 1.7 1l.6 2h4l.6-2a8 8 0 0 0 1.7-1l2.2.6 2-3.4-2-1.2a7.8 7.8 0 0 0 .1 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TodayPlanProgress({
  phase = "idle",
  events,
  collapsed,
  onCollapsedChange,
  scope = "today",
}: {
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  scope?: PlanScope;
}) {
  const planning = phase === "planning";
  const elapsed = usePlanningElapsed(planning);
  const [innerCollapsed, setInnerCollapsed] = useState(false);
  const isCollapsed = collapsed ?? innerCollapsed;
  const setCollapsed = (next: boolean) => {
    if (collapsed === undefined) setInnerCollapsed(next);
    onCollapsedChange?.(next);
  };
  const completedLabel = scope === "todo" ? "待办规划已完成" : "今日规划已完成";
  const status = todayPlanStatusCopy(phase, scope);
  const labels = todayPlanEventLabels(events);
  const streamEvent = planning
    ? [...(events || [])].reverse().find((event) => String(event.type || "") === "run.stream")
    : undefined;
  const streamText = String(streamEvent?.summary || "").trim();

  // Every step gets a clock time: the backend created_at when present,
  // otherwise a local stamp from the first time this client saw the step.
  const localStamps = useRef(new Map<string, string>());
  const steps = useMemo(() => {
    const timed = new Map<string, string>();
    for (const event of events || []) {
      const label = String(event.title || event.label || event.summary || "").trim();
      if (!label || timed.has(label)) continue;
      timed.set(label, eventTime(event));
    }
    const stampFor = (label: string): string => {
      const fromEvent = timed.get(label);
      if (fromEvent) {
        localStamps.current.set(label, fromEvent);
        return fromEvent;
      }
      let stamp = localStamps.current.get(label);
      if (!stamp) {
        stamp = formatClock(new Date());
        localStamps.current.set(label, stamp);
      }
      return stamp;
    };
    const rows = labels.map((label) => ({ label, time: stampFor(label), done: true }));
    if (phase === "refreshed" && !labels.includes(completedLabel)) {
      rows.push({ label: completedLabel, time: stampFor(completedLabel), done: true });
    }
    return rows;
  }, [events, labels, phase, completedLabel]);

  if (!status && !steps.length) return null;
  return (
    <section
      className="today-plan-card"
      data-today-plan-phase={phase}
      data-today-plan-events={labels.length}
      data-today-planning={phase === "planning" || phase === "loading-memory" ? true : undefined}
      role="status"
    >
      <header className="today-plan-card-head">
        <span className="today-plan-gear" aria-hidden><GearIcon /></span>
        <div className="today-plan-card-title">
          <strong>Codex 思考过程</strong>
          <span className="today-plan-card-sub">基于你的待办、AI发现、历史任务和上下文，生成今日工作计划</span>
        </div>
        {status ? (
          <span className="today-plan-card-status">
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
          </span>
        ) : null}
        <button
          type="button"
          className="today-plan-collapse"
          aria-expanded={!isCollapsed}
          onClick={() => setCollapsed(!isCollapsed)}
        >
          {isCollapsed ? "展开" : "收起"}
          <span aria-hidden className={"today-plan-chevron" + (isCollapsed ? " is-down" : "")}>⌄</span>
        </button>
      </header>
      {!isCollapsed && steps.length ? (
        <ol className="today-plan-steps">
          {steps.map((step, index) => {
            const isFinal = phase === "refreshed" && index === steps.length - 1;
            return (
              <li
                key={`${step.label}-${index}`}
                className={isFinal ? "is-final" : undefined}
                data-today-plan-event={step.label}
              >
                <span className="today-plan-step-dot" aria-hidden>
                  {isFinal ? null : (
                    <svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
                <span className="today-plan-step-label">{step.label}</span>
                <time className="today-plan-step-time">{step.time}</time>
              </li>
            );
          })}
        </ol>
      ) : null}
      {!isCollapsed && streamText ? (
        <div className="today-plan-stream" data-today-plan-stream>
          <span className="today-plan-stream-label">Codex 思考过程</span>
          <p className="today-plan-stream-text">{streamText}</p>
        </div>
      ) : null}
    </section>
  );
}
