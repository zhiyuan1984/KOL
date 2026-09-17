import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { getConn, resetConn } from "../src/db.js";
import { buildHomeBoard, buildRecommendedTasks, isInsightWorkItem, isOpenWorkItem, isTodayWorkItem, isTodoWorkItem } from "../src/host/home-board.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
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

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-home-wb-"));
  process.env.LINGONG_DB = path.join(tmp, "home.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("home workbench", () => {
  it("splits seed work into todos and unpromoted AI insights", () => {
    const board = buildHomeBoard() as Json;
    const workbench = board.workbench as Json;
    const todo = workbench.todo as Json[];
    const open = workbench.open as Json[];
    const insights = workbench.insights as Json[];
    const summary = workbench.summary as Json;
    expect(todo.map((row) => row.id).sort()).toEqual(["tsk_home_laozhang_quote", "tsk_home_trip_stage"]);
    expect(open.map((row) => row.id).sort()).toEqual([
      "tsk_home_laozhang_quote",
      "tsk_home_outdoor_profile",
      "tsk_home_trip_stage",
      "tsk_home_xiaomei_lost",
    ]);
    expect(insights.map((row) => row.id).sort()).toEqual(["tsk_home_outdoor_profile", "tsk_home_xiaomei_lost"]);
    expect(summary).toMatchObject({ open: 4, overdue: 1, due_today: 1, waiting: 1, insights: 2 });
    expect(todo.find((row) => row.id === "tsk_home_laozhang_quote")?.current_stage).toContain("报价待确认");
    expect(todo.find((row) => row.id === "tsk_home_trip_stage")?.current_stage).toContain("争议");
    expect(isTodoWorkItem({ source: "ai", status: "pending" })).toBe(false);
    expect(isInsightWorkItem({ source: "ai", status: "pending" })).toBe(true);
    expect(isTodoWorkItem({ source: "discovery", status: "pending" })).toBe(false);
    expect(isInsightWorkItem({ source: "discovery", status: "pending" })).toBe(false);
  });

  it("surfaces numbered icon recommendations beyond 3 and pads from the catalog", () => {
    const board = buildHomeBoard() as Json;
    const recs = ((board.workbench as Json).recommendations as Json[]) || [];
    expect(recs.length).toBeGreaterThan(3);
    expect(recs.length).toBeLessThanOrEqual(8);
    expect(recs.every((row) => row.act === "ask")).toBe(true);
    expect(recs.every((row) => String(row.reason || "").trim())).toBe(true);
    expect(recs.every((row) => String(row.icon || "").trim())).toBe(true);
    expect(recs.map((row) => Number(row.n))).toEqual(recs.map((_, index) => index + 1));
    expect(recs.every((row) => ["按阶段", "今天推荐", "任务模板"].includes(String(row.source_label)))).toBe(true);
    expect(JSON.stringify(recs)).not.toMatch(/下一阶段/);
    expect(JSON.stringify(recs)).not.toMatch(/MCP|Codex|线程/);
    expect(recs[0]).toMatchObject({
      n: 1,
      source: "ai",
      source_label: "今天推荐",
      intent: "email_compose",
      handle: "小美妆日记",
    });
    expect(String(recs[0].title)).toContain("@小美妆日记");
    expect(String(recs[0].markdown)).toMatch(/^1\. /);
    expect(String(recs[0].prompt)).toContain("写合作邮件 @小美妆日记");
    expect(recs.some((row) => row.handle === "户外充电君")).toBe(true);
    expect(recs.some((row) => row.source === "catalog")).toBe(true);
  });

  it("still recommends catalog tasks when there is no board data", () => {
    const recs = buildRecommendedTasks([], []) as Json[];
    expect(recs).toHaveLength(8);
    expect(recs[0]).toMatchObject({ n: 1, source: "catalog", source_label: "任务模板", act: "ask" });
    expect(recs.map((row) => Number(row.n))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(String(recs[0].markdown)).toContain("1.");
  });

  it("promotes an AI insight into 我的待办 and dismisses another", async () => {
    const before = buildHomeBoard() as Json;
    expect(((before.workbench as Json).insights as Json[]).some((row) => row.id === "tsk_home_xiaomei_lost")).toBe(true);

    const promoted = await request("POST", "/api/tasks/tsk_home_xiaomei_lost/promote", {});
    expect(promoted.status).toBe(200);
    expect(promoted.body.promoted_at).toBeTruthy();
    expect(promoted.body.dismissed_at).toBeFalsy();

    const afterPromote = buildHomeBoard() as Json;
    const todoIds = ((afterPromote.workbench as Json).todo as Json[]).map((row) => row.id);
    const insightIds = ((afterPromote.workbench as Json).insights as Json[]).map((row) => row.id);
    expect(todoIds).toContain("tsk_home_xiaomei_lost");
    expect(insightIds).not.toContain("tsk_home_xiaomei_lost");

    const dismissed = await request("POST", "/api/tasks/tsk_home_outdoor_profile/dismiss", {});
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.dismissed_at).toBeTruthy();
    const afterDismiss = buildHomeBoard() as Json;
    expect(((afterDismiss.workbench as Json).insights as Json[]).some((row) => row.id === "tsk_home_outdoor_profile")).toBe(false);
    expect(((afterDismiss.workbench as Json).todo as Json[]).some((row) => row.id === "tsk_home_outdoor_profile")).toBe(false);
  });

  it("seedAll does not plant demo KOL work items", () => {
    seedAll();
    expect(getConn().prepare("SELECT COUNT(*) AS c FROM work_items WHERE id LIKE 'tsk_home_%'").get() as { c: number }).toEqual({ c: 0 });
    expect(getConn().prepare("SELECT COUNT(*) AS c FROM collaborations WHERE id LIKE 'col_%'").get() as { c: number }).toEqual({ c: 0 });
  });

  it("demo reset drops leftover Starry library rows before stub listAll re-syncs", async () => {
    getConn().prepare(
      `INSERT INTO collaborations
       (id, handle, display_name, brand, platform, followers, email, mailbox_from,
        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, stage_version, locked)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "col_KOLSTALE001",
      "过期全量达人",
      "过期全量达人",
      "LT",
      "YouTube",
      "1万",
      "stale.kol@example.com",
      "kol.lt@litime.example",
      "lc_KOLSTALE001",
      "conv_KOLSTALE001",
      "TESTING",
      3,
      "leftover from a prior real-mode library sync",
      0,
      0,
      0,
    );
    getConn().prepare("UPDATE collaborations SET kol_uid=?, source='starry' WHERE id=?").run(
      "KOLSTALE001",
      "col_KOLSTALE001",
    );
    expect(getConn().prepare("SELECT id FROM collaborations WHERE kol_uid=?").get("KOLSTALE001")).toBeTruthy();

    const reset = await request("POST", "/api/demo/reset", { workbench: true });
    expect(reset.status).toBe(200);
    expect(getConn().prepare("SELECT id FROM collaborations WHERE kol_uid=?").get("KOLSTALE001")).toBeUndefined();

    const board = await request("GET", "/api/home/board");
    const kols = (board.body.kols as Json[]) || [];
    expect(kols.map((row) => String(row.handle)).sort()).toEqual(["户外电源达人", "营地灯测评娘"]);
    expect(kols.some((row) => row.handle === "小美妆日记" || row.handle === "过期全量达人")).toBe(false);
    expect(board.body.library).toMatchObject({ ok: true, source: "starry", tool: "listAllKolProfiles", count: 2 });
  });

  it("demo reset wipes leftover official writes and extra tasks before fixtures", async () => {
    getConn().prepare("INSERT INTO starry_stage_writes (lifecycle_id, stage_code, actor, ts) VALUES (?,?,?,?)").run(
      "lc_xiaomei",
      "INTERESTED",
      "test",
      "2026-09-01T00:00:00+00:00",
    );
    getConn().prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
        collaboration_id,session_id,due_at,promoted_at,dismissed_at,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "tsk_leak", "usr_sriphy", "email_compose", "leftover", "manual", "waiting", "high", "email_compose",
      "lead", null, null, null, null, null, null, "{}", "{}", 1, "2026-09-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00",
    );
    const reset = await request("POST", "/api/demo/reset", { workbench: true });
    expect(reset.status).toBe(200);
    expect(getConn().prepare("SELECT COUNT(*) AS c FROM starry_stage_writes").get() as { c: number }).toEqual({ c: 0 });
    expect(getConn().prepare("SELECT id FROM work_items WHERE id=?").get("tsk_leak")).toBeUndefined();
    expect(getConn().prepare("SELECT stage_code FROM collaborations WHERE id=?").get("col_xiaomei") as { stage_code: string })
      .toEqual({ stage_code: "INITIAL_CONTACT" });
    resetDemoRuntimeState();
    seedWorkbenchFixtures();
    expect((buildHomeBoard() as Json).workbench).toMatchObject({
      summary: { open: 4, insights: 2 },
    });
  });

  it("marks today bucket items vs candidate recommendations", () => {
    const board = buildHomeBoard() as Json;
    const workbench = board.workbench as Json;
    const todo = workbench.todo as Json[];
    const insights = workbench.insights as Json[];
    const recs = workbench.recommendations as Json[];
    const today = workbench.today as Json[];
    expect(todo.every((row) => row.candidate === false)).toBe(true);
    expect(insights.every((row) => row.candidate === true)).toBe(true);
    expect(recs.every((row) => row.candidate === true)).toBe(true);
    expect(Array.isArray(today)).toBe(true);
    expect(today.map((row) => String(row.id)).sort()).toEqual(["tsk_home_laozhang_quote", "tsk_home_trip_stage"]);
    expect(isTodayWorkItem({ source: "manual", status: "queued" })).toBe(false);
    expect(isTodayWorkItem({ source: "manual", status: "pending" })).toBe(false);
    expect(isTodayWorkItem({ source: "manual", status: "running" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "waiting_approval" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "failed", title: "记状态" })).toBe(true);
    expect(isTodayWorkItem({ source: "ai", status: "failed", title: "记状态" })).toBe(true);
    expect(isTodayWorkItem({
      source: "ai",
      status: "pending",
      title: "失联跟进",
      due_at: new Date(Date.now() - 86_400_000).toISOString(),
    })).toBe(true);
    expect(isTodayWorkItem({ source: "ai", status: "pending", title: "待补画像" })).toBe(false);
    expect(isTodayWorkItem({ source: "ai", status: "queued", title: "队列画像" })).toBe(false);
    expect(isOpenWorkItem({ source: "ai", status: "failed", title: "记状态" })).toBe(true);
    expect(isOpenWorkItem({ source: "ai", status: "pending", title: "待补画像" })).toBe(true);
    expect(isOpenWorkItem({ source: "ai", status: "queued", title: "队列画像" })).toBe(true);
    expect(isOpenWorkItem({ source: "manual", status: "completed" })).toBe(false);
    expect(isOpenWorkItem({ source: "manual", status: "pending", dismissed_at: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(board.creates_session).toBe(false);
    expect(board.entry).toBe("memory");
  });

  it("acknowledge writes memory without creating a session", async () => {
    const before = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    const first = await request("POST", "/api/tasks/tsk_home_laozhang_quote/acknowledge", {});
    expect(first.status).toBe(200);
    expect(first.body.creates_session).toBe(false);
    expect(first.body.entry).toBe("command");
    expect(first.body.acknowledged_at).toBeTruthy();
    expect(first.body.last_acted_at).toBeTruthy();
    expect(first.body.session_id).toBeFalsy();
    const again = await request("POST", "/api/tasks/tsk_home_laozhang_quote/acknowledge", {});
    expect(again.status).toBe(200);
    expect(String(again.body.acknowledged_at)).toBe(String(first.body.acknowledged_at));
    expect(String(again.body.last_acted_at) >= String(first.body.last_acted_at)).toBe(true);
    const after = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(after.c).toBe(before.c);
    const reread = await request("GET", `/api/tasks/tsk_home_laozhang_quote`);
    expect(reread.status).toBe(200);
    expect(reread.body.acknowledged_at).toBeTruthy();
    expect(reread.body.last_acted_at).toBeTruthy();
  });

  it("GET board / tasks / following never insert sessions", async () => {
    const before = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    const board = await request("GET", "/api/home/board");
    expect(board.status).toBe(200);
    expect(board.body.creates_session).toBe(false);
    expect(board.body.sync).toMatchObject({ deferred: true });
    const todos = await request("GET", "/api/tasks");
    expect(todos.status).toBe(200);
    const todoView = await request("GET", "/api/tasks?view=todo");
    expect(todoView.status).toBe(200);
    expect(todoView.body.creates_session).toBe(false);
    const openView = await request("GET", "/api/tasks?view=open");
    expect(openView.status).toBe(200);
    expect(openView.body.creates_session).toBe(false);
    expect(openView.body.view).toBe("open");
    const following = await request("GET", "/api/home/following");
    expect(following.status).toBe(200);
    expect(following.body.creates_session).toBe(false);
    expect(following.body.index).toBe("我的跟进");
    expect(Array.isArray(following.body.kols)).toBe(true);
    const after = getConn().prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("adopt-recommendation is idempotent and writes a formal WorkItem", async () => {
    const first = await request("POST", "/api/tasks/adopt-recommendation", {
      recommendation_id: "rec-e2e-quote",
      title: "给 @户外电源达人 写报价",
      handle: "户外电源达人",
      intent: "email_compose",
      reason: "今天推荐",
    });
    expect([200, 201]).toContain(first.status);
    expect(first.body.candidate).toBe(false);
    expect(first.body.promoted_at).toBeTruthy();
    const id = String(first.body.id);
    const second = await request("POST", "/api/tasks/adopt-recommendation", {
      recommendation_id: "rec-e2e-quote",
      title: "给 @户外电源达人 写报价",
      handle: "户外电源达人",
      intent: "email_compose",
    });
    expect(second.status).toBe(200);
    expect(String(second.body.id)).toBe(id);
    expect(second.body.reused).toBe(true);
    const board = buildHomeBoard() as Json;
    const todoIds = ((board.workbench as Json).todo as Json[]).map((row) => String(row.id));
    const insightIds = ((board.workbench as Json).insights as Json[]).map((row) => String(row.id));
    expect(todoIds).toContain(id);
    expect(insightIds).not.toContain(id);
  });

  it("adopt-recommendation promotes an insight and keeps the recommendation title", async () => {
    const first = await request("POST", "/api/tasks/adopt-recommendation", {
      recommendation_id: "rec-ai-tsk_home_xiaomei_lost",
      title: "给@小美妆日记 写合作邮件",
      handle: "小美妆日记",
      intent: "email_compose",
    });
    expect([200, 201]).toContain(first.status);
    expect(first.body.id).toBe("tsk_home_xiaomei_lost");
    expect(first.body.candidate).toBe(false);
    expect(first.body.title).toBe("给@小美妆日记 写合作邮件");
    expect(first.body.promoted_at).toBeTruthy();
    const board = buildHomeBoard() as Json;
    const todo = ((board.workbench as Json).todo as Json[]).find((row) => row.id === "tsk_home_xiaomei_lost");
    expect(todo?.title).toBe("给@小美妆日记 写合作邮件");
    expect(todo?.candidate).toBe(false);
  });

  it("persists promote columns on work_items", () => {
    const cols = getConn().prepare("PRAGMA table_info(work_items)").all() as { name: string }[];
    expect(cols.map((col) => col.name)).toEqual(expect.arrayContaining([
      "promoted_at",
      "dismissed_at",
      "last_acted_at",
      "acknowledged_at",
    ]));
  });
});
