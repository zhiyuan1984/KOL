import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { mailPreview } from "../src/host/mail-preview.js";
import { letterSummaryRecord } from "../src/host/mail-summary.js";
import { matchesFollowedMailbox, saveStarryBinding } from "../src/host/starry-bind.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { matchCollaboration } from "../src/starrykol/mail-fields.js";
import { ensureFollowedMailSync, resetFollowedMailSync, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { bindStarryUser } from "./helpers/starry-binding.js";
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

function unreadOf(mailbox: string): number {
  return Number((getConn().prepare("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE mailbox=?").get(mailbox) as { n: number }).n);
}

function bindLarry(): void {
  bindStarryUser();
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
        const pageNo = Number(args.pageNo ?? 1);
        if (pageNo > 1) {
          return { data: { pageNo, pageSize: 50, total: 1 + extraConversations.length, list: [] } };
        }
        return {
          data: {
            pageNo,
            pageSize: 50,
            total: 1 + extraConversations.length,
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
    await waitForBackgroundSync();
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

  it("gzip-compresses the mailbox conversation list for slow links", async () => {
    bindLarry();
    const response = await app.request("/api/mail/conversations", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(response.status).toBe(200);
    expect(String(response.headers.get("content-encoding") || "")).toContain("gzip");
  });

  it("mutexes sync per user+mailbox and writes cursor fields on the binding", async () => {
    bindLarry();
    listDelayMs = 40;
    const [first, second] = await Promise.all([
      request("POST", "/api/mail/sync"),
      request("POST", "/api/mail/sync"),
    ]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await waitForBackgroundSync();
    // total=1 with a single partial page: the background loop must not fetch page 2 (spec §3 stop conditions).
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(1);
    const bind = getConn().prepare("SELECT * FROM user_starry_bindings").get() as Json;
    expect(bind.synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(bind.sync_cursor_at || "")).toBeTruthy();
    expect(String(bind.last_tool)).toBe("pageEmailConversations");
    expect(String(bind.last_error || "")).toBe("");
    expect(first.body).toMatchObject({ accepted: true, entry: "command" });
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

  it("exposes bindings/total_unread, starred toggle, mark-read, and translation fields", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);

    const box = await request("GET", "/api/mail/box");
    expect(box.status).toBe(200);
    const bindings = box.body.bindings as Json[];
    expect(Array.isArray(bindings)).toBe(true);
    expect(bindings[0]).toMatchObject({ mailbox: "larry.zhao@amperetime.com", bound: true });
    expect(typeof box.body.total_unread).toBe("number");
    expect(Number(box.body.total_unread)).toBeGreaterThan(0);

    const listed = await request("GET", "/api/mail/conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(thread?.starred).toBe(false);

    const starred = await request("PUT", `/api/mail/conversations/${thread?.id}`, { starred: true });
    expect(starred.status).toBe(200);
    expect((starred.body.conversation as Json).starred).toBe(true);
    const listedAgain = await request("GET", "/api/mail/conversations");
    expect((listedAgain.body.conversations as Json[]).find((row) => row.conversation_id === "3901")?.starred).toBe(true);

    const opened = await request("GET", `/api/mail/conversations/${thread?.id}`);
    const firstMessage = (opened.body.messages as Json[])[0];
    expect(firstMessage).toHaveProperty("translation_zh");
    expect(firstMessage).toHaveProperty("translation_source");
    expect(firstMessage?.translation_zh).toBeNull();
    expect(firstMessage?.translation_source).toBe("pending");

    const read = await request("POST", `/api/mail/conversations/${thread?.id}/read`);
    expect(read.status).toBe(200);
    expect((read.body.conversation as Json).unread_count).toBe(0);
    const remaining = getConn().prepare(
      "SELECT COUNT(*) AS n FROM kol_mail_items WHERE thread_id=? AND unread=1",
    ).get(String(thread?.id)) as { n: number };
    expect(remaining.n).toBe(0);

    const missing = await request("POST", "/api/mail/conversations/conv_missing/read");
    expect(missing.status).toBe(404);
  });

  it("serves ?box= per mailbox: bindings stay per-mailbox and unknown boxes fall back to the default", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    saveStarryBinding("usr_sriphy", { mailbox_email: "second.box@amperetime.com", owner_name: "赵良玉" });
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO kol_mail_threads (id, conversation_id, subject, mailbox, unread_count, last_at, created_at, updated_at)
       VALUES ('thr_second', '9901', 'Second box mail', 'second.box@amperetime.com', 3, ?, ?, ?)`,
    ).run(now, now, now);

    const second = await request("GET", `/api/mail/box?box=${encodeURIComponent("second.box@amperetime.com")}`);
    expect(second.body.mailbox).toBe("second.box@amperetime.com");
    expect(Number(second.body.unread)).toBe(3);
    const bindings = second.body.bindings as Json[];
    expect(bindings.map((row) => row.mailbox)).toEqual(["larry.zhao@amperetime.com", "second.box@amperetime.com"]);
    expect(bindings.every((row) => Number(row.unread) === unreadOf(String(row.mailbox)))).toBe(true);
    expect(Number(second.body.total_unread)).toBe(
      (bindings as Array<{ unread: number }>).reduce((sum, row) => sum + Number(row.unread), 0),
    );

    const listed = await request("GET", `/api/mail/conversations?box=${encodeURIComponent("second.box@amperetime.com")}`);
    expect((listed.body.conversations as Json[]).map((row) => row.conversation_id)).toEqual(["9901"]);

    const fallback = await request("GET", "/api/mail/box?box=unknown@example.com");
    expect(fallback.body.mailbox).toBe("larry.zhao@amperetime.com");
  });

  it("registers the four mailbox-memory entries without changing confirm-send", () => {
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
    expect(byId["mail-compose-catalog"]).toMatchObject({
      kind: "memory",
      action: "通讯邮件任务目录",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
      route: "GET /api/mail/compose-catalog",
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

  it("indexes kol_mail_items by thread and counts mail without a per-thread subquery", async () => {
    bindLarry();
    const now = "2026-09-20T03:00:00.000Z";
    const index = getConn()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='kol_mail_items_thread'")
      .get() as { name?: string } | undefined;
    expect(index?.name).toBe("kol_mail_items_thread");

    getConn().prepare(
      `INSERT INTO kol_mail_threads
         (id, conversation_id, subject, mailbox, unread_count, last_at, created_at, updated_at, digest_text, digest_source)
       VALUES ('thr_two', '9101', 'Two mails', ?, 0, ?, ?, ?, '两封往来摘要', 'body_analysis'),
              ('thr_one', '9102', 'One mail', ?, 0, ?, ?, ?, '', '')`,
    ).run(
      "larry.zhao@amperetime.com", now, now, now,
      "larry.zhao@amperetime.com", now, now, now,
    );
    const item = getConn().prepare(
      `INSERT INTO kol_mail_items
         (id, thread_id, conversation_id, provider_message_id, direction, subject, snippet, unread, occurred_at, created_at)
       VALUES (?, ?, ?, ?, 'inbound', 'Hello', 'Hello', 0, ?, ?)`,
    );
    item.run("mit_a1", "thr_two", "9101", "mid-9101-1", now, now);
    item.run("mit_a2", "thr_two", "9101", "mid-9101-2", now, now);
    item.run("mit_b1", "thr_one", "9102", "mid-9102-1", now, now);

    const listed = await request("GET", "/api/mail/conversations");
    const two = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "9101");
    const one = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "9102");
    expect(two?.message_count).toBe(2);
    expect(one?.message_count).toBe(1);
    // Fat digest text stays on the conversation detail, not in the list payload.
    expect(two).not.toHaveProperty("digest_text");
    expect(listed.body.conversations as Json[]).not.toContainEqual(expect.objectContaining({ digest_text: expect.anything() }));

    const opened = await request("GET", `/api/mail/conversations/${two?.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.digest_text).toBe("两封往来摘要");
  });

  it("returns kol_uid/handle on the conversation list so the page needs no board fetch", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const listed = await request("GET", "/api/mail/conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(thread).toMatchObject({
      collaboration_id: "col_xiaomei",
      kol_uid: "KOL51DA646D8D8A4544BB93",
      handle: "小美妆日记",
    });
  });

  it("serves the compose catalog from the email_compose contract with no session and no model", async () => {
    const { emailComposeContract } = await import("../src/skills/email-compose-contract.js");
    const sessionsBefore = sessionCount();
    const response = await app.request("/api/mail/compose-catalog");
    expect(response.status).toBe(200);
    expect(String(response.headers.get("cache-control") || "")).toBe("no-store");
    const body = await response.json() as Json;
    expect(body).toMatchObject({
      entry: "memory",
      kind: "memory",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
    });
    const letters = body.letters as Json[];
    expect(letters).toHaveLength(15);
    // Order and copy come from the skill contract — the host never re-invents labels.
    expect(letters.map((row) => row.stage)).toEqual(Object.keys(emailComposeContract().letters));
    expect(letters[0]).toEqual({
      stage: "INITIAL_CONTACT",
      chip: "写合作邮件",
      prompt: "写合作邮件",
      template_id: "kol.first_touch",
      kind: "first_touch",
    });
    for (const letter of letters) {
      expect(Object.keys(letter).sort()).toEqual(["chip", "kind", "prompt", "stage", "template_id"]);
    }
    expect(calls).toEqual([]);
    expect(sessionCount()).toBe(sessionsBefore);
  });
});
