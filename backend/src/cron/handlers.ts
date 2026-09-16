/**
 * Explicit handler registry. No string-as-route.
 * Determined actions MUST NOT create thread/turn/session.
 * Forbidden: send mail, decrypt, confirm_stage write, owner/status formal write
 * except the BIZ-06 ownership-release path, business_approval submit,
 * discovery auto-follow, domestic crawler calls.
 */
import { getConn } from "../db.js";
import {
  evaluateOwnershipRelease,
  lastCorrespondenceAt,
  listOwnedCollaborations,
  ownershipReceiptMeta,
  releaseFollowOwnershipIfEligible,
} from "../gateway/ownership-release.js";
import { brandScope, collaborationInScope } from "../host/inbound-scope.js";
import { label } from "../stages.js";
import type { Json, Row } from "../types.js";
import type { AppUser } from "../auth.js";

export type CronHandlerKey = "overdue-scan" | "daily-task-snapshot" | "ownership-release" | "discovery-search";

export type CronHandlerResult = {
  status: "succeeded" | "skipped" | "failed" | "needs_takeover";
  error_code?: string;
  error_summary?: string;
  receipt: Json;
  artifact_refs?: Json;
};

export type CronHandlerContext = {
  job: Row;
  run: Row;
  actor: string;
  viewer?: AppUser;
  nowMs?: number;
};

export type CronHandler = (ctx: CronHandlerContext) => CronHandlerResult;

const TASK_BUCKETS: Record<string, string[]> = {
  greet: ["INITIAL_CONTACT"],
  follow: ["INTERESTED"],
  quote: ["QUOTE_PENDING"],
  negotiate: ["NEGOTIATING"],
};

const WORK_ITEM_BUCKETS: Record<string, string[]> = {
  greet: ["creator_outreach", "email_compose"],
  follow: ["lost_contact", "delay_followup"],
  quote: ["quote_confirm"],
  negotiate: ["creator_lifecycle_kanban"],
};

