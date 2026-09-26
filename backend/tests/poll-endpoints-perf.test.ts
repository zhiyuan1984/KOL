import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { DEMO_USER } from "../src/config.js";
import { buildHomeBoard, MAX_BOARD_TASKS, MAX_KOL_MAIL_THREADS, MAX_KOL_TASKS, MAX_WORKBENCH_TASKS, OPEN_WORK_ITEM_SQL } from "../src/host/home-board.js";
import { POLL_CACHE_MAX_TOTAL_BYTES, POLL_CACHE_MAX_VALUE_BYTES, pollCacheCounters, resetPollCache } from "../src/host/response-cache.js";
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
        .get(DEMO_USER.id) as { c: number }
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

  it("serves a projection over the per-value byte ceiling without retaining it", async () => {
    // A runaway multi-MB projection must be served without pinning it on the
    // single host thread: one synthetic row is enough to cross the ceiling
    // without slowing the suite down with tens of thousands of inserts.
    const stamp = "2026-09-01T00:00:00.000Z";
    const filler = "x".repeat(Math.ceil(POLL_CACHE_MAX_VALUE_BYTES * 1.1));
    getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,kind,owner_user_id) VALUES (?,?,?,?,?,?)",
    ).run("ses_oversize", filler, stamp, stamp, "work", DEMO_USER.id);

    const before = pollCacheCounters();
    const first = await request("GET", "/api/sessions");
    expect(first.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(first.body), "utf8");
    // The fixture must really be over the ceiling, otherwise this proves nothing.
    expect(bytes).toBeGreaterThan(POLL_CACHE_MAX_VALUE_BYTES);

    const after = pollCacheCounters();
    expect(after.skipped).toBe(before.skipped + 1);
    expect(after.size).toBe(before.size);
    expect(after.bytes).toBe(before.bytes);

    // Served, not cached: the next read recomputes instead of hitting.
    const second = await request("GET", "/api/sessions");
    expect(second.body).toEqual(first.body);
    const final = pollCacheCounters();
    expect(final.misses).toBe(after.misses + 1);
    expect(final.hits).toBe(after.hits);
  });

  it("retains a production-sized projection and serves the next poll from the cache", async () => {
    // ~900KB is the measured size of the deployed `/api/tasks` projection; the
    // shell polls it every 4s per tab, so it must stay inside the budget.
    const stamp = "2026-09-01T00:00:00.000Z";
    const filler = "x".repeat(900 * 1024);
    getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,kind,owner_user_id) VALUES (?,?,?,?,?,?)",
    ).run("ses_big", filler, stamp, stamp, "work", DEMO_USER.id);

    const before = pollCacheCounters();
    const first = await request("GET", "/api/sessions");
    expect(first.status).toBe(200);
    const bytes = Buffer.byteLength(JSON.stringify(first.body), "utf8");
    expect(bytes).toBeGreaterThan(512 * 1024);
    expect(bytes).toBeLessThan(POLL_CACHE_MAX_VALUE_BYTES);

    const after = pollCacheCounters();
    expect(after.skipped).toBe(before.skipped);
    expect(after.bytes).toBeGreaterThan(512 * 1024);
    expect(after.bytes).toBeLessThanOrEqual(POLL_CACHE_MAX_TOTAL_BYTES);

    const second = await request("GET", "/api/sessions");
    expect(second.body).toEqual(first.body);
    expect(pollCacheCounters().hits).toBe(after.hits + 1);
  });
});

describe("GET /api/sessions projection", () => {
  /**
   * The shell polls this endpoint from every open tab, so the projection is
   * only what the shell reads: 会话标题 list (id/title/agent_status) and the
   * 账号设置 archive toggle (archived_at). Measured after the trim below:
   * ~19KB for this 200-session fixture; the pre-trim `SELECT *` row shape
   * (~14 columns) was ~3x that, so 40KB fails the old projection and still
   * leaves headroom for longer titles.
   */
  const SESSIONS_PAYLOAD_CEILING_BYTES = 40 * 1024;
  const FIELD_KEYS = ["agent_status", "archived_at", "id", "title"];
  const ARCHIVED_ROWS = 23;

  it("ships no field the shell does not read, under a byte ceiling", async () => {
    const stamp = "2026-09-01T00:00:00.000Z";
    const insert = getConn().prepare(
      "INSERT INTO sessions (id,title,created_at,updated_at,collaboration_id,kind,owner_user_id,archived_at,expert_id,thread_ref) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    getConn().transaction(() => {
      for (let i = 0; i < 200; i += 1) {
        insert.run(
          `ses_proj_${String(i).padStart(3, "0")}`,
          `与 达人${i} 的合作会话 · 第 ${i} 轮`,
          stamp, stamp, `col_proj_${i}`, "work", DEMO_USER.id, i % 9 === 0 ? stamp : null, `expert_${i}`, `thread_${i}`,
        );
      }
    })();

    const listed = await request("GET", "/api/sessions");
    expect(listed.status).toBe(200);
    const rows = listed.body as unknown as Json[];
    // Every 9th seeded session is archived, so the default list is the rest.
    expect(rows.length).toBe(200 - ARCHIVED_ROWS);
    // No unexpected keys: every row is exactly the shell's projection.
    const keys = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
    expect([...keys].sort()).toEqual(FIELD_KEYS);
    // Archived rows only come back with include_archived=1, and then carry the flag.
    const archived = await request("GET", "/api/sessions?include_archived=1");
    const archivedRows = archived.body as unknown as Json[];
    expect(archivedRows.length).toBe(200);
    expect((archivedRows.find((row) => row.id === "ses_proj_000") as Json).archived_at).toBe(stamp);
    expect((archivedRows.find((row) => row.id === "ses_proj_001") as Json).archived_at).toBe(null);
    expect(Object.keys(archivedRows[0]).sort()).toEqual(FIELD_KEYS);

    const bytes = Buffer.byteLength(JSON.stringify(archivedRows), "utf8");
    expect(bytes).toBeLessThan(SESSIONS_PAYLOAD_CEILING_BYTES);
  });
});

