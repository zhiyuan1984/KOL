/**
 * PG-backed storage helpers for the mail sync pipeline.
 *
 * P2 of the mail-sync PG migration (20261008_mail_sync_pg): replaces the
 * SQLite reads/writes in starrykol/mail-sync.ts with PostgreSQL equivalents:
 *   - app_state watermark        -> mail_sync_state
 *   - user_starry_bindings reads  -> PG mirror table
 *   - collaborations reads       -> PG legacy mirror (sync-subset columns)
 *   - kol_mail_threads digest    -> PG kol_mail_threads
 *   - kol_mail_items translations-> PG kol_mail_items
 *   - audit()                    -> mail_sync_audit
 *
 * Behavior parity with the SQLite versions; no business-logic changes.
 * Legacy SQLite consumers (mail-memory-job, mail-summary, operations) keep
 * using the old helpers — they are a separate migration concern.
 */
import { memoryCompanyId } from "../host/kol-memory.js";
import { postgresPool } from "../postgres/pool.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import type { ThreadDigest } from "../host/mail-summary.js";

const nowIso = (): string => new Date().toISOString();
const toTs = (value: unknown): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/* ------------------------------------------------------------------ */
/* sync watermark (was: SQLite app_state)                               */
/* ------------------------------------------------------------------ */

export async function mailSyncStateGet(key: string): Promise<string | undefined> {
  const r = await postgresPool().query<{ value: string }>(
    "SELECT value FROM mail_sync_state WHERE key=$1", [key],
  );
  return r.rows[0]?.value;
}

export async function mailSyncStateSet(key: string, value: string): Promise<void> {
  await postgresPool().query(
    `INSERT INTO mail_sync_state(key, value, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`,
    [key, value, nowIso()],
  );
}

/* ------------------------------------------------------------------ */
/* unread counts (was: SQLite kol_mail_threads)                         */
/* ------------------------------------------------------------------ */

export async function unreadCountForMailboxPg(mailbox: string): Promise<number> {
  const db = postgresPool();
  const r = mailbox
    ? await db.query<{ n: string }>(
        "SELECT COALESCE(SUM(unread_count),0)::text AS n FROM kol_mail_threads WHERE mailbox=$1", [mailbox])
    : await db.query<{ n: string }>(
        "SELECT COALESCE(SUM(unread_count),0)::text AS n FROM kol_mail_threads");
  return Number(r.rows[0]?.n || 0);
}

/* ------------------------------------------------------------------ */
/* starry bindings (was: SQLite user_starry_bindings)                   */
/* ------------------------------------------------------------------ */

export type BindingHealth = {
  synced_at?: string;
  last_error?: string;
  last_tool?: string;
  sync_cursor_at?: string;
};

