import { audit, getConn, nowIso, onConnReset } from "../db.js";
import { mailPreview } from "../host/mail-preview.js";
import {
  itemsForCollaboration,
  itemsForConversation,
  markCollaborationMailRead,
  persistThreadDigest,
  projectUnboundInbound,
  threadsByCollaborationIds,
  threadsForCollaboration,
  unreadCountForCollaboration,
  unreadCountForMailbox,
  updateBindingSyncCursor,
  type SyncReceipt,
} from "../host/mail-memory.js";
import { letterSummaryRecord, threadDigestOf, type ThreadDigest } from "../host/mail-summary.js";
import { boundMailboxEmail, currentFollowScope, matchesFollowedMailbox, safeEmployeeId } from "../host/starry-bind.js";
import { inboundIdentity, mailAlreadySeen } from "../host/inbound-identity.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import {
  conversationIdOf,
  conversationMailboxOf,
  conversationSubject,
  firstString,
  inferInbound,
  listOf,
  matchCollaboration,
  messageBody,
  messageFrom,
  messageOccurredAt,
  messageTo,
} from "./mail-fields.js";
import { executeStarryKolTask } from "./service.js";

export type FollowedMailSync = {
  ok: boolean;
  source: "starry";
  tool: "pageEmailConversations";
  conversations: number;
  inbound: number;
  unread: number;
  error?: string;
  synced_at?: string;
  mailbox?: string;
  listed?: number;
  inserted?: number;
  updated?: number;
  cursor_at?: string;
};

export {
  itemsForCollaboration,
  itemsForConversation,
  markCollaborationMailRead,
  threadsByCollaborationIds,
  threadsForCollaboration,
  unreadCountForCollaboration,
  unreadCountForMailbox,
};

const MAIL_STATE_KEY = "starry_followed_mail_sync";
const CACHE_MS = 8_000;
const inflight = new Map<string, Promise<FollowedMailSync>>();
const lastStarted = new Map<string, number>();

onConnReset(() => {
  inflight.clear();
  lastStarted.clear();
});

function mailboxSyncKey(): string {
  const mailbox = boundMailboxEmail() || currentFollowScope().mailbox_email || "*";
  return `${safeEmployeeId() || "anon"}:${mailbox}`;
}

export function resetFollowedMailSync(): void {
  inflight.clear();
  lastStarted.clear();
}

export function startFollowedMailSync(force = false): Promise<FollowedMailSync> {
  const key = mailboxSyncKey();
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = syncFollowedKolMail().finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  lastStarted.set(key, Date.now());
  void force;
  return pending;
}

export function ensureFollowedMailSync(force = false): Promise<FollowedMailSync> {
  const key = mailboxSyncKey();
  const existing = inflight.get(key);
  if (existing) return existing;
  if (!force && lastStarted.has(key) && Date.now() - (lastStarted.get(key) || 0) < CACHE_MS) {
    const cached = followedMailStatus();
    if (cached.synced_at) return Promise.resolve(cached);
  }
  return startFollowedMailSync(force);
}

export function followedMailStatus(): FollowedMailSync {
  const mailbox = boundMailboxEmail() || currentFollowScope().mailbox_email || "";
  const raw = getConn().prepare("SELECT value FROM app_state WHERE key=?").get(MAIL_STATE_KEY) as
    | { value: string }
    | undefined;
  const unread = unreadCountForMailbox(mailbox);
  const employeeId = safeEmployeeId();
  const bind = employeeId
    ? getConn().prepare("SELECT synced_at, last_error, last_tool, sync_cursor_at FROM user_starry_bindings WHERE user_id=?")
      .get(employeeId) as {
        synced_at?: string;
        last_error?: string;
        last_tool?: string;
        sync_cursor_at?: string;
      } | undefined
    : undefined;
  if (!raw?.value) {
    return {
      ok: Boolean(bind?.synced_at) && !bind?.last_error,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread,
      mailbox,
      synced_at: bind?.synced_at,
      cursor_at: bind?.sync_cursor_at,
      ...(bind?.last_error ? { error: String(bind.last_error) } : {}),
    };
  }
  try {
    const parsed = JSON.parse(raw.value) as FollowedMailSync;
    return {
      ...parsed,
      source: "starry",
      tool: "pageEmailConversations",
      mailbox: parsed.mailbox || mailbox,
      unread: Number.isFinite(Number(parsed.unread)) ? Number(parsed.unread) : unread,
      synced_at: bind?.synced_at || parsed.synced_at,
      cursor_at: bind?.sync_cursor_at || parsed.cursor_at,
      ...(bind?.last_error ? { error: String(bind.last_error) } : {}),
    };
  } catch {
    return { ok: false, source: "starry", tool: "pageEmailConversations", conversations: 0, inbound: 0, unread, mailbox };
  }
}

