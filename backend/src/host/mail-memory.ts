/**
 * Local mailbox memory (mailbox → conversation → timeline).
 * GET reads this store only: zero session, zero turn, never Codex / Starry live.
 */
import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { inboundIdentity, inboundByIdentity } from "./inbound-identity.js";
import { boundMailboxEmail, currentFollowScope, safeEmployeeId, starryBindingRow } from "./starry-bind.js";
import { mailboxLocalPart, normalizeEmail } from "./identity.js";

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
  starred: boolean;
  last_receipt: string;
  digest_source: string;
  digest_text?: string;
  kol_uid?: string;
  handle?: string;
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
  snippet: string;
  body_text?: string;
  letter_summary: string;
  summary_source: string;
  translation_zh: string | null;
  translation_source: string;
  receipt_status: string;
  effective: boolean;
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

export function currentMailbox(): string {
  return normalizeEmail(boundMailboxEmail() || currentFollowScope().mailbox_email || "");
}

export function matchStateOf(value: unknown, collaborationId?: unknown): MatchState {
  const raw = String(value || "").trim() as MatchState;
  if (MATCH_STATES.has(raw)) return raw;
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
    starred: Boolean(Number(row.starred || 0)),
    last_receipt: String(row.last_receipt || ""),
    digest_source: String(row.digest_source || ""),
    ...(digestText ? { digest_text: digestText } : {}),
    ...(row.kol_uid ? { kol_uid: String(row.kol_uid) } : {}),
    ...(row.handle ? { handle: String(row.handle) } : {}),
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
    snippet: String(row.snippet || ""),
    ...(body ? { body_text: body } : {}),
    letter_summary: String(row.summary || row.summary_zh || ""),
    summary_source: String(row.summary_source || ""),
    translation_zh: row.translation_zh ? String(row.translation_zh) : null,
    translation_source: String(row.translation_source || ""),
    receipt_status: String(row.receipt_status || ""),
    effective: Boolean(Number(row.effective || 0)),
  };
}

