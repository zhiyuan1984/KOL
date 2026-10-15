import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";

import type { AppUser } from "../src/auth.js";
import { withScopedUser } from "../src/auth.js";
import { mailOperations } from "../src/mail/operations.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { operationRouter } from "../src/runtime/operations.js";
import { HttpFail } from "../src/host/errors.js";
import { freshTestDatabase } from "./support/pg.js";

const BOX_A = "operator-a@example.test";
const BOX_B = "operator-b@example.test";
const CONVERSATION_A = "conversation-a";
const CONVERSATION_B = "conversation-b";
const PEER_A = "peer-a@example.test";
const PEER_B = "peer-b@example.test";

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

const ACTOR_A = actor("label-user-a");
const ACTOR_B = actor("label-user-b");

async function within<T>(user: AppUser, fn: () => T | Promise<T>): Promise<T> {
  return withScopedUser(user, fn);
}

async function responseBody(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getLabels(user: AppUser | undefined, box = BOX_A, conversationId?: string) {
  const query = new URLSearchParams({ box, ...(conversationId ? { conversation_id: conversationId } : {}) });
  const request = async () => (await app.request(`/queries/mail.labels?${query.toString()}`));
  return responseBody(user ? await within(user, request) : await request());
}

async function changeLabel(user: AppUser | undefined, body: Record<string, unknown>) {
  const request = async () => (await app.request("/actions/mail.label", { method: "POST", body: JSON.stringify(body) }));
  return responseBody(user ? await within(user, request) : await request());
}

async function ensureUser(user: AppUser): Promise<void> {
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO users(id,username,name,password_hash,created_at,updated_at)
     VALUES ($1,$2,$3,'isolated-test-only',$4,$4)
     ON CONFLICT (id) DO NOTHING`,
    [user.id, user.username, user.name, now],
  );
}

async function bind(userId: string, mailbox: string): Promise<void> {
  await postgresPool().query(
    `INSERT INTO user_starry_bindings(user_id,mailbox_email,is_default,status,updated_at)
     VALUES ($1,$2,CASE WHEN EXISTS (SELECT 1 FROM user_starry_bindings WHERE user_id=$1 AND is_default=1) THEN 0 ELSE 1 END,'connected',now())
     ON CONFLICT (user_id,mailbox_email) DO UPDATE SET status='connected',updated_at=now()`,
    [userId, mailbox],
  );
}

async function thread(conversationId: string, mailbox: string, collaborationId = "", peerEmail = PEER_A): Promise<void> {
  await postgresPool().query(
    `INSERT INTO kol_mail_threads(id,conversation_id,mailbox,subject,collaboration_id,peer_email,created_at,last_at,updated_at)
     VALUES ($1,$2,$3,'Private label test',$4,$5,now(),now(),now())`,
    [`thread-${conversationId}-${mailbox}`, conversationId, mailbox, collaborationId || null, peerEmail],
  );
}

function action(input: Record<string, unknown>): Record<string, unknown> {
  return { box: BOX_A, conversation_id: CONVERSATION_A, confirm: true, ...input };
}

beforeEach(async () => {
  await freshTestDatabase();
  // The runner-built template already applies 035 then 042. Replaying old SQL
  // would try to index conversation_id after 042 removed that column.
  await ensureUser(ACTOR_A);
  await ensureUser(ACTOR_B);
  await bind(ACTOR_A.id, BOX_A);
  await thread(CONVERSATION_A, BOX_A, "", PEER_A);
  await thread(CONVERSATION_B, BOX_A, "", PEER_B);

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

describe("mail private labels PostgreSQL integration", () => {
  it("creates, refreshes from PostgreSQL, and audits a private assignment", async () => {
    const created = await changeLabel(ACTOR_A, action({ mode: "add", name: " Follow up ", expected_version: 0 }));
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      entry: "command", kind: "command", creates_session: false, creates_turn: false, calls_model: false,
      ok: true, mailbox: BOX_A, conversation_id: CONVERSATION_A, version: 1,
    });
    const label = (created.body.labels as Array<Record<string, unknown>>)[0];
    expect(label).toMatchObject({ name: "Follow up", count: 1 });
    expect(created.body.label_ids).toEqual([label.id]);

    // A new pool proves this projection is durable PG data, not request memory.
    await closePostgresPool();
    const refreshed = await getLabels(ACTOR_A, BOX_A, CONVERSATION_A);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ entry: "memory", version: 1, selected_label_ids: [label.id] });
    expect(refreshed.body.assignments).toEqual([{ peer_email: PEER_A, label_ids: [label.id] }]);
    const audit = await postgresPool().query<{ actor: string; event_type: string; payload_json: Record<string, unknown> }>(
      "SELECT actor,event_type,payload_json FROM mail_sync_audit WHERE event_type='mail.label.add' ORDER BY ts DESC LIMIT 1",
    );
    expect(audit.rows[0]).toMatchObject({
      actor: ACTOR_A.id,
      event_type: "mail.label.add",
      payload_json: expect.objectContaining({ mailbox: BOX_A, conversation_id: CONVERSATION_A, version_before: 0, version_after: 1 }),
    });
  });

  it("shares one person's labels across that person's conversations (labels follow the peer)", async () => {
    await thread("conversation-a2", BOX_A, "", PEER_A);
    const created = await changeLabel(ACTOR_A, action({ mode: "add", name: "Shared", expected_version: 0 }));
    expect(created.status).toBe(200);
    const label = (created.body.labels as Array<Record<string, unknown>>)[0];
    expect(label).toMatchObject({ name: "Shared", count: 1 });

    // 第二个会话属于同一对方：不打标也能看到同一组标签；count 仍计 1 人。
    const other = await getLabels(ACTOR_A, BOX_A, "conversation-a2");
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject({ selected_label_ids: [label.id] });
    expect(other.body.assignments).toEqual([{ peer_email: PEER_A, label_ids: [label.id] }]);

    // 从另一会话移除 = 从该对方移除，两个会话都看不到。
    const removed = await changeLabel(ACTOR_A, {
      box: BOX_A, conversation_id: "conversation-a2", mode: "remove", label_id: label.id, expected_version: 1, confirm: true,
    });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ version: 2, label_ids: [] });
    const first = await getLabels(ACTOR_A, BOX_A, CONVERSATION_A);
    expect(first.body).toMatchObject({ selected_label_ids: [] });
  });

  it("selects an existing label by id and canonicalizes equivalent names without duplicates", async () => {
    const first = await changeLabel(ACTOR_A, action({ mode: "add", name: " Ｆｏｌｌｏｗ　Ｕｐ ", expected_version: 0 }));
    const label = (first.body.labels as Array<Record<string, unknown>>)[0];
    expect(label.name).toBe("Follow Up");

    const selectedExisting = await changeLabel(ACTOR_A, {
      box: BOX_A, conversation_id: CONVERSATION_B, mode: "add", label_id: label.id, expected_version: 1, confirm: true,
    });
    expect(selectedExisting.status).toBe(200);
    expect(selectedExisting.body).toMatchObject({ label_ids: [label.id], version: 2 });

    const canonicalRepeat = await changeLabel(ACTOR_A, action({ mode: "add", name: "follow up", expected_version: 2 }));
    expect(canonicalRepeat.status).toBe(200);
    expect(canonicalRepeat.body).toMatchObject({ version: 2, label_ids: [label.id] });
    const labels = canonicalRepeat.body.labels as Array<Record<string, unknown>>;
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: label.id, name: "Follow Up", count: 2 });
  });

  it("removes idempotently without deleting the dictionary or a mail record", async () => {
    const added = await changeLabel(ACTOR_A, action({ mode: "add", name: "Later", expected_version: 0 }));
    const label = (added.body.labels as Array<Record<string, unknown>>)[0];
    const removed = await changeLabel(ACTOR_A, action({ mode: "remove", label_id: label.id, expected_version: 1 }));
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ version: 2, label_ids: [] });

    const repeated = await changeLabel(ACTOR_A, action({ mode: "remove", label_id: label.id, expected_version: 2 }));
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ version: 2, label_ids: [] });
    expect(repeated.body.labels).toEqual([expect.objectContaining({ id: label.id, name: "Later", count: 0 })]);
    const retained = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2",
      [CONVERSATION_A, BOX_A],
    );
    expect(Number(retained.rows[0].n)).toBe(1);
  });

  it("rejects missing confirmation, bad names, and a stale expected version", async () => {
    const missingConfirm = await changeLabel(ACTOR_A, { box: BOX_A, conversation_id: CONVERSATION_A, mode: "add", name: "Inbox", expected_version: 0 });
    expect(missingConfirm.status).toBe(400);
    expect(missingConfirm.body).toMatchObject({ detail: { code: "confirmation_required" } });

    for (const name of ["", "x".repeat(41), "bad\nname", "\ntrimmed-away-control"]) {
      const invalid = await changeLabel(ACTOR_A, action({ mode: "add", name, expected_version: 0 }));
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ detail: { code: "label_name_invalid" } });
    }
    const invalidMailbox = await changeLabel(ACTOR_A, {
      box: { mailbox: BOX_A }, conversation_id: CONVERSATION_A, mode: "add", name: "Inbox", expected_version: 0, confirm: true,
    });
    expect(invalidMailbox.status).toBe(400);
    expect(invalidMailbox.body).toMatchObject({ detail: { code: "mailbox_invalid" } });

    const added = await changeLabel(ACTOR_A, action({ mode: "add", name: "Inbox", expected_version: 0 }));
    const label = (added.body.labels as Array<Record<string, unknown>>)[0];
    const stale = await changeLabel(ACTOR_A, action({ mode: "remove", label_id: label.id, expected_version: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ detail: { code: "version_conflict", expected_version: 0, current_version: 1 } });
  });

  it("requires an explicit scoped identity even when test auth is disabled", async () => {
    const read = await getLabels(undefined);
    expect(read.status).toBe(401);
    expect(read.body).toMatchObject({ detail: { code: "authentication_required" } });
    const write = await changeLabel(undefined, action({ mode: "add", name: "No actor", expected_version: 0 }));
    expect(write.status).toBe(401);
    expect(write.body).toMatchObject({ detail: { code: "authentication_required" } });
  });

  it("keeps same-mailbox dictionaries private across users and blocks foreign label ids", async () => {
    await bind(ACTOR_B.id, BOX_A);
    const a = await changeLabel(ACTOR_A, action({ mode: "add", name: "Personal", expected_version: 0 }));
    const labelA = (a.body.labels as Array<Record<string, unknown>>)[0];
    const emptyB = await getLabels(ACTOR_B, BOX_A);
    expect(emptyB.body).toMatchObject({ labels: [], assignments: [], selected_label_ids: [], version: 0 });

    const foreign = await changeLabel(ACTOR_B, action({ mode: "add", label_id: labelA.id, expected_version: 0 }));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ detail: { code: "label_not_found" } });

    const b = await changeLabel(ACTOR_B, action({ mode: "add", name: "Personal", expected_version: 0 }));
    const labelB = (b.body.labels as Array<Record<string, unknown>>)[0];
    expect(labelB.id).not.toBe(labelA.id);
    const privateRows = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM mail_private_labels WHERE mailbox=$1 AND normalized_name='personal'",
      [BOX_A],
    );
    expect(Number(privateRows.rows[0].n)).toBe(2);
  });

  it("rejects an unbound mailbox, a cross-mailbox id, and access after unbinding", async () => {
    await thread("conversation-box-b", BOX_B);
    const denied = await changeLabel(ACTOR_A, {
      box: BOX_B, conversation_id: "conversation-box-b", mode: "add", name: "Other", expected_version: 0, confirm: true,
    });
    expect(denied.status).toBe(403);

    const added = await changeLabel(ACTOR_A, action({ mode: "add", name: "Private", expected_version: 0 }));
    const labelA = (added.body.labels as Array<Record<string, unknown>>)[0];
    await bind(ACTOR_A.id, BOX_B);
    const crossMailbox = await changeLabel(ACTOR_A, {
      box: BOX_B, conversation_id: "conversation-box-b", mode: "add", label_id: labelA.id, expected_version: 0, confirm: true,
    });
    expect(crossMailbox.status).toBe(404);
    expect(crossMailbox.body).toMatchObject({ detail: { code: "label_not_found" } });

    await postgresPool().query("DELETE FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", [ACTOR_A.id, BOX_A]);
    expect((await getLabels(ACTOR_A)).status).toBe(403);
    expect((await changeLabel(ACTOR_A, action({ mode: "remove", label_id: labelA.id, expected_version: 1 }))).status).toBe(403);
  });

  it("has one dictionary row under concurrent same-name adds", async () => {
    const [left, right] = await Promise.all([
      (await changeLabel(ACTOR_A, action({ mode: "add", name: "Concurrent", expected_version: 0 }))),
      (await changeLabel(ACTOR_A, action({ mode: "add", name: "concurrent", expected_version: 0 }))),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const succeeded = left.status === 200 ? left : right;
    const conflicted = left.status === 409 ? left : right;
    expect(succeeded.body).toMatchObject({
      conversation_id: CONVERSATION_A,
      version: 1,
      label_ids: expect.arrayContaining([expect.any(String)]),
    });
    expect(conflicted.body).toMatchObject({ detail: { code: "version_conflict", expected_version: 0, current_version: 1 } });
    const rows = await postgresPool().query<{ n: string }>(
      "SELECT count(*)::int AS n FROM mail_private_labels WHERE user_id=$1 AND mailbox=$2 AND normalized_name=$3",
      [ACTOR_A.id, BOX_A, "concurrent"],
    );
    expect(Number(rows.rows[0].n)).toBe(1);
    const state = await postgresPool().query<{ version: number }>(
      "SELECT version FROM mail_private_label_states WHERE user_id=$1 AND mailbox=$2",
      [ACTOR_A.id, BOX_A],
    );
    expect(Number(state.rows[0].version)).toBe(1);
    const receipt = await getLabels(ACTOR_A, BOX_A, CONVERSATION_A);
    expect(receipt.body).toMatchObject({ version: 1, selected_label_ids: succeeded.body.label_ids });
  });

  it("only counts labeled people in the current mailbox and leaves stage and session counts unchanged", async () => {
    await postgresPool().query(
      `INSERT INTO collaborations(id,handle,display_name,brand,lifecycle_id,conversation_id,email,mailbox_from,stage_code)
       VALUES ('label-stage-collab','creator','Creator','LT','label-stage-lifecycle',$1,'creator@example.test',$2,'NEGOTIATING')`,
      [CONVERSATION_A, BOX_A],
    );
    await postgresPool().query("UPDATE kol_mail_threads SET collaboration_id='label-stage-collab' WHERE conversation_id=$1 AND mailbox=$2", [CONVERSATION_A, BOX_A]);
    const beforeStage = await postgresPool().query<{ stage_code: string }>("SELECT stage_code FROM collaborations WHERE id='label-stage-collab'");
    const beforeRuns = await postgresPool().query<{ n: string }>("SELECT count(*)::int AS n FROM task_runs");

    const changed = await changeLabel(ACTOR_A, action({ mode: "add", name: "Keep stage", expected_version: 0 }));
    expect(changed.body).toMatchObject({ creates_session: false, creates_turn: false, calls_model: false });
    expect((changed.body.labels as Array<Record<string, unknown>>)[0]).toMatchObject({ count: 1 });
    const afterStage = await postgresPool().query<{ stage_code: string }>("SELECT stage_code FROM collaborations WHERE id='label-stage-collab'");
    const afterRuns = await postgresPool().query<{ n: string }>("SELECT count(*)::int AS n FROM task_runs");
    expect(afterStage.rows[0].stage_code).toBe(beforeStage.rows[0].stage_code);
    expect(afterRuns.rows[0].n).toBe(beforeRuns.rows[0].n);

    await postgresPool().query("DELETE FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2", [CONVERSATION_A, BOX_A]);
    // 标签跟人走：删会话行不清除该对方的标签（字典仍按邮箱隔离，count 计对方数）。
    const current = await getLabels(ACTOR_A, BOX_A);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({ assignments: [{ peer_email: PEER_A, label_ids: expect.any(Array) }] });
    expect((current.body.labels as Array<Record<string, unknown>>)[0]).toMatchObject({ count: 1 });
  });
});
