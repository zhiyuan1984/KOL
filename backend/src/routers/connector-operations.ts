import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit, postgresDb, nowIso } from "../postgres/access.js";
import { HttpFail } from "../host/errors.js";
import { inspectConnectorTools, runtimeErrorCode, type RuntimeContext } from "../runtime/execution.js";
import { getConnectorConfig } from "../runtime/store.js";
import { registerDiscoveredToolPolicies } from "../runtime/tool-catalog.js";
import type { Json, Row } from "../types.js";
import { requireManagedConnector } from "../connectors/catalog.js";
import { probeMediaCrawlerStart } from "../runtime/mediacrawler-probe.js";
import { requireRuntimeIdentityTables } from "../runtime/schema.js";
async function admin() {
  if (authDisabled() && process.env.NODE_ENV !== "test")
    throw new HttpFail(403, { code: "runtime_auth_required" });
  return (await requireAdmin());
}
async function connector(id: string): Promise<Row> {
  const row = (await postgresDb().one("SELECT id,enabled,status FROM connectors WHERE id=$1", id)) as Row | undefined;
  if (!row)
    throw new HttpFail(404, { code: "connector_not_found" });
  return row;
}
async function schema(): Promise<void> {
  await requireRuntimeIdentityTables("connector probes", ["runtime_connector_probes"]);
}
const TRACE_FIELDS = ["connector_id", "agent_id", "skill_id", "run_id", "session_id", "call_id", "tool", "tool_name",
  "schema_hash", "version", "connector_version", "policy_version", "action", "duration_ms", "code", "dispatched", "is_error"];
function tracePayload(value: unknown): Json {
  let parsed: Json = {};
  try {
    parsed = JSON.parse(String(value || "{}"));
  }
  catch {
    return {};
  }
  const safe: Json = {};
  for (const key of TRACE_FIELDS) {
    const item = parsed[key];
    if (typeof item === "string")
      safe[key] = item.slice(0, 320);
    else if (typeof item === "boolean" || typeof item === "number" || item === null)
      safe[key] = item;
  }
  // Never serialize arbitrary input/output, config, upstream errors, headers or credential references.
  return safe;
}
type Inspector = (context: RuntimeContext, connectorId: string) => Promise<Json[]>;
type StartProbe = (context: RuntimeContext, config: NonNullable<Awaited<ReturnType<typeof getConnectorConfig>>>["config"]) => Promise<void>;
export function createConnectorOperationsRouter(inspect: Inspector = inspectConnectorTools, startProbe: StartProbe = probeMediaCrawlerStart): Hono {
  const router = new Hono();
  router.post("/admin/runtime/connectors/:connectorId/probe", async (c) => {
    const actor = (await admin());
    const id = c.req.param("connectorId");
    if (process.env.NODE_ENV !== "test")
      requireManagedConnector(id);
    const current = (await connector(id));
    // Draft/pending connectors need a successful probe before enablement. MCP
    // catalog probes are read-only; the MediaCrawler Host probe starts and
    // stops a real task. An explicitly disabled connector remains blocked.
    if (!current.enabled && !["draft", "pending_verification", "verification_failed"].includes(String(current.status))) {
      throw new HttpFail(403, { code: "runtime_connector_disabled" });
    }
    const before = (await getConnectorConfig(id));
    if (!before)
      throw new HttpFail(409, { code: "runtime_connector_not_configured" });
    (await schema());
    const started = Date.now();
    const checkedAt = nowIso();
    // An HTTP action catalog is configuration, not an external reachability check.
    const kind = before.config.protocol === "http" ? "http_definition" : "mcp_tools_list";
    let count = 0;
    let code: string | null = null;
    try {
      const context = { agentId: "governance", skillId: "", userId: actor.id, runId: `probe:${id}` };
      const tools = await inspect(context, id);
      count = tools.length;
      if ((await getConnectorConfig(id))?.version !== before.version) {
        throw new HttpFail(409, { code: "runtime_binding_changed" });
      }
      if (kind === "mcp_tools_list") {
        // 测试即登记：平台按 07 规则推导风险档并写入工具目录；挂载仍在技能侧逐项进行。
        const registration = (await registerDiscoveredToolPolicies(id, tools));
        (await audit(actor.id, "runtime.tool_catalog.registered", {
          connector_id: id, config_version: before.version, ...registration,
        }));
      }
    }
    catch (error) {
      code = runtimeErrorCode(error);
      }
    const duration = Date.now() - started;
    const status = code ? "failed" : "succeeded";
    (await postgresDb().execute(`INSERT INTO runtime_connector_probes
      (connector_id,config_version,actor_id,checked_at,status,probe_kind,tool_count,duration_ms,error_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, before.version, actor.id, checkedAt, status, kind, count, duration, code));
    // A probe validates the saved configuration; it is not the administrator's
    // explicit enable action. Preserve an already-enabled connector after a
    // successful re-probe, keep a disabled connector disabled, and fail closed
    // when the probe fails.
    const enabledAfterProbe = !code && Number(current.enabled) === 1 ? 1 : 0;
    (await postgresDb().execute("UPDATE connectors SET enabled=$1,status=$2,last_verified_at=$3,last_error=$4,updated_at=$5 WHERE id=$6", enabledAfterProbe, code ? "verification_failed" : "verified", checkedAt, code || null, checkedAt, id));
    (await audit(actor.id, "runtime.connector.probed", { connector_id: id, version: before.version, status, probe_kind: kind, tool_count: count, duration_ms: duration, code }));
    return c.json({ connector_id: id, config_version: before.version, actor_id: actor.id, checked_at: checkedAt,
      status, probe_kind: kind, tool_count: count, duration_ms: duration, error_code: code,
      live_verified: !code && kind !== "http_definition",
      notice: kind === "http_definition" ? "仅校验 HTTP 动作定义，未调用外部业务接口。" : "仅验证该身份的 MCP 工具目录，不代表业务动作或其他账号可用。",
    }, code ? 502 : 200);
  });
  router.get("/admin/runtime/connectors/:connectorId/activity", async (c) => {
    (await admin());
    const id = c.req.param("connectorId");
    if (process.env.NODE_ENV !== "test")
      requireManagedConnector(id);
    (await connector(id));
    (await schema());
    const n = Number(c.req.query("limit") || 30);
    if (!Number.isInteger(n) || n < 1 || n > 100)
      throw new HttpFail(400, { code: "invalid_limit" });
    const probes = (await postgresDb().many("SELECT * FROM runtime_connector_probes WHERE connector_id=$1 ORDER BY id DESC LIMIT $2", id, n));
    const events = ((await postgresDb().many(`SELECT id,ts,actor,event_type,payload FROM audit_events
      WHERE event_type LIKE 'runtime.%' AND payload::jsonb ->> 'connector_id'=$1
      ORDER BY id DESC LIMIT $2`, id, n)) as Row[]).map((row) => ({ id: row.id, ts: row.ts, actor: row.actor,
        event_type: row.event_type, payload: tracePayload(row.payload) }));
    return c.json({ probes, events });
  });
  return router;
}
export const connectorOperationsRouter = createConnectorOperationsRouter();
