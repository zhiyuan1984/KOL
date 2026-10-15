import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { DEMO_USER } from "../src/config.js";
import { databaseEngine, getConn, resetConn } from "../src/db.js";
import { buildHomeBoard, buildRecommendedTasks, isInsightWorkItem, isOpenWorkItem, isTodayWorkItem, isTodoWorkItem, todayDateStr } from "../src/host/home-board.js";
import { resetDemoRuntimeState, seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";

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
  if (process.env.TEST_DATABASE_URL) await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-home-wb-"));
  process.env.LINGONG_DB = path.join(tmp, "home.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  (await resetConn());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
  (await seedWorkbenchFixtures());
});

afterEach(async () => {
  (await resetConn());
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("home workbench", () => {
  it("enriches current workbench rows linked only by collaboration_id", async () => {
    const source = (await getConn().query("SELECT project_id, collaboration_id FROM tickets WHERE id=$1",["tsk_home_laozhang_quote"])).rows[0] as { project_id?: string; collaboration_id?: string };
    const collaborationId = source.collaboration_id || source.project_id;
    expect(collaborationId).toBeTruthy();
    (await getConn().query("UPDATE tickets SET collaboration_id=$1, project_id=NULL WHERE id=$2",[collaborationId,"tsk_home_laozhang_quote"]));

    for (const view of ["todo", "today"]) {
      const listed = await request("GET", `/api/workbench/tasks?view=${view}`);
      expect(listed.status).toBe(200);
      const item = (listed.body.items as Json[]).find((row) => row.id === "tsk_home_laozhang_quote");
      expect(item?.collaboration_id).toBe(collaborationId);
      expect(String(item?.kol_name || "")).not.toBe("");
      expect(item?.current_stage).toContain("报价待确认");
    }
  });

  it("splits seed work into todos and unpromoted AI insights", async () => {
    const board = (await buildHomeBoard()) as Json;
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

  it("does not load full planner input snapshots into the home board", async () => {
    (await getConn().query("INSERT INTO tickets\n       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,input,entities,data_version,created_at,updated_at)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",["tsk_large_planner_input",DEMO_USER.id,"today_plan","今日规划","planning","completed","normal","today_plan","platform:workspace-planner",JSON.stringify({ snapshot: "x".repeat(1_000_000) }),"{}",1,"2099-01-01T00:00:00.000Z","2099-01-01T00:00:00.000Z"]));

    const board = (await buildHomeBoard()) as Json;
    const tasks = board.tasks as Json[];
    expect(tasks.find((row) => row.id === "tsk_large_planner_input")?.input).toEqual({});
  });

  it("surfaces numbered icon recommendations beyond 3 and pads from the catalog", async () => {
    const board = (await buildHomeBoard()) as Json;
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

  it("still recommends catalog tasks when there is no board data", async () => {
    const recs = await buildRecommendedTasks([], []);
    expect(recs).toHaveLength(8);
    expect(recs[0]).toMatchObject({ n: 1, source: "catalog", source_label: "任务模板", act: "ask" });
    expect(recs.map((row) => Number(row.n))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(String(recs[0].markdown)).toContain("1.");
  });

  it("promotes an AI insight into 我的待办 and dismisses another", async () => {
    const before = (await buildHomeBoard()) as Json;
    expect(((before.workbench as Json).insights as Json[]).some((row) => row.id === "tsk_home_xiaomei_lost")).toBe(true);

    const promoted = await request("POST", "/api/tasks/tsk_home_xiaomei_lost/promote", {});
    expect(promoted.status).toBe(200);
    expect(promoted.body.promoted_at).toBeTruthy();
    expect(promoted.body.dismissed_at).toBeFalsy();

    const afterPromote = (await buildHomeBoard()) as Json;
    const todoIds = ((afterPromote.workbench as Json).todo as Json[]).map((row) => row.id);
    const insightIds = ((afterPromote.workbench as Json).insights as Json[]).map((row) => row.id);
    expect(todoIds).toContain("tsk_home_xiaomei_lost");
    expect(insightIds).not.toContain("tsk_home_xiaomei_lost");

    const dismissed = await request("POST", "/api/tasks/tsk_home_outdoor_profile/dismiss", {});
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.dismissed_at).toBeTruthy();
    const afterDismiss = (await buildHomeBoard()) as Json;
    expect(((afterDismiss.workbench as Json).insights as Json[]).some((row) => row.id === "tsk_home_outdoor_profile")).toBe(false);
    expect(((afterDismiss.workbench as Json).todo as Json[]).some((row) => row.id === "tsk_home_outdoor_profile")).toBe(false);
  });

  it("seedAll does not plant demo KOL work items", async () => {
    const count = async (table: "tickets" | "collaborations", prefix: string) => {
      if (table !== "tickets" && table !== "collaborations") throw new Error("invalid test table");
      return Number((await getConn().query(`SELECT COUNT(*) AS c FROM ${table} WHERE id LIKE $1`, [prefix])).rows[0].c);
    };
    const ticketsBefore = await count("tickets", "tsk_home_%");
    const collaborationsBefore = await count("collaborations", "col_%");
    (await seedAll());
    // Native bootstrap preserves previously inserted fixture facts.
    expect(await count("tickets", "tsk_home_%")).toBe(ticketsBefore);
    expect(await count("collaborations", "col_%")).toBe(collaborationsBefore);
  });

  it("demo reset drops leftover Starry library rows before stub listAll re-syncs", async () => {
    (await getConn().query("INSERT INTO collaborations\n       (id, handle, display_name, brand, platform, followers, email, mailbox_from,\n        lifecycle_id, conversation_id, stage_code, days_in_stage, notes, overdue, stage_version, locked)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",["col_KOLSTALE001","过期全量达人","过期全量达人","LT","YouTube","1万","stale.kol@example.com","kol.lt@litime.example","lc_KOLSTALE001","conv_KOLSTALE001","TESTING",3,"leftover from a prior real-mode library sync",0,0,0]));
    (await getConn().query("UPDATE collaborations SET kol_uid=$1, source='starry' WHERE id=$2",["KOLSTALE001","col_KOLSTALE001"]));
    expect((await getConn().query("SELECT id FROM collaborations WHERE kol_uid=$1",["KOLSTALE001"])).rows[0]).toBeTruthy();

    const reset = await request("POST", "/api/demo/reset", { workbench: true });
    expect(reset.status).toBe(200);
    expect((await getConn().query("SELECT id FROM collaborations WHERE kol_uid=$1",["KOLSTALE001"])).rows[0]).toBeUndefined();

    const board = await request("GET", "/api/home/board");
    const kols = (board.body.kols as Json[]) || [];
    expect(kols.map((row) => String(row.handle)).sort()).toEqual(["户外电源达人", "营地灯测评娘"]);
    expect(kols.some((row) => row.handle === "小美妆日记" || row.handle === "过期全量达人")).toBe(false);
    expect(board.body.library).toMatchObject({ ok: true, source: "starry", tool: "listAllKolProfiles", count: 2 });
  });

  it("demo reset wipes leftover official writes and extra tasks before fixtures", async () => {
    (await getConn().query("INSERT INTO starry_stage_writes (lifecycle_id, stage_code, actor, ts) VALUES ($1,$2,$3,$4)",["lc_xiaomei","INTERESTED","test","2026-09-01T00:00:00+00:00"]));
    (await getConn().query("INSERT INTO tickets\n       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,\n        collaboration_id,session_id,due_at,promoted_at,dismissed_at,input,entities,data_version,created_at,updated_at)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",["tsk_leak",DEMO_USER.id,"email_compose","leftover","manual","waiting","high","email_compose","lead",null,null,null,null,null,null,"{}","{}",1,"2026-09-01T00:00:00+00:00","2026-09-01T00:00:00+00:00"]));
    const reset = await request("POST", "/api/demo/reset", { workbench: true });
    expect(reset.status).toBe(200);
    expect((await getConn().query("SELECT COUNT(*) AS c FROM starry_stage_writes",[])).rows[0] as { c: number }).toEqual({ c: 0 });
    expect((await getConn().query("SELECT id FROM tickets WHERE id=$1",["tsk_leak"])).rows[0]).toBeUndefined();
    expect((await getConn().query("SELECT stage_code FROM collaborations WHERE id=$1",["col_xiaomei"])).rows[0] as { stage_code: string })
      .toEqual({ stage_code: "INITIAL_CONTACT" });
    (await resetDemoRuntimeState());
    (await seedWorkbenchFixtures());
    expect(((await buildHomeBoard()) as Json).workbench).toMatchObject({
      summary: { open: 4, insights: 2 },
    });
  });

  it("marks today bucket items vs candidate recommendations", async () => {
    const board = (await buildHomeBoard()) as Json;
    const workbench = board.workbench as Json;
    const todo = workbench.todo as Json[];
    const insights = workbench.insights as Json[];
    const recs = workbench.recommendations as Json[];
    const today = workbench.today as Json[];
    expect(todo.every((row) => row.candidate === false)).toBe(true);
    expect(insights.every((row) => row.candidate === true)).toBe(true);
    expect(recs.every((row) => row.candidate === true)).toBe(true);
    expect(Array.isArray(today)).toBe(true);
    // Today is the focused subset of formal todo work: the unadopted AI lost-
    // contact suggestion remains an insight/recommendation rather than a task.
    expect(today.map((row) => String(row.id)).sort()).toEqual([
      "tsk_home_laozhang_quote",
      "tsk_home_trip_stage",
    ]);
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
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "important_urgent" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "important" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "urgent" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "high" })).toBe(true);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "normal" })).toBe(false);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", priority: "low" })).toBe(false);
    expect(isTodayWorkItem({
      source: "manual",
      status: "pending",
      title: "普通任务",
      priority: "normal",
      start_date: todayDateStr(),
    })).toBe(true);
    expect(isTodayWorkItem({
      source: "manual",
      status: "pending",
      title: "普通任务",
      priority: "normal",
      start_date: "2020-01-01",
    })).toBe(false);
    expect(isTodayWorkItem({ source: "manual", status: "pending", title: "普通任务", risk_level: "high" })).toBe(true);
    expect(isOpenWorkItem({ source: "ai", status: "failed", title: "记状态" })).toBe(true);
    expect(isOpenWorkItem({ source: "ai", status: "pending", title: "待补画像" })).toBe(true);
    expect(isOpenWorkItem({ source: "ai", status: "queued", title: "队列画像" })).toBe(true);
    expect(isOpenWorkItem({ source: "manual", status: "completed" })).toBe(false);
    expect(isOpenWorkItem({ source: "manual", status: "pending", dismissed_at: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(board.creates_session).toBe(false);
    expect(board.entry).toBe("memory");
  });

  it("acknowledge writes memory without creating a session", async () => {
    const before = (await getConn().query("SELECT COUNT(*) AS c FROM sessions",[])).rows[0] as { c: number };
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
    const after = (await getConn().query("SELECT COUNT(*) AS c FROM sessions",[])).rows[0] as { c: number };
    expect(after.c).toBe(before.c);
    const reread = await request("GET", `/api/tasks/tsk_home_laozhang_quote`);
    expect(reread.status).toBe(200);
    expect(reread.body.acknowledged_at).toBeTruthy();
    expect(reread.body.last_acted_at).toBeTruthy();
  });

  it("GET board / tasks / following never insert sessions", async () => {
    const before = (await getConn().query("SELECT COUNT(*) AS c FROM sessions",[])).rows[0] as { c: number };
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
    const after = (await getConn().query("SELECT COUNT(*) AS c FROM sessions",[])).rows[0] as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("adopt-recommendation is idempotent and writes a formal WorkItem", async () => {
    const boardBefore = (await buildHomeBoard()) as Json;
    const recommendations = (boardBefore.workbench as Json).recommendations as Json[];
    const recommendation = recommendations.find((row) => String(row.id).startsWith("rec-ai-"));
    expect(recommendation).toBeTruthy();
    const payload = {
      recommendation_id: String(recommendation?.id),
      title: String(recommendation?.title),
      handle: String(recommendation?.handle || ""),
      intent: String(recommendation?.intent || ""),
      reason: String(recommendation?.reason || ""),
    };
    const first = await request("POST", "/api/tasks/adopt-recommendation", {
      ...payload,
    });
    expect([200, 201]).toContain(first.status);
    expect(first.body.candidate).toBe(false);
    expect(first.body.promoted_at).toBeTruthy();
    const id = String(first.body.id);
    const second = await request("POST", "/api/tasks/adopt-recommendation", {
      ...payload,
    });
    expect(second.status).toBe(200);
    expect(String(second.body.id)).toBe(id);
    expect(second.body.reused).toBe(true);
    const board = (await buildHomeBoard()) as Json;
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
    const board = (await buildHomeBoard()) as Json;
    const todo = ((board.workbench as Json).todo as Json[]).find((row) => row.id === "tsk_home_xiaomei_lost");
    expect(todo?.title).toBe("给@小美妆日记 写合作邮件");
    expect(todo?.candidate).toBe(false);
  });

  it("persists promote columns on tickets", async () => {
    const cols = (await getConn().query<{ name: string }>("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1", ["tickets"])).rows;
    expect(cols.map((col) => col.name)).toEqual(expect.arrayContaining([
      "promoted_at",
      "dismissed_at",
      "last_acted_at",
      "acknowledged_at",
    ]));
  });
});
