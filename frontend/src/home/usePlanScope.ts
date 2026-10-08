/**
 * usePlanScope — the shared today/todo planning chain as a hook.
 *
 * One instance per plan scope (today = 今日规划, todo = 待办规划). Encapsulates:
 * 1. restore cached plan presentation, then read authoritative tasks on entry;
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
import { displayTasksOrBase } from "./displayTasks";
import { canonicalPlanCacheKey, memoryTasksOf, planStartEvent, restorePlanCache, runTodayPlanRefresh, savePlanCache, TODAY_PLAN_REFRESHED_MS, TODAY_PLAN_REFRESH_EVENT } from "./todayPlan";
import type { PlanScope, PlanSnapshotInfo, TodayPlanPhase } from "./todayPlan";

export interface PlanScopeClient {
  getBrief: (signal?: AbortSignal) => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  listOpenTasks: (signal?: AbortSignal) => Promise<Task[]>;
  getDisplayTasks?: (signal?: AbortSignal) => Promise<DisplayTaskRow[]>;
}

export interface UsePlanScopeResult {
  brief: TodayBrief | null;
  memoryTasks: Task[] | null;
  events: TaskEvent[];
  phase: TodayPlanPhase;
  prevBrief: TodayBrief | null;
  prevEvents: TaskEvent[];
  snapshot?: PlanSnapshotInfo;
  /** Re-runs the memory pass without POSTing (the refresh event does the same). */
  refresh: () => void;
}

type ActiveTaskFacts = {
  controller: AbortController;
  tasks: Task[] | null;
  displayTasks?: DisplayTaskRow[];
  refreshing: boolean;
  refreshPending: boolean;
};

function currentFactRows(facts: ActiveTaskFacts): Task[] {
  // A historical plan title must not undo an edit received from the task source.
  const presentation = facts.displayTasks?.map(({ title: _title, ...row }) => row);
  return displayTasksOrBase(presentation, facts.tasks || []);
}

export function usePlanScope(
  scope: PlanScope,
  client: PlanScopeClient,
  options: { enabled?: boolean } = {},
): UsePlanScopeResult {
  const enabled = options.enabled !== false;
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  const [memoryTasks, setMemoryTasks] = useState<Task[] | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [phase, setPhase] = useState<TodayPlanPhase>("idle");
  const [prevBrief, setPrevBrief] = useState<TodayBrief | null>(null);
  const [prevEvents, setPrevEvents] = useState<TaskEvent[]>([]);
  const [snapshot, setSnapshot] = useState<PlanSnapshotInfo | undefined>();
  const [tick, setTick] = useState(0);
  const startRef = useRef(false);
  const inFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const activeFactsRef = useRef<ActiveTaskFacts | null>(null);
  const firstRun = useRef(true);
  const clientRef = useRef(client);
  clientRef.current = client;

  const refreshTaskFacts = (facts: ActiveTaskFacts): void => {
    if (facts.refreshing) {
      facts.refreshPending = true;
      return;
    }
    facts.refreshing = true;
    facts.refreshPending = false;
    void clientRef.current.listOpenTasks(facts.controller.signal).then((rows) => {
      if (facts.controller.signal.aborted || activeFactsRef.current !== facts) return;
      facts.tasks = memoryTasksOf(rows);
      setMemoryTasks(currentFactRows(facts));
    }).catch(() => {
      // Keep the last successful facts and the live planner on read failure.
    }).finally(() => {
      facts.refreshing = false;
      // An invalidation received after this GET started requires a trailing
      // facts read, even if the independent planner will run much longer.
      if (facts.refreshPending && !facts.controller.signal.aborted && activeFactsRef.current === facts) {
        refreshTaskFacts(facts);
      }
    });
  };

  const refreshMemory = () => {
    // Protect both explicit and joined plans. Refresh task facts independently
    // so a long planning run cannot freeze execution progress or completed rows.
    if (startRef.current || inFlightRef.current) {
      refreshPendingRef.current = true;
      const facts = activeFactsRef.current;
      if (facts) refreshTaskFacts(facts);
      return;
    }
    setTick((tick) => tick + 1);
  };

  // A refresh only re-reads memory. It never starts or interrupts a plan.
  useEffect(() => {
    const start = () => {
      startRef.current = true;
      setTick((tick) => tick + 1);
    };
    window.addEventListener(TODAY_PLAN_REFRESH_EVENT, refreshMemory);
    window.addEventListener(planStartEvent(scope), start);
    return () => {
      window.removeEventListener(TODAY_PLAN_REFRESH_EVENT, refreshMemory);
      window.removeEventListener(planStartEvent(scope), start);
    };
  }, [scope]);

  useEffect(() => {
    // 未激活的计划作用域不发读：切到该 tab 时才读，公海/我的红人不再替它预读。
    if (!enabled) return;
    // Today and Todo share plan presentation, never their task projections.
    // Always read current owner-scoped tasks, including on quick tab re-entry:
    // a cached row may have completed or changed since the plan was generated.
    if (firstRun.current) {
      firstRun.current = false;
      const cache = restorePlanCache(canonicalPlanCacheKey());
      if (cache) {
        setBrief(cache.brief);
        setEvents(cache.events);
        setSnapshot(cache.snapshot);
      }
    }
    const controller = new AbortController();
    const facts: ActiveTaskFacts = { controller, tasks: null, refreshing: false, refreshPending: false };
    activeFactsRef.current = facts;
    inFlightRef.current = true;
    refreshPendingRef.current = false;
    let dismissTimer = 0;
    // Consume this explicit click once. Leaving the tab may abort the reader,
    // but returning must join/read the server run rather than POST again.
    const shouldStartPlan = startRef.current;
    startRef.current = false;
    void runTodayPlanRefresh(
      clientRef.current,
      (step) => {
        if (controller.signal.aborted) return;
        setPhase(step.phase);
        if (step.displayTasks) facts.displayTasks = step.displayTasks;
        if (facts.tasks !== null) {
          // Poll steps carry the chain's initial task snapshot. Once a newer
          // facts read succeeds, no later planning step may restore that snapshot.
          setMemoryTasks(currentFactRows(facts));
        } else if (step.tasks) {
          const base = memoryTasksOf(step.tasks);
          setMemoryTasks(displayTasksOrBase(step.displayTasks, base));
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
        if (step.snapshot) setSnapshot(step.snapshot);
      },
      { signal: controller.signal, scope, startPlan: shouldStartPlan },
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
    }).finally(() => {
      if (controller.signal.aborted) return;
      inFlightRef.current = false;
      if (refreshPendingRef.current) {
        refreshPendingRef.current = false;
        setTick((tick) => tick + 1);
      }
    });
    return () => {
      controller.abort();
      if (activeFactsRef.current === facts) activeFactsRef.current = null;
      inFlightRef.current = false;
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, [tick, scope, enabled]);

  useEffect(() => {
    if (phase !== "refreshed" || !memoryTasks) return;
    savePlanCache(canonicalPlanCacheKey(), {
      timestamp: Date.now(),
      // Kept empty for the legacy cache shape; only the server owns task rows.
      memoryTasks: [],
      brief,
      events,
      snapshot,
      phase,
    });
  }, [phase, memoryTasks, brief, events, snapshot, scope]);

  return {
    brief,
    memoryTasks,
    events,
    phase,
    prevBrief,
    prevEvents,
    snapshot,
    refresh: refreshMemory,
  };
}