function inboundOf(row: Json, col?: Row, mailboxEmail = ""): boolean {
  const box = mailboxEmail || String(col?.mailbox_from || col?.owner_mailbox || "");
  if (inferInbound(row, {
    kolEmail: String(col?.email || ""),
    mailboxEmail: box,
    handle: String(col?.handle || ""),
  })) return true;
  if (col) return false;
  const from = messageFrom(row).email;
  const to = messageTo(row).email;
  if (from && box && from === box) return false;
  if (box && to && to === box && from !== box) return true;
  return false;
}

function isUnread(row: Json): boolean {
  if (row.unread === true || row.isUnread === true || row.hasUnread === true) return true;
  if (row.read === true || row.isRead === true || row.unread === false) return false;
  const status = firstString(row.readStatus, row.status, row.mailStatus).toUpperCase();
  if (["UNREAD", "NEW", "INBOUND_UNREAD"].includes(status)) return true;
  if (["READ", "SEEN"].includes(status)) return false;
  const count = Number(row.unreadCount ?? row.unread_count);
  return Number.isFinite(count) && count > 0;
}

function followedCollaborations(boundMailbox = ""): Row[] {
  const scope = currentFollowScope();
  return (getConn().prepare(
    "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != ''",
  ).all() as Row[]).filter((row) => {
    if (!scope.required) return true;
    if (!scope.bound || scope.status === "expired") return false;
    return matchesFollowedMailbox(row, scope, [boundMailbox]);
  });
}

function persistStatus(result: FollowedMailSync): void {
  getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(MAIL_STATE_KEY, JSON.stringify(result));
}

function storedDigest(threadId: string): ThreadDigest | null {
  const row = getConn().prepare(
    `SELECT digest_text, digest_source, digest_mail_count, digest_fingerprint, digest_error, digest_failed_at
     FROM kol_mail_threads WHERE id=?`,
  ).get(threadId) as {
    digest_text?: string;
    digest_source?: string;
    digest_mail_count?: number;
    digest_fingerprint?: string;
    digest_error?: string;
    digest_failed_at?: string;
  } | undefined;
  if (!row || (!row.digest_text && !row.digest_source)) return null;
  return {
    text: String(row.digest_text || ""),
    source: String(row.digest_source || ""),
    mail_count: Number(row.digest_mail_count || 0),
    fingerprint: String(row.digest_fingerprint || ""),
    ...(row.digest_error ? { error: String(row.digest_error) } : {}),
    ...(row.digest_failed_at ? { failed_at: String(row.digest_failed_at) } : {}),
  };
}

