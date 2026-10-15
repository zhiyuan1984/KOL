import { scopedUser, withScopedUser, type AppUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { normalizeEmail } from "../host/identity.js";
import { nid } from "../ids.js";
import { postgresPool } from "../postgres/pool.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload, pgExecutionJobPublic } from "../execution-jobs/postgres-store.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { syncFollowedKolMail, type MailSyncAuthorizedScope, type MailSyncProgress } from "../starrykol/mail-sync.js";
import { withStarryConnectorAuth } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";

type MailSyncAuthorization = {
  actor: AppUser;
  credentialId: string;
  scope: MailSyncAuthorizedScope;
};

export type MailSyncDispatchFailure = {
  code: string;
  summary: string;
  terminal: boolean;
  retryAfterMs?: number;
};

const MAIL_SYNC_SKILLS = ["email_conversation_list", "email_conversation_read"] as const;
const TERMINAL_MAIL_SYNC_CODES = new Set([
  "mail_source_unauthorized", "mail_source_forbidden", "mail_source_not_found", "mail_sync_storage_unavailable",
  "mailbox_access_denied", "mailbox_credential_required", "starry_credential_migration_required",
  "agent_not_usable", "mail_sync_account_unavailable", "mailbox_binding_changed",
]);

function stringArray(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

function nativeActor(row: Row): AppUser {
  const roles = stringArray(row.roles);
  const username = String(row.username || row.id || "");
  return {
    id: String(row.id), username, name: String(row.name || username), handle: username,
    email: String(row.email || (username.includes("@") ? username : "")), phone: String(row.phone || ""),
    roles, role: roles.includes("admin") ? "admin" : roles[0] || "employee", brands: stringArray(row.brands),
    site: String(row.site || ""), manager_user_id: row.manager_user_id ? String(row.manager_user_id) : null,
    active: Number(row.active) === 1 || row.active === true,
    // Index reads do not use exam state; avoid the retired synchronous adapter.
    exam_passed: true, exam_todo_count: 0, exam_module: "",
  };
}

async function activeActor(userId: string): Promise<AppUser> {
  const row = (await postgresPool().query<Row>("SELECT * FROM users WHERE id=$1 AND active=1", [userId])).rows[0];
  if (!row) throw new HttpFail(403, { code: "mail_sync_account_unavailable" });
  return nativeActor(row);
}

/** PostgreSQL equivalent of canUseSkill/canUseAgent. It retains direct person,
 * member/head descendant, and ancestor-head Agent coverage; admins retain the
 * established explicit bypass. */
async function actorCanUseMailSkill(actor: AppUser, skillId: string): Promise<boolean> {
  if (actor.roles.includes("admin")) return true;
  const result = await postgresPool().query<{ permitted: boolean }>(
    `WITH RECURSIVE unit_tree AS (
       SELECT id AS ancestor_id,id AS descendant_id,company_id FROM organization_units WHERE status='active'
       UNION
       SELECT tree.ancestor_id,child.id,tree.company_id FROM unit_tree tree
       JOIN organization_units child ON child.parent_id=tree.descendant_id
        AND child.company_id=tree.company_id AND child.status='active'
     ), actor_people AS (
       SELECT person_ref FROM organization_people WHERE user_id=$1 AND status='active'
       UNION ALL SELECT 'person:user:' || $1
        WHERE NOT EXISTS (SELECT 1 FROM organization_people WHERE user_id=$1 AND status='active')
     )
     SELECT EXISTS (
       SELECT 1 FROM runtime_agent_skills skill
       JOIN managed_agents agent ON agent.id=skill.agent_id AND agent.status='published'
       JOIN agent_bindings binding ON binding.agent_id=skill.agent_id AND binding.status='active'
       WHERE skill.skill_id=$2 AND skill.enabled=1 AND (
         (binding.target_type='person' AND (
           binding.target_id IN (SELECT person_ref FROM actor_people)
           OR EXISTS (
             SELECT 1 FROM organization_memberships target_member
             JOIN unit_tree tree ON tree.descendant_id=target_member.org_unit_id AND tree.company_id=binding.company_id
             JOIN organization_units ancestor ON ancestor.id=tree.ancestor_id AND ancestor.company_id=binding.company_id AND ancestor.status='active'
             WHERE target_member.person_ref=binding.target_id AND target_member.company_id=binding.company_id
               AND target_member.status='active' AND ancestor.head_person_ref IN (SELECT person_ref FROM actor_people)
           )
         ))
         OR (binding.target_type='organization_unit' AND (
           EXISTS (
             SELECT 1 FROM organization_memberships member
             JOIN unit_tree tree ON tree.descendant_id=member.org_unit_id
              AND tree.ancestor_id=binding.target_id AND tree.company_id=binding.company_id
             WHERE member.company_id=binding.company_id AND member.status='active'
               AND member.person_ref IN (SELECT person_ref FROM actor_people)
           )
           OR EXISTS (
             SELECT 1 FROM unit_tree tree
             JOIN organization_units descendant ON descendant.id=tree.descendant_id
              AND descendant.company_id=binding.company_id AND descendant.status='active'
             WHERE tree.ancestor_id=binding.target_id AND tree.company_id=binding.company_id
               AND descendant.head_person_ref IN (SELECT person_ref FROM actor_people)
           )
           OR EXISTS (
             SELECT 1 FROM unit_tree tree
             JOIN organization_units ancestor ON ancestor.id=tree.ancestor_id
              AND ancestor.company_id=binding.company_id AND ancestor.status='active'
             WHERE tree.descendant_id=binding.target_id AND tree.company_id=binding.company_id
               AND ancestor.head_person_ref IN (SELECT person_ref FROM actor_people)
           )
         ))
       )
     ) AS permitted`,
    [actor.id, skillId],
  );
  return Boolean(result.rows[0]?.permitted);
}

/** Direct PG authorization used by request, operation-job scope reads, and
 * every worker checkpoint. No synchronous binding or skill adapter is used. */
export async function authorizeMailSync(mailbox: string): Promise<MailSyncAuthorization> {
  const scoped = scopedUser();
  if (!scoped?.active) throw new HttpFail(401, "authentication required");
  const actor = await activeActor(scoped.id);
  const box = normalizeEmail(mailbox);
  if (!box) throw new HttpFail(403, { code: "mailbox_access_denied" });
  for (const skill of MAIL_SYNC_SKILLS) {
    if (!await actorCanUseMailSkill(actor, skill)) throw new HttpFail(403, { code: "agent_not_usable", skill_id: skill });
  }
  const binding = (await postgresPool().query<Row>(
    `SELECT mailbox_email,owner_name,owner_open_id,owner_verified_at,bearer_token
       FROM user_starry_bindings
      WHERE user_id=$1 AND lower(mailbox_email)=lower($2) AND status='connected'`,
    [actor.id, box],
  )).rows[0];
  if (!binding) throw new HttpFail(403, { code: "mailbox_access_denied" });
  const credentialId = String(binding.bearer_token || "").trim();
  if (!credentialId) throw new HttpFail(409, { code: "mailbox_credential_required" });
  if (!/^cred_[A-Za-z0-9_-]{8,160}$/.test(credentialId)) throw new HttpFail(409, { code: "starry_credential_migration_required" });
  return {
    actor, credentialId,
    scope: {
      required: true, bound: true, status: "connected", mailbox_email: String(binding.mailbox_email),
      owner_name: String(binding.owner_name || ""), owner_open_id: String(binding.owner_open_id || ""),
      owner_verified_at: binding.owner_verified_at ? String(binding.owner_verified_at) : null,
    },
  };
}

export async function startMailSyncJob(input: Json): Promise<Json> {
  const mailbox = normalizeEmail(String(input.box || ""));
  const authorization = await authorizeMailSync(mailbox);
  const actor = authorization.actor.id;
  const requestId = String(input.request_id || nid("sync"));
  if (!/^[\w-]{1,160}$/.test(requestId)) throw new HttpFail(400, "invalid request_id");
  const conversationId = input.conversation_id === undefined ? "" : String(input.conversation_id || "").trim();
  if (conversationId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(conversationId)) throw new HttpFail(400, "invalid conversation_id");
  const { job } = await pgEnqueueExecutionJob({
    job_type: "mail.sync", actor_ref: actor, tenant_ref: actor,
    idempotency_key: `mail.sync:${actor}:${mailbox}:${requestId}`,
    object_ref: { mailbox }, scope_snapshot: { mailbox },
    payload: { mailbox, ...(conversationId ? { conversation_id: conversationId } : {}) },
    risk_level: "low", max_attempts: 3,
  }, { deduplicate_active: true });
  return { entry: "command", creates_session: false, creates_turn: false, calls_model: false,
    accepted: true, mailbox, job: { ...pgExecutionJobPublic(job), progress: { index: null, body: null } } };
}

function receiptProgress(progress: MailSyncProgress): Json {
  return { index: progress.index, body: progress.body } as Json;
}

async function persistMailSyncReceipt(job: ClaimedExecutionJob, checkpoint: () => Promise<void>, receipt: Json): Promise<void> {
  await checkpoint();
  const updated = await postgresPool().query(
    `UPDATE execution_jobs
        SET receipt_json=(COALESCE(NULLIF(receipt_json,'')::jsonb,'{}'::jsonb) || $1::jsonb)::text,updated_at=$2
      WHERE id=$3 AND status='running' AND lease_owner=$4
      RETURNING id`,
    [JSON.stringify(receipt), new Date().toISOString(), job.id, job.worker_id],
  );
  if (!updated.rows[0]) throw new Error("execution_job_claim_lost_or_cancelled");
}

function boundedRetryAfter(value: unknown): number | undefined {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.min(120_000, Math.round(milliseconds)) : undefined;
}

/** Used exclusively by dispatcher.ts's mail.sync branch so HttpFail JSON does
 * not become execution_handler_error and Retry-After survives safely. */
export function mailSyncDispatchFailure(error: unknown): MailSyncDispatchFailure | undefined {
  if (!(error instanceof HttpFail) || !error.detail || typeof error.detail !== "object" || Array.isArray(error.detail)) return undefined;
  const detail = error.detail as Record<string, unknown>;
  const code = String(detail.code || "");
  if (!code || (!code.startsWith("mail_") && !code.startsWith("mailbox_") && code !== "agent_not_usable" && code !== "starry_credential_migration_required")) return undefined;
  const retryAfterMs = boundedRetryAfter(detail.retry_after_ms);
  return {
    code,
    summary: String(detail.message || "邮件同步暂时失败，已保留本地邮件，可重试。").slice(0, 300),
    terminal: TERMINAL_MAIL_SYNC_CODES.has(code) || error.status === 401 || error.status === 403,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function fallbackProgress(result: { ok: boolean; listed?: number; inserted?: number; updated?: number; cursor_at?: string; body_pending?: number; body_completed?: number; body_failed?: number }): MailSyncProgress {
  const pending = Number(result.body_pending || 0);
  const completed = Number(result.body_completed || 0);
  const failed = Number(result.body_failed || 0);
  return {
    index: { phase: result.ok ? "completed" : "partial_failed", listed: Number(result.listed || 0), inserted: Number(result.inserted || 0), updated: Number(result.updated || 0), cursor_at: result.cursor_at || null, cursor_id: null, page_no: 1 },
    body: { phase: result.ok ? "completed" : "partial_failed", requested: pending + completed + failed, completed, failed, pending },
  };
}

/** Worker reloads identity, Agent skills, credential reference and mailbox scope
 * before the first request and again at each page/body checkpoint. */
export async function executeMailSyncJob(job: ClaimedExecutionJob, checkpoint: () => Promise<void>): Promise<Json> {
  const payload = pgExecutionJobPayload(job) as Record<string, unknown>;
  const mailbox = normalizeEmail(String(payload.mailbox || ""));
  const conversationId = String(payload.conversation_id || "").trim();
  let authorization: MailSyncAuthorization | undefined;
  let latestProgress: MailSyncProgress | undefined;
  const authorizeCurrent = async () => {
    const actor = await activeActor(String(job.actor_ref));
    return await withScopedUser(actor, async () => (await authorizeMailSync(mailbox)));
  };
  const initial = await authorizeCurrent();
  authorization = initial;
  const check = async () => {
    await checkpoint();
    const fresh = await authorizeCurrent();
    if (!authorization || fresh.credentialId !== authorization.credentialId || fresh.scope.mailbox_email.toLowerCase() !== authorization.scope.mailbox_email.toLowerCase()) {
      throw new HttpFail(409, { code: "mailbox_binding_changed", message: "邮箱绑定已变更，请重新发起同步。" });
    }
    authorization = fresh;
  };
  // The binding stays the authorization boundary; it must not replace the
  // verified organization connector Authorization used to read the mailbox.
  return await withScopedUser(initial.actor, async () => (await withStarryConnectorAuth(async () => {
    const onProgress = async (progress: MailSyncProgress) => {
      latestProgress = progress;
      await persistMailSyncReceipt(job, check, {
        state: "running", mailbox, scope: "mail_index", ...receiptProgress(progress),
        ai: { summary: "not_generated", translation: "not_generated" },
      });
    };
    const result = await syncFollowedKolMail(mailbox, {
      checkpoint: check, onProgress, actorId: initial.actor.id, authorizedScope: initial.scope, conversationId,
    });
    const progress = latestProgress || fallbackProgress(result);
    if (!result.ok) {
      await persistMailSyncReceipt(job, check, {
        state: "failed", mailbox, scope: "mail_index", ...receiptProgress(progress),
        failure: { code: result.error_code || "mail_sync_failed", http_status: result.http_status || null,
          retry_after_ms: result.retry_after_ms || null, diagnostic_id: result.diagnostic_id || null },
      });
      throw new HttpFail(result.http_status === 401 || result.http_status === 403 ? result.http_status : 503, {
        code: result.error_code || "mail_sync_failed", message: result.error || "邮件同步暂时失败，已保留本地邮件，可重试。",
        diagnostic_id: result.diagnostic_id || null, retry_after_ms: result.retry_after_ms || null,
      });
    }
    return {
      ok: true, mailbox, synced_at: result.synced_at, scope: "mail_index",
      note: "邮件索引已同步；正文补全完成；摘要与翻译未生成。", diagnostic_id: result.diagnostic_id || null,
      ...receiptProgress(progress), ai: { summary: "not_generated", translation: "not_generated" },
    };
  })));
}
