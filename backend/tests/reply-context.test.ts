import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshTestDatabase } from "./support/pg.js";
import { seedAll } from "../src/seed.js";
import { resetConn } from "../src/db.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { mapUser, withScopedUser, type AppUser } from "../src/auth.js";
import { postgresPool } from "../src/postgres/pool.js";
import { observeReplyMail, type ReplyMailObservation } from "../src/mail/reply-source.js";
import { readReplyContext } from "../src/mail/reply-context.js";
import { replySendView, bindReplySend, assertReplySendCurrent } from "../src/mail/reply-send.js";
import { hostRegisteredActionView } from "../src/host/registered-actions.js";
import { sendDraft } from "../src/gateway/send.js";
import { starry } from "../src/adapters/clients.js";
import { withMailSendAuthority } from "../src/gateway/mail-authority.js";
import { callStarryKolTool, setStarryKolClientFactory } from "../src/starrykol/service.js";

let actor: AppUser;
let input: ReplyMailObservation;
beforeEach(async () => {
  await freshTestDatabase();
  process.env.AUTH_MODE = "enabled";
  process.env.CODEX_MODE = "stub";
  resetConn();
  seedAll(); seedWorkbenchFixtures();
  const db = postgresPool();
  await db.query(`INSERT INTO users(id,username,name,password_hash,created_at,updated_at)
    VALUES ('reply-owner','reply-owner','Reply Owner','isolated-test-only',$1,$1)`, [new Date().toISOString()]);
  actor = mapUser((await db.query("SELECT * FROM users WHERE active=1 ORDER BY id LIMIT 1")).rows[0]);
  actor = { ...actor, roles: ["employee"], role: "employee", brands: ["LT"] };
  await db.query("UPDATE users SET roles='[\"employee\"]',brands='[\"LT\"]' WHERE id=$1", [actor.id]);
  await db.query("UPDATE collaborations SET brand='LT' WHERE id='col_xiaomei'");
  const now = new Date().toISOString();
  await db.query("INSERT INTO sessions(id,title,created_at,updated_at,owner_user_id,collaboration_id) VALUES ('reply-session','reply',$1,$1,$2,'col_xiaomei')", [now,actor.id]);
  await db.query(`INSERT INTO kol_mail_threads(id,collaboration_id,conversation_id,subject,mailbox,created_at,updated_at,match_state)
    VALUES ('reply-thread','col_xiaomei','reply-conversation','Reply','owned@example.test',$1,$1,'matched')`, [now]);
  await db.query(`INSERT INTO user_starry_bindings(user_id,mailbox_email,status,updated_at,synced_at)
    VALUES ($1,'owned@example.test','connected',$2,$2) ON CONFLICT(user_id,mailbox_email) DO UPDATE SET status='connected',synced_at=EXCLUDED.synced_at`, [actor.id,now]);
  input = { thread_id: "reply-thread", collaboration_id: "col_xiaomei", conversation_id: "reply-conversation", mailbox: "owned@example.test",
    provider_message_id: "provider-1", direction: "inbound", subject: "Reply", title: "Reply", body: "Please delay to Monday",
    from: "creator@example.test", from_name: "Creator", to: "owned@example.test", occurred_at: "2026-10-05T01:00:00Z",
    source_updated_at: "2026-10-05T01:00:00Z", unread: true, summary: "", summary_zh: "", summary_source: "" };
});

