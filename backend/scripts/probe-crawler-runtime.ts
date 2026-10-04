/** Explicitly opted-in, bounded start/stop through the deployed confirmation queue. */
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getConn, nowIso } from "../src/db.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { postgresPool, closePostgresPool } from "../src/postgres/pool.js";
import { SkillExecution } from "../src/runtime/execution.js";
import { runtimeAction } from "../src/runtime/action-store.js";
import { runtimeActionOperations } from "../src/runtime/action-operations.js";
import { operationRouter } from "../src/runtime/operations.js";
import { HttpFail } from "../src/host/errors.js";
import "../src/crawl/runtime-gates.js";
import type { Json, Row } from "../src/types.js";

const actor = process.argv.find(a => a.startsWith("--actor="))?.slice(8);
if (!actor || !process.argv.includes("--execute")) throw new Error("Requires explicit --actor and --execute for one YouTube start/stop");
const userRow = getConn().prepare("SELECT * FROM users WHERE id=? AND active=1").get(actor) as Row | undefined;
if (!userRow) throw new Error("Active actor required");
const user = mapUser(userRow);
const session = `ses_probe_${randomUUID()}`;
const context = { agentId: "agent:kol", skillId: "crawler_collect", userId: actor, runId: `probe:${session}`, sessionId: session };
const runtime = new SkillExecution(context);
const app = new Hono();
app.onError((e, c) => c.json({ code: e instanceof HttpFail ? e.detail : "probe_failed" }, 409));
app.route("/", operationRouter(runtimeActionOperations));
async function confirm(id: string) {
  const action = await runtimeAction(id, actor!);
  const response = await withScopedUser(user, () => app.request("/actions/runtime.confirm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: id, confirmation_version: action.snapshot }),
  }));
  if (response.status !== 202) throw new Error(`confirmation_rejected_${response.status}`);
  for (let n = 0; n < 45; n++) {
    await new Promise(r => setTimeout(r, 1000));
    const current = await runtimeAction(id, actor!);
    if (current.state === "succeeded") return;
    if (["uncertain", "rejected", "cancelled"].includes(current.state)) throw new Error(`action_${current.state}`);
  }
  throw new Error("queue_receipt_timeout_do_not_repeat");
}
try {
  const tools = (await runtime.discover()).tools;
  const start = tools.find(t => t.remoteName === "start_crawl");
  const stop = tools.find(t => t.remoteName === "stop_crawl");
  if (!start || !stop || tools.length !== 5) throw new Error("required_mounts_missing");
  getConn().prepare("INSERT INTO sessions(id,title,created_at,updated_at,kind,disabled,owner_user_id) VALUES(?,?,?,?,?,?,?)")
    .run(session, "MediaCrawler runtime deployment verification", nowIso(), nowIso(), "chat", 0, actor);
  const before = (await postgresPool().query("SELECT count(*)::int AS n FROM runtime_crawl_jobs")).rows[0].n;
  const proposed = await runtime.invoke(String(start.exposed.name), { platforms: ["youtube"], crawler_type: "search", keywords: `kol-mcp-connection-probe-${Date.now()}` });
  const actionId = String((proposed.structuredContent as Json).action_id);
  if ((await postgresPool().query("SELECT count(*)::int AS n FROM runtime_crawl_jobs")).rows[0].n !== before) throw new Error("proposal_caused_remote_job");
  console.log(JSON.stringify({ phase: "pending_without_execution", session_id: session, action_id: actionId, mounted_tools: tools.length }));
  await confirm(actionId);
  const crawl = (await postgresPool().query("SELECT remote_task_id,state FROM runtime_crawl_jobs WHERE id=$1", [actionId])).rows[0];
  if (!crawl?.remote_task_id) throw new Error("missing_remote_task_receipt");
  console.log(JSON.stringify({ phase: "start_receipt", task_id: crawl.remote_task_id, state: crawl.state }));
  const stopped = await runtime.invoke(String(stop.exposed.name), { task_id: crawl.remote_task_id });
  await confirm(String((stopped.structuredContent as Json).action_id));
  const final = (await postgresPool().query("SELECT remote_task_id,state FROM runtime_crawl_jobs WHERE id=$1", [actionId])).rows[0];
  const jobs = (await postgresPool().query("SELECT job_type,status FROM execution_jobs WHERE idempotency_key LIKE $1 OR idempotency_key LIKE $2",
    [`runtime-confirm:${actionId}`, `crawler-monitor:${actionId}:%`])).rows;
  console.log(JSON.stringify({ phase: "stop_receipt", session_id: session, final, jobs }));
  if (final.state !== "cancelled") throw new Error("stop_not_terminal");
} catch (error) {
  console.error(JSON.stringify({ phase: "failed", code: error instanceof HttpFail ? error.detail : error instanceof Error ? error.message : "unknown", session_id: session }));
  process.exitCode = 1;
} finally { runtime.close(); await closePostgresPool(); getConn().close(); }
