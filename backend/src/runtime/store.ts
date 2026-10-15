import { assertConnectorCredentialStorage } from "../connectors/catalog.js";
import { runtimeAgentBindingManifest } from "../contract-scope.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import type { Row } from "../types.js";
import {
  RuntimeVersionConflict,
  pgRuntimeBootstrap,
  pgRuntimeConnectorExists,
  pgRuntimeConnectorInUseBySkill,
  pgRuntimeGetAgentSkills,
  pgRuntimeGetConnectorConfig,
  pgRuntimeGetConnectorPolicies,
  pgRuntimeGetSkillConnectors,
  pgRuntimeGetSkillTool,
  pgRuntimeGetSkillTools,
  pgRuntimeGetToolPolicy,
  pgRuntimeListSkillConnectorBindings,
  pgRuntimeListSkillToolBindings,
  pgRuntimeSetAgentSkills,
  pgRuntimeVersionedUpsert,
  type RuntimeVersionedTable,
} from "../postgres/runtime-governance-repository.js";
import { PLATFORM_SYNC_AGENT, PLATFORM_SYNC_SKILLS } from "./platform-principal.js";

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

/** Connector configuration only contains references; credential values are resolved at request time. */
export type ConnectorConfig = {
  protocol?: "mcp" | "http";
  transport?: "streamable-http" | "sse";
  url?: string;
  url_env?: string;
  headers_env?: Record<string, string>;
  bearer_env?: string;
  credential_provider?: string;
  credential_account_id?: string;
  allow_unauthenticated?: boolean;
  timeout_ms?: number;
  headers_secret_refs?: Record<string, string>;
  bearer_secret_ref?: string;
  http_tools?: HttpTool[];
};

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

let schemaReady: Promise<void> | null = null;

async function bootstrapWorkspacePlanner(): Promise<void> {
  const definitions = new Map((await taskDefinitions()).map((definition) => [definition.id, definition]));
  for (const skillId of PLATFORM_PLANNER_SKILLS) {
    const definition = definitions.get(skillId);
    if (!definition || definition.runtime_agent_id !== PLATFORM_PLANNER_AGENT || definition.runtime_access !== "authenticated") {
      throw new Error(`invalid workspace planner declaration: ${skillId}`);
    }
  }
  await pgRuntimeBootstrap({
    migration: "runtime.workspace-planner.v1", agentId: PLATFORM_PLANNER_AGENT, skills: PLATFORM_PLANNER_SKILLS,
    publishSkills: PLATFORM_PLANNER_SKILLS, auditType: "runtime.workspace_planner.migrated",
    auditPayload: JSON.stringify({ agent_id: PLATFORM_PLANNER_AGENT, skills: PLATFORM_PLANNER_SKILLS, migration: "runtime.workspace-planner.v1" }),
  });
}

async function bootstrapPlatformSync(): Promise<void> {
  const definitions = new Map((await taskDefinitions()).map((definition) => [definition.id, definition]));
  for (const skillId of PLATFORM_SYNC_SKILLS) {
    const definition = definitions.get(skillId);
    if (!definition || definition.side_effects !== "none") throw new Error(`invalid platform sync skill: ${skillId}`);
  }
  await pgRuntimeBootstrap({
    migration: "runtime.platform-sync.v1", agentId: PLATFORM_SYNC_AGENT, skills: PLATFORM_SYNC_SKILLS,
    auditType: "runtime.platform_sync.migrated",
    auditPayload: JSON.stringify({ agent_id: PLATFORM_SYNC_AGENT, skills: PLATFORM_SYNC_SKILLS, migration: "runtime.platform-sync.v1" }),
  });
}

async function bootstrapAgentManifestBindings(agentId: string): Promise<void> {
  const manifest = runtimeAgentBindingManifest(agentId);
  if (manifest.status !== "production") throw new Error(`runtime agent manifest is not production: ${manifest.id}`);
  const definitions = new Map((await taskDefinitions()).map((definition) => [definition.id, definition]));
  for (const skillId of manifest.skills) {
    const definition = definitions.get(skillId);
    if (!definition || definition.runtime_agent_id !== manifest.id) throw new Error(`invalid agent skill declaration: ${manifest.id} → ${skillId}`);
  }
  const migration = `runtime.agent-manifest-bindings.${manifest.id}.${manifest.version}`;
  await pgRuntimeBootstrap({
    migration, agentId: manifest.id, skills: manifest.skills, publishSkills: manifest.skills,
    auditType: "runtime.agent_manifest.migrated",
    auditPayload: JSON.stringify({ agent_id: manifest.id, agent_version: manifest.version, skills: manifest.skills, connectors: manifest.connectors, migration }),
  });
}