describe("reply confirmation dependencies before provider IO", () => {
  async function prepare() {
    await observeReplyMail(input);
    const db = postgresPool();
    const draft = (await db.query(`INSERT INTO drafts(id,session_id,collaboration_id,skill,from_addr,to_addr,subject,body_en,body_zh_internal,lang_label)
      VALUES ('reply-draft','reply-session','col_xiaomei','email_compose','owned@example.test','creator@example.test','Reply','Human draft','内部','English') RETURNING *`)).rows[0];
    const base = { draft_id: draft.id, snapshot: {from: draft.from_addr,to: draft.to_addr,cc: "",subject: draft.subject,body: draft.body_en},
      action: hostRegisteredActionView({actionId: "mail.draft.send",label: "发送",riskLevel: "L3",allowed: true,enabled: true,confirmationPayload: {draft: draft.id}}) };
    await db.query(`CREATE TABLE IF NOT EXISTS mail_send_attempts(draft_id TEXT PRIMARY KEY,request_id TEXT UNIQUE,actor_id TEXT,confirmation_version TEXT,status TEXT,result_json TEXT,error TEXT,created_at TEXT,updated_at TEXT)`);
    return {draft,base};
  }
  async function claim(requestId = "reply-request-01") {
    const {draft,base} = await prepare();
    const view = await withScopedUser(actor, () => replySendView(draft,base));
    const input = {request_id: requestId,confirmation_version: view.action.confirmation_version!};
    await withScopedUser(actor, () => bindReplySend(draft,base,input));
    await postgresPool().query("INSERT INTO mail_send_attempts(draft_id,request_id,actor_id,status) VALUES ($1,$2,$3,'sending')", [draft.id,requestId,actor.id]);
    await postgresPool().query("UPDATE drafts SET status='sending' WHERE id=$1", [draft.id]);
    return {draft,base,input};
  }
  it("rejects a preflight made before a related revision without creating a claim", async () => {
    const {draft,base} = await prepare();
    const view = await withScopedUser(actor, () => replySendView(draft,base));
    await observeReplyMail({...input, body: "Please delay to Friday",source_updated_at: "2026-10-05T02:00:00Z"});
    await expect(withScopedUser(actor, () => bindReplySend(draft,base,{request_id: "reply-request-01",confirmation_version: view.action.confirmation_version!}))).rejects.toThrow(/尚未发送/);
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_send_basis")).rows[0].n).toBe(0);
  });
  it("deduplicates concurrent binding and preserves the first refusal audit after retry", async () => {
    const {draft,base} = await prepare();
    const view = await withScopedUser(actor, () => replySendView(draft,base));
    const confirmed = {request_id: "reply-concurrent-01",confirmation_version: view.action.confirmation_version!};
    await Promise.all([1,2].map(() => withScopedUser(actor, () => bindReplySend(draft,base,confirmed))));
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_send_basis")).rows[0].n).toBe(1);
    await postgresPool().query("INSERT INTO mail_send_attempts(draft_id,request_id,actor_id,status) VALUES ($1,$2,$3,'sending')", [draft.id,confirmed.request_id,actor.id]);
    await observeReplyMail({...input,body: "New reply",source_updated_at: "2026-10-05T02:00:00Z"});
    await expect(withScopedUser(actor, () => assertReplySendCurrent(draft,confirmed.request_id))).rejects.toThrow(/未调用发送接口/);
    const audit = (await postgresPool().query("SELECT rejected_at,rejected_attempt FROM reply_send_basis WHERE request_id=$1", [confirmed.request_id])).rows[0];
    const fresh = await withScopedUser(actor, () => replySendView(draft,base));
    await withScopedUser(actor, () => bindReplySend(draft,base,{request_id: "reply-concurrent-02",confirmation_version: fresh.action.confirmation_version!}));
    await expect(withScopedUser(actor, () => assertReplySendCurrent(draft,confirmed.request_id))).rejects.toThrow(/未调用发送接口/);
    expect((await postgresPool().query("SELECT rejected_at,rejected_attempt FROM reply_send_basis WHERE request_id=$1", [confirmed.request_id])).rows[0]).toEqual(audit);
  });
  it("does not block authorized removal or retain dependent mail snapshots and confirmation records", async () => {
    const {draft,base} = await prepare();
    const view = await withScopedUser(actor, () => replySendView(draft,base));
    await withScopedUser(actor, () => bindReplySend(draft,base,{request_id: "reply-delete-01",confirmation_version: view.action.confirmation_version!}));
    await postgresPool().query("DELETE FROM drafts WHERE id=$1", [draft.id]);
    await postgresPool().query("DELETE FROM kol_mail_items WHERE thread_id='reply-thread'");
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_send_basis")).rows[0].n).toBe(0);
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_mail_revisions")).rows[0].n).toBe(0);
  });
  it("rejects after confirmation, preserves human draft and audit, allows a fresh confirmation", async () => {
    const {draft,base,input: confirmed} = await claim();
    await observeReplyMail({...input, body: "Please delay to Friday",source_updated_at: "2026-10-05T02:00:00Z"});
    const provider = vi.spyOn(starry, "sendConversation");
    try {
      await expect(withScopedUser(actor, () => sendDraft(String(draft.id),"operator",confirmed.request_id))).rejects.toThrow(/未调用发送接口/);
      expect(provider).not.toHaveBeenCalled();
    } finally { provider.mockRestore(); }
    expect((await postgresPool().query("SELECT status,body_en FROM drafts WHERE id=$1", [draft.id])).rows[0]).toMatchObject({status: "draft",body_en: "Human draft"});
    expect((await postgresPool().query("SELECT state,rejected_attempt FROM reply_send_basis")).rows[0]).toMatchObject({state: "rejected",rejected_attempt: {request_id: confirmed.request_id}});
    const view = await withScopedUser(actor, () => replySendView(draft,base));
    await withScopedUser(actor, () => bindReplySend(draft,base,{request_id: "reply-request-02",confirmation_version: view.action.confirmation_version!}));
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_send_basis")).rows[0].n).toBe(2);
  });
  it("ignores unrelated collaboration changes but blocks relevant stage changes", async () => {
    const {draft,input: confirmed} = await claim();
    await postgresPool().query("UPDATE collaborations SET stage_version=stage_version+1 WHERE id <> 'col_xiaomei'");
    await withScopedUser(actor, () => assertReplySendCurrent(draft,confirmed.request_id));
    await postgresPool().query("UPDATE collaborations SET stage_version=stage_version+1 WHERE id='col_xiaomei'");
    await expect(withScopedUser(actor, () => assertReplySendCurrent(draft,confirmed.request_id))).rejects.toThrow(/未调用发送接口/);
  });
  it("rechecks persisted brand revocation and rejects before provider IO", async () => {
    const {draft,input: confirmed} = await claim();
    await postgresPool().query("UPDATE users SET brands='[]' WHERE id=$1", [actor.id]);
    await expect(withScopedUser(actor, () => assertReplySendCurrent(draft,confirmed.request_id))).rejects.toThrow(/未调用发送接口/);
  });
  it("binds an empty reply dependency so a first incoming mail still invalidates confirmation", async () => {
    const {draft,base} = await prepare();
    await postgresPool().query("DELETE FROM reply_mail_revisions");
    await postgresPool().query("DELETE FROM kol_mail_items WHERE thread_id='reply-thread'");
    await withScopedUser(actor, () => bindReplySend(draft,base,{request_id: "reply-empty-01",confirmation_version: base.action.confirmation_version!}));
    await postgresPool().query("INSERT INTO mail_send_attempts(draft_id,request_id,actor_id,status) VALUES ($1,'reply-empty-01',$2,'sending')", [draft.id,actor.id]);
    await observeReplyMail(input);
    await expect(withScopedUser(actor, () => assertReplySendCurrent(draft,"reply-empty-01"))).rejects.toThrow(/未调用发送接口/);
  });
  it("rechecks again at the send adapter boundary after preparatory reads", async () => {
    const {draft,input: confirmed} = await claim();
    const provider = vi.fn(async () => ({sent: true}));
    setStarryKolClientFactory(() => ({callTool: provider,close: async () => undefined}));
    try {
      await observeReplyMail({...input,body: "Please delay to Friday",source_updated_at: "2026-10-05T02:00:00Z"});
      await expect(withScopedUser(actor, () => withMailSendAuthority(String(draft.id),confirmed.request_id,
        () => callStarryKolTool("sendEmailNow",{}), () => assertReplySendCurrent(draft,confirmed.request_id)))).rejects.toThrow(/未调用发送接口/);
      expect(provider).not.toHaveBeenCalled();
    } finally {setStarryKolClientFactory();}
  });
});
const read = (after = 0) => withScopedUser(actor, () => readReplyContext("reply-session", after));

