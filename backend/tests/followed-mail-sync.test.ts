import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { ensureFollowedMailSync, resetFollowedMailSync, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;
const calls: string[] = [];

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

function bindLarry(): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("usr_sriphy", "sriphy", "鄢棽", "x", JSON.stringify(["employee", "admin"]), "[]", "", 1, now, now);
  getConn().prepare(
    `INSERT INTO user_starry_bindings (user_id, mailbox_email, is_default, mailbox_id, owner_name, bearer_token, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, mailbox_email) DO UPDATE SET mailbox_id=excluded.mailbox_id, owner_name=excluded.owner_name, status=excluded.status, updated_at=excluded.updated_at`,
  ).run("usr_sriphy", "larry.zhao@amperetime.com", 1, "mbx_larry", "赵良玉", "", "connected", now);
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-sync-"));
  process.env.LINGONG_DB = path.join(tmp, "mail.db");
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
        return {
          data: {
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
              { id: "mid-3901-1", direction: "outbound", body: "Hello", unread: false },
              { id: "mid-3901-2", direction: "inbound", body: "Can we start next week?", unread: true },
              { id: "mid-3901-3", direction: "inbound", body: "Please share the rate.", unread: true },
            ],
          },
        };
      }
      return { data: {} };
    },
    async close() { /* noop */ },
  }));
  resetConn();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
  getConn().prepare("UPDATE collaborations SET kol_uid=?, email=? WHERE id='col_xiaomei'")
    .run("KOL51DA646D8D8A4544BB93", "xiaomei.beauty@example.com");
});

afterEach(() => {
  setStarryKolClientFactory();
  resetFollowedMailSync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("followed KOL unread mail sync", () => {
  it("uses local mail memory and skips unchanged remote conversation details", async () => {
    bindLarry();
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          return { data: { list: [{
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
      async close() { /* noop */ },
    }));

    await ensureFollowedMailSync(true);
    expect(calls.filter((name) => name === "getEmailConversation")).toHaveLength(1);
    expect(getConn().prepare("SELECT conversation_id,mailbox,last_at FROM kol_mail_threads WHERE conversation_id='4901'").get()).toBeTruthy();
    calls.length = 0;
    await ensureFollowedMailSync(true);
    expect(calls).toContain("pageEmailConversations");
    expect(calls.filter((name) => name === "getEmailConversation")).toHaveLength(0);
  });

  it("drops conversations belonging to another mailbox", async () => {
    bindLarry();
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
      async close() { /* noop */ },
    }));

    await ensureFollowedMailSync(true);
    expect(getConn().prepare("SELECT 1 FROM kol_mail_threads WHERE conversation_id='5901'").get()).toBeUndefined();
    expect(calls).not.toContain("getEmailConversation");
  });

  it("keeps brand-mailbox and external conversations, drops same-domain coworker mailboxes", async () => {
    bindLarry();
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
      async close() { /* noop */ },
    }));

    await ensureFollowedMailSync(true);
    await waitForBackgroundSync();
    expect(getConn().prepare("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6001'").get()).toBeUndefined();
    expect(getConn().prepare("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6002'").get()).toBeTruthy();
    expect(getConn().prepare("SELECT 1 FROM kol_mail_threads WHERE conversation_id='6003'").get()).toBeTruthy();
  });

  it("collects Starry inbound threads on home refresh and shows unread by thread id", async () => {
    const first = await request("GET", "/api/home/board?refresh=1");
    expect(first.status).toBe(200);
    await ensureFollowedMailSync(false);
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

  it("legacy login kicks a followed-mail collect and session sync uses thread identity", async () => {
    const { DEMO_ADMIN } = await import("../src/config.js");
    calls.length = 0;
    const login = await request("POST", "/api/login", { username: DEMO_ADMIN.handle, password: DEMO_ADMIN.password });
    expect(login.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toContain("pageEmailConversations");

    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    expect(opened.status).toBe(200);
    await expect.poll(() => Number((
      getConn().prepare(
        "SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE collaboration_id='col_xiaomei'",
      ).get() as { n: number }
    ).n)).toBe(0);
  });

  it("matches inbound by handle suffix and keeps the conversation body", async () => {
    getConn().prepare("UPDATE collaborations SET handle=?, email=?, kol_uid=? WHERE id='col_xiaomei'")
      .run("灵工连通测试-qiyou1984", "", "KOLQIYOU1984");
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
      async close() { /* noop */ },
    }));
    const first = await request("GET", "/api/home/board?refresh=1");
    expect(first.status).toBe(200);
    await ensureFollowedMailSync(false);
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
