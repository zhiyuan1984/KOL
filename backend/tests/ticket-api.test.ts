import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

type Response = { status: number; body: Json; text: string };

async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {}, text };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-ticket-api-"));
  process.env.LINGONG_DB = path.join(tmp, "tickets.db");
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

async function createTask(title = "验证工单") {
  const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title });
  expect(created.status, created.text).toBe(201);
  return String(created.body.id);
}

describe("target ticket and run read contracts", () => {
  it("returns a stable ticket list/detail/summary without starting a model", async () => {
    const ticketId = await createTask("可追溯任务");
    const list = await request("GET", "/api/tickets?limit=10");
    expect(list.status, list.text).toBe(200);
    expect(list.body).toMatchObject({
      request_id: expect.any(String),
      schema_version: "ticket-api.v1",
      source_refs: [{ type: "tickets", scope: "current_user" }],
    });
    const item = (list.body.items as Json[]).find((row) => row.ticket_id === ticketId)!;
    expect(item).toMatchObject({ ticket_id: ticketId, title: "可追溯任务" });
    expect(item.allowed_actions).toContain("cancel");

    const detail = await request("GET", `/api/tickets/${ticketId}`);
    expect(detail.status, detail.text).toBe(200);
    expect(detail.body).toMatchObject({
      ticket_id: ticketId,
      schema_version: "ticket-api.v1",
      latest_run: null,
    });
    expect(detail.body.missing_fields).toContain("acceptance_criteria");

    const summary = await request("GET", `/api/tickets/${ticketId}/summary`);
    expect(summary.status, summary.text).toBe(200);
    expect(summary.body).toMatchObject({
      ticket_id: ticketId,
      producer: "rule",
      status: "current",
    });
    expect("calls_model" in summary.body).toBe(false);
  });

  it("keeps Today inside Todo across cursor-backed server projections", async () => {
    const todayId = await createTask("今天处理风险");
    getConn().prepare("UPDATE tickets SET priority='important_urgent' WHERE id=?").run(todayId);
    const today = await request("GET", "/api/workbench/tasks?view=today&limit=1");
    const todo = await request("GET", "/api/workbench/tasks?view=todo&limit=200");
    expect(today.status, today.text).toBe(200);
    expect(todo.status, todo.text).toBe(200);
    const todayIds = (today.body.items as Json[]).map((item) => String(item.ticket_id));
    const todoIds = new Set((todo.body.items as Json[]).map((item) => String(item.ticket_id)));
    expect(todayIds.every((id) => todoIds.has(id))).toBe(true);
    expect((today.body.items as Json[]).every((item) => item.is_today === true && Array.isArray(item.membership_reason))).toBe(true);
    expect(today.body).toMatchObject({ request_id: expect.any(String), projection_version: "task-workbench.v1" });
  });

  it("separates run success records from explicit accepted ticket completion", async () => {
    const ticketId = await createTask("验收与运行分离");
    const queued = await request("POST", `/api/tasks/${ticketId}/run`, { text: "风险扫描" });
    expect(queued.status, queued.text).toBe(202);
    const runId = String(queued.body.run_id);

    const run = await request("GET", `/api/runs/${runId}`);
    expect(run.status, run.text).toBe(200);
    expect(run.body).toMatchObject({ run_id: runId, ticket_id: ticketId, schema_version: "ticket-api.v1" });
    const events = await request("GET", `/api/runs/${runId}/events?after=0`);
    expect(events.status, events.text).toBe(200);
    expect(events.body).toMatchObject({ run_id: runId, ticket_id: ticketId, next_sequence: expect.any(Number) });

    const acknowledged = await request("POST", `/api/tasks/${ticketId}/acknowledge`, {});
    expect(acknowledged.status, acknowledged.text).toBe(200);
    const version = Number(acknowledged.body.data_version);
    const command = { action: "complete", expected_version: version, acceptance_evidence: { receipt: "人工核验" } };
    const completed = await request("POST", `/api/tickets/${ticketId}/commands`, command, { "Idempotency-Key": "ticket-complete-0001" });
    expect(completed.status, completed.text).toBe(200);
    expect(completed.body).toMatchObject({ ticket_id: ticketId, status: "completed", replayed: false });

    const replayed = await request("POST", `/api/tickets/${ticketId}/commands`, command, { "Idempotency-Key": "ticket-complete-0001" });
    expect(replayed.status, replayed.text).toBe(200);
    expect(replayed.body).toMatchObject({ ticket_id: ticketId, status: "completed", replayed: true });
    const acceptedEvents = getConn().prepare(
      "SELECT COUNT(*) AS count FROM task_events WHERE work_item_id=? AND event_type='task.accepted'",
    ).get(ticketId) as { count: number };
    expect(acceptedEvents.count).toBe(1);
  });
});
