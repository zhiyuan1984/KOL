export type RuntimeProtocol = "mcp" | "http";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RuntimeHttpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: HttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
  output_path?: string;
};

/** MCP transport selection. Omitted means streamable-http (backward compatible). */
export type RuntimeConnectorTransport = "streamable-http" | "sse";

/**
 * Reference-only connector configuration. Secret values are intentionally not
 * represented here: headers/bearers point only at server-side references.
 */
export type RuntimeConnectorConfig = {
  protocol?: RuntimeProtocol;
  /** Only meaningful for MCP; HTTP connectors keep the single JSON driver. */
  transport?: RuntimeConnectorTransport;
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
  http_tools?: RuntimeHttpTool[];
};

export type RuntimeConnectorScopeMode = "unset" | "all" | "selected";
export type RuntimeConnectorScopeBinding = { node_id: string; access: "read" | "write" };
export type RuntimeConnectorScopeSnapshot = {
  connector_id: string;
  mode: RuntimeConnectorScopeMode;
  updated_by: string | null;
  updated_at: string | null;
  bindings: RuntimeConnectorScopeBinding[];
  coverage: { users: number; read: number; write: number };
};

export type McpImportServerPreview = {
  id: string;
  label: string;
  url: string;
  transport: RuntimeConnectorTransport;
  header_count: number;
  secret_count: number;
  conflicts: string[];
  valid: boolean;
  reason?: string;
};
export type McpImportPreview = {
  dry_run: true;
  servers: McpImportServerPreview[];
  valid_count: number;
  invalid_count: number;
};
export type McpImportResult = {
  dry_run: false;
  created: Array<{ id: string; label: string }>;
  skipped: Array<{ name: string; reason: string }>;
};

export type OrganizationUnit = {
  id: string;
  display_name: string;
  type: string;
  parent: string | null;
  level: number;
  head?: string | null;
};
export type OrganizationUnitsResponse = {
  company: { id: string; display_name: string } | null;
  units: OrganizationUnit[];
  people: Array<{ display_name: string; role: string; org_unit: string; user_ref: string | null }>;
};

export type RuntimeToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  schema_hash: string;
};

export type RuntimeToolPolicy = {
  connector_id: string;
  tool_name: string;
  enabled: boolean;
  risk: "L1" | "L2" | "L3";
  access: "read" | "write";
  schema_hash: string;
  version: number;
  updated_at?: string;
};

export type RuntimeSkillConnector = {
  skill_id: string;
  connector_id: string;
  enabled: boolean;
  version: number;
  updated_at?: string;
};

export type RuntimeSkillTool = {
  skill_id: string;
  connector_id: string;
  tool_name: string;
  enabled: boolean;
  version: number;
  updated_at?: string;
};

export type RuntimeCredentialMetadata = {
  id: string;
  type: "organization_secret" | "user_account";
  owner_user_id: string | null;
  label: string;
  purpose: string;
  status: "active" | "disabled";
  key_version: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type OpenApiPreview = { tools: RuntimeHttpTool[]; warnings: string[] };

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${field} 必须是“目标字段: 输入字段”的 JSON 对象`);
  const mapped: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || typeof item !== "string" || !item.trim()) {
      throw new Error(`${field} 的键和值都必须是非空字符串`);
    }
    mapped[key] = item;
  }
  return mapped;
}

/** Parse editor JSON locally before the server performs the authoritative validation. */
export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
  if (!isPlainObject(value)) throw new Error(`${label} 的根节点必须是 JSON 对象`);
  return value;
}

/**
 * Validates the explicitly supported, non-executable HTTP tool shape. This is
 * intentionally a usability guard only; the server remains authoritative.
 */
export function parseHttpTools(text: string): RuntimeHttpTool[] {
  let value: unknown;
  try {
    value = JSON.parse(text || "[]");
  } catch {
    throw new Error("HTTP 工具编辑器不是有效 JSON");
  }
  if (!Array.isArray(value)) throw new Error("HTTP 工具编辑器的根节点必须是数组");

  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`第 ${index + 1} 个 HTTP 工具必须是对象`);
    const name = entry.name;
    const description = entry.description;
    const inputSchema = entry.inputSchema;
    const method = entry.method;
    const path = entry.path;
    if (typeof name !== "string" || !name.trim()) throw new Error(`第 ${index + 1} 个工具缺少 name`);
    if (names.has(name)) throw new Error(`工具 name 不能重复：${name}`);
    names.add(name);
    if (typeof description !== "string") throw new Error(`工具 ${name} 缺少 description`);
    if (!isPlainObject(inputSchema)) throw new Error(`工具 ${name} 的 inputSchema 必须是 JSON 对象`);
    if (typeof method !== "string" || !METHODS.has(method as HttpMethod)) {
      throw new Error(`工具 ${name} 的 method 必须是 GET、POST、PUT、PATCH 或 DELETE`);
    }
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("://") || /[?#]/.test(path)) {
      throw new Error(`工具 ${name} 的 path 必须是无查询串、无 origin 的相对绝对路径`);
    }
    const body = stringMap(entry.body, `工具 ${name} 的 body`);
    if (method === "GET" && body && Object.keys(body).length) throw new Error(`工具 ${name} 是 GET，不能配置 body`);
    const query = stringMap(entry.query, `工具 ${name} 的 query`);
    if (entry.output_path !== undefined && typeof entry.output_path !== "string") {
      throw new Error(`工具 ${name} 的 output_path 必须是字符串`);
    }
    return {
      name: name.trim(),
      description,
      inputSchema,
      method: method as HttpMethod,
      path,
      ...(query && Object.keys(query).length ? { query } : {}),
      ...(body && Object.keys(body).length ? { body } : {}),
      ...(typeof entry.output_path === "string" && entry.output_path.trim() ? { output_path: entry.output_path.trim() } : {}),
    };
  });
}

export function parseReferenceMap(text: string, label: string): Record<string, string> | undefined {
  if (!text.trim()) return undefined;
  const value = parseJsonObject(text, label);
  return stringMap(value, label);
}

export function versionConflictMessage(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 409) return "此记录已被其他管理员更新。请刷新后审阅差异，再决定是否重试。";
  return null;
}

export function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message ? error.message.trim() : "";
  if (!message) return fallback;
  if (/the user aborted a request|aborterror|request aborted/i.test(message)) {
    return "请求已取消或网络连接中断。请确认服务可访问后重试。";
  }
  if (/failed to fetch|networkerror|econnrefused|timed out/i.test(message)) {
    return "无法连接到已保存的服务。请检查端点与网络后重试。";
  }
  return message;
}

export function policyKey(connectorId: string, toolName: string): string {
  return `${connectorId}\u0000${toolName}`;
}
