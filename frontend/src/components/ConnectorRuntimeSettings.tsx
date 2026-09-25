import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  errorMessage,
  parseHttpTools,
  parseReferenceMap,
  policyKey,
  type RuntimeConnectorConfig,
  type RuntimeProtocol,
  type RuntimeToolDefinition,
  type RuntimeToolPolicy,
  versionConflictMessage,
} from "../runtimeConnectorUi";

type ConfigForm = {
  protocol: RuntimeProtocol;
  endpointMode: "url" | "url_env";
  url: string;
  urlEnv: string;
  headersEnv: string;
  bearerEnv: string;
  credentialProvider: string;
  credentialAccountId: string;
  allowUnauthenticated: boolean;
  timeoutMs: string;
  headersSecretRefs: string;
  bearerSecretRef: string;
  httpTools: string;
};

const EMPTY_CONFIG: RuntimeConnectorConfig = { protocol: "mcp", timeout_ms: 30_000 };

function formFromConfig(config: RuntimeConnectorConfig): ConfigForm {
  // The product catalog only admits MCP servers. Older HTTP payloads are not
  // presented as an editable path in the managed connector flow.
  const protocol: RuntimeProtocol = "mcp";
  return {
    protocol,
    endpointMode: config.url_env ? "url_env" : "url",
    url: config.url || "",
    urlEnv: config.url_env || "",
    headersEnv: config.headers_env ? JSON.stringify(config.headers_env, null, 2) : "",
    bearerEnv: config.bearer_env || "",
    credentialProvider: config.credential_provider || "",
    credentialAccountId: config.credential_account_id || "",
    allowUnauthenticated: config.allow_unauthenticated === true,
    timeoutMs: String(config.timeout_ms || 30_000),
    headersSecretRefs: config.headers_secret_refs ? JSON.stringify(config.headers_secret_refs, null, 2) : "",
    bearerSecretRef: config.bearer_secret_ref || "",
    httpTools: JSON.stringify(config.http_tools || [], null, 2),
  };
}

function buildConfig(form: ConfigForm): RuntimeConnectorConfig {
  const timeout = Number(form.timeoutMs);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) {
    throw new Error("超时必须是 1 到 120000 之间的整数毫秒值");
  }
  const config: RuntimeConnectorConfig = {
    protocol: form.protocol,
    timeout_ms: timeout,
    allow_unauthenticated: form.allowUnauthenticated,
  };
  if (form.endpointMode === "url") {
    if (!form.url.trim()) throw new Error("请填写连接器 URL，或改用环境变量引用");
    config.url = form.url.trim();
  } else {
    if (!form.urlEnv.trim()) throw new Error("请填写 URL 环境变量引用");
    config.url_env = form.urlEnv.trim();
  }
  const headersEnv = parseReferenceMap(form.headersEnv, "请求头环境变量") || undefined;
  const headersSecretRefs = parseReferenceMap(form.headersSecretRefs, "请求头 secret 引用") || undefined;
  if (headersEnv) config.headers_env = headersEnv;
  if (headersSecretRefs) config.headers_secret_refs = headersSecretRefs;
  if (form.bearerEnv.trim()) config.bearer_env = form.bearerEnv.trim();
  if (form.bearerSecretRef.trim()) config.bearer_secret_ref = form.bearerSecretRef.trim();
  if (form.credentialProvider.trim()) config.credential_provider = form.credentialProvider.trim();
  if (form.credentialAccountId.trim()) config.credential_account_id = form.credentialAccountId.trim();
  return config;
}

function friendlyProbeFailure(code: string): string {
  if (code === "AbortError" || code === "request_aborted") return "测试已取消或连接中断；请确认服务可访问后重试。";
  if (code === "runtime_connector_disabled") return "连接器已停用，无法测试。请在详情完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先完成连接草稿。";
  return code ? `测试未通过；请检查已保存配置后重试（错误码：${code}）。` : "测试未通过；请检查已保存配置后重试。";
}

function schemaText(schema: Record<string, unknown>) {
  return JSON.stringify(schema, null, 2);
}

function statusCode(error: unknown): number | undefined {
  return (error as { status?: number } | undefined)?.status;
}

