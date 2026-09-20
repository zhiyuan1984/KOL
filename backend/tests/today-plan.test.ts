import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { HOME_ENTRY_REGISTRY as FRONTEND_HOME_ENTRY_REGISTRY } from "../../frontend/src/home/entryRegistry.ts";
import { collectSourceCatalog, packTodayPlanContext, planningHarnessMount } from "../src/host/today-plan-context.js";
import { validateTodayBrief, writeTodayBriefArtifact, runningTodayPlan, failStuckPlans } from "../src/host/today-brief.js";
import { TODAY_PLAN_EMPLOYEE_EVENTS, todayBriefSnapshot } from "../src/host/today-plan-run.js";
import type { WorkerResult } from "../src/types.js";
import { taskDefinition } from "../src/tasks/registry.js";
import * as recognize from "../src/tasks/recognize.js";
import * as runner from "../src/worker/runner.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

function owner() {
  return DEMO_USER.id;
}

function insertWorkItem(row: {
  id: string;
  title: string;
  task_type?: string;
  status?: string;
  source?: string;
  session_id?: string | null;
}) {
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO work_items
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
      collaboration_id,session_id,due_at,input,entities,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, owner(), row.task_type || "email_compose", row.title, row.source || "manual",
    row.status || "pending", "normal", row.task_type || "email_compose", "lead",
    null, null, row.session_id || null, null, "{}", "{}", 1, now, now,
  );
}

