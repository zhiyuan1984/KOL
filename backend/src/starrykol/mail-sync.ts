import { AsyncLocalStorage } from "node:async_hooks";
import { starryKolMcpConfigured } from "../starrykol/connection.js";
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
} from "../host/mail-memory.js";
import { letterSummaryRecord, remoteMailAnalysisEnabled, threadDigestOf, type ThreadDigest } from "../host/mail-summary.js";
import { translateMailBodyZh } from "./translate-zh.js";
import { markPendingMailMemory, triggerMailMemoryIncrement } from "../host/mail-memory-job.js";
import { recordEffectiveCorrespondence, recordFollowedMailMemory } from "../host/kol-memory.js";
import { boundMailboxEmail, currentFollowScope, matchesFollowedMailbox, safeEmployeeId } from "../host/starry-bind.js";
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
  messageTitle,
  messageTo,
} from "./mail-fields.js";
import { executeStarryKolTask } from "./service.js";
import { observeReplyMail } from "../mail/reply-source.js";
import { postgresPool } from "../postgres/pool.js";
import { replyMessageBody } from "./mail-fields.js";
import {
  bindingHealthPg,
  bindingPageNoPg,
  collaborationByIdPg,
  ensureThreadItemTranslationsPg,
  itemsForConversationPg,
  listBoundCollaborationsPg,
  mailSyncAudit,
  mailSyncStateGet,
  mailSyncStateSet,
  markThreadTranslationsPendingPg,
  persistThreadDigestPg,
  storedDigestPg,
  unreadCountForMailboxPg,
  updateBindingSyncCursorPg,
  updateCollaborationConversationPg,
  updateThreadAfterHydratePg,
} from "./mail-sync-pg.js";
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
const durableSync = new AsyncLocalStorage<{ checkpoint: () => Promise<void> }>();
async function syncCheckpoint(): Promise<void> { await durableSync.getStore()?.checkpoint(); }
let backgroundSyncTask: Promise<void> | null = null;

onConnReset(() => {
  inflight.clear();
  lastStarted.clear();
});

function mailboxSyncKey(mailbox = ""): string {
  const box = mailbox || boundMailboxEmail() || currentFollowScope().mailbox_email || "*";
  return `${safeEmployeeId() || "anon"}:${box}`;
}

export function resetFollowedMailSync(): void {
  inflight.clear();
  lastStarted.clear();
}

export async function waitForBackgroundSync(): Promise<void> {
  // Wait for in-flight foreground syncs first: they register the background
  // task as their last step, so it is only observable after they resolve.
  await Promise.all([...inflight.values()]);
  if (backgroundSyncTask) await backgroundSyncTask;
}

export function startFollowedMailSync(force = false, mailbox = ""): Promise<FollowedMailSync> {
  const key = mailboxSyncKey(mailbox);
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = syncFollowedKolMail(mailbox).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  lastStarted.set(key, Date.now());
  void force;
  return pending;
}

export async function ensureFollowedMailSync(force = false, mailbox = ""): Promise<FollowedMailSync> {
  const key = mailboxSyncKey(mailbox);
  const existing = inflight.get(key);
  if (existing) return existing;
  if (!force && lastStarted.has(key) && Date.now() - (lastStarted.get(key) || 0) < CACHE_MS) {
    const cached = await followedMailStatus();
    if (cached.synced_at) return cached;
  }
  return startFollowedMailSync(force, mailbox);
}