function parseJson(raw: unknown, fallback: Json = {}): Json {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Json;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function scopedRows(rows: Row[], viewer?: AppUser): Row[] {
  const brands = brandScope(viewer);
  if (!brands) return rows;
  return rows.filter((row) => collaborationInScope(row, viewer));
}

function overdueScan(ctx: CronHandlerContext): CronHandlerResult {
  const db = getConn();
  const rows = scopedRows(
    db.prepare(
      `SELECT id, handle, display_name, brand, stage_code, days_in_stage, overdue, owner_name
         FROM collaborations WHERE overdue = 1 ORDER BY days_in_stage DESC, handle`,
    ).all() as Row[],
    ctx.viewer,
  );
  const items = rows.map((row) => ({
    collaboration_id: row.id,
    handle: row.handle,
    display_name: row.display_name,
    brand: row.brand,
    stage_code: row.stage_code,
    stage_label: label(String(row.stage_code || "")),
    days_in_stage: Number(row.days_in_stage || 0),
    owner_name: row.owner_name || "",
  }));
  return {
    status: "succeeded",
    receipt: {
      handler_key: "overdue-scan",
      side_effect: "read",
      created_session: false,
      title: "失联与延期扫描",
      count: items.length,
      items,
    },
  };
}

function dailyTaskSnapshot(ctx: CronHandlerContext): CronHandlerResult {
  const db = getConn();
  const collabs = scopedRows(db.prepare("SELECT * FROM collaborations").all() as Row[], ctx.viewer);
  const buckets: Record<string, Json[]> = { greet: [], follow: [], quote: [], negotiate: [] };
  for (const [bucket, stages] of Object.entries(TASK_BUCKETS)) {
    for (const row of collabs) {
      if (!stages.includes(String(row.stage_code || ""))) continue;
      buckets[bucket].push({
        source: "collaboration",
        collaboration_id: row.id,
        handle: row.handle,
        brand: row.brand,
        stage_code: row.stage_code,
        stage_label: label(String(row.stage_code || "")),
        days_in_stage: Number(row.days_in_stage || 0),
      });
    }
  }

  const viewerId = ctx.viewer?.id;
  const workSql = viewerId
    ? "SELECT * FROM work_items WHERE status IN ('pending','waiting') AND owner_user_id=? ORDER BY updated_at DESC"
    : "SELECT * FROM work_items WHERE status IN ('pending','waiting') ORDER BY updated_at DESC";
  const workRows = (viewerId
    ? db.prepare(workSql).all(viewerId)
    : db.prepare(workSql).all()) as Row[];
  for (const [bucket, types] of Object.entries(WORK_ITEM_BUCKETS)) {
    for (const row of workRows) {
      const type = String(row.task_type || row.skill || "");
      if (!types.includes(type)) continue;
      buckets[bucket].push({
        source: "work_item",
        work_item_id: row.id,
        title: row.title,
        task_type: type,
        status: row.status,
        collaboration_id: row.collaboration_id || null,
      });
    }
  }

  return {
    status: "succeeded",
    receipt: {
      handler_key: "daily-task-snapshot",
      side_effect: "read",
      created_session: false,
      source: "local_collaborations_and_work_items",
      gap: "未调用远端 kolclaw.get_daily_tasks（NO LIVE）；用本地合作阶段 + 待办 work_items 做只读快照",
      counts: {
        greet: buckets.greet.length,
        follow: buckets.follow.length,
        quote: buckets.quote.length,
        negotiate: buckets.negotiate.length,
      },
      pending: buckets,
    },
  };
}

function ownershipRelease(ctx: CronHandlerContext): CronHandlerResult {
  const db = getConn();
  const candidates = scopedRows(listOwnedCollaborations(db), ctx.viewer);
  const released: Json[] = [];
  const skipped: Json[] = [];
  for (const row of candidates) {
    const lastAt = lastCorrespondenceAt(db, String(row.id));
    const preview = evaluateOwnershipRelease(row, lastAt, ctx.nowMs);
    if (preview.action === "skip") {
      skipped.push({
        collaboration_id: preview.collaboration_id,
        handle: row.handle,
        reason: preview.reason,
        detail: preview.detail,
      });
      continue;
    }
    const decision = releaseFollowOwnershipIfEligible({
      db,
      collaborationId: String(row.id),
      expectedOwner: preview.owner_before,
      expectedLastAt: lastAt || "",
      actor: ctx.actor,
      nowMs: ctx.nowMs,
    });
    if (decision.action === "release") {
      released.push({
        collaboration_id: decision.collaboration_id,
        handle: row.handle,
        owner_before: decision.owner_before,
        stage_unchanged: row.stage_code,
      });
    } else {
      skipped.push({
        collaboration_id: decision.collaboration_id,
        handle: row.handle,
        reason: decision.reason,
        detail: decision.detail,
      });
    }
  }
  return {
    status: released.length ? "succeeded" : "skipped",
    receipt: {
      handler_key: "ownership-release",
      side_effect: "ownership_release_only",
      created_session: false,
      ...ownershipReceiptMeta(),
      released_count: released.length,
      skipped_count: skipped.length,
      released,
      skipped,
    },
  };
}

function discoverySearch(): CronHandlerResult {
  return {
    status: "skipped",
    error_code: "not_enabled",
    error_summary: "发现搜索未启用：禁止从定时作业调用采集器，也不伪造运行结果",
    receipt: {
      handler_key: "discovery-search",
      side_effect: "none",
      created_session: false,
      enabled: false,
      wrote_candidates: false,
      created_collaboration: false,
      called_crawler: false,
      reason: "not_enabled",
    },
  };
}

export const CRON_HANDLERS: Record<CronHandlerKey, CronHandler> = {
  "overdue-scan": overdueScan,
  "daily-task-snapshot": dailyTaskSnapshot,
  "ownership-release": ownershipRelease,
  "discovery-search": discoverySearch,
};

export function cronHandler(key: string): CronHandler | undefined {
  return CRON_HANDLERS[key as CronHandlerKey];
}

export function isCronHandlerKey(key: string): key is CronHandlerKey {
  return Object.prototype.hasOwnProperty.call(CRON_HANDLERS, key);
}

export function handlerContract(key: string): Json {
  const contracts: Record<string, Json> = {
    "overdue-scan": {
      title: "失联与延期扫描",
      execute_as: "system",
      side_effect: "read",
      skill: "risk_scan",
      connector: "starrykol/starry read",
      creates_session: false,
    },
    "daily-task-snapshot": {
      title: "每日待办快照",
      execute_as: "system",
      side_effect: "read",
      skill: "creator_daily_tasks",
      connector: "starrykol/starry read",
      creates_session: false,
    },
    "ownership-release": {
      title: "14 天无互动回公海",
      execute_as: "system",
      side_effect: "ownership_release_only",
      skill: null,
      creates_session: false,
    },
    "discovery-search": {
      title: "发现搜索",
      execute_as: "system",
      side_effect: "none",
      enabled: false,
      creates_session: false,
    },
  };
  return contracts[key] || { title: key, creates_session: false };
}

export function parseJobJson(job: Row): { scope: Json; condition: Json; retry: Json; takeover: Json } {
  return {
    scope: parseJson(job.scope_json),
    condition: parseJson(job.condition_json),
    retry: parseJson(job.retry_policy_json, { max_attempts: 1 }),
    takeover: parseJson(job.takeover_policy_json, { after_minutes: 30 }),
  };
}
