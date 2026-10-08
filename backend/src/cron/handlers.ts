/**
 * Explicit handler registry. Cron execution state and read models are
 * PostgreSQL-native. A handler must never quietly reach the legacy SQLite
 * compatibility layer: work whose business repository is not migrated is
 * represented as a governed `needs_takeover` result instead.
 */
import { postgresPool } from "../postgres/pool.js";
import { label } from "../stages.js";
import type { TicketPrincipal } from "../ticket-domain/auth.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "../host/errors.js";
import { enqueueSystemCrawl } from "../crawl/runtime-gates.js";
import { cronJson, normalizeSystemTemplate } from "./contracts.js";

export type CronHandlerKey = "overdue-scan" | "daily-task-snapshot" | "ownership-release" | "discovery-search" | "mail-memory-increment" | "ai-task" | "kol-deadline-sweep" | "kol-mail-reply-scan";

export type CronHandlerResult = {
  status: "succeeded" | "skipped" | "failed" | "needs_takeover";
  error_code?: string;
  error_summary?: string;
  receipt: Json;
  artifact_refs?: Json;
  session_id?: string;
};

export type CronHandlerContext = {
  job: Row;
  run: Row;
  actor: string;
  viewer?: TicketPrincipal;
  nowMs?: number;
};

export type CronHandler = (ctx: CronHandlerContext) => CronHandlerResult | Promise<CronHandlerResult>;

const TASK_BUCKETS: Record<string, string[]> = {
  greet: ["INITIAL_CONTACT"],
  follow: ["INTERESTED"],
  quote: ["QUOTE_PENDING"],
  negotiate: ["NEGOTIATING"],
};

function formalTicketScope(viewer?: TicketPrincipal): { where: string; values: string[] } {
  const base = "t.task_type='manual_ticket' AND t.profile='ticket-workbench'";
  if (!viewer?.id) return { where: base, values: [] };
  return {
    where: `${base} AND (t.owner_user_id=$1 OR EXISTS (
      SELECT 1 FROM ticket_assignments ta WHERE ta.ticket_id=t.id AND ta.status='active' AND ta.assignee_user_id=$1
    ) OR EXISTS (
      SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.status='active' AND tw.watcher_user_id=$1
    ))`,
    values: [viewer.id],
  };
}

/** Native formal-ticket overdue scan. It deliberately reports only persisted
 * ticket facts; it does not fabricate a collaboration or remote-mail state. */
async function overdueScan(ctx: CronHandlerContext): Promise<CronHandlerResult> {
  const scope = formalTicketScope(ctx.viewer);
  const rows = await postgresPool().query<Row>(
    `SELECT t.id,t.title,t.status,t.priority,t.due_at,t.business_category,t.stage_code,t.owner_user_id,
            pa.assignee_user_id,pa.assignee_person_ref
       FROM tickets t
       LEFT JOIN LATERAL (
         SELECT assignee_user_id,assignee_person_ref FROM ticket_assignments
          WHERE ticket_id=t.id AND role='primary' AND status='active' ORDER BY assignment_version DESC LIMIT 1
       ) pa ON true
      WHERE ${scope.where} AND NULLIF(t.due_at,'')::timestamptz < now()
        AND t.status NOT IN ('completed','cancelled','failed')
      ORDER BY NULLIF(t.due_at,'')::timestamptz ASC,t.id`,
    scope.values,
  );
  const items = rows.rows.map((row) => ({
    ticket_id: String(row.id), title: String(row.title), status: String(row.status), priority: String(row.priority || "normal"),
    due_at: row.due_at || null, business_category: row.business_category || null, stage_code: row.stage_code || null,
    stage_label: label(String(row.stage_code || "")), owner_user_id: String(row.owner_user_id),
    assignee_user_id: row.assignee_user_id || null, assignee_person_ref: row.assignee_person_ref || null,
  }));
  return {
    status: "succeeded",
    receipt: {
      handler_key: "overdue-scan", side_effect: "read", created_session: false,
      source: "postgresql_formal_tickets", count: items.length, items,
    },
  };
}

/** Native formal-ticket snapshot. Buckets are a transparent stage projection,
 * not a claim that remote collaboration or mail data was refreshed. */
