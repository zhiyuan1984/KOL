/**
 * Gateway：发信。Dify「HTTP 外部动作」。
 * 只有这里可以调 Starry send。Worker / Skill / MCP 禁止发信。
 */
import { starry } from "../adapters/clients.js";
import {
  codexMode,
  liveRemoteSideEffectsEnabled,
  liveTestKolAllowed,
  liveTestRecipientAllowed,
  starryKolMcpConfigured,
} from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { executeStarryKolTask } from "../starrykol/service.js";
import type { Json, Row } from "../types.js";

export async function sendDraft(draftId: string, via = "operator"): Promise<Json> {
  const d = getConn().prepare("SELECT * FROM drafts WHERE id = ?").get(draftId) as Row | undefined;
  if (!d) throw new Error(draftId);
  let col: Row | null = null;
  if (d.collaboration_id) {
    const row = getConn().prepare("SELECT * FROM collaborations WHERE id = ?").get(d.collaboration_id) as Row | undefined;
    col = row ? { ...row } : null;
  }
  const conversationId = String((col || {}).conversation_id || `conv_${draftId}`);
  const payload = {
    from: d.from_addr,
    to: d.to_addr,
    cc: d.cc || "",
    subject: d.subject,
    body: d.body_en,
    lang: "en",
    internal_zh_excluded: true,
  };
  let result: Json;
  if (codexMode() !== "stub") {
    if (!liveRemoteSideEffectsEnabled() || !starryKolMcpConfigured()) {
      throw new Error("真实发信需要 LIVE_REMOTE_SIDE_EFFECTS=1、Starry MCP 配置和测试 allowlist。");
    }
    if (!liveTestRecipientAllowed(String(d.to_addr || ""))) {
      throw new Error("收件人不在 LIVE_TEST_RECIPIENTS allowlist，未发送。");
    }
    if (!col?.kol_uid || !liveTestKolAllowed(String(col.kol_uid))) {
      throw new Error("KOL UID 不在 LIVE_TEST_KOL_UIDS allowlist，未发送。");
    }
    const remote = await executeStarryKolTask("email_compose", {
      conversationId: Number(conversationId) || undefined,
      mailboxEmail: d.from_addr,
      from: d.from_addr,
      to: [d.to_addr],
      subject: d.subject,
      body: d.body_en,
      confirm_send: true,
      ...(col?.kol_uid ? { kolUid: col.kol_uid } : {}),
    }, via);
    result = remote.data;
    if (!Boolean(result.sent)) throw new Error(String(result.error || "远程邮件服务未返回已发送回执"));
  } else {
    result = starry.sendConversation(conversationId, payload);
  }
  tx((c) => {
    c.prepare("UPDATE drafts SET sent_at = ?, status = 'sent' WHERE id = ?").run(nowIso(), draftId);
  });
  let extra: Json = {};
  try {
    extra = d.extra ? JSON.parse(String(d.extra)) as Json : {};
  } catch {
    extra = {};
  }
  if (col?.kol_uid) {
    const { recordEffectiveCorrespondence } = await import("../host/kol-memory.js");
    recordEffectiveCorrespondence({
      kolUid: String(col.kol_uid),
      collaborationId: String(col.id || ""),
      scopeBrand: String(col.brand || ""),
      direction: "outbound",
      occurredAt: nowIso(),
      gatewaySuccess: true,
      kind: "human",
      subject: String(d.subject || ""),
      body: String(d.body_en || ""),
    });
  }
  audit("gateway", "gateway.send", {
    draft_id: draftId,
    via,
    conversation_id: conversationId,
    stage_untouched: true,
    official_stage: col?.stage_code ?? null,
    knowledge_id: extra.knowledge_id || null,
    knowledge_version: extra.knowledge_version || null,
    follow_created: false,
  });
  return {
    ok: true,
    send: result,
    official_stage: col?.stage_code ?? null,
    stage_changed: false,
  };
}
