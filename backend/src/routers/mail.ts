/**
 * Employee 通讯 mailbox memory.
 * GET = memory (zero session / turn / model). POST sync = command.
 */
import { Hono } from "hono";

import { requireSkill } from "../auth.js";
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
import { readOnDemandMemory, readPersonDigest, triggerMailTranslateSkill, triggerMailSummarySkill, writeOnDemandMemory } from "../host/mail-memory-job.js";
import { composeCatalog } from "../skills/email-compose-contract.js";
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
  const summaryKey = `mail_summary_memory:${conversation.mailbox}:${conversation.conversation_id}:`;
  let summaryMemory = readOnDemandMemory(summaryKey);
  if (!summaryMemory) {
    summaryMemory = {
      status: "未开始", mailbox: conversation.mailbox, subject: conversation.subject,
      conversation_id: conversation.conversation_id, text: "", fingerprint: "",
    };
    writeOnDemandMemory(summaryKey, summaryMemory);
  }
  for (const item of stored) {
    const translationKey = `mail_translation_memory:${conversation.mailbox}:${conversation.conversation_id}:${String(item.id || "")}`;
    if (!readOnDemandMemory(translationKey)) {
      writeOnDemandMemory(translationKey, {
        status: "未开始", mailbox: conversation.mailbox, subject: String(item.subject || conversation.subject || ""),
        conversation_id: conversation.conversation_id, message_id: String(item.id || ""), text: "", fingerprint: "",
      });
    }
  }
  return c.json({
    ...MEMORY,
    conversation,
    messages: stored.map(messageRowOf),
    digest_text: conversation.digest_text || String(thread.digest_text || ""),
    digest_source: conversation.digest_source || String(thread.digest_source || ""),
    summary_memory: summaryMemory,
  });
});

/** Read-only catalog of the stage letters the compose skill publishes. */
mail.get("/mail/compose-catalog", (c) => {
  c.header("Cache-Control", "no-store");
  const { letters } = composeCatalog();
  return c.json({ ...MEMORY, letters });
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

/** Run one employee-facing mail Skill through its existing Codex/MCP memory chain. */
mail.post("/mail/skills/:skillId/run", async (c) => {
  const skillId = c.req.param("skillId");
  if (skillId !== "mail_summary" && skillId !== "mail_translate") throw new HttpFail(404, "mail skill not found");
  requireSkill(skillId);
  const body = (await c.req.json().catch(() => ({}))) as { box?: unknown; conversation_id?: unknown; message_id?: unknown };
  const mailbox = requestedMailbox(String(body?.box || "")) || mailboxBoxStatus().mailbox;
  if (!mailbox) throw new HttpFail(400, "mailbox is required");
  const conversationId = String(body?.conversation_id || "").trim();
  const messageId = String(body?.message_id || "").trim();
  let result;
  if (skillId === "mail_summary") {
    if (!conversationId) throw new HttpFail(422, "conversation_id is required");
    result = await triggerMailSummarySkill(mailbox, conversationId);
  } else {
    if (!messageId) throw new HttpFail(422, "message_id is required");
    result = await triggerMailTranslateSkill(mailbox, messageId);
  }
  if (result.errors > 0) throw new HttpFail(502, { code: "mail_skill_failed", skill_id: skillId, result });
  return c.json({ ...COMMAND, skill_id: skillId, accepted: true, pending: false, mailbox, result });
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
