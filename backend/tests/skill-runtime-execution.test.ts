import { createManagedClient } from "../src/runtime/managed-client.js";
import { saveStarryBinding, boundStarryCredentialId } from "../src/host/starry-bind.js";
import { deleteCredential } from "../src/runtime/credentials.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { getConn, resetConn } from "../src/db.js";
import { setAgentSkill, setSkillConnector, setSkillTool, setConnectorConfig, setToolPolicy, getAgentSkills, getSkillConnectors, getToolPolicy } from "../src/runtime/store.js";
import { SkillExecution, assertRuntimeSkill, toolSchemaHash, type RuntimeContext, type RuntimeRemote } from "../src/runtime/execution.js";
import { createAgentBinding, revokeAgentBinding } from "../src/runtime/organization-tree.js";
import { startRuntimeProxy, type RuntimeProxy } from "../src/runtime/proxy.js";
import { RemoteMcpClient, type RemoteMcpOptions } from "../src/mcp/remote.js";
import type { Json } from "../src/types.js";
import { mapUser, withScopedUser, requireConnector, requireStageWrite } from "../src/auth.js";
import { kolAgentScopeContext } from "../src/contract-scope.js";
import { runCodex } from "../src/worker/runner.js";
import { isolatedCodexModelConfig } from "../src/worker/auth.js";
import { freshTestDatabase } from "./support/pg.js";
import { seedPublishedAgent } from "./fixtures/runtime-auth.js";
import { createCredential } from "../src/runtime/credentials.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import { postgresPool } from "../src/postgres/pool.js";
import { runtimeActionSchema } from "../src/runtime/action-schema.js";
import { runtimeAction } from "../src/runtime/action-store.js";
import { registerRuntimeActionGate } from "../src/runtime/action-gates.js";
import { configureCrawlerFixture } from "./helpers/crawler-vault.js";
import { monitorRuntimeCrawl } from "../src/crawl/runtime-gates.js";
import type { ClaimedExecutionJob } from "../src/execution-jobs/contracts.js";
import { Hono } from "hono";
import { operationRouter } from "../src/runtime/operations.js";
import { runtimeActionOperations } from "../src/runtime/action-operations.js";
import { HttpFail } from "../src/host/errors.js";
import { createDiscoveryWorkspace, pendingDiscoveryWorkspace } from "../src/crawl/discovery-workspace.js";
import { collectCrawlResults } from "../src/crawl/results.js";
import { discoveryResultContext } from "../src/crawl/context.js";
import { runtimeHash } from "../src/runtime/execution.js";

registerRuntimeActionGate("catalog_a", "lookup", { validate() {}, execute: (_context, _args, _id, dispatch) => dispatch() });

let tmp: string;
let cleanup: Array<() => Promise<unknown>>;
const context: RuntimeContext = { agentId: "agent:runtime-test", skillId: "creator_profile", userId: "user-a", runId: "run-1" };
const COMPANY = "company:amperetime";
let runtimeBindingId = "";
const tool = (name = "lookup"): Json => ({ name, description: "Look up a public creator", inputSchema: {
  type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
} });
const denied = (code: string) => ({ detail: { code } });

beforeEach(async () => {
  await freshTestDatabase();
  await postgresPool().query(runtimeActionSchema);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kol-runtime-execution-"));
  process.env.LINGONG_DB = path.join(tmp, "test.db");
  process.env.LINGONG_DATA = tmp;
  process.env.AUTH_MODE = "enabled";
  process.env.NODE_ENV = "test";
  resetConn();
  cleanup = [];
  const db = getConn();
  for (const id of ["user-a", "user-b", "admin-a"]) {
    db.prepare(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, id, id, "not-for-login", JSON.stringify(id.startsWith("admin") ? ["admin"] : ["employee"]), "[]", "", 1, "now", "now");
  }
  setAgentSkill(context.agentId, context.skillId, true, 0);
  // 使用资格闸门要求 Agent 已发布（CONST-05 / ADR-2026-10-03）；未发布的 Agent 不产生资格。
  seedPublishedAgent(context.agentId, "运行时测试 Agent");
  // 人员资格锚点是「人 → Agent」绑定（CONST-05 / ADR-2026-10-03）：把测试账号挂到
  // 组织人员上，并把被测 Agent 绑定到该人员所在的三级组。
  runtimeBindingId = createAgentBinding({
    agent_id: context.agentId, target_type: "organization_unit", target_id: "org:lt_team",
    company_id: COMPANY, source: "test",
  }).id;
  db.prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run(context.userId, "person:ye_guanwang");
});
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.AUTH_MODE;
  delete process.env.LINGONG_DB;
  delete process.env.LINGONG_DATA;
});

function connector(id: string, descriptors = [tool()], url = `http://${id}.example.test/mcp`): void {
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES(?,?,1,'configured',?)").run(id, id, "now");
  setSkillConnector(context.skillId, id, true, 0);
  setConnectorConfig(id, { url, allow_unauthenticated: true }, 0);
  for (const descriptor of descriptors) {
    approve(id, descriptor);
    setSkillTool(context.skillId, id, String(descriptor.name), true, 0);
  }
}
function approve(id: string, descriptor: Json, risk: "L1" | "L2" | "L3" = "L1", access: "read" | "write" = "read"): void {
  const current = getToolPolicy(id, String(descriptor.name));
  setToolPolicy(id, String(descriptor.name), { enabled: true, risk, access, schema_hash: toolSchemaHash(descriptor) }, Number(current?.version || 0));
}

