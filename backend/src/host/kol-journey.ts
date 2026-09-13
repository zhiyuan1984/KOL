import { scopedUser } from "../auth.js";
import { audit, getConn, nowIso, onConnReset, tx } from "../db.js";
import { nid } from "../ids.js";
import { judgeCollaborationStage, type StageJudgment, type StageJudgmentInput } from "../stage-judgment.js";
import {
  BY_CODE,
  FACT_AUTO_MODES,
  LOCKED_PROMISE,
  MAIN_STAGES,
  autoLegalTargets,
  confirmTargetViews,
  groupedStageTracks,
  label,
  legalTargets,
  normalizeStage,
} from "../stages.js";
import { isExceptionStage, stageHeadline, stageSopView } from "../sops.js";
import {
  contactSearchKeyword,
  conversationIdOf,
  conversationSubject,
  firstString,
  inferInbound,
  listOf,
  messageBody,
  messageFrom,
  messageOccurredAt,
  messageTo,
  realMailboxEmail,
  sortByMailTime,
} from "../starrykol/mail-fields.js";
import { restoreOfficialCollaborationStage } from "../starrykol/library-sync.js";
import { readConversation } from "../starrykol/mail-sync.js";
import { executeStarryKolTask } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";
import { hostConfirmStage, syncSessionStageCopy } from "./api.js";
import { HttpFail } from "./errors.js";
import { inboundByIdentity, inboundIdentity, mailAlreadySeen, markMailSeen } from "./inbound-identity.js";
import { analyzeMailBody, analyzeThreadDigest, ensureCodexThreadDigest, mailHistoryRows, mailSummaryOf, needsRemoteThreadDigest, readThreadDigest, threadDigestOf } from "./mail-summary.js";
import { stageMailAction, composeFactsFromContext, composeGapHint } from "./compose-loop.js";
import { publishSession } from "./session-events.js";
import { FOLLOW_STYLE_PRESETS, readFollowStyleTags } from "../follow-style-tags.js";

function addMsg(sid: string, role: string, kind: string, payload: Json): Json {
  const mid = nid("msg");
  const now = nowIso();
  tx((db) => {
    db.prepare("INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)").run(
      mid, sid, role, kind, JSON.stringify(payload), now,
    );
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sid);
  });
  const row = { id: mid, session_id: sid, role, kind, payload, created_at: now };
  publishSession(sid, { type: "upsert", message: row });
  return row;
}

export function recommendedCollabActions(col: Row): Json[] {
  const all = collabActions(col);
  const stage = normalizeStage(String(col.stage_code || ""));
  const prefer = isExceptionStage(stage)
    ? ["risk_scan", "confirm_stage", "stage_sop"]
    : ["email_compose", "confirm_stage", "stage_sop"];
  const picked: Json[] = [];
  for (const intent of prefer) {
    const row = all.find((item) => item.intent === intent);
    if (row) picked.push({ ...row, source: "ai" });
  }
  for (const row of all) {
    if (picked.length >= 3) break;
    if (!picked.some((item) => item.intent === row.intent)) picked.push({ ...row, source: "ai" });
  }
  return picked.slice(0, 3);
}

export function mailHistoryForCollaboration(collaborationId: string): Json[] {
  return mailHistoryRows(collaborationId);
}

function collabPortrait(col: Row): Json {
  return {
    handle: col.handle,
    display_name: col.display_name || col.handle,
    brand: col.brand || "",
    platform: col.platform || "",
    followers: col.followers || "",
    notes: col.notes || "",
    email: realMailboxEmail(col.email),
    days_in_stage: Number(col.days_in_stage || 0),
    follow_style_tags: readFollowStyleTags(col),
  };
}

export function publishJourneyForCollaboration(collaborationId: string): Json | null {
  const next = journeyPayload(collaborationId);
  if (!next) return null;
  const sessions = getConn().prepare("SELECT id FROM sessions WHERE collaboration_id=?").all(collaborationId) as { id: string }[];
  for (const session of sessions) publishSession(session.id, { type: "journey", journey: next });
  return next;
}

