import { asRow, asRows, getConn, nowIso, txImmediate } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Row } from "../types.js";

/**
 * A streamable-HTTP MCP connector configuration. Values reference server-side
 * environment variables only; raw credential/header values are never accepted.
 */
export type ConnectorConfig = {
  url?: string;
  url_env?: string;
  headers_env?: Record<string, string>;
  bearer_env?: string;
  credential_provider?: string;
  allow_unauthenticated?: boolean;
  timeout_ms?: number;
};

const initializedConnections = new WeakSet<object>();
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_TOOL_NAME_LENGTH = 320;
const MAX_URL_LENGTH = 2048;
const MAX_HEADERS = 32;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SCHEMA_HASH = /^[a-f0-9]{64}$/i;

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
  `);

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

function assertConnectorExists(connectorId: string): void {
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

/** Strictly validates and canonicalizes a streamable-HTTP-only configuration. */
export function validateConnectorConfig(value: unknown): ConnectorConfig {
  if (!isPlainObject(value)) invalid("connector config must be an object");
  assertKnownKeys(value, [
    "url",
    "url_env",
    "headers_env",
    "bearer_env",
    "credential_provider",
    "allow_unauthenticated",
    "timeout_ms",
  ], "connector config");

  const suppliedUrl = value.url !== undefined;
  const suppliedUrlEnv = value.url_env !== undefined;
  if (suppliedUrl === suppliedUrlEnv) invalid("exactly one of url or url_env is required");

  const config: ConnectorConfig = {};
  if (suppliedUrl) {
    if (typeof value.url !== "string" || !value.url || value.url.length > MAX_URL_LENGTH || value.url.trim() !== value.url) {
      invalid("invalid url");
    }
    let parsed: URL;
    try {
      parsed = new URL(value.url);
    } catch {
      invalid("invalid url");
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash
      || value.url.includes("?") || value.url.includes("#")) {
      invalid("url must be http/https without credentials, query, or hash");
    }
    config.url = value.url;
  } else {
    config.url_env = assertEnvName(value.url_env, "url_env");
  }

  if (value.headers_env !== undefined) {
    if (!isPlainObject(value.headers_env) || Object.keys(value.headers_env).length > MAX_HEADERS) {
      invalid("headers_env must be a bounded object");
    }
    const headers: Record<string, string> = {};
    for (const [headerName, envName] of Object.entries(value.headers_env)) {
      if (!HTTP_HEADER_NAME.test(headerName)) invalid("invalid headers_env header name");
      headers[headerName] = assertEnvName(envName, `headers_env.${headerName}`);
    }
    if (!Object.keys(headers).length) invalid("headers_env must not be empty");
    config.headers_env = headers;
  }

  if (value.bearer_env !== undefined) config.bearer_env = assertEnvName(value.bearer_env, "bearer_env");

  if (value.credential_provider !== undefined) {
    if (typeof value.credential_provider !== "string") invalid("invalid credential_provider");
    // `starry-user` is the only registered provider in this iteration. The
    // runtime adapter resolves it server-side; no user token enters this table.
    if (value.credential_provider && value.credential_provider !== "starry-user") {
      invalid("credential_provider is not registered");
    }
    if (value.credential_provider) config.credential_provider = "starry-user";
  }

  if (value.allow_unauthenticated !== undefined) {
    config.allow_unauthenticated = assertBoolean(value.allow_unauthenticated, "allow_unauthenticated");
  }

  if (value.timeout_ms !== undefined) {
    if (typeof value.timeout_ms !== "number" || !Number.isInteger(value.timeout_ms)
      || value.timeout_ms < 1 || value.timeout_ms > 120_000) {
      invalid("timeout_ms must be an integer between 1 and 120000");
    }
    config.timeout_ms = value.timeout_ms;
  }

  if (!config.headers_env && !config.bearer_env && !config.credential_provider && config.allow_unauthenticated !== true) {
    invalid("credential reference required unless allow_unauthenticated is true");
  }
  return config;
}

function mustRow(value: unknown): Row {
  if (!value) throw new HttpFail(500, "runtime governance write failed");
  return asRow(value);
}

function versionedUpsert(
  table: "runtime_agent_skills" | "runtime_skill_connectors" | "runtime_connector_config" | "runtime_tool_policies",
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
      db.prepare(
        `INSERT INTO ${table} (${createColumns.join(",")}) VALUES (${createColumns.map(() => "?").join(",")})`,
      ).run(...createValues);
    } else {
      const actual = Number(existing.version);
      if (actual !== expected) conflict("runtime governance version conflict");
      const result = db.prepare(
        `UPDATE ${table} SET ${updateAssignments.join(",")}, version=?, updated_at=? WHERE ${where} AND version=?`,
      ).run(
        ...createValues.slice(keyColumns.length, keyColumns.length + updateAssignments.length),
        actual + 1,
        nowIso(),
        ...keyValues,
        actual,
      );
      if (!result.changes) conflict("runtime governance version conflict");
    }
    return mustRow(db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...keyValues));
  });
}

export function getAgentSkills(agentId: string): Row[] {
  const id = assertIdentifier(agentId, "agent_id");
  ensureRuntimeSchema();
  return asRows(getConn().prepare(
    "SELECT * FROM runtime_agent_skills WHERE agent_id=? ORDER BY skill_id",
  ).all(id));
}

export function getSkillConnectors(skillId: string): Row[] {
  const id = assertIdentifier(skillId, "skill_id");
  assertTaskDefinition(id);
  ensureRuntimeSchema();
  return asRows(getConn().prepare(
    "SELECT * FROM runtime_skill_connectors WHERE skill_id=? ORDER BY connector_id",
  ).all(id));
}

export function getConnectorConfig(id: string): { config: ConnectorConfig; version: number } | undefined {
  const connectorId = assertIdentifier(id, "connector_id");
  assertConnectorExists(connectorId);
  const row = getConn().prepare(
    "SELECT config_json,version FROM runtime_connector_config WHERE connector_id=?",
  ).get(connectorId) as Row | undefined;
  if (!row) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(String(row.config_json));
  } catch {
    throw new HttpFail(500, "stored runtime connector config is invalid");
  }
  return { config: validateConnectorConfig(decoded), version: Number(row.version) };
}

export function getToolPolicy(id: string, name: string): Row | undefined {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertConnectorExists(connectorId);
  ensureRuntimeSchema();
  const row = getConn().prepare(
    "SELECT * FROM runtime_tool_policies WHERE connector_id=? AND tool_name=?",
  ).get(connectorId, toolName);
  return row ? asRow(row) : undefined;
}

export function setAgentSkill(agentId: string, skillId: string, enabled: boolean, expectedVersion: number): Row {
  const agent = assertIdentifier(agentId, "agent_id");
  const skill = assertIdentifier(skillId, "skill_id");
  assertTaskDefinition(skill);
  const active = assertBoolean(enabled, "enabled");
  const now = nowIso();
  return versionedUpsert(
    "runtime_agent_skills",
    ["agent_id", "skill_id"],
    [agent, skill],
    ["agent_id", "skill_id", "enabled", "version", "updated_at"],
    [agent, skill, active ? 1 : 0, 1, now],
    ["enabled=?"],
    expectedVersion,
  );
}

export function setSkillConnector(skillId: string, connectorId: string, enabled: boolean, expectedVersion: number): Row {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  assertTaskDefinition(skill);
  assertConnectorExists(connector);
  const active = assertBoolean(enabled, "enabled");
  const now = nowIso();
  return versionedUpsert(
    "runtime_skill_connectors",
    ["skill_id", "connector_id"],
    [skill, connector],
    ["skill_id", "connector_id", "enabled", "version", "updated_at"],
    [skill, connector, active ? 1 : 0, 1, now],
    ["enabled=?"],
    expectedVersion,
  );
}

export function setConnectorConfig(id: string, config: ConnectorConfig, expectedVersion: number): Row {
  const connectorId = assertIdentifier(id, "connector_id");
  assertConnectorExists(connectorId);
  const validated = validateConnectorConfig(config);
  const now = nowIso();
  return versionedUpsert(
    "runtime_connector_config",
    ["connector_id"],
    [connectorId],
    ["connector_id", "config_json", "version", "updated_at"],
    [connectorId, JSON.stringify(validated), 1, now],
    ["config_json=?"],
    expectedVersion,
  );
}

export function setToolPolicy(
  id: string,
  name: string,
  value: { enabled: boolean; risk: "L1" | "L2" | "L3"; access: "read" | "write"; schema_hash: string },
  expectedVersion: number,
): Row {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  assertConnectorExists(connectorId);
  if (!isPlainObject(value)) invalid("tool policy must be an object");
  assertKnownKeys(value, ["enabled", "risk", "access", "schema_hash"], "tool policy");
  const enabled = assertBoolean(value.enabled, "enabled");
  if (value.risk !== "L1" && value.risk !== "L2" && value.risk !== "L3") invalid("risk must be L1, L2, or L3");
  if (value.access !== "read" && value.access !== "write") invalid("access must be read or write");
  if (typeof value.schema_hash !== "string" || !SCHEMA_HASH.test(value.schema_hash)) {
    invalid("schema_hash must be exactly 64 hexadecimal characters");
  }
  const schemaHash = value.schema_hash.toLowerCase();
  const now = nowIso();
  return versionedUpsert(
    "runtime_tool_policies",
    ["connector_id", "tool_name"],
    [connectorId, toolName],
    ["connector_id", "tool_name", "enabled", "risk", "access", "schema_hash", "version", "updated_at"],
    [connectorId, toolName, enabled ? 1 : 0, value.risk, value.access, schemaHash, 1, now],
    ["enabled=?", "risk=?", "access=?", "schema_hash=?"],
    expectedVersion,
  );
}