describe("discovery workspace persistence and result isolation", () => {
  it("atomically prepares one task/run/session and rejects request-key reuse with different criteria", async () => {
    setAgentSkill(context.agentId, "crawler_collect", true, 0);
    const owner = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(context.userId) as never);
    const brief = { platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"], min_followers: 100,
      max_followers: 20000, min_avg_plays_10: 100, expect_count: 10 };
    const body = { request_id: "discovery-test-request-001", brief, text: "发现北美露营红人" };
    const [first, replay] = await Promise.all([
      withScopedUser(owner, () => createDiscoveryWorkspace(body)),
      withScopedUser(owner, () => createDiscoveryWorkspace(body)),
    ]);
    expect(replay).toMatchObject({ task_id: first.task_id, session_id: first.session_id });
    expect([first.duplicate, replay.duplicate].sort()).toEqual([false, true]);
    const row = (await postgresPool().query("SELECT input FROM tickets WHERE id=$1", [first.task_id])).rows[0];
    expect(JSON.parse(row.input).discovery_workspace).toMatchObject({ brief, agent_id: context.agentId, profile: "lead" });
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM task_runs WHERE work_item_id=$1", [first.task_id])).rows[0].n).toBe(1);
    expect(await withScopedUser(owner, () => pendingDiscoveryWorkspace(String(first.task_id)))).toMatchObject({ pending: first.pending });
    await expect(withScopedUser({ ...owner, id: "another-owner" }, () => pendingDiscoveryWorkspace(String(first.task_id))))
      .rejects.toMatchObject(denied("discovery_task_not_found"));
    await postgresPool().query("UPDATE task_runs SET status='running' WHERE work_item_id=$1", [first.task_id]);
    expect(await withScopedUser(owner, () => pendingDiscoveryWorkspace(String(first.task_id)))).toEqual({ pending: null });
    await expect(withScopedUser(owner, () => createDiscoveryWorkspace(null))).rejects.toMatchObject(denied("discovery_brief_invalid"));
    await expect(withScopedUser(owner, () => createDiscoveryWorkspace({ ...body, brief: { ...brief, region: "eu" } })))
      .rejects.toMatchObject(denied("discovery_request_conflict"));
    await expect(withScopedUser(owner, () => createDiscoveryWorkspace({ ...body, brief: { ...brief, platforms: ["youtube", "instagram"] } })))
      .rejects.toMatchObject(denied("discovery_brief_invalid"));
  });

  it.each(["ready", "empty", "wrong-task", "unsupported", "partial"])("persists only verifiable task results: %s", async mode => {
    configureCrawlerFixture("http://crawler.example.test/mcp");
    setAgentSkill(context.agentId, "crawler_collect", true, 0);
    setSkillConnector("crawler_collect", "claw", true, 0);
    const descriptor = { name: "get_creators", inputSchema: { type: "object", properties: {
      ...(mode === "unsupported" ? {} : { task_id: { type: "string" } }), offset: { type: "integer" }, limit: { type: "integer" },
    }, additionalProperties: false } };
    approve("claw", descriptor); setSkillTool("crawler_collect", "claw", descriptor.name, true, 0);
    const ctx = { ...context, skillId: "crawler_collect", sessionId: "result-session" };
    await postgresPool().query(`INSERT INTO runtime_crawl_jobs(id,instance_key,actor_id,context_json,config_version,args_json,remote_task_id,state)
      VALUES('result-job',$1,$2,$3,1,$4,'remote-result','succeeded')`, [runtimeHash("http://crawler.example.test/mcp"), context.userId,
      JSON.stringify(ctx), JSON.stringify({ platforms: ["youtube"], crawler_type: "search", keywords: "camping" })]);
    let calls = 0;
    const factory = (): RuntimeRemote => ({ listTools: async () => [descriptor], close: async () => {}, callToolRaw: async (_name, args) => {
      calls++; expect(args?.task_id).toBe("remote-result");
      if (mode === "partial") {
        const offset = Number(args?.offset);
        return { structuredContent: { task_id: "remote-result", total: 2001, offset,
          creators: Array.from({ length: Math.min(100, 2001 - offset) }, (_, index) => ({ id: `candidate-${offset + index}`, platform: "youtube" })) } };
      }
      return { structuredContent: { task_id: mode === "wrong-task" ? "another-task" : "remote-result",
        creators: mode === "empty" ? [] : [{ id: "candidate", name: "Public creator", platform: "youtube", followers: null }], total: mode === "empty" ? 0 : 1 } };
    } });
    const job = { payload_json: JSON.stringify({ crawl_id: "result-job" }), worker_id: "result-test", lease_until: new Date(Date.now() + 60000).toISOString() } as ClaimedExecutionJob;
    const read = () => collectCrawlResults(job, async () => {}, c => new SkillExecution(c, factory));
    if (["ready", "empty"].includes(mode)) {
      await expect(read()).resolves.toMatchObject({ state: "ready", count: mode === "empty" ? 0 : 1 });
      await read(); expect(calls).toBe(1);
      await postgresPool().query(`INSERT INTO runtime_actions(id,actor_id,session_id,context_json,connector_id,tool_name,args_json,snapshot,proposal_key,state)
        VALUES('result-job',$1,$2,$3,'claw','start_crawl','{}','test','context-test','succeeded')`, [ctx.userId, ctx.sessionId, JSON.stringify(ctx)]);
      const snapshots = await discoveryResultContext(ctx);
      expect(snapshots[0]).toMatchObject({ task_id: "remote-result", result_complete: true, included_count: mode === "empty" ? 0 : 1 });
      expect(await discoveryResultContext({ ...ctx, sessionId: "other-session" })).toEqual([]);
      const binding = getSkillConnectors("crawler_collect").find(row => row.connector_id === "claw")!;
      setSkillConnector("crawler_collect", "claw", false, Number(binding.version));
      await expect(discoveryResultContext(ctx)).rejects.toThrow();
    } else if (mode === "partial") {
      await expect(read()).resolves.toMatchObject({ state: "partial", count: 2000 });
      await expect(read()).resolves.toMatchObject({ state: "ready", count: 2001 });
      expect(calls).toBe(21);
    } else {
      await expect(read()).rejects.toMatchObject(denied(mode === "unsupported" ? "crawl_result_scope_unsupported" : "crawl_result_task_mismatch"));
      expect((await postgresPool().query("SELECT result_json,result_state FROM runtime_crawl_jobs WHERE id='result-job'")).rows[0])
        .toMatchObject({ result_json: null, result_state: "failed" });
      expect(calls).toBe(mode === "unsupported" ? 0 : 1);
    }
  });
});
function fake(catalogs: Record<string, Json[]>, hooks: { list?: (url: string) => void | Promise<void>; call?: () => void | Promise<void>; result?: Json } = {}) {
  const calls: Array<{ url: string; name: string; args: Json }> = [];
  const factory = (options: RemoteMcpOptions): RuntimeRemote => ({
    async listTools() { await hooks.list?.(options.url!); return structuredClone(catalogs[options.url!] || []); },
    async callToolRaw(name, args = {}) {
      calls.push({ url: options.url!, name, args });
      await hooks.call?.();
      return hooks.result || { content: [{ type: "text", text: "private-creator-result" }], structuredContent: { ok: true } };
    },
    async close() {},
  });
  return { calls, factory };
}
async function one(hooks: Parameters<typeof fake>[1] = {}) {
  connector("catalog_a");
  const fixture = fake({ "http://catalog_a.example.test/mcp": [tool()] }, hooks);
  const runtime = new SkillExecution(context, fixture.factory);
  const catalog = await runtime.discover();
  expect(catalog.tools).toHaveLength(1);
  return { ...fixture, runtime, alias: String(catalog.tools[0].exposed.name) };
}

