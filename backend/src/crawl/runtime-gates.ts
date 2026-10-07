import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import { registerRuntimeActionGate, registerRuntimeToolScope, registerRuntimeToolPresentation } from "../runtime/action-gates.js";
import { START_FIELDS, crawlToolPresentation } from "./tool-contract.js";
import { enqueueCrawlResults } from "./results.js";
import { authorizeConnector, createConfiguredClient, runtimeHash, SkillExecution, type RuntimeContext } from "../runtime/execution.js";
import type { RuntimeRemote } from "../runtime/execution.js";
import { RemoteMcpClient, type RemoteMcpOptions } from "../mcp/remote.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload } from "../execution-jobs/postgres-store.js";
import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import type { Json } from "../types.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";

const fail = (code: string): never => { throw new HttpFail(409, { code }); };
registerRuntimeToolPresentation("claw", crawlToolPresentation);
type Crawl = { id: string; actor_id: string; instance_key: string; context_json: RuntimeContext; config_version: number;
  remote_task_id: string | null; state: string; args_json: Json; created_at: Date };

/** Shared with the retiring entry point so rollout never permits two callers to start concurrently. */
export async function withCrawlerInstanceLock<T>(url: string, run: () => Promise<T>): Promise<T> {
  return withCrawlerInstanceKeyLock(runtimeHash(url), run);
}
/** Instance-key variant: the advisory lock name is `crawler:<instance_key>`, so queue drain
 *  (which only knows the instance key) takes the same lock as the start path (which knows the URL). */
export async function withCrawlerInstanceKeyLock<T>(instanceKey: string, run: () => Promise<T>): Promise<T> {
  const client = await postgresPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`crawler:${instanceKey}`]);
    return await run();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`crawler:${instanceKey}`]).catch(() => undefined);
    client.release();
  }
}
export async function assertNoRuntimeCrawl(url: string): Promise<void> {
  if (await hasActiveRuntimeCrawl(runtimeHash(url))) fail("runtime_probe_crawl_busy");
}
async function hasActiveRuntimeCrawl(instanceKey: string, client?: PoolClient): Promise<boolean> {
  const sql = `SELECT id FROM runtime_crawl_jobs WHERE instance_key=$1
    AND state IN ${ACTIVE_RUNTIME_STATES} LIMIT 1`;
  const rows = client ? (await client.query(sql, [instanceKey])).rows
    : (await postgresPool().query(sql, [instanceKey])).rows;
  return rows.length > 0;
}

