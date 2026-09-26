import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { errorMessage, versionConflictMessage, type RuntimeConnectorConfig, type RuntimeConnectorTransport } from "../../runtimeConnectorUi";
import type { ConnectorCardView } from "./entity";
import { ConnectorIconUpload, validateHeaderName } from "./ConnectorPanels";

type SecretRow = { name: string; value: string; ref?: string; removed?: boolean };

function secretRowsFromConfig(config: RuntimeConnectorConfig): SecretRow[] {
  const rows = Object.entries(config.headers_secret_refs || {}).map(([name, ref]) => ({ name, value: "", ref }));
  return rows.length ? rows : [{ name: "", value: "" }];
}

export function ConnectorConfigCard({ card, reload }: { card: ConnectorCardView; reload: () => void }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [label, setLabel] = useState(card.label);
  const [purpose, setPurpose] = useState(card.purpose);
  const [transport, setTransport] = useState<RuntimeConnectorTransport>("streamable-http");
  const [url, setUrl] = useState("");
  const [urlEnv, setUrlEnv] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [noAuth, setNoAuth] = useState(false);
  const [secretRows, setSecretRows] = useState<SecretRow[]>([{ name: "", value: "" }]);
  const [envRefs, setEnvRefs] = useState<Record<string, string>>({});
  const [bearerRef, setBearerRef] = useState("");
  const [bearerEnv, setBearerEnv] = useState("");
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
      setTransport(config.transport === "sse" ? "sse" : "streamable-http");
      setUrl(config.url || "");
      setUrlEnv(config.url_env || "");
      setTimeoutMs(String(config.timeout_ms || 30_000));
      setNoAuth(config.allow_unauthenticated === true);
      setSecretRows(secretRowsFromConfig(config));
      setEnvRefs(config.headers_env || {});
      setBearerRef(config.bearer_secret_ref || "");
      setBearerEnv(config.bearer_env || "");
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      if (status === 404) {
        setVersion(0);
        setSecretRows([{ name: "", value: "" }]);
        setEnvRefs({});
        setBearerRef("");
        setBearerEnv("");
      } else {
        setLoadError(errorMessage(cause, "无法读取连接器配置"));
      }
    } finally {
      setLoading(false);
    }
  }, [card.id]);

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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (trimmedLabel !== card.label || trimmedPurpose !== card.purpose) {
        await api.adminSave(`/api/admin/connectors/${encodeURIComponent(card.id)}`, { label: trimmedLabel, purpose: trimmedPurpose || "待补充业务用途" }, "PATCH");
      }
      const refs: Record<string, string> = {};
      for (const row of secretRows) {
        const name = row.name.trim();
        if (!name || row.removed) continue;
        const value = row.value.trim();
        if (value.startsWith("cred_")) {
          refs[name] = value;
        } else if (value) {
          const created = await api.createRuntimeCredential({
            type: "organization_secret",
            label: `${trimmedLabel} · ${name}`,
            purpose: "由连接器配置表单写入",
            secret: value,
          });
          refs[name] = created.id;
        } else if (row.ref) {
          refs[name] = row.ref;
        }
      }
      if (!Object.keys(refs).length && !Object.keys(envRefs).length && !bearerRef && !bearerEnv && !noAuth) {
        setError("至少保留一个请求头密钥，或勾选「该端点明确无鉴权」。");
        setBusy(false);
        return;
      }
      const config: RuntimeConnectorConfig & { expected_version: number } = {
        protocol: "mcp",
        transport,
        timeout_ms: timeout,
        allow_unauthenticated: noAuth,
        expected_version: version,
      };
      if (url.trim()) config.url = url.trim();
      else config.url_env = urlEnv;
      if (Object.keys(refs).length) config.headers_secret_refs = refs;
      if (Object.keys(envRefs).length) config.headers_env = envRefs;
      if (bearerRef) config.bearer_secret_ref = bearerRef;
      if (bearerEnv) config.bearer_env = bearerEnv;
      const saved = await api.saveRuntimeConnectorConfig(card.id, config);
      setVersion(saved.version);
      let iconWarning = "";
      if (iconFile) {
        try {
          await api.uploadConnectorIcon(card.id, iconFile);
          setIconFile(null);
        } catch (cause) {
          iconWarning = errorMessage(cause, "可稍后重试");
        }
      }
      // The submitted secret must leave component state once written.
      setSecretRows((rows) => rows.map((row) => ({ ...row, value: "" })));
      await load();
      setNotice(iconWarning
        ? `配置已保存；图标未上传成功（${iconWarning}）。`
        : "配置草稿已保存。保存不等于连通、审批或启用；请重新测试并审阅接口。");
      reload();
    } catch (cause) {
      setError(versionConflictMessage(cause) || errorMessage(cause, "配置未保存"));
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (index: number, patch: Partial<SecretRow>) =>
    setSecretRows((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <section className="panel connector-detail-card" data-connector-config-card>
      <div className="connector-card-head">
        <div>
          <h3>接入配置</h3>
          <p className="muted">端点与请求头只以服务端引用保存；浏览器不回显任何密钥原值。</p>
        </div>
        <span className="muted">短名 · <code>{card.id}</code></span>
      </div>
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
            <label className="field">传输类型
              <select value={transport} data-connector-field="transport" onChange={(event) => setTransport(event.target.value as RuntimeConnectorTransport)}>
                <option value="streamable-http">HTTP（Streamable）</option>
                <option value="sse">SSE</option>
              </select>
            </label>
          </div>
          <div className="field">图标
            <ConnectorIconUpload file={iconFile} existingUrl={card.iconUrl} onPick={setIconFile} />
          </div>
          <label className="field">备注
            <textarea value={purpose} rows={2} maxLength={280} onChange={(event) => setPurpose(event.target.value)} />
          </label>
          <label className="field">服务器 URL
            <input
              value={url}
              placeholder={urlEnv ? `当前使用环境变量 ${urlEnv}；填写后将改为明文端点` : "https://mcp.yourserver.com/mcp"}
              data-connector-field="url"
              onChange={(event) => setUrl(event.target.value)}
            />
            {urlEnv && !url && <small className="muted">端点当前由环境变量 <code>{urlEnv}</code> 提供。</small>}
          </label>
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
              <p className="muted">值将加密写入凭据保险库，保存后不回显；填 <code>cred_…</code> 可直接引用既有凭据。</p>
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
            <button type="button" className="btn" disabled={busy} onClick={() => void load()}>放弃修改并刷新</button>
            <button type="button" className="btn work" data-connector-config-save disabled={busy} onClick={() => void submit()}>
              {busy ? "保存中…" : "保存配置草稿"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
