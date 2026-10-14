import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import { hashPassword, mapUser, withScopedUser } from "../src/auth.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { ensureFollowedMailSync, followedMailStatus, resetFollowedMailSync, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { persistStarryOwnership } from "../src/postgres/kol-source-authority.js";
import { seedPublishedAgent, seedRuntimeTestActor } from "./fixtures/runtime-auth.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp: string;
let app: Hono;
const calls: string[] = [];
const MAIL_ACTOR_ID = "usr_runtime_fixture";
async function request(method: string, url: string, body?: unknown) {
  const actor = (await postgresDb().one("SELECT * FROM users WHERE id=$1", MAIL_ACTOR_ID)) as Json | undefined;
  const invoke = () => app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
  });
  const response = actor ? await withScopedUser((await mapUser(actor)), invoke) : await invoke();
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}
async function withMailActor<T>(operation: () => Promise<T>): Promise<T> {
  const actor = (await postgresDb().one("SELECT * FROM users WHERE id=$1", MAIL_ACTOR_ID)) as Json | undefined;
  if (!actor)
    throw new Error("mail runtime fixture actor missing");
  return await withScopedUser((await mapUser(actor)), operation);
}
async function syncLarryMailbox(force = true) {
  return await withMailActor(() => ensureFollowedMailSync(force, "larry.zhao@amperetime.com"));
}
async function larryMailboxStatus() {
  return await withMailActor(() => followedMailStatus("larry.zhao@amperetime.com"));
}
async function bindLarry(): Promise<void> {
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "a".repeat(64);
  (await saveStarryBinding(MAIL_ACTOR_ID, { mailbox_email: "larry.zhao@amperetime.com", mailbox_id: "mbx_larry", owner_name: "赵良玉", bearer: "test-only-token" }));
}
beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-sync-"));
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  calls.length = 0;
  resetFollowedMailSync();
  setStarryKolClientFactory(() => ({
    async callTool(name: string, args: Json = {}) {
      calls.push(name);
      if (name === "listAllKolProfiles" || name === "pageKolProfiles") {
        return { data: { total: 0, list: [] } };
      }
      if (name === "pageEmailConversations") {
        if (Number(args.pageNo || 1) > 1)
          return { data: { total: 1, list: [] } };
        return {
          data: {
            total: 1,
            list: [{
              id: 3901,
              conversationId: 3901,
              subject: "Re: LiTime MCP 连通测试",
              kolUid: "KOL51DA646D8D8A4544BB93",
              recipientEmail: "xiaomei.beauty@example.com",
              mailboxEmail: String(args.mailboxEmail || ""),
              unreadCount: 2,
              direction: "inbound",
              snippet: "Can we start next week?",
              lastMessageId: "mid-3901-2",
            }],
          },
        };
      }
      if (name === "getEmailConversation") {
        return {
          data: {
            id: 3901,
            conversationId: 3901,
            subject: "Re: LiTime MCP 连通测试",
            messages: [
              { id: "mid-3901-1", sentAt: "2026-10-01T01:00:00Z", direction: "outbound", body: "Hello", unread: false },
              { id: "mid-3901-2", sentAt: "2026-10-01T02:00:00Z", direction: "inbound", body: "Can we start next week?", unread: true },
              { id: "mid-3901-3", sentAt: "2026-10-01T03:00:00Z", direction: "inbound", body: "Please share the rate.", unread: true },
            ],
          },
        };
      }
      return { data: {} };
    },
    async close() { },
  }));
  (await resetDatabase());
  (await seedAll());
  const { createApp } = await import("../src/app.js");
  app = (await createApp());
  (await seedWorkbenchFixtures());
  (await postgresDb().execute("UPDATE collaborations SET kol_uid=$1, email=$2 WHERE id='col_xiaomei'", "KOL51DA646D8D8A4544BB93", "xiaomei.beauty@example.com"));
  (await seedPublishedAgent("agent:kol"));
  (await seedRuntimeTestActor(["email_conversation_list", "email_conversation_read"], true));
  await persistStarryOwnership([{
      kolUid: "KOL51DA646D8D8A4544BB93",
      ownerMailbox: "larry.zhao@amperetime.com",
    }], "company:amperetime", new Date().toISOString(), true);
});
afterEach(async () => {
  await waitForBackgroundSync();
  await closePostgresPool();
  setStarryKolClientFactory();
  resetFollowedMailSync();
  (await resetDatabase());
  fs.rmSync(tmp, { recursive: true, force: true });
});
describe("followed KOL unread mail sync", () => {
  it("rejects moving a remembered conversation to another collaboration", async () => {
    (await bindLarry());
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    (await postgresDb().execute(`INSERT INTO collaborations(id,handle,display_name,brand,email,mailbox_from,lifecycle_id,conversation_id,stage_code,kol_uid)
      SELECT 'col_other_source',handle,display_name,brand,email,mailbox_from,lifecycle_id,'other-conversation',stage_code,kol_uid
      FROM collaborations WHERE id='col_xiaomei'`));
    (await postgresDb().execute("UPDATE collaborations SET kol_uid='OTHER-UID',email='other@example.test' WHERE id='col_other_source'"));
    (await postgresDb().execute("UPDATE kol_mail_threads SET collaboration_id='col_other_source' WHERE conversation_id='3901'"));
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    const result = await larryMailboxStatus();
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("mail_conversation_association_mismatch");
    expect(result.error).toContain("关联不一致");
    expect((await postgresDb().one("SELECT collaboration_id FROM kol_mail_threads WHERE conversation_id='3901'"))).toMatchObject({ collaboration_id: "col_other_source" });
    expect((await postgresDb().one("SELECT COUNT(*) AS n FROM kol_mail_items WHERE collaboration_id='col_other_source'"))).toMatchObject({ n: 0 });
  });
  it("uses local mail memory and skips unchanged remote conversation details", async () => {
    (await bindLarry());
    setStarryKolClientFactory(() => ({
      async callTool(name: string, args: Json = {}) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          if (Number(args.pageNo || 1) > 1)
            return { data: { total: 1, list: [] } };
          return { data: { total: 1, list: [{
            id: 4901,
            conversationId: 4901,
            subject: "Incremental sync",
            mailboxEmail: "larry.zhao@amperetime.com",
            unreadCount: 0,
            lastMessageTime: "2020-09-19 10:00:00",
          }] } };
        }
        if (name === "getEmailConversation") {
          return { data: { id: 4901, subject: "Incremental sync", messages: [{
            id: "mid-4901",
            direction: "inbound",
            from: "creator@example.com",
            body: "Stored once",
            sentAt: "2020-09-19 10:00:00",
          }] } };
        }
        return { data: {} };
      },
      async close() { },
    }));
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    expect(calls.filter((name) => name === "getEmailConversation")).toHaveLength(1);
    expect((await postgresDb().one("SELECT conversation_id,mailbox,last_at FROM kol_mail_threads WHERE conversation_id='4901'"))).toBeTruthy();
    calls.length = 0;
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    expect(calls).toContain("pageEmailConversations");
    expect(calls.filter((name) => name === "getEmailConversation")).toHaveLength(0);
    // A remembered index cannot certify a missing body. Fetch the authorized
    // detail again, without creating another event for the same source version.
    (await postgresDb().execute("UPDATE kol_mail_items SET body_text=NULL WHERE provider_message_id='mid-4901'"));
    calls.length = 0;
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    expect(calls.filter((name) => name === "getEmailConversation")).toHaveLength(1);
    expect((await postgresDb().one("SELECT body_text FROM kol_mail_items WHERE provider_message_id='mid-4901'"))).toMatchObject({ body_text: "Stored once" });
  });
  it("drops conversations belonging to another mailbox", async () => {
    (await bindLarry());
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          return { data: { list: [{
            id: 5901,
            conversationId: 5901,
            subject: "Other employee",
            mailboxEmail: "henry.wei@amperetime.com",
            unreadCount: 0,
          }] } };
        }
        return { data: {} };
      },
      async close() { },
    }));
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    expect((await postgresDb().one("SELECT 1 FROM kol_mail_threads WHERE conversation_id='5901'"))).toBeUndefined();
    expect(calls).not.toContain("getEmailConversation");
  });
  it("keeps brand-mailbox and external conversations, drops same-domain coworker mailboxes", async () => {
    (await bindLarry());
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          return { data: { list: [
            {
              id: 6001,
              conversationId: 6001,
              subject: "Coworker thread",
              mailboxEmail: "henry.wei@amperetime.com",
              unreadCount: 1,
            },
            {
              id: 6002,
              conversationId: 6002,
              subject: "Brand mailbox thread",
              mailboxEmail: "brandmarketing@litime.com",
              unreadCount: 1,
            },
            {
              id: 6003,
              conversationId: 6003,
              subject: "External creator thread",
              mailboxEmail: "creator@gmail.com",
              unreadCount: 1,
            },
          ] } };
        }
        if (name === "getEmailConversation") {
          return { data: { id: 1, subject: "Detail", messages: [{
            id: "mid-detail",
            direction: "inbound",
            from: "creator@example.com",
            body: "Interested in collaboration",
            sentAt: "2020-09-19 10:00:00",
          }] } };
        }
        return { data: {} };
      },
      async close() { },
    }));
    await syncLarryMailbox(true);
    await waitForBackgroundSync();
    expect((await postgresDb().one("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6001'"))).toBeUndefined();
    expect((await postgresDb().one("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6002'"))).toBeTruthy();
    expect((await postgresDb().one("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6003'"))).toBeTruthy();
  });
  it("POST /api/jobs/mail.sync/start accepts immediately and syncs in the background", async () => {
    (await bindLarry());
    const started = Date.now();
    const response = await request("POST", "/api/jobs/mail.sync/start", { box: "larry.zhao@amperetime.com" });
    const elapsed = Date.now() - started;
    expect(response.status).toBe(202);
    expect(response.body.accepted).toBe(true);
    expect(elapsed).toBeLessThan(500);
    expect((response.body.job as Json).status).toBe("queued");
    await processExecutionJobById(String((response.body.job as Json).id));
    expect((await request("GET", `/api/jobs/${String((response.body.job as Json).id)}`)).body.job).toMatchObject({ status: "succeeded" });
    expect((await postgresDb().one("SELECT 1 FROM kol_mail_threads WHERE conversation_id='3901'"))).toBeTruthy();
  });
  it("collects Starry inbound threads on home refresh and shows unread by thread id", async () => {
    (await bindLarry());
    const first = await request("GET", "/api/home/board?refresh=1");
    expect(first.status).toBe(200);
    await syncLarryMailbox(false);
    await waitForBackgroundSync();
    const board = await request("GET", "/api/home/board");
    expect(board.status).toBe(200);
    expect(calls).toContain("pageEmailConversations");
    const kols = board.body.kols as Json[];
    const xiaomei = kols.find((row) => row.id === "col_xiaomei");
    expect(xiaomei?.unread_count).toBeGreaterThan(0);
    const threads = xiaomei?.mail_threads as Json[];
    expect(threads?.[0]).toMatchObject({
      conversation_id: "3901",
      subject: "Re: LiTime MCP 连通测试",
    });
    expect(Number(threads?.[0].unread_count)).toBeGreaterThan(0);
    expect(board.body.mail).toMatchObject({ ok: true, tool: "pageEmailConversations" });
  });
  it("native login kicks a followed-mail collect and session sync uses thread identity", async () => {
    (await bindLarry());
    await postgresDb().execute("UPDATE users SET password_hash=$1 WHERE id=$2", await hashPassword("local-mail-login"), MAIL_ACTOR_ID);
    calls.length = 0;
    process.env.AUTH_MODE = "enabled";
    try {
      const login = await request("POST", "/api/auth/login", { username: MAIL_ACTOR_ID, password: "local-mail-login" });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
    }
    finally {
      process.env.AUTH_MODE = "disabled";
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toContain("pageEmailConversations");
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(opened.status).toBe(200);
    await expect.poll(async () => Number((await postgresPool().query("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE collaboration_id='col_xiaomei'")).rows[0].n)).toBe(0);
  });
  it("matches inbound by handle suffix and keeps the conversation body", async () => {
    (await bindLarry());
    (await postgresDb().execute("UPDATE collaborations SET handle=$1, email=$2, kol_uid=$3 WHERE id='col_xiaomei'", "灵工连通测试-qiyou1984", "", "KOLQIYOU1984"));
    await persistStarryOwnership([{
        kolUid: "KOLQIYOU1984",
        ownerMailbox: "larry.zhao@amperetime.com",
      }], "company:amperetime", new Date().toISOString(), true);
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          return {
            data: {
              list: [{
                id: 320,
                conversationId: 320,
                subject: "",
                from: "黄启友 <qiyou1984@gmail.com>",
                recipientEmail: "larry.zhao@amperetime.com",
                mailboxEmail: "larry.zhao@amperetime.com",
                direction: "inbound",
                unreadCount: 1,
              }],
            },
          };
        }
        if (name === "getEmailConversation") {
          return {
            data: {
              id: 320,
              subject: "",
              messages: [{
                id: "m320",
                direction: "inbound",
                from: "黄启友 <qiyou1984@gmail.com>",
                fromName: "黄启友",
                body: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
                unread: true,
              }],
            },
          };
        }
        return { data: {} };
      },
      async close() { },
    }));
    const first = await request("GET", "/api/home/board?refresh=1");
    expect(first.status).toBe(200);
    await syncLarryMailbox(false);
    await waitForBackgroundSync();
    const board = await request("GET", "/api/home/board");
    expect(board.status).toBe(200);
    const xiaomei = (board.body.kols as Json[]).find((row) => row.id === "col_xiaomei");
    const firstThread = (xiaomei?.mail_threads as Json[] | undefined)?.[0];
    expect(firstThread).toMatchObject({
      conversation_id: "320",
      last_from: "qiyou1984@gmail.com",
      last_from_name: "黄启友",
    });
    expect(String(firstThread?.last_snippet)).toMatch(/想和贵品牌litime合作/);
  });
});
