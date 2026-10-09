import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { buildTaskOperationsDashboard, operationalRowInRange, statusGroup, taskOperationsDashboardRanges, taskOperationsDateRange, taskOperationsPeriod } from "../src/tasks/operations-dashboard.js";
import { seedAll } from "../src/seed.js";
import { freshTestDatabase } from "./support/pg.js";

const now = new Date("2026-10-07T04:00:00.000Z"); // 2026-10-07 12:00 in Asia/Shanghai
const rows = [
  { id: "done", task_type: "creator_discovery", title: "已完成", status: "completed", due_at: null, created_at: "2026-10-06T18:00:00.000Z", completed_at: "2026-10-06T19:00:00.000Z", updated_at: "2026-10-06T19:00:00.000Z" },
  { id: "running", task_type: "creator_discovery", title: "执行中", status: "running", due_at: "2026-10-07T01:00:00.000Z", created_at: "2026-10-06T20:00:00.000Z", completed_at: null, updated_at: "2026-10-07T03:00:00.000Z" },
  { id: "waiting", task_type: "today_brief", title: "等待处理", status: "waiting", due_at: null, created_at: "2026-10-06T21:00:00.000Z", completed_at: null, updated_at: "2026-10-07T02:00:00.000Z" },
  { id: "failed", task_type: "today_brief", title: "失败", status: "failed", due_at: null, created_at: "2026-10-06T22:00:00.000Z", completed_at: null, updated_at: "2026-10-07T02:30:00.000Z" },
  { id: "previous", task_type: "creator_discovery", title: "前一日", status: "completed", due_at: null, created_at: "2026-10-05T18:00:00.000Z", completed_at: "2026-10-05T20:00:00.000Z", updated_at: "2026-10-05T20:00:00.000Z" },
];