export function threadsByCollaborationIds(ids: string[]): Map<string, Json[]> {
  const map = new Map<string, Json[]>();
  const unique = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
  if (!unique.length) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = getConn()
    .prepare(
      `SELECT collaboration_id, conversation_id, subject, last_direction, last_snippet, last_from, last_from_name,
              unread_count, last_at, mailbox, peer_email, peer_name, last_preview, match_state, last_receipt,
              digest_source, digest_text
       FROM kol_mail_threads WHERE collaboration_id IN (${placeholders}) ORDER BY last_at DESC, updated_at DESC`,
    )
    .all(...unique) as Json[];
  for (const row of rows) {
    const id = String(row.collaboration_id || "");
    const list = map.get(id) || [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

export function threadsForCollaboration(collaborationId: string): Json[] {
  return threadsByCollaborationIds([collaborationId]).get(collaborationId) || [];
}

export function itemsForCollaboration(collaborationId: string): Json[] {
  return getConn()
    .prepare(
      `SELECT id, conversation_id, provider_message_id, subject, direction, snippet, unread, occurred_at, created_at,
              from_addr, from_name, to_addr, body_text, summary, summary_zh, summary_source, receipt_status, receipt_at, effective
       FROM kol_mail_items WHERE collaboration_id=?`,
    )
    .all(collaborationId) as Json[];
}

export function itemsForConversation(conversationId: string, mailbox?: string): Json[] {
  if (!conversationId) return [];
  if (mailbox) {
    return getConn()
      .prepare(
        `SELECT i.* FROM kol_mail_items i
         JOIN kol_mail_threads t ON t.id = i.thread_id
         WHERE i.conversation_id=? AND IFNULL(t.mailbox,'')=?
         ORDER BY i.occurred_at ASC, i.created_at ASC`,
      )
      .all(conversationId, mailbox) as Json[];
  }
  return getConn()
    .prepare(
      `SELECT * FROM kol_mail_items WHERE conversation_id=? ORDER BY occurred_at ASC, created_at ASC`,
    )
    .all(conversationId) as Json[];
}

export function unreadCountForCollaboration(collaborationId: string): number {
  const row = getConn()
    .prepare("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE collaboration_id=?")
    .get(collaborationId) as { n: number };
  return Number(row?.n || 0);
}

export function unreadCountForMailbox(mailbox: string): number {
  if (!mailbox) {
    const row = getConn().prepare("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads").get() as { n: number };
    return Number(row?.n || 0);
  }
  const row = getConn()
    .prepare("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE mailbox=?")
    .get(mailbox) as { n: number };
  return Number(row?.n || 0);
}

export function markCollaborationMailRead(collaborationId: string): void {
  tx((db) => {
    db.prepare("UPDATE kol_mail_threads SET unread_count=0, updated_at=? WHERE collaboration_id=?")
      .run(nowIso(), collaborationId);
    db.prepare("UPDATE kol_mail_items SET unread=0 WHERE collaboration_id=?").run(collaborationId);
  });
}

export function markConversationMailRead(threadId: string): void {
  if (!threadId) return;
  tx((db) => {
    db.prepare("UPDATE kol_mail_threads SET unread_count=0, updated_at=? WHERE id=?")
      .run(nowIso(), threadId);
    db.prepare("UPDATE kol_mail_items SET unread=0 WHERE thread_id=?").run(threadId);
  });
}

export function setConversationStarred(threadId: string, starred: boolean): void {
  if (!threadId) return;
  getConn().prepare("UPDATE kol_mail_threads SET starred=?, updated_at=? WHERE id=?")
    .run(starred ? 1 : 0, nowIso(), threadId);
}

export function listMailboxConversations(mailbox?: string): ConversationRow[] {
  const box = mailbox === undefined ? currentMailbox() : mailbox;
  const rows = box
    ? getConn().prepare(
      `SELECT t.*, c.kol_uid, c.handle
         FROM kol_mail_threads t
         LEFT JOIN collaborations c ON c.id=t.collaboration_id
        WHERE t.mailbox=? ORDER BY t.last_at DESC, t.updated_at DESC`,
    ).all(box) as Row[]
    : getConn().prepare(
      `SELECT t.*, c.kol_uid, c.handle
         FROM kol_mail_threads t
         LEFT JOIN collaborations c ON c.id=t.collaboration_id
        ORDER BY t.last_at DESC, t.updated_at DESC`,
    ).all() as Row[];
  return rows.map(conversationRowOf);
}

export function findMailThread(id: string, mailbox?: string): Row | undefined {
  const raw = String(id || "").trim();
  if (!raw) return undefined;
  const box = mailbox === undefined ? currentMailbox() : mailbox;
  const byId = getConn().prepare("SELECT * FROM kol_mail_threads WHERE id=?").get(raw) as Row | undefined;
  if (byId && (!box || String(byId.mailbox || "") === box)) return byId;
  if (box) {
    return getConn().prepare(
      "SELECT * FROM kol_mail_threads WHERE conversation_id=? AND mailbox=?",
    ).get(raw, box) as Row | undefined;
  }
  return getConn().prepare(
    "SELECT * FROM kol_mail_threads WHERE conversation_id=? ORDER BY updated_at DESC LIMIT 1",
  ).get(raw) as Row | undefined;
}

export function mailboxBoxStatus(mailbox?: string): MailBoxStatus {
  const box = mailbox === undefined ? currentMailbox() : mailbox;
  const userId = safeEmployeeId();
  const bind = userId ? starryBindingRow(userId) as StarryBindingRow | undefined : undefined;
  const unread = unreadCountForMailbox(box);
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
  brand: string;
  region: string;
  unread: number;
  bound: boolean;
  synced_at: string | null;
  error: string | null;
};

/**
 * One entry per bound mailbox. Brand metadata comes from the mailbox_owners
 * table when present; there is no per-mailbox region source yet.
 */
export function mailboxBindings(): MailboxBinding[] {
  const box = mailboxBoxStatus();
  const mailbox = String(box.mailbox || "");
  if (!mailbox) return [];
  const userId = safeEmployeeId();
  const bind = userId ? starryBindingRow(userId) : undefined;
  const owner = getConn().prepare("SELECT brand, owner_name, dept FROM mailbox_owners WHERE email=?")
    .get(mailbox) as Row | undefined;
  return [{
    mailbox,
    label: String(bind?.owner_name || owner?.owner_name || mailboxLocalPart(mailbox) || mailbox),
    brand: String(owner?.brand || ""),
    region: "",
    unread: unreadCountForMailbox(mailbox),
    bound: box.bound,
    synced_at: box.synced_at,
    error: box.error,
  }];
}

export function updateBindingSyncCursor(input: {
  userId?: string;
  mailbox?: string;
  syncedAt: string;
  cursorAt?: string;
  cursorId?: string;
  pageNo?: number;
  error?: string;
  tool?: string;
}): void {
  const userId = String(input.userId || safeEmployeeId() || "");
  if (!userId) return;
  const existing = starryBindingRow(userId) as StarryBindingRow | undefined;
  if (!existing) return;
  getConn().prepare(
    `UPDATE user_starry_bindings
     SET sync_cursor_at=?, sync_cursor_id=?, sync_page_no=?, synced_at=?, last_error=?, last_tool=?, updated_at=?
     WHERE user_id=?`,
  ).run(
    input.cursorAt || existing.sync_cursor_at || "",
    input.cursorId || existing.sync_cursor_id || "",
    Number.isFinite(input.pageNo) ? input.pageNo : (existing.sync_page_no ?? 1),
    input.syncedAt,
    input.error || "",
    input.tool || "pageEmailConversations",
    nowIso(),
    userId,
  );
}

export function persistThreadDigest(threadId: string, digest: {
  text?: string;
  source?: string;
  fingerprint?: string;
  error?: string;
  failed_at?: string;
  mail_count?: number;
}): void {
  if (!threadId) return;
  getConn().prepare(
    `UPDATE kol_mail_threads
     SET digest_text=?, digest_source=?, digest_fingerprint=?, digest_error=?, digest_failed_at=?, digest_mail_count=?
     WHERE id=?`,
  ).run(
    String(digest.text || ""),
    String(digest.source || ""),
    String(digest.fingerprint || ""),
    digest.error ? String(digest.error) : "",
    digest.failed_at ? String(digest.failed_at) : "",
    Number(digest.mail_count || 0),
    threadId,
  );
}

export function projectUnboundInbound(input: {
  mailbox: string;
  conversationId: string;
  providerMessageId?: string;
  fromAddr?: string;
  fromName?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  occurredAt?: string;
}): void {
  const identity = inboundIdentity({
    provider_message_id: input.providerMessageId,
    collaboration_id: "",
    subject: input.subject,
    body: input.body || input.snippet,
    conversation_id: input.conversationId,
  });
  if (inboundByIdentity({
    provider_message_id: identity.provider_message_id,
    identity_hash: identity.identity_hash,
  })) return;
  getConn().prepare(
    `INSERT INTO inbound
     (id, from_addr, from_name, subject, snippet, summary, bound, deferred, collaboration_id, session_id, confidence, candidates, ts, provider_message_id, identity_hash, mailbox)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    nid("inb"),
    input.fromAddr || "",
    input.fromName || "",
    input.subject || "",
    (input.snippet || input.body || "").slice(0, 280),
    "",
    0,
    0,
    null,
    null,
    "low",
    "[]",
    input.occurredAt || nowIso(),
    identity.provider_message_id || null,
    identity.identity_hash,
    input.mailbox || "",
  );
}
