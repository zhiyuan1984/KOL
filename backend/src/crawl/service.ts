import { ingestMediacrawler } from "../adapters/claw.js";
import { mediaCrawlerConfigured } from "../config.js";
import { getConn, nowIso, tx } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { appendTaskEvent } from "../routers/tasks.js";
import type { Json, Row } from "../types.js";

const PLATFORMS = new Set(["xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu"]);
const MODES = new Set(["search", "detail", "creator"]);
const ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
const monitors = new Map<string, ReturnType<typeof setTimeout>>();
let clientFactory: () => Pick<RemoteMcpClient, "callTool" | "close"> = () => new RemoteMcpClient();

export function setCrawlMcpClientFactory(
  factory?: () => Pick<RemoteMcpClient, "callTool" | "close">,
): void {
  clientFactory = factory || (() => new RemoteMcpClient());
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
  if (!PLATFORMS.has(platform)) throw new HttpFail(400, "invalid crawl platform");
  if (!MODES.has(mode)) throw new HttpFail(400, "invalid crawl mode");
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
  const platform = input.platform.toLowerCase();
  const mode = input.mode.toLowerCase();
  validateInput(platform, mode, input.parameters);
  if (!mediaCrawlerConfigured()) {
    throw new HttpFail(503, {
      code: "mediacrawler_not_configured",
      message: "远程采集服务未配置。",
      next_action: "请在根目录 .env 配置 MEDIACRAWLER_MCP_URL 和 MEDIACRAWLER_MCP_TOKEN 后重启服务。",
    });
  }
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
      if (active) throw new HttpFail(409, { code: "crawl_active", crawl_job_id: active.id });
      db.prepare(
        `INSERT INTO crawl_jobs
         (id,idempotency_key,owner_user_id,work_item_id,session_id,platform,mode,parameters,status,
          data_version,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'queued',1,?,?)`,
      ).run(
        id, input.idempotencyKey, input.ownerUserId, input.workItemId, input.sessionId || null,
        platform, mode, JSON.stringify(input.parameters), now, now,
      );
      db.prepare(
        "UPDATE work_items SET status='running',started_at=COALESCE(started_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
      ).run(now, now, input.workItemId);
    });
  } catch (error) {
    const duplicate = getConn().prepare(
      "SELECT * FROM crawl_jobs WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as Row | undefined;
    if (duplicate) return { ...publicJob(duplicate), duplicate: true };
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
    throw new HttpFail(502, sanitize(error instanceof Error ? error.message : error));
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

function scheduleMonitor(jobId: string): void {
  if (monitors.has(jobId)) return;
  const interval = Math.max(100, Number(process.env.MEDIACRAWLER_POLL_INTERVAL_MS || 2000));
  const timer = setTimeout(async () => {
    monitors.delete(jobId);
    await monitorCrawlJob(jobId).catch(() => undefined);
    const current = getConn().prepare("SELECT status FROM crawl_jobs WHERE id=?").get(jobId) as
      | { status: string }
      | undefined;
    if (current && ACTIVE.has(current.status)) scheduleMonitor(jobId);
  }, interval);
  timer.unref?.();
  monitors.set(jobId, timer);
}

export async function monitorCrawlJob(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) throw new HttpFail(404, "crawl job not found");
  if (!ACTIVE.has(String(job.status)) || !job.remote_task_id) return publicJob(job);
  try {
    const result = await remoteCall("get_crawl_status", {}, jobId);
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
      const logResult = await remoteCall("get_crawl_logs", {}, jobId);
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
    if (status === "idle" || status === "completed" || status === "done") await completeJob(jobId);
    else if ((status === "error" || status === "failed") && uploadError) {
      event(jobId, "upload_fallback", "analyzing",
        "远程自动上传失败，Host 将通过 get_creators 主动拉取结果。",
        { upload_error: sanitize(uploadError) });
      await completeJob(jobId);
    }
    else if (status === "error" || status === "failed") {
      failJob(jobId, remoteError || "remote crawl failed");
    }
    return publicJob(getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row);
  } catch (error) {
    event(jobId, "monitor_error", "running", error instanceof Error ? error.message : error);
    throw error;
  }
}

async function fetchCreators(job: Row): Promise<Json[]> {
  const maxPages = Math.max(1, Math.min(20, Number(process.env.MEDIACRAWLER_MAX_CREATOR_PAGES || 10)));
  const pageSize = Math.max(1, Math.min(200, Number(process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE || 100)));
  const creators: Json[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const result = await remoteCall("get_creators", {
      task_id: job.remote_task_id, platform: job.platform, offset, limit: pageSize,
    }, String(job.id));
    const data = json(result.data);
    const batch = (result.creators || result.items || data.creators || data.items || data) as unknown;
    const rows = Array.isArray(batch) ? batch.filter((item) => item && typeof item === "object") as Json[] : [];
    creators.push(...rows);
    const total = Number(result.total ?? data.total ?? 0);
    const hasMore = Boolean(result.has_more ?? data.has_more) || (total > 0 && offset + rows.length < total);
    if (!hasMore) break;
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
      "UPDATE work_items SET status='waiting',updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, job.work_item_id);
  });
  event(jobId, "result_ready", "result_ready", `Result ready with ${candidates.length} candidates`);
}

function failJob(jobId: string, error: unknown): void {
  const safe = sanitize(error instanceof Error ? error.message : error);
  const job = getConn().prepare("SELECT work_item_id FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `UPDATE crawl_jobs SET status='error',error=?,completed_at=?,updated_at=?,
       data_version=data_version+1 WHERE id=?`,
    ).run(safe, now, now, jobId);
    if (job) db.prepare(
      "UPDATE work_items SET status='failed',updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, job.work_item_id);
  });
  event(jobId, "error", "error", safe);
}

export async function stopCrawl(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job) throw new HttpFail(404, "crawl job not found");
  if (!ACTIVE.has(String(job.status))) return publicJob(job);
  getConn().prepare("UPDATE crawl_jobs SET status='stopping',updated_at=? WHERE id=?").run(nowIso(), jobId);
  try {
    await remoteCall("stop_crawl", {}, jobId);
  } catch (error) {
    failJob(jobId, error);
    throw error;
  }
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE crawl_jobs SET status='stopped',completed_at=?,updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, jobId);
    db.prepare("UPDATE work_items SET status='waiting',updated_at=? WHERE id=?").run(now, job.work_item_id);
  });
  event(jobId, "stopped", "stopped", "Crawl stopped");
  return publicJob(getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row);
}

export async function retryUpload(jobId: string): Promise<Json> {
  const job = getConn().prepare("SELECT * FROM crawl_jobs WHERE id=?").get(jobId) as Row | undefined;
  if (!job?.remote_task_id) throw new HttpFail(409, "crawl job has no remote task");
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
