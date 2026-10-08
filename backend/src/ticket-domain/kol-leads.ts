import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { createTaskRootPostgres, taskWorkOrderAggregate } from "./task-work-orders.js";
import { recordVerifiedWorkOrderEvent } from "./work-order-verified-event.js";
import { recordWorkOrderShadowDecision } from "./work-order-shadow.js";
import { enqueueWorkOrderDecisionExecution } from "./work-order-automation-pipeline.js";

/**
 * KOL 线索 / 合作项目 domain。层级（2026-10-07 定稿）：
 *   kol_leads → tickets[跟进目标 Task] → work_orders(biz_type=kol_lead)
 *   kol_cooperations → tickets[项目目标 Task] → work_orders(biz_type=kol_cooperation)
 * 工单只挂 Task；业务对象通过 followup_task_id / project_task_id 持有 Task。
 * 不从 db.ts / legacy /tasks 投影读取；只走 PostgreSQL。
 */

export const LEAD_STAGES = [
  "pending_contact", "contacting", "price_negotiating",
  "sample_pending", "intent_pending", "rejected", "converted",
] as const;
export const LEAD_SOURCES = ["ai_discovery", "crawler", "manual", "channel", "referral"] as const;
/**
 * 合作项目阶段 = BIZ-08 15 个正式主阶段 + exception（写入码，审宪 2026-10-08）。
 * 展示可折叠 8 段，但写入必须用正式码；COMPLETED 不是产品节点，归档记 archived_at。
 */
export const COOP_STAGES = [
  "INITIAL_CONTACT", "INTERESTED", "EVALUATING", "QUOTE_PENDING", "NEGOTIATING",
  "PLAN_PENDING", "CONTRACTING", "SAMPLE_PENDING", "SHIPPED", "TESTING",
  "CONTENT_PLANNING", "CONTENT_REVIEW", "PUBLISH_PENDING", "PUBLISHED", "SETTLING",
  "exception",
] as const;
const MAIN_STAGE_ORDER = [
  "INITIAL_CONTACT", "INTERESTED", "EVALUATING", "QUOTE_PENDING", "NEGOTIATING",
  "PLAN_PENDING", "CONTRACTING", "SAMPLE_PENDING", "SHIPPED", "TESTING",
  "CONTENT_PLANNING", "CONTENT_REVIEW", "PUBLISH_PENDING", "PUBLISHED", "SETTLING",
];
export const EXCEPTION_KINDS = ["PAUSED", "DISPUTED", "LOST", "REJECTED", "CANCELLED"] as const;
export const COOP_TYPES = ["short_video", "live", "graphic", "custom"] as const;

/** 归档前置校验：交付类 + 结算类工单必须全部终态，项目才可归档。 */
const ARCHIVE_GATE_TEMPLATES = ["kol_deliverable_acceptance", "kol_publish_confirm", "kol_settlement_check"];

export const LEAD_STAGE_LABELS: Record<string, string> = {
  pending_contact: "待建联", contacting: "建联中", price_negotiating: "报价谈判",
  sample_pending: "样品待发", intent_pending: "意向待定", rejected: "已拒绝", converted: "已转化",
};
export const COOP_STAGE_LABELS: Record<string, string> = {
  INITIAL_CONTACT: "初步接触", INTERESTED: "已回复-有兴趣", EVALUATING: "合作评估",
  QUOTE_PENDING: "报价待确认", NEGOTIATING: "商务谈判", PLAN_PENDING: "方案待确认",
  CONTRACTING: "合同签署", SAMPLE_PENDING: "待寄样", SHIPPED: "已发货",
  TESTING: "已签收-测试中", CONTENT_PLANNING: "内容策划", CONTENT_REVIEW: "内容审核",
  PUBLISH_PENDING: "待发布", PUBLISHED: "已发布", SETTLING: "结算中/已付款",
  exception: "异常",
};
/** 产品法（stage-transitions.md §3）：相邻 +1 前进原因可选；跨段/回退/进出异常必须写原因。 */
export function stageMoveKind(from: string, to: string): "adjacent" | "needs_reason" {
  if (from === to) return "adjacent";
  const fi = MAIN_STAGE_ORDER.indexOf(from);
  const ti = MAIN_STAGE_ORDER.indexOf(to);
  if (fi >= 0 && ti === fi + 1) return "adjacent";
  return "needs_reason";
}
export const COOP_TYPE_LABELS: Record<string, string> = {
  short_video: "短视频", live: "直播", graphic: "图文", custom: "定制",
};

