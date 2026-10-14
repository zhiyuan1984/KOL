import { ingestMediacrawler } from "../adapters/claw.js";
import { createMediaCrawlerClient, mediaCrawlerConfigured } from "./managed-connection.js";
import { postgresDb, isDatabaseClosedError, isDatabaseForeignKeyError, nowIso, onDatabaseReset, pgTransaction } from "../postgres/access.js";
import { CRAWL_ACTIVE_MESSAGE, collectorFailureCode, persistableEmployeeError, sanitizeSecret, } from "../discovery-errors.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { appendTaskEvent } from "../task-events.js";
import type { Json, Row } from "../types.js";
import { CRAWL_PLATFORM_SET } from "./platforms.js";
import { rejectDiscoveryHarnessTool } from "../gateway/discovery-harness.js";
import { withCrawlerInstanceLock, assertNoRuntimeCrawl } from "./runtime-gates.js";
import { getConnectorConfig } from "../runtime/store.js";

const MODES = new Set(["search", "detail", "creator"]);
const ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
const monitors = new Map<string, ReturnType<typeof setTimeout>>();
/** Poll count per job, for the monitor backoff. Reset when a job settles. */
const monitorAttempts = new Map<string, number>();
type CrawlMcpClient = Pick<RemoteMcpClient, "callTool" | "close">;
type CrawlMcpClientFactory = () => CrawlMcpClient | Promise<CrawlMcpClient>;
let clientFactory: CrawlMcpClientFactory = async () => (await createMediaCrawlerClient());
/** Discovery (and other hosts) subscribe to crawl settle without importing crawl internals. */
export function onCrawlJobSettled(handler: (job: Row) => void | Promise<void>): void {
  const bucket = settleBucket();
  if (!bucket.includes(handler))
    bucket.push(handler);
}
function settleBucket(): Array<(job: Row) => void | Promise<void>> {
  const fn = onCrawlJobSettled as typeof onCrawlJobSettled & {
    handlers?: Array<(job: Row) => void | Promise<void>>;
  };
  if (!fn.handlers)
    fn.handlers = [];
  return fn.handlers;
}
async function notifySettled(jobId: string): Promise<void> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  if (!job)
    return;
  for (const handler of settleBucket()) {
    try {
      await handler(job);
    }
    catch {
      // Subscribers must not fail the crawl job itself.
    }
  }
}
function clearMonitors(): void {
  for (const timer of monitors.values())
    clearTimeout(timer);
  monitors.clear();
  monitorAttempts.clear();
}
onDatabaseReset(clearMonitors);
export function setCrawlMcpClientFactory(factory?: CrawlMcpClientFactory): void {
  clientFactory = factory || (async () => (await createMediaCrawlerClient()));
}
function json(value: unknown): Json {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Json;
  return {};
}
function parse(value: unknown): Json {
  try {
    return json(JSON.parse(String(value || "{}")));
  }
  catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  }
  catch {
    return [];
  }
}

