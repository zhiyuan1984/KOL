import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, nowIso, resetConn } from "../src/db.js";
import { failInterruptedTaskRuns } from "../src/host/task-run-recovery.js";
import { markSessionRunning, publicQueue, resetRunControl } from "../src/host/run-control.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return { status: res.status, text, body: text ? (JSON.parse(text) as Json) : {} };
}

type TaskEventRow = { event_type: string; label: string; status: string; safe_summary: string | null };

async function createAndQueueTask() {
  const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "扫描风险" });
  expect(created.status, created.text).toBe(201);
  const taskId = String(created.body.id);
  const queued = await request("POST", `/api/tasks/${taskId}/run`, { text: "风险扫描" });
  expect(queued.status, queued.text).toBe(202);
  return {
    taskId,
    sessionId: String(queued.body.session_id),
    runId: String(queued.body.run_id),
    pending: queued.body.pending_message as Json,
  };
}

function workItemStatus(taskId: string): string {
  return String((getConn().prepare("SELECT status FROM tickets WHERE id=?").get(taskId) as { status: string }).status);
}

function runRow(runId: string): { status: string; error: string | null } {
  return getConn().prepare("SELECT status,error FROM task_runs WHERE id=?").get(runId) as { status: string; error: string | null };
}

function taskEvents(taskId: string): TaskEventRow[] {
  return getConn().prepare(
    "SELECT event_type,label,status,safe_summary FROM task_events WHERE work_item_id=? ORDER BY sequence",
  ).all(taskId) as TaskEventRow[];
}

function lastEvent(rows: TaskEventRow[]): TaskEventRow | undefined {
  return rows[rows.length - 1];
}

describe("task run lifecycle honesty", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-task-run-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    resetRunControl();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  afterEach(() => {
    resetRunControl();
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps a bound task queued (not running) while it waits behind another run", async () => {
    const { taskId, sessionId, runId, pending } = await createAndQueueTask();
    markSessionRunning(sessionId);
    const posted = await request("POST", `/api/sessions/${sessionId}/messages`, pending);
    expect(posted.status, posted.text).toBe(202);
    expect(posted.body.queued).toBe(true);
    expect(publicQueue(sessionId)).toHaveLength(1);
    expect(workItemStatus(taskId)).toBe("queued");
    expect(runRow(runId).status).toBe("queued");
    const rows = taskEvents(taskId);
    expect(rows.map((row) => row.event_type)).toContain("run.queued");
    expect(rows.map((row) => row.event_type)).not.toContain("run.started");
    const queuedEvent = rows.find((row) => row.event_type === "run.queued");
    expect(queuedEvent?.label).toBe("已排队");
    expect(String(queuedEvent?.safe_summary || "")).toContain("轮到时自动开始");
  });

  it("keeps the bound ticket awaiting action when its queued run is removed", async () => {
    const { taskId, sessionId, runId, pending } = await createAndQueueTask();
    markSessionRunning(sessionId);
    await request("POST", `/api/sessions/${sessionId}/messages`, pending);
    const qid = String(publicQueue(sessionId)[0]?.id || "");
    expect(qid).toBeTruthy();
    const removed = await request("DELETE", `/api/sessions/${sessionId}/queue/${qid}`);
    expect(removed.status, removed.text).toBe(200);
    expect(workItemStatus(taskId)).toBe("waiting");
    expect(runRow(runId).status).toBe("cancelled");
    const last = lastEvent(taskEvents(taskId));
    expect(last?.event_type).toBe("run.cancelled");
    expect(String(last?.safe_summary || "")).toContain("未执行");
  });

  it("fails a bound task when its ask is refused before any execution", async () => {
    const { taskId, sessionId, runId, pending } = await createAndQueueTask();
    // Remove risk_scan's seeded grant: the ask must be refused before execution.
    getConn().prepare("DELETE FROM skill_grants WHERE skill_id=?").run("risk_scan");
    const posted = await request("POST", `/api/sessions/${sessionId}/messages`, pending);
    expect(posted.status, posted.text).toBe(400);
    expect(workItemStatus(taskId)).toBe("failed");
    expect(runRow(runId).status).toBe("failed");
    const rows = taskEvents(taskId);
    expect(rows.map((row) => row.event_type)).not.toContain("run.started");
    const last = lastEvent(rows);
    expect(last?.event_type).toBe("run.failed");
    expect(last?.label).toBe("未能开始");
    expect(String(last?.safe_summary || "")).toContain("未授权");
  });

  it("boot reconciliation closes an abandoned running task run", async () => {
    const { taskId, runId } = await createAndQueueTask();
    // Simulate a worker that died with the previous process: the run row was
    // left running with no execution and no terminal event.
    getConn().prepare("UPDATE task_runs SET status='running',started_at=? WHERE id=?").run(nowIso(), runId);
    getConn().prepare("UPDATE tickets SET status='running' WHERE id=?").run(taskId);
    const touched = failInterruptedTaskRuns("Host 重启时该运行仍在执行");
    expect(touched).toContain(taskId);
    expect(workItemStatus(taskId)).toBe("failed");
    const run = runRow(runId);
    expect(run.status).toBe("failed");
    expect(String(run.error || "")).toContain("interrupted");
    const last = lastEvent(taskEvents(taskId));
    expect(last?.event_type).toBe("run.failed");
    expect(last?.label).toBe("执行被中断");
    expect(String(last?.safe_summary || "")).toContain("未产生结果");
    expect(failInterruptedTaskRuns("Host 重启时该运行仍在执行")).toEqual([]);
  });
});
