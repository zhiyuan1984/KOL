import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { audit, getConn } from "../db.js";
import { runtimeHostOnlyTool } from "../gateway/runtime-policy.js";
import { HttpFail } from "../host/errors.js";
import { RemoteMcpClient, type RemoteMcpOptions } from "../mcp/remote.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import type { Json, Row } from "../types.js";
import { ensureRuntimeSchema, getAgentSkills, getSkillConnectors, getConnectorConfig, getToolPolicy, type ConnectorConfig } from "./store.js";

export type RuntimeContext = { agentId: string; skillId: string; userId: string; runId: string; sessionId?: string };
export type RuntimeRemote = Pick<RemoteMcpClient, "listTools" | "callToolRaw" | "close">;
export type CredentialProvider = (context: RuntimeContext) => Record<string, string>;
const credentialProviders = new Map<string, CredentialProvider>();
export function registerRuntimeCredentialProvider(name: string, provider: CredentialProvider): void {
  credentialProviders.set(name, provider);
}

function reject(code: string, status = 403): never { throw new HttpFail(status, { code }); }
export function runtimeErrorCode(error: unknown): string {
  if (error instanceof HttpFail && error.detail && typeof error.detail === "object") {
    const code = (error.detail as Json).code;
    if (typeof code === "string") return code;
  }
  // Remote errors may contain credentials, private URLs or payloads. Never echo them.
  return "runtime_remote_failed";
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function runtimeHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
/** Pin descriptions and annotations too: a remote change in intent requires review. */
export function toolSchemaHash(tool: Json): string {
  return runtimeHash(tool);
}
function summary(value: unknown): Json {
  const encoded = JSON.stringify(value) ?? "null";
  return { sha256: runtimeHash(value), bytes: Buffer.byteLength(encoded),
    kind: Array.isArray(value) ? "array" : value === null ? "null" : typeof value };
}
function parseRoles(value: unknown): string[] {
  try { const roles = JSON.parse(String(value)); return Array.isArray(roles) ? roles : []; } catch { return []; }
}
function assertNoCredentialEcho(value: unknown, headers: Record<string, string> = {}): void {
  const serialized = JSON.stringify(value);
  const secrets = Object.values(headers).flatMap((header) => [header, header.replace(/^Bearer\s+/i, "")]);
  if (secrets.some((secret) => secret && serialized.includes(JSON.stringify(secret).slice(1, -1)))) {
    reject("runtime_credential_in_result", 502);
  }
}
export function assertRuntimeSkill(context: RuntimeContext): { user: Row; binding: Row; skillVersion: string } {
  ensureRuntimeSchema();
  const user = getConn().prepare("SELECT id,active,roles FROM users WHERE id=?").get(context.userId) as Row | undefined;
  if (!user?.active) reject("runtime_identity_unavailable", 401);
  const binding = getAgentSkills(context.agentId).find((row) => row.skill_id === context.skillId);
  if (!binding?.enabled) reject("runtime_skill_unbound");
  const definition = requireTaskDefinition(context.skillId);
  const lifecycle = getConn().prepare("SELECT stage FROM skill_lifecycle WHERE skill_id=?").get(context.skillId) as Row | undefined;
  if (lifecycle && lifecycle.stage !== "published") reject("runtime_skill_not_published");
  if (!lifecycle && definition.source === "published") reject("runtime_skill_not_published");
  if (!parseRoles(user.roles).includes("admin") && !getConn().prepare(
    "SELECT 1 FROM user_skill_grants WHERE user_id=? AND skill_id=?",
  ).get(context.userId, context.skillId)) reject("runtime_skill_not_granted");
  const sop = getConn().prepare("SELECT summary,body,updated_at FROM skill_sops WHERE id=?").get(context.skillId);
  return { user, binding, skillVersion: runtimeHash({ definition, body: fs.readFileSync(definition.path, "utf8"), sop }) };
}
export function authorizeConnector(context: RuntimeContext, connectorId: string, access: "read" | "write" = "read") {
  const skill = assertRuntimeSkill(context);
  const binding = getSkillConnectors(context.skillId).find((row) => row.connector_id === connectorId);
  if (!binding?.enabled) reject("runtime_connector_unbound");
  const connector = getConn().prepare("SELECT id,enabled,updated_at FROM connectors WHERE id=?").get(connectorId) as Row | undefined;
  if (!connector?.enabled) reject("runtime_connector_disabled");
  // Admin can manage assets, but never skips binding / enabled / risk checks.
  if (!parseRoles(skill.user.roles).includes("admin")) {
    const grant = getConn().prepare("SELECT access FROM user_connector_grants WHERE user_id=? AND connector_id=?")
      .get(context.userId, connectorId) as Row | undefined;
    const levels: Record<string, number> = { read: 1, write: 2, admin: 3 };
    if (!grant || (levels[String(grant.access)] || 0) < levels[access]) reject("runtime_connector_not_granted");
  }
  const configuration = getConnectorConfig(connectorId);
  if (!configuration) reject("runtime_connector_not_configured", 409);
  return { ...skill, resourceBinding: binding, connector, configuration };
}
function authorizationStamp(auth: ReturnType<typeof authorizeConnector>, policy?: Row): string {
  return runtimeHash({ agent_binding: auth.binding.version, resource_binding: auth.resourceBinding.version,
    config: auth.configuration.version, connector: auth.connector, skill: auth.skillVersion, policy });
}
function envValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) reject("runtime_credential_unavailable", 503);
  return value;
}
export function connectorOptions(context: RuntimeContext, config: ConnectorConfig): RemoteMcpOptions {
  const url = config.url || (config.url_env ? envValue(config.url_env) : "");
  let parsed: URL;
  try { parsed = new URL(url); } catch { return reject("runtime_endpoint_invalid", 409); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    reject("runtime_endpoint_invalid", 409);
  }
  const headers: Record<string, string> = {};
  for (const [header, env] of Object.entries(config.headers_env || {})) headers[header] = envValue(env);
  if (config.bearer_env) headers.Authorization = `Bearer ${envValue(config.bearer_env)}`;
  if (config.credential_provider) {
    const provider = credentialProviders.get(config.credential_provider);
    if (!provider) reject("runtime_credential_provider_unavailable", 503);
    Object.assign(headers, provider(context));
  }
  return { url, token: "", headers, allowUnauthenticated: config.allow_unauthenticated === true,
    timeoutMs: config.timeout_ms ?? 30_000,
    // A redirect must never forward credentials to another endpoint.
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }) };
}
function validTool(tool: Json): boolean {
  if (typeof tool.name !== "string" || !tool.name || tool.name.length > 256) return false;
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || (schema as Json).type !== "object") return false;
  // Bound schema compilation cost and disallow external refs (never fetch a schema URL).
  if (Buffer.byteLength(JSON.stringify(tool)) > 128_000) return false;
  const walk = (value: unknown, depth: number): boolean => {
    if (depth > 32) return false;
    if (!value || typeof value !== "object") return true;
    if (typeof (value as Json).$ref === "string" && !String((value as Json).$ref).startsWith("#")) return false;
    return Object.values(value).every((child) => walk(child, depth + 1));
  };
  return walk(schema, 0);
}
function isPolicyAllowed(policy: Row | undefined, tool: Json): boolean {
  return Boolean(!runtimeHostOnlyTool(String(tool.name)) && policy?.enabled && ["L1", "L2"].includes(String(policy.risk))
    && ["read", "write"].includes(String(policy.access)) && policy.schema_hash === toolSchemaHash(tool));
}

