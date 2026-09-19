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
    subject: text(raw.subject),
    snippet: text(raw.snippet || raw.letter_summary || raw.summary || raw.summary_zh),
    body_text: raw.body_text ? String(raw.body_text) : undefined,
    letter_summary: text(raw.letter_summary || raw.summary || raw.summary_zh || raw.snippet),
    summary_source: digestSourceOf(raw.summary_source) || (raw.summary_source === "body_digest" ? "body_digest" : ""),
    receipt_status: text(raw.receipt_status) || undefined,
    effective: raw.effective == null ? undefined : Boolean(raw.effective),
    translation_zh: text(raw.translation_zh || raw.translation) || undefined,
    translation_source: text(raw.translation_source) || undefined,
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
  };
}

async function decorateOwner(box: MailBox): Promise<MailBox> {
  if (box.owner_name || !box.mailbox) return box;
  const binding = await api.starryBinding().catch(() => null as StarryBinding | null);
  const owner = text(binding?.owner_name);
  return owner ? { ...box, owner_name: owner } : box;
}

/** Display/analyze only. Never mix board threads into an `/api/mail` list. */
async function decorateAnalyzePeople(conversations: MailConversation[]): Promise<MailConversation[]> {
  const need = conversations.some((row) => row.collaboration_id && !row.kol_uid && !row.handle);
  if (!need) return conversations;
  const board = await api.homeBoard().catch(() => null as BoardMailFallback | null);
  const byId = new Map<string, { kol_uid?: string; handle?: string }>();
  for (const kol of board?.kols || []) {
    const id = text(kol.id);
    if (!id) continue;
    const handle = text(kol.handle || kol.kol_name).replace(/^@/, "");
    byId.set(id, {
      kol_uid: text(kol.kol_uid) || handle || undefined,
      handle: handle || undefined,
    });
  }
  return conversations.map((row) => {
    if (!row.collaboration_id || row.kol_uid || row.handle) return row;
    const extra = byId.get(row.collaboration_id);
    return extra ? { ...row, ...extra } : row;
  });
}

async function loadFallbackWorkspace(): Promise<MailWorkspace> {
  const [binding, board] = await Promise.all([
    api.starryBinding().catch(() => null as StarryBinding | null),
    api.homeBoard().catch(() => null as BoardMailFallback | null),
  ]);
  return workspaceFromFallback(binding, board);
}

export async function loadMailWorkspace(): Promise<MailWorkspace> {
  let boxRaw: Record<string, unknown>;
  let listRaw: Record<string, unknown> | Array<Record<string, unknown>>;
  try {
    [boxRaw, listRaw] = await Promise.all([
      api.mailBox(),
      api.mailConversations(),
    ]);
  } catch (error) {
    if (!isMissingEndpoint(error)) throw error;
    return loadFallbackWorkspace();
  }
  const box = await decorateOwner(normalizeBox(boxRaw) || {
    mailbox: "",
    bound: false,
    unread: 0,
    synced_at: null,
    error: null,
  });
  const rows = Array.isArray(listRaw)
    ? listRaw
    : Array.isArray(listRaw.conversations)
      ? listRaw.conversations as Array<Record<string, unknown>>
      : [];
  return {
    source: "api",
    box,
    conversations: await decorateAnalyzePeople(
      rows
        .map((row) => normalizeConversation(row, box.mailbox))
        .filter((row): row is MailConversation => Boolean(row)),
    ),
  };
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

export async function syncMailboxMail(): Promise<MailSyncReceipt> {
  const receipt = await api.syncMailboxMail();
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
