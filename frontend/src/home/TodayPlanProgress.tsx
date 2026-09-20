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

type StepState = "running" | "done" | "failed";
type StepKind = "step" | "think" | "tool";

type PlanStep = {
  key: string;
  kind: StepKind;
  label: string;
  time: string;
  state: StepState;
  detail: string;
};

function eventTypeOf(event: TaskEvent): string {
  return String(event.type || event.event_type || "").toLowerCase();
}

function stepKindOf(type: string): StepKind {
  if (type === "run.think" || type === "run.stream") return "think";
  if (type === "run.tool") return "tool";
  return "step";
}

/**
 * A milestone row (`run.progress`) is written when the step finishes, so it is
 * done even though the run itself is still going. Everything else carries its
 * own status; a leftover `running` after the run settled can only be stale.
 */
function stepStateOf(event: TaskEvent, planning: boolean): StepState {
  const type = eventTypeOf(event);
  const status = String(event.status || "").toLowerCase();
  if (type === "run.failed" || type === "failed" || status === "failed") return "failed";
  if (type === "run.progress" || type === "run.completed") return "done";
  if (status === "running") return planning ? "running" : "done";
  return "done";
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

  // Every step gets a clock time: the backend created_at when present,
  // otherwise a local stamp from the first time this client saw the step.
  const localStamps = useRef(new Map<string, string>());
  const steps = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, PlanStep>();
    const stampFor = (key: string, event?: TaskEvent): string => {
      const fromEvent = eventTime(event);
      if (fromEvent) {
        localStamps.current.set(key, fromEvent);
        return fromEvent;
      }
      let stamp = localStamps.current.get(key);
      if (!stamp) {
        stamp = formatClock(new Date());
        localStamps.current.set(key, stamp);
      }
      return stamp;
    };
    for (const event of events || []) {
      const type = eventTypeOf(event);
      const detail = String(event.summary || "").replace(/\*\*/g, "").trim();
      const title = String(event.title || event.label || "").trim();
      const kind = stepKindOf(type);
      // A reasoning row streams its text, so it keeps a stable title: the text
      // must not leak into the label or the row would be re-keyed every poll.
      const label = kind === "think" ? "Codex 推理" : title || detail.slice(0, 40);
      if (!label && !detail) continue;
      const key = String(event.item_key || "").trim() || label;
      const next: PlanStep = {
        key,
        kind,
        label,
        time: stampFor(key, event),
        state: stepStateOf(event, planning),
        detail,
      };
      const prev = byKey.get(key);
      if (!prev) {
        order.push(key);
        byKey.set(key, next);
        continue;
      }
      byKey.set(key, { ...prev, ...next, time: prev.time || next.time });
    }
    const rows = order.map((key) => byKey.get(key)!);
    if (phase === "refreshed" && !rows.some((row) => row.label === completedLabel)) {
      rows.push({
        key: completedLabel,
        kind: "step",
        label: completedLabel,
        time: stampFor(completedLabel),
        state: "done",
        detail: "",
      });
    }
    return rows;
  }, [events, planning, phase, completedLabel]);

  const liveThinking = steps.some((step) => step.kind === "think" && step.state === "running" && step.detail);
  const thinkRef = useRef<HTMLParagraphElement | null>(null);
  const thinkText = steps.find((step) => step.kind === "think" && step.state === "running")?.detail || "";
  useEffect(() => {
    const node = thinkRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [thinkText]);

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
        <ol className="today-plan-steps" data-today-plan-steps>
          {steps.map((step, index) => {
            const isFinal = phase === "refreshed" && index === steps.length - 1;
            const running = step.state === "running";
            return (
              <li
                key={step.key}
                className={
                  (isFinal ? "is-final " : "")
                  + `is-${step.state}`
                  + (step.kind === "think" ? " is-think" : "")
                  + (running && step.kind === "think" ? " is-live" : "")
                }
                data-today-plan-event={step.label}
                data-today-plan-state={step.state}
              >
                <span className="today-plan-step-dot" aria-hidden>
                  {step.state === "failed" ? (
                    <svg viewBox="0 0 12 12"><path d="M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  ) : running ? (
                    <span className="today-plan-step-spinner" />
                  ) : (
                    <svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
                <span className="today-plan-step-label">{step.label}</span>
                {step.kind === "tool" && step.detail ? (
                  <span className="today-plan-step-op" title={step.detail}>{step.detail}</span>
                ) : null}
                <time className="today-plan-step-time">{step.time}</time>
                {step.kind === "think" && step.detail ? (
                  <p
                    className="today-plan-think"
                    data-today-plan-think
                    ref={running && liveThinking ? thinkRef : undefined}
                    tabIndex={0}
                  >
                    {step.detail}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