export function collabActions(col: Row): Json[] {
  const handle = String(col.handle || col.display_name || "");
  const id = String(col.id);
  const stage = normalizeStage(String(col.stage_code || ""));
  const ask = (item: { label: string; intent: string; prompt: string }): Json => ({
    ...item,
    act: "ask",
    collaboration_id: id,
  });
  const mail = stageMailAction(handle, stage);
  const out: Json[] = [
    ask({ label: mail.label, intent: "email_compose", prompt: mail.prompt }),
    ask({ label: "阶段SOP", intent: "stage_sop", prompt: `阶段SOP @${handle}` }),
    ask({ label: "记状态", intent: "confirm_stage", prompt: `记状态 @${handle}` }),
  ];
  if (isExceptionStage(stage)) {
    out.unshift(ask({ label: "风险扫描", intent: "risk_scan", prompt: `风险扫描 @${handle}` }));
  }
  // Stage-letter chips stay first. Extra mail skills stay available so an
  // employee can still 催大纲 / 核地址 / 发货 / 写跟进 from any stage and see
  // the Host error or supplement card instead of a missing button.
  const extras = [
    { label: "写跟进信", prompt: `写跟进邮件 @${handle}` },
    { label: "催大纲", prompt: `催大纲 @${handle}` },
    { label: "寄样地址核对", prompt: `核对地址 @${handle}` },
    { label: "发货通知", prompt: `发货通知 @${handle}` },
  ];
  for (const extra of extras) {
    if (out.some((item) => item.label === extra.label || item.prompt === extra.prompt)) continue;
    out.push(ask({ ...extra, intent: "email_compose" }));
  }
  return out;
}

export function journeyPayload(collaborationId: string | null | undefined): Json | null {
  if (!collaborationId) return null;
  const col = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  if (!col) return null;
  restoreOfficialCollaborationStage(col);
  const stage = normalizeStage(String(col.stage_code || ""));
  const sop = stageSopView(stage);
  const mailHistory = mailHistoryForCollaboration(String(col.id));
  const digest = threadDigestOf(mailHistory, readThreadDigest(String(col.id)));
  const facts = composeFactsFromContext({ stage });
  const gap = composeGapHint(facts, String(col.handle || ""));
  return {
    collaboration_id: col.id,
    handle: col.handle,
    display_name: col.display_name,
    brand: col.brand,
    stage_code: stage,
    stage_label: label(stage),
    stage_version: Number(col.stage_version || 0),
    advancement_mode: BY_CODE[stage]?.advancementMode || null,
    pipeline_href: `/pipeline?kol=${encodeURIComponent(String(col.handle))}`,
    stages: MAIN_STAGES.map((item) => ({ code: item.code, label: item.label })),
    tracks: groupedStageTracks(stage),
    phases: sop.track,
    sop,
    exception: sop.exception,
    exception_kind: sop.exception_kind,
    actions: collabActions(col),
    recommended_actions: recommendedCollabActions(col),
    composer_placeholder: gap.placeholder,
    portrait: collabPortrait(col),
    follow_style_tags: readFollowStyleTags(col),
    follow_style_presets: FOLLOW_STYLE_PRESETS,
    mail_history: mailHistory,
    mail_digest: {
      text: digest.text || analyzeThreadDigest(mailHistory),
      source: digest.source,
      mail_count: digest.mail_count,
      ...(digest.error ? { error: digest.error } : {}),
      ...(digest.attempted?.length ? { attempted: digest.attempted } : {}),
      ...(digest.failed_at ? { failed_at: digest.failed_at } : {}),
    },
    mail_synced_at: mailSyncAt.get(String(col.id)) || null,
    mail_sync_pending: mailSyncJobs.has(String(col.id)),
    mail_sync_failed: mailSyncFailed.has(String(col.id)),
    mail_summaries: digest.text ? [{
      summary: digest.text,
      summary_source: digest.source,
      mail_count: digest.mail_count,
      ...(digest.error ? { error: digest.error } : {}),
      ...(digest.attempted?.length ? { attempted: digest.attempted } : {}),
      ...(digest.failed_at ? { failed_at: digest.failed_at } : {}),
    }] : [],
  };
}

const mailAnalysisJobs = new Map<string, Promise<unknown>>();
const mailSyncJobs = new Map<string, Promise<number>>();
const mailSyncAt = new Map<string, number>();
const mailSyncFailed = new Set<string>();
const mailDigestRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAIL_SYNC_COALESCE_MS = 20_000;

