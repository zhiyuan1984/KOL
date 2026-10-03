import { humanFrequency } from "./schedule.js";
import { handlerContract, isCronHandlerKey } from "./handlers.js";
import type { Json, Row } from "../types.js";

export const SYSTEM_EXECUTE_AS = "system";
export const DEFAULT_EXPERT = "expert:kol";

/** Only PostgreSQL-native read-only system jobs remain publishable by default.
 * Business writers stay disabled until their domain repository is migrated. */
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
  { id: "cjob_discovery_search", job_key: "discovery-search", title: "发现搜索", handler_key: "discovery-search", cron_expr: "0 6 * * *", status: "disabled", scope: { applies: "employee_authorized", label: "适用于我的授权范围" }, condition: { enabled: false, reason: "not_enabled_no_live_crawler" } },
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
