import { getConn, nowIso, type SqliteConn } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { humanFrequency, nextRunAt } from "./schedule.js";
import { handlerContract, isCronHandlerKey } from "./handlers.js";

export const SYSTEM_EXECUTE_AS = "system";
export const DEFAULT_EXPERT = "expert:kol";

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
  {
    id: "cjob_overdue_scan",
    job_key: "overdue-scan",
    title: "失联与延期扫描",
    handler_key: "overdue-scan",
    cron_expr: "0 8 * * *",
    status: "published",
    scope: { applies: "employee_authorized", label: "适用于我的授权范围" },
    condition: { overdue: true },
  },
  {
    id: "cjob_daily_task_snapshot",
    job_key: "daily-task-snapshot",
    title: "每日待办快照",
    handler_key: "daily-task-snapshot",
    cron_expr: "15 7 * * *",
    status: "published",
    scope: { applies: "employee_authorized", label: "适用于我的授权范围" },
    condition: { buckets: ["greet", "follow", "quote", "negotiate"] },
  },
  {
    id: "cjob_ownership_release",
    job_key: "ownership-release",
    title: "14 天无互动回公海",
    handler_key: "ownership-release",
    cron_expr: "30 3 * * *",
    status: "published",
    scope: { applies: "employee_authorized", label: "适用于我的授权范围" },
    condition: { idle_days: 14, require_correspondence_timestamp: true },
  },
  {
    id: "cjob_discovery_search",
    job_key: "discovery-search",
    title: "发现搜索",
    handler_key: "discovery-search",
    cron_expr: "0 6 * * *",
    status: "disabled",
    scope: { applies: "employee_authorized", label: "适用于我的授权范围" },
    condition: { enabled: false, reason: "not_enabled_no_live_crawler" },
  },
  {
    id: "cjob_mail_memory_increment",
    job_key: "mail-memory-increment",
    title: "邮件记忆增量",
    handler_key: "mail-memory-increment",
    cron_expr: "*/10 * * * *",
    status: "published",
    scope: { applies: "employee_authorized", label: "适用于我的授权范围" },
    condition: { memory_kinds: ["translation", "summary", "digest", "person_digest"] },
  },
];

const DEFAULT_RETRY = { max_attempts: 1, backoff_sec: 0 };
const DEFAULT_TAKEOVER = { after_minutes: 30, action: "needs_takeover" };

function parseJson(raw: unknown, fallback: Json = {}): Json {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Json;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

export function ensureSystemCronJobs(db: SqliteConn = getConn(), from = new Date()): void {
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cron_jobs
     (id,job_key,title,owner_account_id,execute_as,capability_expert_id,handler_key,
      scope_json,condition_json,cron_expr,timezone,status,retry_policy_json,takeover_policy_json,
      published_rev,next_run_at,last_run_at,last_terminal_status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const job of SYSTEM_JOBS) {
    const next = job.status === "published" ? nextRunAt(job.cron_expr, "Asia/Shanghai", from).toISOString() : null;
    insert.run(
      job.id,
      job.job_key,
      job.title,
      null,
      SYSTEM_EXECUTE_AS,
      DEFAULT_EXPERT,
      job.handler_key,
      JSON.stringify(job.scope),
      JSON.stringify(job.condition),
      job.cron_expr,
      "Asia/Shanghai",
      job.status,
      JSON.stringify(DEFAULT_RETRY),
      JSON.stringify(DEFAULT_TAKEOVER),
      1,
      next,
      null,
      null,
      now,
      now,
    );
  }
}

export function jobById(id: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM cron_jobs WHERE id=? OR job_key=?").get(id, id) as Row | undefined;
}

export function jobByKey(jobKey: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM cron_jobs WHERE job_key=?").get(jobKey) as Row | undefined;
}

export function listJobs(db: SqliteConn = getConn()): Row[] {
  return db.prepare("SELECT * FROM cron_jobs ORDER BY title").all() as Row[];
}

export function listRuns(jobId: string, limit = 50, db: SqliteConn = getConn()): Row[] {
  return db.prepare(
    "SELECT * FROM cron_runs WHERE job_id=? ORDER BY created_at DESC LIMIT ?",
  ).all(jobId, limit) as Row[];
}

export function runById(runId: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM cron_runs WHERE id=?").get(runId) as Row | undefined;
}

export function isSystemJob(job: Row): boolean {
  return job.owner_account_id == null || job.owner_account_id === "" || String(job.execute_as) === SYSTEM_EXECUTE_AS;
}

export function newJobId(): string {
  return nid("cjob");
}

export function newRunId(): string {
  return nid("crun");
}

export function publicJob(job: Row): Json {
  const scope = parseJson(job.scope_json);
  const condition = parseJson(job.condition_json);
  const retry = parseJson(job.retry_policy_json, DEFAULT_RETRY);
  const takeover = parseJson(job.takeover_policy_json, DEFAULT_TAKEOVER);
  const handler = String(job.handler_key);
  const enabled = String(job.status) !== "disabled" && condition.enabled !== false;
  return {
    id: job.id,
    job_key: job.job_key,
    title: job.title,
    owner_account_id: job.owner_account_id || null,
    execute_as: job.execute_as,
    execute_identity: isSystemJob(job) ? "系统（平台已发布）" : "我",
    capability_expert_id: job.capability_expert_id || DEFAULT_EXPERT,
    handler_key: handler,
    handler: handlerContract(handler),
    scope,
    condition,
    cron_expr: job.cron_expr,
    timezone: job.timezone,
    frequency: humanFrequency(String(job.cron_expr), String(job.timezone || "Asia/Shanghai")),
    status: job.status,
    enabled,
    retry_policy: retry,
    takeover_policy: takeover,
    published_rev: Number(job.published_rev || 1),
    next_run_at: job.next_run_at || null,
    last_run_at: job.last_run_at || null,
    last_terminal_status: job.last_terminal_status || null,
    system: isSystemJob(job),
    legal_fields_readonly: isSystemJob(job),
  };
}

export function publicRun(run: Row): Json {
  return {
    id: run.id,
    job_id: run.job_id,
    trigger: run.trigger,
    status: run.status,
    scheduled_for: run.scheduled_for,
    started_at: run.started_at || null,
    finished_at: run.finished_at || null,
    error_code: run.error_code || null,
    error_summary: run.error_summary || null,
    receipt: parseJson(run.receipt_json, {}),
    artifact_refs: run.artifact_refs ? parseJson(run.artifact_refs, {}) : null,
    session_id: run.session_id || null,
    created_at: run.created_at,
  };
}

export function assertRegisteredHandler(handlerKey: string): void {
  if (!isCronHandlerKey(handlerKey)) {
    throw new Error(`unknown handler_key: ${handlerKey}`);
  }
}
