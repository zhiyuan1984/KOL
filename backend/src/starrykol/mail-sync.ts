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
import { verifyExistingStarryBindings } from "../postgres/kol-source-authority.js";
import { executeStarryKolTask, listStarryMailboxes } from "./service.js";
import { observeReplyMail } from "../mail/reply-source.js";
import { postgresPool } from "../postgres/pool.js";
import { replyMessageBody } from "./mail-fields.js";
import {
  bindingHealthPg,
  bindingPageNoPg,
  collaborationByIdPg,
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
  /** Safe, support-correlatable diagnostic only; never an endpoint, credential, or mail body. */
  diagnostic_id?: string;
  error_code?: string;
  http_status?: number;
  retry_after_ms?: number;
  index_updated?: number;
  body_pending?: number;
  body_completed?: number;
  body_failed?: number;
};

/** The durable receipt shape consumed by the operation-job polling UI. Counters
 * are facts already committed or attempted by this job, never percentages. */
export type MailSyncProgress = {
  index: {
    phase: "listing" | "persisted" | "completed" | "partial_failed";
    listed: number;
    inserted: number;
    updated: number;
    cursor_at: string | null;
    cursor_id: string | null;
    page_no: number;
  };
  body: {
    phase: "pending" | "hydrating" | "completed" | "partial_failed";
    requested: number;
    completed: number;
    failed: number;
    pending: number;
  };
};

/** A worker obtains this only after the current actor, Agent skills, binding,
 * and mailbox scope have been verified using PostgreSQL. */
export type MailSyncAuthorizedScope = {
  required: true;
  bound: true;
  status: "connected";
  mailbox_email: string;
  owner_name: string;
  owner_open_id: string;
  owner_verified_at: string | null;
};

