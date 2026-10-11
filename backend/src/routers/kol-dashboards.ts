import { Hono } from "hono";
import { requireTicketPrincipal, ticketIsAdmin } from "../ticket-domain/auth.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool } from "../postgres/pool.js";

/**
 * KOL 管理端驾驶舱：只读聚合 API（管理端心智模型"治理四件套"之看板）。
 *
 * - GET /api/kol/admin/lead-funnel        线索漏斗看板（漏斗效率）
 * - GET /api/kol/admin/project-delivery   项目交付看板（交付健康）
 *
 * 全部只读、仅管理员（ticketIsAdmin），不写任何业务表。
 * 口径说明：
 * - 线索"在跟进" = 未归档 且 阶段不在 (rejected, converted)
 * - 阶段转化率 = 近 30 天 business_events lead.stage_changed 中，从该阶段流出且去往下一阶段的占比
 * - 项目"在途" = archived_at 为空 且 不在 exception 态；"异常" = 正式 exception 态（带 exception_kind）
 * - 合作阶段按真实 schema 的 15 正式阶段 + exception（migration 20261008_kol_stage_biz08）
 */
export const kolDashboards = new Hono();

kolDashboards.onError((error, c) => {
  if (error instanceof HttpFail) {
    return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
  }
  console.error(error);
  return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
});

function meta() {
  return { request_id: nid("req"), as_of: new Date().toISOString(), schema_version: "kol-api.v1" };
}

function requireAdmin() {
  const principal = requireTicketPrincipal();
  if (!ticketIsAdmin(principal)) throw new HttpFail(403, { code: "kol_admin_forbidden" });
  return principal;
}

const LEAD_STAGES = ["pending_contact", "contacting", "price_negotiating", "sample_pending", "intent_pending", "rejected", "converted"] as const;
const LEAD_STAGE_LABELS: Record<string, string> = {
  pending_contact: "待建联", contacting: "建联中", price_negotiating: "报价谈判",
  sample_pending: "样品待发", intent_pending: "意向待定", rejected: "已拒绝", converted: "已转化",
};
const COOP_STAGES = ["INITIAL_CONTACT", "INTERESTED", "EVALUATING", "QUOTE_PENDING", "NEGOTIATING",
  "PLAN_PENDING", "CONTRACTING", "SAMPLE_PENDING", "SHIPPED", "TESTING",
  "CONTENT_PLANNING", "CONTENT_REVIEW", "PUBLISH_PENDING", "PUBLISHED", "SETTLING"] as const;
const COOP_STAGE_LABELS: Record<string, string> = {
  INITIAL_CONTACT: "初步接触", INTERESTED: "已回复-有兴趣", EVALUATING: "合作评估",
  QUOTE_PENDING: "报价待确认", NEGOTIATING: "商务谈判", PLAN_PENDING: "方案待确认",
  CONTRACTING: "合同签署", SAMPLE_PENDING: "待寄样", SHIPPED: "已发货",
  TESTING: "已签收-测试中", CONTENT_PLANNING: "内容策划", CONTENT_REVIEW: "内容审核",
  PUBLISH_PENDING: "待发布", PUBLISHED: "已发布", SETTLING: "结算中/已付款",
  exception: "异常",
};
const EXCEPTION_KIND_LABELS: Record<string, string> = {
  PAUSED: "已暂停", DISPUTED: "有争议", LOST: "已流失", REJECTED: "已拒绝", CANCELLED: "已取消",
};
/** 在途 = 未归档（archived_at 为空）且不在异常态 */
const ACTIVE_COOP_WHERE = "archived_at IS NULL AND coop_stage <> 'exception'";

async function q<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await postgresPool().query(text, params);
  return r.rows as T[];
}