export function isMailSyncing(collaborationId: string): boolean {
  return mailSyncJobs.has(collaborationId);
}

export function resetKolMailSync(): void {
  mailSyncJobs.clear();
  mailSyncAt.clear();
  mailSyncFailed.clear();
  for (const timer of mailDigestRefreshTimers.values()) clearTimeout(timer);
  mailDigestRefreshTimers.clear();
}

onConnReset(() => {
  mailAnalysisJobs.clear();
  resetKolMailSync();
});

/** Send's reverse: after a real inbound/outbound ingest, refresh the thread digest. */
export async function refreshMailDigestAfterChange(
  collaborationId: string,
  sessionId?: string,
  opts?: { retryFailed?: boolean },
): Promise<void> {
  const journey = await journeyPayloadWithMailMemory(collaborationId, opts);
  if (journey && sessionId) publishSession(sessionId, { type: "journey", journey });
  void ensureCodexThreadDigest(collaborationId, mailHistoryRows(collaborationId), opts)
    .then(() => journeyPayloadWithMailMemory(collaborationId))
    .then((next) => {
      if (next && sessionId) publishSession(sessionId, { type: "journey", journey: next });
    })
    .catch(() => undefined);
}

function scheduleMailDigestRefresh(collaborationId: string, sessionId: string): void {
  const prev = mailDigestRefreshTimers.get(collaborationId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    if (mailDigestRefreshTimers.get(collaborationId) === timer) mailDigestRefreshTimers.delete(collaborationId);
    void refreshMailDigestAfterChange(collaborationId, sessionId, { retryFailed: true });
  }, 0);
  mailDigestRefreshTimers.set(collaborationId, timer);
}

export async function journeyPayloadWithMailMemory(
  collaborationId: string | null | undefined,
  opts?: { retryFailed?: boolean },
): Promise<Json | null> {
  const first = journeyPayload(collaborationId);
  if (!first) return null;
  const history = Array.isArray(first.mail_history) ? first.mail_history as Json[] : [];
  if (!history.length) return first;
  const colId = String(first.collaboration_id);
  const existing = mailAnalysisJobs.get(colId);
  if (existing) {
    return { ...first, mail_analysis_pending: true };
  }
  const pending = needsRemoteThreadDigest(history, readThreadDigest(colId), opts);
  if (!pending) return first;
  const work = ensureCodexThreadDigest(colId, history, opts)
    .then(() => {
      const next = journeyPayload(colId);
      if (!next) return;
      const sessions = getConn().prepare("SELECT id FROM sessions WHERE collaboration_id=?").all(colId) as { id: string }[];
      for (const session of sessions) publishSession(session.id, { type: "journey", journey: next });
    })
    .finally(() => {
      if (mailAnalysisJobs.get(colId) === work) mailAnalysisJobs.delete(colId);
    });
  mailAnalysisJobs.set(colId, work);
  return { ...first, mail_analysis_pending: true };
}

