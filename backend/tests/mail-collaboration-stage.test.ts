import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { mapUser, withScopedUser } from "../src/auth.js";
import { DEMO_USER } from "../src/config.js";
import { getConn, resetConn } from "../src/db.js";
import { HttpFail } from "../src/host/errors.js";
import { mailOperations } from "../src/mail/operations.js";
import { operationRouter } from "../src/runtime/operations.js";
import type { Json } from "../src/types.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedAll } from "../src/seed.js";
import { bindStarryUser } from "./helpers/starry-binding.js";

let tmp = "";
let app: Hono;

async function query(conversationId: string) {
  const actor = (await getConn().query("SELECT * FROM users WHERE id=$1", [DEMO_USER.id])).rows[0] as Json | undefined;
  const invoke = async () => app.request(
      `/queries/mail.collaboration-stage?conversation_id=${encodeURIComponent(conversationId)}`,
    );
  const response = actor ? await withScopedUser((await mapUser(actor)), invoke) : await invoke();
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Json };
}

beforeEach(async () => {
  await freshTestDatabase();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-stage-"));
  process.env.LINGONG_DATA = tmp;
  (await resetConn());
  await seedAll();
  // Visibility is mailbox-scoped. This fixture binds the same real test actor
  // used to issue the query; it does not bypass the authorization predicate.
  await bindStarryUser();
  const router = operationRouter(mailOperations);
  router.onError((error, c) => {
    if (error instanceof HttpFail) return c.json({ detail: error.detail }, error.status as 400);
    return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
  });
  app = router;
  const now = new Date().toISOString();
  (await getConn().query("INSERT INTO collaborations\n       (id, handle, display_name, brand, platform, email, mailbox_from, lifecycle_id, conversation_id, stage_code)\n     VALUES ('col_1', 'testhandle', 'Test KOL', 'LT', 'youtube', 'kol@example.com', 'larry.zhao@amperetime.com', 'lc1', 'conv_1', 'QUOTE_PENDING')",[]));
  (await getConn().query("INSERT INTO kol_mail_threads\n       (id, collaboration_id, conversation_id, subject, mailbox, created_at, updated_at)\n     VALUES ('thr_1', 'col_1', 'conv_1', 'Hello', 'larry.zhao@amperetime.com', $1, $2)",[now,now]));
  (await getConn().query("INSERT INTO kol_mail_threads\n       (id, collaboration_id, conversation_id, subject, mailbox, created_at, updated_at)\n     VALUES ('thr_2', NULL, 'conv_2', 'No bind', 'larry.zhao@amperetime.com', $1, $2)",[now,now]));
});

afterEach(async () => {
  (await resetConn());
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
