import { api, type StarryBinding } from "../api";
import { isMissingEndpoint } from "../home/discoveryHome";
import { summarizeMailSnippet } from "../mailPreview";
import { workspaceFromFallback, threadFromFallback, type BoardMailFallback } from "./fallback";
import type {
  MailBox,
  MailBoxBinding,
  MailConversation,
  MailDigestSource,
  MailDirection,
  MailMessage,
  MailPersonDigest,
  MailSyncReceipt,
  MailThread,
  MailWorkspace,
} from "./types";

function text(value: unknown): string {
  return String(value || "").trim();
}

function matchStateOf(value: unknown, collaborationId?: unknown): MailConversation["match_state"] {
  if (value === "unbound" || value === "deferred" || value === "ignored" || value === "matched") return value;
  return text(collaborationId) ? "matched" : "unbound";
}

function digestSourceOf(value: unknown): MailDigestSource | "" {
  if (value === "codex_memory" || value === "luna" || value === "body_analysis" || value === "analysis_failed") {
    return value;
  }
  return "";
}

function directionOf(value: unknown): MailDirection | "" {
  return value === "outbound" || value === "inbound" ? value : "";
}

function normalizeBinding(raw: Record<string, unknown>): MailBoxBinding | null {
  const mailbox = text(raw.mailbox || raw.mailbox_email);
  if (!mailbox) return null;
  return {
    mailbox,
    label: text(raw.label) || undefined,
    owner_name: text(raw.owner_name) || undefined,
    brand: text(raw.brand) || undefined,
    region: text(raw.region) || undefined,
    unread: Number(raw.unread || raw.unread_count || 0),
    bound: raw.bound == null ? true : Boolean(raw.bound),
    synced_at: raw.synced_at ? String(raw.synced_at) : null,
    error: raw.error != null && raw.error !== "" ? String(raw.error) : null,
  };
}

export function normalizeBox(raw: Record<string, unknown> | null | undefined): MailBox | null {
  if (!raw) return null;
  const mailbox = text(raw.mailbox || raw.mailbox_email);
  const bound = raw.bound == null ? Boolean(mailbox) : Boolean(raw.bound);
  const error = raw.error != null && raw.error !== "" ? String(raw.error) : (raw.last_error ? String(raw.last_error) : null);
  const unread = Number(raw.unread || raw.unread_count || 0);
  const syncedAt = raw.synced_at ? String(raw.synced_at) : null;
  const bindingsRaw = Array.isArray(raw.bindings) ? raw.bindings : [];
  const bindings = bindingsRaw
    .map((row) => normalizeBinding(row as Record<string, unknown>))
    .filter((row): row is MailBoxBinding => Boolean(row));
  // Old single-mailbox shape: synthesize one chip so the boxbar always has data.
  if (!bindings.length && bound && mailbox) {
    bindings.push({ mailbox, unread, bound, synced_at: syncedAt, error });
  }
  return {
    mailbox,
    bound,
    unread,
    synced_at: syncedAt,
    error,
    last_tool: raw.last_tool ? String(raw.last_tool) : null,
    cursor_at: raw.cursor_at ? String(raw.cursor_at) : null,
    cursor_id: raw.cursor_id ? String(raw.cursor_id) : null,
    owner_name: text(raw.owner_name) || undefined,
    bindings,
    total_unread: raw.total_unread != null
      ? Number(raw.total_unread)
      : bindings.length
        ? bindings.reduce((sum, row) => sum + row.unread, 0)
        : undefined,
  };
}

export function normalizeConversation(raw: Record<string, unknown>, mailbox = ""): MailConversation | null {
  const conversationId = text(raw.conversation_id || raw.id);
  if (!conversationId) return null;
  const preview = text(raw.last_preview || raw.last_snippet);
  const collaborationId = text(raw.collaboration_id) || null;
  return {
    id: text(raw.id) || conversationId,
    mailbox: text(raw.mailbox) || mailbox,
    conversation_id: text(raw.conversation_id) || conversationId,
    collaboration_id: collaborationId,
    match_state: matchStateOf(raw.match_state, collaborationId),
    subject: text(raw.subject) || "(无主题)",
    peer_email: text(raw.peer_email || raw.last_from),
    peer_name: text(raw.peer_name || raw.last_from_name || raw.peer),
    last_at: raw.last_at ? String(raw.last_at) : null,
    last_direction: directionOf(raw.last_direction),
    last_preview: preview || summarizeMailSnippet(text(raw.last_snippet)),
    unread_count: Number(raw.unread_count || 0),
    message_count: raw.message_count != null ? Number(raw.message_count) : undefined,
    starred: raw.starred == null ? undefined : Boolean(raw.starred),
    last_receipt: text(raw.last_receipt) || undefined,
    digest_source: digestSourceOf(raw.digest_source),
    digest_text: text(raw.digest_text) || undefined,
    kol_uid: text(raw.kol_uid) || undefined,
    handle: text(raw.handle) || undefined,
  };
}

