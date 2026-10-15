import { postgresConnection } from "../postgres/pool.js";
import type { PoolClient } from "pg";
import { createMediaCrawlerClient, mediaCrawlerConfigured } from "./managed-connection.js";
import {
  CRAWL_ACTIVE_MESSAGE,
  collectorFailureCode,
  persistableEmployeeError,
  sanitizeSecret,
} from "../discovery-errors.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { appendTaskEventIn } from "../task-events.js";
import type { Json, Row } from "../types.js";
import { CRAWL_PLATFORM_SET } from "./platforms.js";
import { rejectDiscoveryHarnessTool } from "../gateway/discovery-harness.js";
import { withCrawlerInstanceLock, assertNoRuntimeCrawl } from "./runtime-gates.js";
import { getConnectorConfig } from "../runtime/store.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
type CreatorScore = { score: number; followers: number; sample_size: number; view_median: number; view_mean: number; view_follower_ratio: number; stability: number; sample_confidence: number; };
function calculateCreatorScore(followers: number, recentViews: number[]): CreatorScore {
  const views = recentViews.filter(value => Number.isFinite(value) && value >= 0).slice(-10);
  const sorted = [...views].sort((a, b) => a - b); const mean = views.length ? views.reduce((sum, value) => sum + value, 0) / views.length : 0; const middle = Math.floor(sorted.length / 2);
  const median = !sorted.length ? 0 : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; const variance = views.length ? views.reduce((sum, value) => sum + (value - mean) ** 2, 0) / views.length : 0; const stability = mean > 0 ? Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / mean)) : 0; const ratio = followers > 0 ? mean / followers : 0; const confidence = Math.min(1, views.length / 10);
  const score = Math.min(25, Math.log10(Math.max(1, followers)) / 6 * 25) + Math.min(25, Math.log10(Math.max(1, median)) / 6 * 25) + Math.min(20, ratio * 40) + stability * 15 + confidence * 15;
  return { score: Math.round(score * 100) / 100, followers: Math.max(0, Math.round(followers || 0)), sample_size: views.length, view_median: Math.round(median * 100) / 100, view_mean: Math.round(mean * 100) / 100, view_follower_ratio: Math.round(ratio * 10000) / 10000, stability: Math.round(stability * 10000) / 10000, sample_confidence: Math.round(confidence * 100) / 100 };
}

const MODES = new Set(["search", "detail", "creator"]);
const ACTIVE = new Set(["queued", "crawling", "uploading", "analyzing", "starting", "running", "stopping"]);
const monitors = new Map<string, Awaited<ReturnType<typeof setTimeout>>>();
const monitorAttempts = new Map<string, number>();
let clientFactory: () => Pick<RemoteMcpClient, "callTool" | "close"> | Promise<Pick<RemoteMcpClient, "callTool" | "close">> = async () => (createMediaCrawlerClient());

