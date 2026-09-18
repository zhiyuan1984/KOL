import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { mailPreview } from "../src/host/mail-preview.js";
import { letterSummaryRecord } from "../src/host/mail-summary.js";
import { matchesFollowedMailbox } from "../src/host/starry-bind.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { matchCollaboration } from "../src/starrykol/mail-fields.js";
import { ensureFollowedMailSync, resetFollowedMailSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;
const calls: string[] = [];
let listDelayMs = 0;

async function request(method: string, url: string, body?: unknown) {
  const response = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Json : {} };
}

function sessionCount(): number {
  return Number((getConn().prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n);
}

function bindLarry(): void {
  const now = new Date().toISOString();
  getConn().prepare(
    `INSERT OR IGNORE INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("usr_sriphy", "sriphy", "鄢棽", "x", JSON.stringify(["employee", "admin"]), "[]", "", 1, now, now);
  getConn().prepare(
    `INSERT INTO user_starry_bindings (user_id, mailbox_email, mailbox_id, owner_name, bearer_token, status, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET mailbox_email=excluded.mailbox_email, status=excluded.status, updated_at=excluded.updated_at`,
  ).run("usr_sriphy", "larry.zhao@amperetime.com", "mbx_larry", "赵良玉", "", "connected", now);
}

function stubStarry(extraConversations: Json[] = []): void {
  setStarryKolClientFactory(() => ({
    async callTool(name: string, args: Json = {}) {
      calls.push(name);
      if (listDelayMs && name === "pageEmailConversations") {
        await new Promise((resolve) => setTimeout(resolve, listDelayMs));
      }
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
              mailboxEmail: String(args.mailboxEmail || "larry.zhao@amperetime.com"),
              unreadCount: 2,
              direction: "inbound",
              snippet: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
              lastMessageId: "mid-3901-2",
            }, ...extraConversations],
          },
        };
      }
      if (name === "getEmailConversation") {
        const id = String(args.conversationId || args.id || "3901");
        if (id === "8801") {
          return {
            data: {
              id: 8801,
              conversationId: 8801,
              subject: "Unknown brand pitch",
              messages: [{
                id: "mid-8801-1",
                direction: "inbound",
                from: "stranger@example.net",
                fromName: "Stranger",
                body: "Hello, can we work together next month?",
                unread: true,
              }],
            },
          };
        }
        return {
          data: {
            id: 3901,
            conversationId: 3901,
            subject: "Re: LiTime MCP 连通测试",
            messages: [
              { id: "mid-3901-1", direction: "outbound", body: "Hello", unread: false, from: "larry.zhao@amperetime.com" },
              {
                id: "mid-3901-2",
                direction: "inbound",
                body: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
                unread: true,
                from: "xiaomei.beauty@example.com",
              },
              { id: "mid-3901-3", direction: "inbound", body: "Please share the rate.", unread: true, from: "xiaomei.beauty@example.com" },
            ],
          },
        };
      }
      return { data: {} };
    },
    async close() { /* noop */ },
  }));
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-memory-"));
  process.env.LINGONG_DB = path.join(tmp, "mail.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  calls.length = 0;
  listDelayMs = 0;
  resetFollowedMailSync();
  stubStarry();
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

describe("mailbox memory P0", () => {
  it("GET box / conversations / thread create no session and call no model", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const starryBefore = calls.filter((name) => name === "pageEmailConversations" || name === "getEmailConversation").length;
    const sessionsBefore = sessionCount();
    calls.length = 0;

    const box = await request("GET", "/api/mail/box");
    const listed = await request("GET", "/api/mail/conversations");
    const first = (listed.body.conversations as Json[])[0];
    const opened = await request("GET", `/api/mail/conversations/${first.id}`);

    expect(box.status).toBe(200);
    expect(listed.status).toBe(200);
    expect(opened.status).toBe(200);
    expect(box.body).toMatchObject({ entry: "memory", creates_session: false, calls_model: false });
    expect(listed.body).toMatchObject({ entry: "memory", creates_session: false, calls_model: false });
    expect(opened.body).toMatchObject({ entry: "memory", creates_session: false, calls_model: false });
    expect(sessionCount()).toBe(sessionsBefore);
    expect(calls).toEqual([]);
    expect(starryBefore).toBeGreaterThan(0);
    expect(String(opened.body.digest_source || (opened.body.conversation as Json).digest_source)).not.toBe("codex_memory");
  });

  it("lists unbound conversations with match_state=unbound and does not create a Collaboration", async () => {
    stubStarry([{
      id: 8801,
      conversationId: 8801,
      subject: "Unknown brand pitch",
      recipientEmail: "stranger@example.net",
      mailboxEmail: "larry.zhao@amperetime.com",
      unreadCount: 1,
      direction: "inbound",
      snippet: "Hello, can we work together next month?",
    }]);
    bindLarry();
    const collabsBefore = Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number }).n);
    await request("POST", "/api/mail/sync");
    const listed = await request("GET", "/api/mail/conversations");
    const unbound = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "8801");
    expect(unbound).toMatchObject({
      match_state: "unbound",
      conversation_id: "8801",
      mailbox: "larry.zhao@amperetime.com",
    });
    expect(unbound?.collaboration_id == null || unbound?.collaboration_id === "").toBe(true);
    expect(Number((getConn().prepare("SELECT COUNT(*) AS n FROM collaborations").get() as { n: number }).n)).toBe(collabsBefore);
  });

  it("mutexes sync per user+mailbox and writes cursor fields on the binding", async () => {
    bindLarry();
    listDelayMs = 40;
    const [first, second] = await Promise.all([
      request("POST", "/api/mail/sync"),
      request("POST", "/api/mail/sync"),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(1);
    const bind = getConn().prepare("SELECT * FROM user_starry_bindings").get() as Json;
    expect(bind.synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(bind.sync_cursor_at || "")).toBeTruthy();
    expect(String(bind.last_tool)).toBe("pageEmailConversations");
    expect(String(bind.last_error || "")).toBe("");
    expect(first.body).toMatchObject({ ok: true, mailbox: "larry.zhao@amperetime.com", entry: "command" });
  });

  it("finds threads when collaboration mailbox_from ≠ bound mailbox but peer/binding matches", async () => {
    bindLarry();
    getConn().prepare("UPDATE collaborations SET mailbox_from=?, owner_mailbox=? WHERE id='col_xiaomei'")
      .run("kol.lt@litime.example", "");
    expect(matchesFollowedMailbox({
      mailbox_from: "kol.lt@litime.example",
      owner_mailbox: "",
    }, { mailbox_email: "larry.zhao@amperetime.com", owner_name: "赵良玉" })).toBe(true);
    expect(matchCollaboration(
      {
        from: "xiaomei.beauty@example.com",
        recipientEmail: "larry.zhao@amperetime.com",
        mailboxEmail: "larry.zhao@amperetime.com",
        kolUid: "KOL51DA646D8D8A4544BB93",
      },
      [{
        id: "col_xiaomei",
        kol_uid: "KOL51DA646D8D8A4544BB93",
        email: "xiaomei.beauty@example.com",
        mailbox_from: "kol.lt@litime.example",
      }],
      "larry.zhao@amperetime.com",
    )?.id).toBe("col_xiaomei");

    await ensureFollowedMailSync(true);
    const listed = await request("GET", "/api/mail/conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(thread).toMatchObject({
      mailbox: "larry.zhao@amperetime.com",
      collaboration_id: "col_xiaomei",
      match_state: "matched",
    });
    const board = await request("GET", "/api/home/board");
    expect(board.body.mail).toMatchObject({ ok: true, tool: "pageEmailConversations" });
    expect(Number((board.body.mail as Json).unread)).toBeGreaterThan(0);
    const xiaomei = (board.body.kols as Json[]).find((row) => row.id === "col_xiaomei");
    expect((xiaomei?.mail_threads as Json[])?.[0]).toMatchObject({ conversation_id: "3901" });
  });

  it("writes rule preview without a model and labels digest_source honestly", async () => {
    expect(mailPreview("From: a@b.com\nTo: b@c.com")).toBe("");
    const preview = mailPreview("这是一封测试邮件，请查收，我现在想和贵品牌litime合作 Thank you");
    expect(preview).toMatch(/想和贵品牌litime合作/);
    expect(preview.length).toBeLessThanOrEqual(89);
    const letter = letterSummaryRecord({
      direction: "inbound",
      body: "Hi, I would love to collaborate with your brand.",
    });
    expect(letter.summary_source).toBe("body_analysis");
    expect(letter.summary).toMatch(/有兴趣|合作意愿/);

    bindLarry();
    await ensureFollowedMailSync(true);
    const listed = await request("GET", "/api/mail/conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(String(thread?.last_preview)).toMatch(/Please share the rate|想和贵品牌litime合作|测试邮件/);
    expect(String(thread?.last_preview).length).toBeLessThanOrEqual(89);
    expect(String(thread?.digest_source)).toBe("body_analysis");
    expect(["codex_memory", "luna"]).not.toContain(thread?.digest_source);

    const opened = await request("GET", `/api/mail/conversations/${thread?.id}`);
    const inbound = (opened.body.messages as Json[]).find((row) => row.direction === "inbound");
    expect(inbound?.summary_source).toBe("body_analysis");
    expect(inbound?.letter_summary).toBeTruthy();
  });

  it("keeps provider_message_id inserts idempotent", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const first = Number((getConn().prepare("SELECT COUNT(*) AS n FROM kol_mail_items").get() as { n: number }).n);
    await ensureFollowedMailSync(true);
    const second = Number((getConn().prepare("SELECT COUNT(*) AS n FROM kol_mail_items").get() as { n: number }).n);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
    const dupes = getConn().prepare(
      `SELECT provider_message_id, COUNT(*) AS n FROM kol_mail_items
       WHERE provider_message_id IS NOT NULL AND provider_message_id != ''
       GROUP BY provider_message_id HAVING COUNT(*) > 1`,
    ).all();
    expect(dupes).toEqual([]);
  });

  it("registers the three mailbox-memory entries without changing confirm-send", () => {
    const byId = Object.fromEntries(HOME_ENTRY_REGISTRY.map((row) => [row.id, row]));
    expect(byId["list-mailbox-mail"]).toMatchObject({
      kind: "memory",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/mail/conversations"),
    });
    expect(byId["open-mail-thread"]).toMatchObject({
      kind: "memory",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/mail/conversations/:id"),
    });
    expect(byId["sync-mailbox-mail"]).toMatchObject({
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/mail/sync"),
    });
    expect(byId["confirm-send"]).toMatchObject({
      kind: "command",
      action: "确认发送",
      route: "既有 L3 发信确认（本页不新开发送闸门）",
    });
  });
});