export function tryFactAdvance(
  collaborationId: string,
  judgment: StageJudgment,
  sessionId?: string,
): Json | null {
  const suggested = judgment.suggested_stage;
  if (!suggested || !judgment.auto_propose) return null;
  const mode = BY_CODE[suggested]?.advancementMode;
  if (!mode || !FACT_AUTO_MODES.has(mode)) return null;
  const col = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  if (!col) return null;
  const current = normalizeStage(String(col.stage_code || ""));
  if (current === suggested) return null;
  if (isExceptionStage(current) || current === "COMPLETED") return null;
  if (!autoLegalTargets(current).includes(suggested)) return null;
  let result: Json;
  try {
    result = hostConfirmStage(
      String(col.handle),
      suggested,
      collaborationId,
      Number(col.stage_version || 0),
      judgment.reason,
      {
        reason_code: judgment.flags.includes("paid") ? "FINANCE_APPROVED"
          : suggested === "SHIPPED" || suggested === "TESTING" ? "LOGISTICS_FACT"
            : suggested === "PUBLISHED" ? "PLATFORM_FACT"
              : "REPLY_EVIDENCE",
        evidence: { source: "fact_advance", flags: judgment.flags, snippets: judgment.evidence },
        recommender: "fact_advance",
        session_id: sessionId || null,
      },
    );
  } catch (error) {
    return {
      attempted: true,
      advanced: false,
      target: suggested,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (sessionId) {
    addMsg(sessionId, "assistant", "assistant", {
      text: `已按事实进入 ${label(suggested)}。发送邮件不会修改阶段；这次写入来自来信/履约证据。`,
      auto_advanced: true,
      from_stage: current,
      to_stage: suggested,
    });
  }
  audit("host", "kol.fact_advance", {
    collaboration_id: collaborationId,
    from_stage: current,
    to_stage: suggested,
    session_id: sessionId || null,
  });
  return { ...result, attempted: true, advanced: true, target: suggested };
}

function parseCard(row: { id: string; payload: string }): { id: string; payload: Json } {
  try {
    return { id: row.id, payload: JSON.parse(row.payload) as Json };
  } catch {
    return { id: row.id, payload: {} };
  }
}

function findKolMailCard(
  sessionId: string,
  conversationId?: string,
  providerMessageId?: string,
): { id: string; payload: Json } | undefined {
  const rows = getConn()
    .prepare("SELECT id, payload FROM messages WHERE session_id=? AND kind='kol_mail_card' ORDER BY created_at ASC")
    .all(sessionId) as { id: string; payload: string }[];
  const cards = rows.map(parseCard);
  if (providerMessageId) {
    const byMid = cards.find((card) => String(card.payload.provider_message_id || "") === providerMessageId);
    if (byMid) return byMid;
  }
  if (conversationId) {
    const empty = cards.find((card) =>
      String(card.payload.conversation_id || "") === conversationId && !cardBody(card.payload));
    if (empty) return empty;
  }
  return undefined;
}

function cardBody(payload: Json): string {
  return String(payload.body || payload.snippet || "").trim();
}

function upsertConfirmStageCard(
  sessionId: string,
  col: Row,
  proposed: string,
  reason: string,
  evidence: Json,
): void {
  const current = normalizeStage(String(col.stage_code || ""));
  const target = normalizeStage(proposed);
  if (!target || current === target) return;
  if (!legalTargets(current).includes(target)) return;
  const targets = confirmTargetViews(current, target);
  const payload: Json = {
    collaboration_id: col.id,
    handle: col.handle,
    current_stage: current,
    current_label: label(current),
    proposed_stage: target,
    proposed_label: label(target),
    targets,
    tracks: groupedStageTracks(current, target),
    expected_version: Number(col.stage_version || 0),
    reason,
    evidence,
    locked: Boolean(col.locked) || LOCKED_PROMISE.has(current),
    requires_human_confirmation: true,
    persistent: true,
    source: "reply_ingest",
  };
  const rows = getConn()
    .prepare("SELECT id, payload FROM messages WHERE session_id=? AND kind='confirm_stage_card' ORDER BY created_at DESC")
    .all(sessionId) as { id: string; payload: string }[];
  const existing = rows.map(parseCard).find((row) => String(row.payload.collaboration_id || "") === String(col.id));
  if (existing) {
    getConn().prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), existing.id);
    getConn().prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(nowIso(), sessionId);
    return;
  }
  addMsg(sessionId, "assistant", "confirm_stage_card", payload);
  addMsg(sessionId, "system", "sys_msg", {
    text: "来信分析只出建议。主流程、分支（含不寄样）和异常都列在确认卡上，由你选定具体正式阶段后再确认；不能用「下一阶段」。发送邮件不会修改阶段。",
    tone: "yellow",
    has_confirm: false,
  });
}

function writeKolMailCard(sessionId: string, existingId: string | undefined, payload: Json): void {
  if (existingId) {
    getConn().prepare("UPDATE messages SET payload=? WHERE id=?").run(JSON.stringify(payload), existingId);
    getConn().prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(nowIso(), sessionId);
    return;
  }
  addMsg(sessionId, "assistant", "kol_mail_card", payload);
}

function dropEmptyMailCard(sessionId: string, conversationId: string): void {
  const rows = getConn()
    .prepare("SELECT id, payload FROM messages WHERE session_id=? AND kind='kol_mail_card'")
    .all(sessionId) as { id: string; payload: string }[];
  for (const row of rows) {
    const card = parseCard(row);
    if (String(card.payload.conversation_id || "") !== conversationId) continue;
    if (cardBody(card.payload)) continue;
    getConn().prepare("DELETE FROM messages WHERE id=?").run(card.id);
  }
}

