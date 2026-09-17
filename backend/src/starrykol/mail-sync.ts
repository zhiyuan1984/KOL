import { audit, getConn, nowIso, onConnReset, tx } from "../db.js";
import { currentFollowScope, matchesFollowedMailbox } from "../host/starry-bind.js";
import { inboundIdentity, mailAlreadySeen } from "../host/inbound-identity.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import {
  conversationIdOf,
  conversationSubject,
  firstString,
  inferInbound,
  listOf,
  matchCollaboration,
  messageBody,
  messageFrom,
  messageOccurredAt,
  messageSubject,
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
};

const MAIL_STATE_KEY = "starry_followed_mail_sync";
const CACHE_MS = 8_000;
let inFlight: Promise<FollowedMailSync> | null = null;
let lastStarted = 0;

onConnReset(() => {
  inFlight = null;
  lastStarted = 0;
});

export function resetFollowedMailSync(): void {
  inFlight = null;
  lastStarted = 0;
}

export function startFollowedMailSync(force = false): Promise<FollowedMailSync> {
  if (!force && inFlight) return inFlight;
  inFlight = syncFollowedKolMail();
  lastStarted = Date.now();
  return inFlight;
}

export function ensureFollowedMailSync(force = false): Promise<FollowedMailSync> {
  if (!force && inFlight) return inFlight;
  if (!force && lastStarted && Date.now() - lastStarted < CACHE_MS) {
    const cached = followedMailStatus();
    if (cached.synced_at) return Promise.resolve(cached);
  }
  return startFollowedMailSync(force);
}

export function followedMailStatus(): FollowedMailSync {
  const raw = getConn().prepare("SELECT value FROM app_state WHERE key=?").get(MAIL_STATE_KEY) as
    | { value: string }
    | undefined;
  if (!raw?.value) return { ok: false, source: "starry", tool: "pageEmailConversations", conversations: 0, inbound: 0, unread: 0 };
  try {
    return { ...JSON.parse(raw.value), source: "starry", tool: "pageEmailConversations" } as FollowedMailSync;
  } catch {
    return { ok: false, source: "starry", tool: "pageEmailConversations", conversations: 0, inbound: 0, unread: 0 };
  }
}

export function threadsForCollaboration(collaborationId: string): Json[] {
  return threadsByCollaborationIds([collaborationId]).get(collaborationId) || [];
}

