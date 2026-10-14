/**
 * Local mailbox memory (mailbox → conversation → timeline).
 * GET reads this store only: zero session, zero turn, never Codex / Starry live.
 */
import { postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { inboundIdentity, inboundByIdentity } from "./inbound-identity.js";
import { boundMailboxEmail, currentFollowScope, safeEmployeeId, starryBindingRow, starryBindingRows } from "./starry-bind.js";
import { mailboxLocalPart, normalizeEmail } from "./identity.js";
import { pgAssignments, pgPlaceholders } from "./pg-placeholders.js";
export type MatchState = "matched" | "unbound" | "deferred" | "ignored";
export type ConversationRow = {
  id: string;
  mailbox: string;
  conversation_id: string;
  collaboration_id?: string | null;
  match_state: MatchState;
  subject: string;
  peer_email: string;
  peer_name: string;
  last_at: string | null;
  last_direction: string;
  last_preview: string;
  unread_count: number;
  message_count: number;
  starred: boolean;
  last_receipt: string;
  digest_source: string;
  digest_text?: string;
  kol_uid?: string;
  handle?: string;
  stage_code?: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  provider_message_id: string;
  direction: string;
  occurred_at: string | null;
  from_addr: string;
  from_name: string;
  to_addr: string;
  subject: string;
  title: string;
  snippet: string;
  body_text?: string;
  letter_summary: string;
  summary_source: string;
  translation_zh: string | null;
  translation_source: string;
  receipt_status: string;
  effective: boolean;
  unread: boolean;
  memory_fingerprint?: string;
  memory_source?: string;
  memory_generated_at?: string | null;
  memory_error?: string;
  memory_attempts?: number;
};

export type SyncReceipt = {
  ok: boolean;
  mailbox: string;
  listed: number;
  inserted: number;
  updated: number;
  unread: number;
  synced_at: string;
  cursor_at?: string;
  error?: string;
};

export type MailBoxStatus = {
  mailbox: string;
  bound: boolean;
  unread: number;
  synced_at: string | null;
  error: string | null;
  last_tool: string | null;
  cursor_at: string | null;
  cursor_id: string | null;
  cursor_page_no: number;
};

type StarryBindingRow = Row & {
  sync_page_no?: number;
};
const MATCH_STATES = new Set<MatchState>(["matched", "unbound", "deferred", "ignored"]);
export async function currentMailbox(): Promise<string> {
  return normalizeEmail((await boundMailboxEmail()) || (await currentFollowScope()).mailbox_email || "");
}
export function matchStateOf(value: unknown, collaborationId?: unknown): MatchState {
  const raw = String(value || "").trim() as MatchState;
  if (MATCH_STATES.has(raw))
    return raw;
  return String(collaborationId || "").trim() ? "matched" : "unbound";
}
export function conversationRowOf(row: Row | Json): ConversationRow {
  const collaborationId = row.collaboration_id ? String(row.collaboration_id) : null;
  const digestText = String(row.digest_text || "");
  return {
    id: String(row.id || ""),
    mailbox: String(row.mailbox || ""),
    conversation_id: String(row.conversation_id || ""),
    ...(collaborationId ? { collaboration_id: collaborationId } : { collaboration_id: null }),
    match_state: matchStateOf(row.match_state, collaborationId),
    subject: String(row.subject || "(无主题)"),
    peer_email: String(row.peer_email || row.last_from || ""),
    peer_name: String(row.peer_name || row.last_from_name || ""),
    last_at: row.last_at ? String(row.last_at) : null,
    last_direction: String(row.last_direction || ""),
    last_preview: String(row.last_preview || ""),
    unread_count: Number(row.unread_count || 0),
    message_count: Number(row.message_count || 0),
    starred: Boolean(Number(row.starred || 0)),
    last_receipt: String(row.last_receipt || ""),
    digest_source: String(row.digest_source || ""),
    ...(digestText ? { digest_text: digestText } : {}),
    ...(row.kol_uid ? { kol_uid: String(row.kol_uid) } : {}),
    ...(row.handle ? { handle: String(row.handle) } : {}),
    ...(row.stage_code ? { stage_code: String(row.stage_code) } : {}),
  };
}

export function messageRowOf(row: Row | Json): MessageRow {
  const body = String(row.body_text || "");
  return {
    id: String(row.id || ""),
    conversation_id: String(row.conversation_id || ""),
    provider_message_id: String(row.provider_message_id || ""),
    direction: String(row.direction || "inbound") === "outbound" ? "outbound" : "inbound",
    occurred_at: row.occurred_at ? String(row.occurred_at) : null,
    from_addr: String(row.from_addr || row.from_name || ""),
    from_name: String(row.from_name || ""),
    to_addr: String(row.to_addr || ""),
    subject: String(row.subject || ""),
    title: String(row.title || ""),
    snippet: String(row.snippet || ""),
    ...(body ? { body_text: body } : {}),
    letter_summary: String(row.summary || row.summary_zh || ""),
    summary_source: String(row.summary_source || ""),
    translation_zh: row.translation_zh ? String(row.translation_zh) : null,
    translation_source: String(row.translation_source || ""),
    receipt_status: String(row.receipt_status || ""),
    effective: Boolean(Number(row.effective || 0)),
    unread: Boolean(Number(row.unread || 0)),
    memory_fingerprint: String(row.memory_fingerprint || ""),
    memory_source: String(row.memory_source || ""),
    memory_generated_at: row.memory_generated_at ? String(row.memory_generated_at) : null,
    memory_error: String(row.memory_error || ""),
    memory_attempts: Number(row.memory_attempts || 0),
  };
}
export async function threadsByCollaborationIds(ids: string[]): Promise<Map<string, Json[]>> {
  const map = new Map<string, Json[]>();
  const unique = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
  if (!unique.length)
    return map;
  const placeholders = pgPlaceholders(unique.length);
  const rows = (await postgresDb().many(`SELECT collaboration_id, conversation_id, subject, last_direction, last_snippet, last_from, last_from_name,
              unread_count, last_at, mailbox, peer_email, peer_name, last_preview, match_state, last_receipt,
              digest_source, digest_text
       FROM kol_mail_threads WHERE collaboration_id IN (${placeholders}) ORDER BY last_at DESC, updated_at DESC`, ...unique)) as Json[];
  for (const row of rows) {
    const id = String(row.collaboration_id || "");
    const list = map.get(id) || [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}
export async function threadsForCollaboration(collaborationId: string): Promise<Json[]> {
  return (await threadsByCollaborationIds([collaborationId])).get(collaborationId) || [];
}
export async function itemsForCollaboration(collaborationId: string): Promise<Json[]> {
  return (await postgresDb().many(`SELECT id, conversation_id, provider_message_id, subject, direction, snippet, unread, occurred_at, created_at,
              from_addr, from_name, to_addr, body_text, summary, summary_zh, summary_source, receipt_status, receipt_at, effective
       FROM kol_mail_items WHERE collaboration_id=$1`, collaborationId)) as Json[];
}
export async function itemsForConversation(conversationId: string, mailbox?: string): Promise<Json[]> {
  if (!conversationId)
    return [];
  if (mailbox) {
    return (await postgresDb().many(`SELECT i.* FROM kol_mail_items i
         JOIN kol_mail_threads t ON t.id = i.thread_id
         WHERE i.conversation_id=$1 AND COALESCE(t.mailbox,'')=$2
         ORDER BY i.occurred_at ASC, i.created_at ASC`, conversationId, mailbox)) as Json[];
  }
  return (await postgresDb().many(`SELECT * FROM kol_mail_items WHERE conversation_id=$1 ORDER BY occurred_at ASC, created_at ASC`, conversationId)) as Json[];
}
export async function unreadCountForCollaboration(collaborationId: string): Promise<number> {
  const row = (await postgresDb().one("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE collaboration_id=$1", collaborationId)) as {
    n: number;
  };
  return Number(row?.n || 0);
}
export async function unreadCountForMailbox(mailbox: string): Promise<number> {
  if (!mailbox) {
    const row = (await postgresDb().one("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads")) as {
      n: number;
    };
    return Number(row?.n || 0);
  }
  const row = (await postgresDb().one("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE mailbox=$1", mailbox)) as {
    n: number;
  };
  return Number(row?.n || 0);
}
export async function markCollaborationMailRead(collaborationId: string): Promise<void> {
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE kol_mail_threads SET unread_count=0, updated_at=$1 WHERE collaboration_id=$2", nowIso(), collaborationId));
    (await db.execute("UPDATE kol_mail_items SET unread=0 WHERE collaboration_id=$1", collaborationId));
  }));
}
export async function markConversationMailRead(threadId: string): Promise<void> {
  if (!threadId)
    return;
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE kol_mail_threads SET unread_count=0, updated_at=$1 WHERE id=$2", nowIso(), threadId));
    (await db.execute("UPDATE kol_mail_items SET unread=0 WHERE thread_id=$1", threadId));
  }));
}
export async function setConversationStarred(threadId: string, starred: boolean): Promise<void> {
  if (!threadId)
    return;
  (await postgresDb().execute("UPDATE kol_mail_threads SET starred=$1, updated_at=$2 WHERE id=$3", starred ? 1 : 0, nowIso(), threadId));
}
/**
 * List projection of kol_mail_threads for the mailbox page. Columns are explicit
 * (and digest_text is left out on purpose): the list payload is the page's first
 * paint, so it carries only ConversationRow's fields. Message counts come from one
 * grouped join instead of a correlated COUNT subquery per thread.
 */
