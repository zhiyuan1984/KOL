import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { resetConn } from "../src/db.js";
import { markSessionRunning, publicQueue, resetRunControl } from "../src/host/run-control.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(url, init);
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: text ? (JSON.parse(text) as Json) : {},
  };
}

async function openSession(title = "排队会话") {
  const created = await request("POST", "/api/sessions", { title });
  expect(created.status).toBe(200);
  return String(created.body.id);
}

describe("session run queue and stop", () => {
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-run-queue-"));
    process.env.LINGONG_DB = path.join(tmp, "t.db");
    process.env.LINGONG_DATA = tmp;
    process.env.CODEX_MODE = "stub";
    resetConn();
    resetRunControl();
    seedAll();
    const { createApp } = await import("../src/app.js");
    app = createApp();
    seedWorkbenchFixtures();
  });

  afterEach(() => {
    resetRunControl();
    resetConn();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("queues a generate ask while the session is already running", async () => {
    const sid = await openSession();
    markSessionRunning(sid);
    const queued = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "搜索 YouTube 露营达人",
      intent: "creator_discovery",
      act: "ask",
    });
    expect(queued.status, queued.text).toBe(202);
    expect(queued.body.queued).toBe(true);
    expect(queued.body.agent_status).toBe("running");
    const queue = queued.body.run_queue as Json[];
    expect(queue).toHaveLength(1);
    expect(String(queue[0]?.text || "")).toContain("露营");
    expect(publicQueue(sid)).toHaveLength(1);
  });

  it("rejects confirm_stage while generating instead of queueing it", async () => {
    const sid = await openSession();
    markSessionRunning(sid);
    const blocked = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "记状态 @小美妆日记 到 报价待确认",
      intent: "confirm_stage",
      collaboration_id: "col_xiaomei",
      act: "ask",
    });
    expect(blocked.status, blocked.text).toBe(409);
    expect(String(blocked.body.detail || "")).toMatch(/请先停止当前生成/);
    expect(publicQueue(sid)).toHaveLength(0);
  });

  it("stop while idle reports stopped false", async () => {
    const sid = await openSession();
    const idle = await request("POST", `/api/sessions/${sid}/stop`, {});
    expect(idle.status, idle.text).toBe(200);
    expect(idle.body.stopped).toBe(false);
  });

  it("stop keeps the queued asks", async () => {
    const sid = await openSession();
    markSessionRunning(sid);
    await request("POST", `/api/sessions/${sid}/messages`, {
      text: "搜索 YouTube 露营达人",
      intent: "creator_discovery",
      act: "ask",
    });
    expect(publicQueue(sid)).toHaveLength(1);
    const stopped = await request("POST", `/api/sessions/${sid}/stop`, {});
    expect(stopped.status, stopped.text).toBe(200);
    expect(stopped.body.stopped).toBe(true);
    expect(publicQueue(sid)).toHaveLength(1);
    const listed = await request("GET", `/api/sessions/${sid}`);
    expect(listed.body.agent_status).toBe("listening");
    expect(listed.body.run_queue as Json[]).toHaveLength(1);
  });

  it("removes a queued ask", async () => {
    const sid = await openSession();
    markSessionRunning(sid);
    const queued = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "搜索 YouTube 露营达人",
      intent: "creator_discovery",
      act: "ask",
    });
    const id = String((queued.body.run_queue as Json[])[0]?.id || "");
    expect(id).toBeTruthy();
    const removed = await request("DELETE", `/api/sessions/${sid}/queue/${id}`);
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.ok).toBe(true);
    expect(publicQueue(sid)).toHaveLength(0);
    const missing = await request("DELETE", `/api/sessions/${sid}/queue/${id}`);
    expect(missing.status).toBe(404);
  });
});