export function threadsByCollaborationIds(ids: string[]): Map<string, Json[]> {
  const map = new Map<string, Json[]>();
  const unique = [...new Set(ids.map((id) => String(id || "")).filter(Boolean))];
  if (!unique.length) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = getConn()
    .prepare(
      `SELECT collaboration_id, conversation_id, subject, last_direction, last_snippet, last_from, last_from_name, unread_count, last_at
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

export function itemsForCollaboration(collaborationId: string): Json[] {
  return getConn()
    .prepare(
      `SELECT id, conversation_id, provider_message_id, subject, direction, snippet, unread, occurred_at, created_at
       FROM kol_mail_items WHERE collaboration_id=?`,
    )
    .all(collaborationId) as Json[];
}

export function unreadCountForCollaboration(collaborationId: string): number {
  const row = getConn()
    .prepare("SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads WHERE collaboration_id=?")
    .get(collaborationId) as { n: number };
  return Number(row?.n || 0);
}

export function markCollaborationMailRead(collaborationId: string): void {
  tx((db) => {
    db.prepare("UPDATE kol_mail_threads SET unread_count=0, updated_at=? WHERE collaboration_id=?")
      .run(nowIso(), collaborationId);
    db.prepare("UPDATE kol_mail_items SET unread=0 WHERE collaboration_id=?").run(collaborationId);
  });
}

function inboundOf(row: Json, col?: Row): boolean {
  return inferInbound(row, {
    kolEmail: String(col?.email || ""),
    mailboxEmail: String(col?.mailbox_from || col?.owner_mailbox || ""),
    handle: String(col?.handle || ""),
  });
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

function followedCollaborations(): Row[] {
  const scope = currentFollowScope();
  return (getConn().prepare(
    "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != ''",
  ).all() as Row[]).filter((row) => {
    if (!scope.required) return true;
    if (!scope.bound || scope.status === "expired") return false;
    return matchesFollowedMailbox(row, scope);
  });
}


function persistStatus(result: FollowedMailSync): void {
  getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(MAIL_STATE_KEY, JSON.stringify(result));
}

function upsertThread(input: {
  collaborationId: string;
  conversationId: string;
  subject: string;
  mailbox?: string;
  direction?: string;
  snippet?: string;
  from?: string;
  fromName?: string;
  unread: number;
  lastAt?: string;
}): string {
  const db = getConn();
  const existing = db.prepare(
    "SELECT id FROM kol_mail_threads WHERE collaboration_id=? AND conversation_id=?",
  ).get(input.collaborationId, input.conversationId) as { id: string } | undefined;
  const now = nowIso();
  const id = existing?.id || nid("thr");
  if (existing) {
    db.prepare(
      `UPDATE kol_mail_threads
       SET subject=?, mailbox=?, last_direction=?, last_snippet=?, last_from=?, last_from_name=?, unread_count=?, last_at=?, updated_at=?
       WHERE id=?`,
    ).run(
      input.subject,
      input.mailbox || "",
      input.direction || "",
      input.snippet || "",
      input.from || "",
      input.fromName || "",
      input.unread,
      input.lastAt || now,
      now,
      id,
    );
    return id;
  }
  db.prepare(
    `INSERT INTO kol_mail_threads
     (id, collaboration_id, conversation_id, subject, mailbox, last_direction, last_snippet, last_from, last_from_name, unread_count, last_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.collaborationId,
    input.conversationId,
    input.subject,
    input.mailbox || "",
    input.direction || "",
    input.snippet || "",
    input.from || "",
    input.fromName || "",
    input.unread,
    input.lastAt || now,
    now,
    now,
  );
  return id;
}

function rememberItem(
  threadId: string,
  collaborationId: string,
  conversationId: string,
  message: Json,
  subject: string,
  col?: Row,
): boolean {
  const inbound = inboundOf(message, col);
  const providerId = firstString(message.messageId, message.message_id, message.id, message.mailId);
  if (providerId) {
    const seen = getConn().prepare("SELECT id FROM kol_mail_items WHERE provider_message_id=?").get(providerId) as { id: string } | undefined;
    if (seen) return false;
  }
  const body = messageBody(message);
  const identity = inboundIdentity({
    provider_message_id: providerId,
    collaboration_id: collaborationId,
    subject,
    body,
    conversation_id: conversationId,
  });
  if (mailAlreadySeen(identity)) return false;
  getConn().prepare(
    `INSERT INTO kol_mail_items
     (id, thread_id, collaboration_id, conversation_id, provider_message_id, direction, subject, snippet, unread, occurred_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    nid("kmi"),
    threadId,
    collaborationId,
    conversationId,
    providerId || identity.identity_hash,
    inbound ? "inbound" : "outbound",
    subject,
    body.slice(0, 280),
    inbound && isUnread(message) ? 1 : inbound ? 1 : 0,
    firstString(message.sentAt, message.createdAt, message.time, message.ts) || nowIso(),
    nowIso(),
  );
  return inbound;
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

export async function syncFollowedKolMail(): Promise<FollowedMailSync> {
  const syncedAt = nowIso();
  const collabs = followedCollaborations();
  if (!collabs.length) {
    const empty = { ok: true, source: "starry" as const, tool: "pageEmailConversations" as const, conversations: 0, inbound: 0, unread: 0, synced_at: syncedAt };
    persistStatus(empty);
    return empty;
  }
  const scope = currentFollowScope();
  const mailbox = scope.mailbox_email || "";
  try {
    const listed = await executeStarryKolTask("email_conversation_list", {
      pageNo: 1,
      pageSize: 50,
      ...(mailbox ? { mailboxEmail: mailbox } : {}),
    }, "host");
    const conversations = listOf(listed.data);
    let inbound = 0;
    let detailBudget = 30;
    for (const conv of conversations) {
      const col = matchCollaboration(conv, collabs);
      if (!col) continue;
      const conversationId = conversationIdOf(conv);
      if (!conversationId) continue;
      let subject = conversationSubject(conv);
      let messages: Json[] = [];
      const listedUnread = Number(conv.unreadCount ?? conv.unread_count);
      const listedSnippet = messageBody(conv);
      const needsDetail = !subject || !listedSnippet || !Number.isFinite(listedUnread) || listedUnread > 0
        || inboundOf(conv, col);
      if (needsDetail && detailBudget > 0) {
        detailBudget -= 1;
        const detail = await readConversation(conversationId);
        messages = detail.messages;
        subject = conversationSubject({ subject }, { subject: detail.subject }, conv, ...detail.messages) || subject;
      }
      subject = subject || "(无主题)";
      const inboundMessages = (messages.length ? messages : [conv]).filter((row) => inboundOf(row, col));
      const latestInbound = inboundMessages[inboundMessages.length - 1] || inboundMessages[0];
      const inboundFrom = latestInbound ? messageFrom(latestInbound) : messageFrom(conv);
      const snippet = messageBody(latestInbound || conv) || listedSnippet;
      const unreadFromMessages = inboundMessages.filter((row) => isUnread(row) || !firstString(row.messageId, row.id)).length;
      const unread = Number.isFinite(listedUnread) && listedUnread >= 0
        ? listedUnread
        : (unreadFromMessages || (inboundOf(conv, col) && isUnread(conv) ? 1 : 0));
      const threadId = upsertThread({
        collaborationId: String(col.id),
        conversationId,
        subject,
        mailbox: firstString(conv.mailboxEmail, mailbox, col.mailbox_from),
        direction: inboundMessages.length || inboundOf(conv, col) ? "inbound" : "outbound",
        snippet,
        from: inboundFrom.email,
        fromName: inboundFrom.name,
        unread,
        lastAt: messageOccurredAt(latestInbound || conv) || firstString(conv.lastMessageAt, conv.updatedAt, conv.ts),
      });
      for (const message of messages) {
        if (rememberItem(threadId, String(col.id), conversationId, message, subject, col)) inbound += 1;
      }
      if (!messages.length && inboundMessages.length) {
        if (rememberItem(threadId, String(col.id), conversationId, conv, subject, col)) inbound += 1;
      }
      if (conversationId && String(col.conversation_id || "").startsWith("conv_")) {
        getConn().prepare("UPDATE collaborations SET conversation_id=? WHERE id=?").run(conversationId, col.id);
      }
    }
    const unread = (getConn().prepare(
      `SELECT COALESCE(SUM(unread_count),0) AS n FROM kol_mail_threads
       WHERE collaboration_id IN (${collabs.map(() => "?").join(",")})`,
    ).get(...collabs.map((row) => row.id)) as { n: number } | undefined)?.n || 0;
    const result: FollowedMailSync = {
      ok: true,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: conversations.length,
      inbound,
      unread: Number(unread),
      synced_at: syncedAt,
    };
    persistStatus(result);
    audit("host", "starrykol.followed_mail_sync", result);
    return result;
  } catch (error) {
    const result: FollowedMailSync = {
      ok: false,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread: 0,
      error: error instanceof Error ? error.message : String(error),
      synced_at: syncedAt,
    };
    persistStatus(result);
    audit("host", "starrykol.followed_mail_sync_failed", { error: result.error });
    return result;
  }
}
