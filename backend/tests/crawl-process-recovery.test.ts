import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
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
import { getToolPolicy, setAgentSkill, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { SkillExecution, runtimeHash, toolSchemaHash } from "../src/runtime/execution.js";
import { runtimeAction } from "../src/runtime/action-store.js";
import { pgEnqueueExecutionJob, pgExecutionJobById, pgRecoverExpiredExecutionJobs, pgClaimExecutionJobById, pgFailExecutionJob } from "../src/execution-jobs/postgres-store.js";
import { assertNoRuntimeCrawl } from "../src/crawl/runtime-gates.js";
import type { Json } from "../src/types.js";

const context = { agentId: "agent:recovery", userId: "user-recovery", skillId: "crawler_collect", sessionId: "recovery-session", runId: "recovery-run" };
const descriptors: Tool[] = [
  { name: "start_crawl", inputSchema: { type: "object", properties: { platforms: { type: "array" }, crawler_type: { type: "string" }, keywords: { type: "string" } } } },
  { name: "get_creators", inputSchema: { type: "object", properties: { task_id: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } } } },
  { name: "get_crawl_status", inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
];
let server: http.Server;
let releaseResponse: () => void;
let firstCall: Promise<void>;
let calls: Array<{ name: string; args: Json }>;
let children: Array<{ process: ChildProcess; exited: Promise<unknown[]> }>;
let url: string;
let heldTool: string;
let remoteReject: boolean;
let previous: Record<string, string | undefined>;

function worker(id: string) {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/crawl-recovery-worker.ts", import.meta.url)), id], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const exited = once(child, "exit");
  const record = { process: child, exited };
  children.push(record);
  return record;
}
async function completedWorker(id: string) {
  const record = worker(id);
  let result: unknown;
  let diagnostics = "";
  record.process.on("message", message => { result = message; });
  record.process.stderr!.on("data", data => { diagnostics += data; });
  expect((await record.exited)[0], diagnostics).toBe(0);
  return result;
}
async function expireKilledLease(id: string) {
  const job = await pgExecutionJobById(id);
  expect(job?.status).toBe("running");
  // Wait for the real lease after the owner died. A simulated future recovery
  // clock would also schedule next_attempt_at in the future; a fast replacement
  // on Linux could then correctly refuse to claim that job.
  await delay(Math.max(0, new Date(String(job!.lease_until)).getTime() - Date.now() + 5));
  return pgRecoverExpiredExecutionJobs();
}

beforeEach(async () => {
  previous = Object.fromEntries(["AUTH_MODE", "RUNTIME_CREDENTIAL_MASTER_KEY"].map(key => [key, process.env[key]]));
  process.env.AUTH_MODE = "enabled";
  await freshTestDatabase(); resetConn();
  children = []; calls = []; heldTool = "get_creators"; remoteReject = false;
  let signalCall: () => void;
  firstCall = new Promise(resolve => { signalCall = resolve; });
  const hold = new Promise<void>(resolve => { releaseResponse = resolve; });
  server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = []; for await (const part of req) chunks.push(Buffer.from(part));
    const mcp = new Server({ name: "process-recovery-fixture", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors }));
    mcp.setRequestHandler(CallToolRequestSchema, async request => {
      calls.push({ name: request.params.name, args: request.params.arguments || {} });
      if (request.params.name === heldTool && calls.filter(call => call.name === heldTool).length === 1) { signalCall!(); await hold; }
      if (remoteReject && request.params.name === "start_crawl") {
        return { isError: true, content: [{ type: "text", text: "runtime_probe_crawl_busy" }] };
      }
      const result = request.params.name === "start_crawl" ? { ok: true, task_id: "fixture-remote", status: "running" }
        : request.params.name === "get_crawl_status" ? { task_id: "fixture-remote", status: "idle" }
        : { task_id: "fixture-remote", total: 1, offset: 0, creators: [{ id: "fixture-candidate", platform: "youtube", name: "Isolated candidate" }] };
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
    .run(context.userId, context.userId, "Recovery fixture");
  seedPublishedAgent(context.agentId, "Recovery fixture");
  createAgentBinding({ agent_id: context.agentId, target_type: "organization_unit", target_id: "org:lt_team", company_id: "company:amperetime", source: "test" });
  db.prepare("UPDATE organization_people SET user_id=? WHERE person_ref='person:ye_guanwang'").run(context.userId);
  configureCrawlerFixture(url);
  setAgentSkill(context.agentId, context.skillId, true, 0);
  setSkillConnector(context.skillId, "claw", true, 0);
  for (const tool of descriptors) {
    setToolPolicy("claw", tool.name, { enabled: true, risk: tool.name === "start_crawl" ? "L3" : "L1",
      access: tool.name === "start_crawl" ? "write" : "read", schema_hash: toolSchemaHash(tool as unknown as Json) }, Number(getToolPolicy("claw", tool.name)?.version || 0));
    setSkillTool(context.skillId, "claw", tool.name, true, 0);
  }
});

async function queueStart() {
  const runtime = new SkillExecution(context);
  try {
    const tool = (await runtime.discover()).tools.find(tool => tool.remoteName === "start_crawl")!;
    const proposed = await runtime.invoke(String(tool.exposed.name), { platforms: ["youtube"], crawler_type: "search", keywords: "fixture-only" });
    const action = await runtimeAction(String((proposed.structuredContent as Json).action_id), context.userId);
    const queued = await pgEnqueueExecutionJob({ job_type: "runtime.confirm", actor_ref: context.userId, tenant_ref: "fixture",
      idempotency_key: `runtime-confirm:${action.id}`, risk_level: "high", max_attempts: 3,
      payload: { action_id: action.id, confirmation_version: action.snapshot } });
    return { action, id: String(queued.job.id) };
  } finally { runtime.close(); }
}

it.each(["starting", "running", "uncertain"])("enqueues the confirm instead of rejecting when the existing crawl is %s", async state => {
  const { action, id } = await queueStart();
  await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state)
    VALUES('existing-crawl',$1,$2,$3,1,$4,'fixture-existing',$5)`, [runtimeHash(url), context.userId, JSON.stringify(context), JSON.stringify({ platforms: ["youtube"] }), state]);
  expect(await completedWorker(id)).toMatchObject({ result: { outcome: "processed" } });
  // 请求被接受（action succeeded），采集任务进入排队，未触碰远端。
  const saved = await runtimeAction(action.id, context.userId);
  expect(saved).toMatchObject({ state: "succeeded" });
  expect(JSON.stringify(saved.receipt_json)).toContain("\"queued\":true");
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "succeeded", attempts: 1 });
  expect(await completedWorker(id)).toEqual({ result: null });
  expect(calls).toEqual([]);
  const rows = (await postgresPool().query("SELECT id,state FROM runtime_crawl_jobs")).rows;
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([{ id: "existing-crawl", state }, { id: action.id, state: "queued" }]));
});

it("rejects with runtime_probe_crawl_busy only when the queue is full", async () => {
  const { action, id } = await queueStart();
  const instanceKey = runtimeHash(url);
  for (let i = 0; i < 20; i += 1) {
    await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,state)
      VALUES($1,$2,$3,$4,1,$5,'queued')`,
      [`queued-${i}`, instanceKey, context.userId, JSON.stringify(context), JSON.stringify({ platforms: ["youtube"] })]);
  }
  expect(await completedWorker(id)).toMatchObject({ result: { outcome: "failed" } });
  expect(await runtimeAction(action.id, context.userId)).toMatchObject({ state: "rejected", error_code: "runtime_probe_crawl_busy" });
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "failed", error_code: "runtime_probe_crawl_busy", attempts: 1 });
  expect(calls).toEqual([]);
  expect((await postgresPool().query("SELECT count(*)::int AS n FROM runtime_crawl_jobs WHERE state='queued'")).rows[0].n).toBe(20);
});

