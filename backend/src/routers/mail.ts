/**
 * Employee 通讯 mailbox memory.
 * GET = memory (zero session / turn / model). POST sync = command.
 */
import { Hono } from "hono";
import { HttpFail } from "../host/errors.js";
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
  unreadCountForMailbox,
} from "../host/mail-memory.js";
import { ensureFollowedMailSync, ensureThreadItemTranslations, hydrateMailThread, lastSyncReceipt } from "../starrykol/mail-sync.js";

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

mail.get("/mail/box", (c) => {
  c.header("Cache-Control", "no-store");
  const box = mailboxBoxStatus();
  return c.json({
    ...MEMORY,
    ...box,
    bindings: mailboxBindings(),
    total_unread: unreadCountForMailbox(""),
  });
});

mail.get("/mail/conversations", (c) => {
  c.header("Cache-Control", "no-store");
  const conversations = listMailboxConversations();
  return c.json({
    ...MEMORY,
    mailbox: mailboxBoxStatus().mailbox,
    conversations,
  });
});

mail.get("/mail/conversations/:id", async (c) => {
  c.header("Cache-Control", "no-store");
  const thread = findMailThread(c.req.param("id"));
  if (!thread) throw new HttpFail(404, "conversation not found");
  let conversation = conversationRowOf(thread);
  let stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
  if (!stored.some((item) => String(item.body_text || "").trim())) {
    await hydrateMailThread(thread);
    const refreshed = findMailThread(c.req.param("id")) || thread;
    conversation = conversationRowOf(refreshed);
    stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
  }
  await ensureThreadItemTranslations(String(thread.id));
  stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
  const messages = stored.map(messageRowOf);
  return c.json({
    ...MEMORY,
    conversation,
    messages,
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
  const result = await ensureFollowedMailSync(true);
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