function insertDiscoveryBatch(row: {
  id: string;
  platform: string;
  runStatus: "failed" | "succeeded";
  candidates: number;
}) {
  const now = nowIso();
  const runId = `${row.id}_run`;
  getConn().prepare(
    `INSERT INTO discovery_requests
     (id,owner_user_id,keywords,platforms,mode,filters,brand,scope,status,latest_run_id,error,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, owner(), JSON.stringify([row.platform, "camping"]), JSON.stringify([row.platform]),
    "search", "{}", null, "{}", row.runStatus === "failed" ? "failed" : "succeeded",
    runId, row.runStatus === "failed" ? JSON.stringify({ message: "crawl fail" }) : null,
    1, now, now,
  );
  getConn().prepare(
    `INSERT INTO discovery_runs
     (id,request_id,owner_user_id,crawl_job_id,work_item_id,platform,mode,parameters,remote_task_id,idempotency_key,status,error,candidate_count,data_version,created_at,started_at,updated_at,completed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    runId, row.id, owner(), null, null, row.platform, "search", "{}", null, `idem_${row.id}`,
    row.runStatus, row.runStatus === "failed" ? JSON.stringify({ message: "crawl fail" }) : null,
    row.candidates, 1, now, now, now, now,
  );
}

function validBrief(overrides: Json = {}): Json {
  return {
    lead: "今天先核对其风险项",
    stats: { unfinished: 1, discovery_anomalies: 0, failed_runs: 0 },
    primary: { verb: "open", label: "打开未了结任务", object_id: "task:tsk_y", object_type: "task", person_id: null },
    sections: [{ title: "未了结", body: "昨日任务继续", items: ["跟进报价"] }],
    todo_layout: [{ work_item_id: "tsk_y", rank: 1, why: "昨日未完成" }],
    analysis_hints: [],
    source_cursor: { cursor_from: null, cursor_to: "src:task:tsk_y", added: ["task:tsk_y"], removed: [], unchanged: [] },
    increment_summary: "首次规划",
    ...overrides,
  };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-today-plan-"));
  process.env.LINGONG_DB = path.join(tmp, "today.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("today_plan harness", () => {
  it("registers today_plan / today_analyze as read-only callable skills", () => {
    for (const id of ["today_plan", "today_analyze"] as const) {
      const definition = taskDefinition(id);
      expect(definition?.id).toBe(id);
      expect(definition?.side_effects).toBe("none");
      expect(definition?.creates_session).toBe(true);
      expect(definition?.auto_ok).toBe(false);
      expect(definition?.required_inputs).toEqual([]);
    }
    expect(taskDefinition("today_plan")?.output).toBe("today_brief");
  });

  it("GET brief creates no session and does not call run", async () => {
    const run = vi.spyOn(runner, "runWorker");
    const beforeSessions = Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n);
    const beforeItems = Number((getConn().prepare("SELECT COUNT(*) AS n FROM work_items WHERE task_type='today_plan'").get() as { n: number }).n);
    const res = await request("GET", "/api/home/today-brief");
    expect(res.status).toBe(200);
    expect(res.body.planning).toBe(false);
    expect(res.body.brief).toBeNull();
    expect(res.body.creates_session).toBe(false);
    expect(res.body.calls_model).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n)).toBe(beforeSessions);
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM work_items WHERE task_type='today_plan'").get() as { n: number }).n)).toBe(beforeItems);
  });

  it("POST plan creates today_plan work_item+session and skips from-text recognition", async () => {
    const recognizeSpy = vi.spyOn(recognize, "recognizeTaskIntent");
    const res = await request("POST", "/api/home/today-brief/plan");
    expect([200, 202]).toContain(res.status);
    expect(res.body.task_type ?? "today_plan").toBeDefined();
    expect(res.body.work_item_id).toBeTruthy();
    expect(res.body.session_id).toBeTruthy();
    expect(res.body.run_id).toBeTruthy();
    const item = getConn().prepare("SELECT * FROM work_items WHERE id=?").get(res.body.work_item_id) as {
      task_type: string;
      source: string;
      session_id: string;
    };
    expect(item.task_type).toBe("today_plan");
    expect(item.source).toBe("planning");
    expect(item.session_id).toBe(res.body.session_id);
    const session = getConn().prepare("SELECT * FROM sessions WHERE id=?").get(res.body.session_id) as {
      expert_id: string;
      kind: string;
    };
    expect(session.expert_id).toBe("expert:kol");
    expect(session.kind).toBe("today_plan");
    expect(recognizeSpy).not.toHaveBeenCalled();
    const fromText = await request("POST", "/api/tasks/from-text", { text: "规划今天" });
    expect(fromText.status === 201 || fromText.body.needs_clarification).toBeTruthy();
  });

  it("second POST plan while today_plan is running returns the same session", async () => {
    const now = nowIso();
    getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run("ses_running_plan", "今日规划", now, now, "today_plan", 0, owner(), "expert:kol");
    insertWorkItem({
      id: "tsk_running_plan",
      title: "今日规划",
      task_type: "today_plan",
      status: "running",
      source: "planning",
      session_id: "ses_running_plan",
    });
    getConn().prepare(
      "INSERT INTO task_runs (id,work_item_id,session_id,status,input,entities,created_at,started_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run("run_running_plan", "tsk_running_plan", "ses_running_plan", "running", "{}", "{}", now, now);
    const first = await request("POST", "/api/home/today-brief/plan");
    const second = await request("POST", "/api/home/today-brief/plan");
    expect(first.body.session_id).toBe("ses_running_plan");
    expect(second.body.session_id).toBe("ses_running_plan");
    expect(first.body.work_item_id).toBe("tsk_running_plan");
    expect(second.body.work_item_id).toBe(first.body.work_item_id);
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM work_items WHERE task_type='today_plan'").get() as { n: number }).n)).toBe(1);
  });

  it("rejects missing sections or batch follow and keeps the old brief", () => {
    insertWorkItem({ id: "tsk_y", title: "昨日未完成报价" });
    const first = writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_y",
      runId: null,
      brief: validBrief(),
    });
    expect(first.ok).toBe(true);
    const missing = validateTodayBrief({ primary: { verb: "open" } });
    expect(missing.ok).toBe(false);
    expect(String(missing.reason)).toMatch(/sections/);
    const keptMissing = writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_y",
      runId: null,
      brief: { lead: "x", primary: { verb: "open" } },
    });
    expect(keptMissing.ok).toBe(false);
    const follow = validateTodayBrief(validBrief({
      primary: { verb: "follow", label: "加入跟进", object_id: "discovery:b1", object_type: "batch", person_id: null },
    }));
    expect(follow.ok).toBe(false);
    expect(String(follow.reason)).toMatch(/follow/);
    const keptFollow = writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_y",
      runId: null,
      brief: validBrief({
        primary: { verb: "follow", label: "加入跟进", object_id: "discovery:b1", object_type: "batch", person_id: null },
      }),
    });
    expect(keptFollow.ok).toBe(false);
    if (keptFollow.ok === false) expect(keptFollow.kept_artifact_id).toBe(first.ok ? first.artifact_id : null);
    const pointer = getConn().prepare("SELECT artifact_id FROM employee_today_briefs WHERE owner_user_id=?").get(owner()) as { artifact_id: string };
    expect(first.ok && pointer.artifact_id).toBe(first.ok ? first.artifact_id : pointer.artifact_id);
  });

  it("packs IG fail + YT empty batches and allows retry_crawl but not follow", () => {
    insertDiscoveryBatch({ id: "disc_ig_1", platform: "instagram", runStatus: "failed", candidates: 0 });
    insertDiscoveryBatch({ id: "disc_ig_2", platform: "instagram", runStatus: "failed", candidates: 0 });
    insertDiscoveryBatch({ id: "disc_yt_1", platform: "youtube", runStatus: "succeeded", candidates: 0 });
    insertDiscoveryBatch({ id: "disc_yt_2", platform: "youtube", runStatus: "succeeded", candidates: 0 });
    const pack = packTodayPlanContext(owner());
    const batchIds = pack.catalog.filter((item) => item.kind === "discovery_batch").map((item) => item.id);
    expect(batchIds).toEqual(expect.arrayContaining([
      "discovery:disc_ig_1",
      "discovery:disc_ig_2",
      "discovery:disc_yt_1",
      "discovery:disc_yt_2",
    ]));
    expect(pack.delta.added.map((item) => item.id)).toEqual(expect.arrayContaining(batchIds));
    expect(pack.catalog.every((item) => item.kind !== "discovery_batch" || item.person_id == null)).toBe(true);
    expect(validateTodayBrief(validBrief({
      primary: { verb: "follow", label: "跟进批次", object_id: "discovery:disc_ig_1", object_type: "batch", person_id: null },
    })).ok).toBe(false);
    expect(validateTodayBrief(validBrief({
      primary: { verb: "retry_crawl", label: "重试采集", object_id: "discovery:disc_ig_1", object_type: "batch", person_id: null },
    })).ok).toBe(true);
  });

  it("keeps yesterday unfinished tasks in history when delta is empty", () => {
    insertWorkItem({ id: "tsk_yesterday", title: "昨日未完成报价" });
    const first = packTodayPlanContext(owner());
    expect(first.history.unfinished_tasks.some((item) => item.work_item_id === "tsk_yesterday")).toBe(true);
    writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_yesterday",
      runId: null,
      brief: validBrief({
        source_cursor: first.source_cursor,
        todo_layout: [{ work_item_id: "tsk_yesterday", rank: 1, why: "昨日未完成" }],
      }),
    });
    const second = packTodayPlanContext(owner());
    expect(second.delta.added).toEqual([]);
    expect(second.history.unfinished_tasks.some((item) => item.work_item_id === "tsk_yesterday")).toBe(true);
    expect(second.now_counts.unfinished).toBeGreaterThan(0);
  });

  it("planning harness mount excludes send/follow tools and skills", async () => {
    const mount = planningHarnessMount("today_plan");
    expect(mount.tools.join(",")).not.toMatch(/follow|send|confirm-stage|confirm_stage/i);
    expect(mount.skills).toEqual(["today_plan"]);
    expect(mount.forbidden).toEqual(expect.arrayContaining(["follow", "send", "confirm-stage"]));
    const res = await request("POST", "/api/home/today-brief/plan");
    const item = getConn().prepare("SELECT input FROM work_items WHERE id=?").get(res.body.work_item_id) as { input: string };
    const input = JSON.parse(item.input) as Json;
    expect(input.mode).toBe("today_plan");
    expect(input.expert_id).toBe("expert:kol");
    expect(input.skip_user_memory).toBe(true);
    const harness = input.planning_harness as { tools?: unknown[]; skills?: unknown[] };
    expect(JSON.stringify(harness.tools || [])).not.toMatch(/follow|send|confirm-stage|confirm_stage/i);
    expect(JSON.stringify(harness.skills || [])).not.toMatch(/follow|send|confirm-stage|confirm_stage/i);
    expect(taskDefinition("today_plan")?.mcp || []).toEqual([]);
  });

  it("keeps switch-tab as memory with creates_session=false", async () => {
    const switchTab = HOME_ENTRY_REGISTRY.find((row) => row.id === "switch-tab");
    expect(switchTab).toMatchObject({
      kind: "memory",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
    });
    const entries = await request("GET", "/api/home/entries");
    expect(entries.body.registry).toEqual(expect.arrayContaining([
      "switch-tab",
      "get-today-brief",
      "plan-today",
      "enqueue-today-analyze",
      "retry-discovery-run",
    ]));
    const getBrief = HOME_ENTRY_REGISTRY.find((row) => row.id === "get-today-brief");
    expect(getBrief).toMatchObject({ kind: "memory", creates_session: false, calls_model: false });
    const plan = HOME_ENTRY_REGISTRY.find((row) => row.id === "plan-today");
    expect(plan).toMatchObject({ kind: "think", creates_session: true, route: "POST /api/home/today-brief/plan" });
    const retries = HOME_ENTRY_REGISTRY.filter((row) => row.id === "retry-discovery-run");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.kind).toBe("command");
    expect(retries[0]?.creates_session).toBe(false);
    expect(retries[0]?.calls_model).toBe(false);
    expect(retries[0]?.route).toBe("POST /api/discovery/requests/:id/runs");
    const frontendRetries = FRONTEND_HOME_ENTRY_REGISTRY.filter((row) => row.id === "retry-discovery-run");
    expect(frontendRetries).toHaveLength(1);
    expect(frontendRetries[0]?.kind).toBe("command");
    expect(frontendRetries[0]?.creates_session).toBe(false);
    expect(frontendRetries[0]?.calls_model).toBe(false);
    expect(frontendRetries[0]?.route).toBe("POST /api/discovery/requests/:id/runs");
    const enqueue = HOME_ENTRY_REGISTRY.find((row) => row.id === "enqueue-today-analyze");
    expect(enqueue).toMatchObject({
      kind: "think",
      creates_session: true,
      calls_model: true,
      route: "POST /api/home/today-brief/enqueue",
    });
    const frontendEnqueue = FRONTEND_HOME_ENTRY_REGISTRY.find((row) => row.id === "enqueue-today-analyze");
    expect(frontendEnqueue).toMatchObject({
      kind: "think",
      creates_session: true,
      calls_model: true,
      route: "POST /api/home/today-brief/enqueue",
    });
    const analyze = HOME_ENTRY_REGISTRY.find((row) => row.id === "kol-analyze-enqueue");
    expect(analyze).toMatchObject({
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: "POST /api/home/kol-analyze/enqueue",
    });
    const frontendAnalyze = FRONTEND_HOME_ENTRY_REGISTRY.find((row) => row.id === "kol-analyze-enqueue");
    expect(frontendAnalyze).toMatchObject({
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: "POST /api/home/kol-analyze/enqueue",
    });
    for (const row of [...HOME_ENTRY_REGISTRY, ...FRONTEND_HOME_ENTRY_REGISTRY]) {
      if (row.kind === "think") {
        expect(row.creates_session || row.calls_model, `${row.id} think must create a session or call a model`).toBe(true);
      }
      if (row.kind === "command" || row.kind === "memory") {
        expect(row.creates_session, `${row.id} ${row.kind} must not create a session`).toBe(false);
        expect(row.calls_model, `${row.id} ${row.kind} must not call a model`).toBe(false);
      }
    }
  });

  it("POST today-brief/enqueue creates a session and calls the model", async () => {
    const run = vi.spyOn(runner, "runWorker");
    const beforeSessions = Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n);
    const res = await request("POST", "/api/home/today-brief/enqueue", { objects: [] });
    expect(res.status).toBe(202);
    expect(res.body.kind).toBe("think");
    expect(res.body.creates_session).toBe(true);
    expect(res.body.calls_model).toBe(true);
    expect(res.body.task_type).toBe("today_analyze");
    expect(res.body.session_id).toBeTruthy();
    expect(run).toHaveBeenCalled();
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n)).toBe(beforeSessions + 1);
  });

  it("emits employee-facing mid events while planning and on complete", async () => {
    insertWorkItem({ id: "tsk_open_quote", title: "未了结报价" });
    let release!: (value: WorkerResult) => void;
    const held = new Promise<WorkerResult>((resolve) => {
      release = resolve;
    });
    vi.spyOn(runner, "runWorker").mockReturnValue(held);
    const plan = await request("POST", "/api/home/today-brief/plan");
    expect([200, 202]).toContain(plan.status);
    const mid = await request("GET", "/api/home/today-brief");
    expect(mid.body.planning).toBe(true);
    const midLabels = ((mid.body.events as Json[]) || []).map((event) => String(event.title || event.label || ""));
    expect(midLabels).toEqual(expect.arrayContaining([
      TODAY_PLAN_EMPLOYEE_EVENTS.memoryRead,
      TODAY_PLAN_EMPLOYEE_EVENTS.deltaPacked,
      TODAY_PLAN_EMPLOYEE_EVENTS.codexSubmitted,
    ]));
    expect(midLabels).not.toContain(TODAY_PLAN_EMPLOYEE_EVENTS.completed);
    const memoryEvent = ((mid.body.events as Json[]) || []).find((event) => (
      String(event.title || event.label) === TODAY_PLAN_EMPLOYEE_EVENTS.memoryRead
    ));
    expect(String(memoryEvent?.summary || "")).toMatch(/未了结 \d+ 项/);
    const unfinishedIds = collectSourceCatalog(owner())
      .filter((item) => item.kind === "formal_task" && item.work_item_id)
      .map((item) => String(item.work_item_id));
    release({
      worker_id: "stub",
      status: "completed",
      skill: "today_plan",
      contract_log: [],
      items: [validBrief({
        type: "today_brief",
        todo_layout: unfinishedIds.map((id, index) => ({ work_item_id: id, rank: index + 1, why: "未了结" })),
      })],
    });
    await vi.waitFor(async () => {
      const done = await request("GET", "/api/home/today-brief");
      expect(done.body.planning).toBe(false);
      const labels = ((done.body.events as Json[]) || []).map((event) => String(event.title || event.label || ""));
      expect(labels).toEqual(expect.arrayContaining([
        TODAY_PLAN_EMPLOYEE_EVENTS.memoryRead,
        TODAY_PLAN_EMPLOYEE_EVENTS.deltaPacked,
        TODAY_PLAN_EMPLOYEE_EVENTS.codexSubmitted,
        TODAY_PLAN_EMPLOYEE_EVENTS.writingBrief,
        TODAY_PLAN_EMPLOYEE_EVENTS.completed,
      ]));
    });
  });

  it("does not list planning work items as open todos", async () => {
    insertWorkItem({ id: "tsk_open_quote", title: "未了结报价" });
    const plan = await request("POST", "/api/home/today-brief/plan");
    const listed = await request("GET", "/api/tasks?view=open");
    const ids = ((listed.body.tasks as Json[]) || []).map((row) => String(row.id));
    expect(ids).toContain("tsk_open_quote");
    expect(ids).not.toContain(String(plan.body.work_item_id));
  });
});

