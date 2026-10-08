import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool } from "../postgres/pool.js";
import { createKolLead, emitKolEventAndDecide, requireCoop, requireLead } from "./kol-leads.js";

/**
 * KOL 事件生产者桥接（2026-10-08）。
 * 把业务系统（AI发现、邮件、定时任务…）的事实翻译成线索/合作 Task 上的
 * 已核验业务事件，走统一管道（verified-event → Jev → 执行队列）。
 * 桥接失败永不破坏主动作（跟进、同步等），由调用方 catch 并记录。
 */

export const LEAD_MANUAL_EVENT_TYPES = [
  "lead.reply_received",
  "lead.followup_due",
  "lead.sample_requested",
  "lead.intent_confirmed",
  "lead.high_potential_detected",
] as const;

export type DiscoveryCandidateLead = {
  platform: unknown;
  account_handle: unknown;
  display_name?: unknown;
  account_url?: unknown;
  follower_count?: unknown;
  category?: unknown;
  candidate_id?: unknown;
};

/**
 * AI发现跟进 → 线索建档。按 平台+账号 去重：已存在直接复用，不重复建 Task/事件。
 * 跟进（L3 点击确认）本身已是强意图，建档为 pending_contact 线索并触发初次建联工单。
 */
export async function ensureLeadFromDiscoveryCandidate(
  actorId: string, isAdmin: boolean, raw: DiscoveryCandidateLead,
): Promise<{ lead_id: string; created: boolean }> {
  const platform = String(raw.platform || "").trim().toLowerCase();
  const handle = String(raw.account_handle || "").trim();
  if (!platform || !handle) throw new HttpFail(422, { code: "kol_candidate_identity_missing" });
  const dup = await postgresPool().query<{ id: string }>(
    `SELECT id FROM kol_leads WHERE platform=$1 AND account_handle=$2`, [platform, handle]);
  if (dup.rows[0]) return { lead_id: dup.rows[0]!.id, created: false };
  const displayName = String(raw.display_name || "").trim() || handle;
  const followerCount = raw.follower_count == null || raw.follower_count === "" ? null : Number(raw.follower_count);
  const result = await createKolLead(actorId, isAdmin, {
    platform, account_handle: handle,
    display_name: displayName,
    account_url: String(raw.account_url || "").trim() || undefined,
    follower_count: followerCount != null && Number.isFinite(followerCount) ? followerCount : undefined,
    category: String(raw.category || "").trim() || undefined,
    source: "ai_discovery",
    source_ref: String(raw.candidate_id || "").trim() || undefined,
    note: "AI发现跟进自动建档",
    idempotency_key: nid("idem"),
  });
  return { lead_id: result.lead.id, created: true };
}

export type LeadEventInput = {
  event_type: unknown;
  summary: unknown;
  evidence_ref?: unknown;
  evidence?: unknown;
  idempotency_key: unknown;
};

export const COOP_MANUAL_EVENT_TYPES = [
  "coop.contract_requested",
  "kol.sample_shipment_requested",
  "kol.sample_reship_requested",
  "kol.script_submitted",
  "kol.script_revision_requested",
  "kol.schedule_change_requested",
  "kol.production_deadline_near",
  "kol.production_delayed",
  "kol.deliverable_submitted",
  "kol.publish_scheduled",
  "kol.publish_verified",
  "kol.settlement_due",
  "kol.invoice_received",
  "kol.sentiment_negative",
  "kol.violation_detected",
  "kol.dispute_raised",
  "kol.settlement_completed",
] as const;

export type CoopEventInput = {
  event_type: unknown;
  summary: unknown;
  evidence_ref?: unknown;
  evidence?: unknown;
  idempotency_key: unknown;
};

/** 在合作项目的项目 Task 上记录一条已核验业务事件（手动/定时生产者入口）。 */
export async function recordCooperationEvent(actorId: string, isAdmin: boolean, coopId: string, raw: CoopEventInput) {
  const eventType = String(raw.event_type || "").trim();
  if (!(COOP_MANUAL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpFail(422, { code: "kol_event_type_not_allowed", allowed: [...COOP_MANUAL_EVENT_TYPES] });
  }
  const summary = String(raw.summary || "").trim();
  if (!summary) throw new HttpFail(422, { code: "field_required", field: "summary" });
  if (summary.length > 1000) throw new HttpFail(422, { code: "field_too_long", field: "summary" });
  const idemKey = String(raw.idempotency_key || "").trim();
  if (idemKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const coop = await requireCoop(actorId, isAdmin, coopId);
  if (!coop.project_task_id) throw new HttpFail(409, { code: "kol_coop_no_task" });
  if (coop.archived_at) throw new HttpFail(409, { code: "kol_coop_terminal_locked" });
  const evidence = (raw.evidence != null && typeof raw.evidence === "object" ? raw.evidence : {}) as Record<string, unknown>;
  await emitKolEventAndDecide(actorId, isAdmin, coop.project_task_id, eventType, summary,
    { coop_id: coopId, ...evidence },
    { coop_id: coopId },
    idemKey.startsWith("kol:") ? idemKey : `kol:${eventType}:${coopId}:${idemKey.slice(0, 32)}`);
  return { coop_id: coopId, event_type: eventType };
}

/** 在线索的跟进 Task 上记录一条已核验业务事件（手动/定时生产者入口）。 */
export async function recordLeadEvent(actorId: string, isAdmin: boolean, leadId: string, raw: LeadEventInput) {
  const eventType = String(raw.event_type || "").trim();
  if (!(LEAD_MANUAL_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpFail(422, { code: "kol_event_type_not_allowed", allowed: [...LEAD_MANUAL_EVENT_TYPES] });
  }
  const summary = String(raw.summary || "").trim();
  if (!summary) throw new HttpFail(422, { code: "field_required", field: "summary" });
  if (summary.length > 1000) throw new HttpFail(422, { code: "field_too_long", field: "summary" });
  const idemKey = String(raw.idempotency_key || "").trim();
  if (idemKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const lead = await requireLead(actorId, isAdmin, leadId);
  if (!lead.followup_task_id) throw new HttpFail(409, { code: "kol_lead_no_task" });
  if (lead.is_archived) throw new HttpFail(409, { code: "kol_lead_archived" });
  const evidence = (raw.evidence != null && typeof raw.evidence === "object" ? raw.evidence : {}) as Record<string, unknown>;
  await emitKolEventAndDecide(actorId, isAdmin, lead.followup_task_id, eventType, summary,
    { lead_id: leadId, ...evidence },
    { lead_id: leadId },
    idemKey.startsWith("kol:") ? idemKey : `kol:${eventType}:${leadId}:${idemKey.slice(0, 32)}`);
  return { lead_id: leadId, event_type: eventType };
}
