import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { postgresDb, resetDatabase } from "../src/postgres/access.js";
import { HttpFail } from "../src/host/errors.js";
import { mailOperations } from "../src/mail/operations.js";
import { operationRouter } from "../src/runtime/operations.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
let tmp = "";
let app: Hono;
async function query(conversationId: string) {
  const response = await app.request(`/queries/mail.collaboration-stage?conversation_id=${encodeURIComponent(conversationId)}`);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Json };
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-stage-"));
  process.env.LINGONG_DATA = tmp;
  (await resetDatabase());
  const router = operationRouter(mailOperations);
  router.onError((error, c) => {
    if (error instanceof HttpFail)
      return c.json({ detail: error.detail }, error.status as 400);
    return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
  });
  app = router;
  const now = new Date().toISOString();
  // mail.collaboration-stage 只允许读取当前用户已绑定的通讯邮箱；PG
  // 不再像旧 SQLite 测试库一样隐含一条默认范围。
  (await postgresDb().execute(`INSERT INTO users
       (id,username,name,password_hash,created_at,updated_at)
     VALUES ('sriphy','jeffrey','黄启友','isolated-test-only',$1,$1)`, now));
  (await postgresDb().execute(`INSERT INTO user_starry_bindings
       (user_id, mailbox_email, is_default, status, updated_at)
     VALUES ('sriphy', 'larry.zhao@amperetime.com', 1, 'connected', $1)
     ON CONFLICT (user_id, mailbox_email) DO UPDATE
       SET is_default=EXCLUDED.is_default,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`, now));
  (await postgresDb().execute(`INSERT INTO collaborations
       (id, handle, display_name, brand, platform, email, mailbox_from, lifecycle_id, conversation_id, stage_code)
     VALUES ('col_1', 'testhandle', 'Test KOL', 'LT', 'youtube', 'kol@example.com', 'larry.zhao@amperetime.com', 'lc1', 'conv_1', 'QUOTE_PENDING')`));
  (await postgresDb().execute(`INSERT INTO kol_mail_threads
       (id, collaboration_id, conversation_id, subject, mailbox, created_at, updated_at)
     VALUES ('thr_1', 'col_1', 'conv_1', 'Hello', 'larry.zhao@amperetime.com', $1, $2)`, now, now));
  (await postgresDb().execute(`INSERT INTO kol_mail_threads
       (id, collaboration_id, conversation_id, subject, mailbox, created_at, updated_at)
     VALUES ('thr_2', NULL, 'conv_2', 'No bind', 'larry.zhao@amperetime.com', $1, $2)`, now, now));
});
afterEach(async () => {
  (await resetDatabase());
  delete process.env.LINGONG_DATA;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("mail.collaboration-stage", () => {
  it("returns the bound collaboration stage for a visible conversation", async () => {
    const { status, body } = await query("conv_1");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      collaboration_id: "col_1",
      found: true,
      handle: "testhandle",
      stage_code: "QUOTE_PENDING",
      stage_label: "报价待确认",
    });
  });

  it("returns collaboration_id null when the conversation is not bound", async () => {
    const { status, body } = await query("conv_2");
    expect(status).toBe(200);
    expect(body).toMatchObject({ collaboration_id: null });
  });

  it("404s for an unknown conversation instead of leaking collaborations", async () => {
    const { status } = await query("conv_nope");
    expect(status).toBe(404);
  });

  it("400s when conversation_id is missing", async () => {
    const response = await app.request("/queries/mail.collaboration-stage");
    expect(response.status).toBe(400);
  });
});