/** Schema ownership belongs to formal PostgreSQL migrations; this function only performs reviewed one-way bootstrap rows. */
export async function ensureRuntimeSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const current = ((async () => {
    await bootstrapWorkspacePlanner();
    await bootstrapAgentManifestBindings("agent:kol");
    await bootstrapPlatformSync();
  })());
  schemaReady = current;
  try { await current; } catch (error) { if (schemaReady === current) schemaReady = null; throw error; }
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

async function assertTaskDefinition(skillId: string): Promise<Awaited<void>> {
  if (!(await taskDefinition(skillId))) throw new HttpFail(404, "skill not found");
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
  if (suppliedUrl && suppliedUrlEnv) invalid("url and url_env cannot be combined");
  // An HTTP connector may exist as an endpoint-less draft while the console collects
  // the base URL; every runtime read then fails closed with runtime_endpoint_invalid.
  if (!suppliedUrl && !suppliedUrlEnv && value.protocol !== "http") invalid("exactly one of url or url_env is required");

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
  } else if (suppliedUrlEnv) {
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


function nowIso(): string { return new Date().toISOString(); }

function runtimeConflict(message = "runtime governance version conflict"): never {
  throw new HttpFail(409, message);
}

function versionConflict(error: unknown, message?: string): never | void {
  if (error instanceof RuntimeVersionConflict) runtimeConflict(message);
}

async function requireConnector(connectorId: string): Promise<void> {
  if (!await pgRuntimeConnectorExists(connectorId)) throw new HttpFail(404, "connector not found");
}

export async function assertRuntimeConnectorExists(connectorId: string): Promise<void> {
  await ensureRuntimeSchema();
  await requireConnector(connectorId);
}

async function assertAgentAssemblyMutable(client: { query: Function }, agentId: string): Promise<void> {
  const row = (await client.query("SELECT workspace_managed FROM managed_agents WHERE id=$1 FOR UPDATE", [agentId])).rows[0] as Row | undefined;
  if (row?.workspace_managed) throw new HttpFail(409, "此 Agent 的装配需保存修订草稿并确认发布");
}

async function versionedUpsert(
  table: RuntimeVersionedTable,
  keyValues: readonly unknown[],
  createColumns: readonly string[],
  createValues: readonly unknown[],
  updateColumns: readonly string[],
  expectedVersion: number,
  check?: (client: { query: Function }) => Promise<void>,
): Promise<Row> {
  const expected = assertExpectedVersion(expectedVersion);
  try {
    return await pgRuntimeVersionedUpsert({ table, keys: keyValues, createColumns, createValues, updateColumns, expectedVersion: expected,
      check: check as never });
  } catch (error) { versionConflict(error); throw error; }
}

export async function getAgentSkills(agentId: string): Promise<Row[]> {
  const id = assertIdentifier(agentId, "agent_id");
  await ensureRuntimeSchema();
  return pgRuntimeGetAgentSkills(id);
}

export async function getSkillConnectors(skillId: string): Promise<Row[]> {
  const id = assertIdentifier(skillId, "skill_id");
  (await assertTaskDefinition(id));
  await ensureRuntimeSchema();
  return pgRuntimeGetSkillConnectors(id);
}

export async function getSkillTools(skillId: string, connectorId?: string): Promise<Row[]> {
  const skill = assertIdentifier(skillId, "skill_id");
  (await assertTaskDefinition(skill));
  const connector = connectorId === undefined ? undefined : assertIdentifier(connectorId, "connector_id");
  await ensureRuntimeSchema();
  return pgRuntimeGetSkillTools(skill, connector);
}

export async function getSkillTool(skillId: string, connectorId: string, toolName: string): Promise<Row | undefined> {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  const tool = assertIdentifier(toolName, "tool_name", MAX_TOOL_NAME_LENGTH);
  (await assertTaskDefinition(skill));
  await ensureRuntimeSchema();
  return pgRuntimeGetSkillTool(skill, connector, tool);
}

export async function listSkillConnectorBindings(): Promise<Row[]> {
  await ensureRuntimeSchema();
  return pgRuntimeListSkillConnectorBindings();
}

export async function listSkillToolBindings(): Promise<Row[]> {
  await ensureRuntimeSchema();
  return pgRuntimeListSkillToolBindings();
}

export async function connectorInUseBySkill(connectorId: string): Promise<boolean> {
  const connector = assertIdentifier(connectorId, "connector_id");
  await ensureRuntimeSchema();
  return pgRuntimeConnectorInUseBySkill(connector);
}

export async function getConnectorConfig(id: string): Promise<{ config: ConnectorConfig; version: number } | undefined> {
  const connectorId = assertIdentifier(id, "connector_id");
  await assertRuntimeConnectorExists(connectorId);
  const row = await pgRuntimeGetConnectorConfig(connectorId);
  if (!row) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(String(row.config_json)); } catch { throw new HttpFail(500, "stored runtime connector config is invalid"); }
  const config = validateConnectorConfig(decoded);
  assertConnectorCredentialStorage(connectorId, config);
  return { config, version: Number(row.version) };
}

