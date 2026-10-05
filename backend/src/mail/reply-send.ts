import { authDisabled, scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import type { mailSendAction, MailSendConfirmation } from "../host/mail-send-confirmation.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Row } from "../types.js";
import { readReplyContext } from "./reply-context.js";
import { replyFingerprint } from "./reply-source.js";

type SendView = ReturnType<typeof mailSendAction>;
async function contextFor(draft: Row) {
  if (authDisabled() || !draft.collaboration_id) return null;
  const present = (await postgresPool().query("SELECT 1 FROM kol_mail_items WHERE collaboration_id=$1 LIMIT 1", [draft.collaboration_id])).rowCount;
  if (!present) return null; // first contact has no reply dependency
  return readReplyContext(String(draft.session_id));
}

/** Preserve the owning gateway's action checks; add only relevant mail evidence. */
export async function replySendView(draft: Row, base: SendView): Promise<SendView & { reply_context?: { version: string; complete: boolean; sources: unknown } }> {
  const context = await contextFor(draft);
  if (!context) return base;
  const view = { ...base, action: { ...base.action }, reply_context: {
    version: String(context.version), complete: Boolean(context.complete), sources: context.sources,
  } };
  if (!context.complete && !base.action.receipt_id) {
    view.action = { ...view.action, enabled: false, state: "blocked", confirmation_version: null,
      disabled_reason: "邮件源尚未完整核验，请恢复同步后重新核对。原草稿保留，尚未发送。" };
  } else if (base.action.confirmation_version) {
    view.action.confirmation_version = replyFingerprint([base.action.confirmation_version,context.version]);
  }
  return view;
}

/** A bound confirmation remains auditable after rejection. Legacy claim still
 * owns the one-send boundary; its old token is never accepted from the client.
 */
export async function bindReplySend(draft: Row, base: SendView, input: MailSendConfirmation): Promise<MailSendConfirmation> {
  const actor = scopedUser();
  const db = postgresPool();
  if (!actor || authDisabled()) return input;
  const requestId = String(input.request_id || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new HttpFail(409, "mail_confirmation_required");
  const prior = (await db.query<Row>("SELECT * FROM reply_send_basis WHERE request_id=$1", [requestId])).rows[0];
  if (prior) {
    if (prior.draft_id !== draft.id || prior.actor_id !== actor.id || prior.confirmation_version !== input.confirmation_version || prior.state === "rejected") throw new HttpFail(409, "reply_confirmation_already_used");
    return { ...input, confirmation_version: String(prior.legacy_confirmation_version) };
  }
  const view = await replySendView(draft, base);
  if (!draft.collaboration_id) return input;
  if (!view.action.enabled || !input.confirmation_version || input.confirmation_version !== view.action.confirmation_version) throw new HttpFail(409, {
    code: "mail_reply_context_changed", message: "相关邮件或发送内容已变化，请重新核对并确认。尚未发送。" });
  await postgresTransaction(async client => {
    // Definite pre-network rejection is recoverable; all prior basis records
    // remain in reply_send_basis, rather than being erased with this claim.
    if ((await client.query("SELECT to_regclass('public.mail_send_attempts') AS name")).rows[0].name) {
      await client.query("DELETE FROM mail_send_attempts WHERE draft_id=$1 AND actor_id=$2 AND status='reply_stale'", [draft.id,actor.id]);
    }
    await client.query(`INSERT INTO reply_send_basis(request_id,draft_id,actor_id,confirmation_version,legacy_confirmation_version,context_version)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO NOTHING`, [requestId,draft.id,actor.id,input.confirmation_version,base.action.confirmation_version,view.reply_context?.version || "no_reply_mail"]);
    const winner = (await client.query<Row>("SELECT * FROM reply_send_basis WHERE request_id=$1", [requestId])).rows[0];
    if (winner.draft_id !== draft.id || winner.actor_id !== actor.id || winner.confirmation_version !== input.confirmation_version || winner.state === "rejected") throw new HttpFail(409, "reply_confirmation_already_used");
  });
  return { ...input, confirmation_version: base.action.confirmation_version || undefined };
}

/** Called immediately before provider IO; never turns a known refusal into an unknown send. */
export async function assertReplySendCurrent(draft: Row, requestId: string): Promise<void> {
  const basis = (await postgresPool().query<Row>("SELECT * FROM reply_send_basis WHERE request_id=$1 AND draft_id=$2", [requestId,draft.id])).rows[0];
  if (!basis) return;
  let current, readable = true;
  try { current = await contextFor(draft); } catch { current = null; readable = false; }
  const active = (await postgresPool().query("SELECT 1 FROM users WHERE id=$1 AND active=1", [basis.actor_id])).rowCount;
  if (basis.state === "confirmed" && basis.actor_id === scopedUser()?.id && active && readable
    && ((current?.complete && current.version === basis.context_version)
      || (!current && basis.context_version === "no_reply_mail"))) return;
  await postgresTransaction(async db => {
    await db.query(`UPDATE reply_send_basis SET state='rejected',rejected_at=COALESCE(rejected_at,now()),rejected_attempt=COALESCE(rejected_attempt,
      (SELECT to_jsonb(a) FROM mail_send_attempts a WHERE a.request_id=$1)) WHERE request_id=$1`, [requestId]);
    await db.query("UPDATE mail_send_attempts SET status='reply_stale',error='mail_reply_context_changed',updated_at=$3 WHERE draft_id=$1 AND request_id=$2 AND status='sending'", [draft.id,requestId,new Date().toISOString()]);
    await db.query("UPDATE drafts SET status='draft' WHERE id=$1 AND status='sending'", [draft.id]);
  });
  throw new HttpFail(409, { code: "mail_reply_context_changed", message: "执行前相关邮件或权限已变化，本次未调用发送接口。请保留草稿并重新核对。" });
}