kolDashboards.get("/kol/admin/lead-funnel", async (c) => {
  requireAdmin();

  const kpis = await q<{ total: string; active: string; new_week: string; converted_month: string; avg_stay: string | null; stuck: string }>(`
    SELECT
      (SELECT count(*)::text FROM kol_leads) AS total,
      (SELECT count(*)::text FROM kol_leads WHERE NOT is_archived AND lead_stage NOT IN ('rejected','converted')) AS active,
      (SELECT count(*)::text FROM kol_leads WHERE created_at > now() - interval '7 days') AS new_week,
      (SELECT count(*)::text FROM kol_leads WHERE lead_stage='converted' AND updated_at > date_trunc('month', now())) AS converted_month,
      (SELECT round(avg(extract(epoch FROM now() - updated_at)/86400)::numeric, 1)::text
         FROM kol_leads WHERE NOT is_archived AND lead_stage NOT IN ('rejected','converted')) AS avg_stay,
      (SELECT count(*)::text FROM kol_leads
        WHERE NOT is_archived AND lead_stage NOT IN ('rejected','converted') AND updated_at < now() - interval '14 days') AS stuck
  `).then((rows) => rows[0]!);

  const term = await q<{ converted: string; rejected: string }>(`
    SELECT
      (SELECT count(*)::text FROM kol_leads WHERE lead_stage='converted' AND NOT is_archived) AS converted,
      (SELECT count(*)::text FROM kol_leads WHERE lead_stage='rejected' AND NOT is_archived) AS rejected
  `).then((rows) => rows[0]!);
  const converted = Number(term.converted), rejected = Number(term.rejected);
  const conversionRate = converted + rejected > 0 ? Math.round((converted / (converted + rejected)) * 1000) / 10 : null;

  const funnelCounts = await q<{ lead_stage: string; n: string }>(`
    SELECT lead_stage, count(*)::text AS n FROM kol_leads WHERE NOT is_archived GROUP BY lead_stage
  `);
  const countByStage = Object.fromEntries(funnelCounts.map((r) => [r.lead_stage, Number(r.n)]));

  // 近 30 天阶段流转：从每阶段流出且去往下一阶段的占比
  const transitions = await q<{ from_stage: string; to_stage: string; n: string }>(`
    SELECT payload::jsonb->>'from_stage' AS from_stage, payload::jsonb->>'to_stage' AS to_stage, count(*)::text AS n
    FROM business_events
    WHERE event_type='lead.stage_changed' AND occurred_at::timestamptz > now() - interval '30 days'
    GROUP BY 1, 2
  `);
  const outByStage: Record<string, number> = {};
  const nextByStage: Record<string, number> = {};
  for (const t of transitions) {
    const from = t.from_stage, to = t.to_stage, n = Number(t.n);
    outByStage[from] = (outByStage[from] || 0) + n;
    const idx = LEAD_STAGES.indexOf(from as (typeof LEAD_STAGES)[number]);
    if (idx >= 0 && LEAD_STAGES[idx + 1] === to) nextByStage[from] = (nextByStage[from] || 0) + n;
  }
  const funnel = LEAD_STAGES.map((s) => ({
    stage: s,
    label: LEAD_STAGE_LABELS[s],
    count: countByStage[s] || 0,
    conversion_to_next: outByStage[s] ? Math.round(((nextByStage[s] || 0) / outByStage[s]) * 1000) / 10 : null,
    terminal: s === "rejected" || s === "converted",
  }));

  const stuck = await q<{ id: string; display_name: string; lead_stage: string; stay_days: string; owner_principal_id: string | null }>(`
    SELECT id, display_name, lead_stage,
      floor(extract(epoch FROM now() - updated_at)/86400)::text AS stay_days,
      owner_principal_id
    FROM kol_leads
    WHERE NOT is_archived AND lead_stage NOT IN ('rejected','converted') AND updated_at < now() - interval '14 days'
    ORDER BY updated_at ASC LIMIT 10
  `);

  const loss = await q<{ reason: string; rejected: string; archived: string }>(`
    SELECT reason, sum(rejected)::text AS rejected, sum(archived)::text AS archived FROM (
      SELECT '已拒绝（未填原因）' AS reason, 1 AS rejected, 0 AS archived FROM kol_leads WHERE lead_stage='rejected' AND NOT is_archived
      UNION ALL
      SELECT coalesce(nullif(archived_reason,''), '未填原因') AS reason, 0 AS rejected, 1 AS archived FROM kol_leads WHERE is_archived
    ) s GROUP BY reason ORDER BY sum(rejected)+sum(archived) DESC LIMIT 10
  `);

  const rules = await q<{ template_code: string; version: string; title: string; status: string }>(`
    SELECT template_code, version::text, title, status FROM work_order_templates
    WHERE template_code='kol_first_contact' AND status='published' ORDER BY version DESC LIMIT 1
  `);

  const audit = await q<{ actor_id: string | null; display_name: string; event_type: string; payload: unknown; occurred_at: string }>(`
    SELECT coalesce(e.actor_id, e.payload::jsonb->>'actor_id') AS actor_id, l.display_name, e.event_type, (e.payload::jsonb || jsonb_build_object('lead_id', l.id)) AS payload, e.occurred_at
    FROM business_events e JOIN kol_leads l ON l.id = e.object_id
    WHERE e.event_type IN ('lead.stage_changed','lead.archived') AND e.object_type='creator_candidate'
    ORDER BY e.occurred_at DESC LIMIT 8
  `);

  return c.json({
    kpis: {
      total: Number(kpis.total), active: Number(kpis.active), new_this_week: Number(kpis.new_week),
      converted_this_month: Number(kpis.converted_month),
      avg_stay_days: kpis.avg_stay == null ? null : Number(kpis.avg_stay),
      stuck_count: Number(kpis.stuck), conversion_rate: conversionRate,
    },
    funnel, stuck, loss,
    rules: {
      first_contact_template: rules[0] || null,
      converted_lock: { enabled: true, note: "代码约束：已转化线索不可回退阶段" },
    },
    audit: audit.map((a) => ({
      actor_id: a.actor_id, display_name: a.display_name, event_type: a.event_type,
      payload: a.payload, occurred_at: a.occurred_at,
    })),
    ...meta(),
  });
});

