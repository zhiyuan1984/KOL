import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Task, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import {
  TODAY_PLAN_PHASE_COPY,
  memoryTasksOf,
  runTodayPlanRefresh,
  todayPlanFailedFromBrief,
  todayPlanStatusCopy,
  type TodayPlanClient,
  type TodayPlanStep,
} from "./todayPlan";

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
  it("Home always runs memory GETs then think POST on Today entry", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    const pane = fs.readFileSync(path.resolve(here, "./TodayPane.tsx"), "utf8");
    expect(home).toContain('api.tasks({ view: "open" })');
    expect(home).toContain("api.todayBrief()");
    expect(home).toContain("api.planToday()");
    expect(home).toContain("runTodayPlanRefresh");
    expect(home).not.toContain("!current.brief");
    expect(pane).toContain("data-today-plan-phase={phase}");
    expect(pane).not.toContain("planning && !sections.length");
  });
});

describe("today plan three-phase copy", () => {
  it("locks the four product strings", () => {
    expect(TODAY_PLAN_PHASE_COPY).toEqual({
      "loading-memory": "正在读取当前任务",
      planning: "正在按最新记忆规划今天",
      refreshed: "已按本轮规划刷新",
      failed: "规划失败，仍可按下面任务操作",
    });
    expect(todayPlanStatusCopy("idle")).toBe("");
    expect(todayPlanStatusCopy("loading-memory")).toBe("正在读取当前任务");
    expect(todayPlanStatusCopy("planning")).toBe("正在按最新记忆规划今天");
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
      events: [{ type: "run.completed", label: "今日规划已完成" }],
    });
    const final = await run;
    expect(final.phase).toBe("refreshed");
    expect(final.brief?.lead).toBe("今天先核对其风险项");
    expect(final.tasks?.map((row) => row.id)).toEqual(["tsk_due"]);
    expect(final.tasks?.some((row) => row.id === "tsk_plan")).toBe(false);
    expect(steps[0]).toMatchObject({ phase: "loading-memory" });
    expect(steps.map((step) => step.phase)).toEqual(expect.arrayContaining([
      "loading-memory",
      "planning",
      "refreshed",
    ]));
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