export async function getToolPolicy(id: string, name: string): Promise<Row | undefined> {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  await assertRuntimeConnectorExists(connectorId);
  return pgRuntimeGetToolPolicy(connectorId, toolName);
}

export async function getConnectorPolicies(id: string): Promise<Row[]> {
  const connectorId = assertIdentifier(id, "connector_id");
  await assertRuntimeConnectorExists(connectorId);
  return pgRuntimeGetConnectorPolicies(connectorId);
}

export async function setAgentSkill(agentId: string, skillId: string, enabled: boolean, expectedVersion: number): Promise<Row> {
  const agent = assertIdentifier(agentId, "agent_id");
  const skill = assertIdentifier(skillId, "skill_id");
  (await assertTaskDefinition(skill));
  const active = assertBoolean(enabled, "enabled");
  await ensureRuntimeSchema();
  return (versionedUpsert("runtime_agent_skills", [agent, skill], ["agent_id", "skill_id", "enabled", "version", "updated_at"],
    [agent, skill, active ? 1 : 0, 1, nowIso()], ["enabled"], expectedVersion,
    async (client) => (await assertAgentAssemblyMutable(client, agent))));
}

export async function setAgentSkills(agentId: string, selections: Array<{ skill_id: string; enabled: boolean; expected_version: number }>): Promise<Row[]> {
  const agent = assertIdentifier(agentId, "agent_id");
  const normalized = (await Promise.all(selections.map(async (selection) => {
    const skill = assertIdentifier(selection.skill_id, "skill_id");
    (await assertTaskDefinition(skill));
    if (typeof selection.enabled !== "boolean" || !Number.isInteger(selection.expected_version) || selection.expected_version < 0) {
      throw new HttpFail(400, "每项技能都必须包含 enabled 和有效的 expected_version");
    }
    return { skill, enabled: selection.enabled ? 1 : 0, expectedVersion: selection.expected_version };
  })));
  if (new Set(normalized.map((item) => item.skill)).size !== normalized.length) throw new HttpFail(400, "技能列表不能包含重复项");
  await ensureRuntimeSchema();
  try { return await pgRuntimeSetAgentSkills({ agentId: agent, selections: normalized, now: nowIso() }); }
  catch (error) {
    if (error instanceof RuntimeVersionConflict) runtimeConflict("技能配置版本已变化，请刷新后重试");
    if (error instanceof Error && error.message === "runtime_agent_workspace_managed") throw new HttpFail(409, "此 Agent 的装配需保存修订草稿并确认发布");
    throw error;
  }
}

export async function setSkillConnector(skillId: string, connectorId: string, enabled: boolean, expectedVersion: number): Promise<Row> {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  (await assertTaskDefinition(skill));
  const active = assertBoolean(enabled, "enabled");
  await ensureRuntimeSchema();
  return (versionedUpsert("runtime_skill_connectors", [skill, connector], ["skill_id", "connector_id", "enabled", "version", "updated_at"],
    [skill, connector, active ? 1 : 0, 1, nowIso()], ["enabled"], expectedVersion,
    async (client) => { if (!(await client.query("SELECT 1 FROM connectors WHERE id=$1", [connector])).rows[0]) throw new HttpFail(404, "connector not found"); }));
}