function normalizeMessage(raw: Record<string, unknown>, conversationId: string): MailMessage {
  return {
    id: text(raw.id) || text(raw.provider_message_id) || `${conversationId}-msg`,
    conversation_id: text(raw.conversation_id) || conversationId,
    provider_message_id: text(raw.provider_message_id) || undefined,
    direction: directionOf(raw.direction) || "inbound",
    occurred_at: raw.occurred_at ? String(raw.occurred_at) : null,
    from_addr: text(raw.from_addr || raw.from || raw.from_name),
    from_name: text(raw.from_name) || undefined,
    to_addr: text(raw.to_addr) || undefined,
    subject: text(raw.subject),
    snippet: text(raw.snippet || raw.letter_summary || raw.summary || raw.summary_zh),
    body_text: raw.body_text ? String(raw.body_text) : undefined,
    letter_summary: text(raw.letter_summary || raw.summary || raw.summary_zh || raw.snippet),
    summary_source: digestSourceOf(raw.summary_source) || (raw.summary_source === "body_digest" ? "body_digest" : ""),
    receipt_status: text(raw.receipt_status) || undefined,
    effective: raw.effective == null ? undefined : Boolean(raw.effective),
    unread: raw.unread == null ? undefined : Boolean(raw.unread),
    translation_zh: text(raw.translation_zh || raw.translation) || undefined,
    translation_source: text(raw.translation_source) || undefined,
    memory_fingerprint: text(raw.memory_fingerprint) || undefined,
    memory_source: text(raw.memory_source) || undefined,
    memory_generated_at: raw.memory_generated_at ? String(raw.memory_generated_at) : null,
    memory_error: text(raw.memory_error) || undefined,
    memory_attempts: raw.memory_attempts != null ? Number(raw.memory_attempts) : undefined,
  };
}

export function normalizePersonDigest(raw: Record<string, unknown>): MailPersonDigest | null {
  const mailbox = text(raw.mailbox);
  const peer = text(raw.peer_email);
  if (!mailbox || !peer) return null;
  return {
    mailbox,
    peer_email: peer,
    digest_text: text(raw.digest_text),
    digest_source: digestSourceOf(raw.digest_source),
    digest_generated_at: raw.digest_generated_at ? String(raw.digest_generated_at) : null,
  };
}

/** GET /api/mail/conversations/:id → { conversation, messages, digest_text, digest_source } */
export function normalizeThread(raw: Record<string, unknown>, mailbox = ""): MailThread | null {
  const conversationRaw = (
    raw.conversation && typeof raw.conversation === "object"
      ? raw.conversation
      : raw.thread && typeof raw.thread === "object"
        ? raw.thread
        : raw
  ) as Record<string, unknown>;
  const thread = normalizeConversation(conversationRaw, mailbox);
  if (!thread) return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((row) => normalizeMessage(row as Record<string, unknown>, thread.conversation_id))
    : [];
  const digestRaw = raw.digest && typeof raw.digest === "object" ? raw.digest as Record<string, unknown> : {};
  const digestText = text(raw.digest_text || digestRaw.text || thread.digest_text);
  const digestSource = digestSourceOf(raw.digest_source || digestRaw.source || thread.digest_source);
  return {
    thread,
    messages,
    digest: {
      text: digestText,
      source: digestSource,
      mail_count: Number(digestRaw.mail_count || messages.length || 0) || undefined,
      error: digestRaw.error ? String(digestRaw.error) : undefined,
      failed_at: digestRaw.failed_at ? String(digestRaw.failed_at) : undefined,
    },
    hydrating: raw.hydrating === true,
  };
}

/** Optional display label only: an unanswered binding lookup must not pin the page. */
const OWNER_LOOKUP_TIMEOUT_MS = 2_000;

async function decorateOwner(box: MailBox): Promise<MailBox> {
  if (box.owner_name || !box.mailbox) return box;
  const binding = await Promise.race([
    api.starryBinding().catch(() => null as StarryBinding | null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), OWNER_LOOKUP_TIMEOUT_MS)),
  ]);
  const owner = text(binding?.owner_name);
  return owner ? { ...box, owner_name: owner } : box;
}

