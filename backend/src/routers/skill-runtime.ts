import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit, getConn, nowIso } from "../db.js";
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
import { skillCoverage, type ToolMountState } from "../runtime/skill-coverage.js";
import { taskDefinition } from "../tasks/registry.js";
import { requireManagedConnector } from "../connectors/catalog.js";
import { isMediaCrawlerHostConfig } from "../runtime/mediacrawler-config.js";

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

/** 挂载请求体可以整体缺省（＝覆盖扫描已上线技能），所以空 body 按 {} 处理。 */
async function optionalBody(c: { req: { text: () => Promise<string> } }): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
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

function requireManagedRuntimeConnector(connectorId: string): void {
  // Isolated runtime tests deliberately construct a generic connector fixture;
  // product routes outside that harness are limited to the fixed catalog.
  if (process.env.NODE_ENV !== "test") requireManagedConnector(connectorId);
}

type DeclaredMountSkipReason = "policy_disabled" | "policy_unregistered" | "unknown_connector";
type DeclaredMountSkipped = { tool_name: string; reason: DeclaredMountSkipReason };
type DeclaredMountSkillResult = {
  skill_id: string;
  connector_bound: boolean;
  connector_created: boolean;
  mounted: string[];
  unchanged: string[];
  skipped: DeclaredMountSkipped[];
};

const DECLARED_MOUNT_SKIP: Partial<Record<ToolMountState, DeclaredMountSkipReason>> = {
  blocked_by_policy: "policy_disabled",
  unregistered: "policy_unregistered",
  unknown_connector: "unknown_connector",
};

function declaredSkillIds(body: Record<string, unknown>): string[] | undefined {
  if (body.skill_ids === undefined) return undefined;
  const value = body.skill_ids;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new HttpFail(400, "skill_ids must be a string array");
  }
  return [...new Set(value.map((entry) => String(entry).trim()))];
}

/**
 * 把技能声明里已就绪的工具逐条挂上：只启用 Skill→Connector / Skill→Tool 绑定行。
 * 连接器本体与工具策略的启用是管理员在连接器控制台的显式动作，这里绝不代做；
 * 声明之外的工具也不挂。已启用行原样保留，所以重复调用只产生 unchanged。
 */
