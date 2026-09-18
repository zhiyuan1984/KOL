import { api, type StarryBinding } from "../api";
import { isMissingEndpoint } from "../home/discoveryHome";
import { summarizeMailSnippet } from "../mailPreview";
import { workspaceFromFallback, threadFromFallback, type BoardMailFallback } from "./fallback";
import type {
  MailBox,
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

function matchStateOf(value: unknown): MailConversation["match_state"] {
  if (value === "unbound" || value === "deferred" || value === "ignored" || value === "matched") return value;
  return text(value) === "unbound" ? "unbound" : "matched";
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

export function normalizeBox(raw: Record<string, unknown> | null | undefined): MailBox | null {
  if (!raw) return null;
  const mailbox = text(raw.mailbox || raw.mailbox_email);
  return {
    bound: raw.bound !== false && Boolean(mailbox) && text(raw.status) !== "unbound",
    mailbox,
    owner_name: text(raw.owner_name),
    status: text(raw.status) || (mailbox ? "connected" : "unbound"),
    unread: Number(raw.unread || raw.unread_count || 0),
    synced_at: raw.synced_at ? String(raw.synced_at) : null,
    last_error: raw.last_error ? String(raw.last_error) : raw.error ? String(raw.error) : null,
    error: raw.error ? String(raw.error) : undefined,
  };
}

export function normalizeConversation(raw: Record<string, unknown>, mailbox: string): MailConversation | null {
  const conversationId = text(raw.conversation_id || raw.id);
  if (!conversationId) return null;
  const preview = text(raw.last_preview || raw.last_snippet);
  return {
    id: text(raw.id) || conversationId,
    mailbox: text(raw.mailbox) || mailbox,
    conversation_id: text(raw.conversation_id) || conversationId,
    collaboration_id: text(raw.collaboration_id) || undefined,
    match_state: matchStateOf(raw.match_state),
    subject: text(raw.subject) || "(无主题)",
    peer_email: text(raw.peer_email || raw.last_from),
    peer_name: text(raw.peer_name || raw.last_from_name || raw.peer),
    last_at: raw.last_at ? String(raw.last_at) : null,
    last_direction: directionOf(raw.last_direction),
    last_preview: summarizeMailSnippet(preview) || preview.slice(0, 88),
    unread_count: Number(raw.unread_count || 0),
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
    occurred_at: raw.occurred_at ? String(raw.occurred_at) : "",
    from_addr: text(raw.from_addr || raw.from),
    subject: text(raw.subject),
    snippet: text(raw.snippet || raw.letter_summary),
    body_text: raw.body_text ? String(raw.body_text) : undefined,
    letter_summary: text(raw.letter_summary || raw.snippet),
    summary_source: digestSourceOf(raw.summary_source) || (raw.summary_source === "body_digest" ? "body_digest" : ""),
  };
}

export function normalizeThread(raw: Record<string, unknown>, mailbox: string): MailThread | null {
  const threadRaw = (raw.thread && typeof raw.thread === "object" ? raw.thread : raw) as Record<string, unknown>;
  const thread = normalizeConversation(threadRaw, mailbox);
  if (!thread) return null;
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((row) => normalizeMessage(row as Record<string, unknown>, thread.conversation_id))
    : [];
  const digestRaw = raw.digest && typeof raw.digest === "object" ? raw.digest as Record<string, unknown> : {};
  return {
    thread,
    messages,
    digest: {
      text: text(digestRaw.text || thread.digest_text),
      source: digestSourceOf(digestRaw.source || thread.digest_source),
      mail_count: Number(digestRaw.mail_count || messages.length || 0) || undefined,
      error: digestRaw.error ? String(digestRaw.error) : undefined,
      failed_at: digestRaw.failed_at ? String(digestRaw.failed_at) : undefined,
    },
  };
}

async function loadFallbackWorkspace(): Promise<MailWorkspace> {
  const [binding, board] = await Promise.all([
    api.starryBinding().catch(() => null as StarryBinding | null),
    api.homeBoard().catch(() => null as BoardMailFallback | null),
  ]);
  return workspaceFromFallback(binding, board);
}

export async function loadMailWorkspace(): Promise<MailWorkspace> {
  try {
    const [boxRaw, listRaw] = await Promise.all([
      api.mailBox(),
      api.mailConversations(),
    ]);
    const box = normalizeBox(boxRaw) || {
      bound: false,
      mailbox: "",
      owner_name: "",
      status: "unbound",
      unread: 0,
      synced_at: null,
    };
    const rows = Array.isArray(listRaw.conversations) ? listRaw.conversations : [];
    return {
      source: "api",
      box,
      conversations: rows
        .map((row) => normalizeConversation(row, box.mailbox))
        .filter((row): row is MailConversation => Boolean(row)),
    };
  } catch (error) {
    if (!isMissingEndpoint(error)) throw error;
    return loadFallbackWorkspace();
  }
}

export async function loadMailThread(
  id: string,
  fallback?: MailConversation,
): Promise<MailThread | null> {
  try {
    const raw = await api.mailConversation(id);
    return normalizeThread(raw, fallback?.mailbox || text(raw.thread && (raw.thread as { mailbox?: unknown }).mailbox));
  } catch (error) {
    if (!isMissingEndpoint(error) && (error as { status?: number }).status !== 404) throw error;
    if (fallback) return threadFromFallback(fallback);
    return null;
  }
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
    error: receipt.error ? String(receipt.error) : undefined,
  };
}