describe("task operations dashboard", () => {
  it("uses the selected Shanghai day for both created and completed task activity", () => {
    const dashboard = buildTaskOperationsDashboard(rows, { period: "today", now, timezone: "Asia/Shanghai" });
    expect(dashboard.metrics).toMatchObject({ total: 4, in_progress: 2, waiting: 1, overdue: 1, failed: 1, completion_rate: 25, overdue_rate: 25, median_processing_hours: 1 });
    expect(dashboard.status_distribution).toEqual({ queued: 0, running: 1, waiting: 1, completed: 1, failed: 1, cancelled: 0 });
    expect(dashboard.comparison?.previous.total).toBe(1);
    expect(dashboard.comparison?.deltas.total).toBe(300);
    expect(dashboard.task_types[0]).toMatchObject({ task_type: "creator_discovery", total: 2, in_progress: 1, completed: 1 });
  });

  it("returns Shanghai-aligned boundaries and rejects an unsupported period", () => {
    const ranges = taskOperationsDashboardRanges("today", now, "Asia/Shanghai");
    expect(ranges.current?.start.toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(ranges.current?.end.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(() => taskOperationsPeriod("quarter")).toThrow(/invalid_operations_period/);
  });

  it("uses an inclusive Shanghai YYYY-MM-DD window for either created or completed activity", () => {
    const range = taskOperationsDateRange("2026-10-07", "2026-10-07", "Asia/Shanghai");
    expect(range?.start?.toISOString()).toBe("2026-10-06T16:00:00.000Z");
    expect(range?.end?.toISOString()).toBe("2026-10-07T16:00:00.000Z");
    expect(operationalRowInRange({ ...rows[0]!, created_at: "2026-09-01T00:00:00.000Z", completed_at: "2026-10-07T15:59:59.999Z" }, range)).toBe(true);
    expect(operationalRowInRange({ ...rows[0]!, created_at: "2026-09-01T00:00:00.000Z", completed_at: "2026-10-07T16:00:00.000Z" }, range)).toBe(false);
    expect(statusGroup("needs_review")).toBe("waiting");
    expect(statusGroup("waiting_external")).toBe("waiting");
    expect(() => taskOperationsDateRange("2026-02-30", undefined)).toThrow(/invalid from date/);
  });

  it("retains zero-valued task metrics instead of inventing a nonempty result", () => {
    expect(buildTaskOperationsDashboard([], { period: "realtime", now, timezone: "Asia/Shanghai" }).metrics)
      .toMatchObject({ total: 0, in_progress: 0, overdue: 0, waiting: 0, cancelled: 0, failed: 0, completion_rate: null, overdue_rate: null, median_processing_hours: null });
  });
});

type Json = Record<string, unknown>;
let tmp: string;
let app: Hono;
const hasPostgresTestDatabase = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

async function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

async function createOperationalTask(input: {
  title: string;
  task_type?: "risk_scan" | "creator_discovery";
  status: string;
  created_at: string;
  completed_at?: string | null;
  due_at?: string | null;
}): Promise<string> {
  const created = await request("POST", "/api/tasks", {
    task_type: input.task_type || "risk_scan",
    title: input.title,
  });
  expect(created.status).toBe(201);
  const id = String(created.body.id);
  getConn().prepare(
    "UPDATE tickets SET status=?,created_at=?,completed_at=?,due_at=?,updated_at=? WHERE id=?",
  ).run(input.status, input.created_at, input.completed_at || null, input.due_at || null, input.created_at, id);
  return id;
}

describe.skipIf(!hasPostgresTestDatabase)("GET task operations query contract", () => {
  beforeEach(async () => {
    await freshTestDatabase();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-task-operations-"));
    process.env.LINGONG_DB = path.join(tmp, "tasks.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
  });

  afterEach(() => {
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps paged rows and dashboard totals aligned on an inclusive Shanghai activity day and task type", async () => {
    const createdInWindow = await createOperationalTask({
      title: "operations-window-created", status: "queued", created_at: "2026-10-06T16:00:00.000Z",
    });
    const completedInWindow = await createOperationalTask({
      title: "operations-window-completed", status: "completed", created_at: "2026-09-01T00:00:00.000Z", completed_at: "2026-10-07T15:59:59.999Z",
    });
    await createOperationalTask({
      title: "operations-window-after", status: "completed", created_at: "2026-09-01T00:00:00.000Z", completed_at: "2026-10-07T16:00:00.000Z",
    });
    await createOperationalTask({
      title: "operations-window-other-type", task_type: "creator_discovery", status: "queued", created_at: "2026-10-06T16:00:00.000Z",
    });

    const page = await request("GET", "/api/tasks?view=history&limit=10&from=2026-10-07&to=2026-10-07&task_type=risk_scan");
    expect(page.status).toBe(200);
    expect(page.body.page).toMatchObject({ limit: 10, total: 2 });
    expect(new Set((page.body.items as Json[]).map((item) => String(item.id)))).toEqual(new Set([createdInWindow, completedInWindow]));

    const dashboard = await request("GET", "/api/tasks/operations-dashboard?period=realtime&from=2026-10-07&to=2026-10-07&task_type=risk_scan");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.metrics).toMatchObject({ total: 2, in_progress: 0, failed: 0 });
    expect(dashboard.body.status_distribution).toMatchObject({ queued: 1, completed: 1 });

    expect((await request("GET", "/api/tasks?view=history&limit=10&from=2026-10-08")).status).toBe(200);
    expect((await request("GET", "/api/tasks?view=history&limit=10&from=2026-02-30")).status).toBe(400);
    expect((await request("GET", "/api/tasks/operations-dashboard?period=week&from=2026-10-07")).status).toBe(400);
  });

  it("filters lifecycle status groups and overdue rows server-side while preserving zero totals", async () => {
    const prefix = "operations-filter-contract";
    const queued = await createOperationalTask({ title: `${prefix} queued`, status: "queued", created_at: "2026-10-01T00:00:00.000Z" });
    const runningOverdue = await createOperationalTask({ title: `${prefix} running`, status: "running", created_at: "2026-10-01T00:00:00.000Z", due_at: "2000-01-01T00:00:00.000Z" });
    const waiting = await createOperationalTask({ title: `${prefix} waiting`, status: "needs_clarification", created_at: "2026-10-01T00:00:00.000Z" });
    await createOperationalTask({ title: `${prefix} completed`, status: "completed", created_at: "2026-10-01T00:00:00.000Z", due_at: "2000-01-01T00:00:00.000Z" });
    const otherType = await createOperationalTask({ title: `${prefix} other type`, task_type: "creator_discovery", status: "queued", created_at: "2026-10-01T00:00:00.000Z" });

    const waitingPage = await request("GET", `/api/tasks?view=history&limit=20&q=${prefix}&status=waiting`);
    expect(waitingPage.status).toBe(200);
    expect(waitingPage.body.page).toMatchObject({ total: 1 });
    expect((waitingPage.body.items as Json[]).map((item) => item.id)).toEqual([waiting]);

    const overduePage = await request("GET", `/api/tasks?view=history&limit=20&q=${prefix}&status=running&overdue=true`);
    expect(overduePage.status).toBe(200);
    expect(overduePage.body.page).toMatchObject({ total: 1 });
    expect((overduePage.body.items as Json[]).map((item) => item.id)).toEqual([runningOverdue]);

    const queuedPage = await request("GET", `/api/tasks?view=history&limit=20&q=${prefix}&status=queued`);
    expect(queuedPage.body.page).toMatchObject({ total: 2 });
    expect(new Set((queuedPage.body.items as Json[]).map((item) => String(item.id)))).toEqual(new Set([queued, otherType]));

    const taskTypePage = await request("GET", `/api/tasks?view=history&limit=20&q=${prefix}&task_type=creator_discovery`);
    expect(taskTypePage.body.page).toMatchObject({ total: 1 });
    expect((taskTypePage.body.items as Json[]).map((item) => item.id)).toEqual([otherType]);

    const empty = await request("GET", "/api/tasks?view=history&limit=20&task_type=not-a-real-task-type");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ items: [], page: { total: 0 } });
    expect((await request("GET", "/api/tasks?view=history&limit=20&overdue=maybe")).status).toBe(400);
  });

  it("retains the existing personal authorization boundary for pages and dashboard aggregates", async () => {
    const stamp = "2026-10-07T00:00:00.000Z";
    getConn().prepare(
      `INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("tsk_operations_foreign", "usr_foreign", "risk_scan", "operations-foreign-private", "manual", "queued", "normal", "risk_scan", "general", "{}", "{}", stamp, stamp);

    const page = await request("GET", "/api/tasks?view=history&limit=10&q=operations-foreign-private");
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ items: [], page: { total: 0 } });

    const dashboard = await request("GET", "/api/tasks/operations-dashboard?period=realtime&q=operations-foreign-private");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.metrics).toMatchObject({ total: 0 });
    expect(DEMO_USER.id).not.toBe("usr_foreign");
  });
});