const LIST_COLUMNS = `t.id, t.mailbox, t.conversation_id, t.collaboration_id, t.match_state, t.subject,
       t.peer_email, t.peer_name, t.last_from, t.last_from_name, t.last_at, t.last_direction, t.last_preview,
       t.unread_count, t.starred, t.last_receipt, t.digest_source,
       c.kol_uid, c.handle, c.stage_code, COALESCE(mc.message_count, 0) AS message_count`;
const LIST_JOINS = `FROM kol_mail_threads t
         LEFT JOIN collaborations c ON c.id=t.collaboration_id
         LEFT JOIN (SELECT thread_id, COUNT(*) AS message_count FROM kol_mail_items GROUP BY thread_id) mc
                ON mc.thread_id = t.id`;
export async function listMailboxConversations(mailbox?: string): Promise<ConversationRow[]> {
  const box = mailbox === undefined ? (await currentMailbox()) : mailbox;
  if (!box)
    return [];
  const rows = (await postgresDb().many(`SELECT ${LIST_COLUMNS}
       ${LIST_JOINS}
      WHERE t.mailbox=$1 ORDER BY t.last_at DESC, t.updated_at DESC`, box)) as Row[];
  return rows.map(conversationRowOf);
}
export async function findMailThread(id: string, mailbox?: string): Promise<Row | undefined> {
  const raw = String(id || "").trim();
  if (!raw)
    return undefined;
  const box = mailbox === undefined ? (await currentMailbox()) : mailbox;
  const allowed = (await mailboxBindings()).map((binding) => normalizeEmail(binding.mailbox));
  if (!allowed.length || (box && !allowed.includes(normalizeEmail(box))))
    return undefined;
  const byId = (await postgresDb().one("SELECT * FROM kol_mail_threads WHERE id=$1", raw)) as Row | undefined;
  if (byId && allowed.includes(normalizeEmail(String(byId.mailbox || ""))) && (!box || normalizeEmail(String(byId.mailbox || "")) === normalizeEmail(box)))
    return byId;
  if (box) {
    return (await postgresDb().one("SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND lower(mailbox)=lower($2)", raw, box)) as Row | undefined;
  }
  return (await postgresDb().one(`SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND lower(mailbox) IN (${pgPlaceholders(allowed.length, 2)}) ORDER BY updated_at DESC LIMIT 1`, raw, ...allowed)) as Row | undefined;
}
/**
 * 按 ID 找邮件（kol_mail_items），并核对归属：邮件所在会话的 mailbox 必须是本人挂载的，
 * 否则返回 undefined（不降级、不猜）。
 */