function text(value: unknown, field: string, max: number, required = false): string {
  const s = value == null ? "" : String(value).trim();
  if (required && !s) throw new HttpFail(422, { code: "field_required", field });
  if (s.length > max) throw new HttpFail(422, { code: "field_too_long", field });
  return s;
}
function oneOf(value: unknown, field: string, allowed: readonly string[], required = false): string {
  const s = text(value, field, 60, required);
  if (s && !allowed.includes(s)) throw new HttpFail(422, { code: "field_invalid", field });
  return s;
}
function num(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpFail(422, { code: "field_invalid", field });
  return n;
}

export type KolLeadRow = {
  id: string; platform: string; account_handle: string; account_url: string | null;
  display_name: string; follower_count: number | null; category: string | null;
  source: string; source_ref: string | null; lead_stage: string;
  owner_principal_id: string | null; followup_task_id: string | null;
  is_archived: boolean; archived_reason: string | null;
  data_version: number; created_at: string; updated_at: string;
  open_work_order_count?: number; latest_work_order_status?: string | null;
  has_contact?: boolean;
};
export type KolCooperationRow = {
  id: string; lead_id: string; converted_from_work_order_id: string | null;
  title: string; brand: string; coop_type: string; coop_stage: string;
  exception_kind: string | null;
  budget_amount: string | null; currency: string;
  project_task_id: string | null; owner_principal_id: string | null;
  data_version: number; created_at: string; updated_at: string; archived_at: string | null;
  lead_display_name?: string; lead_platform?: string; lead_account_handle?: string;
  open_work_order_count?: number; blocked_work_order_count?: number;
};

function mapLead(row: Record<string, unknown>): KolLeadRow {
  const contact = row.contact_json as Record<string, unknown> | null;
  return {
    id: String(row.id), platform: String(row.platform), account_handle: String(row.account_handle),
    account_url: (row.account_url as string) ?? null, display_name: String(row.display_name ?? ""),
    follower_count: row.follower_count == null ? null : Number(row.follower_count),
    category: (row.category as string) ?? null, source: String(row.source),
    source_ref: (row.source_ref as string) ?? null, lead_stage: String(row.lead_stage),
    owner_principal_id: (row.owner_principal_id as string) ?? null,
    followup_task_id: (row.followup_task_id as string) ?? null,
    is_archived: Boolean(row.is_archived), archived_reason: (row.archived_reason as string) ?? null,
    data_version: Number(row.data_version), created_at: String(row.created_at), updated_at: String(row.updated_at),
    open_work_order_count: row.open_work_order_count == null ? undefined : Number(row.open_work_order_count),
    latest_work_order_status: (row.latest_work_order_status as string) ?? null,
    has_contact: contact != null && Object.keys(contact).length > 0,
  };
}
function mapCoop(row: Record<string, unknown>): KolCooperationRow {
  return {
    id: String(row.id), lead_id: String(row.lead_id),
    converted_from_work_order_id: (row.converted_from_work_order_id as string) ?? null,
    title: String(row.title), brand: String(row.brand ?? ""), coop_type: String(row.coop_type),
    coop_stage: String(row.coop_stage),
    exception_kind: (row.exception_kind as string) ?? null,
    budget_amount: row.budget_amount == null ? null : String(row.budget_amount),
    currency: String(row.currency ?? "CNY"),
    project_task_id: (row.project_task_id as string) ?? null,
    owner_principal_id: (row.owner_principal_id as string) ?? null,
    data_version: Number(row.data_version), created_at: String(row.created_at), updated_at: String(row.updated_at),
    archived_at: row.archived_at == null ? null : String(row.archived_at),
    lead_display_name: row.lead_display_name == null ? undefined : String(row.lead_display_name),
    lead_platform: row.lead_platform == null ? undefined : String(row.lead_platform),
    lead_account_handle: row.lead_account_handle == null ? undefined : String(row.lead_account_handle),
    open_work_order_count: row.open_work_order_count == null ? undefined : Number(row.open_work_order_count),
    blocked_work_order_count: row.blocked_work_order_count == null ? undefined : Number(row.blocked_work_order_count),
  };
}

