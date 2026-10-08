/**
 * Employee 通讯 mailbox memory.
 * GET = memory (zero session / turn / model). POST sync = command.
 */
import type { Operation } from "../runtime/operations.js";

import { authDisabled, requireSkill, scopedUser } from "../auth.js";
import { assertRuntimeSkill, runtimeAgentForSkill } from "../runtime/execution.js";
import { canUseAgent } from "../runtime/organization-tree.js";
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
import { getConn } from "../db.js";
import { label } from "../stages.js";
import type { Row } from "../types.js";
import { startMailSyncJob, authorizeMailSync } from "./sync-job.js";
import { prepareMail, mailDraftActions, sendMailDraft, translateMailDraft, exportMailDraft } from "../host/api.js";
import { readReplyContext } from "./reply-context.js";

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

/** An explicit mailbox must be bound; never silently switch scope. */
function requestedMailbox(raw: string): string {
  const requested = normalizeEmail(String(raw || ""));
  if (!requested) return "";
  if (!mailboxBindings().some((row) => row.mailbox === requested)) throw new HttpFail(403, { code: "mailbox_access_denied" });
  return requested;
}

const mailBox: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const bindings = mailboxBindings();
  const box = mailboxBoxStatus(requestedMailbox(String(input.box || "") || "") || undefined);
  return c.json({
    ...MEMORY,
    ...box,
    bindings,
    total_unread: bindings.reduce((sum, row) => sum + Number(row.unread || 0), 0),
  });
};

const mailConversations: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const mailbox = requestedMailbox(String(input.box || "") || "");
  const conversations = listMailboxConversations(mailbox || undefined);
  return c.json({
    ...MEMORY,
    mailbox: mailboxBoxStatus(mailbox || undefined).mailbox,
    conversations,
  });
};

const mailConversation: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const thread = findMailThread(String(input.id || ""));
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
};

/** Read-only catalog of the stage letters the compose skill publishes. */
const mailComposeCatalog: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const { letters } = composeCatalog();
  return c.json({ ...MEMORY, letters });
};

/**
 * 当前阶段上下文（通讯页阶段变更用，只读）。
 * 按会话查：会话是用户已可见的通讯，collaboration_id 是服务端匹配结果，
 * 不接受直接传 collaboration_id，避免越权探测任意合作。
 */
const mailCollaborationStage: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const conversationId = String(input.conversation_id || "").trim();
  if (!conversationId) throw new HttpFail(400, "conversation_id is required");
  const thread = findMailThread(conversationId);
  if (!thread) throw new HttpFail(404, "conversation not found");
  const collaborationId = thread.collaboration_id ? String(thread.collaboration_id) : "";
  if (!collaborationId) return c.json({ ...MEMORY, collaboration_id: null });
  const row = getConn().prepare(
    "SELECT id, handle, display_name, stage_code FROM collaborations WHERE id=?",
  ).get(collaborationId) as Row | undefined;
  if (!row) return c.json({ ...MEMORY, collaboration_id: collaborationId, found: false });
  const stageCode = String(row.stage_code || "");
  return c.json({
    ...MEMORY,
    collaboration_id: collaborationId,
    found: true,
    handle: String(row.handle || ""),
    display_name: String(row.display_name || ""),
    stage_code: stageCode,
    stage_label: label(stageCode),
  });
};

const mailPerson: Operation["handle"] = (c, input) => {
  c.header("Cache-Control", "no-store");
  const mailbox = requestedMailbox(String(input.box || "") || "");
  const peer = normalizeEmail(String(String(input.p || "") || ""));
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
};

/** Run one employee-facing mail Skill through its existing Codex/MCP memory chain. */
const runMailSkill: Operation["handle"] = async (c, input) => {
  const skillId = String(input.skill_id || "");
  if (skillId !== "mail_summary" && skillId !== "mail_translate") throw new HttpFail(404, "mail skill not found");
  requireSkill(skillId);
  const body = input as { box?: unknown; conversation_id?: unknown; message_id?: unknown };
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
  if (result.errors > 0) {
    throw new HttpFail(502, {
      code: "mail_skill_failed",
      skill_id: skillId,
      message: result.error || "邮件技能执行失败，请查看邮件正文、会话和模型配置",
      result,
    });
  }
  return c.json({ ...COMMAND, entry: "think", kind: "think", calls_model: true, skill_id: skillId, accepted: true, pending: false, mailbox, result });
};

const mailRead: Operation["handle"] = (c, input) => {
  const thread = findMailThread(String(input.id || ""));
  if (!thread) throw new HttpFail(404, "conversation not found");
  markConversationMailRead(String(thread.id));
  const refreshed = findMailThread(String(input.id || "")) || thread;
  return c.json({
    ...COMMAND,
    ok: true,
    conversation: conversationRowOf(refreshed),
  });
};

const mailStar: Operation["handle"] = async (c, input) => {
  const thread = findMailThread(String(input.id || ""));
  if (!thread) throw new HttpFail(404, "conversation not found");
  const body = input as { starred?: unknown };
  if (body.starred !== undefined && typeof body.starred !== "boolean") {
    throw new HttpFail(400, "starred must be a boolean");
  }
  if (typeof body.starred === "boolean") {
    setConversationStarred(String(thread.id), body.starred);
  }
  const refreshed = findMailThread(String(input.id || "")) || thread;
  return c.json({
    ...COMMAND,
    ok: true,
    conversation: conversationRowOf(refreshed),
  });
};

export const mailOperations: Operation[] = [
  { kind: "query", id: "mail.reply-context", handle: async (c, input) => {
    if (!authDisabled()) {
      const userId = scopedUser()?.id || "";
      const agentId = runtimeAgentForSkill("reply_analysis",userId);
      if (!canUseAgent(userId,agentId)) throw new HttpFail(403, {code: "runtime_agent_not_usable"});
      assertRuntimeSkill({agentId,skillId: "reply_analysis",userId,runId: "reply-context-read"});
    }
    const after = Number(input.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new HttpFail(400, "invalid context cursor");
    return c.json(await readReplyContext(String(input.session_id || ""), after));
  } },
  { kind: "query", id: "mail.box", handle: mailBox },
  { kind: "query", id: "mail.conversations", handle: mailConversations },
  { kind: "query", id: "mail.conversation", handle: mailConversation },
  { kind: "query", id: "mail.compose-catalog", handle: mailComposeCatalog },
  { kind: "query", id: "mail.collaboration-stage", handle: mailCollaborationStage },
  { kind: "query", id: "mail.person", handle: mailPerson },
  { kind: "query", id: "mail.draft-actions", handle: mailDraftActions },
  { kind: "query", id: "mail.export", handle: exportMailDraft },
  { kind: "action", id: "mail.prepare", handle: prepareMail },
  { kind: "action", id: "mail.send", handle: sendMailDraft },
  { kind: "action", id: "mail.translate-draft", handle: translateMailDraft },
  { kind: "action", id: "mail.read", handle: mailRead },
  { kind: "action", id: "mail.star", handle: mailStar },
  { kind: "skill", id: "mail_summary", handle: (c, input) => runMailSkill(c, { ...input, skill_id: "mail_summary" }) },
  { kind: "skill", id: "mail_translate", handle: (c, input) => runMailSkill(c, { ...input, skill_id: "mail_translate" }) },
  { kind: "job", id: "mail.sync", handle: async (c, input) => c.json(await startMailSyncJob(input), 202) },
];

export const mailJobScopes = {
  "mail.sync": (payload: Record<string, unknown>) => authorizeMailSync(String(payload.mailbox || "")),
};
