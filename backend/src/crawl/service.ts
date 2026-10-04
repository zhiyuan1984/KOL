import { ingestMediacrawler } from "../adapters/claw.js";
import { createMediaCrawlerClient, mediaCrawlerConfigured } from "./managed-connection.js";
import { getConn, isSqliteClosedError, isSqliteForeignKeyError, nowIso, onConnReset, tx } from "../db.js";
import {
  CRAWL_ACTIVE_MESSAGE,
  collectorFailureCode,
  persistableEmployeeError,
  sanitizeSecret,
} from "../discovery-errors.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { appendTaskEvent } from "../task-events.js";
import type { Json, Row } from "../types.js";
import { CRAWL_PLATFORM_SET } from "./platforms.js";
import { rejectDiscoveryHarnessTool } from "../gateway/discovery-harness.js";

const MODES = new Set(["search", "detail", "creator"]);
const ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
const monitors = new Map<string, ReturnType<typeof setTimeout>>();
/** Poll count per job, for the monitor backoff. Reset when a job settles. */
const monitorAttempts = new Map<string, number>();
let clientFactory: () => Pick<RemoteMcpClient, "callTool" | "close"> = () => createMediaCrawlerClient();
/** Discovery (and other hosts) subscribe to crawl settle without importing crawl internals. */
export function onCrawlJobSettled(handler: (job: Row) => void): void {
  const bucket = settleBucket();
  if (!bucket.includes(handler)) bucket.push(handler);
}

function settleBucket(): Array<(job: Row) => void> {
  const fn = onCrawlJobSettled as typeof onCrawlJobSettled & { handlers?: Array<(job: Row) => void> };
  if (!fn.handlers) fn.handlers = [];
  return fn.handlers;
}

function notifySettled(jobId: string): void {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) return;
  for (const handler of settleBucket()) {
    try {
      handler(job);
    } catch {
      // Subscribers must not fail the crawl job itself.
    }
  }
}

function clearMonitors(): void {
  for (const timer of monitors.values()) clearTimeout(timer);
  monitors.clear();
  monitorAttempts.clear();
}

onConnReset(clearMonitors);

export function setCrawlMcpClientFactory(
  factory?: () => Pick<RemoteMcpClient, "callTool" | "close">,
): void {
  clientFactory = factory || (() => createMediaCrawlerClient());
}

function json(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  return {};
}

