import { audit, getConn, nowIso, tx } from "../db.js";
import { appendBusinessEvent, stageEventType } from "../business-events.js";
import { nid } from "../ids.js";
import { BY_CODE, label as stageLabel, normalizeStage, STAGES } from "../stages.js";
import { assertStageTransition } from "../stage-transitions-graph.js";
import { dictionaryOptionsFor } from "../starrykol/remote-contract.js";
import { isUsableInternalZh, stubInternalZh } from "../starrykol/translate-zh.js";
import type { Json, Row, StageTransitionInput } from "../types.js";

export function stageOptions(): Json[] {
  return STAGES.map((s) => ({
    code: s.code,
    label: s.label,
    capability_domain: s.domain,
    advancement_mode: s.advancementMode,
    main: s.main,
    terminal: Boolean(s.terminal),
  }));
}

export function dictionaryOptions(parentKey: string): Json[] {
  if (parentKey === "mailbox_brand_affiliation" || parentKey === "brand") {
    return [
      { key: "LT", label: "LiTime", mailbox: "kol.lt@litime.example" },
      { key: "RO", label: "Renogy", mailbox: "kol.ro@renogy.example" },
      { key: "PQ", label: "Power Queen", mailbox: "kol.pq@powerqueen.example" },
    ];
  }
  if (parentKey === "cooperation_stage" || parentKey === "stages") return stageOptions();
  if (parentKey === "kol_primary_platform" || parentKey === "kol_niche" || parentKey === "kol_follow_style" || parentKey === "kol_risk_tag") {
    return dictionaryOptionsFor(parentKey).map((row) => ({ key: row.code, label: row.name, code: row.code, name: row.name }));
  }
  return [];
}

export async function confirmStage(lifecycleId: string, body: Json): Promise<Awaited<Json>> {
  const code = normalizeStage(String(body.stage_code || body.stageCode || ""));
  const actor = String(body.actor || "host");
  if (!code) throw new Error("stage_code required");
  const row = (await getConn().query("SELECT * FROM collaborations WHERE lifecycle_id = $1",[lifecycleId])).rows[0] as Row | undefined;
  if (!row) throw new KeyError(lifecycleId);
  const from = normalizeStage(String(row.stage_code));
  if (!BY_CODE[code]) throw new Error(`unknown stage: ${code}`);
  const supplied = (body.transition && typeof body.transition === "object" ? body.transition : {}) as Partial<StageTransitionInput>;
  const graphActor = String(supplied.recommender || body.recommender || "") === "fact_advance" ? "auto" : "human";
  assertStageTransition(from, code, graphActor, String(body.reason || supplied.reason_code || body.reason_code || ""));
  const before = Number(row.stage_version || 0);
  const stage = BY_CODE[code];
  const occurredAt = String(supplied.occurred_at || body.occurred_at || nowIso());
  const transition: StageTransitionInput = {
    collaboration_id: String(supplied.collaboration_id || row.id),
    from_stage: from,
    to_stage: code,
    reason_code: String(supplied.reason_code || body.reason_code || "EXTERNAL_FACT"),
    evidence: (supplied.evidence && typeof supplied.evidence === "object"
      ? supplied.evidence
      : body.evidence && typeof body.evidence === "object"
        ? body.evidence
        : {}) as Json,
    recommender: String(supplied.recommender || body.recommender || actor),
    approver: String(supplied.approver || body.approver || actor),
    occurred_at: occurredAt,
    data_version_before: before,
    data_version_after: before + 1,
    capability_profile: String(supplied.capability_profile || stage?.domain || "Commander"),
    advancement_mode: String(supplied.advancement_mode || stage?.advancementMode || "旁路"),
  };
  const transitionId = nid("trn");
  (await tx(async (c) => {
    const updated = (await c.query("UPDATE collaborations\n         SET stage_code = $1, days_in_stage = 0, stage_version = $2\n         WHERE lifecycle_id = $3 AND stage_version = $4",[code,transition.data_version_after,lifecycleId,transition.data_version_before]));
    if (updated.changes !== 1) throw new Error("stage version conflict");
    (await c.query("INSERT INTO starry_stage_writes (lifecycle_id, stage_code, actor, ts) VALUES ($1,$2,$3,$4)",[lifecycleId,code,actor,occurredAt]));
    (await c.query("INSERT INTO stage_transitions\n       (id, collaboration_id, lifecycle_id, from_stage, to_stage, reason_code, evidence,\n        recommender, approver, occurred_at, data_version_before, data_version_after,\n        capability_profile, advancement_mode)\n       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[transitionId,transition.collaboration_id,lifecycleId,transition.from_stage,transition.to_stage,transition.reason_code,JSON.stringify(transition.evidence),transition.recommender,transition.approver,transition.occurred_at,transition.data_version_before,transition.data_version_after,transition.capability_profile,transition.advancement_mode]));
    (await appendBusinessEvent(
      {
        eventType: stageEventType(from, code),
        objectType: "collaboration",
        objectId: transition.collaboration_id,
        occurredAt: transition.occurred_at,
        source: "starry",
        actorType: graphActor === "auto" ? "system" : "human",
        actorId: transition.approver,
        actionRef: "confirm_stage",
        payload: {
          from_stage: from,
          to_stage: code,
          reason_code: transition.reason_code,
          capability_profile: transition.capability_profile,
        },
        evidence: transition.evidence,
        idempotencyKey: `stage_transition:${transitionId}`,
        correlationId: lifecycleId,
      },
      { conn: c },
    ));
  }));
  (await audit("starry", "starry.stage", {
    lifecycle_id: lifecycleId,
    transition_id: transitionId,
    from_stage: from,
    to_stage: code,
    actor,
  }));
  return {
    ok: true,
    lifecycleId,
    stage_code: code,
    stage_label: stageLabel(code),
    transition_id: transitionId,
    transition,
  };
}

export async function sendConversation(conversationId: string, body: Json): Promise<Awaited<Json>> {
  const row = (await getConn().query("SELECT * FROM collaborations WHERE conversation_id = $1",[conversationId])).rows[0] as Row | undefined;
  (await tx(async (c) => {
    (await c.query("INSERT INTO starry_sends (conversation_id, from_addr, to_addr, cc, subject, body, ts)\n       VALUES ($1,$2,$3,$4,$5,$6,$7)",[conversationId,body.from || body.from_addr || null,body.to || body.to_addr || null,body.cc || "",body.subject || "",body.body || body.html || "",nowIso()]));
  }));
  (await audit("starry", "starry.send", {
    conversation_id: conversationId,
    subject: body.subject,
    stage_before: row ? row.stage_code : null,
  }));
  return { ok: true, conversationId, status: "sent" };
}

export async function translateZh(body: Json): Promise<Awaited<Json>> {
  const text = String(body.text || body.body || "");
  const cached = String(body.zh || "");
  const zh = isUsableInternalZh(cached, text) ? cached : stubInternalZh(text);
  (await audit("starry", "starry.translate_zh", { chars: text.length }));
  return { ok: true, zh, internal_only: true };
}

export async function getConversation(conversationId: string): Promise<Awaited<Json | null>> {
  const row = (await getConn().query("SELECT * FROM collaborations WHERE conversation_id = $1",[conversationId])).rows[0] as Row | undefined;
  if (!row) return null;
  return {
    id: row.conversation_id,
    lifecycleId: row.lifecycle_id,
    kol: row.handle,
    stage_code: row.stage_code,
  };
}

export class KeyError extends Error {
  constructor(public key: string) {
    super(key);
  }
}
