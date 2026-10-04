import { postgresPool } from "../postgres/pool.js";
import { getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import { registerRuntimeActionGate, registerRuntimeToolScope } from "../runtime/action-gates.js";
import { authorizeConnector, runtimeHash, SkillExecution, type RuntimeContext } from "../runtime/execution.js";
import { pgEnqueueExecutionJob, pgExecutionJobPayload } from "../execution-jobs/postgres-store.js";
import { registerExecutionHandler } from "../execution-jobs/handlers.js";
import type { Json } from "../types.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";

const fail = (code: string): never => { throw new HttpFail(409, { code }); };
type Crawl = { id: string; actor_id: string; instance_key: string; context_json: RuntimeContext; config_version: number;
  remote_task_id: string | null; state: string; args_json: Json; created_at: Date };

/** Shared with the retiring entry point so rollout never permits two callers to start concurrently. */
export async function withCrawlerInstanceLock<T>(url: string, run: () => Promise<T>): Promise<T> {
  const client = await postgresPool().connect();
  const key = runtimeHash(url);
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`crawler:${key}`]);
    return await run();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`crawler:${key}`]).catch(() => undefined);
    client.release();
  }
}
export async function assertNoRuntimeCrawl(url: string): Promise<void> {
  const { rows } = await postgresPool().query(`SELECT id FROM runtime_crawl_jobs WHERE instance_key=$1
    AND state IN ('starting','running','stopping','uncertain') LIMIT 1`, [runtimeHash(url)]);
  if (rows.length) fail("runtime_probe_crawl_busy");
}
function validateStart(context: RuntimeContext, args: Json): void {
  authorizeConnector(context, "claw");
  if (context.skillId !== "crawler_collect") fail("runtime_collection_skill_required");
  if (!Array.isArray(args.platforms) || args.platforms.length !== 1 || !["youtube", "instagram", "facebook"].includes(String(args.platforms[0]))) fail("runtime_crawl_platform_invalid");
  if (!["search", "detail", "creator"].includes(String(args.crawler_type))) fail("runtime_crawl_mode_invalid");
  // Additional remote switches may enable uploads or broaden scope; only reviewed fields are accepted.
  if (Object.keys(args).some((key) => !["platforms", "crawler_type", "keywords", "specified_ids", "creator_ids"].includes(key))) fail("runtime_crawl_scope_invalid");
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
async function enqueueMonitor(job: Crawl, sequence: number): Promise<void> {
  await pgEnqueueExecutionJob({ job_type: "crawler.monitor", tenant_ref: "runtime", actor_ref: job.actor_id,
    idempotency_key: `crawler-monitor:${job.id}:${sequence}`, object_ref: { crawl_id: job.id },
    payload: { crawl_id: job.id, sequence }, risk_level: "low", max_attempts: 4,
    next_attempt_at: new Date(Date.now() + 5000).toISOString() });
}

registerRuntimeActionGate("claw", "start_crawl", {
  validate: validateStart,
  async execute(context, args, actionId, dispatch) {
    validateStart(context, args);
    const auth = authorizeConnector(context, "claw");
    const url = auth.configuration.config.url || fail("runtime_connector_not_configured");
    await withCrawlerInstanceLock(url, async () => {
      await assertNoRuntimeCrawl(url);
      const legacy = getConn().prepare(`SELECT id FROM crawl_jobs WHERE status IN
        ('queued','crawling','uploading','analyzing','starting','running','stopping') LIMIT 1`).get();
      if (legacy) fail("runtime_probe_crawl_busy");
      await postgresPool().query(`INSERT INTO runtime_crawl_jobs
        (id,instance_key,actor_id,context_json,config_version,args_json,state)
        VALUES ($1,$2,$3,$4,$5,$6,'starting')`, [actionId, runtimeHash(url), context.userId,
          JSON.stringify(context), auth.configuration.version, JSON.stringify(args)]);
    });
    const job = (await postgresPool().query<Crawl>("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [actionId])).rows[0];
    // Persist recovery dispatch before contacting the remote. The monitor NEVER retries start_crawl.
    await enqueueMonitor(job, 0);
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
    await postgresPool().query("UPDATE runtime_crawl_jobs SET state=$2,receipt_json=$3,updated_at=now() WHERE id=$1 AND state IN ('running','stopping','succeeded')", [job.id, state, JSON.stringify(receipt)]);
    return raw;
  },
});
registerRuntimeToolScope("claw", async (context, tool, args) => {
  if (tool === "start_crawl") { validateStart(context, args); return; }
  if (["get_crawl_status", "get_crawl_logs", "get_creators", "stop_crawl"].includes(tool)) { await ownedTask(context, args); return; }
  fail("runtime_crawl_tool_scope_unregistered");
});

export async function monitorRuntimeCrawl(executionJob: ClaimedExecutionJob, checkpoint: () => Promise<void>,
  createRuntime = (context: RuntimeContext) => new SkillExecution(context)): Promise<Json> {
  const payload = pgExecutionJobPayload(executionJob);
  const job = (await postgresPool().query<Crawl>("SELECT * FROM runtime_crawl_jobs WHERE id=$1", [payload.crawl_id])).rows[0];
  if (!job || !["starting", "running", "stopping"].includes(job.state)) return { state: job?.state || "not_found" };
  const sequence = Number(payload.sequence || 0);
  if (Date.now() - new Date(job.created_at).getTime() > 2 * 60 * 60 * 1000) {
    await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='monitor_deadline',updated_at=now() WHERE id=$1", [job.id]);
    return { state: "uncertain" };
  }
  if (!job.remote_task_id) {
    if (sequence >= 12) {
      await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='start_outcome_unknown',updated_at=now() WHERE id=$1 AND remote_task_id IS NULL", [job.id]);
    } else await enqueueMonitor(job, sequence + 1);
    return { state: "waiting_for_start_receipt" };
  }
  const runtime = createRuntime(job.context_json);
  try {
    await checkpoint();
    const catalog = await runtime.discover();
    const statusTool = catalog.tools.find((tool) => tool.connectorId === "claw" && tool.remoteName === "get_crawl_status");
    if (!statusTool) fail("runtime_crawl_status_unavailable");
    const raw = await runtime.invoke(String(statusTool!.exposed.name), { task_id: job.remote_task_id });
    if (raw.isError) fail("runtime_crawl_status_failed");
    const status = normalizeMcpContent(raw);
    const value = String(status.status || (status.data as Json | undefined)?.status || status.state || "").toLowerCase();
    // idle alone is not proof that this particular task completed.
    if (String(status.task_id || "") !== job.remote_task_id) fail("runtime_crawl_task_mismatch");
    const terminal = value === "idle" ? (status.error_message ? "failed" : job.state === "stopping" ? "cancelled" : "succeeded")
      : ["completed", "done", "succeeded"].includes(value) ? "succeeded"
      : ["failed", "error"].includes(value) ? "failed" : ["stopped", "cancelled", "canceled"].includes(value) ? "cancelled" : null;
    await checkpoint();
    await postgresPool().query(`UPDATE runtime_crawl_jobs SET state=COALESCE($2,state),status_json=$3,
      receipt_json=CASE WHEN $2::text IS NULL THEN receipt_json ELSE $3 END,updated_at=now() WHERE id=$1
      AND state IN ('starting','running','stopping')`, [job.id, terminal, JSON.stringify(status)]);
    if (!terminal) await enqueueMonitor(job, sequence + 1);
    return { crawl_id: job.id, state: terminal || value || "running" };
  } catch (error) {
    if (Number(executionJob.attempts) >= Number(executionJob.max_attempts)) {
      await postgresPool().query("UPDATE runtime_crawl_jobs SET state='uncertain',error_code='monitor_requires_takeover',updated_at=now() WHERE id=$1 AND state IN ('starting','running','stopping')", [job.id]);
    }
    throw error;
  } finally { runtime.close(); }
}
registerExecutionHandler("crawler.monitor", monitorRuntimeCrawl);
