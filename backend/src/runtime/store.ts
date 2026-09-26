import { asRow, asRows, getConn, nowIso, txImmediate } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import type { Row } from "../types.js";

export type HttpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  output_path?: string;
};

/**
 * Connector configuration is deliberately reference-only.  No header or bearer
 * values are accepted here; environment variable and credential-vault ids are
 * resolved only immediately before an outbound request.
 */
export type ConnectorConfig = {
  /** Omitted means MCP for compatibility with existing persisted configurations. */
  protocol?: "mcp" | "http";
  /**
   * MCP wire transport. Only the MCP protocol has a transport choice; omitted
   * means streamable-http so existing persisted configurations keep working.
   */
  transport?: "streamable-http" | "sse";
  url?: string;
  url_env?: string;
  headers_env?: Record<string, string>;
  bearer_env?: string;
  credential_provider?: string;
  /** Generic account selector consumed only by a registered credential provider. */
  credential_account_id?: string;
  allow_unauthenticated?: boolean;
  timeout_ms?: number;
  headers_secret_refs?: Record<string, string>;
  bearer_secret_ref?: string;
  http_tools?: HttpTool[];
};

const initializedConnections = new WeakSet<object>();
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_TOOL_NAME_LENGTH = 320;
const MAX_URL_LENGTH = 2048;
const MAX_HEADERS = 32;
const MAX_HTTP_TOOLS = 250;
const MAX_SCHEMA_BYTES = 128_000;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SCHEMA_HASH = /^[a-f0-9]{64}$/i;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const OUTPUT_PATH = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[0\]|\[[1-9][0-9]*\])*$/;
const RESERVED_HEADERS = new Set([
  "content-length", "host", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-connection",
]);
const PLATFORM_PLANNER_AGENT = "agent:workspace-planner";
const PLATFORM_PLANNER_SKILLS = ["today_plan", "todo_plan", "today_analyze"] as const;

/**
 * One deliberate production migration for the platform-owned, read-only work
 * planner. It never changes an existing admin decision: an already present
 * Agent→Skill row, including a disabled row, wins over this bootstrap.
 */
function bootstrapWorkspacePlanner(db: ReturnType<typeof getConn>): void {
  const migration = "runtime.workspace-planner.v1";
  if (db.prepare("SELECT 1 FROM runtime_bootstrap_migrations WHERE id=?").get(migration)) return;
  const definitions = new Map(taskDefinitions().map((definition) => [definition.id, definition]));
  for (const skillId of PLATFORM_PLANNER_SKILLS) {
    const definition = definitions.get(skillId);
    if (!definition || definition.runtime_agent_id !== PLATFORM_PLANNER_AGENT || definition.runtime_access !== "authenticated") {
      throw new Error(`invalid workspace planner declaration: ${skillId}`);
    }
  }
  const now = nowIso();
  txImmediate((tx) => {
    for (const skillId of PLATFORM_PLANNER_SKILLS) {
      tx.prepare(
        `INSERT INTO runtime_agent_skills (agent_id,skill_id,enabled,version,updated_at)
         SELECT ?,?,?,?,? WHERE NOT EXISTS (
           SELECT 1 FROM runtime_agent_skills WHERE agent_id=? AND skill_id=?
         )`,
      ).run(PLATFORM_PLANNER_AGENT, skillId, 1, 1, now, PLATFORM_PLANNER_AGENT, skillId);
      // These bundled platform skills are shipped as a reviewed release. Do not
      // revive a deliberately disabled / testing lifecycle state on a later boot.
      tx.prepare(
        `INSERT INTO skill_lifecycle (skill_id,stage,updated_at)
         SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM skill_lifecycle WHERE skill_id=?)`,
      ).run(skillId, "published", now, skillId);
      tx.prepare(
        "UPDATE skill_lifecycle SET stage='published',updated_at=? WHERE skill_id=? AND stage='draft'",
      ).run(now, skillId);
    }
    tx.prepare("INSERT INTO runtime_bootstrap_migrations (id,applied_at) VALUES (?,?)").run(migration, now);
    tx.prepare("INSERT INTO audit_events (ts,actor,event_type,payload) VALUES (?,?,?,?)").run(
      now,
      "system:runtime-bootstrap",
      "runtime.workspace_planner.migrated",
      JSON.stringify({ agent_id: PLATFORM_PLANNER_AGENT, skills: PLATFORM_PLANNER_SKILLS, migration }),
    );
  });
}