function ToolApprovalRow({
  connectorId,
  tool,
  policy,
  onSaved,
}: {
  connectorId: string;
  tool: RuntimeToolDefinition;
  policy?: RuntimeToolPolicy;
  onSaved: (row: RuntimeToolPolicy) => void;
}) {
  const [enabled, setEnabled] = useState(Boolean(policy?.enabled));
  const [risk, setRisk] = useState<"L1" | "L2" | "L3">(policy?.risk || "L1");
  const [access, setAccess] = useState<"read" | "write">(policy?.access || "read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conflict = versionConflictMessage(error ? new Error(error) : null);

  const save = async () => {
    if (!tool.schema_hash) {
      setError("该工具没有可审批的 schema_hash。请重新发现，不要以未知 schema 发布。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const row = await api.saveRuntimeConnectorPolicy(connectorId, tool.name, {
        enabled,
        risk,
        access,
        schema_hash: tool.schema_hash,
        expected_version: policy?.version ?? 0,
      });
      onSaved(row);
    } catch (cause) {
      setError(versionConflictMessage(cause) || errorMessage(cause, "工具策略未保存"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="runtime-tool-row" data-runtime-tool={tool.name} data-risk={risk}>
      <div className="runtime-tool-main">
        <div className="runtime-tool-name"><strong>{tool.name}</strong><span className={"admin-status runtime-risk risk-" + risk.toLowerCase()}>{risk}</span></div>
        <p className="muted">{tool.description || "无远端描述"}</p>
        <details className="runtime-schema">
          <summary>查看输入 Schema 与来源指纹</summary>
          <code className="runtime-hash">{tool.schema_hash || "未提供来源指纹"}</code>
          <pre>{schemaText(tool.inputSchema || {})}</pre>
        </details>
      </div>
      <div className="runtime-tool-controls">
        <label className="check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 审批并启用</label>
        <label className="field runtime-compact-field">风险
          <select value={risk} onChange={(event) => setRisk(event.target.value as "L1" | "L2" | "L3")}>
            <option value="L1">L1 · 只读</option>
            <option value="L2">L2 · 草稿</option>
            <option value="L3">L3 · 正式动作</option>
          </select>
        </label>
        <label className="field runtime-compact-field">连接器权限
          <select value={access} onChange={(event) => setAccess(event.target.value as "read" | "write")}>
            <option value="read">read</option>
            <option value="write">write</option>
          </select>
        </label>
        {risk === "L3" && <p className="runtime-l3-notice">L3 不会因这里启用而直接可调用；它仍必须经过通用确认、版本与 Gateway 闸门。</p>}
        {error && <p className="error runtime-inline-error" role="alert">{conflict || error}</p>}
        <button className="btn" type="button" disabled={busy || !tool.schema_hash} onClick={() => void save()}>
          {busy ? "保存中…" : policy ? "保存审批" : "首次审批"}
        </button>
      </div>
    </article>
  );
}

export function ConnectorRuntimeSettings({ connectorId }: { connectorId: string }) {
  const [form, setForm] = useState<ConfigForm>(() => formFromConfig(EMPTY_CONFIG));
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [configExists, setConfigExists] = useState(false);
  const [loadingError, setLoadingError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [discoveryAuthorization, setDiscoveryAuthorization] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [openApiDocument, setOpenApiDocument] = useState("");
  const [openApiBusy, setOpenApiBusy] = useState(false);
  const [openApiError, setOpenApiError] = useState("");
  const [openApiPreview, setOpenApiPreview] = useState<{ tools: ReturnType<typeof parseHttpTools>; warnings: string[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [latestProbe, setLatestProbe] = useState<{
    status: string;
    probe_kind: "mcp_tools_list" | "http_definition";
    tool_count: number;
    checked_at: string;
    duration_ms: number;
    live_verified: boolean;
    notice: string;
  } | null>(null);
  const [activity, setActivity] = useState<{
    probes: Array<{ id: number; checked_at: string; status: string; probe_kind: "mcp_tools_list" | "http_definition"; tool_count: number; duration_ms: number; error_code?: string | null }>;
    events: Array<{ id: number; ts: string; actor: string; event_type: string; payload: Record<string, unknown> }>;
  } | null>(null);
  const [activityError, setActivityError] = useState("");

  const loadActivity = useCallback(async () => {
    setActivityError("");
    try {
      setActivity(await api.runtimeConnectorActivity(connectorId));
    } catch (cause) {
      setActivityError(errorMessage(cause, "无法读取连接器探针与运行治理记录"));
    }
  }, [connectorId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadingError("");
    setDiscoveryError("");
    const [configResult, policiesResult] = await Promise.allSettled([
      api.runtimeConnectorConfig(connectorId),
      api.runtimeConnectorPolicies(connectorId),
    ]);

    if (configResult.status === "fulfilled") {
      setForm(formFromConfig(configResult.value.config));
      setVersion(configResult.value.version);
      setConfigExists(true);
    } else if (statusCode(configResult.reason) === 404) {
      setForm(formFromConfig(EMPTY_CONFIG));
      setVersion(0);
      setConfigExists(false);
    } else {
      setLoadingError(errorMessage(configResult.reason, "无法读取连接器运行时配置"));
    }

    if (policiesResult.status === "fulfilled") {
      setPolicies(policiesResult.value);
    } else {
      setDiscoveryError(errorMessage(policiesResult.reason, "无法读取已审批工具策略"));
    }
    setLoading(false);
    void loadActivity();
  }, [connectorId, loadActivity]);

  useEffect(() => {
    void load();
  }, [load]);

  const policyByTool = useMemo(() => new Map(policies.map((policy) => [policyKey(policy.connector_id, policy.tool_name), policy])), [policies]);

  const setField = <K extends keyof ConfigForm>(field: K, value: ConfigForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError("");
    setNotice("");
    let config: RuntimeConnectorConfig;
    try {
      config = buildConfig(form);
    } catch (cause) {
      setSaveError(errorMessage(cause, "配置格式无效"));
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveRuntimeConnectorConfig(connectorId, { ...config, expected_version: version });
      setForm(formFromConfig(result.config));
      setVersion(result.version);
      setConfigExists(true);
      setNotice("配置草稿已保存。保存不等于连通、审批或挂载。");
    } catch (cause) {
      setSaveError(versionConflictMessage(cause) || errorMessage(cause, "配置未保存"));
    } finally {
      setSaving(false);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setDiscoveryError("");
    setNotice("");
    try {
      const result = await api.runtimeConnectorDiscovery(connectorId);
      setTools(result.tools);
      setDiscoveryAuthorization(result.authorization);
      setNotice(`发现了 ${result.tools.length} 个工具。它们均未自动获批或挂载。`);
    } catch (cause) {
      setDiscoveryError(errorMessage(cause, "工具发现失败；请检查已保存的受控配置与服务状态"));
    } finally {
      setDiscovering(false);
    }
  };

  const previewOpenApi = async () => {
    setOpenApiError("");
    setOpenApiPreview(null);
    if (!openApiDocument.trim()) {
      setOpenApiError("请粘贴 OpenAPI JSON 或 YAML 文档");
      return;
    }
    setOpenApiBusy(true);
    try {
      const preview = await api.previewRuntimeOpenApi(connectorId, openApiDocument);
      setOpenApiPreview(preview);
    } catch (cause) {
      setOpenApiError(errorMessage(cause, "OpenAPI 预览失败；不会更改配置或执行请求"));
    } finally {
      setOpenApiBusy(false);
    }
  };

  const useOpenApiPreview = () => {
    if (!openApiPreview) return;
    setField("httpTools", JSON.stringify(openApiPreview.tools, null, 2));
    setNotice("预览工具已写入本地 HTTP 工具编辑器；请检查后另行保存配置，再逐项审批。未调用远端服务。 ");
  };

  const useManualHttpToolsForApproval = () => {
    setDiscoveryError("");
    try {
      const manual = parseHttpTools(form.httpTools).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        schema_hash: "",
      }));
      setTools(manual);
      setDiscoveryAuthorization("手工 HTTP 工具仍需由运行时发现生成来源指纹后才能审批；未提供 hash 的工具不能发布。");
    } catch (cause) {
      setDiscoveryError(errorMessage(cause, "HTTP 工具 JSON 无法用于审批预览"));
    }
  };

  const probe = async () => {
    setProbing(true);
    setProbeError("");
    try {
      const result = await api.probeRuntimeConnector(connectorId);
      setLatestProbe(result);
      setNotice(result.notice);
      await loadActivity();
    } catch (cause) {
      const payload = (cause as { payload?: { error_code?: unknown; code?: unknown; message?: unknown } } | undefined)?.payload;
      const code = typeof payload?.error_code === "string" ? payload.error_code : typeof payload?.code === "string" ? payload.code : "";
      setProbeError(friendlyProbeFailure(code));
      await loadActivity();
    } finally {
      setProbing(false);
    }
  };

  return (
    <section className="runtime-settings" aria-labelledby="runtime-settings-heading" data-runtime-settings={connectorId}>
      <div className="runtime-section-heading">
        <div>
          <h2 id="runtime-settings-heading">运行时接入与工具治理</h2>
          <p className="muted">端点与凭据仅以服务端引用保存。浏览器不提交或回显 API Key、Bearer、JWT 或 Header 原值。</p>
        </div>
        <button type="button" className="btn sm" onClick={() => void load()} disabled={loading}>刷新</button>
      </div>

      {loading && <p className="muted" role="status" data-runtime-config-loading>正在读取已保存配置与工具策略…</p>}
      {loadingError && <div className="runtime-state runtime-state-error" role="alert"><strong>无法加载运行时配置</strong><span>{loadingError}</span><button type="button" className="btn sm" onClick={() => void load()}>重试</button></div>}
      {!loading && !loadingError && !configExists && <div className="runtime-state" data-runtime-config-empty><strong>尚未保存运行时配置</strong><span>先填写草稿并保存；缺失配置时运行时会拒绝调用，不会回退到未登记环境。</span></div>}
      {notice && <p className="runtime-notice" role="status">{notice}</p>}

      <form className="runtime-config-form" onSubmit={(event) => void saveConfig(event)}>
        <fieldset disabled={loading}>
          <legend>连接实例草稿</legend>
          <div className="runtime-form-grid">
            <div className="field"><span>协议</span><strong>MCP（Streamable HTTP）</strong><small className="muted">此受管目录不支持 HTTP / OpenAPI 接入。</small></div>
            <label className="field">超时（毫秒）
              <input type="number" min="1" max="120000" value={form.timeoutMs} onChange={(event) => setField("timeoutMs", event.target.value)} />
            </label>
          </div>
          <fieldset className="runtime-nested-fieldset">
            <legend>端点（只可二选一）</legend>
            <div className="runtime-radio-row">
              <label className="check"><input type="radio" checked={form.endpointMode === "url"} onChange={() => setField("endpointMode", "url")} /> 明文端点 URL</label>
              <label className="check"><input type="radio" checked={form.endpointMode === "url_env"} onChange={() => setField("endpointMode", "url_env")} /> 环境变量引用</label>
            </div>
            {form.endpointMode === "url" ? (
              <label className="field">URL<input type="url" value={form.url} onChange={(event) => setField("url", event.target.value)} placeholder="https://service.example/mcp 或 https://api.example" /></label>
            ) : (
              <label className="field">URL 环境变量<input value={form.urlEnv} onChange={(event) => setField("urlEnv", event.target.value)} placeholder="CONNECTOR_URL" autoCapitalize="characters" /></label>
            )}
          </fieldset>
          <details className="runtime-advanced">
            <summary>高级技术配置（环境变量与凭据映射）</summary>
            <div className="runtime-form-grid">
            <label className="field">请求头环境变量映射（JSON，可选）
              <textarea rows={4} value={form.headersEnv} onChange={(event) => setField("headersEnv", event.target.value)} placeholder={'{"X-API-Key":"CONNECTOR_API_KEY"}'} spellCheck={false} />
            </label>
            <label className="field">请求头 Secret 引用（JSON，可选）
              <textarea rows={4} value={form.headersSecretRefs} onChange={(event) => setField("headersSecretRefs", event.target.value)} placeholder={'{"X-API-Key":"credential-id"}'} spellCheck={false} />
            </label>
            <label className="field">Bearer 环境变量（可选）
              <input value={form.bearerEnv} onChange={(event) => setField("bearerEnv", event.target.value)} placeholder="CONNECTOR_BEARER" autoCapitalize="characters" />
            </label>
            <label className="field">Bearer Secret 引用（可选）
              <input value={form.bearerSecretRef} onChange={(event) => setField("bearerSecretRef", event.target.value)} placeholder="credential-id" autoComplete="off" />
            </label>
            <label className="field">凭据提供器（可选）
              <input value={form.credentialProvider} onChange={(event) => setField("credentialProvider", event.target.value)} placeholder="已注册的 provider 标识" autoComplete="off" />
            </label>
            <label className="field">个人账号凭据引用（仅 user-account）
              <input value={form.credentialAccountId} onChange={(event) => setField("credentialAccountId", event.target.value)} placeholder="cred_…；必须精确指定，不能默认挑选账号" autoComplete="off" />
            </label>
            <label className="check runtime-check-field"><input type="checkbox" checked={form.allowUnauthenticated} onChange={(event) => setField("allowUnauthenticated", event.target.checked)} /> 该端点明确允许无鉴权</label>
            </div>
          </details>
          <p className="muted runtime-form-hint">凭据写入服务若已部署，应仅返回引用 ID 和元数据；本页没有写入原始秘密的输入框。无认证引用且未显式允许无鉴权时，服务端必须拒绝保存。</p>
          {form.protocol === "http" && (
            <label className="field runtime-editor-field">HTTP 工具定义（JSON）
              <textarea rows={16} value={form.httpTools} onChange={(event) => setField("httpTools", event.target.value)} spellCheck={false} aria-describedby="http-tools-help" />
              <span id="http-tools-help" className="muted">仅支持相对绝对路径、GET/POST/PUT/PATCH/DELETE、JSON 请求和无表达式的 query/body 字段映射。GET 不允许 body。</span>
            </label>
          )}
          {saveError && <p className="error" role="alert" data-runtime-config-error>{saveError}</p>}
          <div className="runtime-save-row">
            <button className="btn work" disabled={saving}>{saving ? "保存中…" : "保存连接器草稿"}</button>
            <span className="muted">当前配置版本：{configExists ? version : "新建（0）"}</span>
          </div>
        </fieldset>
      </form>

      {form.protocol === "http" && (
        <div className="runtime-import-block">
          <div className="runtime-section-heading">
            <div><h3>OpenAPI 导入预览</h3><p className="muted">支持 JSON 或 YAML。预览不会保存、授权或执行任何操作；认证定义不会自动转成凭据。</p></div>
          </div>
          <label className="field">OpenAPI JSON / YAML 文档
            <textarea rows={10} value={openApiDocument} onChange={(event) => setOpenApiDocument(event.target.value)} placeholder='{ "openapi": "3.1.0", "paths": {} }' spellCheck={false} />
          </label>
          <div className="admin-actions"><button type="button" className="btn" onClick={() => void previewOpenApi()} disabled={openApiBusy || !openApiDocument.trim()}>{openApiBusy ? "解析中…" : "预览可导入操作"}</button><button type="button" className="btn" onClick={useManualHttpToolsForApproval}>从已编辑工具查看审批状态</button></div>
          {openApiError && <p className="error" role="alert">{openApiError}</p>}
          {openApiPreview && <div className="runtime-preview" data-openapi-preview>
            <strong>预览：{openApiPreview.tools.length} 个可导入工具</strong>
            {openApiPreview.tools.length === 0 && <p className="muted">没有可表示的操作。请检查服务端警告；不会静默丢弃不支持的安全或序列化语义。</p>}
            {openApiPreview.tools.length > 0 && <ul>{openApiPreview.tools.map((tool) => <li key={tool.name}><code>{tool.method} {tool.path}</code> · {tool.name}</li>)}</ul>}
            {openApiPreview.warnings.length > 0 && <div className="runtime-warning-list"><strong>未导入 / 需处理</strong><ul>{openApiPreview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
            <button type="button" className="btn" onClick={useOpenApiPreview} disabled={!openApiPreview.tools.length}>写入 HTTP 工具编辑器</button>
          </div>}
        </div>
      )}

      <div className="runtime-tool-governance">
        <div className="runtime-section-heading">
          <div>
            <h3>发现与逐工具审批</h3>
            <p className="muted">发现只读取工具目录。每个工具的 Schema/描述变化都需要重新审阅；新工具默认不可执行。</p>
          </div>
          <button type="button" className="btn" onClick={() => void discover()} disabled={discovering || loading || !configExists}>{discovering ? "发现中…" : "发现工具"}</button>
        </div>
        {!configExists && <div className="runtime-state"><strong>先保存配置</strong><span>运行时必须从已保存的受控配置发现工具；不能以表单临时值连到远端。</span></div>}
        {discoveryError && <div className="runtime-state runtime-state-error" role="alert"><strong>工具治理数据不可用</strong><span>{discoveryError}</span><button type="button" className="btn sm" onClick={() => void load()}>重试读取</button></div>}
        {discoveryAuthorization && <p className="runtime-discovery-note">{discoveryAuthorization}</p>}
        {!tools.length && configExists && !discovering && <p className="muted" data-runtime-discovery-empty>尚未在本页发现工具。点击“发现工具”后，先审阅 Schema，再逐项保存风险、访问级别和启用状态。</p>}
        <div className="runtime-tools-list">
          {tools.map((tool) => {
            const policy = policyByTool.get(policyKey(connectorId, tool.name));
            return <ToolApprovalRow key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}`} connectorId={connectorId} tool={tool} policy={policy} onSaved={(saved) => {
              setPolicies((current) => [...current.filter((item) => policyKey(item.connector_id, item.tool_name) !== policyKey(saved.connector_id, saved.tool_name)), saved]);
              setNotice(`工具“${saved.tool_name}”的审批策略已保存。Skill 仍需单独精确挂载。`);
            }} />;
          })}
        </div>
      </div>

      <div className="runtime-activity" data-runtime-activity>
        <div className="runtime-section-heading">
          <div>
            <h3>测试与审计</h3>
            <p className="muted">MCP 测试只列出工具目录；HTTP 测试只校验已保存的动作定义。两者都不执行外部业务操作。</p>
          </div>
          <button type="button" className="btn" onClick={() => void probe()} disabled={probing || loading || !configExists}>{probing ? "测试中…" : "测试已保存配置"}</button>
        </div>
        {!configExists && <p className="muted">保存受控配置后才可测试，避免把页面临时值用于网络访问。</p>}
        {probeError && <p className="error" role="alert">{probeError}</p>}
        {latestProbe && <div className="runtime-probe-result" role="status">
          <strong>{latestProbe.status === "succeeded" ? "最近测试完成" : "最近测试失败"}</strong>
          <span>{latestProbe.notice}</span>
          <span>{latestProbe.checked_at} · {latestProbe.tool_count} 个工具 · {latestProbe.duration_ms}ms · {latestProbe.live_verified ? "MCP 目录已验证" : "非网络业务验证"}</span>
        </div>}
        {activityError && <div className="runtime-state runtime-state-error" role="alert"><strong>无法读取测试与审计</strong><span>{activityError}</span><button type="button" className="btn sm" onClick={() => void loadActivity()}>重试</button></div>}
        {activity && !activity.probes.length && !activity.events.length && <p className="muted">尚无本连接器的测试或运行治理记录。</p>}
        {activity && (activity.probes.length > 0 || activity.events.length > 0) && <div className="runtime-history-grid">
          <div>
            <strong>最近测试</strong>
            <ul className="runtime-history-list">
              {activity.probes.slice(0, 8).map((record) => <li key={record.id}><span>{record.status === "succeeded" ? "通过" : "失败"} · {record.probe_kind === "mcp_tools_list" ? "MCP 工具目录" : "HTTP 动作定义"}</span><small>{record.checked_at} · {record.tool_count} 个工具 · {record.duration_ms}ms{record.error_code ? ` · ${record.error_code}` : ""}</small></li>)}
            </ul>
          </div>
          <div>
            <strong>最近治理事件</strong>
            <ul className="runtime-history-list">
              {activity.events.slice(0, 8).map((event) => <li key={event.id}><span>{event.event_type}</span><small>{event.ts} · {event.actor === "usr_sriphy" ? "sriphy" : event.actor || "系统"}</small></li>)}
            </ul>
          </div>
        </div>}
      </div>
    </section>
  );
}