export function ingestKolMail(collaborationId: string, input: {
  subject?: string;
  body?: string;
  from?: string;
  from_name?: string;
  to?: string;
  mailbox?: string;
  occurred_at?: string;
  direction?: string;
  conversation_id?: string;
  session_id?: string;
  provider_message_id?: string;
  message_id?: string;
}, opts?: { deferDigest?: boolean }): Json {
  const opened = openKolSession(collaborationId);
  const sid = String(input.session_id || opened.id);
  const col = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row;
  if (!col) throw new HttpFail(404, "collaboration not found");
  const subject = String(input.subject || "").trim();
  const body = String(input.body || "").trim();
  const conversationId = String(input.conversation_id || "");
  const providerId = String(input.provider_message_id || input.message_id || "");
  const existing = findKolMailCard(sid, conversationId, providerId);
  const identity = inboundIdentity({
    provider_message_id: providerId,
    collaboration_id: collaborationId,
    subject,
    body,
    conversation_id: conversationId,
  });
  const seen = mailAlreadySeen(identity) || inboundByIdentity(identity);
  if (seen && existing && cardBody(existing.payload) && cardBody(existing.payload) === body) {
    return { ok: true, duplicate: true, session_id: sid, journey: journeyPayload(collaborationId) };
  }
  if (seen && (!existing || cardBody(existing.payload))) {
    return { ok: true, duplicate: true, session_id: sid, journey: journeyPayload(collaborationId) };
  }
  if (!seen) markMailSeen(identity, sid, collaborationId, nowIso());
  const inbound = String(input.direction || "inbound") !== "outbound";
  const brandBox = inbound
    ? realMailboxEmail(input.mailbox, input.to)
    : realMailboxEmail(input.mailbox, input.from);
  const kolAddr = inbound
    ? realMailboxEmail(input.from, col.email)
    : realMailboxEmail(input.to, col.email);
  const judgmentInput: StageJudgmentInput = {
    subject,
    body,
    current_stage: String(col.stage_code || ""),
  };
  const judgment = inbound
    ? judgeCollaborationStage(judgmentInput)
    : { suggested_stage: null, confidence: "low" as const, reason: "", evidence: [], flags: [], auto_propose: false };
  const advanced = inbound ? tryFactAdvance(collaborationId, judgment, sid) : null;
  writeKolMailCard(sid, existing?.id, {
    collaboration_id: collaborationId,
    handle: col.handle,
    from: inbound ? (kolAddr || input.from || col.email || "") : (brandBox || input.from || ""),
    from_name: inbound ? (input.from_name || "") : "",
    to: inbound ? brandBox : kolAddr,
    mailbox: brandBox,
    occurred_at: input.occurred_at || "",
    direction: inbound ? "inbound" : "outbound",
    subject,
    body,
    snippet: body.slice(0, 280),
    summary: analyzeMailBody({ body, direction: inbound ? "inbound" : "outbound" }),
    summary_zh: analyzeMailBody({ body, direction: inbound ? "inbound" : "outbound" }),
    summary_source: "body_analysis",
    conversation_id: conversationId || null,
    provider_message_id: providerId || null,
    current_stage: normalizeStage(String(col.stage_code || "")),
    current_label: label(String(col.stage_code || "")),
    expected_version: Number(col.stage_version || 0),
    proposed_stage: judgment.suggested_stage,
    proposed_label: judgment.suggested_stage ? label(judgment.suggested_stage) : null,
    targets: confirmTargetViews(normalizeStage(String(col.stage_code || "")), judgment.suggested_stage),
    tracks: groupedStageTracks(normalizeStage(String(col.stage_code || "")), judgment.suggested_stage),
    judgment: {
      suggested_stage: judgment.suggested_stage,
      suggested_label: judgment.suggested_stage ? label(judgment.suggested_stage) : null,
      reason: judgment.reason,
      flags: judgment.flags,
      evidence: judgment.evidence,
      auto_propose: judgment.auto_propose,
    },
    auto_advanced: advanced && advanced.advanced
      ? { to_stage: judgment.suggested_stage, label: judgment.suggested_stage ? label(judgment.suggested_stage) : "" }
      : null,
  });
  if (inbound && judgment.suggested_stage && !(advanced && advanced.advanced)) {
    upsertConfirmStageCard(sid, col, judgment.suggested_stage, judgment.reason, {
      source: "reply_ingest",
      flags: judgment.flags,
      snippets: judgment.evidence,
    });
  }
  if (!opts?.deferDigest) scheduleMailDigestRefresh(collaborationId, sid);
  return {
    ok: true,
    session_id: sid,
    judgment,
    advanced,
    refreshed: Boolean(existing),
    journey: journeyPayload(collaborationId),
  };
}

