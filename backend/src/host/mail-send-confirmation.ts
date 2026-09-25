import { requireConnector, requireSkill } from "../auth.js";
import { codexMode, liveRemoteSideEffectsEnabled, liveTestKolAllowed, liveTestRecipientAllowed, starryKolMcpConfigured } from "../config.js";
import { audit, getConn, nowIso, txImmediate } from "../db.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { currentFingerprint } from "./fingerprint.js";
import { assertCollaborationInScope } from "./inbound-scope.js";
import { assertMailTemplateSnapshotApplicable } from "./knowledge.js";
import { enforceSend } from "./pep.js";
import { currentUser } from "./persona.js";
import { hostRegisteredActionView, assertHostActionSnapshotCurrent, type HostRegisteredActionView } from "./registered-actions.js";

export type MailSendConfirmation = { confirmation_version?: string; request_id?: string };
type Attempt = { draft_id: string; request_id: string; actor_id: string; confirmation_version: string; status: string; result_json: string | null };

function extraOf(draft: Row): Json {
  if (typeof draft.extra === "object" && draft.extra) return draft.extra as Json;
  try { return JSON.parse(String(draft.extra || "{}")) as Json; } catch { return {}; }
}

function hasAttemptsTable(): boolean {
  return Boolean(getConn().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_send_attempts'").get());
}

/** Schema-only bootstrap; a GET never creates an attempt or changes a business record. */
function ensureAttemptsTable(): void {
  getConn().exec(`CREATE TABLE IF NOT EXISTS mail_send_attempts (
    draft_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    actor_id TEXT NOT NULL,
    confirmation_version TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function attemptFor(draftId: string): Attempt | undefined {
  if (!hasAttemptsTable()) return undefined;
  return getConn().prepare("SELECT * FROM mail_send_attempts WHERE draft_id=?").get(draftId) as Attempt | undefined;
}

function sendSnapshot(draft: Row) {
  return {
    from: String(draft.from_addr || ""),
    to: String(draft.to_addr || ""),
    cc: String(draft.cc || ""),
    subject: String(draft.subject || ""),
    body: String(draft.body_en || ""),
  };
}

export function assertMailGatewayReady(draft: Row): void {
  if (codexMode() === "stub") return;
  if (/@(?:example\.(?:com|net|org)|[^@]+\.(?:example|invalid|test))$/i.test(String(draft.from_addr || ""))) {
    throw new HttpFail(409, { code: "production_sender_not_configured", message: "请先配置已验证的品牌发件邮箱；示例地址不能用于真实外发。" });
  }
  // DirectSendRequest currently forwards one recipient and has no verified CC field.
  // Never show a confirmation for recipients the provider adapter would silently drop.
  if (String(draft.cc || "").trim()) {
    throw new HttpFail(409, { code: "live_mail_cc_unsupported", message: "当前真实邮件适配器尚未验证抄送契约，不能忽略抄送后发送；请使用支持抄送的邮件入口。" });
  }
  if (/[,;\r\n]/.test(String(draft.to_addr || ""))) {
    throw new HttpFail(409, { code: "live_mail_multiple_recipients_unsupported", message: "当前真实邮件网关只支持单个收件人；请分别建立草稿并确认。" });
  }
  if (!liveRemoteSideEffectsEnabled() || !starryKolMcpConfigured()) {
    throw new HttpFail(409, { code: "mail_gateway_not_ready", message: "真实邮件网关未配置或未启用外发，尚未发送。" });
  }
  if (!liveTestRecipientAllowed(String(draft.to_addr || ""))) {
    throw new HttpFail(403, { code: "recipient_not_allowlisted", message: "收件人不在已授权测试范围，尚未发送。" });
  }
  const col = draft.collaboration_id
    ? getConn().prepare("SELECT kol_uid FROM collaborations WHERE id=?").get(draft.collaboration_id) as Row | undefined
    : undefined;
  if (!col?.kol_uid || !liveTestKolAllowed(String(col.kol_uid))) {
    throw new HttpFail(403, { code: "kol_not_allowlisted", message: "合作对象不在已授权测试范围，尚未发送。" });
  }
}

/** Rerun permissions and current business facts; never trust action DTOs from a client. */
export function validateMailSend(draft: Row): void {
  requireSkill(String(draft.skill || "email_compose"));
  requireConnector("enterprise_mail", "write");
  const extra = extraOf(draft);
  let checked = draft;
  let objectBrand = String(extra.brand || "");
  if (draft.collaboration_id) {
    const col = assertCollaborationInScope(String(draft.collaboration_id));
    checked = { ...draft, official_stage: col.stage_code };
    objectBrand = String(col.brand || "");
  }
  if (extra.knowledge_id) {
    assertMailTemplateSnapshotApplicable({
      knowledgeId: String(extra.knowledge_id), version: Number(extra.knowledge_version),
      skillId: String(draft.skill || "email_compose"), stageCode: String(checked.official_stage || ""), brand: objectBrand,
    });
  }
  if (Array.isArray(extra.attachments) && extra.attachments.length) {
    throw new HttpFail(409, { code: "mail_attachments_unsupported", message: "当前邮件网关尚不支持附件外发，请先移除附件或改用支持附件的邮件入口。" });
  }
  if (draft.status === "waiting_approval") {
    throw new HttpFail(409, { code: "mail_waiting_approval", message: "草稿正在等待审批，尚不能发送。" });
  }
  enforceSend(checked, currentUser(), undefined, { readOnly: true });
  assertMailGatewayReady(checked);
}

export function mailSendAction(draft: Row): { draft_id: string; action: HostRegisteredActionView; snapshot: ReturnType<typeof sendSnapshot> } {
  const attempt = attemptFor(String(draft.id));
  const extra = extraOf(draft);
  const col = draft.collaboration_id
    ? getConn().prepare("SELECT stage_code, stage_version, brand, email FROM collaborations WHERE id=?").get(draft.collaboration_id) as Row | undefined
    : undefined;
  let allowed = true;
  let reason: string | undefined;
  try { validateMailSend(draft); } catch (error) {
    allowed = false;
    reason = error instanceof Error ? error.message : "当前无权发送此草稿";
  }
  const done = Boolean(draft.sent_at || draft.status === "sent" || attempt?.status === "sent");
  const busy = ["sending", "send_unknown"].includes(String(draft.status)) || Boolean(attempt && ["sending", "unknown"].includes(attempt.status));
  if (busy) reason = attempt?.status === "unknown" || draft.status === "send_unknown"
    ? "发送结果待核实，请先核对邮件回执，不能重复发送。" : "邮件正在发送，请勿重复提交。";
  const snapshot = sendSnapshot(draft);
  return {
    draft_id: String(draft.id),
    snapshot,
    action: hostRegisteredActionView({
      actionId: "mail.draft.send", label: "确认发送", riskLevel: "L3",
      allowed, enabled: allowed && !done && !busy, disabledReason: reason,
      approvalState: draft.status === "waiting_approval" ? "pending" : "not_required",
      receiptId: done ? (attempt?.request_id || String(draft.id)) : null,
      confirmationPayload: {
        draft_id: draft.id,
        actor_id: currentUser().id,
        snapshot,
        fingerprint: currentFingerprint(draft),
        revision: extra.confirmation_revision || 0,
        knowledge_id: extra.knowledge_id || null,
        knowledge_version: extra.knowledge_version || null,
        collaboration: col || null,
        approval_id: draft.approval_id || null,
      },
    }),
  };
}

export function assertDraftEditable(draft: Row): void {
  const attempt = attemptFor(String(draft.id));
  if (draft.sent_at || ["sent", "sending", "send_unknown"].includes(String(draft.status)) || (attempt && ["sent", "sending", "unknown"].includes(attempt.status))) {
    throw new HttpFail(409, { code: "draft_not_editable", message: "此邮件已发送、正在发送或结果待核实，不能修改；如需另发请新建草稿。" });
  }
}

/** Atomic claim before any network call. A restarted process cannot silently resend. */
export function claimMailSend(draftId: string, input: MailSendConfirmation): { replay: Json | null } {
  const requestId = String(input.request_id || "");
  const confirmation = String(input.confirmation_version || "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId) || !confirmation) {
    throw new HttpFail(409, { code: "mail_confirmation_required", message: "请核对当前草稿并确认发送；缺少有效的确认版本或请求编号。" });
  }
  ensureAttemptsTable();
  return txImmediate((db) => {
    const draft = db.prepare("SELECT * FROM drafts WHERE id=?").get(draftId) as Row | undefined;
    if (!draft) throw new HttpFail(404, "draft not found");
    validateMailSend(draft);
    const actorId = currentUser().id;
    const prior = attemptFor(draftId);
    if (prior) {
      if (prior.request_id === requestId && prior.actor_id === actorId && prior.confirmation_version === confirmation && prior.status === "sent") {
        return { replay: JSON.parse(prior.result_json || "{}") as Json };
      }
      throw new HttpFail(409, { code: prior.status === "unknown" ? "mail_send_unknown" : "mail_send_already_claimed", message: "此草稿已有发送尝试，请核对当前回执，不可重复发送。" });
    }
    if (db.prepare("SELECT 1 FROM mail_send_attempts WHERE request_id=?").get(requestId)) {
      throw new HttpFail(409, { code: "mail_request_id_conflict", message: "该发送请求编号已被使用，请重新核对草稿。" });
    }
    const current = mailSendAction(draft).action;
    try { assertHostActionSnapshotCurrent(confirmation, current); } catch {
      throw new HttpFail(409, { code: "action_confirmation_snapshot_stale", message: "草稿或上下文已改变，请重新核对并确认发送。" });
    }
    const time = nowIso();
    db.prepare("INSERT INTO mail_send_attempts (draft_id,request_id,actor_id,confirmation_version,status,created_at,updated_at) VALUES (?,?,?,?, 'sending',?,?)")
      .run(draftId, requestId, actorId, confirmation, time, time);
    db.prepare("UPDATE drafts SET status='sending' WHERE id=?").run(draftId);
    audit(actorId, "mail.send.confirmed", { draft_id: draftId, request_id: requestId, confirmation_version: confirmation });
    return { replay: null };
  });
}

export function assertClaimedMailSend(draftId: string, requestId: string): void {
  const attempt = attemptFor(draftId);
  if (!attempt || attempt.request_id !== requestId || attempt.status !== "sending" || attempt.actor_id !== currentUser().id) {
    throw new HttpFail(409, { code: "mail_gateway_confirmation_required", message: "邮件网关缺少已经确认的发送请求。" });
  }
}

export function completeMailSend(draftId: string, requestId: string, result: Json): void {
  txImmediate((db) => {
    const updated = db.prepare("UPDATE mail_send_attempts SET status='sent',result_json=?,updated_at=? WHERE draft_id=? AND request_id=? AND status='sending'")
      .run(JSON.stringify(result), nowIso(), draftId, requestId);
    if (updated.changes !== 1) throw new Error("mail_send_claim_lost");
    db.prepare("UPDATE drafts SET sent_at=?,status='sent' WHERE id=?").run(nowIso(), draftId);
    const draft = db.prepare("SELECT collaboration_id,to_addr FROM drafts WHERE id=?").get(draftId) as Row;
    if (draft.collaboration_id && draft.to_addr) {
      db.prepare("UPDATE collaborations SET email=? WHERE id=? AND (email IS NULL OR trim(email)='')")
        .run(String(draft.to_addr), String(draft.collaboration_id));
    }
  });
}

export function markMailSendUnknown(draftId: string, requestId: string): void {
  txImmediate((db) => {
    const updated = db.prepare("UPDATE mail_send_attempts SET status='unknown',error='provider_result_unconfirmed',updated_at=? WHERE draft_id=? AND request_id=? AND status='sending'")
      .run(nowIso(), draftId, requestId);
    if (updated.changes) db.prepare("UPDATE drafts SET status='send_unknown' WHERE id=?").run(draftId);
  });
}
