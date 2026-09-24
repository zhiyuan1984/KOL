import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Task, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import {
  PLAN_CACHE_TTL_MS,
  PLAN_SCOPES,
  TODAY_PLAN_CACHE_KEY,
  TODAY_PLAN_PHASE_COPY,
  TODO_PLAN_CACHE_KEY,
  clearPlanCache,
  clearPlanCaches,
  memoryTasksOf,
  planCacheKey,
  planStartEvent,
  restorePlanCache,
  runTodayPlanRefresh,
  savePlanCache,
  SCOPE_CONFIG,
  todayPlanEventLabels,
  todayPlanFailedFromBrief,
  todayPlanStatusCopy,
  type TodayPlanClient,
  type TodayPlanStep,
} from "./todayPlan";
import { todoPaneRows } from "./homeModel";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    source: "manual",
    status: "pending",
    due_at: new Date().toISOString(),
    ...partial,
  };
}

function brief(overrides: Partial<TodayBrief> = {}): TodayBrief {
  return {
    lead: "今天先核对其风险项",
    primary: { verb: "open", label: "打开未了结任务" },
    sections: [{ title: "未了结", body: "昨日任务继续", items: ["跟进报价"] }],
    todo_layout: [{ work_item_id: "tsk_due", rank: 1, why: "本轮先处理" }],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("today plan wiring", () => {
  it("Home entry reads memory only; 启动 buttons own the think POST", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    const workspace = fs.readFileSync(path.resolve(here, "./ScopeWorkspace.tsx"), "utf8");
    const progress = fs.readFileSync(path.resolve(here, "./TodayPlanProgress.tsx"), "utf8");
    const hook = fs.readFileSync(path.resolve(here, "./usePlanScope.ts"), "utf8");
    expect(home).toContain('api.tasks({ view: "open" })');
    expect(home).toContain("api.todayBrief()");
    expect(home).toContain("api.planToday()");
    expect(home).toContain("fetchTodayTasks");
    expect(home).toContain("usePlanScope");
    expect(hook).toContain("projectDisplayTasks");
    expect(hook).toContain("runTodayPlanRefresh");
    // The POST is gated on the explicit start entries, never on the page mount.
    expect(hook).toContain("startPlan: startRef.current");
    expect(hook).not.toContain("startPlan: true");
    expect(home).toContain("TODAY_PLAN_START_EVENT");
    expect(home).toContain("TODO_PLAN_START_EVENT");
    expect(home).not.toMatch(/startPlan:\s*true/);
    expect(home).not.toContain("!current.brief");
    expect(progress).toContain("data-today-plan-phase={phase}");
    expect(progress).toContain("data-today-plan-events=");
    expect(workspace).toContain("<TodayPlanProgress");
    expect(workspace).not.toContain("planning && !sections.length");
  });

  it("one workspace renders both tabs; switching reuses open-task memory", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    const workspace = fs.readFileSync(path.resolve(here, "./ScopeWorkspace.tsx"), "utf8");
    const slices = fs.readFileSync(path.resolve(here, "./scopeRows.ts"), "utf8");
    const homeModel = fs.readFileSync(path.resolve(here, "./homeModel.ts"), "utf8");
    expect(home).toContain("homeMemoryTasks");
    expect(home).toContain('usePlanScope("todo"');
    // 今日任务 / 我的待办 render the one workspace component, scope-parameterized.
    expect(home.match(/<ScopeWorkspace/g)?.length).toBe(1);
    expect(home).toContain("paneScope");
    expect(home).not.toContain("TodoPane");
    expect(home).not.toContain("TodayPane");
    const hook = fs.readFileSync(path.resolve(here, "./usePlanScope.ts"), "utf8");
    expect(hook).toMatch(/\[tick, scope\]/);
    expect(home).not.toMatch(/if \(mode !== "today"\)/);
    expect(home).not.toMatch(/if \(mode !== "todo"\) return;/);
    expect(home).not.toMatch(/mode === "todo"[\s\S]{0,240}todayBrief\(\)/);
    expect(home).not.toMatch(/mode === "todo"[\s\S]{0,240}homeBoard/);
    expect(home).not.toMatch(/runTodayPlanRefresh[\s\S]{0,800}homeBoard/);
    expect(home).not.toMatch(/setTodayBrief\(step\.brief[\s\S]{0,200}homeBoard/);
    expect(workspace).toContain("<TodayPlanProgress");
    expect(workspace).toContain("<TaskBoard");
    expect(workspace).not.toContain("fetchTodayTasks");
    expect(workspace).not.toContain("projectDisplayTasks");
    expect(workspace).not.toContain("homeBoard");
    expect(workspace).not.toContain("todayBrief()");
    // The slice each tab answers for is the only row-level difference left.
    expect(slices).toContain("isTodayScheduled(task)");
    expect(slices).toContain("!isTodayScheduled(task)");
    expect(homeModel).toContain("todoLayout?.length ? applyTodoLayout(members, todoLayout) : sortOpenWorkItems(members)");
  });

  it("when tasks exist the todo slice shows rows immediately without layout", () => {
    const rows = todoPaneRows([
      task({ id: "tsk_due", title: "写报价", status: "waiting", due_at: new Date().toISOString() }),
      task({ id: "tsk_later", title: "画像补全", status: "queued" }),
    ], "all");
    expect(rows.map((row) => row.id)).toEqual(["tsk_due", "tsk_later"]);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const slices = fs.readFileSync(path.resolve(here, "./scopeRows.ts"), "utf8");
    expect(slices).toContain("todoPaneRows");
    expect(slices).not.toContain("fetchTodayTasks");
    expect(slices).not.toContain("projectDisplayTasks");
    expect(slices).not.toMatch(/if \(!todoLayout\)/);
    expect(slices).not.toMatch(/if \(phase === "planning"\)[\s\S]{0,80}return/);
    expect(slices).not.toContain("today_brief");
  });
});

describe("today plan three-phase copy", () => {
  it("locks the four product strings", () => {
    expect(TODAY_PLAN_PHASE_COPY).toEqual({
      "loading-memory": "正在读取当前任务",
      planning: "Lucas正在高效为你规划今天的任务",
      refreshed: "已按本轮规划刷新",
      failed: "规划失败，仍可按下面任务操作",
    });
    expect(todayPlanStatusCopy("idle")).toBe("");
    expect(todayPlanStatusCopy("loading-memory")).toBe("正在读取当前任务");
    expect(todayPlanStatusCopy("planning")).toBe("Lucas正在高效为你规划今天的任务");
  });

  it("drops today_plan rows from the memory list", () => {
    const open = task({ id: "tsk_due", title: "写报价" });
    const plan = task({
      id: "tsk_plan",
      title: "今日规划",
      task_type: "today_plan",
      source: "planning",
      status: "running",
    });
    expect(memoryTasksOf([open, plan]).map((row) => row.id)).toEqual(["tsk_due"]);
  });
});

describe("runTodayPlanRefresh", () => {
  it("startPlan:false reads memory and stops at idle without POSTing", async () => {
    const open = [task({ id: "tsk_due", title: "写报价确认邮件" })];
    const startPlan = vi.fn(async () => ({ planning: true, attached: false }));
    const client: TodayPlanClient = {
      listOpenTasks: async () => open,
      getBrief: async () => ({ planning: false, brief: brief(), events: [], creates_session: false, calls_model: false }),
      startPlan,
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
      startPlan: false,
    });
    expect(startPlan).not.toHaveBeenCalled();
    expect(final.phase).toBe("idle");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
    expect(final.brief?.lead).toBe("今天先核对其风险项");
    expect(steps.every((step) => step.phase === "idle")).toBe(true);
    expect(steps.some((step) => step.phase === "planning")).toBe(false);
    // Nothing started, so the pane must not claim it did.
    expect(steps.some((step) => step.phase === "loading-memory")).toBe(false);
  });

  it("startPlan:false still joins a plan that is already running", async () => {
    const startPlan = vi.fn(async () => ({ planning: true, attached: false }));
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: async () => [task({ id: "tsk_due", title: "写报价" })],
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) return { planning: true, brief: brief({ lead: "进行中" }), work_item_id: "tsk_plan" };
        return { planning: false, brief: brief({ lead: "刷新后" }), events: [{ type: "run.completed" }] };
      },
      startPlan,
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
      startPlan: false,
    });
    expect(startPlan).not.toHaveBeenCalled();
    expect(steps.some((step) => step.phase === "planning" && step.attached)).toBe(true);
    expect(final.phase).toBe("refreshed");
    expect(final.brief?.lead).toBe("刷新后");
  });

  it("shows the task list in loading-memory before POST and keeps it while planning", async () => {
    const open = [task({ id: "tsk_due", title: "写报价确认邮件" })];
    const listHold = deferred<Task[]>();
    const memoryHold = deferred<TodayBriefResponse>();
    const released = deferred<TodayBriefResponse>();
    const planHold = deferred<TodayPlanResult>();
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: vi.fn(async () => listHold.promise),
      getBrief: vi.fn(async () => {
        briefCalls += 1;
        if (briefCalls === 1) return memoryHold.promise;
        return released.promise;
      }),
      startPlan: vi.fn(async () => planHold.promise),
    };
    const steps: TodayPlanStep[] = [];
    const run = runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
    });

    listHold.resolve(open);
    await vi.waitFor(() => {
      expect(steps.some((step) => step.phase === "loading-memory" && step.tasks?.some((row) => row.id === "tsk_due"))).toBe(true);
    });
    expect(client.startPlan).not.toHaveBeenCalled();
    expect(steps.some((step) => step.phase === "planning")).toBe(false);

    memoryHold.resolve({ planning: false, brief: null, events: [], creates_session: false, calls_model: false });
    await vi.waitFor(() => expect(steps.some((step) => step.phase === "planning")).toBe(true));
    expect(steps.some((step) => step.phase === "planning" && step.tasks?.some((row) => row.id === "tsk_due"))).toBe(true);

    planHold.resolve({ planning: true, attached: false, work_item_id: "tsk_plan" });
    await vi.waitFor(() => expect(client.startPlan).toHaveBeenCalledTimes(1));
    expect(steps.filter((step) => step.phase === "planning").every((step) => (
      step.tasks?.some((row) => row.id === "tsk_due")
    ))).toBe(true);

    released.resolve({
      planning: false,
      brief: brief(),
      events: [
        { type: "run.progress", title: "已读取当前任务记忆" },
        { type: "run.progress", title: "已打包来源增量" },
        { type: "run.completed", label: "今日规划已完成" },
      ],
    });
    const final = await run;
    expect(final.phase).toBe("refreshed");
    expect(final.brief?.lead).toBe("今天先核对其风险项");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
    expect(final.tasks?.some((row) => row.id === "tsk_plan")).toBe(false);
    expect(todayPlanEventLabels(final.events)).toEqual([
      "已读取当前任务记忆",
      "已打包来源增量",
      "今日规划已完成",
    ]);
    expect(steps[0]).toMatchObject({ phase: "loading-memory" });
    expect(steps.map((step) => step.phase)).toEqual(expect.arrayContaining([
      "loading-memory",
      "planning",
      "refreshed",
    ]));
  });

  it("polls pass new brief events into the pane and keep the task list", async () => {
    const open = [task({ id: "tsk_due", title: "写报价" })];
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: async () => open,
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) {
          return { planning: false, brief: null, events: [], creates_session: false, calls_model: false };
        }
        if (briefCalls === 2) {
          return {
            planning: true,
            brief: null,
            events: [
              { type: "run.progress", title: "已读取当前任务记忆" },
              { type: "run.progress", title: "已打包来源增量" },
            ],
          };
        }
        if (briefCalls === 3) {
          return {
            planning: true,
            brief: null,
            events: [
              { type: "run.progress", title: "已读取当前任务记忆" },
              { type: "run.progress", title: "已打包来源增量" },
              { type: "run.progress", title: "已提交 Codex 规划" },
              { type: "run.progress", title: "正在生成今日简报" },
            ],
          };
        }
        return {
          planning: false,
          brief: brief(),
          events: [
            { type: "run.progress", title: "已读取当前任务记忆" },
            { type: "run.progress", title: "已打包来源增量" },
            { type: "run.progress", title: "已提交 Codex 规划" },
            { type: "run.progress", title: "正在生成今日简报" },
            { type: "run.completed", title: "今日规划已完成" },
          ],
        };
      },
      startPlan: async () => ({ planning: true, attached: false }),
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
    });
    const planningSteps = steps.filter((step) => step.phase === "planning" && step.events?.length);
    expect(planningSteps.some((step) => todayPlanEventLabels(step.events).includes("已提交 Codex 规划"))).toBe(true);
    expect(planningSteps.every((step) => step.tasks?.some((row) => row.id === "tsk_due"))).toBe(true);
    expect(todayPlanEventLabels(final.events)).toEqual([
      "已读取当前任务记忆",
      "已打包来源增量",
      "已提交 Codex 规划",
      "正在生成今日简报",
      "今日规划已完成",
    ]);
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
  });

  it("GET brief in the memory phase does not start a session or call the model", async () => {
    const order: string[] = [];
    const client: TodayPlanClient = {
      listOpenTasks: async () => {
        order.push("list");
        return [task({ id: "tsk_due", title: "写报价" })];
      },
      getBrief: async () => {
        order.push("brief");
        return { planning: false, brief: null, creates_session: false, calls_model: false, events: [] };
      },
      startPlan: async () => {
        order.push("plan");
        return { planning: true, attached: false };
      },
    };
    let briefCalls = 0;
    const wrapped: TodayPlanClient = {
      listOpenTasks: client.listOpenTasks,
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) return client.getBrief();
        return {
          planning: false,
          brief: brief(),
          events: [{ type: "run.completed" }],
        };
      },
      startPlan: client.startPlan,
    };
    await runTodayPlanRefresh(wrapped, () => undefined, { pollMs: 0, sleep: async () => undefined });
    expect(order.slice(0, 2).sort()).toEqual(["brief", "list"]);
    expect(order[2]).toBe("plan");
    expect(order.indexOf("brief")).toBeLessThan(order.indexOf("plan"));
    expect(order.indexOf("list")).toBeLessThan(order.indexOf("plan"));
  });

  it("does not skip POST when a brief already exists", async () => {
    const existing = brief({ lead: "旧规划" });
    let briefCalls = 0;
    const startPlan = vi.fn(async () => ({ planning: true, attached: false }));
    const client: TodayPlanClient = {
      listOpenTasks: async () => [task({ id: "tsk_due", title: "写报价" })],
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) {
          return { planning: false, brief: existing, creates_session: false, calls_model: false };
        }
        return {
          planning: false,
          brief: brief({ lead: "新规划" }),
          events: [{ type: "run.completed" }],
        };
      },
      startPlan,
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
    });
    expect(startPlan).toHaveBeenCalledTimes(1);
    expect(steps.some((step) => step.phase === "planning" && step.brief?.lead === "旧规划")).toBe(true);
    expect(final.phase).toBe("refreshed");
    expect(final.brief?.lead).toBe("新规划");
  });

  it("attaches a running today_plan instead of starting another", async () => {
    const startPlan = vi.fn(async () => ({ planning: true, attached: true }));
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: async () => [task({ id: "tsk_due", title: "写报价" })],
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) {
          return { planning: true, brief: brief({ lead: "进行中" }), work_item_id: "tsk_plan" };
        }
        return {
          planning: false,
          brief: brief({ lead: "刷新后" }),
          events: [{ type: "run.completed" }],
        };
      },
      startPlan,
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
    });
    expect(startPlan).not.toHaveBeenCalled();
    expect(steps.some((step) => step.phase === "planning" && step.attached)).toBe(true);
    expect(final.phase).toBe("refreshed");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
  });

  it("keeps the memory list when planning fails", async () => {
    const open = [task({ id: "tsk_due", title: "写报价" }), task({
      id: "tsk_over",
      title: "补寄样品",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    })];
    const startPlan = vi.fn(async () => {
      throw new Error("plan down");
    });
    const client: TodayPlanClient = {
      listOpenTasks: async () => open,
      getBrief: async () => ({ planning: false, brief: null, creates_session: false }),
      startPlan,
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
    });
    expect(final.phase).toBe("failed");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due", "tsk_over"]);
    expect(steps.some((step) => step.phase === "loading-memory" && step.tasks?.length === 2)).toBe(true);
    expect(final.tasks?.some((row) => row.task_type === "today_plan")).toBe(false);
  });

  it("keeps the list when the run reports failure after poll", async () => {
    const open = [task({ id: "tsk_due", title: "写报价" })];
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: async () => open,
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) return { planning: false, brief: brief({ lead: "旧" }) };
        return {
          planning: false,
          brief: brief({ lead: "旧" }),
          events: [{ type: "run.failed", label: "今日规划失败" }],
        };
      },
      startPlan: async () => ({ planning: true, attached: false }),
    };
    const final = await runTodayPlanRefresh(client, () => undefined, {
      pollMs: 0,
      sleep: async () => undefined,
    });
    expect(todayPlanFailedFromBrief({
      planning: false,
      events: [{ type: "run.failed", label: "今日规划失败" }],
    })).toBe(true);
    expect(final.phase).toBe("failed");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
    expect(final.brief?.lead).toBe("旧");
  });
});

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe("plan cache", () => {
  it("round-trips today/todo planning memory through sessionStorage", () => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    const memory = {
      timestamp: Date.now(),
      memoryTasks: [task({ id: "tsk_due", title: "写报价" })],
      brief: brief(),
      events: [{ type: "run.completed", title: "今日规划已完成" }],
      phase: "refreshed" as const,
    };
    savePlanCache(TODAY_PLAN_CACHE_KEY, memory);
    const restored = restorePlanCache(TODAY_PLAN_CACHE_KEY);
    expect(restored?.memoryTasks.map((row) => row.id)).toEqual(["tsk_due"]);
    expect(restored?.brief?.lead).toBe("今天先核对其风险项");
    expect(todayPlanEventLabels(restored?.events)).toEqual(["今日规划已完成"]);
    expect(restored?.phase).toBe("refreshed");
    expect(restorePlanCache(TODO_PLAN_CACHE_KEY)).toBeNull();
  });

  it("drops expired and corrupt entries", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    savePlanCache(TODAY_PLAN_CACHE_KEY, {
      timestamp: Date.now() - PLAN_CACHE_TTL_MS - 1,
      memoryTasks: [],
      brief: null,
      events: [],
      phase: "refreshed",
    });
    expect(restorePlanCache(TODAY_PLAN_CACHE_KEY)).toBeNull();

    storage.setItem(TODAY_PLAN_CACHE_KEY, "{not json");
    expect(restorePlanCache(TODAY_PLAN_CACHE_KEY)).toBeNull();

    savePlanCache(TODAY_PLAN_CACHE_KEY, {
      timestamp: Date.now(),
      memoryTasks: [],
      brief: null,
      events: [],
      phase: "refreshed",
    });
    clearPlanCache(TODAY_PLAN_CACHE_KEY);
    expect(restorePlanCache(TODAY_PLAN_CACHE_KEY)).toBeNull();
  });

  it("Home restores cache before planning and writes it back on refresh", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    const hook = fs.readFileSync(path.resolve(here, "./usePlanScope.ts"), "utf8");
    expect(home).toContain("usePlanScope");
    expect(hook).toContain("restorePlanCache(planCacheKey(scope))");
    expect(hook).toContain("savePlanCache(planCacheKey(scope)");
    const restoreIdx = hook.indexOf("restorePlanCache(planCacheKey(scope))");
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeLessThan(hook.indexOf("runTodayPlanRefresh("));
    expect(hook.indexOf("savePlanCache(planCacheKey(scope)")).toBeGreaterThan(restoreIdx);
  });

  it("keeps the sidebar 新工作任务 link free of refresh dispatch", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const workbench = fs.readFileSync(path.resolve(here, "../layout/Workbench.tsx"), "utf8");
    expect(workbench).not.toContain("TODAY_PLAN_REFRESH_EVENT");
    const navStart = workbench.indexOf('data-nav="new-task"');
    const navEnd = workbench.indexOf('data-nav="running"');
    const newTaskLink = workbench.slice(
      workbench.lastIndexOf("<Link", navStart),
      navEnd,
    );
    expect(newTaskLink).not.toContain("dispatchEvent");
  });

  it("sidebar brand shows the Li Time logo with Lucas and no duplicate product name", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const workbench = fs.readFileSync(path.resolve(here, "../layout/Workbench.tsx"), "utf8");
    const brandStart = workbench.indexOf('data-sidebar-brand');
    const brandEnd = workbench.indexOf("</NavLink>", brandStart);
    const brandBlock = workbench.slice(brandStart, brandEnd);
    expect(brandBlock).toContain('<BrandLockup variant="sidebar" />');
    expect(brandBlock).toContain("Lucas6.webp");
    expect(brandBlock).not.toContain("灵工 工作");
    expect(brandBlock).not.toContain(">Li Time<");
    expect(brandBlock).not.toContain("sidebar-brand-sub");
  });

  it("clears cached plans on logout and login so rows never cross accounts", () => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    savePlanCache(TODAY_PLAN_CACHE_KEY, {
      timestamp: Date.now(),
      memoryTasks: [task({ id: "tsk_due", title: "写报价" })],
      brief: null,
      events: [],
      phase: "refreshed",
    });
    savePlanCache(TODO_PLAN_CACHE_KEY, {
      timestamp: Date.now(),
      memoryTasks: [task({ id: "tsk_todo", title: "补寄样品" })],
      brief: null,
      events: [],
      phase: "refreshed",
    });
    clearPlanCaches();
    expect(restorePlanCache(TODAY_PLAN_CACHE_KEY)).toBeNull();
    expect(restorePlanCache(TODO_PLAN_CACHE_KEY)).toBeNull();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const gate = fs.readFileSync(path.resolve(here, "../components/AuthGate.tsx"), "utf8");
    expect(gate.match(/clearPlanCaches\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("todo scope wiring", () => {
  it("routes cache keys, start events and board labels through SCOPE_CONFIG", () => {
    expect(planCacheKey("today")).toBe("lingong:today-plan-cache");
    expect(planCacheKey("todo")).toBe("lingong:todo-plan-cache");
    expect(planStartEvent("today")).toBe("lingong:today-plan-start");
    expect(planStartEvent("todo")).toBe("lingong:todo-plan-start");
    expect(SCOPE_CONFIG.today.boardIdleLabel).toBe("启动今日任务");
    expect(SCOPE_CONFIG.todo.boardIdleLabel).toBe("启动待办任务");
    expect(SCOPE_CONFIG.todo.boardAgainLabel).toBe("重新生成待办计划");
  });

  it("keeps every pane string in SCOPE_CONFIG so the two tabs cannot drift", () => {
    const panel = ["heroTitle", "boardTitle", "railLabel", "railToggleLabel", "boardSearchLabel", "railStorageKey", "planSummaryLabel"] as const;
    for (const scope of PLAN_SCOPES) {
      for (const key of panel) expect(String(SCOPE_CONFIG[scope][key]).trim()).toBeTruthy();
      expect(SCOPE_CONFIG[scope].emptyCopy.title).toBeTruthy();
      expect(SCOPE_CONFIG[scope].emptyCopy.hint).toBeTruthy();
      expect(SCOPE_CONFIG[scope].streamEmpty.title).toBeTruthy();
      expect(SCOPE_CONFIG[scope].streamEmpty.body).toBeTruthy();
    }
    expect(SCOPE_CONFIG.today.heroTitle).toBe("今天有什么工作要处理？");
    expect(SCOPE_CONFIG.todo.heroTitle).toBe("我的待办");
    expect(SCOPE_CONFIG.today.boardTitle).toBe("今日工作计划");
    expect(SCOPE_CONFIG.todo.boardTitle).toBe("我的待办");
    expect(SCOPE_CONFIG.today.railLabel).toBe("今日任务表");
    expect(SCOPE_CONFIG.todo.railLabel).toBe("待办任务表");
    expect(SCOPE_CONFIG.today.planSummaryLabel).toBe("今日计划摘要");
    expect(SCOPE_CONFIG.todo.planSummaryLabel).toBe("待办计划摘要");
    // 右栏搜索只搜自己面板里的任务行，文案不带「红人/说明」。
    expect(SCOPE_CONFIG.today.boardSearchLabel).toBe("搜索任务");
    expect(SCOPE_CONFIG.todo.boardSearchLabel).toBe("搜索任务");
    // The rail keeps remembering its own scope, and today keeps its old key.
    expect(SCOPE_CONFIG.today.railStorageKey).toBe("ui:home-today-task-rail-collapsed");
    expect(SCOPE_CONFIG.todo.railStorageKey).toBe("ui:home-todo-task-rail-collapsed");
    expect(new Set(PLAN_SCOPES.map((scope) => SCOPE_CONFIG[scope].railStorageKey)).size).toBe(2);
    expect(Object.keys(SCOPE_CONFIG.today).sort()).toEqual(Object.keys(SCOPE_CONFIG.todo).sort());
  });

  it("todayPlanFailedFromBrief reads the todo failure copy for the todo scope", () => {
    expect(todayPlanFailedFromBrief({ events: [{ type: "run.progress", title: "待办规划未通过" }] }, "todo")).toBe(true);
    expect(todayPlanFailedFromBrief({ events: [{ type: "run.progress", title: "待办规划未通过" }] }, "today")).toBe(false);
    expect(todayPlanFailedFromBrief({ events: [{ type: "run.progress", title: "今日规划失败" }] }, "todo")).toBe(false);
    expect(todayPlanFailedFromBrief({ events: [{ type: "run.progress", title: "今日规划失败" }] }, "today")).toBe(true);
  });

  it("runTodayPlanRefresh completes a todo-scope run through the shared chain", async () => {
    const open = [task({ id: "tsk_todo", title: "补寄样品" })];
    let briefCalls = 0;
    const client: TodayPlanClient = {
      listOpenTasks: async () => open,
      getBrief: async () => {
        briefCalls += 1;
        if (briefCalls === 1) return { planning: false, brief: null, events: [], creates_session: false, calls_model: false };
        return {
          planning: false,
          brief: brief({ lead: "先补寄样品再跟进报价" }),
          events: [
            { type: "run.progress", title: "已读取待办任务记忆" },
            { type: "run.completed", label: "待办规划已完成" },
          ],
        };
      },
      startPlan: vi.fn(async () => ({ planning: true, attached: false, work_item_id: "tsk_todo_plan" })),
    };
    const steps: TodayPlanStep[] = [];
    const final = await runTodayPlanRefresh(client, (step) => steps.push(step), {
      pollMs: 0,
      sleep: async () => undefined,
      scope: "todo",
    });
    expect(final.phase).toBe("refreshed");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_todo"]);
    expect(todayPlanEventLabels(final.events)).toEqual(["已读取待办任务记忆", "待办规划已完成"]);
    expect(steps.map((step) => step.phase)).toEqual(expect.arrayContaining(["loading-memory", "planning", "refreshed"]));
  });
});
