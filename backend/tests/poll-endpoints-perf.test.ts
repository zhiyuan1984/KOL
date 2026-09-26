import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { buildHomeBoard, MAX_BOARD_TASKS, MAX_KOL_MAIL_THREADS, MAX_KOL_TASKS, MAX_WORKBENCH_TASKS, OPEN_WORK_ITEM_SQL } from "../src/host/home-board.js";
import { pollCacheCounters, resetPollCache } from "../src/host/response-cache.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { resetStarryHomeLibrarySync } from "../src/starrykol/library-sync.js";
import { resetFollowedMailSync } from "../src/starrykol/mail-sync.js";
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

/** Production shape: many events per work item, most of them irrelevant to a list. */
function seedEventTail(workItemId: string, eventCount: number) {
  const conn = getConn();
  const start = Number((
    conn.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=?").get(workItemId) as { sequence: number }
  ).sequence);
  const insert = conn.prepare(
    `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,time,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const last = start + eventCount;
  for (let i = start + 1; i <= last; i += 1) {
    insert.run(
      `tev_seed_${workItemId}_${i}`, workItemId, null, i, "trace", `步骤 ${i}`, "running",
      i === last ? "最后一步 · 进行中" : `中间步骤 ${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    );
  }
  return last;
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-poll-perf-"));
  process.env.LINGONG_DB = path.join(tmp, "poll.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.NODE_ENV = "test";
  resetConn();
  resetPollCache();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetDemoRuntimeState();
  resetPollCache();
  resetStarryHomeLibrarySync();
  resetFollowedMailSync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("GET /api/tasks list payloads", () => {
  it("caps each work item's history tail while keeping the aggregate result correct", async () => {
    const last = seedEventTail("tsk_home_laozhang_quote", 400);
    const listed = await request("GET", "/api/tasks");
    expect(listed.status).toBe(200);
    const rows = listed.body as unknown as Json[];
    const row = rows.find((item) => item.id === "tsk_home_laozhang_quote") as Json;
    expect(row).toBeTruthy();
    const history = row.history as Json[];
    // The tail is bounded, ascending, and ends at the newest event.
    expect(history.length).toBe(5);
    expect(history.map((event) => event.id)).toEqual(
      Array.from({ length: 5 }, (_, i) => `tev_seed_tsk_home_laozhang_quote_${last - 4 + i}`),
    );
    expect(history[history.length - 1].summary).toBe("最后一步 · 进行中");
    expect(history[history.length - 1].type).toBe("trace");
    // history_summary is derived from the newest event, so it must not drift.
    expect(String(row.history_summary)).toContain("最后一步 · 进行中");
    // Every other task still carries its own (seed) history.
    expect(rows.some((item) => item.id === "tsk_home_trip_stage" && Array.isArray(item.history))).toBe(true);
  });

  it("view=open reports the same total before and after the aggregation change", async () => {
    seedEventTail("tsk_home_laozhang_quote", 40);
    const listed = await request("GET", "/api/tasks?view=open");
    expect(listed.status).toBe(200);
    const expected = Number((
      getConn().prepare(`SELECT COUNT(*) AS c FROM work_items WHERE owner_user_id=? AND ${OPEN_WORK_ITEM_SQL}`)
        .get("usr_sriphy") as { c: number }
    ).c);
    expect(listed.body.total).toBe(expected);
    const tasks = listed.body.tasks as Json[];
    expect(tasks.length).toBe(expected);
    for (const task of tasks) {
      expect(task.history).toBeUndefined();
      expect(String(task.history_summary || "").trim()).toBeTruthy();
    }
  });
});

describe("polling result cache", () => {
  it("reuses the projection inside the window and recomputes after a write", async () => {
    const before = pollCacheCounters();
    const first = await request("GET", "/api/tasks?view=open");
    const second = await request("GET", "/api/tasks?view=open");
    const afterReads = pollCacheCounters();
    expect(afterReads.misses).toBe(before.misses + 1);
    expect(afterReads.hits).toBe(before.hits + 1);
    expect(second.body).toEqual(first.body);

    // A write must be visible on the very next poll, not after the TTL:
    // the epoch fingerprint in the cache key moves with the data.
    const created = await request("POST", "/api/tasks", {
      task_type: "email_compose",
      title: "缓存失效验证任务",
      skill: "email_compose",
      profile: "lead",
    });
    expect(created.status).toBe(201);
    const after = await request("GET", "/api/tasks?view=open");
    const ids = (after.body.tasks as Json[]).map((row) => String(row.id));
    expect(ids).toContain(String((created.body as Json).id));
    expect(pollCacheCounters().hits).toBe(afterReads.hits);
  });

  it("keeps per-owner session lists separate and reflects a session write", async () => {
    const created = await request("POST", "/api/sessions", { title: "轮询缓存会话" });
    expect(created.status).toBe(200);
    const sid = String((created.body as Json).id);

    const first = await request("GET", "/api/sessions");
    const second = await request("GET", "/api/sessions");
    expect(second.body).toEqual(first.body);
    const rows = first.body as unknown as Json[];
    expect(rows.map((row) => String(row.id))).toContain(sid);
    expect(rows.every((row) => typeof row.agent_status === "string")).toBe(true);

    const patched = await request("PATCH", `/api/sessions/${sid}`, { title: "轮询缓存后改名" });
    expect(patched.status).toBe(200);
    const after = await request("GET", "/api/sessions");
    const renamed = (after.body as unknown as Json[]).find((row) => row.id === sid) as Json;
    expect(String(renamed.title)).toBe("轮询缓存后改名");
  });
});

describe("GET /api/home/board list caps", () => {
  it("caps kol sub-lists and workbench rows while keeping the counts exact", () => {
    const board = buildHomeBoard() as Json;
    const kols = board.kols as Json[];
    const workbench = board.workbench as Json;
    const summary = workbench.summary as Json;
    const open = workbench.open as Json[];
    const todo = workbench.todo as Json[];
    expect(open.length).toBeLessThanOrEqual(MAX_WORKBENCH_TASKS);
    expect(todo.length).toBeLessThanOrEqual(MAX_WORKBENCH_TASKS);
    expect((board.tasks as Json[]).length).toBeLessThanOrEqual(MAX_BOARD_TASKS);
    expect(Number(board.tasks_loaded)).toBe((board.tasks as Json[]).length);
    // summary counts stay whole-log counts, not clipped list lengths.
    expect(Number(summary.open)).toBeGreaterThanOrEqual(open.length);
    for (const kol of kols) {
      expect((kol.tasks as Json[]).length).toBeLessThanOrEqual(MAX_KOL_TASKS);
      expect(((kol.mail_threads as Json[]) || []).length).toBeLessThanOrEqual(MAX_KOL_MAIL_THREADS);
      // Fields no frontend file reads are dropped from the projection.
      for (const dropped of ["sku", "qty", "risk_tag", "kol_id", "recipient_name", "list_in_projects", "address_line", "country", "postal"]) {
        expect(dropped in kol).toBe(false);
      }
      // Fields frontend consumers read are kept.
      for (const kept of ["handle", "kol_uid", "kol_name", "current_stage", "suggested_stage", "unread_count", "profile_tags", "follow_style_tags", "recent_followup", "task_history", "collab_summary", "stage_label", "days_in_stage"]) {
        expect(kept in kol).toBe(true);
      }
    }
  });

  it("caps a work item's related tasks per kol without losing the unread total", () => {
    const conn = getConn();
    // The board only projects collaborations bound to a remote KOL identity.
    conn.prepare("UPDATE collaborations SET kol_uid='ku_xiaomei' WHERE id='col_xiaomei'").run();
    const collab = conn.prepare("SELECT id,handle FROM collaborations WHERE id='col_xiaomei'").get() as { id: string; handle: string };
    const insert = conn.prepare(
      `INSERT INTO work_items (id,owner_user_id,task_type,title,source,status,priority,skill,profile,collaboration_id,project_id,input,entities,created_at,updated_at,content,risk_level)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (let i = 0; i < MAX_KOL_TASKS + 4; i += 1) {
      const stamp = new Date(Date.now() + i * 1000).toISOString();
      insert.run(
        `tsk_cap_${i}`, "usr_sriphy", "email_compose", `跟进 ${i} @${collab.handle}`, "manual", "pending", "normal",
        "email_compose", "lead", collab.id, collab.id, "{}", "{}", stamp, stamp, "", "none",
      );
    }
    const board = buildHomeBoard() as Json;
    const kol = (board.kols as Json[]).find((row) => row.id === collab.id) as Json;
    expect(kol).toBeTruthy();
    expect((kol.tasks as Json[]).length).toBe(MAX_KOL_TASKS);
    expect((kol.tasks as Json[]).every((task) => String(task.id).startsWith("tsk_cap_"))).toBe(true);
  });
});