describe("native reply context and source revisions", () => {
  it("captures one durable event under duplicate and concurrent delivery", async () => {
    const results = await Promise.all([observeReplyMail(input),observeReplyMail(input),observeReplyMail(input)]);
    expect(results.filter(result => result.changed)).toHaveLength(1);
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_mail_revisions")).rows[0].n).toBe(1);
    const ctx = await read();
    expect(ctx).toMatchObject({ calls_model: false, creates_turn: false, complete: true });
    expect(ctx.messages).toHaveLength(1);
    expect((await read(Number(ctx.cursor))).changes).toEqual([]);
  });
  it("captures same-length revisions without replacing the stable mail identity", async () => {
    const first = await observeReplyMail(input);
    const before = await read();
    const result = await observeReplyMail({ ...input, body: "Please delay to Friday", source_updated_at: "2026-10-05T02:00:00Z" });
    expect(result.item_id).toBe(first.item_id);
    const after = await read(Number(before.cursor));
    expect(after.version).not.toBe(before.version);
    expect(after.messages).toHaveLength(1);
    expect(after.changes).toHaveLength(1);
    expect(after.events).toHaveLength(1);
    expect((await read()).events).toHaveLength(2);
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM reply_mail_revisions")).rows[0].n).toBe(2);
  });
  it("does not regress a revised body when an older source revision arrives", async () => {
    await observeReplyMail({ ...input, source_updated_at: "2026-10-05T02:00:00Z" });
    const before = await read();
    expect((await observeReplyMail({ ...input, body: "Old outdated request", source_updated_at: "2026-10-05T01:00:00Z" })).changed).toBe(false);
    expect((await read()).version).toBe(before.version);
  });
  it("quarantines a changed object association instead of moving private content", async () => {
    await observeReplyMail(input);
    expect(await observeReplyMail({ ...input, collaboration_id: "another-collaboration" })).toMatchObject({ quarantined: true });
    expect((await read()).messages).toHaveLength(1);
    expect((await postgresPool().query("SELECT reason FROM reply_mail_quarantine")).rows[0].reason).toBe("source_association_mismatch");
  });
  it("blocks another session owner, another brand and a revoked mailbox", async () => {
    await observeReplyMail(input);
    await expect(withScopedUser({ ...actor, id: "other-actor" }, () => readReplyContext("reply-session"))).rejects.toThrow(/mailbox_access_denied/);
    await postgresPool().query("UPDATE users SET brands='[\"another-brand\"]' WHERE id=$1", [actor.id]);
    await expect(read()).rejects.toThrow(/not found/);
    await postgresPool().query("UPDATE users SET brands='[\"LT\"]' WHERE id=$1", [actor.id]);
    await postgresPool().query("DELETE FROM user_starry_bindings WHERE user_id=$1", [actor.id]);
    await expect(read()).rejects.toThrow(/mailbox_access_denied/);
  });
  it("keeps source failure distinct from an empty result and leaves data readable", async () => {
    await observeReplyMail(input);
    await postgresPool().query("UPDATE user_starry_bindings SET last_error='source unavailable' WHERE user_id=$1", [actor.id]);
    const ctx = await read();
    expect(ctx.complete).toBe(false);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.sources).toMatchObject([{ state: "failed" }]);
  });
  it("does not approve a metadata-only cache as complete send evidence", async () => {
    await observeReplyMail(input);
    await postgresPool().query("UPDATE kol_mail_items SET body_text=NULL WHERE thread_id='reply-thread'");
    const ctx = await read();
    expect(ctx).toMatchObject({complete: false,missing_body_count: 1});
    expect((ctx.messages as Array<{body: unknown}>)[0].body).toBeNull();
  });
  it("quarantines missing occurrence time without inventing arrival as source time", async () => {
    expect(await observeReplyMail({...input,occurred_at: ""})).toMatchObject({quarantined: true});
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM kol_mail_items WHERE thread_id='reply-thread'")).rows[0].n).toBe(0);
  });
});
