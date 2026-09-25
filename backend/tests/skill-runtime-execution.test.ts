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
import { SkillExecution, toolSchemaHash, type RuntimeContext, type RuntimeRemote } from "../src/runtime/execution.js";
import { startRuntimeProxy, type RuntimeProxy } from "../src/runtime/proxy.js";
import { RemoteMcpClient, type RemoteMcpOptions } from "../src/mcp/remote.js";
import type { Json } from "../src/types.js";
import { mapUser, withScopedUser, requireConnector, requireStageWrite } from "../src/auth.js";
import { kolAgentScopeContext } from "../src/contract-scope.js";
import { runCodex } from "../src/worker/runner.js";
import { isolatedCodexModelConfig } from "../src/worker/auth.js";

let tmp: string;
let cleanup: Array<() => Promise<unknown>>;
const context: RuntimeContext = { agentId: "agent:runtime-test", skillId: "creator_profile", userId: "user-a", runId: "run-1" };
const tool = (name = "lookup"): Json => ({ name, description: "Look up a public creator", inputSchema: {
  type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
} });
const denied = (code: string) => ({ detail: { code } });

beforeEach(() => {
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
  db.prepare("INSERT INTO user_skill_grants(user_id,skill_id,created_at) VALUES(?,?,?)").run(context.userId, context.skillId, "now");
  setAgentSkill(context.agentId, context.skillId, true, 0);
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
  getConn().prepare("INSERT INTO user_connector_grants(user_id,connector_id,access,created_at) VALUES(?,?,?,?)").run(context.userId, id, "read", "now");
  for (const descriptor of descriptors) {
    approve(id, descriptor);
    setSkillTool(context.skillId, id, String(descriptor.name), true, 0);
  }
}
function approve(id: string, descriptor: Json, risk: "L1" | "L2" | "L3" = "L1", access: "read" | "write" = "read"): void {
  const current = getToolPolicy(id, String(descriptor.name));
  setToolPolicy(id, String(descriptor.name), { enabled: true, risk, access, schema_hash: toolSchemaHash(descriptor) }, Number(current?.version || 0));
}
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

  it.each(["unbind", "disable", "revoke", "skill_revoke", "user_disable", "agent_unbind"])("B: rejects an old handle after %s", async (action) => {
    const { runtime, alias, calls } = await one();
    const db = getConn();
    if (action === "unbind") setSkillConnector(context.skillId, "catalog_a", false, Number(getSkillConnectors(context.skillId)[0].version));
    if (action === "disable") db.prepare("UPDATE connectors SET enabled=0 WHERE id='catalog_a'").run();
    if (action === "revoke") db.prepare("DELETE FROM user_connector_grants WHERE user_id=?").run(context.userId);
    if (action === "skill_revoke") db.prepare("DELETE FROM user_skill_grants WHERE user_id=?").run(context.userId);
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
    const admin = new SkillExecution({ ...context, userId: "admin-a" }, factory);
    const catalog = await admin.discover();
    getConn().prepare("UPDATE connectors SET enabled=0 WHERE id='catalog_a'").run();
    await expect(admin.invoke(String(catalog.tools[0].exposed.name), { query: "x" })).rejects.toMatchObject(denied("runtime_connector_disabled"));
    setAgentSkill(context.agentId, context.skillId, false, Number(getAgentSkills(context.agentId)[0].version));
    await expect(admin.discover()).rejects.toMatchObject(denied("runtime_skill_unbound"));
  });

  it("does not share an actor's authorized handles with a different user", async () => {
    const { factory } = await one();
    await expect(new SkillExecution({ ...context, userId: "user-b" }, factory).discover()).rejects.toMatchObject(denied("runtime_skill_not_granted"));
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
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_gateway_required"));
    expect((await runtime.discover()).tools).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("enforces write grants for an approved L2 tool", async () => {
    const { runtime, calls } = await one();
    approve("catalog_a", tool(), "L2", "write");
    expect((await runtime.discover()).tools).toHaveLength(0);
    getConn().prepare("UPDATE user_connector_grants SET access='write' WHERE user_id=?").run(context.userId);
    const catalog = await runtime.discover();
    await runtime.invoke(String(catalog.tools[0].exposed.name), { query: "x" });
    expect(calls).toHaveLength(1);
  });

  it("does not let governance relabel existing Gateway-only operations as L1", async () => {
    const dangerous = tool("sendEmailNow");
    connector("catalog_a", [dangerous]);
    const fixture = fake({ "http://catalog_a.example.test/mcp": [dangerous] });
    const runtime = new SkillExecution({ ...context, userId: "admin-a" }, fixture.factory);
    expect((await runtime.discover()).tools).toHaveLength(0);
    expect(fixture.calls).toHaveLength(0);
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

  it("rechecks revocation during the awaited discovery before dispatch", async () => {
    let revoke = false;
    const { runtime, alias, calls } = await one({ list: () => {
      if (revoke) getConn().prepare("DELETE FROM user_connector_grants WHERE user_id=?").run(context.userId);
    } });
    revoke = true;
    await expect(runtime.invoke(alias, { query: "x" })).rejects.toMatchObject(denied("runtime_connector_not_granted"));
    expect(calls).toHaveLength(0);
  });

  it("suppresses a result arriving after revoke and records that dispatch already happened", async () => {
    const { runtime, alias, calls } = await one({ call: () => {
      getConn().prepare("DELETE FROM user_connector_grants WHERE user_id=?").run(context.userId);
    } });
    await expect(runtime.invoke(alias, { query: "sensitive-input" })).rejects.toMatchObject(denied("runtime_connector_not_granted"));
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

async function localRemote() {
  const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    const mcp = new Server({ name: "local-real-protocol-fixture", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool() as Tool] }));
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push(request.params.name);
      return { content: [{ type: "text", text: "creator-local-42" }], structuredContent: { creator: "creator-local-42" } };
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
    setAgentSkill(kolAgentScopeContext().agent_id, context.skillId, true, 0);
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