/** 采集排队与自动停止的调参（环境变量覆盖，均有保守默认值）。 */
const numEnv = (name: string, def: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const CRAWLER_QUEUE_MAX_DEPTH = Math.max(1, Math.floor(numEnv("CRAWLER_QUEUE_MAX_DEPTH", 20)));
const CRAWLER_QUEUE_MAX_WAIT_MS = numEnv("CRAWLER_QUEUE_MAX_WAIT_MS", 24 * 60 * 60 * 1000);
const CRAWLER_POLL_FAST_MS = numEnv("CRAWLER_POLL_FAST_MS", 5000);
const CRAWLER_POLL_SLOW_AFTER_MS = numEnv("CRAWLER_POLL_SLOW_AFTER_MS", 10 * 60 * 1000);
const CRAWLER_POLL_SLOW_MS = numEnv("CRAWLER_POLL_SLOW_MS", 30000);
const CRAWLER_MONITOR_MAX_MS = numEnv("CRAWLER_MONITOR_MAX_MS", 2 * 60 * 60 * 1000);
const CRAWLER_UNCERTAIN_RECONCILE_MS = numEnv("CRAWLER_UNCERTAIN_RECONCILE_MS", 5 * 60 * 1000);
const CRAWLER_UNCERTAIN_MAX_MS = numEnv("CRAWLER_UNCERTAIN_MAX_MS", 24 * 60 * 60 * 1000);
// 无远端任务号的 uncertain：无从对账，1h 后直接判失败释放队列（有任务号的才值得等 24h）。
const CRAWLER_UNCERTAIN_NO_TASK_MAX_MS = numEnv("CRAWLER_UNCERTAIN_NO_TASK_MAX_MS", 60 * 60 * 1000);
const CRAWLER_STARTER_MAX_ATTEMPTS = 3;

const ACTIVE_RUNTIME_STATES = "('starting','running','stopping','uncertain')";

async function queueDepth(instanceKey: string): Promise<number> {
  const { rows } = await postgresPool().query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM runtime_crawl_jobs WHERE instance_key=$1 AND state='queued'`, [instanceKey]);
  return Number(rows[0]?.n || 0);
}

/** 当前排队位置（1-based；调用方应在实例锁内调用以保证与入队计数的原子性）。 */
export async function crawlQueuePosition(instanceKey: string, jobId: string): Promise<number> {
  // 字典序等价写法（避免行构造子比较在部分驱动/模拟库中的兼容问题）：
  // created_at 更早，或同毫秒下 id 更小（id 含时间有序前缀），即排在前面。
  const { rows } = await postgresPool().query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM runtime_crawl_jobs q
     WHERE q.instance_key=$1 AND q.state='queued'
       AND (q.created_at < (SELECT created_at FROM runtime_crawl_jobs WHERE id=$2)
         OR (q.created_at = (SELECT created_at FROM runtime_crawl_jobs WHERE id=$2) AND q.id <= $2))`,
    [instanceKey, jobId]);
  return Number(rows[0]?.n || 0);
}
function validateStart(context: RuntimeContext, args: Json): void {
  authorizeConnector(context, "claw");
  if (context.skillId !== "crawler_collect") fail("runtime_collection_skill_required");
  if (!Array.isArray(args.platforms) || args.platforms.length !== 1 || !["youtube", "instagram", "facebook"].includes(String(args.platforms[0]))) fail("runtime_crawl_platform_invalid");
  if (!["search", "detail", "creator"].includes(String(args.crawler_type))) fail("runtime_crawl_mode_invalid");
  // Additional remote switches may enable uploads or broaden scope; only reviewed fields are accepted.
  if (Object.keys(args).some((key) => !START_FIELDS.includes(key))) fail("runtime_crawl_scope_invalid");
  if (args.max_notes_count !== undefined && (!Number.isSafeInteger(args.max_notes_count)
    || Number(args.max_notes_count) < 1 || Number(args.max_notes_count) > 10000)) fail("runtime_crawl_scope_invalid");
  if (["enable_comments", "enable_sub_comments"].some(key => args[key] !== undefined && args[key] !== false)) fail("runtime_crawl_scope_invalid");
  const required = args.crawler_type === "search" ? "keywords" : args.crawler_type === "detail" ? "specified_ids" : "creator_ids";
  if (typeof args[required] !== "string" || !String(args[required]).trim()) fail("runtime_crawl_input_required");
}
async function ownedTask(context: RuntimeContext, args: Json): Promise<Crawl> {
  authorizeConnector(context, "claw");
  if (typeof args.task_id !== "string" || !args.task_id) fail("runtime_crawl_task_required");
  const { rows } = await postgresPool().query<Crawl>(`SELECT * FROM runtime_crawl_jobs WHERE actor_id=$1 AND remote_task_id=$2`, [context.userId, args.task_id]);
  const job = rows[0];
  if (!job || job.context_json.agentId !== context.agentId) fail("runtime_crawl_scope_denied");
  if (job.instance_key !== runtimeHash(authorizeConnector(context, "claw").configuration.config.url)) fail("runtime_crawl_configuration_changed");
  return job;
}
async function enqueueMonitor(job: Crawl, sequence: number, client?: PoolClient): Promise<void> {
  // 轮询退避：启动后 10 分钟内 5s 高频（远端任务通常 30min 内结束），之后降为 30s，
  // 避免长尾任务持续高频写入事件（历史上有单任务 415k 行事件的事故）。
  const ageMs = Date.now() - new Date(job.created_at).getTime();
  const delayMs = ageMs < CRAWLER_POLL_SLOW_AFTER_MS ? CRAWLER_POLL_FAST_MS : CRAWLER_POLL_SLOW_MS;
  await pgEnqueueExecutionJob({ job_type: "crawler.monitor", tenant_ref: "runtime", actor_ref: job.actor_id,
    idempotency_key: `crawler-monitor:${job.id}:${sequence}`, object_ref: { crawl_id: job.id },
    payload: { crawl_id: job.id, sequence }, risk_level: "low", max_attempts: 4,
    next_attempt_at: new Date(Date.now() + delayMs).toISOString() }, { client });
}

