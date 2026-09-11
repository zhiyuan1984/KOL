/**
 * Gateway：发信。Dify「HTTP 外部动作」。
 * 只有这里可以调 Starry send。Worker / Skill / MCP 禁止发信。
 */
import { starry } from "../adapters/clients.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import type { Json, Row } from "../types.js";

export function sendDraft(draftId: string, via = "operator"): Json {
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
  const result = starry.sendConversation(conversationId, payload);
  tx((c) => {
    c.prepare("UPDATE drafts SET sent_at = ?, status = 'sent' WHERE id = ?").run(nowIso(), draftId);
  });
  let extra: Json = {};
  try {
    extra = d.extra ? JSON.parse(String(d.extra)) as Json : {};
  } catch {
    extra = {};
  }
  audit("gateway", "gateway.send", {
    draft_id: draftId,
    via,
    conversation_id: conversationId,
    stage_untouched: true,
    official_stage: col?.stage_code ?? null,
    knowledge_id: extra.knowledge_id || null,
    knowledge_version: extra.knowledge_version || null,
  });
  return {
    ok: true,
    send: result,
    official_stage: col?.stage_code ?? null,
    stage_changed: false,
  };
}
