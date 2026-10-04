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

/**
 * Transport-classified remote failures (backend `runtimeErrorCode`). The upstream
 * body is never returned, so the message names the layer to fix: credential,
 * endpoint, rate limit, their outage, timeout or the local network.
 */
export function remoteFailureMessage(code: string): string {
  if (code === "runtime_probe_crawl_busy") return "已有采集任务在运行；请等任务结束后再做真实采集测试。";
  if (code === "runtime_probe_start_rejected") return "远端拒绝 start_crawl；请核对服务状态和采集参数，未登记工具清单。";
  if (code === "runtime_probe_task_id_missing") return "start_crawl 未返回任务 ID，无法自动停止；请检查远端是否残留采集任务。";
  if (code === "runtime_probe_stop_failed") return "采集已启动，但 stop_crawl 失败；请在远端检查并停止该任务，连接未通过验证。";
  if (code === "runtime_remote_unauthorized") return "远端拒绝授权（401）：请更新连接器凭据（API key / Bearer）后重新测试。";
  if (code === "runtime_remote_forbidden") return "远端禁止访问（403）：该凭据无权访问此端点。";
  if (code === "runtime_remote_not_found") return "远端未找到该端点（404）：请核对 URL 路径与传输类型。";
  if (code === "runtime_remote_rate_limited") return "远端限流（429）：请稍后重试。";
  if (code === "runtime_remote_rejected") return "远端拒绝该请求（4xx）：多为端点协议/传输类型不匹配，请核对。";
  if (code === "runtime_remote_unavailable") return "远端服务不可用（5xx）：对方网关/服务故障，稍后重试；与本方配置无关。";
  if (code === "runtime_remote_timeout") return "远端超时：请稍后重试，或调大超时毫秒数。";
  if (code === "runtime_remote_unreachable") return "MCP 请求未收到可用响应：可能是 DNS、TLS、连接被关闭或代理中断；此错误码不能单独证明 DNS 失败。";
  return "";
}

/**
 * Server answers for the credential vault. A missing or unusable
 * RUNTIME_CREDENTIAL_MASTER_KEY is a server configuration problem, so the
 * reason and the recovery must reach the administrator instead of a bare 503.
 */
const CREDENTIAL_VAULT_CODES = new Set([
  "runtime_credential_master_key_unavailable",
  "runtime_credential_master_key_invalid",
  "runtime_credential_decryption_failed",
  "runtime_credential_unavailable",
  "runtime_credential_provider_unavailable",
]);

const CREDENTIAL_VAULT_MESSAGE = "服务端未配置或无法使用凭据保险库主密钥（RUNTIME_CREDENTIAL_MASTER_KEY），"
  + "明文密钥无法写入安全存储，本次操作被拒绝（HTTP 503）。请在服务器补上主密钥（openssl rand -hex 32 写入 .env）并重启服务后重试；"
  + "若该端点确实公开，也可以勾选「该端点明确允许无鉴权」先保存草稿。";

/** First error code carried by the API payload (`{detail:{code}}` or a stringified JSON body). */
function errorPayloadCode(error: unknown): string {
  const payload = (error as { payload?: unknown } | null)?.payload;
  const queue: unknown[] = [payload, (payload as { detail?: unknown } | null)?.detail];
  while (queue.length) {
    const candidate = queue.shift();
    if (typeof candidate === "string") {
      try {
        const parsed: unknown = JSON.parse(candidate);
        queue.push(parsed, (parsed as { detail?: unknown } | null)?.detail);
      } catch {
        // A plain message, not an error code carrier.
      }
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { code?: unknown; error_code?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    if (typeof record.error_code === "string" && record.error_code) return record.error_code;
  }
  return "";
}

/** The plain-language reason when the vault itself is unavailable; null for every other failure. */
export function credentialVaultMessage(error: unknown): string | null {
  if ((error as { status?: unknown } | null)?.status !== 503) return null;
  const code = errorPayloadCode(error);
  return code && CREDENTIAL_VAULT_CODES.has(code) ? CREDENTIAL_VAULT_MESSAGE : null;
}

export function errorMessage(error: unknown, fallback: string): string {
  const vault = credentialVaultMessage(error);
  if (vault) return vault;
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

/* ── 技能实现与工具依赖扫描（服务端读模型，只读） ───────────────────────── */

export type SkillCoverageToolState = "mounted" | "available" | "blocked_by_policy" | "unregistered" | "unknown_connector";

export type SkillCoverageTool = {
  connector_id: string;
  connector_label?: string;
  tool_name: string;
  declared_as: string;
  state: SkillCoverageToolState;
  policy_risk?: "L1" | "L2" | "L3";
  policy_enabled?: boolean;
  connector_enabled?: boolean;
  connector_status?: string;
};

export type SkillCoverageRow = {
  skill_id: string;
  label: string;
  stage: string | null;
  published_version: number | null;
  agents: string[];
  agent_bound: boolean;
  implementation: "live" | "defined";
  declared_tools: number;
  mounted_tools: number;
  pending_tools: number;
  tools: SkillCoverageTool[];
};

export type SkillCoverageConnector = {
  id: string;
  label: string;
  enabled: boolean;
  status: string;
  approved_tool_count: number;
};

export type SkillCoverage = {
  summary: { skills: number; live: number; defined: number; declared_tools: number; mounted_tools: number; pending_tools: number };
  connectors: SkillCoverageConnector[];
  skills: SkillCoverageRow[];
};

export type DeclaredMountResult = {
  connector_id: string;
  summary: { skills: number; mounted_tools: number; unchanged_tools: number; skipped_tools: number };
  skills: Array<{
    skill_id: string;
    connector_bound: boolean;
    connector_created: boolean;
    mounted: string[];
    unchanged: string[];
    skipped: Array<{ tool_name: string; reason: string }>;
  }>;
};

const TOOL_STATE_LABEL: Record<SkillCoverageToolState, string> = {
  mounted: "已挂载",
  available: "可挂载",
  blocked_by_policy: "策略未启用",
  unregistered: "连接器未登记该工具",
  unknown_connector: "无对应连接器",
};

export function coverageToolStateLabel(state: SkillCoverageToolState): string {
  return TOOL_STATE_LABEL[state] || state;
}

const MOUNT_SKIP_REASON: Record<string, string> = {
  policy_disabled: "该工具的策略未启用，需先在连接器页逐项决定；L3 执行前仍需门禁",
  policy_unregistered: "连接器还没有登记这个工具，先在连接器详情完成一次通过的测试",
  unknown_connector: "技能声明了当前目录里不存在的连接器",
};

export function mountSkipReasonLabel(reason: string): string {
  return MOUNT_SKIP_REASON[reason] || reason;
}

/** 可一键挂载的声明工具数：已登记且策略启用的那些。 */
export function mountableDeclaredCount(row: SkillCoverageRow): number {
  return row.tools.filter((tool) => tool.state === "available").length;
}

/** 实现度的两档说法：有启用的数字员工绑定且已发布才算上线。 */
export function implementationLabel(implementation: "live" | "defined"): string {
  return implementation === "live" ? "已上线" : "待上线";
}