/** uncertain 对账：低频（默认 5min）复查远端，直到拿到终态或达到 24h 上限。 */
async function enqueueReconcile(crawlId: string, actorId: string, client?: PoolClient): Promise<void> {
  await pgEnqueueExecutionJob({ job_type: "crawler.reconcile", tenant_ref: "runtime", actor_ref: actorId,
    idempotency_key: `crawler-reconcile:${crawlId}:${Date.now()}`, object_ref: { crawl_id: crawlId },
    payload: { crawl_id: crawlId }, risk_level: "low", max_attempts: 3,
    next_attempt_at: new Date(Date.now() + CRAWLER_UNCERTAIN_RECONCILE_MS).toISOString() },
    { client, deduplicate_active: true });
}

/** 兜底 sweep：每小时一次，清理超时排队、复活卡死的 starting、触发漏掉的出队。 */
async function ensureSweepScheduled(instanceKey: string, actorId: string): Promise<void> {
  await pgEnqueueExecutionJob({ job_type: "crawler.sweep", tenant_ref: "runtime", actor_ref: actorId,
    idempotency_key: `crawler-sweep:${instanceKey}`, object_ref: { instance_key: instanceKey },
    payload: { instance_key: instanceKey }, risk_level: "low", max_attempts: 3,
    next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    { deduplicate_active: true });
}

registerRuntimeActionGate("claw", "start_crawl", {
  validate: validateStart,
  async execute(context, args, actionId, dispatch) {
    validateStart(context, args);
    const auth = authorizeConnector(context, "claw");
    const url = auth.configuration.config.url || fail("runtime_connector_not_configured");
    const instanceKey = runtimeHash(url);
    // 忙时不再拒绝：写入 queued 等待，前序任务到终态后由 drain 自动启动（ADR-2026-09-30 的入队口径）。
    // FIFO：只要有排队在前，新请求一律入队（即使当前无活跃任务），避免插队。
    const queuedReceipt = await withCrawlerInstanceKeyLock(instanceKey, async () => {
      const legacy = await postgresPool().query(`SELECT id FROM crawl_jobs WHERE status IN
        ('queued','crawling','uploading','analyzing','starting','running','stopping') LIMIT 1`);
      const busy = await hasActiveRuntimeCrawl(instanceKey) || legacy.rows.length > 0;
      const depth = await queueDepth(instanceKey);
      if (!busy && depth === 0) {
        await postgresTransaction(async client => {
          const inserted = await client.query<Crawl>(`INSERT INTO runtime_crawl_jobs
            (id,instance_key,actor_id,context_json,config_version,args_json,state)
            VALUES ($1,$2,$3,$4,$5,$6,'starting') RETURNING *`, [actionId, instanceKey, context.userId,
              JSON.stringify(context), auth.configuration.version, JSON.stringify(args)]);
          // The reserved collection and its recovery dispatch commit together before contacting the remote.
          await enqueueMonitor(inserted.rows[0], 0, client);
        });
        return null;
      }
      if (depth >= CRAWLER_QUEUE_MAX_DEPTH) fail("runtime_probe_crawl_busy");
      await postgresPool().query(`INSERT INTO runtime_crawl_jobs
        (id,instance_key,actor_id,context_json,config_version,args_json,state)
        VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
        [actionId, instanceKey, context.userId, JSON.stringify(context), auth.configuration.version, JSON.stringify(args)]);
      await ensureSweepScheduled(instanceKey, context.userId);
      return { ok: true, queued: true, queue_position: depth + 1, instance_key: instanceKey };
    });
    if (queuedReceipt) return queuedReceipt;
    try {
      const raw = await dispatch();
      const receipt = normalizeMcpContent(raw);
      const taskId = String(receipt.task_id || receipt.id || (receipt.data as Json | undefined)?.task_id || "");
      if (raw.isError || receipt.ok === false || !taskId) fail("runtime_crawl_start_uncertain");
      await postgresPool().query(`UPDATE runtime_crawl_jobs SET remote_task_id=$2,state='running',updated_at=now()
        WHERE id=$1 AND state='starting'`, [actionId, taskId]);
      return raw;
    } catch (error) {
      await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='start_outcome_unknown',updated_at=now() WHERE id=$1", [actionId]);
      throw error;
    }
  },
});
registerRuntimeActionGate("claw", "stop_crawl", {
  async validate(context, args) {
    const job = await ownedTask(context, args);
    if (!["running", "stopping"].includes(job.state)) fail("runtime_crawl_not_running");
  },
  async execute(context, args, _id, dispatch) {
    const job = await ownedTask(context, args);
    const raw = await dispatch();
    // A stop acknowledgement is not a terminal crawl result. The monitor verifies the terminal state.
    const receipt = normalizeMcpContent(raw);
    if (raw.isError || receipt.ok === false || receipt.task_id !== job.remote_task_id) fail("runtime_crawl_stop_unconfirmed");
    const state = receipt.status === "idle" ? "cancelled" : "stopping";
    await postgresTransaction(async client => {
      const changed = await client.query("UPDATE runtime_crawl_jobs SET state=$2,receipt_json=$3,updated_at=now() WHERE id=$1 AND state IN ('running','stopping') RETURNING id", [job.id, state, JSON.stringify(receipt)]);
      if (changed.rowCount && state === "cancelled") await enqueueCrawlResults(job.id, job.actor_id, "initial", client);
    });
    return raw;
  },
});
registerRuntimeToolScope("claw", async (context, tool, args) => {
  if (tool === "start_crawl") { validateStart(context, args); return; }
  if (["get_crawl_status", "get_crawl_logs", "get_creators", "stop_crawl"].includes(tool)) { await ownedTask(context, args); return; }
  fail("runtime_crawl_tool_scope_unregistered");
});

type RemoteCrawlTerminal = "succeeded" | "failed" | "cancelled" | null;

/** 查询远端任务状态并判定终态。抽出供 monitor 与 reconcile 共用（createRuntime 是测试接缝）。 */
async function fetchRemoteCrawlStatus(job: Crawl,
  createRuntime: (context: RuntimeContext) => SkillExecution
): Promise<{ terminal: RemoteCrawlTerminal; value: string; status: Json }> {
  const runtime = createRuntime(job.context_json);
  try {
    const catalog = await runtime.discover();
    const statusTool = catalog.tools.find((tool) => tool.connectorId === "claw" && tool.remoteName === "get_crawl_status");
    if (!statusTool) fail("runtime_crawl_status_unavailable");
    const raw = await runtime.invoke(String(statusTool!.exposed.name), { task_id: job.remote_task_id });
    if (raw.isError) fail("runtime_crawl_status_failed");
    const status = normalizeMcpContent(raw);
    const value = String(status.status || (status.data as Json | undefined)?.status || status.state || "").toLowerCase();
    // idle alone is not proof that this particular task completed.
    if (String(status.task_id || "") !== job.remote_task_id) fail("runtime_crawl_task_mismatch");
    const terminal: RemoteCrawlTerminal = value === "idle"
      ? (status.error_message ? "failed" : job.state === "stopping" ? "cancelled" : "succeeded")
      : ["completed", "done", "succeeded"].includes(value) ? "succeeded"
      : ["failed", "error", "timeout", "timed_out"].includes(value) ? "failed"
      : ["stopped", "cancelled", "canceled"].includes(value) ? "cancelled" : null;
    return { terminal, value, status };
  } finally { runtime.close(); }
}

/** 直调连接器 MCP 工具（start_crawl / stop_crawl），绕过 SkillExecution 的确认流程。
 *  后台 handler 调用前必须已完成 validateStart + authorizeConnector（用户在入队时已确认，
 *  出队只是履约，不应再次弹窗确认）。 */
async function callRemoteCrawlTool(context: RuntimeContext, tool: "start_crawl" | "stop_crawl", args: Json,
  mcpFactory: (options: RemoteMcpOptions) => RuntimeRemote = (options) => new RemoteMcpClient(options)): Promise<Json> {
  const auth = authorizeConnector(context, "claw");
  const client = createConfiguredClient(context, auth.configuration.config, mcpFactory);
  try {
    const raw = await client.callToolRaw(tool, args);
    if (raw.isError) throw new Error(`remote ${tool} returned error`);
    return normalizeMcpContent(raw);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function sanitizeReceipt(value: Json): string {
  return JSON.stringify(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***")
    .slice(0, 4000);
}

/** T2 自动停止：监控超时后先尝试远端取消，成功则终态 cancelled 并出队；
 *  远端无响应则转 uncertain + 低频对账（T3），不再永久占位。 */
async function autoStopCrawl(job: Crawl): Promise<Json> {
  if (!job.remote_task_id) {
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='uncertain',error_code='monitor_deadline',
      updated_at=now() WHERE id=$1 AND state IN ${ACTIVE_RUNTIME_STATES}`, [job.id]);
    await enqueueReconcile(job.id, job.actor_id);
    return { state: "uncertain", reason: "monitor_deadline_no_remote_task" };
  }
  try {
    const receipt = await callRemoteCrawlTool(job.context_json, "stop_crawl", { task_id: String(job.remote_task_id) });
    // 远端确认停止即视为终态（与 legacy stopCrawl 的 'stopped' 语义一致），释放队列。
    await postgresTransaction(async client => {
      const changed = await client.query(`UPDATE runtime_crawl_jobs SET state='cancelled',receipt_json=$2,
        error_code='monitor_auto_stop',updated_at=now() WHERE id=$1 AND state IN ${ACTIVE_RUNTIME_STATES} RETURNING id`,
        [job.id, sanitizeReceipt(receipt)]);
      if (changed.rowCount) await enqueueCrawlResults(job.id, job.actor_id, "initial", client);
    });
    await drainCrawlQueue(job.instance_key);
    return { state: "cancelled", reason: "monitor_auto_stop" };
  } catch {
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='uncertain',error_code='monitor_auto_stop_failed',
      updated_at=now() WHERE id=$1 AND state IN ${ACTIVE_RUNTIME_STATES}`, [job.id]);
    await enqueueReconcile(job.id, job.actor_id);
    return { state: "uncertain", reason: "monitor_auto_stop_failed" };
  }
}

/** 出队：同一实例的活跃任务到终态后，为最早的 queued 任务派发 starter。
 *  状态翻转（queued→starting）由 starter 原子完成，避免 drain 与 starter 之间的竞态；
 *  starter 派发做了 deduplicate_active，重复 drain 不会重复派发。
 *  必须在实例锁内执行，保证同时只跑一个（07-mcp-data-contract.md:41 的单任务不变量）。 */
export async function drainCrawlQueue(instanceKey: string): Promise<void> {
  await withCrawlerInstanceKeyLock(instanceKey, async () => {
    await postgresTransaction(async client => {
      // T4：取消等待超时的排队，避免僵尸排队（截止时间在 JS 侧计算，避免 SQL interval 算术的兼容问题）。
      const queueCutoff = new Date(Date.now() - CRAWLER_QUEUE_MAX_WAIT_MS).toISOString();
      await client.query(`UPDATE runtime_crawl_jobs SET state='cancelled', error_code='queue_timeout', updated_at=now()
        WHERE instance_key=$1 AND state='queued' AND created_at < $2`,
        [instanceKey, queueCutoff]);
      const active = await client.query(`SELECT id FROM runtime_crawl_jobs WHERE instance_key=$1
        AND state IN ${ACTIVE_RUNTIME_STATES} LIMIT 1`, [instanceKey]);
      // 与 start 门禁一致：legacy 通道的活跃任务同样占用远端（单任务不变量）。
      const legacyActive = await client.query(`SELECT id FROM crawl_jobs WHERE status IN
        ('queued','crawling','uploading','analyzing','starting','running','stopping') LIMIT 1`);
      if (active.rows.length || legacyActive.rows.length) return;
      const next = await client.query<{ id: string; actor_id: string }>(
        `SELECT id, actor_id FROM runtime_crawl_jobs WHERE instance_key=$1 AND state='queued'
         ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`, [instanceKey]);
      if (!next.rows.length) return;
      const target = next.rows[0];
      await pgEnqueueExecutionJob({ job_type: "crawler.starter", tenant_ref: "runtime", actor_ref: target.actor_id,
        idempotency_key: `crawler-starter:${target.id}`, object_ref: { crawl_id: target.id },
        payload: { crawl_id: target.id }, risk_level: "low", max_attempts: CRAWLER_STARTER_MAX_ATTEMPTS,
        next_attempt_at: new Date().toISOString() }, { client, deduplicate_active: true });
    });
  });
}

export async function monitorRuntimeCrawl(executionJob: ClaimedExecutionJob, checkpoint: () => Promise<void>,
  createRuntime = (context: RuntimeContext) => new SkillExecution(context)): Promise<Json> {
  const payload = pgExecutionJobPayload(executionJob);
  const job = (await postgresPool().query<Crawl>("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [payload.crawl_id])).rows[0];
  if (!job || !["starting", "running", "stopping"].includes(job.state)) return { state: job?.state || "not_found" };
  const sequence = Number(payload.sequence || 0);
  if (Date.now() - new Date(job.created_at).getTime() > CRAWLER_MONITOR_MAX_MS) {
    return autoStopCrawl(job);
  }
  if (!job.remote_task_id) {
    if (sequence >= 12) {
      await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='start_outcome_unknown',updated_at=now() WHERE id=$1 AND remote_task_id IS NULL", [job.id]);
      await enqueueReconcile(job.id, job.actor_id);
    } else await enqueueMonitor(job, sequence + 1);
    return { state: "waiting_for_start_receipt" };
  }
  try {
    await checkpoint();
    const { terminal, value, status } = await fetchRemoteCrawlStatus(job, createRuntime);
    await checkpoint();
    await postgresTransaction(async client => {
      const changed = await client.query(`UPDATE runtime_crawl_jobs SET state=COALESCE($2,state),status_json=$3,
        receipt_json=CASE WHEN $2::text IS NULL THEN receipt_json ELSE $3 END,
        error_code=CASE WHEN $2='failed' THEN $4 ELSE error_code END,updated_at=now() WHERE id=$1
        AND state IN ('starting','running','stopping') RETURNING id`, [job.id, terminal, JSON.stringify(status),
          ["timeout", "timed_out"].includes(value) ? "runtime_crawl_timeout" : "runtime_crawl_failed"]);
      if (!changed.rowCount) return;
      if (terminal && ["succeeded", "cancelled"].includes(terminal)) await enqueueCrawlResults(job.id, job.actor_id, "initial", client);
      if (!terminal) await enqueueMonitor(job, sequence + 1, client);
    });
    if (terminal) await drainCrawlQueue(job.instance_key);
    return { crawl_id: job.id, state: terminal || value || "running" };
  } catch (error) {
    if (Number(executionJob.attempts) >= Number(executionJob.max_attempts)) {
      await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='monitor_requires_takeover',updated_at=now() WHERE id=$1 AND state IN ('starting','running','stopping')", [job.id]);
      await enqueueReconcile(job.id, job.actor_id);
    }
    throw error;
  }
}
registerExecutionHandler("crawler.monitor", monitorRuntimeCrawl);

/** starter：把 drain 选中的 queued 任务真正启动。出队前重校验参数、连接器配置与
 *  Agent/技能使用资格（PROD-AGENT-09：组织或绑定变化后再次执行须重验）。 */
async function starterHandler(executionJob: ClaimedExecutionJob, checkpoint: () => Promise<void>,
  mcpFactory: (options: RemoteMcpOptions) => RuntimeRemote = (options) => new RemoteMcpClient(options)): Promise<Json> {
  const payload = pgExecutionJobPayload(executionJob);
  const job = (await postgresPool().query<Crawl>("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [payload.crawl_id])).rows[0];
  if (!job) return { state: "not_found" };
  if (job.state !== "queued") return { state: job.state };
  const context = job.context_json as RuntimeContext;
  const args = job.args_json as Json;
  try {
    validateStart(context, args);
    authorizeConnector(context, "claw");
  } catch {
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='cancelled', error_code='queue_start_rejected',
      updated_at=now() WHERE id=$1 AND state='queued'`, [job.id]);
    await drainCrawlQueue(job.instance_key);
    return { state: "cancelled", reason: "revalidation_failed" };
  }
  const adopted = await withCrawlerInstanceKeyLock(job.instance_key, async () => {
    if (await hasActiveRuntimeCrawl(job.instance_key)) return false;
    const changed = await postgresPool().query(
      `UPDATE runtime_crawl_jobs SET state='starting', updated_at=now() WHERE id=$1 AND state='queued'`, [job.id]);
    return (changed.rowCount || 0) > 0;
  });
  if (!adopted) return { state: "queued", reason: "instance_busy" };
  await enqueueMonitor({ ...job, state: "starting" }, 0);
  try {
    await checkpoint();
    const receipt = await callRemoteCrawlTool(context, "start_crawl", args, mcpFactory);
    const taskId = String(receipt.task_id || receipt.id || (receipt.data as Json | undefined)?.task_id || "");
    if (!taskId) throw new Error("start_crawl returned no task_id");
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET remote_task_id=$2,state='running',updated_at=now()
      WHERE id=$1 AND state='starting'`, [job.id, taskId]);
    return { state: "running", remote_task_id: taskId };
  } catch (error) {
    // 远端启动结果未知时沿用 uncertain 语义（TECH-BE-04：超时但可能已提交时不能盲重试），由 reconcile 对账；
    // 重试的 attempt 会因 state 已非 queued 而直接返回，不会重复派发。用户可手动取消 uncertain 释放占位。
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='uncertain', error_code='start_outcome_unknown',
      updated_at=now() WHERE id=$1 AND state='starting'`, [job.id]);
    await enqueueReconcile(job.id, job.actor_id);
    throw error;
  }
}
registerExecutionHandler("crawler.starter", starterHandler);

/** reconcile（T3）：uncertain 任务的低频对账。有远端任务号就查远端拿终态；
 *  24h 仍不明则判 failed(monitor_abandoned) 并出队，不永久占位。 */
async function reconcileHandler(executionJob: ClaimedExecutionJob, checkpoint: () => Promise<void>): Promise<Json> {
  const payload = pgExecutionJobPayload(executionJob);
  const job = (await postgresPool().query<Crawl>("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [payload.crawl_id])).rows[0];
  if (!job) return { state: "not_found" };
  if (job.state !== "uncertain") return { state: job.state };
  if (Date.now() - new Date(job.created_at).getTime() > CRAWLER_UNCERTAIN_MAX_MS) {
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='failed', error_code='monitor_abandoned',
      updated_at=now() WHERE id=$1 AND state='uncertain'`, [job.id]);
    await drainCrawlQueue(job.instance_key);
    return { state: "failed", reason: "monitor_abandoned" };
  }
  if (!job.remote_task_id) {
    // 无远端任务号：无法对账。1h 后直接判失败释放队列（用户可重试）；有任务号的才值得等 24h。
    if (Date.now() - new Date(job.created_at).getTime() > CRAWLER_UNCERTAIN_NO_TASK_MAX_MS) {
      await postgresPool().query(`UPDATE runtime_crawl_jobs SET state='failed', error_code='monitor_abandoned',
        updated_at=now() WHERE id=$1 AND state='uncertain'`, [job.id]);
      await drainCrawlQueue(job.instance_key);
      return { state: "failed", reason: "monitor_abandoned_no_task" };
    }
    await enqueueReconcile(job.id, job.actor_id);
    return { state: "uncertain", reason: "no_remote_task_id" };
  }
  try {
    await checkpoint();
    const { terminal, status } = await fetchRemoteCrawlStatus(job, (context) => new SkillExecution(context));
    if (!terminal) {
      await enqueueReconcile(job.id, job.actor_id);
      return { state: "uncertain", reason: "remote_still_active" };
    }
    await postgresTransaction(async client => {
      const changed = await client.query(`UPDATE runtime_crawl_jobs SET state=$2, status_json=$3,
        receipt_json=$3, error_code=CASE WHEN $2='failed' THEN 'runtime_crawl_failed' ELSE error_code END,
        updated_at=now() WHERE id=$1 AND state='uncertain' RETURNING id`,
        [job.id, terminal, JSON.stringify(status)]);
      if (changed.rowCount && ["succeeded", "cancelled"].includes(terminal)) {
        await enqueueCrawlResults(job.id, job.actor_id, "initial", client);
      }
    });
    await drainCrawlQueue(job.instance_key);
    return { state: terminal, reason: "reconciled" };
  } catch {
    // 对账本身持续失败：保持 uncertain，靠 24h 上限兜底，不抛异常避免无意义重试风暴。
    return { state: "uncertain", reason: "reconcile_failed" };
  }
}
registerExecutionHandler("crawler.reconcile", reconcileHandler);

/** sweep：每小时兜底。清理超时排队（T4）、复活卡死的 starting、触发漏掉的出队；
 *  还有排队才续约，否则停止链条（下一次入队会重新起链）。 */
async function sweepHandler(executionJob: ClaimedExecutionJob): Promise<Json> {
  const payload = pgExecutionJobPayload(executionJob);
  const instanceKey = String(payload.instance_key || "");
  if (!instanceKey) return { state: "skipped" };
  const queueCutoff = new Date(Date.now() - CRAWLER_QUEUE_MAX_WAIT_MS).toISOString();
  const stalledCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await postgresTransaction(async client => {
    await client.query(`UPDATE runtime_crawl_jobs SET state='cancelled', error_code='queue_timeout', updated_at=now()
      WHERE instance_key=$1 AND state='queued' AND created_at < $2`, [instanceKey, queueCutoff]);
    // starter 崩溃且未回 queued 的极端情况：starting 超 30min 无 remote_task_id 则打回排队。
    await client.query(`UPDATE runtime_crawl_jobs SET state='queued', error_code='starter_stalled', updated_at=now()
      WHERE instance_key=$1 AND state='starting' AND remote_task_id IS NULL AND updated_at < $2`,
      [instanceKey, stalledCutoff]);
  });
  await drainCrawlQueue(instanceKey);
  const pending = await postgresPool().query(`SELECT actor_id FROM runtime_crawl_jobs
    WHERE instance_key=$1 AND state='queued' LIMIT 1`, [instanceKey]);
  if (pending.rows.length) await ensureSweepScheduled(instanceKey, String(pending.rows[0].actor_id));
  return { state: "swept" };
}
registerExecutionHandler("crawler.sweep", sweepHandler);
