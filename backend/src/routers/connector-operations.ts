import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { inspectConnectorTools, runtimeErrorCode, type RuntimeContext } from "../runtime/execution.js";
import { getConnectorConfig } from "../runtime/store.js";
import type { Json, Row } from "../types.js";
import { requireManagedConnector } from "../connectors/catalog.js";

function admin() {
  if (authDisabled() && process.env.NODE_ENV !== "test") throw new HttpFail(403, { code: "runtime_auth_required" });
  return requireAdmin();
}
function connector(id: string): Row {
  const row = getConn().prepare("SELECT id,enabled,status FROM connectors WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, { code: "connector_not_found" });
  return row;
}
function schema(): void {
  getConn().exec(`CREATE TABLE IF NOT EXISTS runtime_connector_probes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    config_version INTEGER NOT NULL, actor_id TEXT NOT NULL, checked_at TEXT NOT NULL,
    status TEXT NOT NULL, probe_kind TEXT NOT NULL, tool_count INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL, error_code TEXT
  )`);
}
const TRACE_FIELDS = ["connector_id", "agent_id", "skill_id", "run_id", "session_id", "call_id", "tool", "tool_name",
  "schema_hash", "version", "connector_version", "policy_version", "action", "duration_ms", "code", "dispatched", "is_error"];
function tracePayload(value: unknown): Json {
  let parsed: Json = {};
  try { parsed = JSON.parse(String(value || "{}")); } catch { return {}; }
  const safe: Json = {};
  for (const key of TRACE_FIELDS) {
    const item = parsed[key];
    if (typeof item === "string") safe[key] = item.slice(0, 320);
    else if (typeof item === "boolean" || typeof item === "number" || item === null) safe[key] = item;
  }
  // Never serialize arbitrary input/output, config, upstream errors, headers or credential references.
  return safe;
}

type Inspector = (context: RuntimeContext, connectorId: string) => Promise<Json[]>;
export function createConnectorOperationsRouter(inspect: Inspector = inspectConnectorTools): Hono {
  const router = new Hono();
  router.post("/admin/runtime/connectors/:connectorId/probe", async (c) => {
    const actor = admin();
    const id = c.req.param("connectorId");
    if (process.env.NODE_ENV !== "test") requireManagedConnector(id);
    const current = connector(id);
    // Draft/pending connectors need a safe list-tools test before they are
    // enabled; an explicitly disabled operating connector remains blocked.
    if (!current.enabled && !["draft", "pending_verification", "verification_failed"].includes(String(current.status))) {
      throw new HttpFail(403, { code: "runtime_connector_disabled" });
    }
    const before = getConnectorConfig(id);
    if (!before) throw new HttpFail(409, { code: "runtime_connector_not_configured" });
    schema();
    const started = Date.now();
    const checkedAt = nowIso();
    // An HTTP action catalog is configuration, not an external reachability check.
    const kind = (before.config as { protocol?: string }).protocol === "http" ? "http_definition" : "mcp_tools_list";
    let count = 0;
    let code: string | null = null;
    try {
      const tools = await inspect({ agentId: "governance", skillId: "", userId: actor.id, runId: `probe:${id}` }, id);
      count = tools.length;
      if (getConnectorConfig(id)?.version !== before.version) {
        throw new HttpFail(409, { code: "runtime_binding_changed" });
      }
    } catch (error) { code = runtimeErrorCode(error); }
    const duration = Date.now() - started;
    const status = code ? "failed" : "succeeded";
    getConn().prepare(`INSERT INTO runtime_connector_probes
      (connector_id,config_version,actor_id,checked_at,status,probe_kind,tool_count,duration_ms,error_code)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(id, before.version, actor.id, checkedAt, status, kind, count, duration, code);
    getConn().prepare(
      "UPDATE connectors SET enabled=?,status=?,last_verified_at=?,last_error=?,updated_at=? WHERE id=?",
    ).run(
      0,
      code ? "verification_failed" : "verified",
      checkedAt,
      code || null,
      checkedAt,
      id,
    );
    audit(actor.id, "runtime.connector.probed", { connector_id: id, version: before.version, status, probe_kind: kind, tool_count: count, duration_ms: duration, code });
    return c.json({ connector_id: id, config_version: before.version, actor_id: actor.id, checked_at: checkedAt,
      status, probe_kind: kind, tool_count: count, duration_ms: duration, error_code: code,
      live_verified: !code && kind === "mcp_tools_list",
      notice: kind === "http_definition" ? "仅校验 HTTP 动作定义，未调用外部业务接口。" : "仅验证该身份的 MCP 工具目录，不代表业务动作或其他账号可用。",
    }, code ? 502 : 200);
  });
  router.get("/admin/runtime/connectors/:connectorId/activity", (c) => {
    admin();
    const id = c.req.param("connectorId"); if (process.env.NODE_ENV !== "test") requireManagedConnector(id); connector(id); schema();
    const n = Number(c.req.query("limit") || 30);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpFail(400, { code: "invalid_limit" });
    const probes = getConn().prepare("SELECT * FROM runtime_connector_probes WHERE connector_id=? ORDER BY id DESC LIMIT ?").all(id, n);
    const events = (getConn().prepare(`SELECT id,ts,actor,event_type,payload FROM audit_events
      WHERE event_type LIKE 'runtime.%' AND json_valid(payload) AND json_extract(payload,'$.connector_id')=?
      ORDER BY id DESC LIMIT ?`).all(id, n) as Row[]).map((row) => ({ id: row.id, ts: row.ts, actor: row.actor,
        event_type: row.event_type, payload: tracePayload(row.payload) }));
    return c.json({ probes, events });
  });
  return router;
}
export const connectorOperationsRouter = createConnectorOperationsRouter();
