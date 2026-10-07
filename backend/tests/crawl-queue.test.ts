import http from "node:http";
import { beforeEach, afterEach, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { freshTestDatabase } from "./support/pg.js";
import { getConn, resetConn } from "../src/db.js";
import { postgresPool } from "../src/postgres/pool.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";
import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import { createAgentBinding } from "../src/runtime/organization-tree.js";
import { setAgentSkill, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { SkillExecution, runtimeHash, toolSchemaHash } from "../src/runtime/execution.js";
import { pgEnqueueExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { executionHandler } from "../src/execution-jobs/handlers.js";
import { monitorRuntimeCrawl } from "../src/crawl/runtime-gates.js";
import { operationRouter } from "../src/runtime/operations.js";
import { runtimeActionOperations } from "../src/runtime/action-operations.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { Hono } from "hono";
import type { Json } from "../src/types.js";
import type { ClaimedExecutionJob } from "../src/execution-jobs/contracts.js";

/**
 * 采集排队集成测试（需要 TEST_DATABASE_URL / DATABASE_URL 指向的真实 PostgreSQL）。
 * 覆盖：终态出队 → starter 派发（单任务不变量）、监控超时自动停止、
 * uncertain 对账、无任务号对账放弃、sweep 清理超时排队、dequeue 接口。
 */
const context = { agentId: "agent:queue", userId: "user-queue", skillId: "crawler_collect", sessionId: "queue-session", runId: "queue-run" };
const toolSchema = () => ({
  type: "object" as const,
  properties: {
    task_id: { type: "string" },
    platforms: { type: "array" },
    crawler_type: { type: "string" },
    keywords: { type: "string" },
    offset: { type: "integer" },
    limit: { type: "integer" },
  },
});
const descriptors: Tool[] = [
  { name: "start_crawl", inputSchema: toolSchema() },
  { name: "get_crawl_status", inputSchema: toolSchema() },
  { name: "stop_crawl", inputSchema: toolSchema() },
  { name: "get_creators", inputSchema: toolSchema() },
];
let server: http.Server;
let url: string;
let calls: Array<{ name: string; args: Json }>;
let remoteTasks: number;
let statusByTask: Record<string, { status: string; error_message?: string }>;
let previous: Record<string, string | undefined>;

async function insertJob(id: string, state: string, opts: { remoteTaskId?: string; createdAt?: string } = {}) {
  await postgresPool().query(
    `INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state,created_at)
     VALUES($1,$2,$3,$4,1,$5,$6,$7,COALESCE($8, now()))`,
    [id, runtimeHash(url), context.userId, JSON.stringify(context),
      JSON.stringify({ platforms: ["youtube"], crawler_type: "search", keywords: "kw" }),
      opts.remoteTaskId || null, state, opts.createdAt || null]);
}
async function jobState(id: string) {
  return (await postgresPool().query("SELECT state,remote_task_id,error_code FROM runtime_crawl_jobs WHERE id=$1", [id])).rows[0];
}
/** 直接运行最早的一个指定类型 execution job（不断言 worker 流程，只验证 handler 语义）。 */
async function runHandler(type: string) {
  const row = (await postgresPool().query(
    "SELECT * FROM execution_jobs WHERE job_type=$1 AND status='queued' ORDER BY created_at LIMIT 1", [type])).rows[0];
  expect(row, `expected a queued ${type} job`).toBeTruthy();
  const handler = executionHandler(type)!;
  return handler({ ...row, worker_id: "test", lease_until: new Date().toISOString() } as ClaimedExecutionJob, async () => {});
}
async function runMonitor(crawlId: string, sequence = 0) {
  const enqueued = await pgEnqueueExecutionJob({ job_type: "crawler.monitor", tenant_ref: "runtime", actor_ref: context.userId,
    idempotency_key: `queue-test-monitor:${crawlId}:${sequence}:${Date.now()}`, risk_level: "low", max_attempts: 3,
    object_ref: { crawl_id: crawlId }, payload: { crawl_id: crawlId, sequence } });
  const row = (await postgresPool().query("SELECT * FROM execution_jobs WHERE id=$1", [enqueued.job.id])).rows[0];
  return monitorRuntimeCrawl({ ...row, worker_id: "test", lease_until: new Date().toISOString() } as ClaimedExecutionJob,
    async () => {}, (ctx) => new SkillExecution(ctx));
}

beforeEach(async () => {
  previous = Object.fromEntries(["AUTH_MODE", "RUNTIME_CREDENTIAL_MASTER_KEY"].map(key => [key, process.env[key]]));
  process.env.AUTH_MODE = "enabled";
  await freshTestDatabase(); resetConn();
  calls = []; remoteTasks = 0; statusByTask = {};
  server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
    const mcp = new Server({ name: "queue-fixture", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors }));
    mcp.setRequestHandler(CallToolRequestSchema, async request => {
      const args = (request.params.arguments || {}) as Json;
      calls.push({ name: request.params.name, args });
      let result: Json;
      if (request.params.name === "start_crawl") {
        remoteTasks += 1;
        result = { ok: true, task_id: `remote-q${remoteTasks}`, status: "running" };
      } else if (request.params.name === "get_crawl_status") {
        const taskId = String(args.task_id || "");
        result = { task_id: taskId, ...(statusByTask[taskId] || { status: "running" }) };
      } else if (request.params.name === "stop_crawl") {
        result = { ok: true, task_id: String(args.task_id || ""), status: "idle" };
      } else {
        result = { task_id: String(args.task_id || ""), total: 0, creators: [] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try { await mcp.connect(transport); await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString())); }
    finally { await mcp.close(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  const db = getConn();
  db.prepare("INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES(?,?,?,'fixture','[\"employee\"]','[]','',1,'now','now')")
    .run(context.userId, context.userId, "Queue fixture");
  seedPublishedAgent(context.agentId, "Queue fixture");
  createAgentBinding({ agent_id: context.agentId, target_type: "organization_unit", target_id: "org:lt_team", company_id: "company:amperetime", source: "test" });
  db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref='person:ye_guanwang'").run(context.userId);
  configureCrawlerFixture(url);
  setAgentSkill(context.agentId, context.skillId, true, 0);
  setSkillConnector(context.skillId, "claw", true, 0);
  for (const descriptor of descriptors) {
    setToolPolicy("claw", descriptor.name, { enabled: true,
      risk: descriptor.name === "start_crawl" ? "L3" : "L1", access: descriptor.name === "start_crawl" ? "write" : "read",
      schema_hash: toolSchemaHash(descriptor as unknown as Json) }, 0);
    setSkillTool(context.skillId, "claw", descriptor.name, true, 0);
  }
});

afterEach(async () => {
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  resetConn();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

it("drains on terminal: the queued job is started exactly once (single-flight)", async () => {
  await insertJob("active-1", "running", { remoteTaskId: "remote-1" });
  await insertJob("queued-1", "queued");
  statusByTask["remote-1"] = { status: "idle" };
  const receipt = await runMonitor("active-1");
  expect(receipt).toMatchObject({ state: "succeeded" });
  expect(await jobState("active-1")).toMatchObject({ state: "succeeded" });
  // 出队派发了 starter，但尚未执行：远端仍只有一个任务在跑。
  expect(remoteTasks).toBe(0);
  expect((await jobState("queued-1")).state).toBe("queued");
  const started = await runHandler("crawler.starter");
  expect(started).toMatchObject({ state: "running", remote_task_id: "remote-q1" });
  expect((await jobState("queued-1")).state).toBe("running");
  expect(remoteTasks).toBe(1);
  expect(calls.filter(c => c.name === "start_crawl")).toHaveLength(1);
});

it("auto-stops a monitor-timed-out crawl and drains the queue", async () => {
  await insertJob("old-1", "running", { remoteTaskId: "remote-old", createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() });
  await insertJob("queued-2", "queued");
  const receipt = await runMonitor("old-1");
  expect(receipt).toMatchObject({ state: "cancelled", reason: "monitor_auto_stop" });
  expect(await jobState("old-1")).toMatchObject({ state: "cancelled", error_code: "monitor_auto_stop" });
  expect(calls.filter(c => c.name === "stop_crawl")).toHaveLength(1);
  // 占位已释放，starter 已派发。
  const starters = (await postgresPool().query("SELECT id FROM execution_jobs WHERE job_type='crawler.starter'")).rows;
  expect(starters).toHaveLength(1);
});

it("reconciles an uncertain job with a task id to its terminal state", async () => {
  await insertJob("uncertain-1", "uncertain", { remoteTaskId: "remote-u" });
  statusByTask["remote-u"] = { status: "idle" };
  await pgEnqueueExecutionJob({ job_type: "crawler.reconcile", tenant_ref: "runtime", actor_ref: context.userId,
    idempotency_key: "queue-test-reconcile-1", risk_level: "low", max_attempts: 3,
    object_ref: { crawl_id: "uncertain-1" }, payload: { crawl_id: "uncertain-1" } });
  const result = await runHandler("crawler.reconcile");
  expect(result).toMatchObject({ state: "succeeded", reason: "reconciled" });
  expect(await jobState("uncertain-1")).toMatchObject({ state: "succeeded" });
});

it("abandons an uncertain job without a task id after an hour", async () => {
  await insertJob("uncertain-2", "uncertain", { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() });
  await pgEnqueueExecutionJob({ job_type: "crawler.reconcile", tenant_ref: "runtime", actor_ref: context.userId,
    idempotency_key: "queue-test-reconcile-2", risk_level: "low", max_attempts: 3,
    object_ref: { crawl_id: "uncertain-2" }, payload: { crawl_id: "uncertain-2" } });
  const result = await runHandler("crawler.reconcile");
  expect(result).toMatchObject({ state: "failed", reason: "monitor_abandoned_no_task" });
  expect(await jobState("uncertain-2")).toMatchObject({ state: "failed", error_code: "monitor_abandoned" });
});

it("sweep cancels expired queued jobs but keeps fresh ones", async () => {
  await insertJob("queued-old", "queued", { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
  await insertJob("queued-fresh", "queued");
  await pgEnqueueExecutionJob({ job_type: "crawler.sweep", tenant_ref: "runtime", actor_ref: context.userId,
    idempotency_key: "queue-test-sweep-1", risk_level: "low", max_attempts: 3,
    object_ref: { instance_key: runtimeHash(url) }, payload: { instance_key: runtimeHash(url) } });
  await runHandler("crawler.sweep");
  expect(await jobState("queued-old")).toMatchObject({ state: "cancelled", error_code: "queue_timeout" });
  // 新鲜的排队被出队：starter 已派发（drain 在 sweep 内触发）。
  const starters = (await postgresPool().query("SELECT id FROM execution_jobs WHERE job_type='crawler.starter'")).rows;
  expect(starters).toHaveLength(1);
  expect((await jobState("queued-fresh")).state).toBe("queued");
});

it("dequeue cancels a queued job through the operation", async () => {
  const actionId = "queue-action-1";
  await postgresPool().query(`INSERT INTO runtime_actions(id,actor_id,session_id,context_json,connector_id,tool_name,args_json,snapshot,proposal_key,state)
    VALUES($1,$2,'queue-session',$3,'claw','start_crawl',$4,'snap','queue-proposal-1','succeeded')`,
    [actionId, context.userId, JSON.stringify(context), JSON.stringify({ platforms: ["youtube"] })]);
  await insertJob(actionId, "queued");
  const app = new Hono();
  app.route("/api", operationRouter(runtimeActionOperations));
  const owner = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(context.userId) as Json);
  const response = await withScopedUser(owner, () => app.request("/api/actions/runtime.crawl.dequeue", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action_id: actionId }),
  }));
  expect(response.status).toBe(200);
  expect(await jobState(actionId)).toMatchObject({ state: "cancelled", error_code: "queue_cancelled_by_user" });
  // 重复取消幂等失败（已非 queued/uncertain）。
  const again = await withScopedUser(owner, () => app.request("/api/actions/runtime.crawl.dequeue", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action_id: actionId }),
  }));
  expect(again.status).toBe(409);
});
