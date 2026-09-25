/** External mail is committed only here, with a claimed human-confirmed snapshot. */
import { starry } from "../adapters/clients.js";
import { codexMode } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import { executeStarryKolTask } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";
import { assertClaimedMailSend, validateMailSend, completeMailSend, markMailSendUnknown } from "../host/mail-send-confirmation.js";
import { withMailSendAuthority } from "./mail-authority.js";

export async function sendDraft(draftId: string, via = "operator", requestId = ""): Promise<Json> {
  assertClaimedMailSend(draftId, requestId);
  const d = getConn().prepare("SELECT * FROM drafts WHERE id = ?").get(draftId) as Row | undefined;
  if (!d) throw new Error(draftId);
  validateMailSend(d);
  const col = d.collaboration_id
    ? getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(d.collaboration_id) as Row | undefined
    : undefined;
  const conversationId = String(col?.conversation_id || `conv_${draftId}`);
  const payload = {
    from: d.from_addr, to: d.to_addr, cc: d.cc || "",
    subject: d.subject, body: d.body_en, lang: "en", internal_zh_excluded: true,
  };
  let result: Json;
  try {
    if (codexMode() !== "stub") {
      const remote = await withMailSendAuthority(draftId, requestId, () => executeStarryKolTask("email_compose", {
        conversationId: Number(conversationId) || undefined,
        mailboxEmail: d.from_addr,
        from: d.from_addr,
        to: [d.to_addr],
        cc: d.cc || "",
        subject: d.subject,
        body: d.body_en,
        confirm_send: true,
        ...(col?.kol_uid ? { kolUid: col.kol_uid } : {}),
      }, via));
      result = remote.data;
      if (!Boolean(result.sent)) throw new Error("provider_result_unconfirmed");
    } else {
      result = starry.sendConversation(conversationId, payload);
    }
    // A durable receipt must precede memory refresh or UI notifications.
    const receipt = { ok: true, send: result, request_id: requestId, official_stage: col?.stage_code ?? null, stage_changed: false };
    completeMailSend(draftId, requestId, receipt);
  } catch (error) {
    // Once the network call may have started, do not assume an error means unsent.
    markMailSendUnknown(draftId, requestId);
    throw error;
  }
  let extra: Json = {};
  try { extra = JSON.parse(String(d.extra || "{}")) as Json; } catch { /* no extra */ }
  try {
    if (col?.kol_uid) {
      const { recordEffectiveCorrespondence, recordFollowedMailMemory } = await import("../host/kol-memory.js");
      recordEffectiveCorrespondence({
        kolUid: String(col.kol_uid), collaborationId: String(col.id || ""), scopeBrand: String(col.brand || ""),
        direction: "outbound", occurredAt: nowIso(), gatewaySuccess: true, kind: "human",
        subject: String(d.subject || ""), body: String(d.body_en || ""),
      });
      recordFollowedMailMemory({
        kolUid: String(col.kol_uid), collaborationId: String(col.id || ""), scopeBrand: String(col.brand || ""),
        conversationId, subject: String(d.subject || ""), summary: String(d.body_en || ""), body: String(d.body_en || ""),
        direction: "outbound", occurredAt: nowIso(), gatewaySuccess: true, sourceVersion: `gateway.send:${draftId}`,
      });
    }
  } catch {
    audit("gateway", "gateway.send.memory_pending", { draft_id: draftId, request_id: requestId, sent: true });
  }
  audit("gateway", "gateway.send", {
    draft_id: draftId, request_id: requestId, via, conversation_id: conversationId,
    stage_untouched: true, official_stage: col?.stage_code ?? null,
    knowledge_id: extra.knowledge_id || null, knowledge_version: extra.knowledge_version || null, follow_created: false,
  });
  return { ok: true, send: result, request_id: requestId, official_stage: col?.stage_code ?? null, stage_changed: false };
}
