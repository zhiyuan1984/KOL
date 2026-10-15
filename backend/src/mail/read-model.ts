import { postgresConnection } from "../postgres/pool.js";
import { readNativePersonMemory } from "../postgres/mail-memory-repository.js";
import { authDisabled, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { HttpFail } from "../host/errors.js";
import { normalizeEmail } from "../host/identity.js";
import type { Json, Row } from "../types.js";
import type { QueryConfig, QueryResult } from "pg";

/**
 * PostgreSQL-only local read model for the mailbox page.
 *
 * These helpers deliberately do not import the historical synchronous mail
 * memory store. A GET is a bounded set of parameterized local PG reads: it
 * neither starts sync nor changes translation/memory state.
 */

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
  /** Additive: lets callers distinguish a retained but revoked binding. */
  status: string;
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

export type ConversationRow = {
  id: string;
  mailbox: string;
  conversation_id: string;
  collaboration_id: string | null;
  match_state: "matched" | "unbound" | "deferred" | "ignored";
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
  direction: "inbound" | "outbound";
  occurred_at: string | null;
  from_addr: string;
  from_name: string;
  to_addr: string;
  subject: string;
  title: string;
  snippet: string;
  body_text?: string;
  /** Raw original availability, intentionally independent from translation. */
  body_status: "ready" | "not_synced";
  letter_summary: string;
  summary_source: string;
  translation_zh: string | null;
  translation_source: string;
  translation_status: "ready" | "pending" | "not_started";
  receipt_status: string;
  effective: boolean;
  unread: boolean;
  memory_fingerprint: string;
  memory_source: string;
  memory_generated_at: string | null;
  memory_error: string;
  memory_attempts: number;
};

export type OnDemandMemory = {
  status: "未开始" | "已完成";
  mailbox: string;
  subject: string;
  conversation_id: string;
  message_id?: string;
  text: string;
  fingerprint: string;
  completed_at?: string;
  error?: string;
};

export type PersonDigest = {
  text: string;
  source: string;
  mail_count: number;
  fingerprint: string;
  generated_at?: string;
  error?: string;
  failed_at?: string;
};

type ReadActor = { id: string };
type BindingRow = Row & {
  mailbox_email?: unknown;
  is_default?: unknown;
  status?: unknown;
  owner_name?: unknown;
  owner_brand?: unknown;
  synced_at?: unknown;
  last_error?: unknown;
  last_tool?: unknown;
  sync_cursor_at?: unknown;
  sync_cursor_id?: unknown;
  sync_page_no?: unknown;
  unread?: unknown;
};

const MATCH_STATES = new Set<ConversationRow["match_state"]>(["matched", "unbound", "deferred", "ignored"]);
const READ_QUERY_TIMEOUT_MS = 5_000;

/** Bound each employee-facing local read without changing the shared pool/global PG setting. */
async function readQuery<T extends Row = Row>(textSql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
  // pg supports a per-query timeout; the installed @types/pg omits this field.
  const config: QueryConfig & { query_timeout: number } = {
    text: textSql,
    values: [...values],
    query_timeout: READ_QUERY_TIMEOUT_MS,
  };
  return postgresConnection().query<T>(config);
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function optionalText(value: unknown): string | null {
  const valueText = text(value);
  return valueText ? valueText : null;
}

function number(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function rawObject(value: unknown): Row {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

/** Prefer persisted normalized columns, then support raw fields from normalizeThread callers. */
function field(row: Row, ...keys: string[]): unknown {
  const raw = rawObject(row.raw_fields ?? row.rawFields ?? row.raw);
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return raw[key];
  }
  return "";
}

function readActor(): ReadActor {
  const user = scopedUser();
  if (user) {
    if (!user.active) throw new HttpFail(403, { code: "actor_inactive" });
    return { id: user.id };
  }
  if (authDisabled()) return { id: DEMO_USER.id };
  throw new HttpFail(401, { code: "authentication_required" });
}

function rowBinding(row: BindingRow): MailboxBinding {
  const mailbox = normalizeEmail(text(row.mailbox_email));
  const status = text(row.status || "connected");
  const connected = status === "connected";
  const ownerName = text(row.owner_name);
  return {
    mailbox,
    label: ownerName || mailbox.split("@")[0] || mailbox,
    owner_name: ownerName,
    brand: text(row.owner_brand),
    region: "",
    unread: number(row.unread),
    bound: Boolean(mailbox) && connected,
    synced_at: optionalText(row.synced_at),
    error: optionalText(row.last_error),
    status,
  };
}

async function bindingsFor(actor: ReadActor): Promise<BindingRow[]> {
  return (await readQuery<BindingRow>(
    `SELECT b.mailbox_email,b.is_default,b.status,b.owner_name,b.synced_at,b.last_error,
            b.last_tool,b.sync_cursor_at,b.sync_cursor_id,b.sync_page_no,
            o.brand AS owner_brand,COALESCE(SUM(t.unread_count),0)::int AS unread
       FROM user_starry_bindings b
       LEFT JOIN mailbox_owners o ON lower(o.email)=lower(b.mailbox_email)
       LEFT JOIN kol_mail_threads t ON lower(t.mailbox)=lower(b.mailbox_email)
       WHERE b.user_id=$1
       GROUP BY b.mailbox_email,b.is_default,b.status,b.owner_name,b.synced_at,b.last_error,
                b.last_tool,b.sync_cursor_at,b.sync_cursor_id,b.sync_page_no,b.updated_at,o.brand
       ORDER BY b.is_default DESC,b.updated_at ASC,b.mailbox_email ASC`,
    [actor.id],
  )).rows;
}

function explicitMailbox(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string" || /\p{Cc}/u.test(raw)) throw new HttpFail(400, { code: "mailbox_invalid" });
  const mailbox = normalizeEmail(raw);
  if (!mailbox) throw new HttpFail(400, { code: "mailbox_invalid" });
  return mailbox;
}

function selectBinding(bindings: BindingRow[], rawMailbox: unknown): BindingRow | undefined {
  const requested = explicitMailbox(rawMailbox);
  if (requested) {
    const selected = bindings.find((row) => normalizeEmail(text(row.mailbox_email)) === requested && text(row.status || "connected") === "connected");
    if (!selected) throw new HttpFail(403, { code: "mailbox_access_denied" });
    return selected;
  }
  // Never choose an arbitrary mailbox: no connected default means no selected scope.
  return bindings.find((row) => truthy(row.is_default) && text(row.status || "connected") === "connected");
}

async function selectedMailbox(rawMailbox: unknown): Promise<{ actor: ReadActor; binding?: BindingRow; bindings: BindingRow[] }> {
  const actor = readActor();
  const bindings = await bindingsFor(actor);
  return { actor, bindings, binding: selectBinding(bindings, rawMailbox) };
}

function matchState(value: unknown, collaborationId: unknown): ConversationRow["match_state"] {
  const candidate = text(value).trim() as ConversationRow["match_state"];
  if (MATCH_STATES.has(candidate)) return candidate;
  return text(collaborationId).trim() ? "matched" : "unbound";
}

/**
 * Normalize both PG aliases and the original camelCase/raw payload shape that
 * normalizeThread receives from the provider. It is pure so sync projections
 * and read tests can share the same compatibility behavior without a query.
 */
export function normalizeThread(row: Row): ConversationRow {
  const collaborationId = text(field(row, "collaboration_id", "collaborationId"));
  const digestText = text(field(row, "digest_text", "digestText"));
  const mailbox = normalizeEmail(text(field(row, "mailbox", "mailbox_email", "mailboxEmail"))) || text(field(row, "mailbox", "mailbox_email", "mailboxEmail"));
  const out: ConversationRow = {
    id: text(field(row, "id", "thread_id", "threadId")),
    mailbox,
    conversation_id: text(field(row, "conversation_id", "conversationId", "thread_id", "threadId", "id")),
    collaboration_id: collaborationId || null,
    match_state: matchState(field(row, "match_state", "matchState"), collaborationId),
    subject: text(field(row, "subject", "title", "topic")) || "(无主题)",
    peer_email: text(field(row, "peer_email", "peerEmail", "last_from", "lastFrom")),
    peer_name: text(field(row, "peer_name", "peerName", "last_from_name", "lastFromName")),
    last_at: optionalText(field(row, "last_at", "lastAt", "lastMessageAt")),
    last_direction: text(field(row, "last_direction", "lastDirection", "direction")),
    last_preview: text(field(row, "last_preview", "lastPreview", "last_snippet", "lastSnippet", "snippet")),
    unread_count: number(field(row, "unread_count", "unreadCount")),
    message_count: number(field(row, "message_count", "messageCount")),
    starred: truthy(field(row, "starred")),
    last_receipt: text(field(row, "last_receipt", "lastReceipt")),
    digest_source: text(field(row, "digest_source", "digestSource")),
    ...(digestText ? { digest_text: digestText } : {}),
    ...(text(field(row, "kol_uid", "kolUid")) ? { kol_uid: text(field(row, "kol_uid", "kolUid")) } : {}),
    ...(text(field(row, "handle")) ? { handle: text(field(row, "handle")) } : {}),
    ...(text(field(row, "stage_code", "stageCode")) ? { stage_code: text(field(row, "stage_code", "stageCode")) } : {}),
  };
  return out;
}

export function normalizeMessage(row: Row): MessageRow {
  const body = text(field(row, "body_text", "bodyText", "body", "content", "text"));
  const translated = text(field(row, "translation_zh", "translationZh"));
  const translationSource = text(field(row, "translation_source", "translationSource"));
  return {
    id: text(field(row, "id", "message_id", "messageId")),
    conversation_id: text(field(row, "conversation_id", "conversationId")),
    provider_message_id: text(field(row, "provider_message_id", "providerMessageId", "messageId")),
    direction: text(field(row, "direction")) === "outbound" ? "outbound" : "inbound",
    occurred_at: optionalText(field(row, "occurred_at", "occurredAt", "sentAt", "receivedAt")),
    from_addr: text(field(row, "from_addr", "fromAddr", "from", "fromEmail", "from_name", "fromName")),
    from_name: text(field(row, "from_name", "fromName")),
    to_addr: text(field(row, "to_addr", "toAddr", "to", "toEmail")),
    subject: text(field(row, "subject")),
    title: text(field(row, "title", "messageTitle", "message_title")),
    snippet: text(field(row, "snippet", "preview")),
    ...(body ? { body_text: body } : {}),
    body_status: body ? "ready" : "not_synced",
    letter_summary: text(field(row, "summary", "summary_zh", "letter_summary", "letterSummary")),
    summary_source: text(field(row, "summary_source", "summarySource")),
    translation_zh: translated || null,
    translation_source: translationSource,
    translation_status: translated ? "ready" : translationSource === "pending" ? "pending" : "not_started",
    receipt_status: text(field(row, "receipt_status", "receiptStatus")),
    effective: truthy(field(row, "effective")),
    unread: truthy(field(row, "unread")),
    memory_fingerprint: text(field(row, "memory_fingerprint", "memoryFingerprint")),
    memory_source: text(field(row, "memory_source", "memorySource")),
    memory_generated_at: optionalText(field(row, "memory_generated_at", "memoryGeneratedAt")),
    memory_error: text(field(row, "memory_error", "memoryError")),
    memory_attempts: number(field(row, "memory_attempts", "memoryAttempts")),
  };
}

function parseOnDemandMemory(value: unknown): OnDemandMemory | null {
  const raw = rawObject(value);
  if (!Object.keys(raw).length) return null;
  const status = text(raw.status) === "已完成" ? "已完成" : "未开始";
  return {
    status,
    mailbox: text(raw.mailbox),
    subject: text(raw.subject),
    conversation_id: text(raw.conversation_id),
    ...(text(raw.message_id) ? { message_id: text(raw.message_id) } : {}),
    text: text(raw.text),
    fingerprint: text(raw.fingerprint),
    ...(text(raw.completed_at) ? { completed_at: text(raw.completed_at) } : {}),
    ...(text(raw.error) ? { error: text(raw.error) } : {}),
  };
}

export async function readMailboxBox(rawMailbox: unknown): Promise<{ bindings: MailboxBinding[]; box: MailBoxStatus }> {
  const { bindings, binding } = await selectedMailbox(rawMailbox);
  const mapped = bindings.map(rowBinding);
  const selected = binding ? rowBinding(binding) : undefined;
  return {
    bindings: mapped,
    box: {
      mailbox: selected?.mailbox || "",
      bound: Boolean(selected?.bound),
      unread: selected?.unread || 0,
      synced_at: binding ? optionalText(binding.synced_at) : null,
      error: binding ? optionalText(binding.last_error) : null,
      last_tool: binding ? optionalText(binding.last_tool) : null,
      cursor_at: binding ? optionalText(binding.sync_cursor_at) : null,
      cursor_id: binding ? optionalText(binding.sync_cursor_id) : null,
      cursor_page_no: binding ? number(binding.sync_page_no) || 1 : 1,
    },
  };
}

export async function readMailboxConversations(rawMailbox: unknown): Promise<{ mailbox: string; conversations: ConversationRow[] }> {
  const { binding } = await selectedMailbox(rawMailbox);
  if (!binding) return { mailbox: "", conversations: [] };
  const mailbox = normalizeEmail(text(binding.mailbox_email));
  const rows = (await readQuery<Row>(
    `SELECT t.id,t.mailbox,t.conversation_id,t.collaboration_id,t.match_state,t.subject,
            t.peer_email,t.peer_name,t.last_from,t.last_from_name,t.last_at,t.last_direction,t.last_preview,
            t.unread_count,t.starred,t.last_receipt,t.digest_source,
            c.kol_uid,c.handle,c.stage_code,COALESCE(COUNT(i.id),0)::int AS message_count
       FROM kol_mail_threads t
       LEFT JOIN collaborations c ON c.id=t.collaboration_id
       LEFT JOIN kol_mail_items i ON i.thread_id=t.id
       WHERE lower(t.mailbox)=lower($1)
       GROUP BY t.id,t.mailbox,t.conversation_id,t.collaboration_id,t.match_state,t.subject,
                t.peer_email,t.peer_name,t.last_from,t.last_from_name,t.last_at,t.last_direction,t.last_preview,
                t.unread_count,t.starred,t.last_receipt,t.digest_source,c.kol_uid,c.handle,c.stage_code
       ORDER BY t.last_at DESC NULLS LAST,t.updated_at DESC NULLS LAST`,
    [mailbox],
  )).rows;
  return { mailbox, conversations: rows.map(normalizeThread) };
}

export type ConversationRead = {
  conversation: ConversationRow;
  messages: MessageRow[];
  digest_text: string;
  digest_source: string;
  summary_memory: OnDemandMemory;
  /** Additive detail state; no translation task controls raw-body readiness. */
  body_status: "ready" | "not_synced";
  body_available_count: number;
  body_missing_count: number;
};

export async function readMailboxConversation(rawMailbox: unknown, rawId: unknown): Promise<ConversationRead> {
  const { binding } = await selectedMailbox(rawMailbox);
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!binding || !id) throw new HttpFail(404, "conversation not found");
  const mailbox = normalizeEmail(text(binding.mailbox_email));
  const summaryKeyPrefix = "mail_summary_memory:";
  const result = await readQuery<Row>(
    `WITH selected_thread AS (
       SELECT t.*,c.kol_uid,c.handle,c.stage_code
         FROM kol_mail_threads t
         LEFT JOIN collaborations c ON c.id=t.collaboration_id
        WHERE lower(t.mailbox)=lower($1) AND (t.id=$2 OR t.conversation_id=$2)
        ORDER BY CASE WHEN t.id=$2 THEN 0 ELSE 1 END,t.updated_at DESC NULLS LAST
        LIMIT 1
     )
     SELECT t.*,i.id AS item_id,i.thread_id AS item_thread_id,i.conversation_id AS item_conversation_id,
            i.provider_message_id,i.direction AS item_direction,i.subject AS item_subject,i.title AS item_title,
            i.snippet AS item_snippet,i.unread AS item_unread,i.occurred_at,i.created_at AS item_created_at,
            i.from_addr,i.from_name,i.to_addr,i.body_text,i.summary,i.summary_zh,i.summary_source,
            i.translation_zh,i.translation_source,i.memory_fingerprint,i.memory_source,i.memory_generated_at,
            i.memory_error,i.memory_attempts,i.receipt_status,i.effective,
            s.value AS summary_memory_value
       FROM selected_thread t
       LEFT JOIN kol_mail_items i ON i.thread_id=t.id
       LEFT JOIN app_state s ON s.key=concat($3::text,t.mailbox,':',t.conversation_id,':')
       ORDER BY i.occurred_at ASC NULLS LAST,i.created_at ASC NULLS LAST,i.id ASC`,
    [mailbox, id, summaryKeyPrefix],
  );
  if (!result.rows.length) throw new HttpFail(404, "conversation not found");
  const first = result.rows[0];
  const conversation = normalizeThread(first);
  const messages = result.rows
    .filter((row) => Boolean(text(row.item_id)))
    .map((row) => normalizeMessage({
      ...row,
      id: row.item_id,
      thread_id: row.item_thread_id,
      conversation_id: row.item_conversation_id,
      direction: row.item_direction,
      subject: row.item_subject,
      title: row.item_title,
      snippet: row.item_snippet,
      unread: row.item_unread,
      created_at: row.item_created_at,
    }));
  const summaryMemory = parseOnDemandMemory(first.summary_memory_value) || {
    status: "未开始" as const,
    mailbox: conversation.mailbox,
    subject: conversation.subject,
    conversation_id: conversation.conversation_id,
    text: "",
    fingerprint: "",
  };
  const bodyAvailableCount = messages.filter((message) => message.body_status === "ready").length;
  return {
    conversation,
    messages,
    digest_text: conversation.digest_text || "",
    digest_source: conversation.digest_source,
    summary_memory: summaryMemory,
    body_status: bodyAvailableCount > 0 ? "ready" : "not_synced",
    body_available_count: bodyAvailableCount,
    body_missing_count: messages.length - bodyAvailableCount,
  };
}

export async function readMailboxPerson(rawMailbox: unknown, rawPeer: unknown): Promise<{
  mailbox: string;
  peer_email: string;
  digest_text: string;
  digest_source: string;
  digest_generated_at: string | null;
}> {
  const peer = typeof rawPeer === "string" ? normalizeEmail(rawPeer) : "";
  // Person memory is intentionally not a default-mailbox shortcut: callers
  // must bind the digest to the explicit mailbox it was generated from.
  if (!peer || typeof rawMailbox !== "string" || !rawMailbox.trim()) {
    throw new HttpFail(400, "box and p are required");
  }
  const { binding } = await selectedMailbox(rawMailbox);
  if (!binding) throw new HttpFail(400, "box and p are required");
  const mailbox = normalizeEmail(text(binding.mailbox_email));
  const row = await readNativePersonMemory(mailbox, peer);
  const digest = row ? {
    text: String(row.digest_text || ""), source: String(row.digest_source || ""),
    generated_at: row.generated_at instanceof Date ? row.generated_at.toISOString()
      : row.generated_at ? String(row.generated_at) : undefined,
  } : null;
  return {
    mailbox,
    peer_email: peer,
    digest_text: digest?.text || "",
    digest_source: digest?.source || "",
    digest_generated_at: digest?.generated_at || null,
  };
}
