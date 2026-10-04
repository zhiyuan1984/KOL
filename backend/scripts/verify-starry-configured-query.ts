import { callStarryKolTool } from "../src/starrykol/service.js";
/** Authorized, read-only remote query acceptance. Configuration changes require --configure.
 * Run on the target deployment as its service OS user. Never prints secrets or profile contents.
 * Uses the same governance handlers as the admin UI; it does not create an HTTP login session.
 */
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { getConn, audit, nowIso } from "../src/db.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { getConnectorConfig, getAgentSkills, getSkillConnectors, getSkillTools } from "../src/runtime/store.js";
import { canUseAgent } from "../src/runtime/organization-tree.js";
import { inspectConnectorTools, SkillExecution, runtimeErrorCode } from "../src/runtime/execution.js";
import { createConnectorOperationsRouter } from "../src/routers/connector-operations.js";
import { skillRuntimeRouter } from "../src/routers/skill-runtime.js";
import { enterprise } from "../src/routers/enterprise.js";
import type { Json } from "../src/types.js";
import { runCodex } from "../src/worker/runner.js";

const userId = process.argv.find((arg) => arg.startsWith("--user="))?.slice(7);
if (!userId) throw new Error("--user=<authorized account id> is required");
const context = { agentId: "agent:kol", skillId: "creator_library_all", userId,
  runId: `acceptance:configured-starry:${Date.now()}` };