/**
 * Lazily creates only runtime-governance tables. A WeakSet deliberately keys
 * by connection instance so an isolated test reset receives the schema again.
 */
export function ensureRuntimeSchema(): void {
  const db = getConn();
  if (initializedConnections.has(db)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL CHECK (version >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_skill_connectors (
      skill_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL CHECK (version >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, connector_id),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_skill_tools (
      skill_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      version INTEGER NOT NULL CHECK (version >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (skill_id, connector_id, tool_name),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_connector_config (
      connector_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_tool_policies (
      connector_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      risk TEXT NOT NULL CHECK (risk IN ('L1', 'L2', 'L3')),
      access TEXT NOT NULL CHECK (access IN ('read', 'write')),
      schema_hash TEXT NOT NULL CHECK (
        length(schema_hash) = 64
        AND schema_hash NOT GLOB '*[^0123456789abcdef]*'
      ),
      version INTEGER NOT NULL CHECK (version >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (connector_id, tool_name),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runtime_bootstrap_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  bootstrapWorkspacePlanner(db);
  initializedConnections.add(db);
}

function invalid(message: string): never {
  throw new HttpFail(400, message);
}

function conflict(message: string): never {
  throw new HttpFail(409, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertIdentifier(value: unknown, name: string, maxLength = MAX_IDENTIFIER_LENGTH): string {
  if (typeof value !== "string" || !value || value.length > maxLength || /[\x00-\x1f\x7f]/.test(value)) {
    invalid(`invalid ${name}`);
  }
  return value;
}

function assertExpectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid("expected_version must be a non-negative integer");
  return value;
}

function assertBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") invalid(`${name} must be boolean`);
  return value;
}

function assertEnvName(value: unknown, name: string): string {
  if (typeof value !== "string" || !ENV_NAME.test(value)) invalid(`invalid ${name}`);
  return value;
}

function assertReferenceId(value: unknown, name: string): string {
  if (typeof value !== "string" || !REFERENCE_ID.test(value)) invalid(`invalid ${name}`);
  return value;
}

export function assertRuntimeConnectorExists(connectorId: string): void {
  ensureRuntimeSchema();
  if (!getConn().prepare("SELECT 1 FROM connectors WHERE id=?").get(connectorId)) {
    throw new HttpFail(404, "connector not found");
  }
}

function assertTaskDefinition(skillId: string): void {
  if (!taskDefinition(skillId)) throw new HttpFail(404, "skill not found");
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) invalid(`${name} contains unsupported fields`);
}

function assertJsonSchema(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainObject(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_SCHEMA_BYTES) invalid(`invalid ${name}`);
  const walk = (child: unknown, depth: number): boolean => {
    if (depth > 32) return false;
    if (!child || typeof child !== "object") return true;
    if (typeof (child as Record<string, unknown>).$ref === "string"
      && !String((child as Record<string, unknown>).$ref).startsWith("#")) return false;
    return Object.values(child).every((entry) => walk(entry, depth + 1));
  };
  if (!walk(value, 0)) invalid(`invalid ${name}`);
  if (value.type !== "object") invalid(`${name} must describe an object`);
  return structuredClone(value);
}

function assertPath(path: unknown, schema: Record<string, unknown>): string {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.length > 1024
    || /[\\?#\x00-\x1f\x7f]/.test(path)) invalid("invalid http tool path");
  for (const part of path.split("/")) {
    const decoded = decodeURIComponent(part);
    if (decoded === "." || decoded === "..") invalid("invalid http tool path");
  }
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const placeholders = [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);
  const stripped = path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "");
  if (/[{}]/.test(stripped) || new Set(placeholders).size !== placeholders.length
    || placeholders.some((field) => !(field in properties))) invalid("invalid http tool path template");
  return path;
}

function assertFieldMap(value: unknown, name: string, schema: Record<string, unknown>): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || !Object.keys(value).length || Object.keys(value).length > 100) invalid(`${name} must be a bounded object`);
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const result: Record<string, string> = {};
  for (const [target, source] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(target) || typeof source !== "string" || !(source in properties)) {
      invalid(`invalid ${name}`);
    }
    result[target] = source;
  }
  return result;
}

function validateHttpTool(value: unknown): HttpTool {
  if (!isPlainObject(value)) invalid("http tool must be an object");
  assertKnownKeys(value, ["name", "description", "inputSchema", "method", "path", "query", "body", "output_path"], "http tool");
  const name = assertIdentifier(value.name, "http tool name", MAX_TOOL_NAME_LENGTH);
  if (typeof value.description !== "string" || !value.description.trim() || value.description.length > 4_000 || /[\x00-\x1f\x7f]/.test(value.description)) {
    invalid("invalid http tool description");
  }
  const inputSchema = assertJsonSchema(value.inputSchema, "http tool inputSchema");
  if (typeof value.method !== "string" || !HTTP_METHODS.has(value.method)) invalid("invalid http tool method");
  const method = value.method as HttpTool["method"];
  const path = assertPath(value.path, inputSchema);
  const query = assertFieldMap(value.query, "http tool query", inputSchema);
  const body = assertFieldMap(value.body, "http tool body", inputSchema);
  if (method === "GET" && body) invalid("GET http tools cannot have a body mapping");
  if (value.output_path !== undefined && (typeof value.output_path !== "string" || !OUTPUT_PATH.test(value.output_path))) {
    invalid("invalid http tool output_path");
  }
  return { name, description: value.description, inputSchema, method, path,
    ...(query ? { query } : {}), ...(body ? { body } : {}), ...(value.output_path ? { output_path: value.output_path } : {}) };
}

function validateHeaderRefs(value: unknown, name: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || Object.keys(value).length > MAX_HEADERS || !Object.keys(value).length) invalid(`${name} must be a bounded object`);
  const headers: Record<string, string> = {};
  for (const [headerName, reference] of Object.entries(value)) {
    if (!HTTP_HEADER_NAME.test(headerName) || RESERVED_HEADERS.has(headerName.toLowerCase())) invalid(`invalid ${name} header name`);
    headers[headerName] = assertReferenceId(reference, `${name}.${headerName}`);
  }
  return headers;
}

function ensureNoHeaderCollisions(...sets: Array<Record<string, string> | undefined>): void {
  const seen = new Set<string>();
  for (const values of sets) {
    for (const name of Object.keys(values || {})) {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) invalid("connector credential headers conflict");
      seen.add(normalized);
    }
  }
}

/** Strictly validates and canonicalizes an MCP or JSON HTTP connector configuration. */
export function validateConnectorConfig(value: unknown): ConnectorConfig {
  if (!isPlainObject(value)) invalid("connector config must be an object");
  assertKnownKeys(value, [
    "protocol", "transport", "url", "url_env", "headers_env", "bearer_env", "credential_provider",
    "credential_account_id", "allow_unauthenticated", "timeout_ms", "headers_secret_refs", "bearer_secret_ref",
    "http_tools",
  ], "connector config");

  const suppliedUrl = value.url !== undefined;
  const suppliedUrlEnv = value.url_env !== undefined;
  if (suppliedUrl === suppliedUrlEnv) invalid("exactly one of url or url_env is required");

  const config: ConnectorConfig = {};
  if (value.protocol !== undefined) {
    if (value.protocol !== "mcp" && value.protocol !== "http") invalid("protocol must be mcp or http");
    config.protocol = value.protocol;
  }
  if (value.transport !== undefined) {
    if (value.transport !== "streamable-http" && value.transport !== "sse") invalid("transport must be streamable-http or sse");
    if ((config.protocol || "mcp") !== "mcp") invalid("transport is supported only for mcp connectors");
    config.transport = value.transport;
  }
  if (suppliedUrl) {
    if (typeof value.url !== "string" || !value.url || value.url.length > MAX_URL_LENGTH || value.url.trim() !== value.url) invalid("invalid url");
    let parsed: URL;
    try { parsed = new URL(value.url); } catch { invalid("invalid url"); }
    if ((parsed!.protocol !== "http:" && parsed!.protocol !== "https:") || !parsed!.hostname || parsed!.username || parsed!.password
      || parsed!.search || parsed!.hash || value.url.includes("?") || value.url.includes("#")) {
      invalid("url must be http/https without credentials, query, or hash");
    }
    config.url = value.url;
  } else {
    config.url_env = assertEnvName(value.url_env, "url_env");
  }

  if (value.headers_env !== undefined) {
    if (!isPlainObject(value.headers_env) || Object.keys(value.headers_env).length > MAX_HEADERS || !Object.keys(value.headers_env).length) {
      invalid("headers_env must be a bounded object");
    }
    const headers: Record<string, string> = {};
    for (const [headerName, envName] of Object.entries(value.headers_env)) {
      if (!HTTP_HEADER_NAME.test(headerName) || RESERVED_HEADERS.has(headerName.toLowerCase())) invalid("invalid headers_env header name");
      headers[headerName] = assertEnvName(envName, `headers_env.${headerName}`);
    }
    config.headers_env = headers;
  }

  if (value.bearer_env !== undefined) config.bearer_env = assertEnvName(value.bearer_env, "bearer_env");
  const secretHeaders = validateHeaderRefs(value.headers_secret_refs, "headers_secret_refs");
  if (secretHeaders) config.headers_secret_refs = secretHeaders;
  if (value.bearer_secret_ref !== undefined) config.bearer_secret_ref = assertReferenceId(value.bearer_secret_ref, "bearer_secret_ref");
  ensureNoHeaderCollisions(config.headers_env, config.headers_secret_refs);
  const hasExplicitAuthorization = [...Object.keys(config.headers_env || {}), ...Object.keys(config.headers_secret_refs || {})]
    .some((name) => name.toLowerCase() === "authorization");
  if ((config.bearer_env || config.bearer_secret_ref) && hasExplicitAuthorization) invalid("connector credential headers conflict");
  if (config.bearer_env && config.bearer_secret_ref) invalid("connector bearer references conflict");

  if (value.credential_provider !== undefined) {
    if (value.credential_provider !== "user-account") {
      invalid("credential_provider is not registered");
    }
    config.credential_provider = value.credential_provider;
  }
  if (value.credential_account_id !== undefined) {
    if (!config.credential_provider) invalid("credential_account_id requires credential_provider");
    config.credential_account_id = assertReferenceId(value.credential_account_id, "credential_account_id");
  }
  if (config.credential_provider === "user-account" && !config.credential_account_id) {
    invalid("user-account credential_provider requires credential_account_id");
  }
  if (config.credential_provider === "user-account" && (config.bearer_env || config.bearer_secret_ref || hasExplicitAuthorization)) {
    invalid("user-account credential provider cannot combine with Authorization references");
  }

  if (value.allow_unauthenticated !== undefined) config.allow_unauthenticated = assertBoolean(value.allow_unauthenticated, "allow_unauthenticated");
  if (value.timeout_ms !== undefined) {
    if (typeof value.timeout_ms !== "number" || !Number.isInteger(value.timeout_ms) || value.timeout_ms < 1 || value.timeout_ms > 120_000) {
      invalid("timeout_ms must be an integer between 1 and 120000");
    }
    config.timeout_ms = value.timeout_ms;
  }

  if (value.http_tools !== undefined) {
    if ((config.protocol || "mcp") !== "http" || !Array.isArray(value.http_tools) || value.http_tools.length > MAX_HTTP_TOOLS) {
      invalid("http_tools is supported only for http connectors");
    }
    const names = new Set<string>();
    const tools = value.http_tools.map(validateHttpTool);
    if (tools.some((tool) => names.has(tool.name) || !names.add(tool.name))) invalid("http tool names must be unique");
    config.http_tools = tools;
  } else if ((config.protocol || "mcp") === "http") {
    config.http_tools = [];
  }

  if (!config.headers_env && !config.headers_secret_refs && !config.bearer_env && !config.bearer_secret_ref
    && !config.credential_provider && config.allow_unauthenticated !== true) {
    invalid("credential reference required unless allow_unauthenticated is true");
  }
  return config;
}

function mustRow(value: unknown): Row {
  if (!value) throw new HttpFail(500, "runtime governance write failed");
  return asRow(value);
}

type VersionedTable = "runtime_agent_skills" | "runtime_skill_connectors" | "runtime_skill_tools" | "runtime_connector_config" | "runtime_tool_policies";
function versionedUpsert(
  table: VersionedTable,
  keyColumns: readonly string[],
  keyValues: readonly unknown[],
  createColumns: readonly string[],
  createValues: readonly unknown[],
  updateAssignments: readonly string[],
  expectedVersion: number,
): Row {
  const expected = assertExpectedVersion(expectedVersion);
  ensureRuntimeSchema();
  return txImmediate((db) => {
    const where = keyColumns.map((column) => `${column}=?`).join(" AND ");
    const existing = db.prepare(`SELECT version FROM ${table} WHERE ${where}`).get(...keyValues) as Row | undefined;
    if (!existing) {
      if (expected !== 0) conflict("runtime governance version conflict");
      db.prepare(`INSERT INTO ${table} (${createColumns.join(",")}) VALUES (${createColumns.map(() => "?").join(",")})`).run(...createValues);
    } else {
      const actual = Number(existing.version);
      if (actual !== expected) conflict("runtime governance version conflict");
      const result = db.prepare(`UPDATE ${table} SET ${updateAssignments.join(",")}, version=?, updated_at=? WHERE ${where} AND version=?`).run(
        ...createValues.slice(keyColumns.length, keyColumns.length + updateAssignments.length), actual + 1, nowIso(), ...keyValues, actual,
      );
      if (!result.changes) conflict("runtime governance version conflict");
    }
    return mustRow(db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...keyValues));
  });
}

export function getAgentSkills(agentId: string): Row[] {
  const id = assertIdentifier(agentId, "agent_id");
  ensureRuntimeSchema();
  return asRows(getConn().prepare("SELECT * FROM runtime_agent_skills WHERE agent_id=? ORDER BY skill_id").all(id));
}

export function getSkillConnectors(skillId: string): Row[] {
  const id = assertIdentifier(skillId, "skill_id");
  assertTaskDefinition(id);
  ensureRuntimeSchema();
  return asRows(getConn().prepare("SELECT * FROM runtime_skill_connectors WHERE skill_id=? ORDER BY connector_id").all(id));
}

export function getSkillTools(skillId: string, connectorId?: string): Row[] {
  const skill = assertIdentifier(skillId, "skill_id");
  assertTaskDefinition(skill);
  ensureRuntimeSchema();
  if (connectorId === undefined) return asRows(getConn().prepare(
    "SELECT * FROM runtime_skill_tools WHERE skill_id=? ORDER BY connector_id,tool_name",
  ).all(skill));
  const connector = assertIdentifier(connectorId, "connector_id");
  return asRows(getConn().prepare(
    "SELECT * FROM runtime_skill_tools WHERE skill_id=? AND connector_id=? ORDER BY tool_name",
  ).all(skill, connector));
}

export function getSkillTool(skillId: string, connectorId: string, toolName: string): Row | undefined {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  const tool = assertIdentifier(toolName, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertTaskDefinition(skill);
  ensureRuntimeSchema();
  const row = getConn().prepare(
    "SELECT * FROM runtime_skill_tools WHERE skill_id=? AND connector_id=? AND tool_name=?",
  ).get(skill, connector, tool);
  return row ? asRow(row) : undefined;
}

export function getConnectorConfig(id: string): { config: ConnectorConfig; version: number } | undefined {
  const connectorId = assertIdentifier(id, "connector_id");
  assertRuntimeConnectorExists(connectorId);
  const row = getConn().prepare("SELECT config_json,version FROM runtime_connector_config WHERE connector_id=?").get(connectorId) as Row | undefined;
  if (!row) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(String(row.config_json)); } catch { throw new HttpFail(500, "stored runtime connector config is invalid"); }
  return { config: validateConnectorConfig(decoded), version: Number(row.version) };
}

export function getToolPolicy(id: string, name: string): Row | undefined {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertRuntimeConnectorExists(connectorId);
  ensureRuntimeSchema();
  const row = getConn().prepare("SELECT * FROM runtime_tool_policies WHERE connector_id=? AND tool_name=?").get(connectorId, toolName);
  return row ? asRow(row) : undefined;
}

export function getConnectorPolicies(id: string): Row[] {
  const connectorId = assertIdentifier(id, "connector_id");
  assertRuntimeConnectorExists(connectorId);
  ensureRuntimeSchema();
  return asRows(getConn().prepare(
    "SELECT * FROM runtime_tool_policies WHERE connector_id=? ORDER BY tool_name",
  ).all(connectorId));
}

export function setAgentSkill(agentId: string, skillId: string, enabled: boolean, expectedVersion: number): Row {
  const agent = assertIdentifier(agentId, "agent_id");
  const skill = assertIdentifier(skillId, "skill_id");
  assertTaskDefinition(skill);
  const active = assertBoolean(enabled, "enabled");
  const now = nowIso();
  return versionedUpsert("runtime_agent_skills", ["agent_id", "skill_id"], [agent, skill],
    ["agent_id", "skill_id", "enabled", "version", "updated_at"], [agent, skill, active ? 1 : 0, 1, now], ["enabled=?"], expectedVersion);
}

export function setSkillConnector(skillId: string, connectorId: string, enabled: boolean, expectedVersion: number): Row {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  assertTaskDefinition(skill);
  assertRuntimeConnectorExists(connector);
  const active = assertBoolean(enabled, "enabled");
  const now = nowIso();
  return versionedUpsert("runtime_skill_connectors", ["skill_id", "connector_id"], [skill, connector],
    ["skill_id", "connector_id", "enabled", "version", "updated_at"], [skill, connector, active ? 1 : 0, 1, now], ["enabled=?"], expectedVersion);
}

/** An explicit tool row is required in addition to the existing Skill→Connector binding. */
export function setSkillTool(skillId: string, connectorId: string, toolName: string, enabled: boolean, expectedVersion: number): Row {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  const tool = assertIdentifier(toolName, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertTaskDefinition(skill);
  assertRuntimeConnectorExists(connector);
  const parent = getSkillConnectors(skill).find((row) => row.connector_id === connector);
  if (!parent?.enabled) throw new HttpFail(409, "enabled skill connector binding is required before binding a tool");
  // A policy row is the reviewed catalog identity. It may be disabled while the
  // administrator prepares bindings, but a fabricated tool name cannot be mounted.
  if (!getToolPolicy(connector, tool)) throw new HttpFail(409, "tool policy is required before binding a tool");
  const active = assertBoolean(enabled, "enabled");
  const now = nowIso();
  return versionedUpsert("runtime_skill_tools", ["skill_id", "connector_id", "tool_name"], [skill, connector, tool],
    ["skill_id", "connector_id", "tool_name", "enabled", "version", "updated_at"], [skill, connector, tool, active ? 1 : 0, 1, now],
    ["enabled=?"], expectedVersion);
}

export function setConnectorConfig(id: string, config: ConnectorConfig, expectedVersion: number): Row {
  const connectorId = assertIdentifier(id, "connector_id");
  assertRuntimeConnectorExists(connectorId);
  const validated = validateConnectorConfig(config);
  const now = nowIso();
  return versionedUpsert("runtime_connector_config", ["connector_id"], [connectorId],
    ["connector_id", "config_json", "version", "updated_at"], [connectorId, JSON.stringify(validated), 1, now], ["config_json=?"], expectedVersion);
}

export function setToolPolicy(
  id: string,
  name: string,
  value: { enabled: boolean; risk: "L1" | "L2" | "L3"; access: "read" | "write"; schema_hash: string },
  expectedVersion: number,
): Row {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertRuntimeConnectorExists(connectorId);
  if (!isPlainObject(value)) invalid("tool policy must be an object");
  assertKnownKeys(value, ["enabled", "risk", "access", "schema_hash"], "tool policy");
  const enabled = assertBoolean(value.enabled, "enabled");
  if (value.risk !== "L1" && value.risk !== "L2" && value.risk !== "L3") invalid("risk must be L1, L2, or L3");
  if (value.access !== "read" && value.access !== "write") invalid("access must be read or write");
  if (typeof value.schema_hash !== "string" || !SCHEMA_HASH.test(value.schema_hash)) invalid("schema_hash must be exactly 64 hexadecimal characters");
  const schemaHash = value.schema_hash.toLowerCase();
  const now = nowIso();
  return versionedUpsert("runtime_tool_policies", ["connector_id", "tool_name"], [connectorId, toolName],
    ["connector_id", "tool_name", "enabled", "risk", "access", "schema_hash", "version", "updated_at"],
    [connectorId, toolName, enabled ? 1 : 0, value.risk, value.access, schemaHash, 1, now],
    ["enabled=?", "risk=?", "access=?", "schema_hash=?"], expectedVersion);
}