describe("stale planning watchdog", () => {
  function insertPlanRun(id: string, status: string, at: string, taskType = "today_plan") {
    const now = nowIso();
    getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(`ses_${id}`, "规划", now, now, taskType, 0, owner(), "expert:kol");
    insertWorkItem({
      id: `tsk_${id}`,
      title: "规划",
      task_type: taskType,
      status,
      source: "planning",
      session_id: `ses_${id}`,
    });
    getConn().prepare(
      "INSERT INTO task_runs (id,work_item_id,session_id,status,input,entities,created_at,started_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(`run_${id}`, `tsk_${id}`, `ses_${id}`, status, "{}", "{}", at, at);
    getConn().prepare("UPDATE work_items SET created_at=?, updated_at=? WHERE id=?").run(at, at, `tsk_${id}`);
  }

  const statusOf = (table: "work_items" | "task_runs", id: string) =>
    String((getConn().prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as { status: string }).status);

  it("fails a planning run past the watchdog instead of capturing every later entry", () => {
    const stale = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
    insertPlanRun("stuck", "running", stale);

    // The dead run must not be returned: returning it is what left the card
    // polling a plan that could never finish.
    expect(runningTodayPlan(owner(), "today")).toBeNull();
    expect(statusOf("work_items", "tsk_stuck")).toBe("failed");
    expect(statusOf("task_runs", "run_stuck")).toBe("failed");
    // Failing it first is what frees `one_running_today_plan`, so a new plan can
    // actually be created afterwards.
    insertWorkItem({
      id: "tsk_after_stuck",
      title: "今日规划",
      task_type: "today_plan",
      status: "running",
      source: "planning",
    });
    expect(runningTodayPlan(owner(), "today")?.work_item_id).toBe("tsk_after_stuck");
  });

  it("still attaches to a plan that is genuinely running", () => {
    insertPlanRun("live", "running", nowIso());
    expect(runningTodayPlan(owner(), "today")?.work_item_id).toBe("tsk_live");
    expect(statusOf("work_items", "tsk_live")).toBe("running");
  });

  it("boot reconcile fails open planning rows only", () => {
    insertPlanRun("boot_open", "running", nowIso());
    insertPlanRun("boot_pending", "pending", nowIso(), "todo_plan");
    insertPlanRun("boot_done", "completed", nowIso());
    insertWorkItem({ id: "tsk_boot_other", title: "普通任务", task_type: "email_compose", status: "running" });

    const failed = failStuckPlans("Host 重启时该规划仍在运行");
    expect(failed).toContain("tsk_boot_open");
    expect(failed).toContain("tsk_boot_pending");
    expect(failed).not.toContain("tsk_boot_done");
    expect(failed).not.toContain("tsk_boot_other");
    expect(statusOf("work_items", "tsk_boot_done")).toBe("completed");
    expect(statusOf("work_items", "tsk_boot_other")).toBe("running");
    // A reconciled plan no longer blocks a fresh one.
    expect(runningTodayPlan(owner(), "today")).toBeNull();
    expect(runningTodayPlan(owner(), "todo")).toBeNull();
  });
});

describe("previous plan snapshot", () => {
  it("reports the version before the current one, never the current run twice", () => {
    insertWorkItem({ id: "tsk_prev", title: "上一版规划", task_type: "today_plan", status: "completed" });
    expect(writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_prev",
      runId: null,
      brief: validBrief({ lead: "上一版先把报价邮件发出去" }),
    }).ok).toBe(true);

    insertWorkItem({ id: "tsk_now", title: "本轮规划", task_type: "today_plan", status: "completed" });
    expect(writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_now",
      runId: null,
      brief: validBrief({ lead: "本轮先恢复采集" }),
    }).ok).toBe(true);

    const snapshot = todayBriefSnapshot(owner(), "today");
    expect((snapshot.brief as Json)?.lead).toBe("本轮先恢复采集");
    expect((snapshot.previous_brief as Json)?.lead).toBe("上一版先把报价邮件发出去");
    expect(snapshot.previous_work_item_id).toBe("tsk_prev");
    expect(Array.isArray(snapshot.previous_events)).toBe(true);

    // A second artifact of the same run must not read as a previous version.
    expect(writeTodayBriefArtifact({
      owner: owner(),
      workItemId: "tsk_now",
      runId: null,
      brief: validBrief({ lead: "本轮改稿" }),
    }).ok).toBe(true);
    const again = todayBriefSnapshot(owner(), "today");
    expect((again.previous_brief as Json)?.lead).toBe("上一版先把报价邮件发出去");
    expect(again.previous_work_item_id).toBe("tsk_prev");
  });
});