const connector = "starrykol";
let phase = "identity";
const emit = (value: unknown) => console.log(JSON.stringify(value));
const db = getConn();
try {
  const row = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Json | undefined;
  if (!row || !Number(row.active)) throw new Error("active account required");
  const user = mapUser(row);
  if (!canUseAgent(userId, context.agentId)) throw new Error("explicit Agent qualification required, including administrators");
  const cfg = getConnectorConfig(connector);
  if (!cfg || cfg.config.url_env || cfg.config.headers_env || cfg.config.bearer_env) {
    throw new Error("saved connector must use URL and vault references only");
  }
  emit({ phase, user_id: userId, agent_usable: true, config_version: cfg.version,
    config_fields: Object.keys(cfg.config) });
  // Disable legacy dispatch and credentials in THIS process only; do not interrupt the live service.
  for (const key of Object.keys(process.env)) if (/^(STARRY_|EMAIL_MCP_)/.test(key)) delete process.env[key];
  phase = "mcp_tools_list";
  const tools = await inspectConnectorTools(context, connector);
  const target = tools.find((tool) => tool.name === "listAllKolProfiles");
  if (!target) throw new Error("listAllKolProfiles absent from remote catalog");
  emit({ phase, tool_count: tools.length, query: target });
  if (process.argv.includes("--configure")) {
    phase = "governance_configuration";
    const app = new Hono();
    app.onError((error, c) => c.json({ code: runtimeErrorCode(error) }, 500));
    app.route("/api", skillRuntimeRouter);
    app.route("/api", createConnectorOperationsRouter());
    app.route("/api", enterprise);
    const request = async (method: string, path: string, body?: unknown) => {
      const response = await withScopedUser(user, () => app.request(`/api${path}`, {
        method, headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      const result = await response.json() as Json;
      emit({ phase, path, status: response.status,
        ...(path.endsWith("/probe") ? { receipt: result } : {}) });
      if (!response.ok) throw new Error(`governance request failed (${response.status})`);
      return result;
    };
    audit(userId, "acceptance.configured_starry.started", { run_id: context.runId });
    // Re-save identical reference-only config to request a fresh probe, preserving its secrets.
    await request("PUT", `/admin/runtime/connectors/${connector}/config`, { ...cfg.config, expected_version: cfg.version });
    await request("POST", `/admin/runtime/connectors/${connector}/probe`);
    const agentBinding = getAgentSkills(context.agentId).find((binding) => binding.skill_id === context.skillId);
    if (!agentBinding?.enabled) await request("PUT", `/admin/runtime/agents/${context.agentId}/skills/${context.skillId}`,
      { enabled: true, expected_version: Number(agentBinding?.version || 0) });
    const resource = getSkillConnectors(context.skillId).find((binding) => binding.connector_id === connector);
    if (!resource?.enabled) await request("PUT", `/admin/runtime/skills/${context.skillId}/connectors/${connector}`,
      { enabled: true, expected_version: Number(resource?.version || 0) });
    const mount = getSkillTools(context.skillId).find((binding) => binding.connector_id === connector && binding.tool_name === target.name);
    if (!mount?.enabled) await request("PUT", `/admin/runtime/skills/${context.skillId}/tools/${connector}/${target.name}`,
      { enabled: true, expected_version: Number(mount?.version || 0) });
    await request("PATCH", `/admin/connectors/${connector}`, { enabled: true });
  }
  phase = "configured_runtime_query";
  const execution = new SkillExecution(context);
  try {
    const catalog = await execution.discover();
    const handle = catalog.tools.find((tool) => tool.connectorId === connector && tool.remoteName === target.name);
    if (!handle) { emit({ phase, unavailable: catalog.unavailable }); throw new Error("query tool is not mounted and available"); }
    const result = await execution.invoke(String(handle.exposed.name), {});
    const serialized = JSON.stringify(result);
    const shape = (value: unknown, depth = 0): unknown => {
      if (Array.isArray(value)) return { count: value.length, ...(value.length ? { item_keys: Object.keys(value[0] || {}) } : {}) };
      if (!value || typeof value !== "object" || depth > 4) return typeof value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        typeof child === "number" && /total|count/i.test(key) ? child : shape(child, depth + 1)]));
    };
    const texts = Array.isArray(result.content) ? result.content as Json[] : [];
    const decoded = texts.filter((part) => part.type === "text").map((part) => {
      try { return shape(JSON.parse(String(part.text))); } catch { return { text_bytes: Buffer.byteLength(String(part.text)) }; }
    });
    emit({ phase, run_id: context.runId, is_error: result.isError === true, connection_path: "saved_config_vault",
      bytes: Buffer.byteLength(serialized), sha256: createHash("sha256").update(serialized).digest("hex"),
      structured_shape: shape(result.structuredContent), decoded_shape: decoded });
    if (result.isError) throw new Error("query acceptance failed");
  } finally { execution.close(); }
  if (process.argv.includes("--business")) {
    phase = "business_gateway_query";
    const result = await withScopedUser(user, () => callStarryKolTool("listAllKolProfiles", {}));
    const data = (result.data || result) as Json;
    emit({ phase, connection_path: "saved_config_vault", total: data.total,
      rows: Array.isArray(data.list) ? data.list.length : null,
      sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex") });
    if (!Array.isArray(data.list) || !data.list.length) throw new Error("business query returned no rows");
  }
  if (process.argv.includes("--harness")) {
    phase = "real_codex_harness";
    if (process.env.CODEX_MODE !== "real") throw new Error("real Codex mode required");
    const sessionId = `acceptance-starry-${Date.now()}`;
    db.prepare("INSERT INTO sessions(id,title,created_at,updated_at,owner_user_id) VALUES(?,?,?,?,?)")
      .run(sessionId, "验收：保险柜全量 KOL 查询", nowIso(), nowIso(), userId);
    emit({ phase, session_id: sessionId, status: "started" });
    const result = await withScopedUser(user, () => runCodex(sessionId, context.skillId,
      "验证当前技能的全量画像查询：只调用 skill_runtime 中已挂载的 listAllKolProfiles 一次。返回实际查询总数及字段说明即可，不输出完整画像名单，不调用其他业务工具；如果失败如实报告。", {}));
    const completed = (db.prepare("SELECT payload FROM audit_events WHERE event_type='runtime.tool.completed'")
      .all() as { payload: string }[]).map((row) => JSON.parse(row.payload) as Json)
      .filter((event) => event.session_id === sessionId && event.is_error === false);
    emit({ phase, session_id: sessionId, status: result.status, connection_path: "saved_config_vault",
      item_types: result.items.map((item) => item.type),
      completed_tool_calls: completed.length,
      mcp_calls: result.contract_log.find((entry) => entry.method === "turn/output")?.params?.mcp_calls,
      contract_methods: result.contract_log.map((entry) => entry.method),
      result_sha256: createHash("sha256").update(JSON.stringify(result.items)).digest("hex") });
    if (result.status !== "done" || completed.length !== 1) throw new Error("harness acceptance failed");
  }
} catch (error) {
  emit({ phase, failure: runtimeErrorCode(error), error_type: error instanceof Error ? error.name : typeof error,
    connection_path: "saved_config_vault" });
  process.exitCode = 1;
} finally { db.close(); }