export type MailSyncOptions = {
  checkpoint?: () => Promise<void>;
  diagnosticId?: string;
  /** Invoked only with bounded, safe counter/cursor facts after a checkpoint. */
  onProgress?: (progress: MailSyncProgress) => Promise<void>;
  /** Default remains durable when options are supplied; native read callers may
   * explicitly retain the index-first background behavior. */
  durable?: boolean;
  /** Native worker identity and scope; avoids the retired synchronous binding adapter. */
  actorId?: string;
  authorizedScope?: MailSyncAuthorizedScope;
  /** Optional currently open conversation. It is a prioritization hint, not authorization. */
  conversationId?: string;
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
const READ_RETRY_LIMIT = 1;
const DEFAULT_READ_RETRY_DELAY_MS = 250;
const inflight = new Map<string, Promise<FollowedMailSync>>();
const lastStarted = new Map<string, number>();
type MailSyncRuntimeContext = {
  checkpoint: () => Promise<void>;
  diagnosticId: string;
  durable: boolean;
  postgresNative: boolean;
  onProgress?: (progress: MailSyncProgress) => Promise<void>;
  actorId?: string;
  authorizedScope?: MailSyncAuthorizedScope;
  conversationId?: string;
  progress?: MailSyncProgress;
};
const durableSync = new AsyncLocalStorage<MailSyncRuntimeContext>();
async function syncCheckpoint(): Promise<void> { await durableSync.getStore()?.checkpoint(); }
let backgroundSyncTask: Promise<void> | null = null;

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function blankProgress(pageNo = 1): MailSyncProgress {
  return {
    index: { phase: "listing", listed: 0, inserted: 0, updated: 0, cursor_at: null, cursor_id: null, page_no: Math.max(1, pageNo) },
    body: { phase: "pending", requested: 0, completed: 0, failed: 0, pending: 0 },
  };
}

function progressSnapshot(progress: MailSyncProgress): MailSyncProgress {
  const requested = nonNegative(progress.body.requested);
  const completed = Math.min(requested, nonNegative(progress.body.completed));
  const failed = Math.min(Math.max(0, requested - completed), nonNegative(progress.body.failed));
  return {
    index: {
      phase: progress.index.phase,
      listed: nonNegative(progress.index.listed),
      inserted: nonNegative(progress.index.inserted),
      updated: nonNegative(progress.index.updated),
      cursor_at: progress.index.cursor_at || null,
      cursor_id: progress.index.cursor_id || null,
      page_no: Math.max(1, nonNegative(progress.index.page_no)),
    },
    body: {
      phase: progress.body.phase,
      requested,
      completed,
      failed,
      pending: Math.max(0, requested - completed - failed),
    },
  };
}

function currentProgress(): MailSyncProgress | undefined {
  return durableSync.getStore()?.progress;
}

async function reportProgress(): Promise<void> {
  const context = durableSync.getStore();
  if (!context?.progress || !context.onProgress) return;
  context.progress = progressSnapshot(context.progress);
  await context.onProgress(context.progress);
}

function progressToResult(result: FollowedMailSync, progress = currentProgress()): FollowedMailSync {
  if (!progress) return result;
  const snapshot = progressSnapshot(progress);
  return {
    ...result,
    listed: snapshot.index.listed,
    inserted: snapshot.index.inserted,
    updated: snapshot.index.updated,
    cursor_at: snapshot.index.cursor_at || undefined,
    index_updated: snapshot.index.inserted + snapshot.index.updated,
    body_pending: snapshot.body.pending,
    body_completed: snapshot.body.completed,
    body_failed: snapshot.body.failed,
  };
}

function nativeRuntime(): boolean {
  return Boolean(durableSync.getStore()?.postgresNative);
}

function syncActorId(): string {
  return String(durableSync.getStore()?.actorId || safeEmployeeId() || "").trim();
}

type MailSyncFailure = {
  code: string;
  message: string;
  diagnosticId: string;
  httpStatus?: number;
  retryAfterMs?: number;
};

function syncDiagnosticId(): string {
  return durableSync.getStore()?.diagnosticId || nid("mail_sync");
}

function remoteStatusOf(error: unknown): number | undefined {
  const candidate = error as { remoteStatus?: unknown; status?: unknown; code?: unknown } | undefined;
  for (const value of [candidate?.remoteStatus, candidate?.status, candidate?.code]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return undefined;
}

function remoteRetryAfterOf(error: unknown): number | undefined {
  const value = Number((error as { remoteRetryAfterMs?: unknown } | undefined)?.remoteRetryAfterMs);
  return Number.isFinite(value) && value >= 0 ? Math.min(120_000, Math.round(value)) : undefined;
}

/** Maps transport/storage failures to actionable Chinese text without copying a remote URL, token, or mail text. */
export function classifyMailSyncFailure(error: unknown, diagnosticId = syncDiagnosticId()): MailSyncFailure {
  const raw = error instanceof Error ? error.message : String(error || "");
  const status = remoteStatusOf(error);
  const retryAfterMs = remoteRetryAfterOf(error);
  if (/relation\s+"?mail_sync_state"?\s+does not exist/i.test(raw)) {
    return {
      code: "mail_sync_storage_unavailable",
      message: "邮件同步存储未就绪，已保留本地邮件；请管理员完成同步数据库迁移后重试。",
      diagnosticId,
    };
  }
  if (status === 401) return { code: "mail_source_unauthorized", message: "邮件源授权已失效，请重新连接邮箱后重试。", diagnosticId, httpStatus: status };
  if (status === 403) return { code: "mail_source_forbidden", message: "当前邮箱没有访问邮件源的权限，请检查绑定与授权范围。", diagnosticId, httpStatus: status };
  // A 404 can be an absent endpoint as well as a stale protocol session. This
  // client creates a fresh MCP session per read attempt, so do not blindly retry.
  if (status === 404) return { code: "mail_source_not_found", message: "邮件源端点或会话不可用，请检查连接配置后重试。", diagnosticId, httpStatus: status };
  if (status === 429) return {
    code: "mail_source_rate_limited",
    message: "邮件源请求过于频繁，已保留本地邮件并将按退避时间重试。",
    diagnosticId,
    httpStatus: status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
  if (status !== undefined && status >= 500) return { code: "mail_source_unavailable", message: "邮件源暂不可达，已保留本地邮件，可稍后重试。", diagnosticId, httpStatus: status };
  const kind = (error as { remoteKind?: unknown } | undefined)?.remoteKind;
  if (kind === "timeout" || /request timed out|maximum total timeout exceeded/i.test(raw)) {
    return { code: "mail_source_timeout", message: "邮件源请求超时，已保留本地邮件，可重试。", diagnosticId };
  }
  if (kind === "unreachable" || /fetch failed|connect timeout|ECONNREFUSED|ECONNRESET|EAI_AGAIN|connection closed/i.test(raw)) {
    return { code: "mail_source_unreachable", message: "邮件源连接中断，已保留本地邮件，可重试。", diagnosticId };
  }
  return { code: "mail_sync_failed", message: "邮件同步暂时失败，已保留本地邮件，可重试。", diagnosticId };
}

function retryDelayForRead(failure: MailSyncFailure): number | undefined {
  if (["mail_source_unauthorized", "mail_source_forbidden", "mail_source_not_found", "mail_sync_storage_unavailable"].includes(failure.code)) return undefined;
  if (failure.code === "mail_source_rate_limited") return failure.retryAfterMs ?? DEFAULT_READ_RETRY_DELAY_MS;
  if (["mail_source_unavailable", "mail_source_timeout", "mail_source_unreachable"].includes(failure.code)) return DEFAULT_READ_RETRY_DELAY_MS;
  return undefined;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Only the two explicitly selected mail read tasks use this recovery path.
 * Each retry re-enters service.ts and therefore rebuilds the Streamable HTTP
 * client/session; write tools never pass through here.
 */
async function retryRead<T>(stage: "index" | "body", action: () => Promise<T>): Promise<T> {
  const diagnosticId = syncDiagnosticId();
  for (let attempt = 0; ; attempt += 1) {
    const started = Date.now();
    try {
      return await action();
    } catch (error) {
      const failure = classifyMailSyncFailure(error, diagnosticId);
      const delayMs = retryDelayForRead(failure);
      const retry = delayMs !== undefined && attempt < READ_RETRY_LIMIT;
      await mailSyncAudit("host", "starrykol.followed_mail_sync_remote_failure", {
        diagnostic_id: diagnosticId,
        stage,
        code: failure.code,
        http_status: failure.httpStatus ?? null,
        duration_ms: Date.now() - started,
        retry_attempt: attempt,
        will_retry: retry,
        retry_after_ms: retry ? delayMs : null,
      });
      if (!retry) throw error;
      await syncCheckpoint();
      await wait(delayMs!);
      await syncCheckpoint();
    }
  }
}

onConnReset(() => {
  inflight.clear();
  lastStarted.clear();
});

async function mailboxSyncKey(mailbox = ""): Promise<string> {
  const context = durableSync.getStore();
  const box = mailbox || context?.authorizedScope?.mailbox_email || (await boundMailboxEmail()) || (await currentFollowScope()).mailbox_email || "*";
  return `${syncActorId() || "anon"}:${box}`;
}

async function mailboxStateKey(mailbox = ""): Promise<string> {
  return `${MAIL_STATE_KEY}:${(await mailboxSyncKey(mailbox)).toLowerCase()}`;
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

export async function startFollowedMailSync(force = false, mailbox = ""): Promise<FollowedMailSync> {
  const key = (await mailboxSyncKey(mailbox));
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
  const key = (await mailboxSyncKey(mailbox));
  const existing = inflight.get(key);
  if (existing) return existing;
  if (!force && lastStarted.has(key) && Date.now() - (lastStarted.get(key) || 0) < CACHE_MS) {
    const cached = await followedMailStatus(mailbox);
    if (cached.synced_at) return cached;
  }
  return (await startFollowedMailSync(force, mailbox));
}

export async function followedMailStatus(mailboxOverride = ""): Promise<FollowedMailSync> {
  const mailbox = mailboxOverride || (await boundMailboxEmail()) || (await currentFollowScope()).mailbox_email || "";
  let raw: string | undefined;
  let unread = 0;
  let bind: Awaited<ReturnType<typeof bindingHealthPg>>;
  try {
    [raw, unread, bind] = await Promise.all([
      mailSyncStateGet((await mailboxStateKey(mailbox))),
      unreadCountForMailboxPg(mailbox),
      safeEmployeeId() ? bindingHealthPg(safeEmployeeId()) : Promise.resolve(undefined),
    ]);
  } catch (error) {
    const failure = classifyMailSyncFailure(error);
    await mailSyncAudit("host", "starrykol.followed_mail_sync_status_failed", {
      diagnostic_id: failure.diagnosticId,
      code: failure.code,
      http_status: failure.httpStatus ?? null,
    });
    return {
      ok: false,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread: 0,
      mailbox,
      error: failure.message,
      error_code: failure.code,
      diagnostic_id: failure.diagnosticId,
      ...(failure.httpStatus !== undefined ? { http_status: failure.httpStatus } : {}),
    };
  }
  const safeBindingError = bind?.last_error
    ? (String(bind.last_error).startsWith("邮件") ? String(bind.last_error) : classifyMailSyncFailure(new Error(String(bind.last_error))).message)
    : undefined;
  if (!raw) {
    return {
      ok: Boolean(bind?.synced_at) && !safeBindingError,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: 0,
      inbound: 0,
      unread,
      mailbox,
      synced_at: bind?.synced_at,
      cursor_at: bind?.sync_cursor_at,
      ...(safeBindingError ? { error: safeBindingError } : {}),
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
      ...(safeBindingError ? { error: safeBindingError } : {}),
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
  const scope = durableSync.getStore()?.authorizedScope || (await currentFollowScope());
  const rows = await listBoundCollaborationsPg();
  return rows.filter((row) => {
    if (!scope.required) return true;
    if (!scope.bound || scope.status === "expired") return false;
    return matchesFollowedMailbox(row, scope, [boundMailbox]);
  });
}

async function persistStatus(result: FollowedMailSync): Promise<void> {
  await mailSyncStateSet((await mailboxStateKey(result.mailbox)), JSON.stringify(result));
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
    occurred_at: messageOccurredAt(message),
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

export async function readConversation(
  conversationId: string,
  onRequestStarted?: () => void,
): Promise<{ messages: Json[]; subject: string; occurredAt: string }> {
  return retryRead("body", async () => {
    await syncCheckpoint();
    // A selected conversation can go first, but never before its scope
    // checkpoint has run.
    onRequestStarted?.();
    const { data } = await executeStarryKolTask("email_conversation_read", { conversationId }, "host");
    await syncCheckpoint();
    const messages = listOf(data);
    return {
      messages,
      subject: conversationSubject(data, ...messages),
      occurredAt: messageOccurredAt(messages[messages.length - 1] || data) || messageOccurredAt(data),
    };
  });
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
export async function hydrateMailThread(thread: Row, onRequestStarted?: () => void): Promise<number> {
  const conversationId = String(thread.conversation_id || "");
  if (!conversationId) return 0;
  const detail = await readConversation(conversationId, onRequestStarted);
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
  // The durable PostgreSQL worker keeps its authoritative mail index in PG.
  // Historical memory projections remain only on the compatibility path.
  if (col && !nativeRuntime()) {
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
  // Body availability and AI-derived content are independent. The existing
  // explicit translation/summary path owns generation; sync only marks state.
  await markThreadTranslationsPendingPg(String(thread.id));
  return inserted;
}

type IndexedConversation = { conversationId: string; inserted: boolean; lastAt: string };

/**
 * The listing is sufficient to create a browsable thread shell. Keep this
 * separate from body hydration: a slow or failed getEmailConversation must not
 * delay the first local index commit or erase an already stored body.
 */
async function persistConversationIndex(conv: Json, mailbox: string, collabs: Row[]): Promise<IndexedConversation | undefined> {
  const conversationId = conversationIdOf(conv);
  if (!conversationId) return undefined;
  const col = matchCollaboration(conv, collabs, mailbox);
  const inbound = inboundOf(conv, col, mailbox);
  const listedUnread = Number(conv.unreadCount ?? conv.unread_count);
  const from = messageFrom(conv);
  const snippet = messageBody(conv);
  const lastAt = messageOccurredAt(conv) || remoteConversationTime(conv);
  const threadMailbox = mailbox || conversationMailboxOf(conv) || firstString(conv.mailboxEmail, col?.mailbox_from);
  const thread = await upsertThread({
    collaborationId: col ? String(col.id) : null,
    conversationId,
    subject: conversationSubject(conv) || "(无主题)",
    mailbox: threadMailbox,
    direction: inbound ? "inbound" : "outbound",
    snippet,
    preview: mailPreview(snippet),
    from: from.email,
    fromName: from.name,
    peerEmail: from.email,
    peerName: from.name,
    unread: Number.isFinite(listedUnread) && listedUnread >= 0 ? listedUnread : (inbound && isUnread(conv) ? 1 : 0),
    lastAt,
    matchState: col ? "matched" : "unbound",
  });
  if (col && String(col.conversation_id || "").startsWith("conv_")) {
    await updateCollaborationConversationPg(conversationId, String(col.id));
  }
  return { conversationId, inserted: thread.inserted, lastAt };
}

async function persistConversationIndexes(conversations: Json[], mailbox: string, collabs: Row[]): Promise<{
  inserted: number;
  updated: number;
  cursorAt: string;
  cursorId: string;
}> {
  let inserted = 0;
  let updated = 0;
  let cursorAt = "";
  let cursorId = "";
  for (const conv of conversations) {
    await syncCheckpoint();
    const indexed = await persistConversationIndex(conv, mailbox, collabs);
    if (!indexed) continue;
    if (indexed.inserted) inserted += 1;
    else updated += 1;
    if (indexed.lastAt && (!cursorAt || indexed.lastAt > cursorAt)) {
      cursorAt = indexed.lastAt;
      cursorId = indexed.conversationId;
    }
  }
  return { inserted, updated, cursorAt, cursorId };
}

async function hydrateConversationById(
  conv: Json,
  mailbox: string,
  collabs: Row[],
  onRequestStarted?: () => void,
): Promise<number> {
  await syncCheckpoint();
  const conversationId = conversationIdOf(conv);
  if (!conversationId) return 0;
  let thread = (await postgresPool().query<Row>(
    "SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2", [conversationId,mailbox],
  )).rows[0];
  if (!thread) {
    // Later pages normally arrive indexed already; retain this fallback for a
    // direct hydration request without introducing a second sync path.
    await persistConversationIndex(conv, mailbox, collabs);
    thread = (await postgresPool().query<Row>(
      "SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND mailbox=$2", [conversationId,mailbox],
    )).rows[0];
  }
  if (!thread) return 0;
  return hydrateMailThread(thread, onRequestStarted);
}

function prioritizeDetailCandidates(conversations: Json[], conversationId = ""): Json[] {
  const selected = String(conversationId || "");
  return [...conversations].sort((left, right) => {
    const leftId = conversationIdOf(left);
    const rightId = conversationIdOf(right);
    if (selected) {
      if (leftId === selected && rightId !== selected) return -1;
      if (rightId === selected && leftId !== selected) return 1;
    }
    const unreadDelta = Number(isUnread(right)) - Number(isUnread(left));
    if (unreadDelta) return unreadDelta;
    return timestampMs(remoteConversationTime(right)) - timestampMs(remoteConversationTime(left));
  });
}

/** Report completed and failed remote detail reads once per bounded batch. If a
 * read failed, throw only after its sibling requests and this checkpoint have
 * been recorded, so a retry resumes from retained local facts. */
async function hydrateConversationBatches(
  candidates: Json[],
  mailbox: string,
  collabs: Row[],
  conversationId = "",
): Promise<void> {
  const ordered = prioritizeDetailCandidates(candidates, conversationId);
  for (let index = 0; index < ordered.length; index += 5) {
    const batch = ordered.slice(index, index + 5);
    let completed = 0;
    const failures: unknown[] = [];
    const hydrateOne = async (conversation: Json, onRequestStarted?: () => void) => {
      try {
        await hydrateConversationById(conversation, mailbox, collabs, onRequestStarted);
        completed += 1;
      } catch (error) {
        failures.push(error);
      }
    };
    // Start the currently requested body before its siblings.  This waits only
    // until the authorized remote request is initiated, not for its body to
    // finish, preserving the five-read concurrent hydration limit.
    const requested = String(conversationId || "");
    const selectedIndex = requested ? batch.findIndex((candidate) => conversationIdOf(candidate) === requested) : -1;
    if (selectedIndex >= 0) {
      const [selected] = batch.splice(selectedIndex, 1);
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => { signalStarted = resolve; });
      const selectedTask = hydrateOne(selected, signalStarted);
      // A checkpoint or storage failure before the remote request must not
      // deadlock this batch; the failure remains part of the batch result.
      await Promise.race([started, selectedTask]);
      await mapLimited(batch, 4, hydrateOne);
      await selectedTask;
    } else {
      await mapLimited(batch, 5, hydrateOne);
    }
    const progress = currentProgress();
    if (progress) {
      progress.body.phase = failures.length ? "partial_failed" : "hydrating";
      progress.body.completed += completed;
      progress.body.failed += failures.length;
      progress.body.pending = Math.max(0, progress.body.requested - progress.body.completed - progress.body.failed);
      await reportProgress();
    }
    if (failures.length) throw failures[0];
  }
}

async function fetchConversationPage(pageNo: number, pageSize: number, mailbox: string): Promise<{ pageNo: number; pageSize: number; total: number; rawCount: number; conversations: Json[] }> {
  const listed = await retryRead("index", async () => {
    await syncCheckpoint();
    const result = await executeStarryKolTask("email_conversation_list", {
      pageNo,
      pageSize,
      ...(mailbox ? { mailboxEmail: mailbox } : {}),
    }, "host");
    await syncCheckpoint();
    return result;
  });
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
  await hydrateConversationBatches(remaining, mailbox, collabs, durableSync.getStore()?.conversationId);

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

    // Commit the whole page index before any detail call. A body failure then
    // leaves the page browseable and the durable cursor recoverable.
    const indexed = await persistConversationIndexes(conversations, mailbox, collabs);
    await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, pageNo, tool: "pageEmailConversations" });

    const pageCandidates = await conversationsNeedingDetail(conversations, mailbox, userId);
    const progress = currentProgress();
    if (progress) {
      progress.index.phase = "persisted";
      progress.index.listed += conversations.length;
      progress.index.inserted += indexed.inserted;
      progress.index.updated += indexed.updated;
      progress.index.page_no = pageNo;
      if (indexed.cursorAt && (!progress.index.cursor_at || indexed.cursorAt > progress.index.cursor_at)) {
        progress.index.cursor_at = indexed.cursorAt;
        progress.index.cursor_id = indexed.cursorId || null;
      }
      progress.body.requested += pageCandidates.length;
      progress.body.pending = Math.max(0, progress.body.requested - progress.body.completed - progress.body.failed);
      progress.body.phase = progress.body.pending ? "pending" : progress.body.phase;
      await reportProgress();
    }
    await hydrateConversationBatches(pageCandidates, mailbox, collabs, durableSync.getStore()?.conversationId);

    // Spec §3: a partial page means no more data; so does reaching total.
    // Compare against the raw remote count: the remote may return other
    // employees' rows that the mailbox filter drops.
    if (page.rawCount < lastPageSize) break;
    if (knownTotal > 0 && pageNo * lastPageSize >= knownTotal) break;
    pageNo += 1;
    pagesProcessed += 1;
  }

  if (durableSync.getStore()?.durable && pagesProcessed >= MAX_BACKGROUND_PAGES) throw new Error("mail_sync_page_limit: 请重试以继续剩余分页");
  await syncCheckpoint();
  await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, pageNo: 1, tool: "pageEmailConversations" });
  const progress = currentProgress();
  if (progress) {
    progress.index.phase = "completed";
    progress.body.phase = progress.body.failed ? "partial_failed" : "completed";
    progress.body.pending = Math.max(0, progress.body.requested - progress.body.completed - progress.body.failed);
    await reportProgress();
  }
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
      const failure = classifyMailSyncFailure(error);
      const result: FollowedMailSync = {
        ok: false,
        source: "starry",
        tool: "pageEmailConversations",
        conversations: 0,
        inbound: 0,
        unread: 0,
        mailbox,
        synced_at: syncedAt,
        error: failure.message,
        error_code: failure.code,
        diagnostic_id: failure.diagnosticId,
        ...(failure.httpStatus !== undefined ? { http_status: failure.httpStatus } : {}),
        ...(failure.retryAfterMs !== undefined ? { retry_after_ms: failure.retryAfterMs } : {}),
      };
      try { await persistStatus(result); } catch { /* the primary failure is retained below */ }
      if ((await starryKolMcpConfigured())) {
        await updateBindingSyncCursorPg({
          userId,
          mailbox,
          syncedAt,
          error: failure.message,
          tool: "pageEmailConversations",
        });
      }
      await mailSyncAudit("host", "starrykol.followed_mail_sync_background_failed", {
        diagnostic_id: failure.diagnosticId,
        code: failure.code,
        http_status: failure.httpStatus ?? null,
        retry_after_ms: failure.retryAfterMs ?? null,
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

/**
 * A user can request an older cached conversation that no longer appears in the
 * current paged index. Its source ID is still valid at Starry, so hydrate the
 * already-authorized local thread directly rather than treating a list omission
 * as “no original text”. This is read-only and never creates a conversation.
 */
async function hydrateRequestedConversationIfNeeded(conversationId: string, mailbox: string): Promise<boolean> {
  const requested = String(conversationId || "").trim();
  if (!requested || !mailbox) return false;
  const thread = (await postgresPool().query<Row>(
    "SELECT * FROM kol_mail_threads WHERE conversation_id=$1 AND lower(mailbox)=lower($2) LIMIT 1",
    [requested, mailbox],
  )).rows[0];
  if (!thread) return false;
  const existing = await postgresPool().query<{ has_body: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM kol_mail_items WHERE thread_id=$1 AND COALESCE(body_text,'')<>'') AS has_body",
    [String(thread.id)],
  );
  if (Boolean(existing.rows[0]?.has_body)) return false;
  await hydrateMailThread(thread);
  return true;
}

export async function syncMailboxMail(mailbox = ""): Promise<FollowedMailSync> {
  return ensureFollowedMailSync(true, mailbox);
}

export async function syncFollowedKolMail(mailboxOverride = "", options?: MailSyncOptions): Promise<FollowedMailSync> {
  const isDurable = options?.durable ?? Boolean(options);
  return durableSync.run({
    checkpoint: options?.checkpoint || (async () => {}),
    diagnosticId: options?.diagnosticId || nid("mail_sync"),
    durable: isDurable,
    postgresNative: Boolean(options?.actorId && options?.authorizedScope),
    onProgress: options?.onProgress,
    actorId: options?.actorId,
    authorizedScope: options?.authorizedScope,
    conversationId: options?.conversationId,
    // Durable workers need a real object here: the inner sync resets it to the
    // persisted page pointer and reports the first committed index receipt.
    ...(isDurable ? { progress: blankProgress() } : {}),
  }, () => syncFollowedKolMailInner(mailboxOverride));
}

async function syncFollowedKolMailInner(mailboxOverride: string): Promise<FollowedMailSync> {
  await syncCheckpoint();
  const syncedAt = nowIso();
  const runtime = durableSync.getStore();
  const scope = runtime?.authorizedScope || (await currentFollowScope());
  const userId = syncActorId();
  if (scope.required && scope.bound) {
    // Read-only verification refreshes only a previously selected binding.
    try { await verifyExistingStarryBindings(userId, await listStarryMailboxes()); }
    catch (error) {
      const failure = classifyMailSyncFailure(error);
      await mailSyncAudit(userId, "starrykol.binding_verification_failed", {
        diagnostic_id: failure.diagnosticId,
        code: failure.code,
        http_status: failure.httpStatus ?? null,
      });
    }
  }
  const mailbox = mailboxOverride || runtime?.authorizedScope?.mailbox_email || (await boundMailboxEmail()) || scope.mailbox_email || "";
  const requestedConversationId = String(runtime?.conversationId || "").trim();
  const collabs = await followedCollaborations(mailbox);
  const startPageNo = userId ? await bindingPageNoPg(userId, mailbox) : 1;
  if (runtime?.progress) {
    runtime.progress = blankProgress(startPageNo);
    await reportProgress();
  }
  let partial: FollowedMailSync | undefined;
  // Do this before walking the current index: a requested historical thread
  // may be omitted from every current page but remains directly readable.
  const requestedBodyRead = await hydrateRequestedConversationIfNeeded(requestedConversationId, mailbox);
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
    try {
      await persistStatus(empty);
      await updateBindingSyncCursorPg({ userId, mailbox, syncedAt, tool: "pageEmailConversations" });
      return empty;
    } catch (error) {
      const failure = classifyMailSyncFailure(error);
      await mailSyncAudit("host", "starrykol.followed_mail_sync_empty_failed", {
        diagnostic_id: failure.diagnosticId,
        code: failure.code,
      });
      return {
        ...empty,
        ok: false,
        error: failure.message,
        error_code: failure.code,
        diagnostic_id: failure.diagnosticId,
      };
    }
  }
  try {
    // pageEmailConversations does not expose a mailbox filter in its MCP schema.
    // The remote currently ignores mailboxEmail and may return other employees' rows.
    const { conversations, total: firstPageTotal, pageSize: firstPageSize } = await fetchConversationPage(startPageNo, 50, mailbox);
    // First commit the whole page's local index. Do not wait for five remote
    // body requests: the UI can immediately browse subject/from/unread shells.
    const indexed = await persistConversationIndexes(conversations, mailbox, collabs);
    const detailCandidates = await conversationsNeedingDetail(conversations, mailbox, userId);
    const unread = await unreadCountForMailboxPg(mailbox);
    const progress = currentProgress();
    if (progress) {
      progress.index.phase = "persisted";
      progress.index.listed = conversations.length;
      progress.index.inserted = indexed.inserted;
      progress.index.updated = indexed.updated;
      progress.index.cursor_at = indexed.cursorAt || syncedAt;
      progress.index.cursor_id = indexed.cursorId || null;
      progress.index.page_no = startPageNo;
      progress.body.phase = detailCandidates.length ? "pending" : "completed";
      progress.body.requested = detailCandidates.length + (requestedBodyRead ? 1 : 0);
      progress.body.completed = requestedBodyRead ? 1 : 0;
      progress.body.failed = 0;
      progress.body.pending = detailCandidates.length;
      // The first index is already committed at this point. Do not make the
      // operation-job UI wait for a remote conversation body to learn that.
      await reportProgress();
    }
    const result: FollowedMailSync = {
      ok: true,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: conversations.length,
      inbound: 0,
      unread: Number(unread),
      synced_at: syncedAt,
      mailbox,
      listed: conversations.length,
      inserted: indexed.inserted,
      updated: indexed.updated,
      cursor_at: indexed.cursorAt || syncedAt,
      diagnostic_id: syncDiagnosticId(),
      index_updated: indexed.inserted + indexed.updated,
      body_pending: detailCandidates.length,
      body_completed: requestedBodyRead ? 1 : 0,
    };
    partial = progressToResult(result);
    await persistStatus(partial);
    await updateBindingSyncCursorPg({
      userId,
      mailbox,
      syncedAt,
      cursorAt: result.cursor_at,
      cursorId: indexed.cursorId,
      tool: "pageEmailConversations",
    });
    await mailSyncAudit("host", "starrykol.followed_mail_sync", partial);
    if (!nativeRuntime()) {
      await markPendingMailMemory(mailbox);
      if (!durableSync.getStore()?.durable) triggerMailMemoryIncrement(mailbox);
    }
    if (durableSync.getStore()?.durable) {
      await syncRemainingConversations(detailCandidates, mailbox, collabs, startPageNo, userId, syncedAt, firstPageTotal, firstPageSize);
      await syncCheckpoint();
      const completed = progressToResult(result);
      await persistStatus(completed);
      return completed;
    } else {
      scheduleBackgroundSync(detailCandidates, mailbox, collabs, startPageNo, userId, syncedAt, firstPageTotal, firstPageSize);
    }
    return partial;
  } catch (error) {
    const failure = classifyMailSyncFailure(error);
    const progress = currentProgress();
    if (progress) {
      progress.index.phase = progress.index.listed ? "partial_failed" : progress.index.phase;
      progress.body.phase = "partial_failed";
      progress.body.pending = Math.max(0, progress.body.requested - progress.body.completed - progress.body.failed);
      try { await reportProgress(); } catch { /* final result below remains the safe durable receipt */ }
    }
    let unread = 0;
    try { unread = await unreadCountForMailboxPg(mailbox); } catch { /* storage cause is already classified */ }
    const result = progressToResult({
      ok: false,
      source: "starry",
      tool: "pageEmailConversations",
      conversations: partial?.conversations || 0,
      inbound: 0,
      unread,
      error: failure.message,
      error_code: failure.code,
      diagnostic_id: failure.diagnosticId,
      ...(failure.httpStatus !== undefined ? { http_status: failure.httpStatus } : {}),
      ...(failure.retryAfterMs !== undefined ? { retry_after_ms: failure.retryAfterMs } : {}),
      synced_at: syncedAt,
      mailbox,
      listed: partial?.listed || 0,
      inserted: partial?.inserted || 0,
      updated: partial?.updated || 0,
      cursor_at: partial?.cursor_at,
      index_updated: partial?.index_updated || 0,
      body_pending: partial?.body_pending || 0,
      body_completed: partial?.body_completed || 0,
      body_failed: partial?.body_failed || 0,
    });
    try { await persistStatus(result); } catch { /* result is still returned and binding/audit below remain safe */ }
    // A server-wide missing Starry config is not this mailbox's health: the receipt
    // already carries the reason, so the binding keeps its previous last_error.
    if ((await starryKolMcpConfigured())) {
      await updateBindingSyncCursorPg({
        userId,
        mailbox,
        syncedAt,
        error: failure.message,
        tool: "pageEmailConversations",
      });
    }
    await mailSyncAudit("host", "starrykol.followed_mail_sync_failed", {
      diagnostic_id: failure.diagnosticId,
      code: failure.code,
      http_status: failure.httpStatus ?? null,
      retry_after_ms: failure.retryAfterMs ?? null,
    });
    return result;
  }
}
