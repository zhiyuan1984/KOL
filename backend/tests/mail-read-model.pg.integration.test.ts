import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";

import type { AppUser } from "../src/auth.js";
import { withScopedUser } from "../src/auth.js";
import { HttpFail } from "../src/host/errors.js";
import { mailOperations } from "../src/mail/operations.js";
import { normalizeThread } from "../src/mail/read-model.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { operationRouter } from "../src/runtime/operations.js";
import { freshTestDatabase } from "./support/pg.js";

const BOX_A = "reader-a@example.test";
const BOX_B = "reader-b@example.test";
const ACTOR = actor("read-model-user");
let app: Hono;

function actor(id: string): AppUser {
  return {
    id,
    username: id,
    name: id,
    handle: id,
    email: `${id}@example.test`,
    phone: "",
    roles: ["employee"],
    role: "employee",
    brands: [],
    site: "",
    manager_user_id: null,
    active: true,
    exam_passed: true,
    exam_todo_count: 0,
    exam_module: "",
  };
}

async function request(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await withScopedUser(ACTOR, async () => (app.request(path)));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function insertUser(): Promise<void> {
  await postgresPool().query(
    `INSERT INTO users(id,username,name,password_hash,created_at,updated_at)
     VALUES ($1,$2,$3,'isolated-test-only',now(),now())`,
    [ACTOR.id, ACTOR.username, ACTOR.name],
  );
}

async function bind(mailbox: string, isDefault = false): Promise<void> {
  await postgresPool().query(
    `INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,status,updated_at)
     VALUES ($1,$2,$3,'connected',now())
     ON CONFLICT (user_id,mailbox_email)
     DO UPDATE SET is_default=EXCLUDED.is_default,status='connected',updated_at=now()`,
    [ACTOR.id, mailbox, isDefault ? 1 : 0],
  );
}

async function insertThread(id: string, conversationId: string, mailbox: string, subject = "Local mail"): Promise<void> {
  await postgresPool().query(
    `INSERT INTO kol_mail_threads
     (id,conversation_id,mailbox,subject,unread_count,last_at,created_at,updated_at,last_preview,digest_text,digest_source)
     VALUES ($1,$2,$3,$4,2,now(),now(),now(),'local preview','stored digest','body_analysis')`,
    [id, conversationId, mailbox, subject],
  );
}

async function insertItem(input: { id: string; threadId: string; conversationId: string; body?: string; translationSource?: string }): Promise<void> {
  await postgresPool().query(
    `INSERT INTO kol_mail_items
      (id,thread_id,conversation_id,provider_message_id,direction,subject,title,snippet,unread,occurred_at,created_at,
       from_addr,from_name,to_addr,body_text,translation_source)
     VALUES ($1,$2,$3,$4,'inbound','Local mail','Provider title','preview',1,now(),now(),
             'peer@example.test','Peer','reader-a@example.test',$5,$6)`,
    [input.id, input.threadId, input.conversationId, `provider-${input.id}`, input.body || null, input.translationSource || ""],
  );
}

/** Person digests are native PG memory facts, never app_state compatibility data. */
async function insertPersonDigest(): Promise<void> {
  await postgresPool().query(
    `INSERT INTO kol_mail_person_memory
     (id,company_id,mailbox,peer_email,digest_text,digest_source,digest_fingerprint,mail_count,generated_at,error,attempts,updated_at)
     VALUES ($1,'',$2,$3,$4,$5,$6,$7,$8::timestamptz,NULL,1,now())`,
    [
      "person-memory-a", BOX_A, "peer@example.test", "Stored person digest", "body_analysis", "fixture", 2,
      "2026-10-12T00:00:00.000Z",
    ],
  );
}

/** A detail read must not mutate any legacy or current mail-memory state. */
async function rejectMailReadWrites(): Promise<void> {
  await postgresPool().query(`
    CREATE OR REPLACE FUNCTION reject_mail_read_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'mail read attempted a write to %', TG_TABLE_NAME; END $$;
  `);
  for (const table of ["kol_mail_threads", "kol_mail_items", "kol_mail_person_memory", "app_state"]) {
    await postgresPool().query(`CREATE TRIGGER reject_${table}_write
      BEFORE INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_mail_read_write()`);
  }
}

beforeEach(async () => {
  await freshTestDatabase();
  await insertUser();
  await bind(BOX_A, true);
  await insertThread("thread-a", "conversation-a", BOX_A, "Cached original");
  await insertItem({ id: "item-a-body", threadId: "thread-a", conversationId: "conversation-a", body: "Original local body", translationSource: "pending" });
  await insertItem({ id: "item-a-header", threadId: "thread-a", conversationId: "conversation-a" });
  await insertThread("thread-b", "conversation-b", BOX_B, "Foreign mailbox");
  await insertItem({ id: "item-b", threadId: "thread-b", conversationId: "conversation-b", body: "Foreign original" });
  await insertPersonDigest();

  const router = operationRouter(mailOperations);
  router.onError((error, context) => {
    if (error instanceof HttpFail) return context.json({ detail: error.detail }, error.status as 400);
    return context.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
  });
  app = router;
});

afterEach(async () => {
  await closePostgresPool();
});

describe("mail local read model PostgreSQL integration", () => {
  it("reads only stored data, keeps raw-body state independent from translation, and performs zero writes", async () => {
    await rejectMailReadWrites();

    const box = await request(`/queries/mail.box?box=${encodeURIComponent(BOX_A)}`);
    const list = await request(`/queries/mail.conversations?box=${encodeURIComponent(BOX_A)}`);
    const detail = await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_A)}&id=thread-a`);
    const person = await request(`/queries/mail.person?box=${encodeURIComponent(BOX_A)}&p=peer%40example.test`);

    expect(box.status).toBe(200);
    expect(box.body).toMatchObject({ mailbox: BOX_A, bound: true, unread: 2, total_unread: 2 });
    expect((box.body.bindings as Array<Record<string, unknown>>)[0]).toMatchObject({ mailbox: BOX_A, bound: true, status: "connected" });

    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ mailbox: BOX_A });
    expect(list.body.conversations).toEqual([expect.objectContaining({ id: "thread-a", conversation_id: "conversation-a", message_count: 2 })]);

    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      entry: "memory", creates_session: false, creates_turn: false, calls_model: false,
      digest_text: "stored digest", digest_source: "body_analysis",
      summary_memory: { status: "未开始", mailbox: BOX_A, conversation_id: "conversation-a", text: "", fingerprint: "" },
      body_status: "ready", body_available_count: 1, body_missing_count: 1,
    });
    const messages = detail.body.messages as Array<Record<string, unknown>>;
    expect(messages.find((message) => message.id === "item-a-body")).toMatchObject({
      body_text: "Original local body", body_status: "ready", translation_source: "pending", translation_status: "pending",
    });
    expect(messages.find((message) => message.id === "item-a-header")).toMatchObject({
      body_status: "not_synced", translation_status: "not_started",
    });

    expect(person.status).toBe(200);
    expect(person.body).toMatchObject({
      mailbox: BOX_A, peer_email: "peer@example.test", digest_text: "Stored person digest",
      digest_source: "body_analysis", digest_generated_at: "2026-10-12T00:00:00.000Z",
    });
  });

  it("enforces explicit mailbox scope, isolates a same-user second mailbox, and leaks nothing after revocation", async () => {
    expect((await request(`/queries/mail.conversations?box=${encodeURIComponent(BOX_B)}`)).status).toBe(403);
    expect((await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_B)}&id=thread-b`)).status).toBe(403);

    await bind(BOX_B);
    const foreignViaA = await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_A)}&id=thread-b`);
    expect(foreignViaA.status).toBe(404);
    const selectedB = await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_B)}&id=thread-b`);
    expect(selectedB.status).toBe(200);
    expect(selectedB.body).toMatchObject({ conversation: { mailbox: BOX_B, conversation_id: "conversation-b" } });

    await postgresPool().query("DELETE FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", [ACTOR.id, BOX_A]);
    const noDefault = await request("/queries/mail.conversations");
    const noDefaultBox = await request("/queries/mail.box");
    expect(noDefault.status).toBe(200);
    expect(noDefault.body).toMatchObject({ mailbox: "", conversations: [] });
    expect(noDefaultBox.body).toMatchObject({ mailbox: "", bound: false, unread: 0 });
    expect((await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_A)}&id=thread-a`)).status).toBe(403);
  });

  it("keeps mail.person explicit and normalizes original normalizeThread fields", async () => {
    expect((await request("/queries/mail.person?p=peer%40example.test")).status).toBe(400);
    expect(normalizeThread({
      rawFields: {
        id: "raw-thread", conversationId: "raw-conversation", mailboxEmail: "Raw.Box@Example.Test",
        lastMessageAt: "2026-10-12T00:00:00.000Z", unreadCount: 3, lastPreview: "raw preview",
        digestSource: "body_analysis", starred: true,
      },
    })).toMatchObject({
      id: "raw-thread", conversation_id: "raw-conversation", mailbox: "raw.box@example.test",
      last_at: "2026-10-12T00:00:00.000Z", unread_count: 3, last_preview: "raw preview",
      digest_source: "body_analysis", starred: true, match_state: "unbound",
    });
  });

  it("records a warm local-PG P95 under the 500ms cached-read target", async () => {
    await postgresPool().query(`
      INSERT INTO kol_mail_threads(id,conversation_id,mailbox,subject,unread_count,last_at,created_at,updated_at)
      SELECT 'perf-thread-' || g,'perf-conversation-' || g,$1,'Performance local thread',0,now(),now(),now()
      FROM generate_series(1,120) g`, [BOX_A]);
    await postgresPool().query(`
      INSERT INTO kol_mail_items(id,thread_id,conversation_id,provider_message_id,direction,subject,unread,occurred_at,created_at,body_text)
      SELECT 'perf-item-' || g,'perf-thread-' || g,'perf-conversation-' || g,'perf-provider-' || g,'inbound','Performance local thread',0,now(),now(),'cached original'
      FROM generate_series(1,120) g`);

    // Warm both query plans and PostgreSQL pages before measuring the cached path.
    await request(`/queries/mail.conversations?box=${encodeURIComponent(BOX_A)}`);
    await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_A)}&id=perf-thread-1`);
    const listSamples: number[] = [];
    const detailSamples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      let start = performance.now();
      expect((await request(`/queries/mail.conversations?box=${encodeURIComponent(BOX_A)}`)).status).toBe(200);
      listSamples.push(performance.now() - start);
      start = performance.now();
      expect((await request(`/queries/mail.conversation?box=${encodeURIComponent(BOX_A)}&id=perf-thread-1`)).status).toBe(200);
      detailSamples.push(performance.now() - start);
    }
    const p95 = (samples: number[]) => [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1];
    const listP95 = p95(listSamples);
    const detailP95 = p95(detailSamples);
    console.info(`[mail-read-model-p95] local_list_ms=${listP95.toFixed(2)} local_detail_ms=${detailP95.toFixed(2)} samples=30`);
    expect(listP95).toBeLessThanOrEqual(500);
    expect(detailP95).toBeLessThanOrEqual(500);
  });
});