/** Legacy servers without `/api/mail` — the board is the only place left to read mail from. */
async function loadFallbackWorkspace(): Promise<MailWorkspace> {
  const [binding, board] = await Promise.all([
    api.starryBinding().catch(() => null as StarryBinding | null),
    api.homeBoard().catch(() => null as BoardMailFallback | null),
  ]);
  return workspaceFromFallback(binding, board);
}

/** Local memory only: no optional decoration, so the list can paint at once. */
export async function loadMailWorkspaceFast(boxParam?: string): Promise<MailWorkspace> {
  let boxRaw: Record<string, unknown>;
  let listRaw: Record<string, unknown> | Array<Record<string, unknown>>;
  try {
    [boxRaw, listRaw] = await Promise.all([
      api.mailBox(boxParam),
      api.mailConversations(boxParam),
    ]);
  } catch (error) {
    if (!isMissingEndpoint(error)) throw error;
    return loadFallbackWorkspace();
  }
  const box = normalizeBox(boxRaw) || {
    mailbox: "",
    bound: false,
    unread: 0,
    synced_at: null,
    error: null,
  };
  const rows = Array.isArray(listRaw)
    ? listRaw
    : Array.isArray(listRaw.conversations)
      ? listRaw.conversations as Array<Record<string, unknown>>
      : [];
  return {
    source: "api",
    box,
    conversations: rows
      .map((row) => normalizeConversation(row, box.mailbox))
      .filter((row): row is MailConversation => Boolean(row)),
  };
}

/**
 * Optional owner label only. The conversation rows already carry kol_uid/handle
 * from `/api/mail/conversations`, so no board request is needed (and the board
 * must never be fetched to fill the list).
 */
export async function decorateWorkspace(workspace: MailWorkspace): Promise<MailWorkspace> {
  if (workspace.source !== "api") return workspace;
  const box = await decorateOwner(workspace.box);
  return { ...workspace, box };
}

/** Convenience: fast load plus the bounded decoration (callers that do not paint twice). */
export async function loadMailWorkspace(boxParam?: string): Promise<MailWorkspace> {
  return decorateWorkspace(await loadMailWorkspaceFast(boxParam));
}
export async function loadMailThread(
  id: string,
  fallback?: MailConversation,
  source: MailWorkspace["source"] = "api",
): Promise<MailThread | null> {
  const keys = [...new Set([id, fallback?.id, fallback?.conversation_id].filter(Boolean) as string[])];
  let missing = false;
  for (const key of keys) {
    try {
      const raw = await api.mailConversation(key);
      return normalizeThread(raw, fallback?.mailbox || text(raw.mailbox));
    } catch (error) {
      const status = (error as { status?: number }).status;
      // #177 findMailThread 404s unknown ids; that is not "route missing".
      if (status === 404 || status === 405) {
        if (source === "fallback") {
          missing = true;
          break;
        }
        continue;
      }
      throw error;
    }
  }
  if ((missing || source === "fallback") && fallback) return threadFromFallback(fallback);
  return null;
}

export async function loadMailPersonDigest(box: string, peerEmail: string): Promise<MailPersonDigest | null> {
  const raw = await api.mailPerson(box, peerEmail);
  return normalizePersonDigest(raw);
}

export async function syncMailboxMail(box?: string): Promise<MailSyncReceipt> {
  const receipt = await api.syncMailboxMail(box ? { box } : {});
  return {
    ok: receipt.ok !== false,
    mailbox: receipt.mailbox ? String(receipt.mailbox) : undefined,
    listed: receipt.listed != null ? Number(receipt.listed) : undefined,
    inserted: receipt.inserted != null ? Number(receipt.inserted) : undefined,
    updated: receipt.updated != null ? Number(receipt.updated) : undefined,
    unread: receipt.unread != null ? Number(receipt.unread) : undefined,
    synced_at: receipt.synced_at ? String(receipt.synced_at) : undefined,
    cursor_at: receipt.cursor_at ? String(receipt.cursor_at) : undefined,
    error: receipt.error ? String(receipt.error) : undefined,
  };
}

/**
 * Delay before re-reading a thread the server is still filling in the background.
 * Bounded on purpose: remote translation runs per message and can outlast any window.
 */
export function hydratePollDelayMs(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return null;
  return attempt <= 8 ? 4000 : null;
}