/** Discovery (and other hosts) subscribe without importing crawler persistence. */
export function onCrawlJobSettled(handler: (job: Row) => void | Promise<void>): void {
  const fn = onCrawlJobSettled as typeof onCrawlJobSettled & { handlers?: Array<(job: Row) => void | Promise<void>> };
  (fn.handlers ||= []).push(handler);
}
function handlers(): Array<(job: Row) => void | Promise<void>> {
  return (onCrawlJobSettled as typeof onCrawlJobSettled & { handlers?: Array<(job: Row) => void | Promise<void>> }).handlers || [];
}
async function notifySettled(jobId: string): Promise<void> {
  const job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0];
  if (!job) return;
  for (const handler of handlers()) {
    try { await handler(job); } catch { /* Subscribers cannot change the durable job outcome. */ }
  }
}
function clearMonitors(): void {
  for (const timer of monitors.values()) clearTimeout(timer);
  monitors.clear(); monitorAttempts.clear();
}
export function setCrawlMcpClientFactory(factory?: () => Pick<RemoteMcpClient, "callTool" | "close"> | Promise<Pick<RemoteMcpClient, "callTool" | "close">>): void {
  clientFactory = factory || (async () => (createMediaCrawlerClient()));
}
function nowIso(): string { return new Date().toISOString(); }
function json(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function parse(value: unknown): Json { try { return json(JSON.parse(String(value || "{}"))); } catch { return {}; } }
function parseArray(value: unknown): unknown[] { try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function sanitize(value: unknown): string {
  return String(value || "").replace(/Bearer\s+[^\s"']+/gi, "Bearer ***").replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***").slice(0, 1000);
}
function isForeignKey(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23503"); }
function isUnique(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505"); }

async function publicJob(row: Row): Promise<Json> {
  const artifact = String(row.status) === "result_ready"
    ? (await postgresConnection().query<{ payload?: string }>(`SELECT payload FROM task_artifacts WHERE work_item_id=$1 AND artifact_type='task_result_card' ORDER BY created_at DESC LIMIT 1`, [row.work_item_id])).rows[0]
    : undefined;
  return { ...row, parameters: parse(row.parameters), error: row.error ? sanitize(row.error) : null, ...(artifact?.payload ? { result: parse(artifact.payload) } : {}) };
}
function validateInput(platform: string, mode: string, parameters: Json): void {
  if (!CRAWL_PLATFORM_SET.has(platform)) throw new HttpFail(400, { code: "invalid_crawl_platform", message: "采集平台不正确。" });
  if (!MODES.has(mode)) throw new HttpFail(400, { code: "invalid_crawl_mode", message: "采集方式不正确。" });
  const required = mode === "search" ? "keywords" : mode === "detail" ? "specified_ids" : "creator_ids";
  const value = parameters[required];
  if (!(typeof value === "string" && value.trim()) && !(Array.isArray(value) && value.length)) throw new HttpFail(400, `启动采集前需要补充${required === "keywords" ? "关键词" : required === "specified_ids" ? "内容编号" : "创作者编号"}`);
}
async function eventIn(client: PoolClient, job: Row, eventType: string, status: string, summary: unknown, payload: Json = {}): Promise<void> {
  const safe = sanitize(summary);
  await client.query("SELECT id FROM crawl_jobs WHERE id=$1 FOR UPDATE", [job.id]);
  const seq = await client.query<{ sequence: number | string }>("SELECT COALESCE(MAX(sequence),0) AS sequence FROM crawl_job_events WHERE crawl_job_id=$1", [job.id]);
  await client.query(`INSERT INTO crawl_job_events (id,crawl_job_id,sequence,event_type,status,summary,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [nid("cev"), job.id, Number(seq.rows[0]?.sequence || 0) + 1, eventType, status, safe, JSON.stringify(payload), nowIso()]);
  await appendTaskEventIn(client, String(job.work_item_id), null, `crawl.${eventType}`, safe || eventType, status, safe);
}
async function event(jobId: string, eventType: string, status: string, summary: unknown, payload: Json = {}): Promise<void> {
  await postgresTransaction(async client => {
    const job = (await client.query<Row>("SELECT * FROM crawl_jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0];
    if (job) await eventIn(client, job, eventType, status, summary, payload);
  });
}
const REMOTE_OPERATION_LABELS: Record<string, string> = { start_crawl: "启动远程采集", get_crawl_status: "查询远程采集状态", get_crawl_logs: "读取远程采集日志", get_creators: "获取远程创作者数据", stop_crawl: "停止远程采集", upload_creators: "重试上传创作者数据" };
async function remoteCall(name: string, args: Json, jobId?: string): Promise<Json> {
  const operation = `claw.${name}`; const label = REMOTE_OPERATION_LABELS[name] || name; const startedAt = Date.now();
  if (jobId) await event(jobId, "operation", "running", `${label}进行中`, { operation, label, operation_status: "running" });
  const client = await clientFactory();
  try {
    const result = await client.callTool(name, args);
    if (jobId) await event(jobId, "operation", "done", `${label}已完成`, { operation, label, operation_status: "done", duration_ms: Date.now() - startedAt });
    return result;
  } catch (error) {
    if (jobId) await event(jobId, "operation", "failed", `${label}未完成`, { operation, label, operation_status: "failed", duration_ms: Date.now() - startedAt });
    throw error;
  } finally { await client.close().catch(() => undefined); }
}

export async function startCrawl(input: { ownerUserId: string; workItemId: string; sessionId?: string | null; platform: string; mode: string; parameters: Json; idempotencyKey: string }): Promise<Json> {
  const migrated = await postgresConnection().query("SELECT 1 FROM runtime_bootstrap_migrations WHERE id=$1", ["runtime.crawler-skill.v1"]);
  if (migrated.rows[0]) throw new HttpFail(410, { code: "crawler_skill_entry_required", message: "采集已迁移到线索智能体，请在采集线索技能中核对并确认。", next_action: "open_crawler_agent" });
  const url = (await getConnectorConfig("claw"))?.config.url;
  if (!url) return startLegacyCrawl(input);
  return withCrawlerInstanceLock(url, async () => { await assertNoRuntimeCrawl(url); return startLegacyCrawl(input); });
}
async function startLegacyCrawl(input: { ownerUserId: string; workItemId: string; sessionId?: string | null; platform: string; mode: string; parameters: Json; idempotencyKey: string }): Promise<Json> {
  (await rejectDiscoveryHarnessTool("start_crawl"));
  const platform = input.platform.toLowerCase(); const mode = input.mode.toLowerCase(); validateInput(platform, mode, input.parameters);
  if (!(await mediaCrawlerConfigured())) throw new HttpFail(503, { code: "mediacrawler_not_configured", message: "远程采集服务未配置。", next_action: "请在管理端配置并启用 MediaCrawler 连接器及保险柜凭据。" });
  const existing = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0];
  if (existing) return { ...(await (publicJob(existing))), duplicate: true };
  const id = nid("crawl"); const now = nowIso();
  try {
    await postgresTransaction(async client => {
      const workItem = (await client.query<Row>("SELECT id FROM tickets WHERE id=$1 FOR UPDATE", [input.workItemId])).rows[0];
      if (!workItem) throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
      const session = input.sessionId ? (await client.query("SELECT id FROM sessions WHERE id=$1", [input.sessionId])).rows[0] : undefined;
      const active = (await client.query<Row>(`SELECT id FROM crawl_jobs WHERE status = ANY($1::text[]) LIMIT 1 FOR UPDATE`, [[...ACTIVE]])).rows[0];
      if (active) throw new HttpFail(409, { code: "crawl_active", message: CRAWL_ACTIVE_MESSAGE, crawl_job_id: active.id });
      const inserted = (await client.query<Row>(`INSERT INTO crawl_jobs (id,idempotency_key,owner_user_id,work_item_id,session_id,platform,mode,parameters,status,data_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',1,$9,$9) RETURNING *`, [id, input.idempotencyKey, input.ownerUserId, input.workItemId, session ? input.sessionId : null, platform, mode, JSON.stringify(input.parameters), now])).rows[0];
      await client.query("UPDATE tickets SET status='running',started_at=COALESCE(started_at,$1),updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, input.workItemId]);
      await eventIn(client, inserted, "queued", "queued", `Queued ${platform} ${mode} crawl`);
    });
  } catch (error) {
    const replay = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0];
    if (replay) return { ...(await (publicJob(replay))), duplicate: true };
    if (isForeignKey(error)) throw new HttpFail(409, { code: "work_item_not_found", message: "采集任务已不存在。" });
    if (isUnique(error)) {
      const active = (await postgresConnection().query<Row>(`SELECT id FROM crawl_jobs WHERE status=ANY($1::text[]) LIMIT 1`, [[...ACTIVE]])).rows[0];
      if (active) throw new HttpFail(409, { code: "crawl_active", message: CRAWL_ACTIVE_MESSAGE, crawl_job_id: active.id });
    }
    throw error;
  }
  try {
    const values = (value: unknown): string => Array.isArray(value) ? value.map(String).join(",") : String(value || "");
    const result = await remoteCall("start_crawl", { platforms: [platform], crawler_type: mode, ...(mode === "search" ? { keywords: values(input.parameters.keywords) } : {}), ...(mode === "detail" ? { specified_ids: values(input.parameters.specified_ids) } : {}), ...(mode === "creator" ? { creator_ids: values(input.parameters.creator_ids) } : {}) }, id);
    const remoteTaskId = String(result.task_id || result.id || json(result.data).task_id || "");
    if (!remoteTaskId) throw new Error("start_crawl returned no task_id");
    await postgresTransaction(async client => {
      const row = (await client.query<Row>("UPDATE crawl_jobs SET remote_task_id=$1,status='crawling',started_at=$2,updated_at=$2,data_version=data_version+1 WHERE id=$3 RETURNING *", [remoteTaskId, nowIso(), id])).rows[0];
      if (row) await eventIn(client, row, "started", "crawling", `Remote crawl started (${remoteTaskId})`, { remote_task_id: remoteTaskId });
    });
    scheduleMonitor(id); return await requireCrawlJob(id);
  } catch (error) {
    await failJob(id, error);
    const source = error instanceof Error ? error.message : error;
    console.warn("[discovery.crawl] start_crawl failed", { crawl_job_id: id, code: collectorFailureCode(error instanceof HttpFail ? error.detail ?? error : error), error: sanitizeSecret(error) });
    throw new HttpFail(502, { code: collectorFailureCode(source), message: persistableEmployeeError(source) });
  }
}
function statusOf(result: Json): string { const nested = json(result.data); return String(result.status || nested.status || result.state || nested.state || "").toLowerCase(); }
function normalizedActiveStatus(status: string): string { if (["uploading", "upload"].includes(status)) return "uploading"; if (["analyzing", "processing_results"].includes(status)) return "analyzing"; if (["queued", "pending"].includes(status)) return "queued"; return "crawling"; }
function monitorMaxMs(): number { const n = Number(process.env.MEDIACRAWLER_MONITOR_MAX_MS || String(2 * 60 * 60 * 1000)); return Number.isFinite(n) && n > 0 ? n : 2 * 60 * 60 * 1000; }
function pollIntervalMs(): number { const n = Number(process.env.MEDIACRAWLER_POLL_INTERVAL_MS || 2000); return Number.isFinite(n) && n > 0 ? Math.max(100, n) : 2000; }
function monitorBackoffMs(attempt: number): number { return Math.min(pollIntervalMs() * 2 ** Math.min(attempt, 5), 10_000); }
function scheduleMonitor(jobId: string): void {
  if (monitors.has(jobId)) return;
  const attempt = monitorAttempts.get(jobId) || 0;
  const timer = setTimeout(async () => {
    monitors.delete(jobId); monitorAttempts.set(jobId, attempt + 1);
    const job = (await postgresConnection().query<Row>("SELECT status,started_at,created_at FROM crawl_jobs WHERE id=$1", [jobId])).rows[0];
    if (!job || !ACTIVE.has(String(job.status))) { monitorAttempts.delete(jobId); return; }
    const since = Date.parse(String(job.started_at || job.created_at || ""));
    if (Number.isFinite(since) && Date.now() - since > monitorMaxMs()) { monitorAttempts.delete(jobId); await failJob(jobId, "远程采集长时间没有结束，已停止监控。"); return; }
    await monitorCrawlJob(jobId).catch(() => undefined);
    const current = (await postgresConnection().query<Row>("SELECT status FROM crawl_jobs WHERE id=$1", [jobId])).rows[0];
    if (current && ACTIVE.has(String(current.status))) scheduleMonitor(jobId); else monitorAttempts.delete(jobId);
  }, monitorBackoffMs(attempt));
  timer.unref?.(); monitors.set(jobId, timer);
}
export async function monitorCrawlJob(jobId: string): Promise<Json> {
  const job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0];
  if (!job) throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" });
  if (!ACTIVE.has(String(job.status)) || !job.remote_task_id) return publicJob(job);
  try {
    const result = await remoteCall("get_crawl_status", { task_id: String(job.remote_task_id) }, jobId); const status = statusOf(result); const nested = json(result.data);
    const remoteError = result.error_message || result.error || result.message || nested.error_message || nested.error || nested.message || null;
    const uploadError = result.upload_error || nested.upload_error || (/upload failed/i.test(String(remoteError || "")) ? remoteError : null);
    const checkedAt = nowIso(); const persistedStatus = ["idle", "completed", "done", "error", "failed"].includes(status) ? String(job.status) : normalizedActiveStatus(status);
    await postgresTransaction(async client => {
      const updated = (await client.query<Row>("UPDATE crawl_jobs SET status=$1,upload_error=$2,last_checked_at=$3,updated_at=$3,data_version=data_version+1 WHERE id=$4 RETURNING *", [persistedStatus, uploadError ? sanitize(uploadError) : null, checkedAt, jobId])).rows[0];
      if (updated) await eventIn(client, updated, "status", persistedStatus, `Remote status: ${status || "running"}`, uploadError ? { upload_error: sanitize(uploadError) } : {});
    });
    try { const logs = await remoteCall("get_crawl_logs", { task_id: String(job.remote_task_id) }, jobId); const data = json(logs.data); const raw = logs.logs || logs.items || data.logs || data.items || []; const lines = (Array.isArray(raw) ? raw : [raw]).slice(-20).map(line => sanitize(typeof line === "object" ? JSON.stringify(line) : line)).filter(Boolean); if (lines.length) await event(jobId, "logs", status || "running", lines.join("\n")); } catch { /* older collector may not expose logs */ }
    if (["idle", "completed", "done"].includes(status) || (["error", "failed"].includes(status) && uploadError)) { try { await completeJob(jobId); } catch (error) { await failJob(jobId, error); } }
    else if (["error", "failed"].includes(status)) await failJob(jobId, remoteError || "remote crawl failed");
    return await requireCrawlJob(jobId);
  } catch (error) { await event(jobId, "monitor_error", "running", persistableEmployeeError(error)); throw error; }
}
async function fetchCreators(job: Row): Promise<Json[]> {
  const maxPages = Math.max(1, Math.min(20, Number(process.env.MEDIACRAWLER_MAX_CREATOR_PAGES || 10))); const pageSize = Math.max(1, Math.min(200, Number(process.env.MEDIACRAWLER_CREATOR_PAGE_SIZE || 100))); const creators: Json[] = [];
  for (let page = 0; page < maxPages; page += 1) { const result = await remoteCall("get_creators", { platform: job.platform, offset: page * pageSize, limit: pageSize }, String(job.id)); const data = json(result.data); const batch = result.creators || result.items || data.creators || data.items || data; const rows = Array.isArray(batch) ? batch.filter(item => item && typeof item === "object") as Json[] : []; creators.push(...rows); const total = Number(result.total ?? data.total ?? 0); const hasMore = result.has_more ?? data.has_more; if (!rows.length || hasMore === false || (total > 0 && creators.length >= total) || (hasMore !== true && rows.length < pageSize)) break; }
  return creators;
}
function nonNegativeInt(value: unknown): number { const n = Number(value || 0); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; }
function normalizeViews(value: unknown): number[] { const raw = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value as Record<string, unknown>) : []; return raw.map(Number).filter(n => Number.isFinite(n) && n >= 0).slice(-10); }
function safeId(value: string): string { return Buffer.from(value).toString("base64url").slice(0, 80); }
function validDate(value: unknown): string | null { const date = value ? new Date(String(value)) : null; return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null; }
async function ingestCreatorsIn(client: PoolClient, body: Json): Promise<{ accepted: number; inserted: number; updated: number }> {
  const nested = json(body.data); const raw = body.items ?? body.creators ?? nested.items ?? nested.creators ?? body.data ?? []; const items = Array.isArray(raw) ? raw : [raw]; const batchId = nid("ing"); const source = String(body.source || nested.source || "mediacrawler").slice(0, 120); const taskId = body.task_id || body.remote_task_id || nested.task_id || null; const crawlJobId = body.crawl_job_id || null; const now = nowIso(); let inserted = 0; let updated = 0; let rejected = 0; let accepted = 0;
  for (const value of items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { rejected += 1; continue; }
    const item = value as Json; const platform = String(item.platform || body.platform || "").trim().toLowerCase(); const platformCreatorId = String(item.platform_creator_id || item.creator_id || item.user_id || item.sec_uid || item.id || "").trim(); const nickname = String(item.nickname || item.name || item.handle || "").trim();
    if (!CRAWL_PLATFORM_SET.has(platform) || !platformCreatorId || !nickname) { rejected += 1; continue; }
    const followers = nonNegativeInt(item.followers ?? item.fans ?? item.follower_count); const recentViews = normalizeViews(item.recent_views ?? item.views ?? item.recent_10_views); const scoring = calculateCreatorScore(followers, recentViews); const existing = (await client.query<Row>("SELECT id FROM claw_creators WHERE platform=$1 AND platform_creator_id=$2 FOR UPDATE", [platform, platformCreatorId])).rows[0]; const creatorId = String(existing?.id || `cr_${platform}_${safeId(platformCreatorId)}`); const collectedAt = validDate(item.collected_at || body.collected_at) || now; const payload = { ...item, platform, platform_creator_id: platformCreatorId, nickname, followers, recent_views: recentViews, collected_at: collectedAt, source, task_id: taskId, score_details: scoring };
    if (existing) { await client.query("UPDATE claw_creators SET handle=$1,name=$1,followers=$2,score=$3,status='discovered',payload=$4 WHERE id=$5", [nickname, followers, scoring.score, JSON.stringify(payload), creatorId]); updated += 1; }
    else { await client.query(`INSERT INTO claw_creators (id,handle,name,platform,platform_creator_id,followers,score,status,outreach_script,payload) VALUES ($1,$2,$2,$3,$4,$5,$6,'discovered','',$7)`, [creatorId, nickname, platform, platformCreatorId, followers, scoring.score, JSON.stringify(payload)]); inserted += 1; }
    await client.query(`INSERT INTO creator_snapshots (id,creator_id,ingestion_batch_id,crawl_job_id,platform,platform_creator_id,nickname,followers,recent_views,score,score_details,source,task_id,collected_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [nid("snap"), creatorId, batchId, crawlJobId, platform, platformCreatorId, nickname, followers, JSON.stringify(recentViews), scoring.score, JSON.stringify(scoring), source, taskId, collectedAt, now]); accepted += 1;
  }
  await client.query(`INSERT INTO ingestion_batches (id,source,task_id,crawl_job_id,accepted,inserted,updated,rejected,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [batchId, source, taskId, crawlJobId, accepted, inserted, updated, rejected, now]);
  return { accepted, inserted, updated };
}
async function completeJob(jobId: string): Promise<void> {
  let job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0]; if (!job) return;
  await postgresTransaction(async client => { const updated = (await client.query<Row>("UPDATE crawl_jobs SET status='analyzing',last_checked_at=$1,updated_at=$1,data_version=data_version+1 WHERE id=$2 RETURNING *", [nowIso(), jobId])).rows[0]; if (updated) await eventIn(client, updated, "analyzing", "analyzing", "Analyzing normalized creator results"); });
  job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0]; if (!job) return;
  const creators = await fetchCreators(job); let ingestion: { accepted: number; inserted: number; updated: number };
  try { ingestion = await postgresTransaction(async client => (ingestCreatorsIn(client, { creators, platform: job.platform, source: "remote_mcp", task_id: job.remote_task_id, crawl_job_id: jobId, collected_at: nowIso() }))); await event(jobId, "operation", "done", "去重并写入达人库已完成", { operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "done", accepted: ingestion.accepted }); } catch (error) { await event(jobId, "operation", "failed", "去重并写入达人库未完成", { operation: "host.ingest_creators", label: "去重并写入达人库", operation_status: "failed" }); throw error; }
  const candidateRows = (await postgresConnection().query<Row>(`SELECT c.id,c.platform,c.platform_creator_id,c.name AS nickname,c.followers,c.score,s.recent_views,s.score_details,s.collected_at FROM claw_creators c LEFT JOIN creator_snapshots s ON s.id=(SELECT latest.id FROM creator_snapshots latest WHERE latest.creator_id=c.id ORDER BY latest.created_at DESC LIMIT 1) WHERE c.platform=$1 ORDER BY c.score DESC LIMIT 100`, [job.platform])).rows;
  const candidates = candidateRows.map(row => ({ ...row, recent_views: parseArray(row.recent_views), score_details: parse(row.score_details), confidence: Number((parse(row.score_details).sample_confidence as number | undefined) || 0), contact_needed: true })); const payload: Json = { type: "task_result", title: "达人采集结果", summary: `已接收 ${ingestion.accepted} 位候选达人。`, candidates, contact_needed: true, notice: "仅提供平台 ID、昵称与基础评分；未生成或推测邮箱。", recommended_actions: ["复核候选达人", "通过既有渠道补充联系方式后再创建建联任务"], crawl_job_id: jobId }; const now = nowIso();
  await postgresTransaction(async client => { const locked = (await client.query<Row>("SELECT * FROM crawl_jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0]; if (!locked) return; let messageId: string | null = null; if (locked.session_id) { messageId = nid("msg"); await client.query("INSERT INTO messages (id,session_id,role,kind,payload,created_at) VALUES ($1,$2,'assistant','task_result_card',$3,$4)", [messageId, locked.session_id, JSON.stringify(payload), now]); await client.query("UPDATE sessions SET updated_at=$1 WHERE id=$2", [now, locked.session_id]); } await client.query(`INSERT INTO task_artifacts (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at) VALUES ($1,$2,NULL,'task_result_card',$3,1,$4,$5)`, [nid("art"), locked.work_item_id, messageId, JSON.stringify(payload), now]); const finished = (await client.query<Row>("UPDATE crawl_jobs SET status='result_ready',upload_error=NULL,completed_at=$1,updated_at=$1,data_version=data_version+1 WHERE id=$2 RETURNING *", [now, jobId])).rows[0]; await client.query("UPDATE tickets SET status='waiting',updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, locked.work_item_id]); await eventIn(client, finished, "result_ready", "result_ready", `Result ready with ${candidates.length} candidates`); });
  await notifySettled(jobId);
}
async function failJob(jobId: string, error: unknown): Promise<void> { const safe = persistableEmployeeError(error); const now = nowIso(); await postgresTransaction(async client => { const job = (await client.query<Row>("SELECT * FROM crawl_jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0]; if (!job) return; const failed = (await client.query<Row>("UPDATE crawl_jobs SET status='error',error=$1,completed_at=$2,updated_at=$2,data_version=data_version+1 WHERE id=$3 RETURNING *", [safe, now, jobId])).rows[0]; await client.query("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, job.work_item_id]); await eventIn(client, failed, "error", "error", safe); }); await notifySettled(jobId); }
export async function stopCrawl(jobId: string): Promise<Json> { const job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0]; if (!job) throw new HttpFail(404, { code: "crawl_job_not_found", message: "未找到该采集任务。" }); if (!ACTIVE.has(String(job.status))) return publicJob(job); if (!job.remote_task_id) throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" }); await postgresConnection().query("UPDATE crawl_jobs SET status='stopping',updated_at=$1 WHERE id=$2", [nowIso(), jobId]); try { await remoteCall("stop_crawl", { task_id: String(job.remote_task_id) }, jobId); } catch (error) { await failJob(jobId, error); throw error; } const now = nowIso(); await postgresTransaction(async client => { const stopped = (await client.query<Row>("UPDATE crawl_jobs SET status='stopped',completed_at=$1,updated_at=$1,data_version=data_version+1 WHERE id=$2 RETURNING *", [now, jobId])).rows[0]; await client.query("UPDATE tickets SET status='waiting',updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, job.work_item_id]); await eventIn(client, stopped, "stopped", "stopped", "Crawl stopped"); }); await notifySettled(jobId); return await requireCrawlJob(jobId); }
export async function retryUpload(jobId: string): Promise<Json> { const job = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [jobId])).rows[0]; if (!job?.remote_task_id) throw new HttpFail(409, { code: "crawl_job_no_remote_task", message: "采集任务尚未关联远程任务。" }); const result = await remoteCall("upload_creators", { task_id: job.remote_task_id }, jobId); await postgresConnection().query("UPDATE crawl_jobs SET upload_error=NULL,updated_at=$1 WHERE id=$2", [nowIso(), jobId]); await event(jobId, "upload_retried", String(job.status), "Creator upload retried"); return result; }
export async function ingestMediacrawler(body: Json): Promise<Json> {
  const result = await postgresTransaction(async client => (ingestCreatorsIn(client, body)));
  await postgresConnection().query(
    "INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)",
    [nowIso(), "claw", "claw.ingest.mediacrawler", JSON.stringify({ accepted: result.accepted, inserted: result.inserted, updated: result.updated, source: String(body.source || "mediacrawler").slice(0, 120) })],
  );
  return { ok: true, batch_id: null, accepted: result.accepted, inserted: result.inserted, updated: result.updated };
}
export async function clearRemoteHistory(): Promise<Json> { return remoteCall("clear_history", { confirm: true }); }
export async function restoreActiveCrawlJobs(): Promise<void> { clearMonitors(); const rows = (await postgresConnection().query<Row>(`SELECT id,status,remote_task_id FROM crawl_jobs WHERE status=ANY($1::text[])`, [[...ACTIVE]])).rows; for (const row of rows) { if (!row.remote_task_id) await failJob(String(row.id), "Process restarted before remote task id was persisted"); else scheduleMonitor(String(row.id)); } }
export async function crawlJob(id: string): Promise<Json | null> { const row = (await postgresConnection().query<Row>("SELECT * FROM crawl_jobs WHERE id=$1", [id])).rows[0]; return row ? (publicJob(row)) : null; }
async function requireCrawlJob(id: string): Promise<Json> {
  const job = await crawlJob(id);
  if (!job) throw new HttpFail(404, { code: "crawl_job_not_found" });
  return job;
}
export async function crawlEvents(id: string, after = 0): Promise<Json[]> { return (await postgresConnection().query<Row>("SELECT * FROM crawl_job_events WHERE crawl_job_id=$1 AND sequence>$2 ORDER BY sequence", [id, after])).rows.map(row => ({ ...row, payload: parse(row.payload) })); }
