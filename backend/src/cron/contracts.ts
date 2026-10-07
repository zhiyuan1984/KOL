import { humanFrequency } from "./schedule.js";
import { handlerContract, isCronHandlerKey } from "./handlers.js";
import { HttpFail } from "../host/errors.js";
import type { Json, Row } from "../types.js";

export const SYSTEM_EXECUTE_AS = "system";
export const DEFAULT_EXPERT = "expert:kol";

/** 发现搜索的系统模板：由管理员在定时任务上配置（PATCH condition.system_template），
 *  前端模板编辑 UI 另案叠加。本次后端接口已支持。 */
export type DiscoverySystemTemplate = {
  platform: string;
  keywords: string[];
  filters: Json;
  dedup: { dedup_by: string };
};

const TEMPLATE_PLATFORMS = ["youtube", "instagram", "facebook"];

export const DEFAULT_DISCOVERY_SYSTEM_TEMPLATE: DiscoverySystemTemplate = {
  platform: "youtube",
  keywords: [],
  filters: {},
  dedup: { dedup_by: "platform_creator_id" },
};

/** 校验并规整系统发现模板。keywords 为空合法（handler 届时如实 skipped，不伪造运行）。 */
export function normalizeSystemTemplate(value: unknown): DiscoverySystemTemplate {
  const raw =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const platform = String(raw.platform || DEFAULT_DISCOVERY_SYSTEM_TEMPLATE.platform).toLowerCase();
  if (!TEMPLATE_PLATFORMS.includes(platform)) {
    throw new HttpFail(400, {
      code: "invalid_template_platform",
      message: "系统发现模板的平台仅支持 youtube / instagram / facebook",
    });
  }
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 20)
    : [];
  const filtersRaw =
    raw.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters)
      ? (raw.filters as Record<string, unknown>)
      : {};
  // 采集参数白名单之外的过滤项（地域、粉丝阈值等）是采集后的筛选口径，不在此配置。
  const unsupported = Object.keys(filtersRaw).find((key) => key !== "max_notes_count");
  if (unsupported) {
    throw new HttpFail(400, {
      code: "invalid_template_filter",
      message: `系统发现模板不支持过滤项：${unsupported}`,
    });
  }
  const maxNotes = filtersRaw.max_notes_count;
  if (
    maxNotes !== undefined &&
    (!Number.isSafeInteger(maxNotes) || Number(maxNotes) < 1 || Number(maxNotes) > 10000)
  ) {
    throw new HttpFail(400, { code: "invalid_template_filter", message: "max_notes_count 须为 1–10000 的整数" });
  }
  const dedupRaw =
    raw.dedup && typeof raw.dedup === "object" && !Array.isArray(raw.dedup)
      ? (raw.dedup as Record<string, unknown>)
      : {};
  return {
    platform,
    keywords,
    filters: maxNotes !== undefined ? { max_notes_count: maxNotes } : {},
    dedup: { dedup_by: String(dedupRaw.dedup_by || "platform_creator_id") },
  };
}

/** 系统作业种子。discovery-search 可发布（ADR-2026-10-08 废除「禁止从定时作业调用采集器」）；
 *  种子默认 disabled：管理员配置好 system_template.keywords 后再发布启用。 */
export const SYSTEM_JOBS: Array<{
  id: string;
  job_key: string;
  title: string;
  handler_key: string;
  cron_expr: string;
  status: "published" | "disabled";
  scope: Json;
  condition: Json;
}> = [
  { id: "cjob_overdue_scan", job_key: "overdue-scan", title: "失联与延期扫描", handler_key: "overdue-scan", cron_expr: "0 8 * * *", status: "published", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { overdue: true } },
  { id: "cjob_daily_task_snapshot", job_key: "daily-task-snapshot", title: "每日待办快照", handler_key: "daily-task-snapshot", cron_expr: "15 7 * * *", status: "published", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { buckets: ["greet", "follow", "quote", "negotiate"] } },
  { id: "cjob_ownership_release", job_key: "ownership-release", title: "14 天无互动回公海", handler_key: "ownership-release", cron_expr: "30 3 * * *", status: "disabled", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { idle_days: 14, require_correspondence_timestamp: true, enabled: false, reason: "postgres_repository_pending" } },
  { id: "cjob_discovery_search", job_key: "discovery-search", title: "发现搜索", handler_key: "discovery-search", cron_expr: "0 6 * * *", status: "disabled", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { system_template: { platform: "youtube", keywords: [], filters: {}, dedup: { dedup_by: "platform_creator_id" } } } },
  { id: "cjob_mail_memory_increment", job_key: "mail-memory-increment", title: "邮件记忆增量", handler_key: "mail-memory-increment", cron_expr: "*/10 * * * *", status: "disabled", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { memory_kinds: ["translation", "summary", "digest", "person_digest"], enabled: false, reason: "postgres_repository_pending" } },
];

