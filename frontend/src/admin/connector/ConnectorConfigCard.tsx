import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import {
  errorMessage,
  parseHttpTools,
  versionConflictMessage,
  type RuntimeConnectorConfig,
  type RuntimeConnectorTransport,
  type RuntimeProtocol,
} from "../../runtimeConnectorUi";
import type { ConnectorCardView } from "./entity";
import { ConnectorIconUpload, validateHeaderName } from "./ConnectorPanels";
import { readConnectorConfigVersion, saveConnectorConfigForm, type HeaderRow } from "./connectorSetup";

type SecretRow = { name: string; value: string; ref?: string; removed?: boolean };

function secretRowsFromConfig(config: RuntimeConnectorConfig): SecretRow[] {
  const rows = Object.entries(config.headers_secret_refs || {}).map(([name, ref]) => ({ name, value: "", ref }));
  return rows.length ? rows : [{ name: "", value: "" }];
}

export function ConnectorConfigCard({ card, reload, embedded = false, onSaved, onLoaded }: {
  card: ConnectorCardView;
  reload: () => void;
  /** Rendered inside the setup wizard: heading drops and save becomes that step's primary action. */
  embedded?: boolean;
  onSaved?: (version: number) => void;
  /** Reports the server's stored config version after each load (0 when none is saved). */
  onLoaded?: (version: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [label, setLabel] = useState(card.label);
  const [purpose, setPurpose] = useState(card.purpose);
  const [protocol, setProtocol] = useState<RuntimeProtocol>("mcp");
  const [transport, setTransport] = useState<RuntimeConnectorTransport>("streamable-http");
  const [url, setUrl] = useState("");
  const [urlEnv, setUrlEnv] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [noAuth, setNoAuth] = useState(false);
  const [secretRows, setSecretRows] = useState<SecretRow[]>([{ name: "", value: "" }]);
  const [envRefs, setEnvRefs] = useState<Record<string, string>>({});
  const [bearerRef, setBearerRef] = useState("");
  const [bearerEnv, setBearerEnv] = useState("");
  const [httpTools, setHttpTools] = useState("[]");
  const [openApiDocument, setOpenApiDocument] = useState("");
  const [openApiBusy, setOpenApiBusy] = useState(false);
  const [openApiNotice, setOpenApiNotice] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setNotice("");
    try {
      const result = await api.runtimeConnectorConfig(card.id);
      const config = result.config;
      setVersion(result.version);
      onLoaded?.(result.version);
      setProtocol(config.protocol === "http" ? "http" : "mcp");
      setTransport(config.transport === "sse" ? "sse" : "streamable-http");
      setUrl(config.url || "");
      setUrlEnv(config.url_env || "");
      setTimeoutMs(String(config.timeout_ms || 30_000));
      setNoAuth(config.allow_unauthenticated === true);
      setSecretRows(secretRowsFromConfig(config));
      setEnvRefs(config.headers_env || {});
      setBearerRef(config.bearer_secret_ref || "");
      setBearerEnv(config.bearer_env || "");
      setHttpTools(JSON.stringify(config.http_tools || [], null, 2));
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      if (status === 404) {
        setVersion(0);
        onLoaded?.(0);
        setSecretRows([{ name: "", value: "" }]);
        setEnvRefs({});
        setBearerRef("");
        setBearerEnv("");
        // The protocol was decided at the creation entry; a draft without config keeps it.
        setProtocol(card.protocol === "http" ? "http" : "mcp");
        setHttpTools("[]");
      } else {
        setLoadError(errorMessage(cause, "无法读取连接器配置"));
      }
    } finally {
      setLoading(false);
    }
  }, [card.id, card.protocol, onLoaded]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setLabel(card.label); setPurpose(card.purpose); }, [card.label, card.purpose]);

  const submit = async () => {
    const problems: string[] = [];
    const trimmedLabel = label.trim();
    const trimmedPurpose = purpose.trim();
    if (!trimmedLabel) problems.push("请填写服务器名称。");
    if (trimmedPurpose.length > 280) problems.push("备注不能超过 280 字。");
    if (!url.trim() && !urlEnv) problems.push("请填写服务器 URL。");
    if (url.trim() && !/^https?:\/\//.test(url.trim())) problems.push("服务器 URL 需要以 http:// 或 https:// 开头。");
    const timeout = Number(timeoutMs);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120_000) problems.push("超时必须是 1 到 120000 之间的整数毫秒值。");
    for (const row of secretRows) {
      const name = row.name.trim();
      if (row.removed || !name) continue;
      const problem = validateHeaderName(name);
      if (problem) problems.push(problem);
    }
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    let parsedHttpTools: RuntimeConnectorConfig["http_tools"];
    if (protocol === "http") {
      try {
        parsedHttpTools = parseHttpTools(httpTools);
      } catch (cause) {
        setError(errorMessage(cause, "HTTP 动作定义格式无效"));
        return;
      }
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (trimmedLabel !== card.label || trimmedPurpose !== card.purpose) {
        await api.adminSave(`/api/admin/connectors/${encodeURIComponent(card.id)}`, { label: trimmedLabel, purpose: trimmedPurpose || "待补充业务用途" }, "PATCH");
      }
      // A row keeps its stored reference when the field is blank; plaintext is vaulted.
      const rows: HeaderRow[] = secretRows
        .filter((row) => !row.removed && row.name.trim())
        .map((row) => ({ name: row.name.trim(), value: row.value.trim() || row.ref || "" }));
      if (!rows.length && !Object.keys(envRefs).length && !bearerRef && !bearerEnv && !noAuth) {
        setError("至少保留一个请求头密钥，或勾选「该端点明确无鉴权」。");
        return;
      }
      const savedVersion = await saveConnectorConfigForm({
        id: card.id,
        label: trimmedLabel,
        protocol,
        transport,
        url: url.trim(),
        urlEnv,
        noAuth,
        timeoutMs: timeout,
        headerRows: rows,
        envRefs,
        bearerRef,
        bearerEnv,
        httpTools: parsedHttpTools,
        iconFile,
      }, await readConnectorConfigVersion(card.id));
      setVersion(savedVersion);
      setIconFile(null);
      // The submitted secret must leave component state once written.
      setSecretRows((current) => current.map((row) => ({ ...row, value: "" })));
      await load();
      setNotice("保存成功：配置草稿已更新（待验证，尚未连通或启用）；改动后需重新测试。");
      onSaved?.(savedVersion);
      reload();
    } catch (cause) {
      setError(versionConflictMessage(cause) || errorMessage(cause, "配置未保存"));
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (index: number, patch: Partial<SecretRow>) =>
    setSecretRows((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const previewOpenApi = async () => {
    if (!openApiDocument.trim()) {
      setError("请粘贴 OpenAPI JSON 或 YAML 文档后再预览。");
      return;
    }
    setOpenApiBusy(true);
    setError("");
    setOpenApiNotice("");
    try {
      const result = await api.previewRuntimeOpenApi(card.id, openApiDocument);
      setHttpTools(JSON.stringify(result.tools, null, 2));
      setOpenApiNotice(result.warnings.length
        ? `已导入 ${result.tools.length} 个 HTTP 动作；有 ${result.warnings.length} 条限制提示。`
        : `已导入 ${result.tools.length} 个 HTTP 动作。请逐项审阅后保存。`);
    } catch (cause) {
      setError(errorMessage(cause, "OpenAPI 文档无法预览"));
    } finally {
      setOpenApiBusy(false);
    }
  };

  return (
    <section className="panel connector-detail-card" data-connector-config-card>
      {!embedded && (
        <div className="connector-card-head">
          <div>
            <h3>接入配置</h3>
            <p className="muted">端点与请求头只以服务端引用保存；浏览器不回显任何密钥原值。</p>
          </div>
          <span className="muted">短名 · <code>{card.id}</code></span>
        </div>
      )}
      {loading && <p className="muted" role="status">正在读取配置…</p>}
      {loadError && (
        <div className="runtime-state runtime-state-error" role="alert">
          <strong>无法读取配置</strong><span>{loadError}</span>
          <button type="button" className="btn sm" onClick={() => void load()}>重试</button>
        </div>
      )}
      {!loading && !loadError && (
        <>
          {error && <p className="error" role="alert" data-connector-config-error>{error}</p>}
          {notice && <p className="runtime-notice" role="status">{notice}</p>}
          <div className="connector-form-grid">
            <label className="field">服务器名称
              <input value={label} maxLength={120} data-connector-field="label" onChange={(event) => setLabel(event.target.value)} />
            </label>
            {protocol === "mcp" && <label className="field">传输类型
              <select value={transport} data-connector-field="transport" onChange={(event) => setTransport(event.target.value as RuntimeConnectorTransport)}>
                <option value="streamable-http">HTTP</option>
                <option value="sse">SSE</option>
              </select>
            </label>}
          </div>
          <div className="field">图标
            <ConnectorIconUpload variant="dialog" file={iconFile} existingUrl={card.iconUrl} onPick={setIconFile} />
          </div>
          <label className="field"><span>备注<span className="field-optional">（可选）</span></span>
            <textarea
              value={purpose}
              rows={5}
              maxLength={280}
              placeholder="提供 MCP 文档或说明，以告知平台如何及何时使用此 MCP"
              onChange={(event) => setPurpose(event.target.value)}
            />
          </label>
          <label className="field">{protocol === "mcp" ? "服务器 URL" : "API Base URL"}
            <input
              value={url}
              placeholder={urlEnv
                ? `当前使用环境变量 ${urlEnv}；填写后将改为明文端点`
                : protocol === "mcp" ? "https://mcp.yourserver.com/mcp" : "https://api.yourservice.com"}
              data-connector-field="url"
              onChange={(event) => setUrl(event.target.value)}
            />
            {urlEnv && !url && <small className="muted">端点当前由环境变量 <code>{urlEnv}</code> 提供。</small>}
          </label>
          {protocol === "http" && <section className="connector-api-definition" data-connector-http-definition>
            <div className="connector-card-head">
              <div>
                <h4>HTTP 动作定义</h4>
                <p className="muted">仅允许显式的相对路径、方法、参数映射和 JSON Schema。预览不会调用外部业务接口。</p>
              </div>
            </div>
            <label className="field">OpenAPI JSON 或 YAML（可选）
              <textarea
                value={openApiDocument}
                rows={6}
                spellCheck={false}
                data-connector-openapi-document
                placeholder={'openapi: 3.1.0\npaths:\n  /orders:\n    get:\n      operationId: listOrders'}
                onChange={(event) => { setOpenApiDocument(event.target.value); setOpenApiNotice(""); }}
              />
            </label>
            <button type="button" className="btn sm" data-connector-openapi-preview disabled={openApiBusy || busy} onClick={() => void previewOpenApi()}>
              {openApiBusy ? "预览中…" : "预览并写入动作"}
            </button>
            {openApiNotice && <p className="runtime-notice" role="status">{openApiNotice}</p>}
            <label className="field">动作 JSON
              <textarea
                value={httpTools}
                rows={12}
                spellCheck={false}
                data-connector-http-tools
                onChange={(event) => setHttpTools(event.target.value)}
              />
            </label>
            <p className="muted">每个动作均需在“接口”中单独审批，并在对应 Skill 中精确挂载后才会被模型看到。</p>
          </section>}
          <div className="field">自定义 headers
            <div className="connector-header-rows" data-connector-header-rows>
              {secretRows.map((row, index) => (
                <div className="connector-header-row" key={index}>
                  <input
                    className="connector-header-name"
                    value={row.name}
                    placeholder="Header 名称"
                    aria-label="Header 名称"
                    disabled={busy || Boolean(row.ref)}
                    onChange={(event) => updateRow(index, { name: event.target.value })}
                  />
                  <input
                    className="connector-header-value"
                    value={row.value}
                    placeholder={row.ref ? `已保存引用 ${row.ref}（不回显）；留空保持不变` : "Header 值"}
                    aria-label="Header 值"
                    type="password"
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={(event) => updateRow(index, { value: event.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={row.ref ? `移除 ${row.name} 的引用` : "删除这一行"}
                    disabled={busy}
                    onClick={() => {
                      if (row.ref) updateRow(index, { removed: true, value: "" });
                      else setSecretRows((rows) => (rows.length <= 1 ? [{ name: "", value: "" }] : rows.filter((_, position) => position !== index)));
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
              ))}
              <button type="button" className="btn sm" disabled={busy} data-connector-header-add onClick={() => setSecretRows((rows) => [...rows, { name: "", value: "" }])}>
                + 添加自定义 header
              </button>
            </div>
          </div>
          {(Object.keys(envRefs).length > 0 || bearerRef || bearerEnv) && (
            <ul className="connector-ref-list" data-connector-ref-list>
              {Object.entries(envRefs).map(([name, env]) => (
                <li key={name}>环境变量引用 · <code>{name}</code> ← <code>{env}</code></li>
              ))}
              {bearerEnv && <li>Bearer 环境变量 · <code>{bearerEnv}</code></li>}
              {bearerRef && <li>Bearer 凭据引用 · <code>{bearerRef}</code>（不回显）</li>}
            </ul>
          )}
          <div className="connector-form-grid">
            <label className="field">超时（毫秒）
              <input type="number" min="1" max="120000" value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} />
            </label>
            <label className="check connector-check-row">
              <input type="checkbox" checked={noAuth} onChange={(event) => setNoAuth(event.target.checked)} /> 该端点明确允许无鉴权
            </label>
          </div>
          <div className="connector-card-actions">
            <p className="connector-panel-note muted">保存只更新配置，不等于连通或启用；改动后需重新测试。</p>
            <button
              type="button"
              className="btn work"
              data-connector-panel-save
              data-connector-wizard-primary={embedded ? "" : undefined}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