it("keeps an error response uncertain even when its text looks like a local busy rejection", async () => {
  heldTool = ""; remoteReject = true;
  const { action, id } = await queueStart();
  expect(await completedWorker(id)).toMatchObject({ result: { outcome: "failed" } });
  expect(await runtimeAction(action.id, context.userId)).toMatchObject({ state: "uncertain", error_code: "runtime_crawl_start_uncertain" });
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "uncertain", next_attempt_at: null, attempts: 1 });
  expect(await completedWorker(id)).toEqual({ result: null });
  expect(calls.map(call => call.name)).toEqual(["start_crawl"]);
});

it("refuses a stale worker's pre-dispatch failure after lease ownership changes", async () => {
  const queued = await pgEnqueueExecutionJob({ job_type: "runtime.confirm", actor_ref: context.userId, tenant_ref: "fixture",
    idempotency_key: "stale-rejection", risk_level: "high", max_attempts: 3 });
  const id = String(queued.job.id);
  await pgClaimExecutionJobById(id, "worker-new");
  await pgFailExecutionJob(id, { code: "runtime_probe_crawl_busy", summary: "runtime_probe_crawl_busy" }, { expected_worker: "worker-old", not_dispatched: true });
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "running", lease_owner: "worker-new", error_code: null });
});
afterEach(async () => {
  releaseResponse?.();
  for (const child of children || []) { if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill("SIGKILL"); await child.exited; }
  if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  resetConn();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

it("restarts a killed results worker, reads the same task and persists one complete snapshot", async () => {
  await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state)
    VALUES('recovery-crawl',$1,$2,$3,1,$4,'fixture-remote','succeeded')`, [runtimeHash(url), context.userId, JSON.stringify(context), JSON.stringify({ platforms: ["youtube"] })]);
  const queued = await pgEnqueueExecutionJob({ job_type: "crawler.results", actor_ref: context.userId, tenant_ref: "fixture",
    idempotency_key: "process-recovery-results", risk_level: "low", max_attempts: 3, payload: { crawl_id: "recovery-crawl" } });
  const id = String(queued.job.id);
  const killed = worker(id); await firstCall;
  killed.process.kill("SIGKILL"); await killed.exited; releaseResponse();
  expect(await expireKilledLease(id)).toEqual({ requeued: 1, uncertain: 0 });
  expect(await completedWorker(id)).toMatchObject({ result: { outcome: "processed", execution_job_id: id } });
  expect(await completedWorker(id)).toEqual({ result: null });
  expect(calls.map(call => call.name)).toEqual(["get_creators", "get_creators"]);
  expect(calls.every(call => call.args.task_id === "fixture-remote")).toBe(true);
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "succeeded", attempts: 2 });
  expect((await postgresPool().query("SELECT result_state,result_json FROM runtime_crawl_jobs WHERE id='recovery-crawl'")).rows[0])
    .toMatchObject({ result_state: "ready", result_json: { task_id: "fixture-remote", complete: true, candidates: [{ id: "fixture-candidate" }] } });
});

it("quarantines a killed confirmed start worker and never starts again without its missing receipt", async () => {
  heldTool = "start_crawl";
  const runtime = new SkillExecution(context);
  let action;
  try {
    const tool = (await runtime.discover()).tools.find(tool => tool.remoteName === "start_crawl")!;
    const proposed = await runtime.invoke(String(tool.exposed.name), { platforms: ["youtube"], crawler_type: "search", keywords: "fixture-only" });
    action = await runtimeAction(String((proposed.structuredContent as Json).action_id), context.userId);
  } finally { runtime.close(); }
  expect(calls).toEqual([]);
  const queued = await pgEnqueueExecutionJob({ job_type: "runtime.confirm", actor_ref: context.userId, tenant_ref: "fixture",
    idempotency_key: `runtime-confirm:${action.id}`, risk_level: "high", max_attempts: 1,
    payload: { action_id: action.id, confirmation_version: action.snapshot } });
  const id = String(queued.job.id);
  const killed = worker(id); await firstCall;
  killed.process.kill("SIGKILL"); await killed.exited; releaseResponse();
  expect(await expireKilledLease(id)).toEqual({ requeued: 0, uncertain: 1 });
  expect(await completedWorker(id)).toEqual({ result: null });
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "uncertain", attempts: 1, error_code: "lease_expired" });
  // Drive the existing bounded missing-receipt monitor, without waiting or a new start.
  const monitor = await pgEnqueueExecutionJob({ job_type: "crawler.monitor", actor_ref: context.userId, tenant_ref: "fixture",
    idempotency_key: "missing-receipt-final-monitor", risk_level: "low", payload: { crawl_id: action.id, sequence: 12 } });
  await completedWorker(String(monitor.job.id));
  expect((await postgresPool().query("SELECT state,remote_task_id,error_code FROM runtime_crawl_jobs WHERE id=$1", [action.id])).rows[0])
    .toEqual({ state: "uncertain", remote_task_id: null, error_code: "start_outcome_unknown" });
  await expect(assertNoRuntimeCrawl(url)).rejects.toMatchObject({ detail: { code: "runtime_probe_crawl_busy" } });
  expect(calls.map(call => call.name)).toEqual(["start_crawl"]);
  expect((await postgresPool().query("SELECT count(*)::int AS n FROM execution_jobs WHERE job_type='crawler.results'")).rows[0].n).toBe(0);
});

it("restarts a killed monitor and closes the same running crawl through its saved result job", async () => {
  heldTool = "get_crawl_status";
  await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state)
    VALUES('monitor-recovery',$1,$2,$3,1,$4,'fixture-remote','running')`, [runtimeHash(url), context.userId, JSON.stringify(context), JSON.stringify({ platforms: ["youtube"] })]);
  const queued = await pgEnqueueExecutionJob({ job_type: "crawler.monitor", actor_ref: context.userId, tenant_ref: "fixture",
    idempotency_key: "monitor-process-recovery", risk_level: "low", max_attempts: 3, payload: { crawl_id: "monitor-recovery", sequence: 0 } });
  const id = String(queued.job.id);
  const killed = worker(id); await firstCall;
  killed.process.kill("SIGKILL"); await killed.exited; releaseResponse();
  expect(await expireKilledLease(id)).toEqual({ requeued: 1, uncertain: 0 });
  expect(await completedWorker(id)).toMatchObject({ result: { outcome: "processed" } });
  expect(await pgExecutionJobById(id)).toMatchObject({ status: "succeeded", attempts: 2 });
  expect((await postgresPool().query("SELECT state,remote_task_id FROM runtime_crawl_jobs WHERE id='monitor-recovery'")).rows[0])
    .toEqual({ state: "succeeded", remote_task_id: "fixture-remote" });
  const results = (await postgresPool().query("SELECT id FROM execution_jobs WHERE job_type='crawler.results'")).rows;
  expect(results).toHaveLength(1);
  await completedWorker(String(results[0].id));
  expect(calls.map(call => call.name)).toEqual(["get_crawl_status", "get_crawl_status", "get_creators"]);
  expect(calls.every(call => call.args.task_id === "fixture-remote")).toBe(true);
  expect((await postgresPool().query("SELECT result_state,result_json FROM runtime_crawl_jobs WHERE id='monitor-recovery'")).rows[0])
    .toMatchObject({ result_state: "ready", result_json: { complete: true, task_id: "fixture-remote" } });
});
