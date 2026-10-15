import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER } from "../src/config.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import { validateTodayBrief } from "../src/host/today-brief.js";
import { persistIncrement } from "../src/host/employee-memory.js";
import { todayBriefSnapshot } from "../src/host/today-plan-run.js";
import { packTodayPlanContext, planningRunInput, type PlanScope } from "../src/host/today-plan-context.js";
import { loadTodayTaskResults, parseTodayTaskResults } from "../src/host/today-tasks.js";
import { startNativeTodayPlan } from "../src/postgres/today-plan-repository.js";
import type { Json, WorkerResult } from "../src/types.js";
import * as runner from "../src/worker/runner.js";
import { seedAll } from "../src/seed.js";
import { freshTestDatabase } from "./support/pg.js";

const emptyBrief = () => ({ lead: "当前没有开放正式任务", sections: [], display_tasks: [], stats: { unfinished: 0 }, primary: { verb: "open", label: "查看任务列表" } });

function workerResult(brief: Json): WorkerResult {
  return { worker_id: "stub", status: "completed", skill: "today_plan", contract_log: [], items: [{ type: "today_brief", ...brief }] };
}

async function startNativePlan(owner: string, scope: PlanScope) {
  const pack = await packTodayPlanContext(owner, scope);
  return startNativeTodayPlan({
    owner,
    taskType: "today_plan",
    title: scope === "todo" ? "统一待办计划" : "统一工作计划",
    scope,
    producer: "agent_plan",
    payload: await planningRunInput(pack, {}, scope),
    extraPayload: { producer: "agent_plan" },
    queuedLabel: "工作计划已入队",
  });
}

async function executePersistedPlan(executionJobId: string, workerId: string) {
  const dispatched = await processExecutionJobById(executionJobId, workerId);
  expect(dispatched).toMatchObject({ execution_job_id: executionJobId, handled: true, outcome: "processed" });
  return dispatched!;
}

describe("empty planning contract", () => {
  it("accepts an explicit empty display array", () => {
    expect(validateTodayBrief(emptyBrief()).ok).toBe(true);
    expect(parseTodayTaskResults(emptyBrief())).toEqual({ items: [], planned_at: undefined });
  });
  it("accepts legacy empty task arrays", () => {
    expect(parseTodayTaskResults({ todo_layout: [] })?.items).toEqual([]);
    expect(parseTodayTaskResults({ items: [] })?.items).toEqual([]);
  });
  it("rejects missing and malformed arrays without blaming a producer", () => {
    for (const value of [{ lead: "x" }, { lead: "x", display_tasks: "bad" }, { lead: "x", display_tasks: [{}] }]) {
      const result = validateTodayBrief(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).not.toMatch(/Codex/);
      expect(parseTodayTaskResults(value)).toBeNull();
    }
  });
});

describe("empty planning PostgreSQL persistence", () => {
  let tmp: string;
  beforeEach(async () => {
    await freshTestDatabase();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-empty-plan-"));
    process.env.LINGONG_DATA = tmp;
    await resetConn();
    await seedAll();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetConn();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });
  it.each(["today", "todo"] as const)("persists an authoritative empty %s worker result without resurrecting memory", async (scope) => {
    const owner = DEMO_USER.id;
    const started = await startNativePlan(owner, scope);
    await persistIncrement({ owner, family: scope === "todo" ? "todo" : "task", layer: "display", incoming: [{ item_key: started.work_item_id, payload: { work_item_id: started.work_item_id, title: "旧展示" } }] });
    const run = vi.spyOn(runner, "runWorker").mockResolvedValue(workerResult(emptyBrief()));

    await executePersistedPlan(started.execution_job_id, `empty-${scope}-worker`);

    expect(run).toHaveBeenCalledTimes(1);
    expect((await loadTodayTaskResults(owner, scope))?.items).toEqual([]);
    expect((await loadTodayTaskResults(owner, scope))?.planned_at).toBeTruthy();
    expect((await todayBriefSnapshot(owner, scope)).brief).toMatchObject({ display_tasks: [], producer: "agent_plan" });
  });
  it("persists an explicit empty worker result through exactly one durable execution job", async () => {
    const owner = DEMO_USER.id;
    const started = await startNativePlan(owner, "today");
    const pack = await packTodayPlanContext(owner);
    expect(pack.history.unfinished_tasks).toEqual([]);
    const run = vi.spyOn(runner, "runWorker").mockResolvedValue(workerResult(emptyBrief()));

    await executePersistedPlan(started.execution_job_id, "empty-worker");

    expect(run).toHaveBeenCalledTimes(1);
    expect((await getConn().query("SELECT status FROM task_runs WHERE id=$1", [started.run_id])).rows[0]).toMatchObject({ status: "completed" });
    expect((await todayBriefSnapshot(owner)).status).toBe("ready");
    expect((await loadTodayTaskResults(owner))?.items).toEqual([]);
  });
  it("requires the real worker result to cover an actual formal task", async () => {
    const owner = DEMO_USER.id;
    const now = nowIso();
    await getConn().query("INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", ["tsk_real_empty_regression", owner, "email_compose", "真实任务", "manual", "pending", "normal", "email_compose", "lead", "{}", "{}", 1, now, now]);
    const started = await startNativePlan(owner, "today");
    const run = vi.spyOn(runner, "runWorker").mockResolvedValue(workerResult({
      ...emptyBrief(),
      display_tasks: [{ work_item_id: "tsk_real_empty_regression", rank: 1, why: "真实未完成任务" }],
    }));

    await executePersistedPlan(started.execution_job_id, "formal-task-worker");

    expect(run).toHaveBeenCalledTimes(1);
    expect((await loadTodayTaskResults(owner))?.items.map((row) => row.work_item_id)).toEqual(["tsk_real_empty_regression"]);
  });
});