function sanitize(value: unknown): string {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***")
    .slice(0, 1000);
}
async function publicJob(row: Row): Promise<Json> {
  const artifact = String(row.status) === "result_ready"
    ? (await postgresDb().one(`SELECT payload FROM task_artifacts
          WHERE work_item_id=$1 AND artifact_type='task_result_card'
          ORDER BY created_at DESC LIMIT 1`, row.work_item_id)) as {
      payload?: string;
    } | undefined
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
async function event(jobId: string, eventType: string, status: string, summary: unknown, payload: Json = {}): Promise<void> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  if (!job)
    return;
  const safe = sanitize(summary);
  (await pgTransaction(async (db) => {
    const current = (await db.one("SELECT COALESCE(MAX(sequence),0) AS sequence FROM crawl_job_events WHERE crawl_job_id=$1", jobId)) as {
      sequence: number;
    };
    (await db.execute(`INSERT INTO crawl_job_events
       (id,crawl_job_id,sequence,event_type,status,summary,payload,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, nid("cev"), jobId, Number(current.sequence) + 1, eventType, status, safe, JSON.stringify(payload), nowIso()));
  }));
  (await appendTaskEvent(String(job.work_item_id), null, `crawl.${eventType}`, safe || eventType, status, safe));
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
    (await event(jobId, "operation", "running", `${label}进行中`, {
      operation, label, operation_status: "running",
    }));
  }
  const client = await clientFactory();
  try {
    const result = await client.callTool(name, args);
    if (jobId) {
      (await event(jobId, "operation", "done", `${label}已完成`, {
        operation, label, operation_status: "done", duration_ms: Date.now() - startedAt,
      }));
    }
    return result;
  }
  catch (error) {
    if (jobId) {
      (await event(jobId, "operation", "failed", `${label}未完成`, {
        operation, label, operation_status: "failed", duration_ms: Date.now() - startedAt,
      }));
    }
    throw error;
  }
  finally {
    await client.close().catch(() => undefined);
  }
}
export async function startCrawl(input: Parameters<typeof startLegacyCrawl>[0]): Promise<Json> {
  if ((await postgresDb().one("SELECT 1 FROM runtime_bootstrap_migrations WHERE id='runtime.crawler-skill.v1'"))) {
    throw new HttpFail(410, { code: "crawler_skill_entry_required", message: "采集已迁移到线索智能体，请在采集线索技能中核对并确认。", next_action: "open_crawler_agent" });
  }
  const url = (await getConnectorConfig("claw"))?.config.url;
  if (!url)
    return (await startLegacyCrawl(input));
  return (await withCrawlerInstanceLock(url, async () => {
    await assertNoRuntimeCrawl(url);
    return (await startLegacyCrawl(input));
  }));
}
async function startLegacyCrawl(input: {
  ownerUserId: string;
  workItemId: string;
  sessionId?: string | null;
  platform: string;
  mode: string;
  parameters: Json;
  idempotencyKey: string;
}): Promise<Json> {
  (await rejectDiscoveryHarnessTool("start_crawl"));
  const platform = input.platform.toLowerCase();
  const mode = input.mode.toLowerCase();
  validateInput(platform, mode, input.parameters);
  if (!(await mediaCrawlerConfigured())) {
    throw new HttpFail(503, {
      code: "mediacrawler_not_configured",
      message: "远程采集服务未配置。",
      next_action: "请在管理端配置并启用 MediaCrawler 连接器及保险柜凭据。",
    });
  }
  const workItem = (await postgresDb().one("SELECT id FROM tickets WHERE id=$1", input.workItemId)) as {
    id: string;
  } | undefined;
  if (!workItem) {
    throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
  }
  const sessionId = input.sessionId && (await postgresDb().one("SELECT id FROM sessions WHERE id=$1", input.sessionId))
    ? input.sessionId
    : null;
  const existing = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE idempotency_key=$1", input.idempotencyKey)) as Row | undefined;
  if (existing)
    return { ...(await publicJob(existing)), duplicate: true };
  const id = nid("crawl");
  const now = nowIso();
  try {
    (await pgTransaction(async (db) => {
      const active = (await db.one(`SELECT id FROM crawl_jobs
          WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')
          LIMIT 1`)) as {
        id: string;
      } | undefined;
      if (active) {
        throw new HttpFail(409, {
          code: "crawl_active",
          message: CRAWL_ACTIVE_MESSAGE,
          crawl_job_id: active.id,
        });
      }
      (await db.execute(`INSERT INTO crawl_jobs
         (id,idempotency_key,owner_user_id,work_item_id,session_id,platform,mode,parameters,status,
          data_version,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 'queued',1,$9,$10)`, id, input.idempotencyKey, input.ownerUserId, input.workItemId, sessionId, platform, mode, JSON.stringify(input.parameters), now, now));
      (await db.execute("UPDATE tickets SET status='running',started_at=COALESCE(started_at,$1),updated_at=$2,data_version=data_version+1 WHERE id=$3", now, now, input.workItemId));
    }));
  }
  catch (error) {
    const duplicate = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE idempotency_key=$1", input.idempotencyKey)) as Row | undefined;
    if (duplicate)
      return { ...(await publicJob(duplicate)), duplicate: true };
    if (isDatabaseForeignKeyError(error) || isDatabaseClosedError(error)) {
      throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
    }
    throw error;
  }
  (await event(id, "queued", "queued", `Queued ${platform} ${mode} crawl`));
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
    if (!remoteTaskId)
      throw new Error("start_crawl returned no task_id");
    (await postgresDb().execute(`UPDATE crawl_jobs SET remote_task_id=$1,status='crawling',started_at=$2,updated_at=$3,
       data_version=data_version+1 WHERE id=$4`, remoteTaskId, nowIso(), nowIso(), id));
    (await event(id, "started", "crawling", `Remote crawl started (${remoteTaskId})`, { remote_task_id: remoteTaskId }));
    scheduleMonitor(id);
    return (await publicJob((await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", id)) as Row));
  }
  catch (error) {
    (await failJob(id, error));
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
  if (["uploading", "upload"].includes(status))
    return "uploading";
  if (["analyzing", "processing_results"].includes(status))
    return "analyzing";
  if (["queued", "pending"].includes(status))
    return "queued";
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
  return Math.min(base * 2 ** Math.min(attempt, 5), 10000);
}
function scheduleMonitor(jobId: string): void {
  if (monitors.has(jobId))
    return;
  const attempt = monitorAttempts.get(jobId) || 0;
  const timer = setTimeout(async () => {
    monitors.delete(jobId);
    monitorAttempts.set(jobId, attempt + 1);
    const job = (await postgresDb().one("SELECT status,started_at,created_at FROM crawl_jobs WHERE id=$1", jobId)) as {
      status: string;
      started_at?: string | null;
      created_at?: string | null;
    } | undefined;
    if (!job || !ACTIVE.has(String(job.status))) {
      monitorAttempts.delete(jobId);
      return;
    }
    const since = Date.parse(String(job.started_at || job.created_at || ""));
    if (Number.isFinite(since) && Date.now() - since > monitorMaxMs()) {
      monitorAttempts.delete(jobId);
      (await failJob(jobId, "远程采集长时间没有结束，已停止监控。"));
      return;
    }
    await monitorCrawlJob(jobId).catch(() => undefined);
    const current = (await postgresDb().one("SELECT status FROM crawl_jobs WHERE id=$1", jobId)) as {
      status: string;
    } | undefined;
    if (current && ACTIVE.has(current.status)) {
      scheduleMonitor(jobId);
    }
    else {
      monitorAttempts.delete(jobId);
    }
  }, monitorBackoffMs(attempt));
  timer.unref?.();
  monitors.set(jobId, timer);
}
export async function monitorCrawlJob(jobId: string): Promise<Json> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  if (!job)
    throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" });
  if (!ACTIVE.has(String(job.status)) || !job.remote_task_id)
    return (await publicJob(job));
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
    (await postgresDb().execute("UPDATE crawl_jobs SET status=$1,upload_error=$2,last_checked_at=$3,updated_at=$4,data_version=data_version+1 WHERE id=$5", persistedStatus, uploadError ? sanitize(uploadError) : null, checkedAt, checkedAt, jobId));
    (await event(jobId, "status", persistedStatus, `Remote status: ${status || "running"}`, uploadError ? { upload_error: sanitize(uploadError) } : {}));
    try {
      const logResult = await remoteCall("get_crawl_logs", { task_id: remoteTaskId }, jobId);
      const nested = json(logResult.data);
      const rawLogs = logResult.logs || logResult.items || nested.logs || nested.items || [];
      const logLines = (Array.isArray(rawLogs) ? rawLogs : [rawLogs])
        .slice(-20)
        .map((line) => sanitize(typeof line === "object" ? JSON.stringify(line) : line))
        .filter(Boolean);
      if (logLines.length)
        (await event(jobId, "logs", status || "running", logLines.join("\n")));
    }
    catch {
      // Older MediaCrawler deployments may not expose logs; status monitoring remains authoritative.
    }
    if (status === "idle" || status === "completed" || status === "done") {
      try {
        await completeJob(jobId);
      }
      catch (error) {
        (await failJob(jobId, error));
      }
    }
    else if ((status === "error" || status === "failed") && uploadError) {
      (await event(jobId, "upload_fallback", "analyzing", "远程自动上传失败，Host 将通过 get_creators 主动拉取结果。", { upload_error: sanitize(uploadError) }));
      try {
        await completeJob(jobId);
      }
      catch (error) {
        (await failJob(jobId, error));
      }
    }
    else if (status === "error" || status === "failed") {
      (await failJob(jobId, remoteError || "remote crawl failed"));
    }
    return (await publicJob((await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row));
    }
  catch (error) {
    (await event(jobId, "monitor_error", "running", persistableEmployeeError(error)));
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
    if (rows.length === 0)
      break;
    if (hasMoreFlag === false)
      break;
    if (total > 0 && creators.length >= total)
      break;
    if (hasMoreFlag === true)
      continue;
    if (rows.length < pageSize)
      break;
  }
  return creators;
}
async function completeJob(jobId: string): Promise<void> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row;
  (await postgresDb().execute("UPDATE crawl_jobs SET status='analyzing',last_checked_at=$1,updated_at=$2,data_version=data_version+1 WHERE id=$3", nowIso(), nowIso(), jobId));
  (await event(jobId, "analyzing", "analyzing", "Analyzing normalized creator results"));
  const creators = await fetchCreators(job);
  (await event(jobId, "operation", "running", "去重并写入达人库进行中", {
    operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "running",
  }));
  let ingestion: Json;
  try {
    ingestion = (await ingestMediacrawler({
      creators, platform: job.platform, source: "remote_mcp", task_id: job.remote_task_id,
      crawl_job_id: jobId, collected_at: nowIso(),
    }));
    (await event(jobId, "operation", "done", "去重并写入达人库已完成", {
      operation: "host.ingest_creators",
      label: "去重并写入达人库",
      operation_status: "done",
      accepted: ingestion.accepted || 0,
    }));
  }
  catch (error) {
    (await event(jobId, "operation", "failed", "去重并写入达人库未完成", {
      operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "failed",
    }));
    throw error;
  }
  const candidateRows = (await postgresDb().many(`SELECT c.id,c.platform,c.platform_creator_id,c.name AS nickname,c.followers,c.score,
            s.recent_views,s.score_details,s.collected_at
       FROM claw_creators c
       LEFT JOIN creator_snapshots s ON s.id = (
         SELECT latest.id FROM creator_snapshots latest
          WHERE latest.creator_id=c.id ORDER BY latest.created_at DESC LIMIT 1
       )
      WHERE c.platform=$1 ORDER BY c.score DESC LIMIT 100`, job.platform)) as Row[];
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
  (await pgTransaction(async (db) => {
    let messageId: string | null = null;
    if (job.session_id) {
      messageId = nid("msg");
      (await db.execute("INSERT INTO messages (id,session_id,role,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6)", messageId, job.session_id, "assistant", "task_result_card", JSON.stringify(payload), now));
      (await db.execute("UPDATE sessions SET updated_at=$1 WHERE id=$2", now, job.session_id));
    }
    (await db.execute(`INSERT INTO task_artifacts
       (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
       VALUES ($1,$2,NULL,'task_result_card',$3,1,$4,$5)`, nid("art"), job.work_item_id, messageId, JSON.stringify(payload), now));
    (await db.execute(`UPDATE crawl_jobs SET status='result_ready',upload_error=NULL,completed_at=$1,updated_at=$2,data_version=data_version+1
       WHERE id=$3`, now, now, jobId));
    (await db.execute("UPDATE tickets SET status='waiting',updated_at=$1,data_version=data_version+1 WHERE id=$2", now, job.work_item_id));
  }));
  (await event(jobId, "result_ready", "result_ready", `Result ready with ${candidates.length} candidates`));
  (await notifySettled(jobId));
}
async function failJob(jobId: string, error: unknown): Promise<void> {
  const safe = persistableEmployeeError(error);
  const job = (await postgresDb().one("SELECT work_item_id FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  const now = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute(`UPDATE crawl_jobs SET status='error',error=$1,completed_at=$2,updated_at=$3,
       data_version=data_version+1 WHERE id=$4`, safe, now, now, jobId));
    if (job)
      (await db.execute("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2", now, job.work_item_id));
  }));
  (await event(jobId, "error", "error", safe));
  (await notifySettled(jobId));
}
export async function stopCrawl(jobId: string): Promise<Json> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  if (!job)
    throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" });
  if (!ACTIVE.has(String(job.status)))
    return (await publicJob(job));
  if (!job.remote_task_id) {
    throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" });
  }
  (await postgresDb().execute("UPDATE crawl_jobs SET status='stopping',updated_at=$1 WHERE id=$2", nowIso(), jobId));
  try {
    await remoteCall("stop_crawl", { task_id: String(job.remote_task_id) }, jobId);
  }
  catch (error) {
    (await failJob(jobId, error));
    throw error;
  }
  const now = nowIso();
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE crawl_jobs SET status='stopped',completed_at=$1,updated_at=$2,data_version=data_version+1 WHERE id=$3", now, now, jobId));
    (await db.execute("UPDATE tickets SET status='waiting',updated_at=$1 WHERE id=$2", now, job.work_item_id));
  }));
  (await event(jobId, "stopped", "stopped", "Crawl stopped"));
  (await notifySettled(jobId));
  return (await publicJob((await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row));
}
export async function retryUpload(jobId: string): Promise<Json> {
  const job = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", jobId)) as Row | undefined;
  if (!job?.remote_task_id) {
    throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" });
  }
  const result = await remoteCall("upload_creators", { task_id: job.remote_task_id }, jobId);
  (await postgresDb().execute("UPDATE crawl_jobs SET upload_error=NULL,updated_at=$1 WHERE id=$2", nowIso(), jobId));
  (await event(jobId, "upload_retried", String(job.status), "Creator upload retried"));
  return result;
}
export async function clearRemoteHistory(): Promise<Json> {
  return (await remoteCall("clear_history", { confirm: true }));
}
export async function restoreActiveCrawlJobs(): Promise<void> {
  const rows = (await postgresDb().many(`SELECT id,status,remote_task_id FROM crawl_jobs
      WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')`)) as Row[];
  for (const row of rows) {
    if (!row.remote_task_id)
      (await failJob(String(row.id), "Process restarted before remote task id was persisted"));
    else
      scheduleMonitor(String(row.id));
  }
}
export async function crawlJob(id: string): Promise<Json | null> {
  const row = (await postgresDb().one("SELECT * FROM crawl_jobs WHERE id=$1", id)) as Row | undefined;
  return row ? (await publicJob(row)) : null;
}
export async function crawlEvents(id: string, after = 0): Promise<Json[]> {
  return ((await postgresDb().many("SELECT * FROM crawl_job_events WHERE crawl_job_id=$1 AND sequence>$2 ORDER BY sequence", id, after)) as Row[]).map((row) => ({ ...row, payload: parse(row.payload) }));
}
