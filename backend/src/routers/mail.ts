/**
 * Employee 通讯 mailbox memory.
 * GET = memory (zero session / turn / model). POST sync = command.
 */
import { Hono } from "hono";

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
  markThreadTranslationsPending,
  messageRowOf,
  setConversationStarred,
} from "../host/mail-memory.js";
import { readPersonDigest } from "../host/mail-memory-job.js";
import { lastSyncReceipt, startFollowedMailSync } from "../starrykol/mail-sync.js";

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

mail.get("/mail/conversations/:id", (c) => {
  c.header("Cache-Control", "no-store");
  const thread = findMailThread(c.req.param("id"));
  if (!thread) throw new HttpFail(404, "conversation not found");
  const conversation = conversationRowOf(thread);
  markThreadTranslationsPending(String(thread.id));
  const stored = itemsForConversation(conversation.conversation_id, conversation.mailbox);
  return c.json({
    ...MEMORY,
    conversation,
    messages: stored.map(messageRowOf),
    digest_text: conversation.digest_text || String(thread.digest_text || ""),
    digest_source: conversation.digest_source || String(thread.digest_source || ""),
  });
});

mail.get("/mail/person", (c) => {
  c.header("Cache-Control", "no-store");
  const mailbox = requestedMailbox(c.req.query("box") || "");
  const peer = normalizeEmail(String(c.req.query("p") || ""));
  if (!mailbox || !peer) throw new HttpFail(400, "box and p are required");
  const digest = readPersonDigest(mailbox, peer);
  return c.json({
    ...MEMORY,
    mailbox,
    peer_email: peer,
    digest_text: digest?.text || "",
    digest_source: digest?.source || "",
    digest_generated_at: digest && "generated_at" in digest ? digest.generated_at : null,
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
  const mailbox = requestedMailbox(String(body?.box || ""));
  // Fire-and-forget: the mail page renders local memory first, then polls
  // synced_at and refreshes when this background sync lands. Never block here.
  void startFollowedMailSync(true, mailbox).catch(() => undefined);
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    creates_turn: false,
    calls_model: false,
    accepted: true,
    ...lastSyncReceipt(),
  }, 202);
});