export async function syncKolSessionMail(
  sessionId: string,
  collaborationId: string,
  opts?: { force?: boolean },
): Promise<number> {
  const key = collaborationId;
  const inflight = mailSyncJobs.get(key);
  if (inflight) return inflight;
  if (!opts?.force) {
    const last = mailSyncAt.get(key);
    if (last && Date.now() - last < MAIL_SYNC_COALESCE_MS) return 0;
  }
  const work = pullKolSessionMail(sessionId, collaborationId)
    .then((added) => {
      mailSyncAt.set(key, Date.now());
      mailSyncFailed.delete(key);
      void refreshMailDigestAfterChange(collaborationId, sessionId, { retryFailed: true });
      return added;
    })
    .catch(() => {
      mailSyncFailed.add(key);
      return 0;
    })
    .finally(() => {
      if (mailSyncJobs.get(key) === work) mailSyncJobs.delete(key);
      publishMailSyncJourney(sessionId, collaborationId);
    });
  mailSyncJobs.set(key, work);
  publishMailSyncJourney(sessionId, collaborationId);
  return work;
}

function publishMailSyncJourney(sessionId: string, collaborationId: string): void {
  const journey = journeyPayload(collaborationId);
  if (!journey) return;
  publishSession(sessionId, { type: "journey", journey });
}

async function pullKolSessionMail(sessionId: string, collaborationId: string): Promise<number> {
  const col = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  if (!col) return 0;
  const ctx = {
    kolEmail: String(col.email || ""),
    mailboxEmail: realMailboxEmail(col.mailbox_from, col.owner_mailbox),
    handle: String(col.handle || ""),
  };
  try {
    const keyword = contactSearchKeyword(col);
    const { data } = await executeStarryKolTask("email_conversation_list", {
      keyword,
      mailboxEmail: ctx.mailboxEmail,
      pageSize: 20,
    }, "host");
    const list = listOf(data);
    const seenIds = new Set(list.map((row) => conversationIdOf(row)).filter(Boolean));
    const extraIds = (getConn()
      .prepare("SELECT payload FROM messages WHERE session_id=? AND kind='kol_mail_card'")
      .all(sessionId) as { payload: string }[])
      .map((row) => {
        try {
          return String((JSON.parse(row.payload) as Json).conversation_id || "");
        } catch {
          return "";
        }
      })
      .filter((id) => id && !seenIds.has(id));
    const storedConv = String(col.conversation_id || "");
    if (storedConv && !storedConv.startsWith("conv_") && !seenIds.has(storedConv)) extraIds.push(storedConv);
    const rows = [
      ...list,
      ...extraIds.map((id) => ({ conversationId: id, id })),
    ];
    const pending: Json[] = [];
    for (const row of rows) {
      const conversationId = conversationIdOf(row);
      const detail = conversationId ? await readConversation(conversationId) : { messages: [], subject: "", occurredAt: "" };
      const messages = detail.messages.length ? detail.messages : [row];
      if (!messages.length) {
        if (conversationId) dropEmptyMailCard(sessionId, conversationId);
        continue;
      }
      for (const message of messages) {
        pending.push({
          row,
          message,
          conversationId,
          detail,
          occurred_at: messageOccurredAt(message) || detail.occurredAt,
        });
      }
    }
    let added = 0;
    for (const item of sortByMailTime(pending)) {
      const row = item.row as Json;
      const message = item.message as Json;
      const conversationId = String(item.conversationId || "");
      const detail = item.detail as { subject?: string; occurredAt?: string };
      const inbound = inferInbound(message, {
        ...ctx,
        mailboxEmail: realMailboxEmail(row.mailboxEmail, ctx.mailboxEmail),
      });
      const sender = messageFrom(message);
      const recipient = messageTo(message);
      const subject = conversationSubject(message, { subject: detail.subject }, row);
      const body = messageBody(message);
      const brandBox = inbound
        ? realMailboxEmail(message.to, recipient.email, row.mailboxEmail, row.recipientEmail, ctx.mailboxEmail)
        : realMailboxEmail(sender.email, row.mailboxEmail, ctx.mailboxEmail);
      const kolAddr = inbound
        ? realMailboxEmail(sender.email, ctx.kolEmail)
        : realMailboxEmail(recipient.email, message.to, row.recipientEmail, ctx.kolEmail);
      const providerId = firstString(message.messageId, message.message_id, message.id, row.lastMessageId);
      const before = findKolMailCard(sessionId, conversationId, providerId);
      const result = ingestKolMail(collaborationId, {
        subject,
        body,
        from: inbound ? (sender.email || ctx.kolEmail) : (sender.email || brandBox),
        from_name: inbound ? sender.name : "",
        to: inbound ? brandBox : kolAddr,
        mailbox: brandBox,
        occurred_at: String(item.occurred_at || ""),
        direction: inbound ? "inbound" : "outbound",
        conversation_id: conversationId,
        session_id: sessionId,
        provider_message_id: providerId,
      }, { deferDigest: true });
      if (!result.duplicate) {
        added += 1;
        publishMailSyncJourney(sessionId, collaborationId);
      }
      else if (result.refreshed || (before && !cardBody(before.payload) && body)) {
        added += 1;
        publishMailSyncJourney(sessionId, collaborationId);
      }
    }
    const { markCollaborationMailRead } = await import("../starrykol/mail-sync.js");
    markCollaborationMailRead(collaborationId);
    return added;
  } catch {
    mailSyncFailed.add(collaborationId);
    throw new Error("mail_sync_failed");
  }
}