kolDashboards.get("/kol/admin/project-delivery", async (c) => {
  requireAdmin();

  const kpis = await q<{ active: string; exception_count: string; overdue_coops: string; pending_acceptance: string; done_week: string }>(`
    SELECT
      (SELECT count(*)::text FROM kol_cooperations WHERE ${ACTIVE_COOP_WHERE}) AS active,
      (SELECT count(*)::text FROM kol_cooperations WHERE archived_at IS NULL AND coop_stage='exception') AS exception_count,
      (SELECT count(DISTINCT w.coop_id)::text FROM work_orders w JOIN kol_cooperations c ON c.id=w.coop_id
        WHERE c.archived_at IS NULL AND c.coop_stage <> 'exception' AND w.coop_id IS NOT NULL AND w.due_at < now() AND w.status NOT IN ('completed','cancelled')) AS overdue_coops,
      (SELECT count(*)::text FROM work_orders WHERE coop_id IS NOT NULL AND status='ready_for_acceptance') AS pending_acceptance,
      (SELECT count(*)::text FROM kol_cooperations WHERE archived_at > now() - interval '7 days' AND coop_stage <> 'exception') AS done_week
  `).then((rows) => rows[0]!);

  const active = Number(kpis.active);
  const overdueCoops = Number(kpis.overdue_coops);

  // 异常队列：正式 exception 态（带 exception_kind），按停留时长排序
  const exceptions = await q<{
    id: string; title: string; exception_kind: string | null; owner_principal_id: string | null; stay_days: string;
  }>(`
    SELECT c.id, c.title, c.exception_kind, c.owner_principal_id,
      floor(extract(epoch FROM now() - c.updated_at)/86400)::text AS stay_days
    FROM kol_cooperations c
    WHERE c.archived_at IS NULL AND c.coop_stage='exception'
    ORDER BY c.updated_at ASC LIMIT 20
  `);

  const distribution = await q<{ coop_stage: string; n: string }>(`
    SELECT coop_stage, count(*)::text AS n FROM kol_cooperations
    WHERE ${ACTIVE_COOP_WHERE} GROUP BY coop_stage
  `);
  const distByStage = Object.fromEntries(distribution.map((r) => [r.coop_stage, Number(r.n)]));
  const stage_distribution = (COOP_STAGES as readonly string[]).map((s) => ({
    stage: s, label: COOP_STAGE_LABELS[s] || s, count: distByStage[s] || 0,
  }));

  const overdue = await q<{
    coop_id: string; coop_title: string; wo_id: string; wo_title: string;
    due_at: string; overdue_days: string; owner_principal_id: string | null;
  }>(`
    SELECT w.coop_id, c.title AS coop_title, w.id AS wo_id, w.title AS wo_title,
      w.due_at, floor(extract(epoch FROM now() - w.due_at)/86400)::text AS overdue_days,
      c.owner_principal_id
    FROM work_orders w JOIN kol_cooperations c ON c.id = w.coop_id
    WHERE w.coop_id IS NOT NULL AND w.due_at < now() AND w.status NOT IN ('completed','cancelled')
    ORDER BY w.due_at ASC LIMIT 20
  `);

  const pendingAcceptance = await q<{
    coop_id: string; coop_title: string; wo_id: string; wo_title: string; waiting_days: string;
  }>(`
    SELECT w.coop_id, c.title AS coop_title, w.id AS wo_id, w.title AS wo_title,
      floor(extract(epoch FROM now() - w.updated_at)/86400)::text AS waiting_days
    FROM work_orders w JOIN kol_cooperations c ON c.id = w.coop_id
    WHERE w.coop_id IS NOT NULL AND w.status='ready_for_acceptance'
    ORDER BY w.updated_at ASC LIMIT 20
  `);

  return c.json({
    kpis: {
      active, exception_count: Number(kpis.exception_count), overdue_count: overdueCoops,
      pending_acceptance: Number(kpis.pending_acceptance), completed_this_week: Number(kpis.done_week),
      on_time_rate: active > 0 ? Math.round(((active - overdueCoops) / active) * 1000) / 10 : null,
    },
    exceptions: exceptions.map((e) => ({
      id: e.id, title: e.title,
      exception_kind: e.exception_kind,
      exception_label: (e.exception_kind && EXCEPTION_KIND_LABELS[e.exception_kind]) || e.exception_kind || "异常",
      owner_principal_id: e.owner_principal_id, stay_days: Number(e.stay_days),
    })),
    stage_distribution, overdue, pending_acceptance: pendingAcceptance,
    ...meta(),
  });
});