/** A tool mount needs both an enabled parent binding and an existing policy, checked in the same transaction. */
export async function setSkillTool(skillId: string, connectorId: string, toolName: string, enabled: boolean, expectedVersion: number): Promise<Row> {
  const skill = assertIdentifier(skillId, "skill_id");
  const connector = assertIdentifier(connectorId, "connector_id");
  const tool = assertIdentifier(toolName, "tool_name", MAX_TOOL_NAME_LENGTH);
  (await assertTaskDefinition(skill));
  const active = assertBoolean(enabled, "enabled");
  await ensureRuntimeSchema();
  return (versionedUpsert("runtime_skill_tools", [skill, connector, tool], ["skill_id", "connector_id", "tool_name", "enabled", "version", "updated_at"],
    [skill, connector, tool, active ? 1 : 0, 1, nowIso()], ["enabled"], expectedVersion,
    async (client) => {
      if (!(await client.query("SELECT 1 FROM connectors WHERE id=$1", [connector])).rows[0]) throw new HttpFail(404, "connector not found");
      const parent = (await client.query("SELECT enabled FROM runtime_skill_connectors WHERE skill_id=$1 AND connector_id=$2 FOR SHARE", [skill, connector])).rows[0] as Row | undefined;
      if (!parent || Number(parent.enabled) !== 1) throw new HttpFail(409, "enabled skill connector binding is required before binding a tool");
      const policy = (await client.query("SELECT 1 FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2 FOR SHARE", [connector, tool])).rows[0];
      if (!policy) throw new HttpFail(409, "tool policy is required before binding a tool");
    }));
}

export async function setConnectorConfig(id: string, config: ConnectorConfig, expectedVersion: number): Promise<Row> {
  const connectorId = assertIdentifier(id, "connector_id");
  const validated = validateConnectorConfig(config);
  assertConnectorCredentialStorage(connectorId, validated);
  await ensureRuntimeSchema();
  return (versionedUpsert("runtime_connector_config", [connectorId], ["connector_id", "config_json", "version", "updated_at"],
    [connectorId, JSON.stringify(validated), 1, nowIso()], ["config_json"], expectedVersion,
    async (client) => { if (!(await client.query("SELECT 1 FROM connectors WHERE id=$1", [connectorId])).rows[0]) throw new HttpFail(404, "connector not found"); }));
}

export async function setToolPolicy(
  id: string,
  name: string,
  value: { enabled: boolean; risk: "L1" | "L2" | "L3"; access: "read" | "write"; schema_hash: string },
  expectedVersion: number,
): Promise<Row> {
  const connectorId = assertIdentifier(id, "connector_id");
  const toolName = assertIdentifier(name, "tool_name", MAX_TOOL_NAME_LENGTH);
  if (!isPlainObject(value)) invalid("tool policy must be an object");
  assertKnownKeys(value, ["enabled", "risk", "access", "schema_hash"], "tool policy");
  const enabled = assertBoolean(value.enabled, "enabled");
  if (value.risk !== "L1" && value.risk !== "L2" && value.risk !== "L3") invalid("risk must be L1, L2, or L3");
  if (value.access !== "read" && value.access !== "write") invalid("access must be read or write");
  if (typeof value.schema_hash !== "string" || !SCHEMA_HASH.test(value.schema_hash)) invalid("schema_hash must be exactly 64 hexadecimal characters");
  const schemaHash = value.schema_hash.toLowerCase();
  await ensureRuntimeSchema();
  return (versionedUpsert("runtime_tool_policies", [connectorId, toolName], ["connector_id", "tool_name", "enabled", "risk", "access", "schema_hash", "version", "updated_at"],
    [connectorId, toolName, enabled ? 1 : 0, value.risk, value.access, schemaHash, 1, nowIso()], ["enabled", "risk", "access", "schema_hash"], expectedVersion,
    async (client) => { if (!(await client.query("SELECT 1 FROM connectors WHERE id=$1", [connectorId])).rows[0]) throw new HttpFail(404, "connector not found"); }));
}