export function resetKolJourneyThreads(): void {
  resetKolMailSync();
  tx((db) => {
    const rows = db.prepare("SELECT id FROM sessions WHERE collaboration_id IS NOT NULL").all() as { id: string }[];
    for (const row of rows) {
      db.prepare("DELETE FROM messages WHERE session_id=?").run(row.id);
      db.prepare("DELETE FROM drafts WHERE session_id=?").run(row.id);
    }
    db.prepare("DELETE FROM kol_mail_seen").run();
    db.prepare("DELETE FROM sessions WHERE collaboration_id IS NOT NULL").run();
  });
}

export function openKolSession(collaborationId: string): Json {
  const col = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(collaborationId) as Row | undefined;
  if (!col) throw new HttpFail(404, "collaboration not found");
  const owner = scopedUser()?.id || null;
  const existing = (owner
    ? getConn().prepare(
        "SELECT * FROM sessions WHERE collaboration_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
      ).get(collaborationId)
    : getConn().prepare(
        "SELECT * FROM sessions WHERE collaboration_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
      ).get(collaborationId)) as Row | undefined;
  if (existing) {
    syncSessionStageCopy(collaborationId, normalizeStage(String(col.stage_code)));
    const refreshed = getConn().prepare("SELECT title FROM sessions WHERE id=?").get(existing.id) as { title?: string } | undefined;
    return {
      id: existing.id,
      title: refreshed?.title || existing.title,
      created: false,
      collaboration_id: collaborationId,
      journey: journeyPayload(collaborationId),
    };
  }
  const sid = nid("ses");
  const now = nowIso();
  const title = `${col.display_name || col.handle} · ${label(String(col.stage_code))}`;
  tx((db) => {
    db.prepare(
      "INSERT INTO sessions (id, title, created_at, updated_at, kind, disabled, owner_user_id, collaboration_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(sid, title, now, now, "kol", 0, owner, collaborationId);
  });
  addMsg(sid, "assistant", "assistant", {
    text: `这是 @${col.handle} 的合作会话。当前阶段：${stageHeadline(String(col.stage_code))}。来信会进这条线；回复和记状态都在这里完成。发送邮件不会修改阶段。`,
    collaboration_id: collaborationId,
  });
  return {
    id: sid,
    title,
    created: true,
    collaboration_id: collaborationId,
    journey: journeyPayload(collaborationId),
  };
}
