import { mapUser, requireSkill, scopedUser, withScopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { normalizeEmail } from "../host/identity.js";
import { boundMailboxEmail, boundStarryCredentialId, starryBindingRow } from "../host/starry-bind.js";
import { nid } from "../ids.js";
import { postgresPool } from "../postgres/pool.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload, pgExecutionJobPublic } from "../execution-jobs/postgres-store.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { syncFollowedKolMail } from "../starrykol/mail-sync.js";
import { withStarryCredential } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";

export function authorizeMailSync(mailbox: string): string {
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, "authentication required");
  requireSkill("email_conversation_list");
  requireSkill("email_conversation_read");
  const binding = starryBindingRow(user.id, mailbox);
  if (!mailbox || !binding || binding.status !== "connected") throw new HttpFail(403, { code: "mailbox_access_denied" });
  const credential = boundStarryCredentialId(user.id, mailbox);
  if (!credential) throw new HttpFail(409, { code: "mailbox_credential_required" });
  return credential;
}

export async function startMailSyncJob(input: Json): Promise<Json> {
  const mailbox = normalizeEmail(String(input.box || boundMailboxEmail()));
  authorizeMailSync(mailbox);
  const actor = scopedUser()!.id;
  const requestId = String(input.request_id || nid("sync"));
  if (!/^[\w-]{1,160}$/.test(requestId)) throw new HttpFail(400, "invalid request_id");
  const { job } = await pgEnqueueExecutionJob({
    job_type: "mail.sync", actor_ref: actor, tenant_ref: actor,
    idempotency_key: `mail.sync:${actor}:${mailbox}:${requestId}`,
    object_ref: { mailbox }, scope_snapshot: { mailbox }, payload: { mailbox },
    risk_level: "low", max_attempts: 3,
  }, { deduplicate_active: true });
  return { entry: "command", creates_session: false, creates_turn: false, calls_model: false,
    accepted: true, mailbox, job: pgExecutionJobPublic(job) };
}

/** Worker reloads identity and permissions, rather than replaying captured user grants. */
export async function executeMailSyncJob(job: ClaimedExecutionJob, checkpoint: () => Promise<void>): Promise<Json> {
  const mailbox = String(pgExecutionJobPayload(job).mailbox || "");
  async function currentActor() {
    const row = (await postgresPool().query<Row>("SELECT * FROM users WHERE id=$1 AND active=1", [job.actor_ref])).rows[0];
    if (!row) throw new HttpFail(403, "mail sync account unavailable");
    return mapUser(row);
  }
  const user = await currentActor();
  return withScopedUser(user, async () => {
    const credential = authorizeMailSync(mailbox);
    const check = async () => {
      await checkpoint();
      // Re-check current binding/Agent eligibility between remote batches.
      const fresh = await currentActor();
      withScopedUser(fresh, () => {
        if (authorizeMailSync(mailbox) !== credential) throw new HttpFail(409, "mailbox binding changed; retry sync");
      });
    };
    return withStarryCredential(credential, async () => {
      const result = await syncFollowedKolMail(mailbox, { checkpoint: check });
      if (!result.ok) throw new Error(result.error || "mail sync failed");
      return { ok: true, mailbox, synced_at: result.synced_at, scope: "mail_index", note: "邮件索引已同步；摘要与翻译独立执行" };
    });
  });
}