function parse(value: unknown): Json {
  try {
    return json(JSON.parse(String(value || "{}")));
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitize(value: unknown): string {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***")
    .slice(0, 1000);
}

function publicJob(row: Row): Json {
  const artifact = String(row.status) === "result_ready"
    ? getConn().prepare(
        `SELECT payload FROM task_artifacts
          WHERE work_item_id=? AND artifact_type='task_result_card'
          ORDER BY created_at DESC LIMIT 1`,
      ).get(row.work_item_id) as { payload?: string } | undefined
    : undefined;
  return {
    ...row,
    parameters: parse(row.parameters),
    error: row.error ? sanitize(row.error) : null,
    ...(artifact?.payload ? { result: parse(artifact.payload) } : {}),
  };
}

function validateInput(platform: string, mode: string, parameters: Json): void {
  if (!CRAWL_PLATFORM_SET.has(platform)) {
    throw new HttpFail(400, { code: "invalid_crawl_platform", message: "采集平台不正确。" });
  }
  if (!MODES.has(mode)) {
    throw new HttpFail(400, { code: "invalid_crawl_mode", message: "采集方式不正确。" });
  }
  const required = mode === "search" ? "keywords" : mode === "detail" ? "specified_ids" : "creator_ids";
  const value = parameters[required];
  if (!(typeof value === "string" && value.trim()) && !(Array.isArray(value) && value.length)) {
    throw new HttpFail(400, `启动采集前需要补充${required === "keywords" ? "关键词" : required === "specified_ids" ? "内容编号" : "创作者编号"}`);
  }
}

function event(jobId: string, eventType: string, status: string, summary: unknown, payload: Json = {}): void {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) return;
  const safe = sanitize(summary);
  tx((db) => {
    const current = db.prepare(
      "SELECT COALESCE(MAX(sequence),0) AS sequence FROM crawl_job_events WHERE crawl_job_id=?",
    ).get(jobId) as { sequence: number };
    db.prepare(
      `INSERT INTO crawl_job_events
       (id,crawl_job_id,sequence,event_type,status,summary,payload,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      nid("cev"), jobId, Number(current.sequence) + 1, eventType, status, safe,
      JSON.stringify(payload), nowIso(),
    );
  });
  appendTaskEvent(
    String(job.work_item_id), null, `crawl.${eventType}`, safe || eventType, status,
    safe,
  );
}

const REMOTE_OPERATION_LABELS: Record<string, string> = {
  start_crawl: "启动远程采集",
  get_crawl_status: "查询远程采集状态",
  get_crawl_logs: "读取远程采集日志",
  get_creators: "获取远程创作者数据",
  stop_crawl: "停止远程采集",
  upload_creators: "重试上传创作者数据",
};

async function remoteCall(name: string, args: Json, jobId?: string): Promise<Json> {
  const operation = `claw.${name}`;
  const label = REMOTE_OPERATION_LABELS[name] || name;
  const startedAt = Date.now();
  if (jobId) {
    event(jobId, "operation", "running", `${label}进行中`, {
      operation, label, operation_status: "running",
    });
  }
  const client = clientFactory();
  try {
    const result = await client.callTool(name, args);
    if (jobId) {
      event(jobId, "operation", "done", `${label}已完成`, {
        operation, label, operation_status: "done", duration_ms: Date.now() - startedAt,
      });
    }
    return result;
  } catch (error) {
    if (jobId) {
      event(jobId, "operation", "failed", `${label}未完成`, {
        operation, label, operation_status: "failed", duration_ms: Date.now() - startedAt,
      });
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function startCrawl(input: {
  ownerUserId: string;
  workItemId: string;
  sessionId?: string | null;
  platform: string;
  mode: string;
  parameters: Json;
  idempotencyKey: string;
}): Promise<Json> {
  rejectDiscoveryHarnessTool("start_crawl");
  const platform = input.platform.toLowerCase();
  const mode = input.mode.toLowerCase();
  validateInput(platform, mode, input.parameters);
  if (!mediaCrawlerConfigured()) {
    throw new HttpFail(503, {
      code: "mediacrawler_not_configured",
      message: "远程采集服务未配置。",
      next_action: "请在管理端配置并启用 MediaCrawler 连接器及保险柜凭据。",
    });
  }
  const workItem = getConn().prepare("SELECT id FROM tickets WHERE id=?").get(input.workItemId) as
    | { id: string }
    | undefined;
  if (!workItem) {
    throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
  }
  const sessionId = input.sessionId && getConn().prepare("SELECT id FROM sessions WHERE id=?").get(input.sessionId)
    ? input.sessionId
    : null;
  const existing = getConn().prepare(
    "SELECT * FROM crawl_jobs WHERE idempotency_key=?",
  ).get(input.idempotencyKey) as Row | undefined;
  if (existing) return { ...publicJob(existing), duplicate: true };
  const id = nid("crawl");
  const now = nowIso();
  try {
    tx((db) => {
      const active = db.prepare(
        `SELECT id FROM crawl_jobs
          WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')
          LIMIT 1`,
      ).get() as { id: string } | undefined;
      if (active) {
        throw new HttpFail(409, {
          code: "crawl_active",
          message: CRAWL_ACTIVE_MESSAGE,
          crawl_job_id: active.id,
        });
      }
      db.prepare(
        `INSERT INTO crawl_jobs
         (id,idempotency_key,owner_user_id,work_item_id,session_id,platform,mode,parameters,status,
          data_version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'queued',1,?,?)`,
      ).run(
        id, input.idempotencyKey, input.ownerUserId, input.workItemId, sessionId,
        platform, mode, JSON.stringify(input.parameters), now, now,
      );
      db.prepare(
        "UPDATE tickets SET status='running',started_at=COALESCE(started_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
      ).run(now, now, input.workItemId);
    });
  } catch (error) {
    const duplicate = getConn().prepare(
      "SELECT * FROM crawl_jobs WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as Row | undefined;
    if (duplicate) return { ...publicJob(duplicate), duplicate: true };
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) {
      throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
    }
    throw error;
  }
  event(id, "queued", "queued", `Queued ${platform} ${mode} crawl`);
  try {
    const values = (value: unknown): string => Array.isArray(value)
      ? value.map(String).join(",")
      : String(value || "");
    const result = await remoteCall("start_crawl", {
      platforms: [platform],
      crawler_type: mode,
      ...(mode === "search" ? { keywords: values(input.parameters.keywords) } : {}),
      ...(mode === "detail" ? { specified_ids: values(input.parameters.specified_ids) } : {}),
      ...(mode === "creator" ? { creator_ids: values(input.parameters.creator_ids) } : {}),
    }, id);
    const remoteTaskId = String(result.task_id || result.id || json(result.data).task_id || "");
    if (!remoteTaskId) throw new Error("start_crawl returned no task_id");
    getConn().prepare(
      `UPDATE crawl_jobs SET remote_task_id=?,status='crawling',started_at=?,updated_at=?,
       data_version=data_version+1 WHERE id=?`,
    ).run(remoteTaskId, nowIso(), nowIso(), id);
    event(id, "started", "crawling", `Remote crawl started (${remoteTaskId})`, { remote_task_id: remoteTaskId });
    scheduleMonitor(id);
    return publicJob(getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(id) as Row);
  } catch (error) {
    failJob(id, error);
    const source = error instanceof Error ? error.message : error;
    console.warn("[discovery.crawl] start_crawl failed", {
      crawl_job_id: id,
      code: collectorFailureCode(error instanceof HttpFail ? error.detail ?? error : error),
      error: sanitizeSecret(error),
    });
    throw new HttpFail(502, {
      code: collectorFailureCode(source),
      message: persistableEmployeeError(source),
    });
  }
}

function statusOf(result: Json): string {
  const nested = json(result.data);
  return String(result.status || nested.status || result.state || nested.state || "").toLowerCase();
}

function normalizedActiveStatus(status: string): string {
  if (["uploading", "upload"].includes(status)) return "uploading";
  if (["analyzing", "processing_results"].includes(status)) return "analyzing";
  if (["queued", "pending"].includes(status)) return "queued";
  return "crawling";
}

/**
 * Monitoring is a bounded activity. One remote task that never reported a
 * terminal status used to be polled every 2 s for four days, writing an
 * `crawl.operation` / `crawl.status` pair per poll and leaving 415k rows
 * behind. The remote's own task timeout is 30 min, so 2 h is generous.
 */
function monitorMaxMs(): number {
  const n = Number(process.env.MEDIACRAWLER_MONITOR_MAX_MS || String(2 * 60 * 60 * 1000));
  return Number.isFinite(n) && n > 0 ? n : 2 * 60 * 60 * 1000;
}

function pollIntervalMs(): number {
  const n = Number(process.env.MEDIACRAWLER_POLL_INTERVAL_MS || 2000);
  return Number.isFinite(n) && n > 0 ? Math.max(100, n) : 2000;
}

/** Gentle backoff: a slow crawl stays responsive, a stuck one stops churning events. */
function monitorBackoffMs(attempt: number): number {
  const base = pollIntervalMs();
  return Math.min(base * 2 ** Math.min(attempt, 5), 10_000);
}

function scheduleMonitor(jobId: string): void {
  if (monitors.has(jobId)) return;
  const attempt = monitorAttempts.get(jobId) || 0;
  const timer = setTimeout(async () => {
    monitors.delete(jobId);
    monitorAttempts.set(jobId, attempt + 1);
    const job = getConn().prepare(
      "SELECT status,started_at,created_at FROM crawl_jobs WHERE id=?",
    ).get(jobId) as { status: string; started_at?: string | null; created_at?: string | null } | undefined;
    if (!job || !ACTIVE.has(String(job.status))) {
      monitorAttempts.delete(jobId);
      return;
    }
    const since = Date.parse(String(job.started_at || job.created_at || ""));
    if (Number.isFinite(since) && Date.now() - since > monitorMaxMs()) {
      monitorAttempts.delete(jobId);
      failJob(jobId, "远程采集长时间没有结束，已停止监控。");
      return;
    }
    await monitorCrawlJob(jobId).catch(() => undefined);
    const current = getConn().prepare("SELECT status FROM crawl_jobs WHERE id=?").get(jobId) as
      | { status: string }
      | undefined;
    if (current && ACTIVE.has(current.status)) {
      scheduleMonitor(jobId);
    } else {
      monitorAttempts.delete(jobId);
    }
  }, monitorBackoffMs(attempt));
  timer.unref?.();
  monitors.set(jobId, timer);
}

export async function monitorCrawlJob(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" });
  if (!ACTIVE.has(String(job.status)) || !job.remote_task_id) return publicJob(job);
  const remoteTaskId = String(job.remote_task_id);
  try {
    const result = await remoteCall("get_crawl_status", { task_id: remoteTaskId }, jobId);
    const status = statusOf(result);
    const nested = json(result.data);
    const remoteError = result.error_message || result.error || result.message
      || nested.error_message || nested.error || nested.message || null;
    const uploadError = result.upload_error || nested.upload_error
      || (/upload failed/i.test(String(remoteError || "")) ? remoteError : null);
    const checkedAt = nowIso();
    const persistedStatus = ["idle", "completed", "done", "error", "failed"].includes(status)
      ? String(job.status)
      : normalizedActiveStatus(status);
    getConn().prepare(
      "UPDATE crawl_jobs SET status=?,upload_error=?,last_checked_at=?,updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(persistedStatus, uploadError ? sanitize(uploadError) : null, checkedAt, checkedAt, jobId);
    event(jobId, "status", persistedStatus, `Remote status: ${status || "running"}`,
      uploadError ? { upload_error: sanitize(uploadError) } : {});
    try {
      const logResult = await remoteCall("get_crawl_logs", { task_id: remoteTaskId }, jobId);
      const nested = json(logResult.data);
      const rawLogs = logResult.logs || logResult.items || nested.logs || nested.items || [];
      const logLines = (Array.isArray(rawLogs) ? rawLogs : [rawLogs])
        .slice(-20)
        .map((line) => sanitize(typeof line === "object" ? JSON.stringify(line) : line))
        .filter(Boolean);
      if (logLines.length) event(jobId, "logs", status || "running", logLines.join("\n"));
    } catch {
      // Older MediaCrawler deployments may not expose logs; status monitoring remains authoritative.
    }
    if (status === "idle" || status === "completed" || status === "done") {
      try {
        await completeJob(jobId);
      } catch (error) {
        failJob(jobId, error);
      }
    }
    else if ((status === "error" || status === "failed") && uploadError) {
      event(jobId, "upload_fallback", "analyzing",
        "远程自动上传失败，Host 将通过 get_creators 主动拉取结果。",
        { upload_error: sanitize(uploadError) });
      try {
        await completeJob(jobId);
      } catch (error) {
        failJob(jobId, error);
      }
    }
    else if (status === "error" || status === "failed") {
      failJob(jobId, remoteError || "remote crawl failed");
    }
    return publicJob(getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row);
  } catch (error) {
    event(jobId, "monitor_error", "running", persistableEmployeeError(error));
    throw error;
  }
}

async function fetchCreators(job: Row): Promise<Json[]> {
  const maxPages = Math.max(1, Math.min(20, Number(process.env.MEDIACRAWLER_MAX_CREATOR_PAGES || 10)));
  const pageSize = Math.max(1, Math.min(200, Number(process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE || 100)));
  const creators: Json[] = [];
  // MediaCrawler MCP `get_creators` 的 schema 是 {task_id, platform, offset, limit}。
  // 发 page / page_size 会被**忽略**并返回全量（实测 page_size=5 仍回 42 条），
  // 所以分页必须自己用 offset 累加。
  for (let page = 0; page < maxPages; page += 1) {
    const result = await remoteCall("get_creators", {
      platform: job.platform,
      offset: page * pageSize,
      limit: pageSize,
    }, String(job.id));
    const data = json(result.data);
    const batch = (result.creators || result.items || data.creators || data.items || data) as unknown;
    const rows = Array.isArray(batch) ? batch.filter((item) => item && typeof item === "object") as Json[] : [];
    creators.push(...rows);
    const total = Number(result.total ?? data.total ?? 0);
    const hasMoreFlag = result.has_more ?? data.has_more;
    if (rows.length === 0) break;
    if (hasMoreFlag === false) break;
    if (total > 0 && creators.length >= total) break;
    if (hasMoreFlag === true) continue;
    if (rows.length < pageSize) break;
  }
  return creators;
}

async function completeJob(jobId: string): Promise<void> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row;
  getConn().prepare(
    "UPDATE crawl_jobs SET status='analyzing',last_checked_at=?,updated_at=?,data_version=data_version+1 WHERE id=?",
  ).run(nowIso(), nowIso(), jobId);
  event(jobId, "analyzing", "analyzing", "Analyzing normalized creator results");
  const creators = await fetchCreators(job);
  event(jobId, "operation", "running", "去重并写入达人库进行中", {
    operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "running",
  });
  let ingestion: Json;
  try {
    ingestion = ingestMediacrawler({
      creators, platform: job.platform, source: "remote_mcp", task_id: job.remote_task_id,
      crawl_job_id: jobId, collected_at: nowIso(),
    });
    event(jobId, "operation", "done", "去重并写入达人库已完成", {
      operation: "host.ingest_creators",
      label: "去重并写入达人库",
      operation_status: "done",
      accepted: ingestion.accepted || 0,
    });
  } catch (error) {
    event(jobId, "operation", "failed", "去重并写入达人库未完成", {
      operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "failed",
    });
    throw error;
  }
  const candidateRows = getConn().prepare(
    `SELECT c.id,c.platform,c.platform_creator_id,c.name AS nickname,c.followers,c.score,
            s.recent_views,s.score_details,s.collected_at
       FROM claw_creators c
       LEFT JOIN creator_snapshots s ON s.id = (
         SELECT latest.id FROM creator_snapshots latest
          WHERE latest.creator_id=c.id ORDER BY latest.created_at DESC LIMIT 1
       )
      WHERE c.platform=? ORDER BY c.score DESC LIMIT 100`,
  ).all(job.platform) as Row[];
  const candidates = candidateRows.map((row) => ({
    ...row,
    recent_views: parseArray(row.recent_views),
    score_details: parse(row.score_details),
    confidence: Number((parse(row.score_details).sample_confidence as number | undefined) || 0),
    contact_needed: true,
  }));
  const payload: Json = {
    type: "task_result",
    title: "达人采集结果",
    summary: `已接收 ${ingestion.accepted || 0} 位候选达人。`,
    candidates,
    contact_needed: true,
    notice: "仅提供平台 ID、昵称与基础评分；未生成或推测邮箱。",
    recommended_actions: ["复核候选达人", "通过既有渠道补充联系方式后再创建建联任务"],
    crawl_job_id: jobId,
  };
  const now = nowIso();
  tx((db) => {
    let messageId: string | null = null;
    if (job.session_id) {
      messageId = nid("msg");
      db.prepare(
        "INSERT INTO messages (id,session_id,role,kind,payload,created_at) VALUES (?,?,?,?,?,?)",
      ).run(messageId, job.session_id, "assistant", "task_result_card", JSON.stringify(payload), now);
      db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(now, job.session_id);
    }
    db.prepare(
      `INSERT INTO task_artifacts
       (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
       VALUES (?,?,NULL,'task_result_card',?,1,?,?)`,
    ).run(nid("art"), job.work_item_id, messageId, JSON.stringify(payload), now);
    db.prepare(
      `UPDATE crawl_jobs SET status='result_ready',upload_error=NULL,completed_at=?,updated_at=?,data_version=data_version+1
       WHERE id=?`,
    ).run(now, now, jobId);
    db.prepare(
      "UPDATE tickets SET status='waiting',updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, job.work_item_id);
  });
  event(jobId, "result_ready", "result_ready", `Result ready with ${candidates.length} candidates`);
  notifySettled(jobId);
}

function failJob(jobId: string, error: unknown): void {
  const safe = persistableEmployeeError(error);
  const job = getConn().prepare("SELECT work_item_id FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `UPDATE crawl_jobs SET status='error',error=?,completed_at=?,updated_at=?,
       data_version=data_version+1 WHERE id=?`,
    ).run(safe, now, now, jobId);
    if (job) db.prepare(
      "UPDATE tickets SET status='failed',updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, job.work_item_id);
  });
  event(jobId, "error", "error", safe);
  notifySettled(jobId);
}

export async function stopCrawl(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" });
  if (!ACTIVE.has(String(job.status))) return publicJob(job);
  if (!job.remote_task_id) {
    throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" });
  }
  getConn().prepare("UPDATE crawl_jobs SET status='stopping',updated_at=? WHERE id=?").run(nowIso(), jobId);
  try {
    await remoteCall("stop_crawl", { task_id: String(job.remote_task_id) }, jobId);
  } catch (error) {
    failJob(jobId, error);
    throw error;
  }
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE crawl_jobs SET status='stopped',completed_at=?,updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, jobId);
    db.prepare("UPDATE tickets SET status='waiting',updated_at=? WHERE id=?").run(now, job.work_item_id);
  });
  event(jobId, "stopped", "stopped", "Crawl stopped");
  notifySettled(jobId);
  return publicJob(getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row);
}

export async function retryUpload(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job?.remote_task_id) {
    throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" });
  }
  const result = await remoteCall("upload_creators", { task_id: job.remote_task_id }, jobId);
  getConn().prepare("UPDATE crawl_jobs SET upload_error=NULL,updated_at=? WHERE id=?").run(nowIso(), jobId);
  event(jobId, "upload_retried", String(job.status), "Creator upload retried");
  return result;
}

export async function clearRemoteHistory(): Promise<Json> {
  return remoteCall("clear_history", { confirm: true });
}

export function restoreActiveCrawlJobs(): void {
  const rows = getConn().prepare(
    `SELECT id,status,remote_task_id FROM crawl_jobs
      WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')`,
  ).all() as Row[];
  for (const row of rows) {
    if (!row.remote_task_id) failJob(String(row.id), "Process restarted before remote task id was persisted");
    else scheduleMonitor(String(row.id));
  }
}

export function crawlJob(id: string): Json | null {
  const row = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(id) as Row | undefined;
  return row ? publicJob(row) : null;
}

export function crawlEvents(id: string, after = 0): Json[] {
  return (getConn().prepare(
    "SELECT * FROM crawl_job_events WHERE crawl_job_id=? AND sequence>? ORDER BY sequence",
  ).all(id, after) as Row[]).map((row) => ({ ...row, payload: parse(row.payload) }));
}