describe("GET /api/home/board list caps", () => {
  it("caps kol sub-lists and workbench rows while keeping the counts exact", () => {
    // The board only projects collaborations bound to a remote KOL identity, so
    // without this the per-kol assertions below would be vacuous.
    getConn().prepare(
      "UPDATE collaborations SET kol_uid='ku_' || id WHERE id IN ('col_xiaomei','col_laozhang','col_mum','col_trip')",
    ).run();
    const board = buildHomeBoard() as Json;
    const kols = board.kols as Json[];
    const workbench = board.workbench as Json;
    const summary = workbench.summary as Json;
    const open = workbench.open as Json[];
    const todo = workbench.todo as Json[];
    expect(kols.length).toBeGreaterThanOrEqual(4);
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
      for (const dropped of ["sku", "qty", "risk_tag", "kol_id", "recipient_name", "list_in_projects", "address_line", "country", "postal", "coarse", "locked", "contact_email_masked", "wechat", "duplicate_checked", "task_history"]) {
        expect(dropped in kol, `dropped field present: ${dropped}`).toBe(false);
      }
      // Fields frontend consumers read are kept.
      for (const kept of ["handle", "kol_uid", "kol_name", "current_stage", "suggested_stage", "unread_count", "profile_tags", "follow_style_tags", "recent_followup", "collab_summary", "stage_label", "days_in_stage", "last_conversation_id", "owner_name", "owner_mailbox"]) {
        expect(kept in kol).toBe(true);
      }
    }
    // The workbench ships the lists the shell renders; `lifecycle` had no reader
    // in frontend/src or frontend/e2e and no consumer in this backend.
    expect("lifecycle" in workbench).toBe(false);
    expect(Object.keys(workbench).sort()).toEqual(["insights", "open", "recommendations", "summary", "today", "todo"]);
  });

  it("keeps owner_mailbox so 无主 judgment still sees every owner key it had", () => {
    // frontend/src/home/kolContract.ts#isUnownedRow calls a row 无主 only when
    // *every* owner key present in it is empty. Dropping `owner_mailbox` would
    // leave `owner_name: ""` as the only key and send a 有主 KOL to the public sea.
    getConn().prepare(
      "UPDATE collaborations SET kol_uid='ku_xiaomei', owner_name='', owner_mailbox='ops@example.com' WHERE id='col_xiaomei'",
    ).run();
    const board = buildHomeBoard() as Json;
    const kol = (board.kols as Json[]).find((row) => row.id === "col_xiaomei") as Json;
    expect(kol.owner_mailbox).toBe("ops@example.com");
    expect("owner_name" in kol).toBe(true);
  });

  it("keeps the unread-inbound signal from the whole thread list even though the board caps it", () => {
    const conn = getConn();
    conn.prepare("UPDATE collaborations SET kol_uid='ku_xiaomei' WHERE id='col_xiaomei'").run();
    const collab = conn.prepare("SELECT id FROM collaborations WHERE id='col_xiaomei'").get() as { id: string };
    const insert = conn.prepare(
      `INSERT INTO kol_mail_threads
         (id,collaboration_id,conversation_id,subject,mailbox,last_direction,last_snippet,unread_count,last_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    // Newest first by last_at: the only unread inbound thread is the fourth, so
    // it falls outside the serialized cap and must still raise the recommendation.
    const base = Date.parse("2026-03-01T00:00:00.000Z");
    for (let i = 0; i < 4; i += 1) {
      const at = new Date(base - i * 3600_000).toISOString();
      const unread = i === 3;
      insert.run(
        `thr_cap_${i}`, collab.id, `conv_cap_${i}`, `主题 ${i}`, "brand@example.com",
        unread ? "inbound" : "outbound", `片段 ${i}`, unread ? 2 : 0, at, at, at,
      );
    }
    const board = buildHomeBoard() as Json;
    const kol = (board.kols as Json[]).find((row) => row.id === collab.id) as Json;
    expect(((kol.mail_threads as Json[]) || []).length).toBe(MAX_KOL_MAIL_THREADS);
    const recommendations = (board.workbench as Json).recommendations as Json[];
    expect(recommendations.map((row) => String(row.id))).toContain(`rec-mail-${collab.id}`);
    expect(Number(kol.unread_count)).toBe(2);
  });

  it("threads one definitions index through every recommendation call site", () => {
    // recPrompt/recTitle/insightIntent default to taskDefinitionIndex(), which
    // re-stats every skill directory: a call site that omits the argument
    // silently reintroduces the per-row scan this task removed.
    const source = fs.readFileSync(path.join(import.meta.dirname, "../src/host/home-board.ts"), "utf8");
    const callSites = source.split("\n").filter((line) => /(recPrompt|recTitle|insightIntent)\(/.test(line) && !line.includes("function "));
    expect(callSites.length).toBeGreaterThan(8);
    for (const line of callSites) {
      expect(line.trim(), line.trim()).toContain("definitions");
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
        `tsk_cap_${i}`, DEMO_USER.id, "email_compose", `跟进 ${i} @${collab.handle}`, "manual", "pending", "normal",
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