export async function findMailItem(id: string): Promise<Row | undefined> {
  const raw = String(id || "").trim();
  if (!raw)
    return undefined;
  const item = (await postgresDb().one("SELECT * FROM kol_mail_items WHERE id=$1", raw)) as Row | undefined;
  if (!item)
    return undefined;
  // 核对：item → thread → mailbox 必须在本人挂载范围内。
  const threadId = String(item.thread_id || "");
  const convId = String(item.conversation_id || "");
  let thread: Row | undefined;
  if (threadId) {
    thread = (await postgresDb().one("SELECT * FROM kol_mail_threads WHERE id=$1", threadId)) as Row | undefined;
  }
  if (!thread && convId) {
    thread = (await postgresDb().one("SELECT * FROM kol_mail_threads WHERE conversation_id=$1 ORDER BY updated_at DESC LIMIT 1", convId)) as Row | undefined;
  }
  if (!thread)
    return undefined;
  const mailbox = String(thread.mailbox || "");
  if (!mailbox)
    return undefined;
  const owned = (await mailboxBindings()).some((binding) => String(binding.mailbox || "").toLowerCase() === mailbox.toLowerCase());
  if (!owned)
    return undefined;
  return item;
}
export async function mailboxBoxStatus(mailbox?: string): Promise<MailBoxStatus> {
  const box = mailbox === undefined ? (await currentMailbox()) : mailbox;
  const userId = (await safeEmployeeId());
  const bind = userId ? (await starryBindingRow(userId, box || undefined)) as StarryBindingRow | undefined : undefined;
  const unread = box ? (await unreadCountForMailbox(box)) : 0;
  return {
    mailbox: box || String(bind?.mailbox_email || ""),
    bound: Boolean(box || bind?.mailbox_email),
    unread,
    synced_at: bind?.synced_at ? String(bind.synced_at) : null,
    error: bind?.last_error ? String(bind.last_error) : null,
    last_tool: bind?.last_tool ? String(bind.last_tool) : null,
    cursor_at: bind?.sync_cursor_at ? String(bind.sync_cursor_at) : null,
    cursor_id: bind?.sync_cursor_id ? String(bind.sync_cursor_id) : null,
    cursor_page_no: bind?.sync_page_no ?? 1,
  };
}