export async function followedMailStatus(): Promise<FollowedMailSync> {
  const mailbox = boundMailboxEmail() || currentFollowScope().mailbox_email || "";
  const raw = await mailSyncStateGet(MAIL_STATE_KEY);
  const unread = await unreadCountForMailboxPg(mailbox);
  const employeeId = safeEmployeeId();
  const bind = employeeId ? await bindingHealthPg(employeeId) : undefined;
  if (!raw) {
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
    const parsed = JSON.parse(raw) as FollowedMailSync;
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

async function followedCollaborations(boundMailbox = ""): Promise<Row[]> {
  const scope = currentFollowScope();
  const rows = await listBoundCollaborationsPg();
  return rows.filter((row) => {
    if (!scope.required) return true;
    if (!scope.bound || scope.status === "expired") return false;
    return matchesFollowedMailbox(row, scope, [boundMailbox]);
  });
}

async function persistStatus(result: FollowedMailSync): Promise<void> {
  await mailSyncStateSet(MAIL_STATE_KEY, JSON.stringify(result));
}

async function upsertThread(input: {
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
}): Promise<{ id: string; inserted: boolean }> {
  const now = nowIso();
  const result = await postgresPool().query<{id: string; inserted: boolean}>(
    `INSERT INTO kol_mail_threads
     (id,collaboration_id,conversation_id,subject,mailbox,last_direction,last_snippet,last_from,last_from_name,
      unread_count,last_at,created_at,updated_at,peer_email,peer_name,last_preview,match_state,last_receipt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17)
     ON CONFLICT(mailbox,conversation_id) DO UPDATE SET
      collaboration_id=COALESCE(kol_mail_threads.collaboration_id,excluded.collaboration_id),subject=excluded.subject,last_direction=excluded.last_direction,
      last_snippet=excluded.last_snippet,last_from=excluded.last_from,last_from_name=excluded.last_from_name,
      unread_count=excluded.unread_count,last_at=excluded.last_at,updated_at=excluded.updated_at,
      peer_email=excluded.peer_email,peer_name=excluded.peer_name,last_preview=excluded.last_preview,
      match_state=excluded.match_state,last_receipt=excluded.last_receipt
     WHERE kol_mail_threads.collaboration_id IS NULL OR excluded.collaboration_id IS NULL
       OR kol_mail_threads.collaboration_id=excluded.collaboration_id
     RETURNING id,(xmax=0) AS inserted`,
    [nid("thr"),input.collaborationId || null,input.conversationId,input.subject,
     String(input.mailbox || ""),input.direction || "",input.snippet || "",input.from || "",input.fromName || "",
     input.unread,input.lastAt || now,now,input.peerEmail || input.from || "",input.peerName || input.fromName || "",
     input.preview || "",input.matchState,input.lastReceipt || ""],
  );
  if (!result.rows[0]) throw new Error("mail_conversation_association_mismatch");
  return result.rows[0];
}
async function rememberItem(
  threadId: string,
  collaborationId: string | null,
  conversationId: string,
  message: Json,
  subject: string,
  col?: Row,
  mailboxEmail = "",
): Promise<boolean> {
  const inbound = inboundOf(message, col, mailboxEmail);
  const providerId = firstString(message.provider_message_id, message.messageId, message.message_id, message.id, message.mailId);
  const title = messageTitle(message);
  const body = replyMessageBody(message);
  const from = messageFrom(message), to = messageTo(message);
  const direction = inbound ? "inbound" : "outbound";
  const letter = letterSummaryRecord({ ...message, direction, body: body || "", snippet: body || "", subject });
  const observed = await observeReplyMail({ thread_id: threadId, collaboration_id: collaborationId,
    conversation_id: conversationId, mailbox: mailboxEmail, provider_message_id: providerId,
    direction, subject, title, body, from: from.email, from_name: from.name, to: to.email,
    occurred_at: firstString(message.sentAt,message.sent_at,message.sentTime,message.sendTime,message.send_time,
      message.receivedAt,message.received_at,message.receiveTime,message.receive_time,message.occurred_at,
      message.createdAt,message.created_at,message.time,message.ts),
    source_updated_at: firstString(message.updatedAt, message.updated_at),
    attachments: Array.isArray(message.attachments) ? message.attachments as Json[] : [],
    unread: inbound, summary: letter.summary, summary_zh: letter.summary_zh, summary_source: letter.summary_source });
  return observed.changed && inbound;
}

async function refreshThreadDigest(threadId: string, conversationId: string, mailbox: string): Promise<void> {
  const items = (await itemsForConversationPg(conversationId, mailbox)).map((item) => ({
    ...item,
    body: String(item.body_text || item.body || item.snippet || ""),
    snippet: String(item.snippet || item.body_text || ""),
  }));
  const digest = threadDigestOf(items, await storedDigestPg(threadId));
  await persistThreadDigestPg(threadId, {
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
    await syncCheckpoint();
    const { data } = await executeStarryKolTask("email_conversation_read", { conversationId }, "host");
    await syncCheckpoint();
    const messages = listOf(data);
    return {
      messages,
      subject: conversationSubject(data, ...messages),
      occurredAt: messageOccurredAt(messages[messages.length - 1] || data) || messageOccurredAt(data),
    };
  } catch (error) {
    if (durableSync.getStore()) throw error;
    return { messages: [], subject: "", occurredAt: "" };
  }
}

/** Local-only: flag untranslated bodies so the UI can say 翻译生成中… without touching the remote. */
export function markThreadTranslationsPending(threadId: string): void {
  if (!threadId) return;
  getConn().prepare(
    `UPDATE kol_mail_items SET translation_source='pending'
     WHERE thread_id=? AND translation_zh IS NULL AND IFNULL(body_text,'') != ''
       AND IFNULL(translation_source,'') = ''`,
  ).run(threadId);
}

/** Fill translation_zh for items with bodies; marks 'pending' when no LLM backend is available. */
export async function ensureThreadItemTranslations(threadId: string): Promise<void> {
  const pending = getConn().prepare(
    `SELECT id, body_text FROM kol_mail_items
     WHERE thread_id=? AND translation_zh IS NULL AND IFNULL(body_text,'') != ''`,
  ).all(threadId) as { id: string; body_text: string }[];
  if (!pending.length) return;
  if (!remoteMailAnalysisEnabled()) {
    markThreadTranslationsPending(threadId);
    return;
  }
  for (const row of pending) {
    try {
      const translated = await translateMailBodyZh(row.body_text);
      if (translated) {
        getConn().prepare("UPDATE kol_mail_items SET translation_zh=?, translation_source=? WHERE id=?")
          .run(translated.text, translated.source, row.id);
      } else {
        getConn().prepare("UPDATE kol_mail_items SET translation_source='pending' WHERE id=? AND translation_zh IS NULL")
          .run(row.id);
      }
    } catch {
      getConn().prepare("UPDATE kol_mail_items SET translation_source='pending' WHERE id=? AND translation_zh IS NULL")
        .run(row.id);
    }
  }
}

/** Fetch a thread body once on demand, then serve subsequent opens from local memory. */
export async function hydrateMailThread(thread: Row): Promise<number> {
  const conversationId = String(thread.conversation_id || "");
  if (!conversationId) return 0;
  const detail = await readConversation(conversationId);
  if (!detail.messages.length) return 0;
  const col = thread.collaboration_id
    ? await collaborationByIdPg(String(thread.collaboration_id))
    : undefined;
  const mailbox = String(thread.mailbox || "");
  const subject = conversationSubject(
    { subject: thread.subject },
    { subject: detail.subject },
    ...detail.messages,
  ) || String(thread.subject || "(无主题)");
  let inserted = 0;
  for (const message of detail.messages) {
    if (await rememberItem(String(thread.id), col ? String(col.id) : null, conversationId, message, subject, col, mailbox)) {
      inserted += 1;
    }
  }
  const latest = detail.messages[detail.messages.length - 1];
  const snippet = messageBody(latest);
  const from = messageFrom(latest);
  await updateThreadAfterHydratePg({
    threadId: String(thread.id),
    subject,
    snippet,
    preview: mailPreview(snippet),
    fromEmail: from.email,
    fromName: from.name,
    occurredAt: String(detail.occurredAt || thread.last_at || ""),
  });
  if (col) {
    const direction = inboundOf(latest, col, mailbox) ? "inbound" : "outbound";
    const occurredAt = String(detail.occurredAt || thread.last_at || nowIso());
    const body = messageBody(latest) || snippet;
    recordFollowedMailMemory({
      kolUid: String(col.kol_uid || ""),
      collaborationId: String(col.id),
      conversationId,
      subject,
      summary: mailPreview(snippet),
      body,
      direction,
      occurredAt,
      gatewaySuccess: true,
      sourceVersion: `starry.mail:${conversationId}`,
    });
    recordEffectiveCorrespondence({
      kolUid: String(col.kol_uid || ""),
      collaborationId: String(col.id),
      scopeBrand: String(col.brand || ""),
      direction,
      occurredAt,
      gatewaySuccess: true,
      subject,
      body,
    });
  }
  await refreshThreadDigest(String(thread.id), conversationId, mailbox);
  if (!durableSync.getStore()) {
    await ensureThreadItemTranslationsPg(String(thread.id), translateMailBodyZh, remoteMailAnalysisEnabled);
  }
  return inserted;
}

async function hydrateConversationById(conv: Json, mailbox: string, collabs: Row[]): Promise<number> {
  await syncCheckpoint();
  const conversationId = conversationIdOf(conv);
  if (!conversationId) return 0;
  let thread = (await postgresPool().query<Row>(
    "SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2", [conversationId,mailbox],
  )).rows[0];
  if (!thread) {
    // Conversation first seen on a later background page: create the thread
    // shell from the list row, then hydrate the full message history below.
    const col = matchCollaboration(conv, collabs, mailbox);
    await upsertThread({
      collaborationId: col ? String(col.id) : null,
      conversationId,
      subject: conversationSubject(conv) || "(无主题)",
      mailbox: mailbox || conversationMailboxOf(conv) || firstString(conv.mailboxEmail, col?.mailbox_from),
      direction: inboundOf(conv, col, mailbox) ? "inbound" : "outbound",
      snippet: messageBody(conv),
      from: messageFrom(conv).email,
      fromName: messageFrom(conv).name,
      unread: Number(conv.unreadCount ?? conv.unread_count) || 0,
      lastAt: messageOccurredAt(conv) || remoteConversationTime(conv),
      matchState: col ? "matched" : "unbound",
    });
    thread = (await postgresPool().query<Row>(
      "SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2", [conversationId,mailbox],
    )).rows[0];
  }
  if (!thread) return 0;
  return hydrateMailThread(thread);
}

async function fetchConversationPage(pageNo: number, pageSize: number, mailbox: string): Promise<{ pageNo: number; pageSize: number; total: number; rawCount: number; conversations: Json[] }> {
  await syncCheckpoint();
  const listed = await executeStarryKolTask("email_conversation_list", {
    pageNo,
    pageSize,
    ...(mailbox ? { mailboxEmail: mailbox } : {}),
  }, "host");
  const payload = (listed.data && typeof listed.data === "object" && !Array.isArray(listed.data) ? listed.data : listed) as Json;
  const total = Number(payload.total ?? 0);
  const responsePageSize = Number(payload.pageSize ?? pageSize);
  const rawList = listOf(payload);
  const conversations = rawList.filter((conv) => {
    const remoteMailbox = conversationMailboxOf(conv);
    if (!mailbox || !remoteMailbox) return true;
    const bound = mailbox.toLowerCase();
    const remote = remoteMailbox.toLowerCase();
    if (remote === bound) return true;
    // The remote ignores mailboxEmail and mixes in other employees' rows.
    // Drop only same-domain coworker mailboxes; keep brand and external mailboxes.
    const boundDomain = bound.split("@")[1] || "";
    const remoteDomain = remote.split("@")[1] || "";
    return remoteDomain !== boundDomain;
  });
  return {
    pageNo,
    pageSize: Number.isFinite(responsePageSize) && responsePageSize > 0 ? responsePageSize : pageSize,
    total,
    rawCount: rawList.length,
    conversations,
  };
}

async function syncRemainingConversations(
  remaining: Json[],
  mailbox: string,
  collabs: Row[],
  startPageNo: number,
  userId: string,
  syncedAt: string,
  firstPageTotal = 0,
  firstPageSize = 0,
): Promise<void> {
  for (let i = 0; i < remaining.length; i += 5) {
    const batch = remaining.slice(i, i + 5);
    await mapLimited(batch, 5, async (conv) => {
      await hydrateConversationById(conv, mailbox, collabs);
    });
  }

  const MAX_BACKGROUND_PAGES = 20;
  const pageSize = 50;
  let pageNo = startPageNo + 1;
  let pagesProcessed = 1; // startPage already counted by foreground
  let knownTotal = Math.max(0, firstPageTotal);
  let lastPageSize = Math.max(1, firstPageSize);
  while (pagesProcessed < MAX_BACKGROUND_PAGES) {
    // Spec §3: pageNo * pageSize >= total means no more data — skip the fetch entirely.
    if (knownTotal > 0 && (pageNo - 1) * lastPageSize >= knownTotal) break;
    const page = await fetchConversationPage(pageNo, pageSize, mailbox);
    const conversations = page.conversations;
    knownTotal = page.total > 0 ? page.total : knownTotal;
    lastPageSize = Math.max(1, page.pageSize);
    // Stop only when the remote itself returned nothing; a page whose rows are
    // all filtered out has nothing to process but still advances the walk.
    if (page.rawCount <= 0) break;

    // Persist the fact that we are about to process this page
    await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, pageNo, tool: "pageEmailConversations" });

    const pageCandidates = await conversationsNeedingDetail(conversations, mailbox, userId);

    for (let i = 0; i < pageCandidates.length; i += 5) {
      const batch = pageCandidates.slice(i, i + 5);
      await mapLimited(batch, 5, async (conv) => {
        await hydrateConversationById(conv, mailbox, collabs);
      });
    }

    // Spec §3: a partial page means no more data; so does reaching total.
    // Compare against the raw remote count: the remote may return other
    // employees' rows that the mailbox filter drops.
    if (page.rawCount < lastPageSize) break;
    if (knownTotal > 0 && pageNo * lastPageSize >= knownTotal) break;
    pageNo += 1;
    pagesProcessed += 1;
  }

  if (durableSync.getStore() && pagesProcessed >= MAX_BACKGROUND_PAGES) throw new Error("mail_sync_page_limit: 请重试以继续剩余分页");
  await syncCheckpoint();
  await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, pageNo: 1, tool: "pageEmailConversations" });
}