export async function bindingHealthPg(userId: string): Promise<BindingHealth | undefined> {
  if (!userId) return undefined;
  const r = await postgresPool().query<Row>(
    `SELECT synced_at, last_error, last_tool, sync_cursor_at FROM user_starry_bindings
     WHERE user_id=$1 ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC LIMIT 1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return undefined;
  return {
    synced_at: row.synced_at ? String(row.synced_at) : undefined,
    last_error: row.last_error ? String(row.last_error) : undefined,
    last_tool: row.last_tool ? String(row.last_tool) : undefined,
    sync_cursor_at: row.sync_cursor_at ? String(row.sync_cursor_at) : undefined,
  };
}

export async function bindingPageNoPg(userId: string, mailbox: string): Promise<number> {
  if (!userId) return 1;
  const db = postgresPool();
  const r = mailbox
    ? await db.query<{ sync_page_no: number }>(
        "SELECT sync_page_no FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", [userId, mailbox])
    : await db.query<{ sync_page_no: number }>(
        `SELECT sync_page_no FROM user_starry_bindings WHERE user_id=$1
         ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC LIMIT 1`, [userId]);
  return Number(r.rows[0]?.sync_page_no ?? 1);
}

export async function updateBindingSyncCursorPg(input: {
  userId?: string;
  mailbox?: string;
  syncedAt: string;
  cursorAt?: string;
  cursorId?: string;
  pageNo?: number;
  error?: string;
  tool?: string;
}): Promise<void> {
  const userId = String(input.userId || "");
  if (!userId) return;
  const box = String(input.mailbox || "").trim();
  const db = postgresPool();
  const existing = (await db.query<Row>(
    box
      ? "SELECT * FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2"
      : `SELECT * FROM user_starry_bindings WHERE user_id=$1
         ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC LIMIT 1`,
    box ? [userId, box] : [userId],
  )).rows[0];
  if (!existing) return;
  await db.query(
    `UPDATE user_starry_bindings
     SET sync_cursor_at=$1, sync_cursor_id=$2, sync_page_no=$3, synced_at=$4,
         last_error=$5, last_tool=$6, updated_at=$7
     WHERE user_id=$8 AND mailbox_email=$9`,
    [
      toTs(input.cursorAt) || (existing.sync_cursor_at ? String(existing.sync_cursor_at) : null),
      input.cursorId || String(existing.sync_cursor_id || "") || null,
      Number.isFinite(input.pageNo) ? input.pageNo : Number(existing.sync_page_no ?? 1),
      toTs(input.syncedAt),
      input.error || "",
      input.tool || "pageEmailConversations",
      nowIso(),
      userId,
      String(existing.mailbox_email || ""),
    ],
  );
}

/* ------------------------------------------------------------------ */
/* collaborations legacy mirror (was: SQLite collaborations)            */
/* ------------------------------------------------------------------ */

export async function listBoundCollaborationsPg(): Promise<Row[]> {
  const r = await postgresPool().query<Row>(
    `SELECT c.*,o.owner_open_id,o.owner_mailbox AS verified_owner_mailbox,(health.state='ready') AS ownership_source_ready FROM collaborations c LEFT JOIN starry_profile_ownership o
      ON o.company_id=$1 AND o.kol_uid=c.kol_uid LEFT JOIN starry_ownership_sync_state health ON health.company_id=o.company_id WHERE c.kol_uid IS NOT NULL AND trim(c.kol_uid) != ''`,[memoryCompanyId()],
  );
  return r.rows;
}

export async function collaborationByIdPg(id: string): Promise<Row | undefined> {
  if (!id) return undefined;
  const r = await postgresPool().query<Row>(
    "SELECT * FROM collaborations WHERE id=$1", [id],
  );
  return r.rows[0];
}

export async function updateCollaborationConversationPg(conversationId: string, collabId: string): Promise<void> {
  if (!conversationId || !collabId) return;
  await postgresPool().query(
    "UPDATE collaborations SET conversation_id=$1 WHERE id=$2",
    [conversationId, collabId],
  );
}

/* ------------------------------------------------------------------ */
/* thread digest (was: SQLite kol_mail_threads)                         */
/* ------------------------------------------------------------------ */

export async function storedDigestPg(threadId: string): Promise<ThreadDigest | null> {
  if (!threadId) return null;
  const r = await postgresPool().query<Row>(
    `SELECT digest_text, digest_source, digest_mail_count, digest_fingerprint, digest_error, digest_failed_at
     FROM kol_mail_threads WHERE id=$1`,
    [threadId],
  );
  const row = r.rows[0];
  if (!row || (!row.digest_text && !row.digest_source)) return null;
  return {
    text: String(row.digest_text || ""),
    source: String(row.digest_source || ""),
    mail_count: Number(row.digest_mail_count || 0),
    fingerprint: String(row.digest_fingerprint || ""),
    error: row.digest_error ? String(row.digest_error) : undefined,
    failed_at: row.digest_failed_at ? String(row.digest_failed_at) : undefined,
  } as ThreadDigest;
}

export async function persistThreadDigestPg(threadId: string, digest: {
  text?: string;
  source?: string;
  fingerprint?: string;
  error?: string;
  failed_at?: string;
  mail_count?: number;
}): Promise<void> {
  if (!threadId) return;
  await postgresPool().query(
    `UPDATE kol_mail_threads
     SET digest_text=$1, digest_source=$2, digest_fingerprint=$3, digest_error=$4,
         digest_failed_at=$5, digest_mail_count=$6
     WHERE id=$7`,
    [
      String(digest.text || ""),
      String(digest.source || ""),
      String(digest.fingerprint || ""),
      digest.error ? String(digest.error) : "",
      toTs(digest.failed_at),
      Number(digest.mail_count || 0),
      threadId,
    ],
  );
}

export async function updateThreadAfterHydratePg(input: {
  threadId: string;
  subject: string;
  snippet: string;
  preview: string;
  fromEmail: string;
  fromName: string;
  occurredAt: string;
}): Promise<void> {
  await postgresPool().query(
    `UPDATE kol_mail_threads
     SET subject=$1, last_snippet=$2, last_preview=$3, last_from=$4, last_from_name=$5,
         last_at=$6, updated_at=$7
     WHERE id=$8`,
    [
      input.subject, input.snippet, input.preview, input.fromEmail, input.fromName,
      toTs(input.occurredAt) || nowIso(), nowIso(), input.threadId,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* item translations (was: SQLite kol_mail_items)                       */
/* ------------------------------------------------------------------ */

export async function markThreadTranslationsPendingPg(threadId: string): Promise<void> {
  if (!threadId) return;
  await postgresPool().query(
    `UPDATE kol_mail_items SET translation_source='pending'
     WHERE thread_id=$1 AND translation_zh IS NULL AND COALESCE(body_text,'') != ''
       AND COALESCE(translation_source,'') = ''`,
    [threadId],
  );
}

export async function ensureThreadItemTranslationsPg(
  threadId: string,
  translate: (body: string) => Promise<{ text: string; source: string } | null>,
  analysisEnabled: () => boolean,
): Promise<void> {
  if (!threadId) return;
  const r = await postgresPool().query<{ id: string; body_text: string }>(
    `SELECT id, body_text FROM kol_mail_items
     WHERE thread_id=$1 AND translation_zh IS NULL AND COALESCE(body_text,'') != ''`,
    [threadId],
  );
  if (!r.rows.length) return;
  if (!analysisEnabled()) {
    await markThreadTranslationsPendingPg(threadId);
    return;
  }
  for (const row of r.rows) {
    try {
      const translated = await translate(row.body_text);
      if (translated) {
        await postgresPool().query(
          "UPDATE kol_mail_items SET translation_zh=$1, translation_source=$2 WHERE id=$3",
          [translated.text, translated.source, row.id],
        );
      } else {
        await postgresPool().query(
          "UPDATE kol_mail_items SET translation_source='pending' WHERE id=$1 AND translation_zh IS NULL",
          [row.id],
        );
      }
    } catch {
      await postgresPool().query(
        "UPDATE kol_mail_items SET translation_source='pending' WHERE id=$1 AND translation_zh IS NULL",
        [row.id],
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* sync audit (was: SQLite audit_events via audit())                     */
/* ------------------------------------------------------------------ */

export async function mailSyncAudit(actor: string, eventType: string, payload: Json): Promise<void> {
  try {
    await postgresPool().query(
      "INSERT INTO mail_sync_audit(id, ts, actor, event_type, payload_json) VALUES ($1,$2,$3,$4,$5)",
      [nid("msa"), nowIso(), actor, eventType, JSON.stringify(payload ?? {})],
    );
  } catch {
    // Audit must never break the sync itself.
  }
}

/** Items of one conversation, oldest first (was: SQLite itemsForConversation). */
export async function itemsForConversationPg(conversationId: string, mailbox?: string): Promise<Json[]> {
  if (!conversationId) return [];
  const db = postgresPool();
  const r = mailbox
    ? await db.query<Row>(
        `SELECT i.* FROM kol_mail_items i
         JOIN kol_mail_threads t ON t.id = i.thread_id
         WHERE i.conversation_id=$1 AND COALESCE(t.mailbox,'')=$2
         ORDER BY i.occurred_at ASC, i.created_at ASC`,
        [conversationId, mailbox],
      )
    : await db.query<Row>(
        `SELECT i.* FROM kol_mail_items i
         WHERE i.conversation_id=$1
         ORDER BY i.occurred_at ASC, i.created_at ASC`,
        [conversationId],
      );
  return r.rows as Json[];
}