export type MailboxBinding = {
  mailbox: string;
  label: string;
  owner_name: string;
  brand: string;
  region: string;
  unread: number;
  bound: boolean;
  synced_at: string | null;
  error: string | null;
};

/**
 * One entry per binding row of the current user. Brand metadata comes from the
 * mailbox_owners table when present; there is no per-mailbox region source yet
 * and none may be invented from the address.
 */
export async function mailboxBindings(): Promise<MailboxBinding[]> {
  const userId = (await safeEmployeeId());
  const rows = userId ? (await starryBindingRows(userId)) : [];
  return await Promise.all(rows.map(async (row) => {
    const mailbox = String(row.mailbox_email || "").trim();
    const owner = mailbox
      ? (await postgresDb().one("SELECT brand, owner_name FROM mailbox_owners WHERE email=$1", mailbox)) as Row | undefined
      : undefined;
    const ownerName = String(row.owner_name || owner?.owner_name || "");
    return {
      mailbox,
      label: ownerName || mailboxLocalPart(mailbox) || mailbox,
      owner_name: ownerName,
      brand: String(owner?.brand || ""),
      region: "",
      unread: (await unreadCountForMailbox(mailbox)),
      bound: Boolean(mailbox),
      synced_at: row.synced_at ? String(row.synced_at) : null,
      error: row.last_error ? String(row.last_error) : null,
    };
  }));
}
export async function updateBindingSyncCursor(input: {
  userId?: string;
  mailbox?: string;
  syncedAt: string;
  cursorAt?: string;
  cursorId?: string;
  pageNo?: number;
  error?: string;
  tool?: string;
}): Promise<void> {
  const userId = String(input.userId || (await safeEmployeeId()) || "");
  if (!userId)
    return;
  const box = String(input.mailbox || "").trim();
  const existing = (await starryBindingRow(userId, box || undefined)) as StarryBindingRow | undefined;
  if (!existing)
    return;
  (await postgresDb().execute(`UPDATE user_starry_bindings
     SET sync_cursor_at=$1, sync_cursor_id=$2, sync_page_no=$3, synced_at=$4, last_error=$5, last_tool=$6, updated_at=$7
     WHERE user_id=$8 AND mailbox_email=$9`, input.cursorAt || existing.sync_cursor_at || "", input.cursorId || existing.sync_cursor_id || "", Number.isFinite(input.pageNo) ? input.pageNo : (existing.sync_page_no ?? 1), input.syncedAt, input.error || "", input.tool || "pageEmailConversations", nowIso(), userId, String(existing.mailbox_email || "")));
}
export async function persistThreadDigest(threadId: string, digest: {
  text?: string;
  source?: string;
  fingerprint?: string;
  generated_at?: string;
  error?: string;
  failed_at?: string;
  mail_count?: number;
}): Promise<void> {
  if (!threadId)
    return;
  (await postgresDb().execute(`UPDATE kol_mail_threads
     SET digest_text=$1, digest_source=$2, digest_fingerprint=$3, digest_error=$4, digest_failed_at=$5, digest_mail_count=$6
     WHERE id=$7`, String(digest.text || ""), String(digest.source || ""), String(digest.fingerprint || ""), digest.error ? String(digest.error) : "", digest.failed_at ? String(digest.failed_at) : "", Number(digest.mail_count || 0), threadId));
}
export async function persistItemMemory(itemId: string, memory: {
  summary?: string;
  summary_zh?: string;
  summary_source?: string;
  translation_zh?: string;
  translation_source?: string;
  fingerprint?: string;
  source?: string;
  generated_at?: string;
  error?: string;
  attempts?: number;
}): Promise<void> {
  if (!itemId)
    return;
  const columns: string[] = [];
  const values: unknown[] = [];
  if (memory.summary !== undefined) {
    columns.push("summary");
    values.push(memory.summary);
  }
  if (memory.summary_zh !== undefined) {
    columns.push("summary_zh");
    values.push(memory.summary_zh);
  }
  if (memory.summary_source !== undefined) {
    columns.push("summary_source");
    values.push(memory.summary_source);
  }
  if (memory.translation_zh !== undefined) {
    columns.push("translation_zh");
    values.push(memory.translation_zh);
  }
  if (memory.translation_source !== undefined) {
    columns.push("translation_source");
    values.push(memory.translation_source);
  }
  if (memory.fingerprint !== undefined) {
    columns.push("memory_fingerprint");
    values.push(memory.fingerprint);
  }
  if (memory.source !== undefined) {
    columns.push("memory_source");
    values.push(memory.source);
  }
  if (memory.generated_at !== undefined) {
    columns.push("memory_generated_at");
    values.push(memory.generated_at);
  }
  if (memory.error !== undefined) {
    columns.push("memory_error");
    values.push(memory.error);
  }
  if (memory.attempts !== undefined) {
    columns.push("memory_attempts");
    values.push(memory.attempts);
  }
  if (!columns.length)
    return;
  await postgresDb().execute(`UPDATE kol_mail_items SET ${pgAssignments(columns)} WHERE id=$${values.length + 1}`, ...values, itemId);
}
export async function markItemMemoryPending(itemId: string): Promise<void> {
  if (!itemId)
    return;
  (await postgresDb().execute(`UPDATE kol_mail_items
     SET memory_source='pending', memory_generated_at=NULL, memory_error=''
     WHERE id=$1 AND COALESCE(memory_source,'') != 'pending'`, itemId));
}
export async function markThreadTranslationsPending(threadId: string): Promise<void> {
  if (!threadId)
    return;
  (await postgresDb().execute(`UPDATE kol_mail_items
     SET translation_source='pending', memory_source='pending', memory_generated_at=NULL, memory_error=''
     WHERE thread_id=$1 AND translation_zh IS NULL AND COALESCE(body_text,'') != ''
       AND COALESCE(translation_source,'') = ''`, threadId));
}
export async function projectUnboundInbound(input: {
  mailbox: string;
  conversationId: string;
  providerMessageId?: string;
  fromAddr?: string;
  fromName?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  occurredAt?: string;
}): Promise<void> {
  const identity = inboundIdentity({
    provider_message_id: input.providerMessageId,
    collaboration_id: "",
    subject: input.subject,
    body: input.body || input.snippet,
    conversation_id: input.conversationId,
  });
  if ((await inboundByIdentity({
    provider_message_id: identity.provider_message_id,
    identity_hash: identity.identity_hash,
  })))
    return;
  (await postgresDb().execute(`INSERT INTO inbound
     (id, from_addr, from_name, subject, snippet, summary, bound, deferred, collaboration_id, session_id, confidence, candidates, ts, provider_message_id, identity_hash, mailbox)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, nid("inb"), input.fromAddr || "", input.fromName || "", input.subject || "", (input.snippet || input.body || "").slice(0, 280), "", 0, 0, null, null, "low", "[]", input.occurredAt || nowIso(), identity.provider_message_id || null, identity.identity_hash, input.mailbox || ""));
}