const DEFAULT_RETRY: Json = { max_attempts: 1, backoff_sec: 0 };
const DEFAULT_TAKEOVER: Json = { after_minutes: 30, action: "needs_takeover" };

export function cronJson(raw: unknown, fallback: Json = {}): Json {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Json;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function frequencyOf(job: Row, schedule?: Json): string {
  const kind = String(schedule?.kind || job.schedule_kind || "");
  if (kind === "once") return `单次 · ${String(schedule?.once_at || job.once_at || "")}`;
  if (kind === "interval") return `每隔 ${String(schedule?.interval_minutes || job.interval_minutes || "?")} 分钟`;
  return humanFrequency(String(job.cron_expr), String(job.timezone || "Asia/Shanghai"));
}

export function cronSystemJob(job: Row): boolean {
  return job.owner_account_id == null || job.owner_account_id === "" || String(job.execute_as) === SYSTEM_EXECUTE_AS;
}

export function cronPublicJobSummary(job: Row): Json {
  const schedule = job.condition_json ? cronJson(job.condition_json).schedule as Json | undefined : undefined;
  return {
    id: job.id, job_key: job.job_key, title: job.title, handler_key: job.handler_key, status: job.status,
    active_run_status: job.active_run_status || null, enabled: String(job.status) !== "disabled",
    system: cronSystemJob(job), legal_fields_readonly: cronSystemJob(job),
    execute_identity: cronSystemJob(job) ? "系统（平台已发布）" : "我",
    frequency: frequencyOf(job, schedule), timezone: job.timezone, next_run_at: job.next_run_at || null,
    last_run_at: job.last_run_at || null, last_terminal_status: job.last_terminal_status || null,
  };
}

export function cronPublicJob(job: Row): Json {
  const scope = cronJson(job.scope_json);
  const condition = cronJson(job.condition_json);
  const retry = cronJson(job.retry_policy_json, DEFAULT_RETRY);
  const takeover = cronJson(job.takeover_policy_json, DEFAULT_TAKEOVER);
  const handler = String(job.handler_key);
  return {
    id: job.id, job_key: job.job_key, title: job.title, owner_account_id: job.owner_account_id || null,
    execute_as: job.execute_as, execute_identity: cronSystemJob(job) ? "系统（平台已发布）" : "我",
    capability_expert_id: job.capability_expert_id || DEFAULT_EXPERT, handler_key: handler, handler: handlerContract(handler),
    scope, condition, cron_expr: job.cron_expr, timezone: job.timezone, frequency: frequencyOf(job, condition.schedule as Json | undefined),
    status: job.status, enabled: String(job.status) !== "disabled" && condition.enabled !== false,
    retry_policy: retry, takeover_policy: takeover, published_rev: Number(job.published_rev || 1),
    next_run_at: job.next_run_at || null, last_run_at: job.last_run_at || null,
    last_terminal_status: job.last_terminal_status || null, system: cronSystemJob(job), legal_fields_readonly: cronSystemJob(job),
  };
}

export function cronPublicRun(run: Row): Json {
  return {
    id: run.id, job_id: run.job_id, trigger: run.trigger, status: run.status, scheduled_for: run.scheduled_for,
    started_at: run.started_at || null, finished_at: run.finished_at || null, error_code: run.error_code || null,
    error_summary: run.error_summary || null, receipt: cronJson(run.receipt_json, {}),
    artifact_refs: run.artifact_refs ? cronJson(run.artifact_refs, {}) : null, session_id: run.session_id || null, created_at: run.created_at,
  };
}

export function assertRegisteredCronHandler(handlerKey: string): void {
  if (!isCronHandlerKey(handlerKey)) throw new Error(`unknown handler_key: ${handlerKey}`);
}
