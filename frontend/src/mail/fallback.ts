import type { StarryBinding } from "../api";
import { summarizeMailSnippet } from "../mailPreview";
import type { MailBox, MailConversation, MailThread, MailWorkspace } from "./types";

type BoardThread = {
  conversation_id?: unknown;
  subject?: unknown;
  unread_count?: unknown;
  last_snippet?: unknown;
  last_from?: unknown;
  last_from_name?: unknown;
  last_at?: unknown;
  last_direction?: unknown;
};

type BoardKol = {
  id?: unknown;
  handle?: unknown;
  kol_name?: unknown;
  kol_uid?: unknown;
  unbound?: unknown;
  mail_threads?: BoardThread[];
};

export type BoardMailFallback = {
  mail?: { ok?: boolean; unread?: number; conversations?: number; inbound?: number; error?: string };
  follow_scope?: StarryBinding;
  kols?: BoardKol[];
};

function text(value: unknown): string {
  return String(value || "").trim();
}

function directionOf(value: unknown): MailConversation["last_direction"] {
  return value === "outbound" || value === "inbound" ? value : "";
}

export function boxFromBinding(
  binding: StarryBinding | null | undefined,
  board?: BoardMailFallback | null,
): MailBox {
  const scope = binding?.bound ? binding : board?.follow_scope;
  const mailbox = text(scope?.mailbox_email);
  const bound = Boolean(scope?.bound && mailbox && scope.status !== "unbound");
  return {
    bound,
    mailbox,
    owner_name: text(scope?.owner_name),
    status: bound ? (scope?.status || "connected") : (scope?.status || "unbound"),
    unread: Number(board?.mail?.unread || 0),
    synced_at: scope?.updated_at || null,
    last_error: board?.mail?.error || null,
  };
}

export function conversationsFromBoard(
  board: BoardMailFallback | null | undefined,
  mailbox: string,
): MailConversation[] {
  const rows: MailConversation[] = [];
  for (const kol of board?.kols || []) {
    const handle = text(kol.handle || kol.kol_name).replace(/^@/, "");
    const kolUid = text(kol.kol_uid || handle);
    const unbound = Boolean(kol.unbound);
    for (const thread of kol.mail_threads || []) {
      const conversationId = text(thread.conversation_id);
      if (!conversationId) continue;
      const snippet = text(thread.last_snippet);
      rows.push({
        id: conversationId,
        mailbox,
        conversation_id: conversationId,
        collaboration_id: text(kol.id) || undefined,
        match_state: unbound ? "unbound" : "matched",
        subject: text(thread.subject) || "(无主题)",
        peer_email: text(thread.last_from),
        peer_name: text(thread.last_from_name) || handle,
        last_at: thread.last_at ? String(thread.last_at) : null,
        last_direction: directionOf(thread.last_direction),
        last_preview: summarizeMailSnippet(snippet) || snippet.slice(0, 88),
        unread_count: Number(thread.unread_count || 0),
        digest_source: "",
        digest_text: "",
        kol_uid: kolUid || undefined,
        handle: handle || undefined,
      });
    }
  }
  return rows;
}

export function threadFromFallback(row: MailConversation): MailThread {
  const snippet = row.last_preview;
  return {
    thread: row,
    messages: snippet || row.subject
      ? [{
          id: `preview-${row.conversation_id}`,
          conversation_id: row.conversation_id,
          direction: row.last_direction === "outbound" ? "outbound" : "inbound",
          occurred_at: row.last_at || "",
          from_addr: row.peer_email,
          subject: row.subject,
          snippet,
          body_text: snippet,
          letter_summary: snippet,
          summary_source: "body_analysis",
        }]
      : [],
    digest: { text: "", source: "" },
  };
}

export function workspaceFromFallback(
  binding: StarryBinding | null | undefined,
  board: BoardMailFallback | null | undefined,
): MailWorkspace {
  const box = boxFromBinding(binding, board);
  return {
    source: "fallback",
    box,
    conversations: conversationsFromBoard(board, box.mailbox),
  };
}

export function mailHref(box?: string, conversationId?: string): string {
  const params = new URLSearchParams();
  if (box) params.set("box", box);
  if (conversationId) params.set("c", conversationId);
  const query = params.toString();
  return query ? `/mail?${query}` : "/mail";
}
