import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";
import { authorizeConnector, SkillExecution } from "./execution.js";
import { randomUUID } from "node:crypto";
import { runtimeAction, type RuntimeAction } from "./action-store.js";
import { runtimeActionGate, validateRuntimeToolScope } from "./action-gates.js";
import type { Operation } from "./operations.js";
import { pgEnqueueExecutionJob, pgExecutionJobPublic } from "../execution-jobs/postgres-store.js";
import { enqueueCrawlResults } from "../crawl/results.js";
import { canRetryRuntimeCrawl, runtimeActionProgress } from "./action-progress.js";
import { runtimeCandidateViews } from "../crawl/candidate-actions.js";
import { crawlQueuePosition, drainCrawlQueue } from "../crawl/runtime-gates.js";

function actor(): string {
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  return user.id;
}
async function view(action: RuntimeAction) {
  authorizeConnector(action.context_json, action.connector_id);
  let blocked: string | null = null;
  try { if (action.state === "pending") await runtimeActionGate(action.connector_id, action.tool_name).validate(action.context_json, action.args_json); }
  catch { blocked = "此动作仍需业务范围或审批校验，请使用对应业务操作入口。"; }
  const crawl = (await postgresPool().query(`SELECT id,remote_task_id,state,status_json,error_code,result_state,result_json,result_error,
    instance_key,created_at FROM runtime_crawl_jobs
    WHERE id=$1 AND actor_id=$2`, [action.id, action.actor_id])).rows[0] || null;
  if (crawl?.state === "queued" && crawl.instance_key) {
    try { crawl.queue_position = await crawlQueuePosition(String(crawl.instance_key), String(crawl.id)); }
    catch { /* 位置查询失败不影响主流程 */ }
  }
  const execution = (await postgresPool().query(`SELECT id,status,error_code FROM execution_jobs WHERE idempotency_key=$1 AND actor_ref=$2`,
    [`runtime-confirm:${action.id}`, action.actor_id])).rows[0] || null;
  const events = (await postgresPool().query("SELECT sequence::text,source,state,recorded_at FROM runtime_action_events WHERE action_id=$1 ORDER BY sequence", [action.id])).rows;
  if (crawl?.result_json?.candidates) crawl.result_json = { ...crawl.result_json,
    candidates: await runtimeCandidateViews(action.context_json, action.id, crawl.result_json.candidates) };
  return { id: action.id, skill_id: action.context_json.skillId, operation: action.tool_name,
    created_at: action.created_at, updated_at: action.updated_at, actor_name: scopedUser()?.name,
    events,
    arguments: action.args_json, state: action.state, risk: "L3", confirmation_version: action.snapshot,
    blocked_reason: blocked, receipt: action.receipt_json, error_code: action.error_code, crawl, execution,
    run_id: action.context_json.originRunId || action.context_json.runId, progress: action.connector_id === "claw" && action.tool_name === "start_crawl"
      ? runtimeActionProgress(action, crawl, execution) : null,
    can_retry: action.tool_name === "start_crawl" && canRetryRuntimeCrawl(action, crawl) };
}
export const runtimeActionOperations: Operation[] = [
  { id: "runtime.crawl.results.retry", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    authorizeConnector(action.context_json, action.connector_id);
    const crawl = (await postgresPool().query("SELECT state,result_state FROM runtime_crawl_jobs WHERE id=$1 AND actor_id=$2", [action.id, action.actor_id])).rows[0];
    if (!crawl || !["succeeded", "cancelled"].includes(crawl.state) || !["failed", "partial"].includes(crawl.result_state)) throw new HttpFail(409, { code: "crawl_result_not_retryable" });
    // Read-only recovery; retry a failed result read, never start another remote collection.
    await enqueueCrawlResults(action.id, action.actor_id, `retry:${randomUUID()}`);
    return c.json({ state: "queued" }, 202);
  } },
  { id: "runtime.crawl.stop", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    const crawl = (await postgresPool().query("SELECT remote_task_id,state FROM runtime_crawl_jobs WHERE id=$1 AND actor_id=$2", [action.id, action.actor_id])).rows[0];
    if (!crawl?.remote_task_id || !["running", "stopping"].includes(crawl.state)) throw new HttpFail(409, { code: "runtime_crawl_not_running" });
    const runtime = new SkillExecution({ ...action.context_json, runId: `stop:${action.id}` });
    try {
      const tool = (await runtime.discover()).tools.find((item) => item.connectorId === "claw" && item.remoteName === "stop_crawl");
      if (!tool) throw new HttpFail(403, { code: "runtime_tool_not_granted" });
      return c.json(await runtime.invoke(String(tool.exposed.name), { task_id: crawl.remote_task_id }));
    } finally { runtime.close(); }
  } },
  { id: "runtime.crawl.dequeue", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    if (action.connector_id !== "claw" || action.tool_name !== "start_crawl") throw new HttpFail(409, { code: "runtime_crawl_not_queued" });
    // R2 级：取消自己的排队任务，直接执行+审计（PROD-AGENT-09 要求提供取消入口）。
    // uncertain 也允许取消：远端状态未知，取消只释放本地占位/排队，远端任务可能仍在运行，前端需提示。
    const updated = await postgresPool().query<{ instance_key: string }>(`UPDATE runtime_crawl_jobs
      SET state='cancelled', error_code=CASE WHEN state='uncertain' THEN 'uncertain_cancelled_by_user' ELSE 'queue_cancelled_by_user' END,
      updated_at=now() WHERE id=$1 AND actor_id=$2 AND state IN ('queued','uncertain') RETURNING instance_key`,
      [action.id, actor()]);
    if (!updated.rows.length) throw new HttpFail(409, { code: "runtime_crawl_not_queued" });
    // uncertain 占位被释放后，尝试出队下一个（queued 取消不占位，drain 是无害的 no-op）。
    try { await drainCrawlQueue(String(updated.rows[0].instance_key)); } catch { /* 出队失败不影响取消本身 */ }
    return c.json(await view(await runtimeAction(action.id, actor())));
  } },
  { id: "runtime.crawl.retry", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    const crawl = (await postgresPool().query("SELECT state FROM runtime_crawl_jobs WHERE id=$1 AND actor_id=$2", [action.id, action.actor_id])).rows[0];
    if (action.connector_id !== "claw" || action.tool_name !== "start_crawl" || !canRetryRuntimeCrawl(action, crawl || null)) throw new HttpFail(409, { code: "runtime_crawl_not_retryable" });
    const runtime = new SkillExecution({ ...action.context_json, originRunId: action.context_json.originRunId || action.context_json.runId, runId: `retry:${randomUUID()}` });
    try {
      const tool = (await runtime.discover()).tools.find((item) => item.connectorId === "claw" && item.remoteName === "start_crawl");
      if (!tool) throw new HttpFail(403, { code: "runtime_tool_not_granted" });
      return c.json(await runtime.invoke(String(tool.exposed.name), action.args_json));
    } finally { runtime.close(); }
  } },
  { id: "runtime.actions", kind: "query", async handle(c, input) {
    const user = actor();
    if (!input.session_id) throw new HttpFail(400, { code: "session_required" });
    const { rows } = await postgresPool().query<RuntimeAction>(`SELECT * FROM runtime_actions
      WHERE actor_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 30`, [user, input.session_id]);
    const actions = [];
    for (const row of rows) { try { actions.push(await view(row)); } catch { /* revoked scope is not returned */ } }
    return c.json({ actions });
  } },
  { id: "runtime.confirm", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    if (action.snapshot !== input.confirmation_version) throw new HttpFail(409, { code: "runtime_action_snapshot_stale" });
    authorizeConnector(action.context_json, action.connector_id);
    if (action.state === "succeeded") {
      await validateRuntimeToolScope(action.connector_id, action.context_json, action.tool_name, action.args_json);
      return c.json({ receipt: action.receipt_json });
    }
    await runtimeActionGate(action.connector_id, action.tool_name).validate(action.context_json, action.args_json);
    if (action.state !== "pending" && action.state !== "succeeded") throw new HttpFail(409, { code: "runtime_action_already_claimed" });
    const result = await pgEnqueueExecutionJob({ job_type: "runtime.confirm", tenant_ref: "runtime",
      actor_ref: action.actor_id, idempotency_key: `runtime-confirm:${action.id}`, risk_level: "high", max_attempts: 1,
      object_ref: { action_id: action.id },
      scope_snapshot: { snapshot: action.snapshot }, payload: { action_id: action.id, confirmation_version: action.snapshot } });
    return c.json({ job: pgExecutionJobPublic(result.job) }, 202);
  } },
  { id: "runtime.cancel", kind: "action", async handle(c, input) {
    const action = await runtimeAction(String(input.action_id || ""), actor());
    authorizeConnector(action.context_json, action.connector_id);
    await postgresPool().query("UPDATE runtime_actions SET state='cancelled',updated_at=now() WHERE id=$1 AND state='pending'", [action.id]);
    return c.json(await view(await runtimeAction(action.id, actor())));
  } },
];
