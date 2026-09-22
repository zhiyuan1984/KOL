/**
 * usePlanScope — the shared today/todo planning chain as a hook.
 *
 * One instance per plan scope (today = 今日规划, todo = 待办规划). Encapsulates:
 * 1. restore fresh cache on first mount (5-minute TTL);
 * 2. listen for the shared refresh event and the scope's explicit start event;
 * 3. run the planning chain (memory read → optional think POST → poll);
 * 4. write the cache when a run settles as `refreshed`.
 *
 * The scope's start entry raises `startRef`, which lets the next tick POST
 * /api/home/{scope}-brief/plan. Entering a tab only ticks (memory read) —
 * the think run never starts unbidden.
 */
import { useEffect, useRef, useState } from "react";
import type { Task, TaskEvent, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import type { DisplayTaskRow } from "./displayTasks";
import { projectDisplayTasks } from "./displayTasks";
import { memoryTasksOf, planCacheKey, planStartEvent, restorePlanCache, runTodayPlanRefresh, savePlanCache, TODAY_PLAN_REFRESHED_MS, TODAY_PLAN_REFRESH_EVENT } from "./todayPlan";
import type { PlanScope, TodayPlanPhase } from "./todayPlan";

export interface PlanScopeClient {
  getBrief: () => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  listOpenTasks: () => Promise<Task[]>;
  getDisplayTasks?: () => Promise<DisplayTaskRow[]>;
}

export interface UsePlanScopeResult {
  brief: TodayBrief | null;
  memoryTasks: Task[] | null;
  events: TaskEvent[];
  phase: TodayPlanPhase;
  prevBrief: TodayBrief | null;
  prevEvents: TaskEvent[];
  /** Re-runs the memory pass without POSTing (the refresh event does the same). */
  refresh: () => void;
}

export function usePlanScope(scope: PlanScope, client: PlanScopeClient): UsePlanScopeResult {
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  const [memoryTasks, setMemoryTasks] = useState<Task[] | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [phase, setPhase] = useState<TodayPlanPhase>("idle");
  const [prevBrief, setPrevBrief] = useState<TodayBrief | null>(null);
  const [prevEvents, setPrevEvents] = useState<TaskEvent[]>([]);
  const [tick, setTick] = useState(0);
  const startRef = useRef(false);
  const firstRun = useRef(true);
  const clientRef = useRef(client);
  clientRef.current = client;

  // A refresh re-reads memory; a start posts the run. Neither tab switch nor
  // page entry dispatches a start, so no thinking run begins unbidden. While a
  // start run is in flight the ref is up, and a refresh must not cut it short.
  useEffect(() => {
    const refresh = () => {
      if (!startRef.current) setTick((tick) => tick + 1);
    };
    const start = () => {
      startRef.current = true;
      setTick((tick) => tick + 1);
    };
    window.addEventListener(TODAY_PLAN_REFRESH_EVENT, refresh);
    window.addEventListener(planStartEvent(scope), start);
    return () => {
      window.removeEventListener(TODAY_PLAN_REFRESH_EVENT, refresh);
      window.removeEventListener(planStartEvent(scope), start);
    };
  }, [scope]);

  useEffect(() => {
    // On first mount, restore fresh cached planning instead of re-running Codex.
    if (firstRun.current) {
      firstRun.current = false;
      const cache = restorePlanCache(planCacheKey(scope));
      if (cache) {
        setMemoryTasks(cache.memoryTasks);
        setBrief(cache.brief);
        setEvents(cache.events);
        setPhase(cache.phase);
        return;
      }
    }
    const controller = new AbortController();
    let dismissTimer = 0;
    void runTodayPlanRefresh(
      clientRef.current,
      (step) => {
        if (controller.signal.aborted) return;
        setPhase(step.phase);
        if (step.tasks) {
          const base = memoryTasksOf(step.tasks);
          setMemoryTasks(
            step.displayTasks?.length ? projectDisplayTasks(step.displayTasks, base) : base,
          );
        }
        if (Object.prototype.hasOwnProperty.call(step, "brief")) {
          setBrief(step.brief ?? null);
        }
        if (Object.prototype.hasOwnProperty.call(step, "previousBrief")) {
          setPrevBrief(step.previousBrief ?? null);
        }
        if (Array.isArray(step.previousEvents)) {
          setPrevEvents(step.previousEvents);
        }
        if (Array.isArray(step.events)) {
          setEvents(step.events);
        }
      },
      { signal: controller.signal, scope, startPlan: startRef.current },
    ).then((final) => {
      if (controller.signal.aborted) return;
      startRef.current = false;
      if (final.phase === "refreshed") {
        dismissTimer = window.setTimeout(() => {
          if (!controller.signal.aborted) {
            setPhase((current) => (current === "refreshed" ? "idle" : current));
          }
        }, TODAY_PLAN_REFRESHED_MS);
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      startRef.current = false;
      setPhase("failed");
    });
    return () => {
      controller.abort();
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, [tick, scope]);

  useEffect(() => {
    if (phase !== "refreshed" || !memoryTasks) return;
    savePlanCache(planCacheKey(scope), {
      timestamp: Date.now(),
      memoryTasks,
      brief,
      events,
      phase,
    });
  }, [phase, memoryTasks, brief, events, scope]);

  return {
    brief,
    memoryTasks,
    events,
    phase,
    prevBrief,
    prevEvents,
    refresh: () => setTick((tick) => tick + 1),
  };
}