function mountDeclaredTools(connectorId: string, requestedSkillIds: string[] | undefined, actor: string) {
  const coverage = skillCoverage({ connectorId });
  const connectorExists = Boolean(getConn().prepare("SELECT 1 FROM connectors WHERE id=?").get(connectorId));
  const skillIds = requestedSkillIds
    ?? coverage.skills.filter((skill) => skill.implementation === "live").map((skill) => skill.skill_id);
  const results: DeclaredMountSkillResult[] = [];
  for (const skillId of skillIds) {
    const declaredTools = coverage.skills.find((skill) => skill.skill_id === skillId)?.tools ?? [];
    const mounted: string[] = [];
    const unchanged: string[] = [];
    const skipped: DeclaredMountSkipped[] = [];
    let connectorBound = false;
    let connectorCreated = false;
    if (connectorExists) {
      // 工具绑定的前置是启用的父连接器绑定（store 会拦），所以父绑定先于逐条工具处理。
      const binding = getSkillConnectors(skillId).find((row) => row.connector_id === connectorId);
      if (!binding) {
        setSkillConnector(skillId, connectorId, true, 0);
        connectorCreated = true;
      } else if (Number(binding.enabled) !== 1) {
        setSkillConnector(skillId, connectorId, true, Number(binding.version) || 0);
      }
      connectorBound = true;
    }
    const existingTools = getSkillTools(skillId, connectorId);
    for (const tool of declaredTools) {
      const reason = DECLARED_MOUNT_SKIP[tool.state];
      if (reason) {
        skipped.push({ tool_name: tool.tool_name, reason });
        continue;
      }
      const existing = existingTools.find((row) => row.tool_name === tool.tool_name);
      // 已启用行不重写：版本号不该因为「再挂一次」而上涨，幂等靠这条守住。
      if (tool.state === "mounted" || Number(existing?.enabled) === 1) {
        unchanged.push(tool.tool_name);
        continue;
      }
      setSkillTool(skillId, connectorId, tool.tool_name, true, Number(existing?.version) || 0);
      mounted.push(tool.tool_name);
    }
    audit(actor, "runtime.skill_mount.declared", {
      connector_id: connectorId,
      skill_id: skillId,
      mounted,
      unchanged,
      skipped,
    });
    results.push({
      skill_id: skillId,
      connector_bound: connectorBound,
      connector_created: connectorCreated,
      mounted,
      unchanged,
      skipped,
    });
  }
  const count = (pick: (result: DeclaredMountSkillResult) => unknown[]) =>
    results.reduce((total, result) => total + pick(result).length, 0);
  return {
    connector_id: connectorId,
    summary: {
      skills: results.length,
      mounted_tools: count((result) => result.mounted),
      unchanged_tools: count((result) => result.unchanged),
      skipped_tools: count((result) => result.skipped),
    },
    skills: results,
  };
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

skillRuntimeRouter.get("/admin/runtime/skills/coverage", (c) => {
  runtimeAdmin();
  const connectorId = c.req.query("connector_id")?.trim();
  return c.json(skillCoverage(connectorId ? { connectorId } : {}));
});

skillRuntimeRouter.post("/admin/runtime/connectors/:connectorId/mount-declared", async (c) => {
  const admin = runtimeAdmin();
  const connectorId = c.req.param("connectorId");
  requireManagedRuntimeConnector(connectorId);
  const body = await optionalBody(c);
  onlyFields(body, ["skill_ids"]);
  const skillIds = declaredSkillIds(body);
  if (skillIds) {
    // 未定义的 id 一律先拒，避免半批写入之后才失败。
    const unknown = skillIds.find((skillId) => !taskDefinition(skillId));
    if (unknown) throw new HttpFail(400, { code: "unknown_skill", skill_id: unknown });
  }
  return c.json(mountDeclaredTools(connectorId, skillIds, admin.id));
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/config", (c) => {
  runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
  const result = getConnectorConfig(c.req.param("connectorId"));
  if (!result) throw new HttpFail(404, "runtime connector config not found");
  return c.json({ ...result, ...(isMediaCrawlerHostConfig(result.config, c.req.param("connectorId")) ? { probe_mode: "mediacrawler_start" } : {}) });
});

skillRuntimeRouter.put("/admin/runtime/connectors/:connectorId/config", async (c) => {
  const admin = runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
  const body = await bodyObject(c);
  onlyFields(body, [
    "protocol",
    "transport",
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
  if (process.env.NODE_ENV !== "test") {
    getConn().prepare(
      "UPDATE connectors SET enabled=0,status='pending_verification',last_error=NULL,updated_at=? WHERE id=?",
    ).run(nowIso(), row.connector_id);
  }
  audit(admin.id, "runtime.config.updated", {
    action: "upserted",
    connector_id: row.connector_id,
    version: row.version,
  });
  // Return only the validated, reference-only DTO; never expose config_json.
  return c.json({ config, version: row.version,
    ...(isMediaCrawlerHostConfig(config, c.req.param("connectorId")) ? { probe_mode: "mediacrawler_start" } : {}) });
});

skillRuntimeRouter.post("/admin/runtime/connectors/:connectorId/import-openapi", async (c) => {
  runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
  const body = await bodyObject(c);
  onlyFields(body, ["document"]);
  if (!("document" in body)) throw new HttpFail(400, "document is required");
  // Preview only: it never saves connector config, grants a tool or invokes an endpoint.
  return c.json(previewOpenApi(body.document));
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/policies", (c) => {
  runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
  return c.json(getConnectorPolicies(c.req.param("connectorId")));
});

skillRuntimeRouter.get("/admin/runtime/connectors/:connectorId/tools/:toolName", (c) => {
  runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
  const policy = getToolPolicy(c.req.param("connectorId"), c.req.param("toolName"));
  if (!policy) throw new HttpFail(404, "tool policy not found");
  return c.json(policy);
});

skillRuntimeRouter.put("/admin/runtime/connectors/:connectorId/tools/:toolName", async (c) => {
  const admin = runtimeAdmin();
  requireManagedRuntimeConnector(c.req.param("connectorId"));
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