const OPEN_WO = "wo.status NOT IN ('completed','cancelled')";

/** 把已核验业务事件写入不可变账本，并走 Jev 受限判断 → 执行队列（沿用 verified-events 管道语义）。 */
export async function emitKolEventAndDecide(
  actorId: string, isAdmin: boolean, taskId: string,
  eventType: string,
  summary: string, evidence: Record<string, unknown>, payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const event = await recordVerifiedWorkOrderEvent(actorId, taskId, {
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    summary,
    evidence_ref: `kol:${idempotencyKey}`,
    evidence,
    payload,
    idempotency_key: idempotencyKey,
    source_system: "kol-workbench",
    source_event_id: idempotencyKey,
  }, { isAdmin });
  const decision = await recordWorkOrderShadowDecision(actorId, taskId, {
    source_event: {
      id: event.event.id, type: event.event.event_type,
      summary: event.event.summary, occurred_at: event.event.occurred_at,
    },
    idempotency_key: `kol-event:${event.event.id}:jev`,
  }, { isAdmin });
  await enqueueWorkOrderDecisionExecution(actorId, decision.decision.id);
}

/** 取消一个 Task 下所有未终态工单（带 stage_events 审计轨迹）。返回取消数量。 */
async function cancelOpenWorkOrders(taskId: string, actorRef: string, reason: string): Promise<number> {
  return postgresTransaction(async (client) => {
    const open = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM work_orders WHERE task_id=$1 AND ${OPEN_WO} FOR UPDATE`, [taskId]);
    let count = 0;
    for (const wo of open.rows) {
      const seq = await client.query<{ n: string }>(
        `SELECT COALESCE(MAX(sequence),0)+1 AS n FROM work_order_stage_events WHERE work_order_id=$1`, [wo.id]);
      await client.query(
        `UPDATE work_orders SET status='cancelled', updated_at=now(), data_version=data_version+1 WHERE id=$1`, [wo.id]);
      await client.query(
        `INSERT INTO work_order_stage_events
           (id, work_order_id, sequence, from_status, to_status, actor_ref, reason)
         VALUES ($1,$2,$3,$4,'cancelled',$5,$6)`,
        [nid("wose"), wo.id, Number(seq.rows[0]!.n), wo.status, actorRef, reason]);
      count++;
    }
    return count;
  });
}

export async function requireLead(actorId: string, isAdmin: boolean, leadId: string): Promise<KolLeadRow> {
  const rows = await postgresPool().query<Record<string, unknown>>(
    `SELECT * FROM kol_leads WHERE id=$1 AND ($2::boolean OR owner_principal_id=$3)`,
    [leadId, isAdmin, actorId]);
  if (!rows.rows[0]) throw new HttpFail(404, { code: "kol_lead_not_found" });
  return mapLead(rows.rows[0]!);
}
export async function requireCoop(actorId: string, isAdmin: boolean, coopId: string): Promise<KolCooperationRow> {
  const rows = await postgresPool().query<Record<string, unknown>>(
    `SELECT c.* FROM kol_cooperations c WHERE c.id=$1 AND ($2::boolean OR c.owner_principal_id=$3)`,
    [coopId, isAdmin, actorId]);
  if (!rows.rows[0]) throw new HttpFail(404, { code: "kol_cooperation_not_found" });
  return mapCoop(rows.rows[0]!);
}

export type KolLeadInput = {
  platform: unknown; account_handle: unknown; account_url?: unknown; display_name?: unknown;
  follower_count?: unknown; category?: unknown; source?: unknown; source_ref?: unknown;
  contact?: unknown; owner_principal_id?: unknown; note?: unknown; idempotency_key: unknown;
};

export async function createKolLead(actorId: string, isAdmin: boolean, raw: KolLeadInput) {
  const platform = text(raw.platform, "platform", 60, true);
  const accountHandle = text(raw.account_handle, "account_handle", 200, true);
  const displayName = text(raw.display_name, "display_name", 200) || accountHandle;
  const source = oneOf(raw.source || "manual", "source", LEAD_SOURCES) || "manual";
  const idemKey = text(raw.idempotency_key, "idempotency_key", 200, true);
  if (idemKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const owner = text(raw.owner_principal_id, "owner_principal_id", 200) || actorId;
  if (!isAdmin && owner !== actorId) throw new HttpFail(403, { code: "kol_owner_forbidden" });

  const dup = await postgresPool().query(`SELECT id FROM kol_leads WHERE platform=$1 AND account_handle=$2`, [platform, accountHandle]);
  if (dup.rows[0]) throw new HttpFail(409, { code: "kol_lead_exists", lead_id: dup.rows[0].id });

  const leadId = nid("lead");
  const contact = (raw.contact != null && typeof raw.contact === "object" ? raw.contact : {}) as Record<string, unknown>;
  // 先建跟进目标 Task（幂等），再建线索行并回填 task id。
  const task = await createTaskRootPostgres(actorId, {
    title: `跟进：${displayName}（${platform}）`,
    goal: `完成对 ${displayName}（${platform}：${accountHandle}）的跟进，直到转化或放弃`,
    idempotency_key: `kol:lead:task:${leadId}`,
  });
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO kol_leads
       (id, platform, account_handle, account_url, display_name, follower_count, category,
        source, source_ref, contact_json, lead_stage, owner_principal_id, followup_task_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_contact',$11,$12,$13,$13)`,
    [leadId, platform, accountHandle, text(raw.account_url, "account_url", 500) || null,
     displayName, num(raw.follower_count, "follower_count"), text(raw.category, "category", 60) || null,
     source, text(raw.source_ref, "source_ref", 200) || null, JSON.stringify(contact),
     owner, task.task_id, now],
  );
  await emitKolEventAndDecide(actorId, isAdmin, task.task_id, "lead.created",
    `线索建档：${displayName}（${platform}）`,
    { lead_id: leadId, platform, account_handle: accountHandle },
    { lead_id: leadId, note: text(raw.note, "note", 1000) },
    `kol:lead.created:${leadId}`);
  return { lead: await requireLead(actorId, isAdmin, leadId), task_id: task.task_id, replayed: false };
}

export async function listKolLeads(actorId: string, isAdmin: boolean, q: {
  stage?: string; source?: string; owner?: string; mine?: boolean; search?: string; limit: number; offset: number;
}) {
  const where: string[] = [`($1::boolean OR l.owner_principal_id=$2)`];
  const params: unknown[] = [isAdmin, actorId];
  let i = 3;
  if (q.stage) { where.push(`l.lead_stage=$${i++}`); params.push(q.stage); }
  if (q.source) { where.push(`l.source=$${i++}`); params.push(q.source); }
  if (q.mine || !isAdmin) { where.push(`l.owner_principal_id=$${i++}`); params.push(actorId); }
  else if (q.owner) { where.push(`l.owner_principal_id=$${i++}`); params.push(q.owner); }
  if (q.search) {
    where.push(`(l.display_name ILIKE $${i} OR l.account_handle ILIKE $${i} OR l.platform ILIKE $${i})`);
    params.push(`%${String(q.search).slice(0, 60)}%`); i++;
  }
  where.push(`l.is_archived=FALSE`);
  const rows = await postgresPool().query<Record<string, unknown>>(
    `SELECT l.*,
            (SELECT count(*) FROM work_orders wo WHERE wo.task_id=l.followup_task_id AND ${OPEN_WO}) AS open_work_order_count,
            (SELECT wo.status FROM work_orders wo WHERE wo.task_id=l.followup_task_id ORDER BY wo.updated_at DESC LIMIT 1) AS latest_work_order_status
       FROM kol_leads l WHERE ${where.join(" AND ")}
       ORDER BY l.updated_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, q.limit, q.offset]);
  const total = await postgresPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM kol_leads l WHERE ${where.join(" AND ")}`, params);
  return { leads: rows.rows.map(mapLead), total: Number(total.rows[0]!.n) };
}

export async function kolLeadDetail(actorId: string, isAdmin: boolean, leadId: string) {
  const lead = await requireLead(actorId, isAdmin, leadId);
  const task = lead.followup_task_id
    ? await taskWorkOrderAggregate(actorId, lead.followup_task_id, isAdmin)
    : null;
  return { lead, task };
}

export async function updateKolLead(actorId: string, isAdmin: boolean, leadId: string, raw: Record<string, unknown>) {
  const lead = await requireLead(actorId, isAdmin, leadId);
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (raw.lead_stage !== undefined) {
    const stage = oneOf(raw.lead_stage, "lead_stage", LEAD_STAGES, true);
    if (lead.lead_stage === "converted" && stage !== "converted") {
      throw new HttpFail(409, { code: "kol_lead_converted_locked" });
    }
    sets.push(`lead_stage=$${i++}`); params.push(stage);
  }
  if (raw.owner_principal_id !== undefined) {
    if (!isAdmin) throw new HttpFail(403, { code: "kol_owner_forbidden" });
    sets.push(`owner_principal_id=$${i++}`); params.push(text(raw.owner_principal_id, "owner_principal_id", 200) || null);
  }
  if (raw.category !== undefined) { sets.push(`category=$${i++}`); params.push(text(raw.category, "category", 60) || null); }
  if (raw.follower_count !== undefined) { sets.push(`follower_count=$${i++}`); params.push(num(raw.follower_count, "follower_count")); }
  if (raw.is_archived !== undefined) {
    sets.push(`is_archived=$${i++}`); params.push(Boolean(raw.is_archived));
    sets.push(`archived_reason=$${i++}`); params.push(text(raw.archived_reason, "archived_reason", 500) || null);
  }
  if (!sets.length) throw new HttpFail(422, { code: "nothing_to_update" });
  sets.push(`data_version=data_version+1`, `updated_at=now()`);
  await postgresPool().query(`UPDATE kol_leads SET ${sets.join(", ")} WHERE id=$${i}`, [...params, leadId]);
  return kolLeadDetail(actorId, isAdmin, leadId);
}

export type KolConvertInput = {
  title: unknown; brand?: unknown; coop_type?: unknown; budget_amount?: unknown;
  currency?: unknown; deliverable_plan?: unknown; settlement_terms?: unknown;
  owner_principal_id?: unknown; work_order_id?: unknown; idempotency_key: unknown;
};

/** 线索转化：建合作项目 + 项目 Task，回填溯源，线索标 converted，关闭线索下未完成工单。 */
export async function convertKolLead(actorId: string, isAdmin: boolean, leadId: string, raw: KolConvertInput) {
  const lead = await requireLead(actorId, isAdmin, leadId);
  if (lead.is_archived) throw new HttpFail(409, { code: "kol_lead_archived" });
  if (lead.lead_stage === "converted") throw new HttpFail(409, { code: "kol_lead_already_converted" });
  const idemKey = text(raw.idempotency_key, "idempotency_key", 200, true);
  if (idemKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const title = text(raw.title, "title", 200, true);
  const coopType = oneOf(raw.coop_type || "short_video", "coop_type", COOP_TYPES) || "short_video";
  const owner = text(raw.owner_principal_id, "owner_principal_id", 200) || lead.owner_principal_id || actorId;
  if (!isAdmin && owner !== actorId) throw new HttpFail(403, { code: "kol_owner_forbidden" });
  const fromWorkOrderId = text(raw.work_order_id, "work_order_id", 200) || null;
  if (fromWorkOrderId && lead.followup_task_id) {
    const wo = await postgresPool().query(
      `SELECT id FROM work_orders WHERE id=$1 AND task_id=$2`, [fromWorkOrderId, lead.followup_task_id]);
    if (!wo.rows[0]) throw new HttpFail(422, { code: "kol_convert_work_order_mismatch" });
  }

  const coopId = nid("coop");
  const task = await createTaskRootPostgres(actorId, {
    title: `合作项目：${title}`,
    goal: `完成与 ${lead.display_name}（${lead.platform}）的合作项目：${title}`,
    idempotency_key: `kol:coop:task:${coopId}`,
  });
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO kol_cooperations
       (id, lead_id, converted_from_work_order_id, title, brand, coop_type, coop_stage,
        budget_amount, currency, deliverable_plan_json, settlement_terms,
        project_task_id, owner_principal_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'PLAN_PENDING',$7,$8,$9,$10,$11,$12,$13,$13)`,
    [coopId, leadId, fromWorkOrderId, title, text(raw.brand, "brand", 120),
     coopType, num(raw.budget_amount, "budget_amount"), text(raw.currency, "currency", 10) || "CNY",
     JSON.stringify(raw.deliverable_plan && typeof raw.deliverable_plan === "object" ? raw.deliverable_plan : {}),
     text(raw.settlement_terms, "settlement_terms", 2000), task.task_id, owner, now],
  );
  await postgresPool().query(
    `UPDATE kol_leads SET lead_stage='converted', data_version=data_version+1, updated_at=now() WHERE id=$1`, [leadId]);
  let cancelled = 0;
  if (lead.followup_task_id) {
    cancelled = await cancelOpenWorkOrders(lead.followup_task_id, actorId, `线索转化建项目 ${coopId}`);
  }
  await emitKolEventAndDecide(actorId, isAdmin, task.task_id, "coop.created",
    `合作项目创建：${title}（来自线索 ${lead.display_name}）`,
    { coop_id: coopId, lead_id: leadId },
    { coop_id: coopId, lead_id: leadId, converted_from_work_order_id: fromWorkOrderId },
    `kol:coop.created:${coopId}`);
  return { cooperation: await requireCoop(actorId, isAdmin, coopId), task_id: task.task_id, cancelled_work_orders: cancelled };
}

export type KolCooperationInput = {
  lead_id: unknown; title: unknown; brand?: unknown; coop_type?: unknown;
  budget_amount?: unknown; currency?: unknown; deliverable_plan?: unknown;
  settlement_terms?: unknown; owner_principal_id?: unknown; idempotency_key: unknown;
};

/** 手动建合作项目（区别于转化自动建）：converted_from_work_order_id 为空。 */
export async function createKolCooperation(actorId: string, isAdmin: boolean, raw: KolCooperationInput) {
  const leadId = text(raw.lead_id, "lead_id", 200, true);
  const lead = await requireLead(actorId, isAdmin, leadId);
  const idemKey = text(raw.idempotency_key, "idempotency_key", 200, true);
  if (idemKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const title = text(raw.title, "title", 200, true);
  const coopType = oneOf(raw.coop_type || "short_video", "coop_type", COOP_TYPES) || "short_video";
  const owner = text(raw.owner_principal_id, "owner_principal_id", 200) || lead.owner_principal_id || actorId;
  if (!isAdmin && owner !== actorId) throw new HttpFail(403, { code: "kol_owner_forbidden" });

  const coopId = nid("coop");
  const task = await createTaskRootPostgres(actorId, {
    title: `合作项目：${title}`,
    goal: `完成与 ${lead.display_name}（${lead.platform}）的合作项目：${title}`,
    idempotency_key: `kol:coop:task:${coopId}`,
  });
  const now = new Date().toISOString();
  await postgresPool().query(
    `INSERT INTO kol_cooperations
       (id, lead_id, title, brand, coop_type, coop_stage,
        budget_amount, currency, deliverable_plan_json, settlement_terms,
        project_task_id, owner_principal_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'PLAN_PENDING',$6,$7,$8,$9,$10,$11,$12,$12)`,
    [coopId, leadId, title, text(raw.brand, "brand", 120), coopType,
     num(raw.budget_amount, "budget_amount"), text(raw.currency, "currency", 10) || "CNY",
     JSON.stringify(raw.deliverable_plan && typeof raw.deliverable_plan === "object" ? raw.deliverable_plan : {}),
     text(raw.settlement_terms, "settlement_terms", 2000), task.task_id, owner, now],
  );
  await emitKolEventAndDecide(actorId, isAdmin, task.task_id, "coop.created",
    `合作项目创建（手动）：${title}（关联线索 ${lead.display_name}）`,
    { coop_id: coopId, lead_id: leadId, manual: true },
    { coop_id: coopId, lead_id: leadId },
    `kol:coop.created:${coopId}`);
  return { cooperation: await requireCoop(actorId, isAdmin, coopId), task_id: task.task_id };
}

export async function listKolCooperations(actorId: string, isAdmin: boolean, q: {
  stage?: string; owner?: string; mine?: boolean; search?: string; limit: number; offset: number;
}) {
  const where: string[] = [`($1::boolean OR c.owner_principal_id=$2)`];
  const params: unknown[] = [isAdmin, actorId];
  let i = 3;
  if (q.stage) { where.push(`c.coop_stage=$${i++}`); params.push(q.stage); }
  if (q.mine || !isAdmin) { where.push(`c.owner_principal_id=$${i++}`); params.push(actorId); }
  else if (q.owner) { where.push(`c.owner_principal_id=$${i++}`); params.push(q.owner); }
  if (q.search) {
    where.push(`(c.title ILIKE $${i} OR c.brand ILIKE $${i})`);
    params.push(`%${String(q.search).slice(0, 60)}%`); i++;
  }
  where.push(`c.archived_at IS NULL`);
  const rows = await postgresPool().query<Record<string, unknown>>(
    `SELECT c.*, l.display_name AS lead_display_name, l.platform AS lead_platform, l.account_handle AS lead_account_handle,
            (SELECT count(*) FROM work_orders wo WHERE wo.task_id=c.project_task_id AND ${OPEN_WO}) AS open_work_order_count,
            (SELECT count(*) FROM work_orders wo WHERE wo.task_id=c.project_task_id AND wo.status IN ('needs_review','waiting_approval')) AS blocked_work_order_count
       FROM kol_cooperations c JOIN kol_leads l ON l.id=c.lead_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.updated_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, q.limit, q.offset]);
  const total = await postgresPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM kol_cooperations c WHERE ${where.join(" AND ")}`, params);
  return { cooperations: rows.rows.map(mapCoop), total: Number(total.rows[0]!.n) };
}

export async function kolCooperationDetail(actorId: string, isAdmin: boolean, coopId: string) {
  const coop = await requireCoop(actorId, isAdmin, coopId);
  const lead = await requireLead(actorId, isAdmin, coop.lead_id).catch(() => null);
  const task = coop.project_task_id
    ? await taskWorkOrderAggregate(actorId, coop.project_task_id, isAdmin)
    : null;
  return { cooperation: coop, lead, task };
}

export async function updateKolCooperation(actorId: string, isAdmin: boolean, coopId: string, raw: Record<string, unknown>) {
  const coop = await requireCoop(actorId, isAdmin, coopId);
  if (coop.archived_at) throw new HttpFail(409, { code: "kol_coop_terminal_locked" });
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const reason = text(raw.reason, "reason", 1000);
  const action = text(raw.action, "action", 20);

  if (action === "archive" || action === "cancel") {
    if (raw.coop_stage !== undefined) throw new HttpFail(422, { code: "kol_action_stage_conflict" });
    if (action === "archive") {
      // 归档 = 结算完成后的结果（BIZ-08：COMPLETED 不是产品节点，不增加主阶段）
      if (coop.project_task_id) {
        const gate = await postgresPool().query<{ n: string }>(
          `SELECT count(*)::text AS n FROM work_orders
            WHERE task_id=$1 AND template_code = ANY($2) AND ${OPEN_WO}`,
          [coop.project_task_id, ARCHIVE_GATE_TEMPLATES]);
        if (Number(gate.rows[0]!.n) > 0) {
          throw new HttpFail(409, { code: "kol_coop_archive_blocked", open_gate_work_orders: gate.rows[0]!.n });
        }
      }
      sets.push(`archived_at=now()`);
    } else {
      // 取消 = 进入 exception 旁路 + CANCELLED 种类（stage-transitions.md），必须写原因
      if (!reason) throw new HttpFail(422, { code: "kol_reason_required" });
      sets.push(`coop_stage='exception'`, `exception_kind='CANCELLED'`, `archived_at=now()`);
      if (coop.project_task_id) {
        await cancelOpenWorkOrders(coop.project_task_id, actorId, `合作项目取消 ${coopId}：${reason}`);
      }
    }
  } else if (action) {
    throw new HttpFail(422, { code: "field_invalid", field: "action" });
  }

  if (raw.coop_stage !== undefined) {
    const stage = oneOf(raw.coop_stage, "coop_stage", COOP_STAGES, true);
    // 产品法：跨段/回退/进出异常必须写原因；相邻 +1 前进原因可选
    if (stageMoveKind(coop.coop_stage, stage) === "needs_reason" && !reason) {
      throw new HttpFail(422, { code: "kol_reason_required", move: `${coop.coop_stage}->${stage}` });
    }
    sets.push(`coop_stage=$${i++}`); params.push(stage);
    if (stage === "exception") {
      sets.push(`exception_kind=$${i++}`);
      params.push(oneOf(raw.exception_kind, "exception_kind", EXCEPTION_KINDS) || null);
    } else {
      sets.push(`exception_kind=NULL`);
    }
  }
  if (raw.settlement_terms !== undefined) { sets.push(`settlement_terms=$${i++}`); params.push(text(raw.settlement_terms, "settlement_terms", 2000)); }
  if (raw.budget_amount !== undefined) { sets.push(`budget_amount=$${i++}`); params.push(num(raw.budget_amount, "budget_amount")); }
  if (raw.owner_principal_id !== undefined) {
    if (!isAdmin) throw new HttpFail(403, { code: "kol_owner_forbidden" });
    sets.push(`owner_principal_id=$${i++}`); params.push(text(raw.owner_principal_id, "owner_principal_id", 200) || null);
  }
  if (!sets.length) throw new HttpFail(422, { code: "nothing_to_update" });
  sets.push(`data_version=data_version+1`, `updated_at=now()`);
  await postgresPool().query(`UPDATE kol_cooperations SET ${sets.join(", ")} WHERE id=$${i}`, [...params, coopId]);
  return kolCooperationDetail(actorId, isAdmin, coopId);
}
