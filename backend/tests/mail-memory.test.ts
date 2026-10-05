import { pgClaimExecutionJobById, pgCompleteExecutionJob, pgFailExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { processExecutionJobById } from "../src/execution-jobs/dispatcher.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { DEMO_USER } from "../src/config.js";
import { HOME_ENTRY_REGISTRY } from "../src/host/entry-registry.js";
import { mailPreview } from "../src/host/mail-preview.js";
import { letterSummaryRecord } from "../src/host/mail-summary.js";
import { matchesFollowedMailbox, saveStarryBinding } from "../src/host/starry-bind.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { freshTestDatabase } from "./support/pg.js";
import { matchCollaboration } from "../src/starrykol/mail-fields.js";
import { ensureFollowedMailSync, resetFollowedMailSync, waitForBackgroundSync } from "../src/starrykol/mail-sync.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { setIntentLlmFetch } from "../src/tasks/openai-intent.js";
import { bindStarryUser } from "./helpers/starry-binding.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;
const calls: string[] = [];
let listDelayMs = 0;

async function request(method: string, url: string, body?: unknown) {
  const actor = getConn().prepare("SELECT * FROM users WHERE id=?").get(DEMO_USER.id) as Json | undefined;
  const invoke = () => app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
  });
  const response = actor ? await withScopedUser(mapUser(actor), invoke) : await invoke();
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
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "a".repeat(64);
  saveStarryBinding(DEMO_USER.id, { mailbox_email: "larry.zhao@amperetime.com", bearer: "test-only-token" });
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
      if (name === "translateEmailToChinese") {
        return { zh: "【内部中文译稿】这是一封测试邮件的中文翻译。" };
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
              { id: "mid-3901-1", sentAt: "2026-10-01T01:00:00Z", title: "品牌首次联系", direction: "outbound", body: "Hello", unread: false, from: "larry.zhao@amperetime.com" },
              {
                id: "mid-3901-2",
                sentAt: "2026-10-01T02:00:00Z",
                title: "达人确认合作意向",
                direction: "inbound",
                body: "这是一封测试邮件，请查收，我现在想和贵品牌litime合作",
                unread: true,
                from: "xiaomei.beauty@example.com",
              },
              { id: "mid-3901-3", sentAt: "2026-10-01T03:00:00Z", direction: "inbound", body: "Please share the rate.", unread: true, from: "xiaomei.beauty@example.com" },
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
  if (process.env.TEST_DATABASE_URL) await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-mail-memory-"));
  process.env.LINGONG_DB = path.join(tmp, "mail.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  // envApiKey accepts OPENAI_API_KEY / CODEX_API_KEY. Use the latter so this
  // suite remains self-contained on CI runners without a real OpenAI secret.
  process.env.CODEX_API_KEY = "sk-test-mail-memory";
  setIntentLlmFetch(async (_input, _init) => new Response(JSON.stringify({
    output_text: JSON.stringify({ digest: "测试摘要：双方正在确认合作细节。", zh: "测试中文译文。", translation: "测试中文译文。" }),
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
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

afterEach(async () => {
  await closePostgresPool();
  setStarryKolClientFactory();
  setIntentLlmFetch();
  delete process.env.CODEX_API_KEY;
  delete process.env.INTENT_LLM_MODE;
  resetFollowedMailSync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("mailbox memory P0", () => {
  it("runs the selected summary and translation Skills through named routes", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    process.env.INTENT_LLM_MODE = "real";
    const listed = await request("GET", "/api/queries/mail.conversations");
    const first = (listed.body.conversations as Json[])[0];
    const opened = await request("GET", `/api/queries/mail.conversation?id=${first.id}`);
    const message = (opened.body.messages as Json[])[0];
    const summary = await request("POST", "/api/skills/mail_summary/execute", {
      box: "larry.zhao@amperetime.com", conversation_id: first.conversation_id,
    });
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ skill_id: "mail_summary", accepted: true, pending: false });
    const translation = await request("POST", "/api/skills/mail_translate/execute", {
      box: "larry.zhao@amperetime.com", message_id: message.id,
    });
    expect(translation.status).toBe(200);
    expect(translation.body).toMatchObject({ skill_id: "mail_translate", accepted: true, pending: false });
    const reread = await request("GET", `/api/queries/mail.conversation?id=${first.id}`);
    expect((reread.body.messages as Json[]).find((row) => row.id === message.id)?.translation_zh).toContain("中文");
  });

  it("GET box / conversations / thread create no session and call no model", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const starryBefore = calls.filter((name) => name === "pageEmailConversations" || name === "getEmailConversation").length;
    const sessionsBefore = sessionCount();
    calls.length = 0;

    const box = await request("GET", "/api/queries/mail.box");
    const listed = await request("GET", "/api/queries/mail.conversations");
    const first = (listed.body.conversations as Json[])[0];
    const opened = await request("GET", `/api/queries/mail.conversation?id=${first.id}`);

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

  it("returns each mail title separately from the conversation subject", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const listed = await request("GET", "/api/queries/mail.conversations");
    const conversation = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901")!;
    const opened = await request("GET", `/api/queries/mail.conversation?id=${conversation.id}`);
    const message = (opened.body.messages as Json[]).find((row) => row.provider_message_id === "mid-3901-2");

    expect(conversation.subject).toBe("Re: LiTime MCP 连通测试");
    expect(message).toMatchObject({
      subject: "Re: LiTime MCP 连通测试",
      title: "达人确认合作意向",
    });
    // No title from the provider stays empty; the frontend renders `—` instead
    // of silently copying the L2 conversation subject into the L3 title row.
    expect((opened.body.messages as Json[]).find((row) => row.provider_message_id === "mid-3901-3")?.title).toBe("");
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
    const queued = await request("POST", "/api/jobs/mail.sync/start");
    await processExecutionJobById(String((queued.body.job as Json).id));
    const listed = await request("GET", "/api/queries/mail.conversations");
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
    const response = await app.request("/api/queries/mail.conversations", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(response.status).toBe(200);
    expect(String(response.headers.get("content-encoding") || "")).toContain("gzip");
  });

  it("mutexes sync per user+mailbox and writes cursor fields on the binding", async () => {
    bindLarry();
    listDelayMs = 40;
    const [first, second] = await Promise.all([
      request("POST", "/api/jobs/mail.sync/start"),
      request("POST", "/api/jobs/mail.sync/start"),
    ]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((first.body.job as Json).id).toBe((second.body.job as Json).id);
    await processExecutionJobById(String((first.body.job as Json).id));
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
    const listed = await request("GET", "/api/queries/mail.conversations");
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
    const listed = await request("GET", "/api/queries/mail.conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(String(thread?.last_preview)).toMatch(/Please share the rate|想和贵品牌litime合作|测试邮件/);
    expect(String(thread?.last_preview).length).toBeLessThanOrEqual(89);
    expect(String(thread?.digest_source)).toBe("body_analysis");
    expect(["codex_memory", "luna"]).not.toContain(thread?.digest_source);

    const opened = await request("GET", `/api/queries/mail.conversation?id=${thread?.id}`);
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

    const box = await request("GET", "/api/queries/mail.box");
    expect(box.status).toBe(200);
    const bindings = box.body.bindings as Json[];
    expect(Array.isArray(bindings)).toBe(true);
    expect(bindings[0]).toMatchObject({ mailbox: "larry.zhao@amperetime.com", bound: true });
    expect(typeof box.body.total_unread).toBe("number");
    expect(Number(box.body.total_unread)).toBeGreaterThan(0);

    const listed = await request("GET", "/api/queries/mail.conversations");
    const thread = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "3901");
    expect(thread?.starred).toBe(false);

    const starred = await request("POST", "/api/actions/mail.star", { id: thread?.id, starred: true });
    expect(starred.status).toBe(200);
    expect((starred.body.conversation as Json).starred).toBe(true);
    const listedAgain = await request("GET", "/api/queries/mail.conversations");
    expect((listedAgain.body.conversations as Json[]).find((row) => row.conversation_id === "3901")?.starred).toBe(true);

    const opened = await request("GET", `/api/queries/mail.conversation?id=${thread?.id}`);
    const firstMessage = (opened.body.messages as Json[])[0];
    expect(firstMessage).toHaveProperty("translation_zh");
    expect(firstMessage).toHaveProperty("translation_source");
    expect(firstMessage?.translation_zh).toBeNull();
    expect(firstMessage?.translation_source).toBe("pending");

    // Per-mail read flag: the mail page labels every row 已读/未读 from this field.
    const openedMessages = opened.body.messages as Json[];
    expect(openedMessages.every((row) => typeof row.unread === "boolean")).toBe(true);
    expect(openedMessages.some((row) => row.unread === true)).toBe(true);
    expect(openedMessages.find((row) => row.direction === "outbound")?.unread).toBe(false);

    const read = await request("POST", "/api/actions/mail.read", { id: thread?.id });
    expect(read.status).toBe(200);
    expect((read.body.conversation as Json).unread_count).toBe(0);
    const afterRead = await request("GET", `/api/queries/mail.conversation?id=${thread?.id}`);
    expect((afterRead.body.messages as Json[]).every((row) => row.unread === false)).toBe(true);
    const remaining = Number((getConn().prepare(
      "SELECT COUNT(*) AS n FROM kol_mail_items WHERE thread_id=? AND unread=1",
    ).get(String(thread?.id)) as { n: unknown }).n);
    expect(remaining).toBe(0);

    const missing = await request("POST", "/api/actions/mail.read", { id: "conv_missing" });
    expect(missing.status).toBe(404);
  });

  it("serves ?box= per mailbox: bindings stay per-mailbox and unknown boxes are rejected", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    saveStarryBinding(DEMO_USER.id, { mailbox_email: "second.box@amperetime.com", owner_name: "赵良玉" });
    const now = new Date().toISOString();
    getConn().prepare(
      `INSERT INTO kol_mail_threads (id, conversation_id, subject, mailbox, unread_count, last_at, created_at, updated_at)
       VALUES ('thr_second', '9901', 'Second box mail', 'second.box@amperetime.com', 3, ?, ?, ?)`,
    ).run(now, now, now);

    const second = await request("GET", `/api/queries/mail.box?box=${encodeURIComponent("second.box@amperetime.com")}`);
    expect(second.body.mailbox).toBe("second.box@amperetime.com");
    expect(Number(second.body.unread)).toBe(3);
    const bindings = second.body.bindings as Json[];
    expect(bindings.map((row) => row.mailbox)).toEqual(["larry.zhao@amperetime.com", "second.box@amperetime.com"]);
    expect(bindings.every((row) => Number(row.unread) === unreadOf(String(row.mailbox)))).toBe(true);
    expect(Number(second.body.total_unread)).toBe(
      (bindings as Array<{ unread: number }>).reduce((sum, row) => sum + Number(row.unread), 0),
    );

    const listed = await request("GET", `/api/queries/mail.conversations?box=${encodeURIComponent("second.box@amperetime.com")}`);
    expect((listed.body.conversations as Json[]).map((row) => row.conversation_id)).toEqual(["9901"]);

    const fallback = await request("GET", "/api/queries/mail.box?box=unknown@example.com");
    expect(fallback.status).toBe(403);
    expect(fallback.body.detail).toMatchObject({ code: "mailbox_access_denied" });
  });

  it("registers the four mailbox-memory entries without changing confirm-send", () => {
    const byId = Object.fromEntries(HOME_ENTRY_REGISTRY.map((row) => [row.id, row]));
    expect(byId["list-mailbox-mail"]).toMatchObject({
      kind: "memory",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/queries/mail.conversations"),
    });
    expect(byId["open-mail-thread"]).toMatchObject({
      kind: "memory",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/queries/mail.conversation?id=:id"),
    });
    expect(byId["mail-compose-catalog"]).toMatchObject({
      kind: "memory",
      action: "通讯邮件任务目录",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
      route: "GET /api/queries/mail.compose-catalog",
    });
    expect(byId["sync-mailbox-mail"]).toMatchObject({
      kind: "command",
      creates_session: false,
      calls_model: false,
      route: expect.stringContaining("/api/jobs/mail.sync/start"),
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
      .prepare("SELECT indexname AS name FROM pg_indexes WHERE indexname='kol_mail_items_thread'")
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

    const listed = await request("GET", "/api/queries/mail.conversations");
    const two = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "9101");
    const one = (listed.body.conversations as Json[]).find((row) => row.conversation_id === "9102");
    expect(two?.message_count).toBe(2);
    expect(one?.message_count).toBe(1);
    // Fat digest text stays on the conversation detail, not in the list payload.
    expect(two).not.toHaveProperty("digest_text");
    expect(listed.body.conversations as Json[]).not.toContainEqual(expect.objectContaining({ digest_text: expect.anything() }));

    const opened = await request("GET", `/api/queries/mail.conversation?id=${two?.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body.digest_text).toBe("两封往来摘要");
  });

  it("returns kol_uid/handle on the conversation list so the page needs no board fetch", async () => {
    bindLarry();
    await ensureFollowedMailSync(true);
    const listed = await request("GET", "/api/queries/mail.conversations");
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
    const response = await app.request("/api/queries/mail.compose-catalog");
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
  it("retires mail-specific routes and rejects an unregistered tool action", async () => {
    expect((await app.request("/api/mail/box")).status).toBe(404);
    expect((await app.request("/api/mail/sync", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await app.request("/api/drafts/missing/send", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await request("POST", "/api/actions/sendEmailNow", {})).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("persists a cancellable sync job without making calls in the HTTP request", async () => {
    bindLarry();
    const queued = await request("POST", "/api/jobs/mail.sync/start", { request_id: "cancel-test" });
    expect(queued.status).toBe(202);
    const id = String((queued.body.job as Json).id);
    expect(calls).toEqual([]);
    expect((await request("GET", `/api/jobs/${id}`)).body.job).toMatchObject({ status: "queued" });
    const cancelled = await request("POST", `/api/jobs/${id}/cancel`, {});
    expect(cancelled.body.job).toMatchObject({ status: "cancelled" });
    expect(await processExecutionJobById(id)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("rejects another actor's job and rechecks revoked mailbox bindings before execution", async () => {
    bindLarry();
    const queued = await request("POST", "/api/jobs/mail.sync/start", {});
    const id = String((queued.body.job as Json).id);
    getConn().prepare("UPDATE execution_jobs SET actor_ref=? WHERE id=?").run("someone-else", id);
    expect((await request("GET", `/api/jobs/${id}`)).status).toBe(404);
    expect((await request("POST", `/api/jobs/${id}/cancel`, {})).status).toBe(404);
    getConn().prepare("UPDATE execution_jobs SET actor_ref=?,max_attempts=1 WHERE id=?").run(DEMO_USER.id, id);
    getConn().prepare("UPDATE user_starry_bindings SET status='expired' WHERE user_id=?").run(DEMO_USER.id);
    await processExecutionJobById(id);
    expect(calls).toEqual([]);
    expect(getConn().prepare("SELECT status FROM execution_jobs WHERE id=?").get(id)).toMatchObject({ status: "failed" });
    getConn().prepare("UPDATE user_starry_bindings SET status='connected' WHERE user_id=?").run(DEMO_USER.id);
    expect((await request("POST", `/api/jobs/${id}/retry`, {})).status).toBe(202);
    await processExecutionJobById(id);
    expect((await request("GET", `/api/jobs/${id}`)).body.job).toMatchObject({ status: "succeeded" });
  });

  it("does not let an old sync worker overwrite a newer lease or cancellation", async () => {
    bindLarry();
    const queued = await request("POST", "/api/jobs/mail.sync/start", {});
    const id = String((queued.body.job as Json).id);
    await pgClaimExecutionJobById(id, "old-worker");
    getConn().prepare("UPDATE execution_jobs SET lease_owner='new-worker' WHERE id=?").run(id);
    expect(await pgCompleteExecutionJob(id, { ok: true }, new Date(), "old-worker")).toBeUndefined();
    await pgFailExecutionJob(id, { code: "stale_failure", summary: "old attempt" }, { expected_worker: "old-worker" });
    expect((await request("GET", `/api/jobs/${id}`)).body.job).toMatchObject({ status: "running", lease_owner: "new-worker" });
    await request("POST", `/api/jobs/${id}/cancel`, {});
    expect(await pgCompleteExecutionJob(id, { ok: true }, new Date(), "new-worker")).toBeUndefined();
    expect((await request("GET", `/api/jobs/${id}`)).body.job).toMatchObject({ status: "cancelled" });
  });

});