async function dailyTaskSnapshot(ctx: CronHandlerContext): Promise<CronHandlerResult> {
  const scope = formalTicketScope(ctx.viewer);
  const rows = await postgresPool().query<Row>(
    `SELECT t.id,t.title,t.status,t.priority,t.business_category,t.stage_code,t.due_at,t.updated_at,
            pa.assignee_user_id,pa.assignee_person_ref
       FROM tickets t
       LEFT JOIN LATERAL (
         SELECT assignee_user_id,assignee_person_ref FROM ticket_assignments
          WHERE ticket_id=t.id AND role='primary' AND status='active' ORDER BY assignment_version DESC LIMIT 1
       ) pa ON true
      WHERE ${scope.where} AND t.status IN ('pending','accepted','in_progress','waiting','waiting_approval')
      ORDER BY t.updated_at DESC,t.id`,
    scope.values,
  );
  const buckets: Record<string, Json[]> = { greet: [], follow: [], quote: [], negotiate: [] };
  for (const row of rows.rows) {
    const stage = String(row.stage_code || "");
    const bucket = Object.entries(TASK_BUCKETS).find(([, stages]) => stages.includes(stage))?.[0];
    if (!bucket) continue;
    buckets[bucket].push({
      source: "formal_ticket", ticket_id: String(row.id), title: String(row.title), status: String(row.status),
      priority: String(row.priority || "normal"), business_category: row.business_category || null,
      stage_code: row.stage_code || null, stage_label: label(stage), due_at: row.due_at || null,
      updated_at: row.updated_at, assignee_user_id: row.assignee_user_id || null,
      assignee_person_ref: row.assignee_person_ref || null,
    });
  }
  return {
    status: "succeeded",
    receipt: {
      handler_key: "daily-task-snapshot", side_effect: "read", created_session: false,
      source: "postgresql_formal_tickets", gap: "仅投影 PostgreSQL 正式工单；远端协作/邮件数据未在本处理器中读取。",
      counts: Object.fromEntries(Object.entries(buckets).map(([key, items]) => [key, items.length])), pending: buckets,
    },
  };
}

function migrationTakeover(handlerKey: CronHandlerKey, title: string): CronHandlerResult {
  return {
    status: "needs_takeover",
    error_code: "postgres_handler_dependency_not_migrated",
    error_summary: `${title}依赖的业务仓储尚未完成 PostgreSQL 原生迁移，已阻止旧数据库兼容路径执行。`,
    receipt: {
      handler_key: handlerKey, title, side_effect: "none", created_session: false,
      migration_state: "blocked_pending_native_repository",
    },
  };
}

function ownershipRelease(): CronHandlerResult { return migrationTakeover("ownership-release", "14 天无互动回公海"); }
function mailMemoryIncrement(): CronHandlerResult { return migrationTakeover("mail-memory-increment", "邮件记忆增量"); }
function aiTask(): CronHandlerResult { return migrationTakeover("ai-task", "AI 定时任务"); }

/**
 * 发现搜索（ADR-2026-10-08）：按系统模板生成一次采集需求，写入 PG 采集排队。
 * - 只产候选：绝不自动创建 Collaboration、不做排他认领（BIZ-05 铁律）；
 * - 不抢占：只入队，启动由 drainCrawlQueue 按 FIFO 决定；
 * - 回执诚实：模板未配置 / 队列满 / 采集能力不可用时记 skipped 并写明原因，不伪造运行。
 */
async function discoverySearch(ctx: CronHandlerContext): Promise<CronHandlerResult> {
  const condition = cronJson(ctx.job.condition_json);
  const template = normalizeSystemTemplate(condition.system_template);
  if (!template.keywords.length) {
    return {
      status: "skipped",
      error_code: "template_not_configured",
      error_summary: "系统发现模板未配置关键词，本次未提交采集。",
      receipt: {
        handler_key: "discovery-search", side_effect: "none", created_session: false,
        wrote_candidates: false, created_collaboration: false, called_crawler: false,
        reason: "template_not_configured",
      },
    };
  }
  try {
    const enqueued = await enqueueSystemCrawl({
      platform: template.platform,
      keywords: template.keywords,
      filters: template.filters,
      cronJobId: String(ctx.job.id),
      cronRunId: String(ctx.run.id),
    });
    return {
      status: "succeeded",
      receipt: {
        handler_key: "discovery-search", side_effect: "enqueue", created_session: false,
        crawl_job_id: enqueued.crawlJobId, queue_position: enqueued.queuePosition,
        duplicate: enqueued.duplicate,
        wrote_candidates: false, created_collaboration: false, called_crawler: true,
        note: "采集需求已进入 PG 采集排队；候选由采集流水线回填，不自动创建合作或认领。",
      },
    };
  } catch (error) {
    const code = String((error as { detail?: { code?: string } })?.detail?.code || "");
    if (
      code === "crawl_queue_full" ||
      code === "crawl_capability_unavailable" ||
      code === "runtime_connector_disabled" ||
      code === "runtime_connector_not_configured"
    ) {
      const summary =
        code === "crawl_queue_full"
          ? "采集排队已满（20），本次未提交；不抢占已有任务。"
          : "采集能力不可用（MediaCrawler 连接器未配置或未启用），本次未提交。";
      return {
        status: "skipped",
        error_code: code,
        error_summary: summary,
        receipt: {
          handler_key: "discovery-search", side_effect: "none", created_session: false,
          wrote_candidates: false, created_collaboration: false, called_crawler: false,
          reason: code,
        },
      };
    }
    throw error;
  }
}