function upsertThread(input: {
  collaborationId?: string | null;
  conversationId: string;
  subject: string;
  mailbox: string;
  direction?: string;
  snippet?: string;
  preview?: string;
  from?: string;
  fromName?: string;
  peerEmail?: string;
  peerName?: string;
  unread: number;
  lastAt?: string;
  matchState: "matched" | "unbound" | "deferred" | "ignored";
  lastReceipt?: string;
}): { id: string; inserted: boolean } {
  const db = getConn();
  const mailbox = String(input.mailbox || "");
  const existing = db.prepare(
    "SELECT id FROM kol_mail_threads WHERE mailbox=? AND conversation_id=?",
  ).get(mailbox, input.conversationId) as { id: string } | undefined;
  const now = nowIso();
  const id = existing?.id || nid("thr");
  const collaborationId = input.collaborationId || null;
  if (existing) {
    db.prepare(
      `UPDATE kol_mail_threads
       SET subject=?, mailbox=?, last_direction=?, last_snippet=?, last_from=?, last_from_name=?,
           unread_count=?, last_at=?, updated_at=?, collaboration_id=?, peer_email=?, peer_name=?,
           last_preview=?, match_state=?, last_receipt=?
       WHERE id=?`,
    ).run(
      input.subject,
      mailbox,
      input.direction || "",
      input.snippet || "",
      input.from || "",
      input.fromName || "",
      input.unread,
      input.lastAt || now,
      now,
      collaborationId,
      input.peerEmail || input.from || "",
      input.peerName || input.fromName || "",
      input.preview || "",
      input.matchState,
      input.lastReceipt || "",
      id,
    );
    return { id, inserted: false };
  }
  db.prepare(
    `INSERT INTO kol_mail_threads
     (id, collaboration_id, conversation_id, subject, mailbox, last_direction, last_snippet, last_from, last_from_name,
      unread_count, last_at, created_at, updated_at, peer_email, peer_name, last_preview, match_state, last_receipt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    collaborationId,
    input.conversationId,
    input.subject,
    mailbox,
    input.direction || "",
    input.snippet || "",
    input.from || "",
    input.fromName || "",
    input.unread,
    input.lastAt || now,
    now,
    now,
    input.peerEmail || input.from || "",
    input.peerName || input.fromName || "",
    input.preview || "",
    input.matchState,
    input.lastReceipt || "",
  );
  return { id, inserted: true };
}

function rememberItem(
  threadId: string,
  collaborationId: string | null,
  conversationId: string,
  message: Json,
  subject: string,
  col?: Row,
  mailboxEmail = "",
): boolean {
  const inbound = inboundOf(message, col, mailboxEmail);
  const providerId = firstString(message.messageId, message.message_id, message.id, message.mailId);
  if (providerId) {
    const seen = getConn().prepare("SELECT id FROM kol_mail_items WHERE provider_message_id=?").get(providerId) as { id: string } | undefined;
    if (seen) return false;
  }
  const body = messageBody(message);
  const from = messageFrom(message);
  const to = messageTo(message);
  const identity = inboundIdentity({
    provider_message_id: providerId,
    collaboration_id: collaborationId || "",
    subject,
    body,
    conversation_id: conversationId,
  });
  if (mailAlreadySeen(identity)) return false;
  const direction = inbound ? "inbound" : "outbound";
  const letter = letterSummaryRecord({
    ...message,
    direction,
    body,
    snippet: body,
    subject,
    summary: message.summary,
    summary_zh: message.summary_zh,
    summary_source: message.summary_source,
  });
  getConn().prepare(
    `INSERT INTO kol_mail_items
     (id, thread_id, collaboration_id, conversation_id, provider_message_id, direction, subject, snippet, unread, occurred_at, created_at,
      from_addr, from_name, to_addr, body_text, summary, summary_zh, summary_source, receipt_status, receipt_at, effective)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    nid("kmi"),
    threadId,
    collaborationId,
    conversationId,
    providerId || identity.identity_hash,
    direction,
    subject,
    body.slice(0, 280),
    inbound && isUnread(message) ? 1 : inbound ? 1 : 0,
    firstString(message.sentAt, message.createdAt, message.time, message.ts) || nowIso(),
    nowIso(),
    from.email,
    from.name,
    to.email,
    body,
    letter.summary,
    letter.summary_zh,
    letter.summary_source,
    "",
    null,
    0,
  );
  return inbound;
}