export type DiscoveredTool = { connectorId: string; remoteName: string; exposed: Json; schemaHash: string; stamp: string };
export type RuntimeCatalog = { tools: DiscoveredTool[]; unavailable: Array<{ connector_id: string; code: string }> };

/** A run-scoped capability set; no model calls and no provider-specific business routing. */
export class SkillExecution {
  private handles = new Map<string, DiscoveredTool>();
  private clients = new Set<RuntimeRemote>();
  private closed = false;
  constructor(readonly context: RuntimeContext,
    private readonly clientFactory: (options: RemoteMcpOptions) => RuntimeRemote = (options) => new RemoteMcpClient(options)) {}

  close(): void {
    this.closed = true;
    this.handles.clear();
    for (const client of this.clients) void client.close().catch(() => undefined);
    this.clients.clear();
  }
  private client(options: RemoteMcpOptions): RuntimeRemote {
    this.active();
    const client = this.clientFactory(options);
    this.clients.add(client);
    return client;
  }
  private active(): void { if (this.closed) reject("runtime_run_closed", 410); }
  async discover(): Promise<RuntimeCatalog> {
    this.active();
    assertRuntimeSkill(this.context);
    const tools: DiscoveredTool[] = [];
    const unavailable: RuntimeCatalog["unavailable"] = [];
    for (const binding of getSkillConnectors(this.context.skillId)) {
      const connectorId = String(binding.connector_id);
      if (!binding.enabled) { unavailable.push({ connector_id: connectorId, code: "runtime_connector_unbound" }); continue; }
      let client: RuntimeRemote | undefined;
      try {
        const before = authorizeConnector(this.context, connectorId);
        const beforeStamp = authorizationStamp(before);
        const options = connectorOptions(this.context, before.configuration.config);
        client = this.client(options);
        const remoteTools = await client.listTools();
        assertNoCredentialEcho(remoteTools, options.headers);
        this.active();
        const after = authorizeConnector(this.context, connectorId);
        if (beforeStamp !== authorizationStamp(after)) reject("runtime_binding_changed", 409);
        const seen = new Set<string>();
        for (const remote of remoteTools) {
          if (!validTool(remote) || seen.has(String(remote.name))) reject("runtime_tool_catalog_invalid", 502);
          seen.add(String(remote.name));
        }
        let authorized = 0;
        for (const remote of remoteTools) {
          const name = String(remote.name);
          const policy = getToolPolicy(connectorId, name);
          if (!isPolicyAllowed(policy, remote)) continue;
          let current: ReturnType<typeof authorizeConnector>;
          try { current = authorizeConnector(this.context, connectorId, policy!.access as "read" | "write"); }
          catch { continue; }
          const alias = `rt_${runtimeHash([connectorId, name]).slice(0, 40)}`;
          const exposed: Json = { ...remote, name: alias };
          tools.push({ connectorId, remoteName: name, exposed, schemaHash: toolSchemaHash(remote), stamp: authorizationStamp(current, policy) });
          authorized += 1;
        }
        if (!authorized) unavailable.push({ connector_id: connectorId, code: "runtime_no_authorized_tools" });
      } catch (error) {
        unavailable.push({ connector_id: connectorId, code: runtimeErrorCode(error) });
      } finally { if (client) this.clients.delete(client); await client?.close().catch(() => undefined); }
    }
    this.active();
    assertRuntimeSkill(this.context);
    this.handles = new Map(tools.map((tool) => [String(tool.exposed.name), tool]));
    audit(this.context.userId, "runtime.tools.discovered", { ...this.trace(), tool_count: tools.length, unavailable });
    return { tools, unavailable };
  }