function scheduleBackgroundSync(
  remaining: Json[],
  mailbox: string,
  collabs: Row[],
  startPageNo: number,
  userId: string,
  syncedAt: string,
  firstPageTotal = 0,
  firstPageSize = 0,
): Promise<void> {
  if (backgroundSyncTask) return backgroundSyncTask;
  backgroundSyncTask = (async () => {
    try {
      await syncRemainingConversations(remaining, mailbox, collabs, startPageNo, userId, syncedAt, firstPageTotal, firstPageSize);
    } catch (error) {
      await mailSyncAudit("host", "starrykol.followed_mail_sync_background_failed", {
        error: error instanceof Error ? error.message : String(error),
        mailbox,
      });
    } finally {
      backgroundSyncTask = null;
    }
  })();
  return backgroundSyncTask;
}

function timestampMs(value: unknown): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}+08:00`
    : raw;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteConversationTime(conv: Json): string {
  return firstString(
    conv.lastMessageTime,
    conv.lastMessageAt,
    conv.updatedTime,
    conv.updatedAt,
    conv.ts,
  );
}

// Shared by the foreground page and the background page walk: a conversation
// needs a detail fetch when it is not remembered locally, still unread, or
// changed remotely after the last thing we remembered about it.
async function conversationsNeedingDetail(conversations: Json[], mailbox: string, userId: string): Promise<Json[]> {
  // Batch native reads, scoped by the already authorized mailbox. An identical
  // conversation ID in another mailbox cannot satisfy this source dependency.
  const ids = conversations.map(conversationIdOf).filter(Boolean);
  if (!ids.length) return [];
  const db = postgresPool();
  const remembered = (await db.query<Row>(`SELECT t.conversation_id,t.last_at,
    (NOT EXISTS(SELECT 1 FROM kol_mail_items i WHERE i.thread_id=t.id) OR
     EXISTS(SELECT 1 FROM kol_mail_items i WHERE i.thread_id=t.id AND (i.title IS NULL OR i.body_text IS NULL))) AS needs_backfill
    FROM kol_mail_threads t WHERE lower(t.mailbox)=lower($1) AND t.conversation_id=ANY($2::text[])`, [mailbox,ids])).rows;
  const binding = (await db.query<Row>("SELECT sync_cursor_at FROM user_starry_bindings WHERE user_id=$1 AND lower(mailbox_email)=lower($2)", [userId,mailbox])).rows[0];
  const byId = new Map(remembered.map(row => [String(row.conversation_id),row]));
  return conversations.filter(conv => {
    const id = conversationIdOf(conv);
    if (!id) return false;
    const existing = byId.get(id);
    const unread = Number(conv.unreadCount ?? conv.unread_count);
    const rememberedAt = Math.max(timestampMs(existing?.last_at),timestampMs(binding?.sync_cursor_at));
    return !existing || existing.needs_backfill || (Number.isFinite(unread) && unread > 0)
      || timestampMs(remoteConversationTime(conv)) > rememberedAt;
  });
}

async function mapLimited<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await fn(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function syncMailboxMail(mailbox = ""): Promise<FollowedMailSync> {
  return ensureFollowedMailSync(true, mailbox);
}

export async function syncFollowedKolMail(mailboxOverride = "", options?: { checkpoint: () => Promise<void> }): Promise<FollowedMailSync> {
  return options ? durableSync.run(options, () => syncFollowedKolMailInner(mailboxOverride)) : syncFollowedKolMailInner(mailboxOverride);
}

async function syncFollowedKolMailInner(mailboxOverride: string): Promise<FollowedMailSync> {
  await syncCheckpoint();
  const syncedAt = nowIso();
  const scope = currentFollowScope();
  const mailbox = mailboxOverride || boundMailboxEmail() || scope.mailbox_email || "";
  const collabs = await followedCollaborations(mailbox);
  const userId = safeEmployeeId();
  const startPageNo = userId ? await bindingPageNoPg(userId, mailbox) : 1;
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
    await persistStatus(empty);
    await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, tool: "pageEmailConversations" });
    return empty;
  }
  try {
    // pageEmailConversations does not expose a mailbox filter in its MCP schema.
    // The remote currently ignores mailboxEmail and may return other employees' rows.
    const { conversations, total: firstPageTotal, pageSize: firstPageSize } = await fetchConversationPage(startPageNo, 50, mailbox);
    let inbound = 0;
    let inserted = 0;
    let updated = 0;
    let cursorAt = "";
    let cursorId = "";
    const detailCandidates = await conversationsNeedingDetail(conversations, mailbox, userId);
    const immediateCandidates = detailCandidates.slice(0, 5);
    const remainingCandidates = detailCandidates.slice(5);
    const detailRows = await mapLimited(immediateCandidates, 5, async (conv) => ({
      conversationId: conversationIdOf(conv),
      detail: await readConversation(conversationIdOf(conv)),
    }));
    const details = new Map(detailRows.map((row) => [row.conversationId, row.detail]));
    for (const conv of conversations) {
      await syncCheckpoint();
      const conversationId = conversationIdOf(conv);
      if (!conversationId) continue;
      const col = matchCollaboration(conv, collabs, mailbox);
      const matchState = col ? "matched" as const : "unbound" as const;
      let subject = conversationSubject(conv);
      let messages: Json[] = [];
      const listedUnread = Number(conv.unreadCount ?? conv.unread_count);
      const listedSnippet = messageBody(conv);
      const detail = details.get(conversationId);
      if (detail) {
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
      const lastAt = messageOccurredAt(latestInbound || conv) || remoteConversationTime(conv);
      const threadMailbox = mailbox || conversationMailboxOf(conv) || firstString(conv.mailboxEmail, col?.mailbox_from);
      const thread = await upsertThread({
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
        if (await rememberItem(thread.id, col ? String(col.id) : null, conversationId, message, subject, col, threadMailbox)) {
          inbound += 1;
        }
      }
      if (!messages.length && inboundMessages.length) {
        // The list row's id identifies a conversation, not a mail message.
        // Only a provider-supplied lastMessageId can identify this index hint.
        const providerId = firstString(conv.lastMessageId,conv.last_message_id);
        if (providerId && await rememberItem(thread.id, col ? String(col.id) : null, conversationId,
          { ...conv, id: undefined, messageId: providerId }, subject, col, threadMailbox)) {
          inbound += 1;
        }
      }
      // The page list is a remote source only; the following UI reads local B/C
      // memory. Write the newest observed fact as part of this same incremental
      // sync so reopening "我的红人" immediately projects the latest interaction.
      if (col) {
        const newest = messages[messages.length - 1] || conv;
        const direction = inboundOf(newest, col, mailbox) ? "inbound" : "outbound";
        const occurredAt = messageOccurredAt(newest) || remoteConversationTime(conv) || lastAt || nowIso();
        const body = messageBody(newest) || snippet;
        recordFollowedMailMemory({
          kolUid: String(col.kol_uid || ""),
          collaborationId: String(col.id),
          conversationId,
          subject,
          summary: preview || snippet,
          body,
          participants: [inboundFrom.email, threadMailbox].filter(Boolean).join(","),
          direction,
          occurredAt,
          gatewaySuccess: true,
          sourceVersion: `starry.mail:${conversationId}`,
        });
        recordEffectiveCorrespondence({
          kolUid: String(col.kol_uid || ""),
          collaborationId: String(col.id),
          scopeBrand: String(col.brand || ""),
          direction,
          occurredAt,
          gatewaySuccess: true,
          subject,
          body,
        });
      }
      await refreshThreadDigest(thread.id, conversationId, threadMailbox);
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
        await updateCollaborationConversationPg(conversationId, String(col.id));
      }
      if (lastAt && (!cursorAt || lastAt > cursorAt)) {
        cursorAt = lastAt;
        cursorId = conversationId;
      }
    }
    const unread = await unreadCountForMailboxPg(mailbox);
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
    await persistStatus(result);
    await updateBindingSyncCursorPg({
      userId,
      mailbox,
      syncedAt,
      cursorAt: result.cursor_at,
      cursorId,
      tool: "pageEmailConversations",
    });
    await mailSyncAudit("host", "starrykol.followed_mail_sync", result);
    markPendingMailMemory(mailbox);
    if (!durableSync.getStore()) triggerMailMemoryIncrement(mailbox);
    if (durableSync.getStore()) {
      await syncRemainingConversations(remainingCandidates, mailbox, collabs, startPageNo, userId, syncedAt, firstPageTotal, firstPageSize);
      await syncCheckpoint();
    } else {
      scheduleBackgroundSync(remainingCandidates, mailbox, collabs, startPageNo, userId, syncedAt, firstPageTotal, firstPageSize);
    }
    return result;
  } catch (error) {
    const result: FollowedMailSync = {
      ok: false,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread: await unreadCountForMailboxPg(mailbox),
      error: error instanceof Error ? error.message : String(error),
      synced_at: syncedAt,
      mailbox,
      listed: 0,
      inserted: 0,
      updated: 0,
    };
    await persistStatus(result);
    // A server-wide missing Starry config is not this mailbox's health: the receipt
    // already carries the reason, so the binding keeps its previous last_error.
    if (starryKolMcpConfigured()) {
      await updateBindingSyncCursorPg({
        userId,
        mailbox,
        syncedAt,
        error: result.error,
        tool: "pageEmailConversations",
      });
    }
    await mailSyncAudit("host", "starrykol.followed_mail_sync_failed", { error: result.error });
    return result;
  }
}