describe("governed Skill Runtime", () => {
  it("only the owning authenticated user can enqueue the immutable confirmation once", async () => {
    const { runtime, calls } = await one();
    approve("catalog_a", tool(), "L3", "write");
    const catalog = await runtime.discover();
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    const action = await runtimeAction(String((result.structuredContent as Json).action_id), context.userId);
    const app = new Hono();
    app.onError((error, c) => c.json({ code: error instanceof HttpFail ? error.detail : "failed" }, error instanceof HttpFail ? error.status as 400 : 500));
    app.route("/api", operationRouter(runtimeActionOperations));
    const confirm = () => app.request("/api/actions/runtime.confirm", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: action.id, confirmation_version: action.snapshot, args: { query: "cannot-override" } }) });
    expect((await confirm()).status).toBe(401);
    const other = mapUser(getConn().prepare("SELECT * FROM users WHERE id='user-b'").get() as Json);
    expect((await withScopedUser(other, confirm)).status).toBe(404);
    const owner = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(context.userId) as Json);
    expect((await withScopedUser(owner, confirm)).status).toBe(202);
    expect((await withScopedUser(owner, confirm)).status).toBe(202);
    const jobs = (await postgresPool().query("SELECT payload_json FROM execution_jobs WHERE job_type='runtime.confirm'")).rows;
    expect(jobs).toHaveLength(1);
    expect(JSON.stringify(jobs)).not.toContain("cannot-override");
    expect(calls).toHaveLength(0);
  });
  it.each([null, "remote process failed"])("mounts MediaCrawler writes, persists one remote job, enforces task scope, and resumes monitoring (%s)", async (remoteError) => {
    configureCrawlerFixture("http://crawler.example.test/mcp");
    const crawlContext = { ...context, skillId: "crawler_collect" };
    setAgentSkill(context.agentId, "crawler_collect", true, 0);
    setSkillConnector("crawler_collect", "claw", true, 0);
    const start = { name: "start_crawl", inputSchema: { type: "object", properties: { platforms: { type: "array" }, crawler_type: { type: "string" }, keywords: { type: "string" } } } };
    const status = { name: "get_crawl_status", inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } };
    for (const descriptor of [start, status]) {
      approve("claw", descriptor, descriptor === start ? "L3" : "L1", descriptor === start ? "write" : "read");
      setSkillTool("crawler_collect", "claw", descriptor.name, true, 0);
    }
    let remoteCalls = 0;
    const factory = (): RuntimeRemote => ({
      listTools: async () => [start, status], close: async () => {},
      callToolRaw: async (name, args) => { remoteCalls += 1; return { structuredContent: name === "start_crawl"
        ? { ok: true, task_id: "remote-one", status: "running" }
        : { task_id: args?.task_id, status: "idle", error_message: remoteError } }; },
    });
    const runtime = new SkillExecution(crawlContext, factory);
    const catalog = await runtime.discover();
    expect(catalog.tools).toHaveLength(2);
    const startAlias = String(catalog.tools.find((item) => item.remoteName === "start_crawl")!.exposed.name);
    const args = { platforms: ["youtube"], crawler_type: "search", keywords: "camping" };
    await expect(runtime.invoke(startAlias, { ...args, keywords: ["camping"] })).rejects.toMatchObject({
      detail: { code: "runtime_tool_arguments_invalid", dispatched: false,
        argument_issues: [{ field: "keywords", issue: "type", expected: ["string"], actual: "array" }] },
    });
    expect(remoteCalls).toBe(0);
    const proposed = await runtime.invoke(startAlias, args);
    expect(remoteCalls).toBe(0);
    const action = await runtimeAction(String((proposed.structuredContent as Json).action_id), context.userId);
    await new SkillExecution(crawlContext, factory).confirm(action.id, action.snapshot);
    expect(remoteCalls).toBe(1);
    const second = await runtime.invoke(startAlias, { ...args, keywords: "outdoor" });
    const secondAction = await runtimeAction(String((second.structuredContent as Json).action_id), context.userId);
    await expect(new SkillExecution(crawlContext, factory).confirm(secondAction.id, secondAction.snapshot))
      .rejects.toMatchObject(denied("runtime_probe_crawl_busy"));
    expect(remoteCalls).toBe(1);
    const statusAlias = String(catalog.tools.find((item) => item.remoteName === "get_crawl_status")!.exposed.name);
    await expect(runtime.invoke(statusAlias, { task_id: "someone-elses-task" })).rejects.toMatchObject(denied("runtime_crawl_scope_denied"));
    const monitor = (await postgresPool().query("SELECT * FROM execution_jobs WHERE job_type='crawler.monitor'")).rows[0];
    expect(monitor).toBeTruthy();
    const delivery = (await postgresPool().query("SELECT available_at FROM execution_outbox WHERE job_id=$1", [monitor.id])).rows[0];
    expect(new Date(delivery.available_at).getTime()).toBe(new Date(monitor.next_attempt_at).getTime());
    expect((await postgresPool().query("SELECT count(*)::int AS n FROM execution_outbox WHERE job_id=$1", [monitor.id])).rows[0].n).toBe(1);
    const receipt = await monitorRuntimeCrawl({ ...monitor, worker_id: "test" } as ClaimedExecutionJob, async () => {}, (ctx) => new SkillExecution(ctx, factory));
    expect(receipt).toMatchObject({ state: remoteError ? "failed" : "succeeded" });
    expect((await postgresPool().query("SELECT state FROM runtime_crawl_jobs WHERE id=$1", [action.id])).rows[0].state).toBe(remoteError ? "failed" : "succeeded");
  });
  it.each([
    ["missing annotations", undefined, "L1", "read", true],
    ["explicit write", { readOnlyHint: false }, "L1", "read", false],
    ["destructive contradiction", { destructiveHint: true }, "L1", "read", false],
    ["L2 cannot claim read-only", { readOnlyHint: true }, "L2", "write", false],
  ] as const)("publishes governed read-only hints: %s", async (_label, annotations, risk, access, expected) => {
    const descriptor: Json = { ...tool(), ...(annotations ? { annotations } : {}) };
    connector("hints", [descriptor]);
    approve("hints", descriptor, risk, access);
    const fixture = fake({ "http://hints.example.test/mcp": [descriptor] });
    const catalog = await new SkillExecution(context, fixture.factory).discover();
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0].exposed.annotations).toMatchObject({ readOnlyHint: expected });
    expect(catalog.tools[0].schemaHash).toBe(toolSchemaHash(descriptor));
    if (annotations && "destructiveHint" in annotations) {
      expect(catalog.tools[0].exposed.annotations).toMatchObject({ destructiveHint: true });
    }
  });

  it("preserves model provider config without inheriting tools, plugins or trust", () => {
    const safe = isolatedCodexModelConfig(`model="chosen-model"\nmodel_provider="custom"\nprofile="fast"\n
[model_providers.custom]\nname="Custom"\nbase_url="https://model.example/v1"\nenv_key="MODEL_KEY"\nwire_api="responses"\n
[mcp_servers.forbidden]\nurl="https://untrusted.example/mcp"\n
[profiles.fast]\nmodel_reasoning_effort="low"\napproval_policy="never"\n
[projects.untrusted]\ntrust_level="trusted"\n`);
    expect(safe).toContain("chosen-model");
    expect(safe).toContain("model.example");
    expect(safe).toContain("model_reasoning_effort");
    expect(safe).not.toMatch(/mcp_servers|untrusted|approval_policy|trust_level/);
  });

  it("A: discovers multiple resources with collision-free names while retaining descriptions/schema", async () => {
    connector("catalog_a"); connector("catalog_b");
    const fixture = fake({ "http://catalog_a.example.test/mcp": [tool()], "http://catalog_b.example.test/mcp": [tool()] });
    const runtime = new SkillExecution(context, fixture.factory);
    const catalog = await runtime.discover();
    expect(catalog.tools).toHaveLength(2);
    expect(new Set(catalog.tools.map((entry) => entry.exposed.name)).size).toBe(2);
    expect(catalog.tools[0].exposed).toMatchObject({ description: tool().description, inputSchema: tool().inputSchema });
    for (const entry of catalog.tools) await runtime.invoke(String(entry.exposed.name), { query: "outdoor" });
    expect(fixture.calls).toHaveLength(2);
  });

  // Per-person skill grants are retired (ADR-2026-10-03); revocation now means
  // revoking the Agent use binding, the Agent→Skill assembly or the account.
  it.each(["unbind", "disable", "binding_revoke", "user_disable", "agent_unbind"])("B: rejects an old handle after %s", async (action) => {
    const { runtime, alias, calls } = await one();
    const db = getConn();
    if (action === "unbind") setSkillConnector(context.skillId, "catalog_a", false, Number(getSkillConnectors(context.skillId)[0].version));
    if (action === "disable") db.prepare("UPDATE connectors SET enabled=0 WHERE id='catalog_a'").run();
    if (action === "binding_revoke") revokeAgentBinding(runtimeBindingId);
    if (action === "user_disable") db.prepare("UPDATE users SET active=0 WHERE id=?").run(context.userId);
    if (action === "agent_unbind") setAgentSkill(context.agentId, context.skillId, false, Number(getAgentSkills(context.agentId)[0].version));
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toHaveProperty("status");
    expect(calls).toHaveLength(0);
  });

  it("C: replaces the service ID and remote tool name without editing Skill or Host", async () => {
    const { runtime, alias, calls } = await one();
    setSkillConnector(context.skillId, "catalog_a", false, Number(getSkillConnectors(context.skillId)[0].version));
    const replacement = tool("find_public_profile_v2");
    connector("replacement_provider", [replacement]);
    const fixture = fake({ "http://replacement_provider.example.test/mcp": [replacement] });
    const replacementRuntime = new SkillExecution(context, fixture.factory);
    const catalog = await replacementRuntime.discover();
    expect(catalog.tools.map((entry) => entry.remoteName)).toEqual(["find_public_profile_v2"]);
    await replacementRuntime.invoke(String(catalog.tools[0].exposed.name), { query: "camping" });
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_connector_unbound"));
    expect(calls).toHaveLength(0);
    expect(fixture.calls[0].name).toBe("find_public_profile_v2");
  });

  it("D: new remote tools require both a reviewed policy and an explicit Skill mount, not a code whitelist", async () => {
    connector("catalog_a");
    const descriptors = [tool()];
    const fixture = fake({ "http://catalog_a.example.test/mcp": descriptors });
    const runtime = new SkillExecution(context, fixture.factory);
    expect((await runtime.discover()).tools).toHaveLength(1);
    const added = tool("brand_new_capability_2026"); descriptors.push(added);
    expect((await runtime.discover()).tools).toHaveLength(1);
    approve("catalog_a", added);
    expect((await runtime.discover()).tools).toHaveLength(1);
    setSkillTool(context.skillId, "catalog_a", String(added.name), true, 0);
    const refreshed = await runtime.discover();
    expect(refreshed.tools).toHaveLength(2);
    await runtime.invoke(String(refreshed.tools.find((entry) => entry.remoteName === added.name)!.exposed.name), { query: "x" });
    expect(fixture.calls[0].name).toBe(added.name);
  });

  it("admin still cannot use disabled connectors or unbound skills", async () => {
    const { factory } = await one();
    // 管理员同样要挂到组织人员上才具备 Agent 使用资格；本用例验证的是
    // 有资格之后，连接器停用与 Agent→技能解绑仍然拦住管理员。
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("admin-a", "person:xi_chucong");
    const admin = new SkillExecution({ ...context, userId: "admin-a" }, factory);
    const catalog = await admin.discover();
    getConn().prepare("UPDATE connectors SET enabled=0 WHERE id='catalog_a'").run();
    await expect(admin.invoke(String(catalog.tools[0].exposed.name), { query: "x" })).rejects.toMatchObject(denied("runtime_connector_disabled"));
    setAgentSkill(context.agentId, context.skillId, false, Number(getAgentSkills(context.agentId)[0].version));
    await expect(admin.discover()).rejects.toMatchObject(denied("runtime_skill_unbound"));
  });

  it("denies a different user and grants nothing through a per-person connector grant", async () => {
    const { factory } = await one();
    getConn().prepare("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES(?,?,?,?)")
      .run("user-b", "catalog_a", "write", "now");
    await expect(new SkillExecution({ ...context, userId: "user-b" }, factory).discover()).rejects.toMatchObject(denied("runtime_agent_not_usable"));
    // 挂到同一个三级组的成员后立即获得资格：证明刚才的拒绝就是 Agent 绑定缺口。
    getConn().prepare("UPDATE organization_people SET user_id = ? WHERE person_ref = ?").run("user-b", "person:gu_jiarui");
    const catalog = await new SkillExecution({ ...context, userId: "user-b" }, factory).discover();
    expect(catalog.tools).toHaveLength(1);
  });

  it("legacy authorization also rejects disabled connectors for administrators and stage aliases", () => {
    for (const id of ["starrykol", "starry"]) {
      getConn().prepare("INSERT OR IGNORE INTO connectors(id,label,enabled,status,updated_at) VALUES(?,?,1,'configured','now')").run(id, id);
    }
    getConn().prepare("UPDATE connectors SET enabled=1 WHERE id='starry'").run();
    getConn().prepare("UPDATE connectors SET enabled=0 WHERE id='starrykol'").run();
    const admin = mapUser(getConn().prepare("SELECT * FROM users WHERE id='admin-a'").get() as Json);
    withScopedUser(admin, () => {
      expect(() => requireConnector("starrykol", "read")).toThrow();
      expect(() => requireStageWrite()).toThrow();
    });
  });

  it("does not forward an upstream credential echo or store it in audit payloads", async () => {
    const secret = "private-runtime-secret-no-echo";
    const previous = process.env.RUNTIME_TEST_NO_ECHO;
    process.env.RUNTIME_TEST_NO_ECHO = secret;
    try {
      const { runtime } = await one({ result: { content: [{ type: "text", text: `Bearer ${secret}` }], isError: true } });
      setConnectorConfig("catalog_a", { url: "http://catalog_a.example.test/mcp", bearer_env: "RUNTIME_TEST_NO_ECHO" }, 1);
      const alias = String((await runtime.discover()).tools[0].exposed.name);
      await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_credential_in_result"));
      const audit = getConn().prepare("SELECT payload FROM audit_events WHERE event_type LIKE 'runtime.%'").all();
      expect(JSON.stringify(audit)).not.toContain(secret);
    } finally {
      if (previous === undefined) delete process.env.RUNTIME_TEST_NO_ECHO; else process.env.RUNTIME_TEST_NO_ECHO = previous;
    }
  });

  it("L3 registration cannot make a tool directly callable, even by admin", async () => {
    const { runtime, alias, calls } = await one();
    approve("catalog_a", tool(), "L3", "write");
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_binding_changed"));
    const catalog = await runtime.discover();
    expect(catalog.tools).toHaveLength(1);
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    expect(result.structuredContent).toMatchObject({ status: "pending", confirmation_required: true });
    expect(calls).toHaveLength(0);
  });

  it("runs an approved L2 write tool for the Skill holder; per-person write levels are retired", async () => {
    const { runtime, calls } = await one();
    approve("catalog_a", tool(), "L2", "write");
    const catalog = await runtime.discover();
    expect(catalog.tools).toHaveLength(1);
    await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    expect(calls).toHaveLength(1);
  });

  it("does not let governance relabel existing Gateway-only operations as L1", async () => {
    const dangerous = tool("sendEmailNow");
    connector("catalog_a", [dangerous]);
    const fixture = fake({ "http://catalog_a.example.test/mcp": [dangerous] });
    const runtime = new SkillExecution({ ...context, userId: "admin-a" }, fixture.factory);
    const catalog = await runtime.discover();
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0].exposed.annotations).toMatchObject({ readOnlyHint: false });
    expect((await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" })).structuredContent)
      .toMatchObject({ status: "pending" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("persists a proposal and confirms exactly once across fresh runtimes and simultaneous requests", async () => {
    const { runtime, calls, factory } = await one();
    approve("catalog_a", tool(), "L3", "write");
    const catalog = await runtime.discover();
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    const action = await runtimeAction(String((result.structuredContent as Json).action_id), context.userId);
    expect(calls).toHaveLength(0);
    const confirmed = await Promise.allSettled([1, 2].map(() => new SkillExecution(context, factory).confirm(action.id, action.snapshot)));
    expect(confirmed.some((item) => item.status === "fulfilled")).toBe(true);
    expect(calls).toHaveLength(1);
    expect((await runtimeAction(action.id, context.userId)).state).toBe("succeeded");
    await new SkillExecution(context, factory).confirm(action.id, action.snapshot);
    expect(calls).toHaveLength(1);
  });

  it.each(["parameters", "policy", "identity"])("invalidates confirmation after %s changes", async (change) => {
    const { runtime, calls, factory } = await one();
    approve("catalog_a", tool(), "L3", "write");
    const catalog = await runtime.discover();
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    const action = await runtimeAction(String((result.structuredContent as Json).action_id), context.userId);
    if (change === "parameters") await postgresPool().query("UPDATE runtime_actions SET args_json=$2 WHERE id=$1", [action.id, JSON.stringify({ query: "other" })]);
    if (change === "policy") approve("catalog_a", tool(), "L3", "write");
    if (change === "identity") getConn().prepare("UPDATE users SET active=0 WHERE id=?").run(context.userId);
    await expect(new SkillExecution(context, factory).confirm(action.id, action.snapshot)).rejects.toHaveProperty("status");
    expect(calls).toHaveLength(0);
  });

  it("retains an uncertain receipt after a dispatched timeout and forbids replay", async () => {
    const { runtime, calls, factory } = await one({ call: () => { throw new Error("timeout"); } });
    approve("catalog_a", tool(), "L3", "write");
    const catalog = await runtime.discover();
    const result = await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    const action = await runtimeAction(String((result.structuredContent as Json).action_id), context.userId);
    await expect(new SkillExecution(context, factory).confirm(action.id, action.snapshot)).rejects.toHaveProperty("status");
    expect((await runtimeAction(action.id, context.userId)).state).toBe("uncertain");
    await expect(new SkillExecution(context, factory).confirm(action.id, action.snapshot)).rejects.toHaveProperty("status");
    expect(calls).toHaveLength(1);
  });

  it("pins schema and description changes and rejects invalid arguments", async () => {
    connector("catalog_a");
    const descriptors = [tool()];
    const fixture = fake({ "http://catalog_a.example.test/mcp": descriptors });
    const runtime = new SkillExecution(context, fixture.factory);
    const alias = String((await runtime.discover()).tools[0].exposed.name);
    await expect(runtime.invoke(alias, { query: 12 })).rejects.toMatchObject(denied("runtime_tool_arguments_invalid"));
    descriptors[0].description = "Now this tool does something else";
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_tool_schema_changed"));
    expect(fixture.calls).toHaveLength(0);
    expect((await runtime.discover()).tools).toHaveLength(0);
  });

  it("rechecks the Agent use binding during the awaited discovery before dispatch", async () => {
    let revoke = false;
    const { runtime, alias, calls } = await one({ list: () => {
      if (revoke) revokeAgentBinding(runtimeBindingId);
    } });
    revoke = true;
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_agent_not_usable"));
    expect(calls).toHaveLength(0);
  });

  it("suppresses a result arriving after a binding revoke and records that dispatch already happened", async () => {
    const { runtime, alias, calls } = await one({ call: () => {
      revokeAgentBinding(runtimeBindingId);
    } });
    await expect(runtime.invoke(alias, { query: "sensitive-input" })).rejects.toMatchObject(denied("runtime_agent_not_usable"));
    expect(calls).toHaveLength(1);
    const events = getConn().prepare("SELECT payload FROM audit_events WHERE event_type LIKE 'runtime.tool.%'").all() as Array<{ payload: string }>;
    const payloads = events.map((entry) => entry.payload).join("\n");
    expect(payloads).not.toContain("sensitive-input");
    expect(payloads).not.toContain("private-creator-result");
    expect(payloads).toContain('"dispatched":true');
    expect(payloads).toContain('"sha256"');
  });

  it("closed runs and malicious external schema refs fail closed", async () => {
    const { runtime, alias, calls } = await one();
    runtime.close();
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_run_closed"));
    expect(calls).toHaveLength(0);
    const bad = tool("bad_schema"); bad.inputSchema = { type: "object", $ref: "https://secret.example/schema" };
    approve("catalog_a", bad);
    const fixture = fake({ "http://catalog_a.example.test/mcp": [bad] });
    const catalog = await new SkillExecution(context, fixture.factory).discover();
    expect(catalog.tools).toHaveLength(0);
    expect(catalog.unavailable[0].code).toBe("runtime_tool_catalog_invalid");
  });
});

async function localRemote(descriptor = tool(), requiredHeaders: Record<string, string> = {}, result: Json = { creator: "creator-local-42" }) {
  const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (Object.entries(requiredHeaders).some(([name, value]) => req.headers[name.toLowerCase()] !== value)) {
      res.writeHead(401).end(); return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    const mcp = new Server({ name: "local-real-protocol-fixture", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [descriptor as Tool] }));
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push(request.params.name);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try { await mcp.connect(transport); await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString())); }
    finally { await mcp.close(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/mcp`, calls };
}
function proxyClient(proxy: RuntimeProxy) {
  return new RemoteMcpClient({ url: String(proxy.spec.url), headers: proxy.spec.http_headers as Record<string, string> });
}

describe("real localhost MCP protocol through authorization proxy (not LIVE/LLM)", () => {
  it("routes Starry business calls through vault, rejects legacy config and never retries another identity", async () => {
    const previous = process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
    process.env.RUNTIME_CREDENTIAL_MASTER_KEY = "29".repeat(32);
    try {
      const remote = await localRemote(tool(), { "X-MCP-API-KEY": "vault-key", Authorization: "Bearer personal-vault-token" });
      const key = createCredential({ type: "organization_secret", secret: "vault-key" }, "admin-a");
      getConn().prepare("UPDATE connectors SET enabled=1 WHERE id='starrykol'").run();
      expect(() => setConnectorConfig("starrykol", { url: remote.url, headers_env: { "X-Key": "OLD_KEY" } }, 0))
        .toThrow();
      expect(() => setConnectorConfig("starrykol", { url: remote.url, allow_unauthenticated: true }, 0)).toThrow();
      setConnectorConfig("starrykol", { url: remote.url, headers_secret_refs: { "X-MCP-API-KEY": key.id } }, 0);
      saveStarryBinding(context.userId, { mailbox_email: "person@example.test", bearer: "personal-vault-token" });
      const reference = boundStarryCredentialId(context.userId);
      expect(reference).toMatch(/^cred_/);
      expect(JSON.stringify(getConn().prepare("SELECT * FROM user_starry_bindings").all())).not.toContain("personal-vault-token");
      expect(() => deleteCredential(reference, 1)).toThrow();
      const client = createManagedClient("starrykol", context.userId, reference);
      try { expect(await client.callTool("lookup", { query: "fixture" })).toEqual({ creator: "creator-local-42" }); }
      finally { await client.close(); }
      expect(remote.calls).toEqual(["lookup"]);
      expect(() => createManagedClient("starrykol", "user-b", reference)).toThrow();
      getConn().prepare("UPDATE runtime_credentials SET status='disabled' WHERE id=?").run(reference);
      expect(() => createManagedClient("starrykol", context.userId, reference)).toThrow();
      expect(remote.calls).toHaveLength(1);
      getConn().prepare("UPDATE user_starry_bindings SET bearer_token='legacy-plaintext' WHERE user_id=?").run(context.userId);
      expect(() => boundStarryCredentialId(context.userId)).toThrow();
      getConn().prepare("UPDATE connectors SET enabled=0 WHERE id='starrykol'").run();
      expect(() => createManagedClient("starrykol", context.userId)).toThrow();
    } finally {
      if (previous === undefined) delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
      else process.env.RUNTIME_CREDENTIAL_MASTER_KEY = previous;
    }
  });

  it("queries all KOL profiles using vaulted config with legacy Host disabled and only an Agent user binding", async () => {
    const ctx = { ...context, skillId: "creator_library_all" };
    const descriptor: Json = { name: "listAllKolProfiles", description: "List all visible KOL profiles",
      inputSchema: { type: "object", properties: {}, additionalProperties: false } };
    const expected = { data: [{ kolUid: "fixture-kol-1", kolName: "Protocol fixture only" }] };
    const remote = await localRemote(descriptor,
      { "X-MCP-API-KEY": "fixture-vault-key", Authorization: "Bearer fixture-vault-account" }, expected);
    let legacyCalls = 0;
    setStarryKolClientFactory(() => { legacyCalls++; throw new Error("legacy Host deliberately disabled"); });
    const savedKey = process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
    const legacyEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(STARRY_|EMAIL_MCP_)/.test(key)));
    for (const key of Object.keys(legacyEnv)) delete process.env[key];
    process.env.RUNTIME_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 19).toString("base64");
    try {
      const apiKey = createCredential({ type: "organization_secret", secret: "fixture-vault-key" }, "admin-a");
      const bearer = createCredential({ type: "user_account", owner_user_id: ctx.userId,
        secret: "fixture-vault-account" }, "admin-a");
      connector("vaulted_starry", [descriptor], remote.url);
      setConnectorConfig("vaulted_starry", { url: remote.url,
        headers_secret_refs: { "X-MCP-API-KEY": apiKey.id },
        credential_provider: "user-account", credential_account_id: bearer.id }, 1);
      setAgentSkill(ctx.agentId, ctx.skillId, true, 0);
      setSkillConnector(ctx.skillId, "vaulted_starry", true, 0);
      setSkillTool(ctx.skillId, "vaulted_starry", "listAllKolProfiles", true, 0);
      // Explicitly remove obsolete per-person resource grants. Assembly is not a user grant.
      getConn().prepare("DELETE FROM user_skill_grants WHERE user_id=?").run(ctx.userId);
      getConn().prepare("DELETE FROM user_connector_grants WHERE user_id=?").run(ctx.userId);
      const runtime = new SkillExecution(ctx);
      const proxy = await startRuntimeProxy(runtime); cleanup.push(proxy.close);
      const client = proxyClient(proxy); cleanup.push(() => client.close());
      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      const result = await client.callToolRaw(String(tools[0].name), {});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(expected);
      expect(remote.calls).toEqual(["listAllKolProfiles"]);
      expect(legacyCalls).toBe(0);
      revokeAgentBinding(runtimeBindingId);
      const deniedResult = await client.callToolRaw(String(tools[0].name), {});
      expect(deniedResult.isError).toBe(true);
      expect(remote.calls).toHaveLength(1);
      expect(legacyCalls).toBe(0);
    } finally {
      setStarryKolClientFactory();
      Object.assign(process.env, legacyEnv);
      if (savedKey === undefined) delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;
      else process.env.RUNTIME_CREDENTIAL_MASTER_KEY = savedKey;
    }
  });

  it("wires the actual Worker through an isolated fake-Codex protocol process and the runtime proxy", async () => {
    const remote = await localRemote();
    connector("local_provider", [tool()], remote.url);
    const saved = { CODEX_BIN: process.env.CODEX_BIN, CODEX_HOME: process.env.CODEX_HOME,
      CODEX_MODE: process.env.CODEX_MODE, RUNTIME_FIXTURE_SECRET: process.env.RUNTIME_FIXTURE_SECRET };
    Object.assign(process.env, { CODEX_BIN: path.resolve("tests/fixtures/fake-runtime-codex.mjs"),
      CODEX_HOME: path.join(tmp, "codex-home"), CODEX_MODE: "real", RUNTIME_FIXTURE_SECRET: "private-connector-key" });
    fs.chmodSync(process.env.CODEX_BIN!, 0o755);
    fs.mkdirSync(process.env.CODEX_HOME!);
    fs.writeFileSync(path.join(process.env.CODEX_HOME!, "config.toml"), '[mcp_servers.forbidden]\nurl="http://untrusted.example/mcp"\n');
    setConnectorConfig("local_provider", { url: remote.url, headers_env: { "X-Test-Key": "RUNTIME_FIXTURE_SECRET" } }, 1);
    const existingKOLBinding = getAgentSkills(kolAgentScopeContext().agent_id).find((row) => row.skill_id === context.skillId);
    if (!existingKOLBinding) setAgentSkill(kolAgentScopeContext().agent_id, context.skillId, true, 0);
    // runCodex 按技能声明的 runtime_agent_id 走 agent:kol，人员资格同样来自 Agent 绑定。
    createAgentBinding({
      agent_id: kolAgentScopeContext().agent_id, target_type: "organization_unit", target_id: "org:lt_team",
      company_id: COMPANY, source: "test",
    });
    getConn().prepare("INSERT INTO sessions(id,title,created_at,updated_at,thread_ref,owner_user_id) VALUES(?,?,?,?,?,?)")
      .run("runtime-session", "runtime", "now", "now", "stale-old-thread", context.userId);
    try {
      const user = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(context.userId) as Json);
      const result = await withScopedUser(user, () => runCodex("runtime-session", context.skillId, "读取公开画像", {}));
      expect(result.status).toBe("done");
      expect(remote.calls).toEqual(["lookup"]);
      expect(result.contract_log.some((entry) => entry.method === "thread/resume")).toBe(false);
      expect(JSON.stringify(result.contract_log)).not.toContain("private-connector-key");
      const box = String(result.box_path);
      expect(fs.existsSync(path.join(box, ".codex", "config.toml"))).toBe(false);
      expect(fs.readFileSync(path.join(box, "CONTEXT.md"), "utf8")).not.toContain("private-connector-key");
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  it("lists and calls remote tools over SDK protocol, then denies a revoked binding", async () => {
    const remote = await localRemote();
    connector("local_provider", [tool()], remote.url);
    const proxy = await startRuntimeProxy(new SkillExecution(context));
    cleanup.push(proxy.close);
    const client = proxyClient(proxy); cleanup.push(() => client.close());
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    const legacyResourceProbe = await client.callToolRaw("list_mcp_resources", {});
    expect(legacyResourceProbe.isError).not.toBe(true);
    expect(JSON.stringify(legacyResourceProbe)).toContain(String(tools[0].name));
    const result = await client.callToolRaw(String(tools[0].name), { query: "outdoor" });
    expect(result.structuredContent).toEqual({ creator: "creator-local-42" });
    expect(remote.calls).toEqual(["lookup"]);
    setSkillConnector(context.skillId, "local_provider", false, Number(getSkillConnectors(context.skillId)[0].version));
    const blocked = await client.callToolRaw(String(tools[0].name), { query: "outdoor" });
    expect(blocked.isError).toBe(true);
    expect(remote.calls).toHaveLength(1);
  });

  it("requires each run's token, rejects browser origins, and closes the listener", async () => {
    const { factory } = await one();
    const first = await startRuntimeProxy(new SkillExecution(context, factory)); cleanup.push(first.close);
    const second = await startRuntimeProxy(new SkillExecution(context, factory)); cleanup.push(second.close);
    const url = String(first.spec.url);
    expect((await fetch(url, { method: "POST" })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: second.spec.http_headers as Record<string, string> })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: { ...(first.spec.http_headers as Record<string, string>), Origin: "https://untrusted.example" } })).status).toBe(403);
    await first.close();
    await expect(fetch(url, { method: "POST", headers: first.spec.http_headers as Record<string, string> })).rejects.toThrow();
  });

  it("runs today_plan as the platform workspace planner with no KOL or connector dependency", async () => {
    const saved = { CODEX_BIN: process.env.CODEX_BIN, CODEX_HOME: process.env.CODEX_HOME, CODEX_MODE: process.env.CODEX_MODE };
    Object.assign(process.env, {
      CODEX_BIN: path.resolve("tests/fixtures/fake-runtime-codex.mjs"),
      CODEX_HOME: path.join(tmp, "planner-codex-home"),
      CODEX_MODE: "real",
    });
    fs.chmodSync(process.env.CODEX_BIN!, 0o755);
    fs.mkdirSync(process.env.CODEX_HOME!);
    getConn().prepare(
      "INSERT INTO sessions(id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id) VALUES(?,?,?,?,?,?,?,?)",
    ).run("planner-session", "今日规划", "now", "now", "today_plan", 0, context.userId, "platform:workspace-planner");
    try {
      expect(getAgentSkills("agent:workspace-planner").filter((row) => row.enabled).map((row) => row.skill_id))
        .toEqual(expect.arrayContaining(["today_plan", "todo_plan", "today_analyze"]));
      expect(getAgentSkills(kolAgentScopeContext().agent_id).some((row) => row.skill_id === "today_plan")).toBe(false);
      expect(getSkillConnectors("today_plan")).toEqual([]);
      // 未绑定：平台规划技能也不放行；绑定后才可运行（人员资格锚点是 Agent）。
      expect(() => assertRuntimeSkill({
        agentId: "agent:workspace-planner", skillId: "today_plan", userId: "user-b", runId: "planner-denied",
      })).toThrow(/runtime_agent_not_usable/);
      createAgentBinding({
        agent_id: "agent:workspace-planner", target_type: "organization_unit", target_id: "org:lt_team",
        company_id: COMPANY, source: "test",
      });
      const user = mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(context.userId) as Json);
      const result = await withScopedUser(user, () => runCodex(
        "planner-session",
        "today_plan",
        "规划今天的工作。只输出 today_brief JSON。",
        { mode: "today_plan", skip_user_memory: true, today_plan_context: { history: {}, delta: {}, now_counts: {} } },
      ));
      expect(result.status).toBe("done");
      expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: "today_brief" })]));
      const binding = result.contract_log.find((entry) => entry.method === "runtime/binding");
      expect(binding?.params).toMatchObject({ agent_id: "agent:workspace-planner" });
      const boxContext = fs.readFileSync(path.join(String(result.box_path), "CONTEXT.md"), "utf8");
      expect(boxContext).toContain('"agent_id": "agent:workspace-planner"');
      expect(boxContext).toContain('"kind": "platform"');
      expect(boxContext).toContain('"mailboxes": []');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
