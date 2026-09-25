import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import {
  getAgentSkills,
  getConnectorConfig,
  getConnectorPolicies,
  getSkillConnectors,
  getSkillTools,
  getToolPolicy,
  setAgentSkill,
  setConnectorConfig,
  setSkillConnector,
  setSkillTool,
  setToolPolicy,
  validateConnectorConfig,
} from "../runtime/store.js";
import { previewOpenApi } from "../runtime/openapi.js";

export const skillRuntimeRouter = new Hono();

function runtimeAdmin() {
  // AUTH_MODE=disabled is useful only in the isolated test harness. Production
  // runtime governance must never silently become anonymously writable.
  if (authDisabled() && process.env.NODE_ENV !== "test") {
    throw new HttpFail(403, "runtime governance requires enabled authentication outside tests");
  }
  return requireAdmin();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyFields(body: Record<string, unknown>, fields: readonly string[]): void {
  const allowed = new Set(fields);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new HttpFail(400, "unsupported request field");
}

async function bodyObject(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpFail(400, "request body must be JSON");
  }
  if (!isPlainObject(body)) throw new HttpFail(400, "request body must be an object");
  return body;
}

function expectedVersion(body: Record<string, unknown>): number {
  if (!("expected_version" in body)
    || typeof body.expected_version !== "number"
    || !Number.isInteger(body.expected_version)
    || body.expected_version < 0) {
    throw new HttpFail(400, "expected_version must be a non-negative integer");
  }
  return body.expected_version;
}

function enabled(body: Record<string, unknown>): boolean {
  if (typeof body.enabled !== "boolean") throw new HttpFail(400, "enabled must be boolean");
  return body.enabled;
}

skillRuntimeRouter.get("/admin/runtime/agents/:agentId/skills", (c) => {
  runtimeAdmin();
  return c.json(getAgentSkills(c.req.param("agentId")));
});

skillRuntimeRouter.put("/admin/runtime/agents/:agentId/skills/:skillId", async (c) => {
  const admin = runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["enabled", "expected_version"]);
  const row = setAgentSkill(c.req.param("agentId"), c.req.param("skillId"), enabled(body), expectedVersion(body));
  audit(admin.id, "runtime.binding.updated", {
    action: enabled(body) ? "enabled" : "disabled",
    agent_id: row.agent_id,
    skill_id: row.skill_id,
    version: row.version,
  });
  return c.json(row);
});

skillRuntimeRouter.get("/admin/runtime/skills/:skillId/connectors", (c) => {
  runtimeAdmin();
  return c.json(getSkillConnectors(c.req.param("skillId")));
});

skillRuntimeRouter.put("/admin/runtime/skills/:skillId/connectors/:connectorId", async (c) => {
  const admin = runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["enabled", "expected_version"]);
  const row = setSkillConnector(c.req.param("skillId"), c.req.param("connectorId"), enabled(body), expectedVersion(body));
  audit(admin.id, "runtime.binding.updated", {
    action: enabled(body) ? "enabled" : "disabled",
    skill_id: row.skill_id,
    connector_id: row.connector_id,
    version: row.version,
  });
  return c.json(row);
});

skillRuntimeRouter.get("/admin/runtime/skills/:skillId/tools", (c) => {
  runtimeAdmin();
  return c.json(getSkillTools(c.req.param("skillId")));
});

skillRuntimeRouter.put("/admin/runtime/skills/:skillId/tools/:connectorId/:toolName", async (c) => {
  const admin = runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["enabled", "expected_version"]);
  const row = setSkillTool(
    c.req.param("skillId"), c.req.param("connectorId"), c.req.param("toolName"), enabled(body), expectedVersion(body),
  );
  audit(admin.id, "runtime.tool_binding.updated", {
    action: row.enabled ? "enabled" : "disabled", skill_id: row.skill_id,
    connector_id: row.connector_id, tool_name: row.tool_name, version: row.version,
  });
  return c.json(row);
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/config", (c) => {
  runtimeAdmin();
  const result = getConnectorConfig(c.req.param("connectorId"));
  if (!result) throw new HttpFail(404, "runtime connector config not found");
  return c.json(result);
});

skillRuntimeRouter.put("/admin/runtime/connectors/:connectorId/config", async (c) => {
  const admin = runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, [
    "protocol",
    "url",
    "url_env",
    "headers_env",
    "bearer_env",
    "credential_provider",
    "credential_account_id",
    "allow_unauthenticated",
    "timeout_ms",
    "headers_secret_refs",
    "bearer_secret_ref",
    "http_tools",
    "expected_version",
  ]);
  const version = expectedVersion(body);
  const { expected_version: _expectedVersion, ...configBody } = body;
  const config = validateConnectorConfig(configBody);
  const row = setConnectorConfig(c.req.param("connectorId"), config, version);
  audit(admin.id, "runtime.config.updated", {
    action: "upserted",
    connector_id: row.connector_id,
    version: row.version,
  });
  // Return only the validated, reference-only DTO; never expose config_json.
  return c.json({ config, version: row.version });
});

skillRuntimeRouter.post("/admin/runtime/connectors/:connectorId/import-openapi", async (c) => {
  runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["document"]);
  if (!("document" in body)) throw new HttpFail(400, "document is required");
  // Preview only: it never saves connector config, grants a tool or invokes an endpoint.
  return c.json(previewOpenApi(body.document));
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/policies", (c) => {
  runtimeAdmin();
  return c.json(getConnectorPolicies(c.req.param("connectorId")));
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/tools/:toolName", (c) => {
  runtimeAdmin();
  const policy = getToolPolicy(c.req.param("connectorId"), c.req.param("toolName"));
  if (!policy) throw new HttpFail(404, "tool policy not found");
  return c.json(policy);
});

skillRuntimeRouter.put("/admin/runtime/connectors/:connectorId/tools/:toolName", async (c) => {
  const admin = runtimeAdmin();
  const body = await bodyObject(c);
  onlyFields(body, ["enabled", "risk", "access", "schema_hash", "expected_version"]);
  const version = expectedVersion(body);
  if (body.risk !== "L1" && body.risk !== "L2" && body.risk !== "L3") throw new HttpFail(400, "risk must be L1, L2, or L3");
  if (body.access !== "read" && body.access !== "write") throw new HttpFail(400, "access must be read or write");
  if (typeof body.schema_hash !== "string") throw new HttpFail(400, "schema_hash must be a string");
  const row = setToolPolicy(c.req.param("connectorId"), c.req.param("toolName"), {
    enabled: enabled(body),
    risk: body.risk,
    access: body.access,
    schema_hash: body.schema_hash,
  }, version);
  // L3 policy registration is intentionally metadata only. The Host Gateway,
  // not this router, remains the sole formal-action execution path.
  audit(admin.id, "runtime.tool_policy.updated", {
    action: row.enabled ? "enabled" : "disabled",
    connector_id: row.connector_id,
    tool_name: row.tool_name,
    version: row.version,
  });
  return c.json(row);
});