export const CRON_HANDLERS: Record<CronHandlerKey, CronHandler> = {
  "overdue-scan": overdueScan,
  "daily-task-snapshot": dailyTaskSnapshot,
  "ownership-release": ownershipRelease,
  "discovery-search": discoverySearch,
  "mail-memory-increment": mailMemoryIncrement,
  "ai-task": aiTask,
  "kol-deadline-sweep": kolDeadlineSweep,
  "kol-mail-reply-scan": kolMailReplyScan,
};

/** KOL 工单 deadline 自动生产者：扫描逾期/临近的拍摄与结算工单，以及已发布未结算的项目，
 * 在对应 Task 上写入已核验业务事件（verified-event → Jev → 执行队列）。PG-only。 */
async function kolDeadlineSweep(): Promise<CronHandlerResult> {
  const { sweepKolDeadlines } = await import("../ticket-domain/kol-deadline-sweep.js");
  const result = await sweepKolDeadlines();
  return {
    status: "succeeded",
    receipt: {
      handler_key: "kol-deadline-sweep", side_effect: "write", created_session: false,
      source: "postgresql_work_orders+kol_cooperations",
      scanned: result.scanned, emitted: result.emitted.length,
      events: result.emitted.map((e) => ({ kind: e.kind, ref_id: e.ref_id, event_type: e.event_type })),
    },
  };
}

/** 邮件回复自动检测：inbound 邮件 → 线索匹配 → lead.reply_received 事件（PG-only）。 */
async function kolMailReplyScan(): Promise<CronHandlerResult> {
  const { scanMailReplies } = await import("../ticket-domain/kol-mail-reply-scan.js");
  const result = await scanMailReplies();
  return {
    status: "succeeded",
    receipt: {
      handler_key: "kol-mail-reply-scan", side_effect: "write", created_session: false,
      source: "postgresql_kol_mail_items+kol_leads",
      scanned: result.scanned, emitted: result.emitted.length, skipped: result.skipped.length,
      events: result.emitted.map((e) => ({ item_id: e.item_id, lead_id: e.lead_id, event_type: e.event_type })),
      skipped_reasons: result.skipped.map((e) => ({ item_id: e.item_id, reason: e.skipped_reason })),
    },
  };
}

export function cronHandler(key: string): CronHandler | undefined { return CRON_HANDLERS[key as CronHandlerKey]; }
export function isCronHandlerKey(key: string): key is CronHandlerKey { return Object.prototype.hasOwnProperty.call(CRON_HANDLERS, key); }

export function handlerContract(key: string): Json {
  const contracts: Record<string, Json> = {
    "ai-task": { title: "AI 定时任务", execute_as: "owner", side_effect: "none", migration_state: "blocked_pending_native_repository", creates_session: false },
    "overdue-scan": { title: "失联与延期扫描", execute_as: "system", side_effect: "read", source: "postgresql_formal_tickets", creates_session: false },
    "daily-task-snapshot": { title: "每日待办快照", execute_as: "system", side_effect: "read", source: "postgresql_formal_tickets", creates_session: false },
    "ownership-release": { title: "14 天无互动回公海", execute_as: "system", side_effect: "none", migration_state: "blocked_pending_native_repository", creates_session: false },
    "discovery-search": { title: "发现搜索", execute_as: "system", side_effect: "enqueue", source: "system_template", creates_session: false },
    "mail-memory-increment": { title: "邮件记忆增量", execute_as: "system", side_effect: "none", migration_state: "blocked_pending_native_repository", creates_session: false },
    "kol-deadline-sweep": { title: "KOL 工单 deadline 扫描", execute_as: "task_owner", side_effect: "write", source: "postgresql_work_orders+kol_cooperations", creates_session: false },
    "kol-mail-reply-scan": { title: "邮件回复自动检测", execute_as: "lead_owner", side_effect: "write", source: "postgresql_kol_mail_items+kol_leads", creates_session: false },
  };
  return contracts[key] || { title: key, creates_session: false };
}