  async invoke(alias: string, args: Json): Promise<Json> {
    const callId = `call_${randomUUID()}`;
    const handle = this.handles.get(alias);
    const trace: Json = { ...this.trace(), call_id: callId, connector_id: handle?.connectorId ?? null,
      tool: handle?.remoteName ?? null, schema_hash: handle?.schemaHash ?? null, input: summary(args) };
    let client: RuntimeRemote | undefined;
    let dispatched = false;
    const started = Date.now();
    try {
      this.active();
      if (!handle) reject("runtime_tool_not_discovered");
      const check = () => {
        this.active();
        const policy = getToolPolicy(handle.connectorId, handle.remoteName);
        if (!policy?.enabled) reject("runtime_tool_not_granted");
        if (runtimeHostOnlyTool(handle.remoteName) || !["L1", "L2"].includes(String(policy.risk))) reject("runtime_gateway_required");
        const current = authorizeConnector(this.context, handle.connectorId, policy.access as "read" | "write");
        if (handle.schemaHash !== policy.schema_hash || handle.stamp !== authorizationStamp(current, policy)) {
          reject("runtime_binding_changed", 409);
        }
        return { ...current, policy };
      };
      let authorized = check();
      const options = connectorOptions(this.context, authorized.configuration.config);
      const credentialStamp = runtimeHash({ url: options.url, headers: options.headers });
      const guardedCheck = () => {
        const current = check();
        const currentOptions = connectorOptions(this.context, current.configuration.config);
        if (credentialStamp !== runtimeHash({ url: currentOptions.url, headers: currentOptions.headers })) {
          reject("runtime_credentials_changed", 409);
        }
        return current;
      };
      const transportFetch = options.fetch!;
      client = this.client({ ...options, fetch: (input, init) => {
        // Guard the actual network submission, including SDK initialize/reconnect awaits.
        guardedCheck();
        return transportFetch(input, init);
      } });
      // Re-discover before submission: remote schema/removal changes cannot reuse old grants.
      const currentTools = await client.listTools();
      const matching = currentTools.filter((tool) => tool.name === handle.remoteName);
      if (matching.length !== 1 || !validTool(matching[0]) || toolSchemaHash(matching[0]) !== handle.schemaHash) {
        reject("runtime_tool_schema_changed", 409);
      }
      const remote = matching[0];
      let valid = false;
      try { valid = new AjvJsonSchemaValidator().getValidator(remote.inputSchema as object)(args).valid; }
      catch { reject("runtime_tool_schema_invalid", 422); }
      if (!valid) reject("runtime_tool_arguments_invalid", 422);
      if (Buffer.byteLength(JSON.stringify(args)) > 1_000_000) reject("runtime_tool_arguments_too_large", 413);
      authorized = guardedCheck();
      Object.assign(trace, { agent_binding_version: authorized.binding.version,
        resource_binding_version: authorized.resourceBinding.version, connector_version: authorized.configuration.version,
        policy_version: authorized.policy.version, skill_version: authorized.skillVersion });
      audit(this.context.userId, "runtime.tool.started", trace);
      // No await between final authorization and submission.
      const pending = client.callToolRaw(handle.remoteName, args);
      dispatched = true;
      const result = await pending;
      audit(this.context.userId, "runtime.tool.received", { ...trace, output: summary(result), is_error: result.isError === true });
      guardedCheck(); // Suppress data received after revocation; do not claim the remote action was rolled back.
      assertNoCredentialEcho(result, options.headers);
      audit(this.context.userId, "runtime.tool.completed", { ...trace, output: summary(result), is_error: result.isError === true,
        duration_ms: Date.now() - started });
      return result;
    } catch (error) {
      const code = runtimeErrorCode(error);
      audit(this.context.userId, "runtime.tool.denied_or_failed", { ...trace, code, dispatched, duration_ms: Date.now() - started });
      throw new HttpFail(error instanceof HttpFail ? error.status : 502, { code });
    } finally { if (client) this.clients.delete(client); await client?.close().catch(() => undefined); }
  }
  private trace(): Json {
    return { run_id: this.context.runId, agent_id: this.context.agentId, skill_id: this.context.skillId,
      session_id: this.context.sessionId ?? null };
  }
}

/** Governance discovery only. It does not imply a grant or expose a tool to a worker. */
export async function inspectConnectorTools(context: RuntimeContext, connectorId: string): Promise<Json[]> {
  const configuration = getConnectorConfig(connectorId);
  const connector = getConn().prepare("SELECT enabled FROM connectors WHERE id=?").get(connectorId) as Row | undefined;
  if (!connector?.enabled) reject("runtime_connector_disabled");
  if (!configuration) reject("runtime_connector_not_configured", 409);
  const options = connectorOptions(context, configuration.config);
  const client = new RemoteMcpClient(options);
  try {
    const tools = await client.listTools();
    assertNoCredentialEcho(tools, options.headers);
    return tools.map((tool) => {
      if (!validTool(tool)) reject("runtime_tool_catalog_invalid", 502);
      return { ...tool, schema_hash: toolSchemaHash(tool) };
    });
  } catch (error) { throw new HttpFail(502, { code: runtimeErrorCode(error) }); }
  finally { await client.close().catch(() => undefined); }
}
