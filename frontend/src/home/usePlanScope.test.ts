import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../api";
import type { PlanScopeClient } from "./usePlanScope";
import type { TodayPlanRefreshOptions, TodayPlanStep } from "./todayPlan";

// Exercise the hook's effect/controller boundary without a DOM dependency.
const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  runs: [] as Array<{
    step: (value: TodayPlanStep) => void;
    options: TodayPlanRefreshOptions;
    resolve: (value: TodayPlanStep) => void;
  }>,
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const setter = vi.fn();
    harness.setters.push(setter);
    return [initial, setter];
  },
}));

vi.mock("./todayPlan", async (original) => ({
  ...await original<typeof import("./todayPlan")>(),
  runTodayPlanRefresh: (_client: unknown, step: (value: TodayPlanStep) => void, options: TodayPlanRefreshOptions) => (
    new Promise<TodayPlanStep>((resolve) => harness.runs.push({ step, options, resolve }))
  ),
}));

import { usePlanScope } from "./usePlanScope";
import { planStartEvent, TODAY_PLAN_CACHE_KEY, TODAY_PLAN_REFRESH_EVENT } from "./todayPlan";

let cleanup: Array<() => void> = [];

beforeEach(() => {
  harness.effects.length = 0;
  harness.setters.length = 0;
  harness.runs.length = 0;
  cleanup = [];
  const events = Object.assign(new EventTarget(), { setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  vi.stubGlobal("window", events);
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});

afterEach(() => {
  for (const effect of cleanup) effect();
  vi.unstubAllGlobals();
});

function mount(overrides: Partial<PlanScopeClient> = {}) {
  const result = usePlanScope("todo", {
    listOpenTasks: vi.fn(async () => []),
    getBrief: vi.fn(async () => ({ planning: false, brief: null })),
    startPlan: vi.fn(async () => ({ planning: true, attached: false })),
    ...overrides,
  });
  for (const effect of harness.effects) {
    const dispose = effect();
    if (dispose) cleanup.push(dispose);
  }
  return result;
}

async function settle() {
  harness.runs[0].resolve({ phase: "idle" });
  // Resolve then/catch/finally in the hook.
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("usePlanScope refresh ownership", () => {
  it("performs a trailing facts read for changes arriving during the previous GET", async () => {
    let resolveFirst!: (rows: Task[]) => void;
    let resolveSecond!: (rows: Task[]) => void;
    const first = new Promise<Task[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<Task[]>((resolve) => { resolveSecond = resolve; });
    const listOpenTasks = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const startPlan = vi.fn();
    const result = mount({ listOpenTasks, startPlan });
    const run = harness.runs[0];
    const oldTask: Task = { id: "finishing", title: "完成前的快照", source: "manual", status: "running" };
    run.step({ phase: "planning", planning: true, attached: true, tasks: [oldTask] });
    result.refresh();
    // The first GET already captured old facts when a second completion arrives.
    window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT));
    window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT));
    expect(listOpenTasks).toHaveBeenCalledTimes(1);
    resolveFirst([oldTask]);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(listOpenTasks).toHaveBeenCalledTimes(2);
    resolveSecond([]);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(harness.setters[1]).toHaveBeenLastCalledWith([]);
    expect(listOpenTasks).toHaveBeenCalledTimes(2);
    run.step({ phase: "planning", tasks: [oldTask] });
    expect(harness.setters[1]).toHaveBeenLastCalledWith([]);
    expect(run.options.signal?.aborted).toBe(false);
    expect(harness.runs).toHaveLength(1);
    expect(startPlan).not.toHaveBeenCalled();
    expect(harness.setters[7]).not.toHaveBeenCalled();
  });

  it("updates completed and edited facts during a long plan without aborting or restarting it", async () => {
    const before: Task[] = [
      { id: "finished", title: "尚未完成", source: "manual", status: "running", plan_view: "today" },
      { id: "edited", title: "旧标题", source: "manual", status: "pending", plan_view: "today" },
    ];
    const edited: Task = { ...before[1], title: "最新标题", status: "waiting", plan_view: "todo" };
    const listOpenTasks = vi.fn(async () => [edited]);
    const startPlan = vi.fn();
    const result = mount({ listOpenTasks, startPlan });
    const run = harness.runs[0];
    const staleStep: TodayPlanStep = {
      phase: "planning", planning: true, attached: true, tasks: before,
      displayTasks: [{ work_item_id: "finished", title: "旧完成任务" }, { work_item_id: "edited", title: "规划里的旧标题", view: "today" }],
    };
    run.step(staleStep);
    result.refresh();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(listOpenTasks).toHaveBeenCalledTimes(1);
    const latestRows = harness.setters[1].mock.lastCall?.[0] as Task[];
    expect(latestRows).toHaveLength(1);
    expect(latestRows[0]).toMatchObject(edited);
    // The original planner keeps polling its old snapshot, including at completion.
    run.step(staleStep);
    expect(harness.setters[1].mock.lastCall?.[0]).toEqual(latestRows);
    run.step({ ...staleStep, phase: "refreshed", planning: false });
    expect(harness.setters[1].mock.lastCall?.[0]).toEqual(latestRows);
    expect(run.options.signal?.aborted).toBe(false);
    expect(harness.runs).toHaveLength(1);
    expect(startPlan).not.toHaveBeenCalled();
    expect(harness.setters[7]).not.toHaveBeenCalled();
  });

  it("re-reads authoritative tasks despite a fresh shared plan cache", () => {
    const cachedBrief = { lead: "旧计划" };
    vi.mocked(sessionStorage.getItem).mockImplementation((key) => key === TODAY_PLAN_CACHE_KEY ? JSON.stringify({
      timestamp: Date.now(), brief: cachedBrief, events: [], phase: "refreshed",
      memoryTasks: [{ id: "cached-completed", title: "旧任务", status: "pending" }],
    }) : null);
    mount();
    expect(harness.setters[0]).toHaveBeenCalledWith(cachedBrief);
    expect(harness.setters[1]).not.toHaveBeenCalled();
    expect(harness.runs).toHaveLength(1);
    expect(harness.runs[0].options.startPlan).toBe(false);
    harness.runs[0].step({ phase: "idle", tasks: [] });
    expect(harness.setters[1]).toHaveBeenLastCalledWith([]);
  });

  it("coalesces polling refreshes until a joined plan settles without aborting it", async () => {
    const result = mount();
    const run = harness.runs[0];
    expect(run.options.startPlan).toBe(false);
    run.step({ phase: "planning", planning: true, attached: true });
    window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT));
    result.refresh();
    expect(harness.setters[7]).not.toHaveBeenCalled();
    expect(run.options.signal?.aborted).toBe(false);
    await settle();
    expect(harness.setters[7]).toHaveBeenCalledTimes(1);
    expect(run.options.signal?.aborted).toBe(false);
  });

  it("consumes a start click once when leaving and returning to the pane", async () => {
    mount();
    await settle();
    window.dispatchEvent(new Event(planStartEvent("todo")));
    const firstCleanup = harness.effects[1]();
    expect(harness.runs[1].options.startPlan).toBe(true);
    firstCleanup?.();
    expect(harness.runs[1].options.signal?.aborted).toBe(true);
    const returnCleanup = harness.effects[1]();
    expect(harness.runs[2].options.startPlan).toBe(false);
    returnCleanup?.();
  });

  it("refreshes an idle pane immediately after the prior read settles", async () => {
    mount();
    await settle();
    window.dispatchEvent(new Event(TODAY_PLAN_REFRESH_EVENT));
    expect(harness.setters[7]).toHaveBeenCalledTimes(1);
    expect(harness.runs[0].options.startPlan).toBe(false);
  });
});
