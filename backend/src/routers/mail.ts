/**
 * Employee 通讯 mailbox memory.
 * GET = memory (zero session / turn / model). POST sync = command.
 */
import { Hono } from "hono";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { normalizeEmail } from "../host/identity.js";
import {
  conversationRowOf,
  findMailThread,
  itemsForConversation,
  listMailboxConversations,
  mailboxBindings,
  mailboxBoxStatus,
  markConversationMailRead,
  messageRowOf,
  setConversationStarred,
} from "../host/mail-memory.js";
import { ensureFollowedMailSync, ensureThreadItemTranslations, hydrateMailThread, lastSyncReceipt, markThreadTranslationsPending } from "../starrykol/mail-sync.js";

export const mail = new Hono();

const MEMORY = {
  entry: "memory" as const,
  kind: "memory" as const,
  creates_session: false,
  creates_turn: false,
  calls_model: false,
};

const COMMAND = {
  entry: "command" as const,
  kind: "command" as const,
  creates_session: false,
  creates_turn: false,
  calls_model: false,
};

/** Resolve ?box= against the user's bindings; anything else falls back to the default mailbox. */
function requestedMailbox(raw: string): string {
  const requested = normalizeEmail(String(raw || ""));
  if (!requested) return "";
  return mailboxBindings().some((row) => row.mailbox === requested) ? requested : "";
}

mail.get("/mail/box", (c) => {
  c.header("Cache-Control", "no-store");
  const bindings = mailboxBindings();
  const box = mailboxBoxStatus(requestedMailbox(c.req.query("box") || "") || undefined);
  return c.json({
    ...MEMORY,
    ...box,
    bindings,
    total_unread: bindings.reduce((sum, row) => sum + Number(row.unread || 0), 0),
  });
});

mail.get("/mail/conversations", (c) => {
  c.header("Cache-Control", "no-store");
  const mailbox = requestedMailbox(c.req.query("box") || "");
  const conversations = listMailboxConversations(mailbox || undefined);
  return c.json({
    ...MEMORY,
    mailbox: mailboxBoxStatus(mailbox || undefined).mailbox,
    conversations,
  });
});

/** Bodies and translations come from remote mailbox memory: answer from local rows, fill in behind. */
function hydrationPending(stored: Array<{ body_text?: unknown; translation_zh?: unknown }>): boolean {
  // No stored items at all means a thread shell from the background sync: that still
  // needs the remote read, so an empty list counts as pending.
  const hasBody = stored.some((item) => String(item.body_text || "").trim());
  const missingTranslation = stored.some(
    (item) => String(item.body_text || "").trim() && !String(item.translation_zh || "").trim(),
  );
  return !hasBody || missingTranslation;
}

const hydratingThreads = new Set<string>();

function scheduleThreadHydration(threadId: string): void {
  if (!threadId || hydratingThreads.has(threadId)) return;
  hydratingThreads.add(threadId);
  void (async () => {
    try {
      const thread = findMailThread(threadId);
      if (!thread) return;
      const row = conversationRowOf(thread);
      const stored = itemsForConversation(row.conversation_id, row.mailbox);
      if (!stored.some((item) => String(item.body_text || "").trim())) await hydrateMailThread(thread);
      await ensureThreadItemTranslations(threadId);
    } catch (error) {
      // Remote memory is optional on this read path: the cached answer already went out.
      audit("host", "mail.thread_hydrate_failed", {
        thread_id: threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      hydratingThreads.delete(threadId);
    }
  })();
}

mail.get("/mail/conversations/:id", (c) => {
  c.header("Cache-Control", "no-store");
  const thread = findMailThread(c.req.param("id"));
  if (!thread) throw new HttpFail(404, "conversation not found");
  const conversation = conversationRowOf(thread);
  let stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
  const hydrating = hydrationPending(stored);
  if (hydrating) {
    // Local-only flag so the row reads 翻译生成中… while the remote fill runs behind.
    markThreadTranslationsPending(String(thread.id));
    stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
    scheduleThreadHydration(String(thread.id));
  }
  return c.json({
    ...MEMORY,
    conversation,
    messages: stored.map(messageRowOf),
    hydrating,
    digest_text: conversation.digest_text || String(thread.digest_text || ""),
    digest_source: conversation.digest_source || String(thread.digest_source || ""),
  });
});

mail.post("/mail/conversations/:id/read", (c) => {
  const thread = findMailThread(c.req.param("id"));
  if (!thread) throw new HttpFail(404, "conversation not found");
  markConversationMailRead(String(thread.id));
  const refreshed = findMailThread(c.req.param("id")) || thread;
  return c.json({
    ...COMMAND,
    ok: true,
    conversation: conversationRowOf(refreshed),
  });
});

mail.put("/mail/conversations/:id", async (c) => {
  const thread = findMailThread(c.req.param("id"));
  if (!thread) throw new HttpFail(404, "conversation not found");
  const body = (await c.req.json().catch(() => ({}))) as { starred?: unknown };
  if (body.starred !== undefined && typeof body.starred !== "boolean") {
    throw new HttpFail(400, "starred must be a boolean");
  }
  if (typeof body.starred === "boolean") {
    setConversationStarred(String(thread.id), body.starred);
  }
  const refreshed = findMailThread(c.req.param("id")) || thread;
  return c.json({
    ...COMMAND,
    ok: true,
    conversation: conversationRowOf(refreshed),
  });
});

mail.post("/mail/sync", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { box?: unknown };
  const result = await ensureFollowedMailSync(true, requestedMailbox(String(body?.box || "")));
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    ...lastSyncReceipt(),
    ok: result.ok,
    mailbox: result.mailbox || lastSyncReceipt().mailbox,
    listed: result.listed ?? result.conversations,
    inserted: result.inserted || 0,
    updated: result.updated || 0,
    unread: result.unread,
    synced_at: result.synced_at,
    cursor_at: result.cursor_at,
    ...(result.error ? { error: result.error } : {}),
  });
});