function refreshThreadDigest(threadId: string, conversationId: string, mailbox: string): void {
  const items = itemsForConversation(conversationId, mailbox).map((item) => ({
    ...item,
    body: String(item.body_text || item.body || item.snippet || ""),
    snippet: String(item.snippet || item.body_text || ""),
  }));
  const digest = threadDigestOf(items, storedDigest(threadId));
  persistThreadDigest(threadId, {
    text: digest.text,
    source: digest.source,
    fingerprint: digest.fingerprint,
    error: digest.error,
    failed_at: digest.failed_at,
    mail_count: digest.mail_count,
  });
}

export async function readConversation(conversationId: string): Promise<{ messages: Json[]; subject: string; occurredAt: string }> {
  try {
    const { data } = await executeStarryKolTask("email_conversation_read", { conversationId }, "host");
    const messages = listOf(data);
    return {
      messages,
      subject: conversationSubject(data, ...messages),
      occurredAt: messageOccurredAt(messages[messages.length - 1] || data) || messageOccurredAt(data),
    };
  } catch {
    return { messages: [], subject: "", occurredAt: "" };
  }
}

function toSyncReceipt(result: FollowedMailSync): SyncReceipt {
  return {
    ok: result.ok,
    mailbox: result.mailbox || "",
    listed: result.listed ?? result.conversations,
    inserted: result.inserted || 0,
    updated: result.updated || 0,
    unread: result.unread,
    synced_at: result.synced_at || nowIso(),
    cursor_at: result.cursor_at,
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function syncMailboxMail(): Promise<FollowedMailSync> {
  return ensureFollowedMailSync(true);
}

export function lastSyncReceipt(): SyncReceipt {
  return toSyncReceipt(followedMailStatus());
}

export async function syncFollowedKolMail(): Promise<FollowedMailSync> {
  const syncedAt = nowIso();
  const scope = currentFollowScope();
  const mailbox = boundMailboxEmail() || scope.mailbox_email || "";
  const collabs = followedCollaborations(mailbox);
  const userId = safeEmployeeId();
  if (!collabs.length && !mailbox) {
    const empty: FollowedMailSync = {
      ok: true,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread: 0,
      synced_at: syncedAt,
      mailbox,
      listed: 0,
      inserted: 0,
      updated: 0,
    };
    persistStatus(empty);
    updateBindingSyncCursor({ userId, mailbox, syncedAt, tool: "pageEmailConversations" });
    return empty;
  }
  try {
    const listed = await executeStarryKolTask("email_conversation_list", {
      pageNo: 1,
      pageSize: 50,
      ...(mailbox ? { mailboxEmail: mailbox } : {}),
    }, "host");
    const conversations = listOf(listed.data);
    let inbound = 0;
    let inserted = 0;
    let updated = 0;
    let cursorAt = "";
    let cursorId = "";
    let detailBudget = 30;
    for (const conv of conversations) {
      const conversationId = conversationIdOf(conv);
      if (!conversationId) continue;
      const col = matchCollaboration(conv, collabs, mailbox);
      const matchState = col ? "matched" as const : "unbound" as const;
      let subject = conversationSubject(conv);
      let messages: Json[] = [];
      const listedUnread = Number(conv.unreadCount ?? conv.unread_count);
      const listedSnippet = messageBody(conv);
      const needsDetail = !subject || !listedSnippet || !Number.isFinite(listedUnread) || listedUnread > 0
        || inboundOf(conv, col, mailbox);
      if (needsDetail && detailBudget > 0) {
        detailBudget -= 1;
        const detail = await readConversation(conversationId);
        messages = detail.messages;
        subject = conversationSubject({ subject }, { subject: detail.subject }, conv, ...detail.messages) || subject;
      }
      subject = subject || "(无主题)";
      const inboundMessages = (messages.length ? messages : [conv]).filter((row) => inboundOf(row, col, mailbox));
      const latestInbound = inboundMessages[inboundMessages.length - 1] || inboundMessages[0];
      const inboundFrom = latestInbound ? messageFrom(latestInbound) : messageFrom(conv);
      const snippet = messageBody(latestInbound || conv) || listedSnippet;
      const previewCandidates = [
        snippet,
        listedSnippet,
        ...inboundMessages.map((row) => messageBody(row)),
        ...messages.map((row) => messageBody(row)),
      ].filter(Boolean);
      const previews = previewCandidates.map((text) => mailPreview(text)).filter(Boolean);
      const preview = previews.find((text) => /[\u4e00-\u9fff]/.test(text)) || previews[0] || "";
      const unreadFromMessages = inboundMessages.filter((row) => isUnread(row) || !firstString(row.messageId, row.id)).length;
      const unread = Number.isFinite(listedUnread) && listedUnread >= 0
        ? listedUnread
        : (unreadFromMessages || (inboundOf(conv, col, mailbox) && isUnread(conv) ? 1 : 0));
      const lastAt = messageOccurredAt(latestInbound || conv) || firstString(conv.lastMessageAt, conv.updatedAt, conv.ts);
      const threadMailbox = mailbox || conversationMailboxOf(conv) || firstString(conv.mailboxEmail, col?.mailbox_from);
      const thread = upsertThread({
        collaborationId: col ? String(col.id) : null,
        conversationId,
        subject,
        mailbox: threadMailbox,
        direction: inboundMessages.length || inboundOf(conv, col, mailbox) ? "inbound" : "outbound",
        snippet,
        preview,
        from: inboundFrom.email,
        fromName: inboundFrom.name,
        peerEmail: inboundFrom.email,
        peerName: inboundFrom.name,
        unread,
        lastAt,
        matchState,
      });
      if (thread.inserted) inserted += 1;
      else updated += 1;
      for (const message of messages) {
        if (rememberItem(thread.id, col ? String(col.id) : null, conversationId, message, subject, col, threadMailbox)) {
          inbound += 1;
        }
      }
      if (!messages.length && inboundMessages.length) {
        if (rememberItem(thread.id, col ? String(col.id) : null, conversationId, conv, subject, col, threadMailbox)) {
          inbound += 1;
        }
      }
      refreshThreadDigest(thread.id, conversationId, threadMailbox);
      if (matchState === "unbound" && inboundMessages.length) {
        const latest = latestInbound || conv;
        projectUnboundInbound({
          mailbox: threadMailbox,
          conversationId,
          providerMessageId: firstString(latest.messageId, latest.message_id, latest.id, latest.mailId, latest.lastMessageId),
          fromAddr: inboundFrom.email,
          fromName: inboundFrom.name,
          subject,
          snippet,
          body: messageBody(latest),
          occurredAt: lastAt,
        });
      }
      if (conversationId && col && String(col.conversation_id || "").startsWith("conv_")) {
        getConn().prepare("UPDATE collaborations SET conversation_id=? WHERE id=?").run(conversationId, col.id);
      }
      if (lastAt && (!cursorAt || lastAt > cursorAt)) {
        cursorAt = lastAt;
        cursorId = conversationId;
      }
    }
    const unread = unreadCountForMailbox(mailbox);
    const result: FollowedMailSync = {
      ok: true,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: conversations.length,
      inbound,
      unread: Number(unread),
      synced_at: syncedAt,
      mailbox,
      listed: conversations.length,
      inserted,
      updated,
      cursor_at: cursorAt || syncedAt,
    };
    persistStatus(result);
    updateBindingSyncCursor({
      userId,
      mailbox,
      syncedAt,
      cursorAt: result.cursor_at,
      cursorId,
      tool: "pageEmailConversations",
    });
    audit("host", "starrykol.followed_mail_sync", result);
    return result;
  } catch (error) {
    const result: FollowedMailSync = {
      ok: false,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread: unreadCountForMailbox(mailbox),
      error: error instanceof Error ? error.message : String(error),
      synced_at: syncedAt,
      mailbox,
      listed: 0,
      inserted: 0,
      updated: 0,
    };
    persistStatus(result);
    updateBindingSyncCursor({
      userId,
      mailbox,
      syncedAt,
      error: result.error,
      tool: "pageEmailConversations",
    });
    audit("host", "starrykol.followed_mail_sync_failed", { error: result.error });
    return result;
  }
}
