import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER } from "../src/config.js";
import { postgresDb, nowIso, resetDatabase } from "../src/postgres/access.js";
import { seedAll } from "../src/seed.js";
import { classifyTicket, ensureTicketForWorkItem, reconcileTickets, resetTicketTypesCache, ticketStatusFromWorkItem, } from "../src/tickets.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { ensureFollowedMailSync, resetFollowedMailSync, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import type { Json, Row } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
const CLASSIFIED_FLAG = "tickets_classified_v1";
let tmp: string;
let app: Hono;
let databaseUrl: string | undefined;
async function request(method: string, url: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined)
    init.body = JSON.stringify(body);
  const response = await app.request(url, init);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
}

beforeEach(async () => {
  databaseUrl = process.env.DATABASE_URL;
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-tickets-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  process.env.NODE_ENV = "test";
  resetTicketTypesCache();
  (await resetDatabase());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
});
afterEach(async () => {
  setStarryKolClientFactory();
  resetFollowedMailSync();
  resetTicketTypesCache();
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
  if (databaseUrl === undefined)
    delete process.env.DATABASE_URL;
  else
    process.env.DATABASE_URL = databaseUrl;
});
async function insertTicket(id: string, overrides: Partial<Record<string, string>> = {}): Promise<void> {
  const now = nowIso();
  (await postgresDb().execute(`INSERT INTO tickets
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,collaboration_id,input,entities,data_version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, id, overrides.owner_user_id || DEMO_USER.id, overrides.task_type || "risk_scan", overrides.title || "测试工单", overrides.source || "manual", overrides.status || "pending", overrides.priority || "normal", overrides.task_type || "risk_scan", overrides.profile || "lead", overrides.collaboration_id || null, "{}", "{}", 1, now, now));
}
async function ticketRow(id: string): Promise<Row | undefined> {
  return (await postgresDb().one("SELECT * FROM tickets WHERE id=$1", id)) as Row | undefined;
}
describe("ticket taxonomy", () => {
  it("classifies kinds and channels from the ticket-types catalog", () => {
    expect(classifyTicket({ task_type: "email_compose", source: "manual" })).toEqual({ kind: "service", channel: "email" });
    expect(classifyTicket({ task_type: "email_compose", source: "ai" })).toEqual({ kind: "service", channel: "email" });
    expect(classifyTicket({ task_type: "risk_scan", source: "schedule" })).toEqual({ kind: "risk", channel: "system" });
    expect(classifyTicket({ task_type: "today_plan", source: "planning" })).toEqual({ kind: "planning", channel: "system" });
    expect(classifyTicket({ task_type: "creator_discovery", source: "discovery" })).toEqual({ kind: "crawl", channel: "system" });
    expect(classifyTicket({ task_type: "stage_sop", source: "manual" })).toEqual({ kind: "follow_up", channel: "human" });
    expect(classifyTicket({ task_type: "not_a_skill", source: "manual" })).toEqual({ kind: "general", channel: "human" });
  });

  it("derives the display ticket status from the single tickets.status column", () => {
    expect(ticketStatusFromWorkItem("pending")).toBe("open");
    expect(ticketStatusFromWorkItem("needs_clarification")).toBe("open");
    expect(ticketStatusFromWorkItem("running")).toBe("in_progress");
    expect(ticketStatusFromWorkItem("waiting")).toBe("waiting");
    expect(ticketStatusFromWorkItem("waiting_approval")).toBe("waiting");
    expect(ticketStatusFromWorkItem("completed")).toBe("done");
    expect(ticketStatusFromWorkItem("failed")).toBe("failed");
    expect(ticketStatusFromWorkItem("stopped")).toBe("cancelled");
    expect(ticketStatusFromWorkItem("unknown_status")).toBeNull();
  });
});
describe("ticket rows", () => {
  it("classifies a ticket row in place (kind/channel/requester) and is idempotent", async () => {
    (await insertTicket("tsk_tickets_1", { task_type: "email_compose", source: "manual" }));
    (await ensureTicketForWorkItem("tsk_tickets_1"));
    const row = (await ticketRow("tsk_tickets_1"))!;
    expect(String(row.kind)).toBe("service");
    expect(String(row.channel)).toBe("email");
    expect(String(row.requester_type)).toBe("human");
    expect(String(row.requester_id)).toBe(DEMO_USER.id);
    expect(Number(row.kind_version)).toBeGreaterThanOrEqual(1);
    (await ensureTicketForWorkItem("tsk_tickets_1"));
    expect(String((await ticketRow("tsk_tickets_1"))!.kind)).toBe("service");
    expect(Number(((await postgresDb().one("SELECT COUNT(*) AS n FROM tickets WHERE id=$1", "tsk_tickets_1")) as {
      n: number;
    }).n)).toBe(1);
  });
  it("records collaboration object refs and system requesters", async () => {
    (await insertTicket("tsk_tickets_2", { task_type: "risk_scan", source: "schedule", collaboration_id: "col_x" }));
    (await ensureTicketForWorkItem("tsk_tickets_2"));
    const row = (await ticketRow("tsk_tickets_2"))!;
    expect(String(row.kind)).toBe("risk");
    expect(String(row.channel)).toBe("system");
    expect(String(row.requester_type)).toBe("system");
    expect(row.requester_id).toBeNull();
    expect(String(row.object_type)).toBe("collaboration");
    expect(String(row.object_id)).toBe("col_x");
  });
  it("backfills historical rows once and can be forced", async () => {
    (await insertTicket("tsk_hist_1", { task_type: "risk_scan" }));
    (await insertTicket("tsk_hist_2", { task_type: "email_compose" }));
    // 模拟历史库：清掉已跑标记，对账应重新扫一遍并补齐分类。
    (await postgresDb().execute("DELETE FROM app_state WHERE key=$1", CLASSIFIED_FLAG));
    const first = (await reconcileTickets());
    expect(first.classified).toBeGreaterThanOrEqual(2);
    expect(String((await ticketRow("tsk_hist_1"))!.kind)).toBe("risk");
    expect(String((await ticketRow("tsk_hist_2"))!.kind)).toBe("service");
    expect((await reconcileTickets()).classified).toBe(0);
    expect((await reconcileTickets({ force: true })).classified).toBeGreaterThanOrEqual(2);
  });
  it("exposes ticket fields on the tasks API from the same row", async () => {
    const created = await request("POST", "/api/tasks", { task_type: "risk_scan", title: "风险扫描工单" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const taskId = String(created.body.id);
    expect(created.body.ticket_id).toBe(taskId);
    expect(created.body.ticket_kind).toBe("risk");
    expect(created.body.ticket_channel).toBe("human");
    const detail = await request("GET", `/api/tasks/${taskId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.ticket_kind).toBe("risk");
    expect(detail.body.ticket_status).toBe("open");
    const list = await request("GET", "/api/tasks?view=open");
    expect(list.status).toBe(200);
    const found = (list.body.tasks as Json[]).find((task) => task.id === taskId) as Json | undefined;
    expect(found?.ticket_kind).toBe("risk");
  });
});
describe("email.received wiring", () => {
  async function bindLarry(): Promise<void> {
    const now = nowIso();
    (await postgresDb().execute(`INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, DEMO_USER.id, DEMO_USER.handle, DEMO_USER.name, "x", JSON.stringify(["employee", "admin"]), "[]", "", 1, now, now));
    (await postgresDb().execute(`INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, mailbox_id, owner_name, bearer_token, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(user_id, mailbox_email) DO UPDATE SET mailbox_id=excluded.mailbox_id, owner_name=excluded.owner_name, status=excluded.status, updated_at=excluded.updated_at`, DEMO_USER.id, "larry.zhao@amperetime.com", 1, "mbx_larry", "赵良玉", "", "connected", now));
  }
  it("records inbound mail arrival as an idempotent business event", async () => {
    await freshTestDatabase();
    (await resetDatabase());
    (await seedAll());
    (await bindLarry());
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        if (name === "pageEmailConversations") {
          return { data: { list: [{
            id: 6901,
            conversationId: 6901,
            subject: "Re: events wiring",
            mailboxEmail: String(args.mailboxEmail || ""),
            unreadCount: 2,
            lastMessageId: "mid-6901-2",
          }] } };
        }
        if (name === "getEmailConversation") {
          return { data: { id: 6901, subject: "Re: events wiring", messages: [
              { id: "mid-6901-1", sentAt: "2026-10-01T01:00:00Z", direction: "outbound", body: "Hello", unread: false },
              { id: "mid-6901-2", sentAt: "2026-10-01T02:00:00Z", direction: "inbound", from: "creator@example.com", body: "Can we start?", unread: true },
          ] } };
        }
        return { data: {} };
      },
      async close() { },
    }));
    await ensureFollowedMailSync(true);
    // 前台同步只承诺已持久化会话索引；正文（及 email.received 事件）在
    // 受控后台水合中完成。测试必须显式 join，而非把索引回执伪作终态。
    await waitForBackgroundSync();
    const events = (await postgresDb().many("SELECT event_type,object_type,object_id,idempotency_key,actor_type,occurred_at,received_at FROM business_events WHERE event_type='email.received'")) as Row[];
    expect(events).toHaveLength(1);
    expect(String(events[0].object_type)).toBe("email");
    expect(String(events[0].idempotency_key)).toMatch(/^email\.received:[a-f0-9]{64}:[a-f0-9]{64}$/);
    await ensureFollowedMailSync(true);
    expect((await postgresDb().many("SELECT id FROM business_events WHERE event_type='email.received'"))).toHaveLength(1);
    expect(String(events[0].actor_type)).toBe("external");
    const response = await request("GET", "/api/events?event_type=email.received");
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((response.body.events as Json[]).length).toBe(1);
  });
});
describe("PostgreSQL ticket schema", () => {
  it("uses tickets as the sole authoritative work-item relation", async () => {
    const relations = (await postgresDb().one("SELECT to_regclass('public.tickets') AS tickets, to_regclass('public.work_items') AS work_items")) as {
      tickets: string | null;
      work_items: string | null;
    };
    expect(relations.tickets).toBe("tickets");
    expect(relations.work_items).toBeNull();
    await insertTicket("tsk_native_ticket", { task_type: "email_compose", source: "manual" });
    await reconcileTickets({ force: true });
    const classified = (await ticketRow("tsk_native_ticket"))!;
    expect(String(classified.kind)).toBe("service");
    expect(String(classified.channel)).toBe("email");
  });
});
