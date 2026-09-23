import { useEffect, useMemo, useRef, useState } from "react";
import type { TaskEvent, TodayBrief } from "../api";
import { thinkTail } from "./streamText";
import {
  formatTodayPlanElapsed,
  todayPlanEventLabels,
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

const LUCAS_AVATAR: Record<TodayPlanPhase, number> = {
  idle: 1,
  "loading-memory": 7,
  planning: 6,
  refreshed: 9,
  failed: 8,
};

export function lucasPlanCopy(
  phase: TodayPlanPhase,
  scope: PlanScope,
  candidates?: number | null,
  plannedTasks?: number | null,
  failureReason?: string,
): string {
  const target = scope === "todo" ? "待办任务" : "今天的任务";
  if (phase === "idle") return "";
  if (phase === "loading-memory") return `Lucas 正在读取${target}`;
  if (phase === "planning") {
    return candidates != null && candidates > 0
      ? `Lucas 正在分析 ${candidates} 项候选任务`
      : `Lucas 正在规划${target}`;
  }
  if (phase === "failed") {
    const timeout = /超时|timed?\s*out/i.test(String(failureReason || ""));
    return timeout
      ? "本轮规划超时，现有任务清单仍可用"
      : "本轮规划未完成，现有任务清单仍可用";
  }
  return plannedTasks != null && plannedTasks > 0
    ? `Lucas 已完成规划，共生成 ${plannedTasks} 项任务`
    : "Lucas 已完成规划";
}

function LucasAvatar({ phase, size = 16 }: { phase: TodayPlanPhase; size?: number }) {
  const avatar = LUCAS_AVATAR[phase];
  return (
    <picture className={`today-plan-lucas is-${phase}`} aria-hidden="true">
      <source media="(prefers-reduced-motion: reduce)" srcSet={`/avatars/lucas/Lucas${avatar}.png`} />
      <img src={`/avatars/lucas/Lucas${avatar}.webp`} alt="" width={size} height={size} />
    </picture>
  );
}

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
function stepStateOf(event: TaskEvent, live: boolean): StepState {
  const type = eventTypeOf(event);
  const status = String(event.status || "").toLowerCase();
  if (type === "run.failed" || type === "failed" || status === "failed") return "failed";
  if (type === "run.progress" || type === "run.completed") return "done";
  if (status === "running") return live ? "running" : "done";
  return "done";
}

/**
 * The Codex stream: Host phases, remote reads and the reasoning summary as one
 * flat list inside the workspace. No card, no inner scroller — the workspace has
 * exactly one scroll container, and only the newest reasoning block is expanded.
 */
export default function TodayPlanProgress({
  phase = "idle",
  events,
  candidates,
  plannedTasks,
  previousBrief,
  previousEvents,
  scope = "today",
}: {
  phase?: TodayPlanPhase;
  events?: TaskEvent[] | null;
  candidates?: number | null;
  plannedTasks?: number | null;
  /** The version before this one, folded to a single row. */
  previousBrief?: TodayBrief | null;
  previousEvents?: TaskEvent[] | null;
  scope?: PlanScope;
}) {
  const live = phase === "loading-memory" || phase === "planning";
  const failed = phase === "failed";
  const elapsed = usePlanningElapsed(live);
  const labels = todayPlanEventLabels(events);
  const [previousOpen, setPreviousOpen] = useState(false);

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
      const detail = String(event.summary || "")
        .replace(/未合成邮件/g, "未生成结果")
        .replace(/未起箱/g, "未启动 Codex")
        .replace(/\*\*/g, "")
        .trim();
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
        state: stepStateOf(event, live),
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
    return order.map((key) => byKey.get(key)!);
  }, [events, live]);

  // Steps stay out of the way once the run settles; a new run opens them again.
  const [open, setOpen] = useState(live);
  useEffect(() => {
    setOpen(live);
  }, [live]);

  const stepRows = steps.filter((step) => step.kind !== "think");
  const thinkRows = steps.filter((step) => step.kind === "think");
  const activeThink = thinkRows.length ? thinkRows[thinkRows.length - 1] : undefined;
  const think = activeThink ? thinkTail(activeThink.detail) : { body: "", truncated: false };
  const foldedThink = Math.max(0, thinkRows.length - 1);
  const finishedAt = steps.length ? steps[steps.length - 1].time : "";
  const failedStep = [...steps].reverse().find((step) => step.state === "failed");
  const displayPhase: TodayPlanPhase = phase === "idle" && steps.length ? "refreshed" : phase;
  const status = lucasPlanCopy(displayPhase, scope, candidates, plannedTasks, failedStep?.detail);

  // The previous version stays reachable but never competes with the current one.
  const previousSteps = useMemo(() => todayPlanEventLabels(previousEvents), [previousEvents]);
  const previousStamp = (() => {
    const last = (previousEvents || [])[previousEvents ? previousEvents.length - 1 : 0];
    return last ? eventTime(last) : "";
  })();
  const previousTasks = Number(previousBrief?.stats?.unfinished);
  const hasPrevious = Boolean(previousBrief) || previousSteps.length > 0;

  if (!status && !steps.length && !hasPrevious) return null;

  const title = failed ? "规划失败" : live ? "规划中" : "规划完成";
  return (
    <section
      className={"today-plan" + (live ? " is-live" : "")}
      data-today-plan-phase={phase}
      data-today-plan-events={labels.length}
      data-today-planning={live ? true : undefined}
      data-today-plan-open={open ? "true" : "false"}
      role="status"
    >
      {hasPrevious ? (
        <div className="today-plan-previous" data-today-plan-previous>
          <button
            type="button"
            className="today-plan-previous-head"
            aria-expanded={previousOpen}
            onClick={() => setPreviousOpen((value) => !value)}
          >
            <span className="today-plan-previous-label">上一版计划</span>
            {previousStamp ? <time>{previousStamp}</time> : null}
            {Number.isFinite(previousTasks) && previousTasks > 0 ? (
              <span>· {previousTasks} 项任务</span>
            ) : previousSteps.length ? (
              <span>· {previousSteps.length} 步</span>
            ) : null}
            <span className="today-plan-previous-more">{previousOpen ? "收起 ‹" : "查看 ›"}</span>
          </button>
          {previousOpen ? (
            <div className="today-plan-previous-body">
              {previousBrief?.lead ? <p className="today-plan-previous-lead">{previousBrief.lead}</p> : null}
              {previousSteps.length ? (
                <ol className="today-plan-previous-steps">
                  {previousSteps.map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}
                </ol>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <header className="today-plan-head">
        <LucasAvatar phase={displayPhase} />
        <strong className="today-plan-title">{title}</strong>
        {status ? <span className="today-plan-lead" data-today-plan-lead>{status}</span> : null}
        {!live && candidates != null && candidates > 0 ? (
          <span className="today-plan-meta">· 分析 {candidates} 项候选任务</span>
        ) : null}
        {elapsed != null ? (
          <span className="today-plan-elapsed" data-today-plan-elapsed={elapsed} aria-label={`已用时 ${formatTodayPlanElapsed(elapsed)}`}>
            {formatTodayPlanElapsed(elapsed)}
          </span>
        ) : null}
        {!live && finishedAt ? <time className="today-plan-finished">{finishedAt}</time> : null}
        {steps.length ? (
          <button
            type="button"
            className="today-plan-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起过程" : "查看过程"}
            <span aria-hidden className={"today-plan-chevron" + (open ? "" : " is-down")}>⌄</span>
          </button>
        ) : null}
      </header>

      {open ? (
        <>
          {steps.length ? (
            <ol className="today-plan-steps" data-today-plan-steps>
              {stepRows.map((step) => (
                <li
                  key={step.key}
                  className={`today-plan-step is-${step.state}${step.kind === "tool" ? " is-tool" : ""}`}
                  data-today-plan-event={step.label}
                  data-today-plan-state={step.state}
                >
                  <span className="today-plan-step-mark" aria-hidden>
                    {step.state === "failed"
                      ? "✗"
                      : step.state === "running"
                        ? <span className="today-plan-step-spinner" />
                        : "✓"}
                  </span>
                  <span className="today-plan-step-label">{step.label}</span>
                  {step.kind === "tool" && step.detail ? (
                    <span className="today-plan-step-op" title={step.detail}>{step.detail}</span>
                  ) : null}
                  {step.state === "failed" && step.detail ? (
                    <span className="today-plan-step-reason" title={step.detail}>{step.detail}</span>
                  ) : null}
                  <time className="today-plan-step-time">{step.time}</time>
                </li>
              ))}
            </ol>
          ) : null}

          {activeThink ? (
            <div className={"today-plan-think" + (activeThink.state === "running" ? " is-streaming" : "")} data-today-plan-think>
              <span className="today-plan-think-label">
                Codex 推理
                {foldedThink ? ` · 已折叠 ${foldedThink} 段更早的推理` : ""}
              </span>
              {think.body ? (
                <p className="today-plan-think-body">
                  {think.truncated ? "…" : ""}{think.body}
                </p>
              ) : (
                <p className="today-plan-think-body is-empty">正在分析…</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
