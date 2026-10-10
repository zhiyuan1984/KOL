import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_USER } from "../src/config.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { validateTodayBrief, writeTodayBriefArtifact } from "../src/host/today-brief.js";
import { loadTodayTaskResults, parseTodayTaskResults } from "../src/host/today-tasks.js";
import { persistIncrement } from "../src/host/employee-memory.js";
import { executeTodayPlanRun, missingDisplayCoverage, startTodayPlan, todayBriefSnapshot } from "../src/host/today-plan-run.js";
import { packTodayPlanContext } from "../src/host/today-plan-context.js";
import * as runner from "../src/worker/runner.js";
import { freshTestDatabase } from "./support/pg.js";

const emptyBrief = () => ({ lead: "当前没有开放正式任务", sections: [], display_tasks: [], stats: { unfinished: 0 }, primary: { verb: "open", label: "查看任务列表" } });

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
  it("still requires every actual task to be covered", () => {
    const pack = { history: { unfinished_tasks: [{ work_item_id: "actual_task" }] } } as unknown as Parameters<typeof missingDisplayCoverage>[1];
    expect(missingDisplayCoverage(emptyBrief(), pack)).toEqual(["actual_task"]);
    expect(missingDisplayCoverage(emptyBrief(), { history: { unfinished_tasks: [] } } as unknown as typeof pack)).toEqual([]);
  });
});

describe("empty planning PostgreSQL persistence", () => {
  let tmp: string;
  beforeEach(async () => {
    await freshTestDatabase();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-empty-plan-"));
    process.env.LINGONG_DATA = tmp;
    resetConn();
    seedAll();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetConn();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });
  it.each(["today", "todo"] as const)("persists authoritative empty %s results without resurrecting memory", (scope) => {
    const owner = DEMO_USER.id;
    const started = startTodayPlan(owner);
    persistIncrement({ owner, family: scope === "todo" ? "todo" : "task", layer: "display", incoming: [{ item_key: started.work_item_id, payload: { work_item_id: started.work_item_id, title: "旧展示" } }] });
    const written = writeTodayBriefArtifact({ owner, workItemId: started.work_item_id, runId: started.run_id, scope, brief: emptyBrief(), producer: "deterministic_organize" });
    expect(written.ok).toBe(true);
    expect(loadTodayTaskResults(owner, scope)?.items).toEqual([]);
    expect(loadTodayTaskResults(owner, scope)?.planned_at).toBeTruthy();
    expect(todayBriefSnapshot(owner, scope).brief).toMatchObject({ display_tasks: [], producer: "deterministic_organize" });
  });
  it("completes a zero-task deterministic run with no model call", async () => {
    const owner = DEMO_USER.id;
    const started = startTodayPlan(owner);
    const pack = packTodayPlanContext(owner);
    expect(pack.history.unfinished_tasks).toEqual([]);
    const run = vi.spyOn(runner, "runWorker");
    const result = await executeTodayPlanRun({ owner, workItemId: started.work_item_id, runId: started.run_id, sessionId: started.session_id, pack, producer: "deterministic_organize" });
    expect(result.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(getConn().prepare("SELECT status FROM task_runs WHERE id=?").get(started.run_id)).toMatchObject({ status: "completed" });
    expect(todayBriefSnapshot(owner).status).toBe("ready");
    expect(loadTodayTaskResults(owner)?.items).toEqual([]);
  });
  it("still completes deterministic runs that contain an actual formal task", async () => {
    const owner = DEMO_USER.id;
    const now = nowIso();
    getConn().prepare("INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("tsk_real_empty_regression", owner, "email_compose", "真实任务", "manual", "pending", "normal", "email_compose", "lead", "{}", "{}", 1, now, now);
    const started = startTodayPlan(owner);
    const result = await executeTodayPlanRun({ owner, workItemId: started.work_item_id, runId: started.run_id, sessionId: started.session_id, pack: packTodayPlanContext(owner), producer: "deterministic_organize" });
    expect(result.ok).toBe(true);
    expect(loadTodayTaskResults(owner)?.items.map((row) => row.work_item_id)).toEqual(["tsk_real_empty_regression"]);
  });
});
