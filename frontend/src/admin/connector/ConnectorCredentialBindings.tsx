import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "antd";
import { api } from "../../api";
import { ConnectorCredentialVault } from "../../components/ConnectorCredentialVault";
import { errorMessage, type RuntimeConnectorConfig, type RuntimeCredentialMetadata } from "../../runtimeConnectorUi";

export function connectorCredentialBindings(config: RuntimeConnectorConfig | null) {
  if (!config) return [];
  return [
    ...Object.entries(config.headers_secret_refs || {}).map(([name, ref]) => ({ name, ref, source: "保险库" })),
    ...(config.bearer_secret_ref ? [{ name: "Authorization · Bearer", ref: config.bearer_secret_ref, source: "保险库" }] : []),
    ...Object.entries(config.headers_env || {}).map(([name, ref]) => ({ name, ref, source: "环境变量" })),
    ...(config.bearer_env ? [{ name: "Authorization · Bearer", ref: config.bearer_env, source: "环境变量" }] : []),
    ...(config.credential_provider ? [{ name: "账号提供方", ref: config.credential_account_id || config.credential_provider, source: config.credential_provider }] : []),
  ];
}

// 凭据 ID 只在核验时有用：默认掩码，hover 看全量，避免把内部标识当正文。
function maskReference(ref: string) {
  // 只掩码保险库 ID（cred_…）；环境变量名是用户配置的可见值，保持原样。
  if (!ref.startsWith("cred_") || ref.length <= 12) return ref;
  return `${ref.slice(0, 9)}…${ref.slice(-4)}`;
}

function referenceStatus(source: string, metadata: RuntimeCredentialMetadata | undefined, loading: boolean) {
  if (source === "保险库") {
    if (loading) return "状态读取中";
    if (!metadata) return "状态未确认";
    return metadata.status === "active" ? "可用" : "已停用";
  }
  return source === "环境变量" ? "环境状态未确认" : "提供方状态未确认";
}

function referenceMetadata(source: string, metadata: RuntimeCredentialMetadata | undefined, loading: boolean, failed: boolean) {
  if (source === "保险库") {
    if (loading) return "正在读取保险库元数据";
    if (metadata) return `${metadata.label || "未命名"} · 密钥 v${metadata.key_version}`;
    return failed ? "元数据读取失败，当前状态未确认" : "保险库元数据未返回此引用";
  }
  return source === "环境变量" ? "由运行时环境解析，当前未核验" : "由账号提供方管理，当前状态未确认";
}

/** This is a projection of saved references, not a second credential editor. */
export function ConnectorCredentialBindings({ config, configVersion, configLoaded, onOpenConfig }: {
  config: RuntimeConnectorConfig | null;
  configVersion: number | null;
  configLoaded: boolean;
  onOpenConfig: () => void;
}) {
  const [metadata, setMetadata] = useState<RuntimeCredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vaultOpen, setVaultOpen] = useState(false);
  const metadataRequest = useRef(0);
  const references = connectorCredentialBindings(config);
  const load = useCallback(async () => {
    const request = ++metadataRequest.current;
    setLoading(true);
    setError("");
    // A fresh read must not leave a previous active state visible while it is unconfirmed.
    setMetadata([]);
    try {
      const next = await api.runtimeCredentials();
      if (request === metadataRequest.current) setMetadata(next);
    } catch (cause) {
      if (request === metadataRequest.current) setError(errorMessage(cause, "无法读取凭据元数据；已保存绑定仍会显示，但状态未确认。"));
    } finally {
      if (request === metadataRequest.current) setLoading(false);
    }
  }, []);
  useEffect(() => { if (configLoaded) void load(); }, [load, configVersion, configLoaded]);
  const byId = new Map(metadata.map((row) => [row.id, row]));

  return (
    <section className="panel connector-detail-card connector-credential-bindings" data-connector-credentials>
      <div className="connector-card-head">
        <div>
          <h3>本连接器的凭据引用</h3>
          <p className="muted">仅展示已保存配置的绑定。秘密不会读取、复制或回显；未保存的草稿不在此展示。</p>
        </div>
        <div className="connector-credential-header-actions">
          <button type="button" className="btn text" data-connector-global-vault-open onClick={() => setVaultOpen(true)}>管理全局保险库</button>
          <button
            type="button"
            className="btn text"
            data-connector-credential-refresh
            disabled={!configLoaded || loading}
            aria-busy={loading}
            onClick={() => void load()}
          >{loading ? "刷新中…" : "刷新状态"}</button>
        </div>
      </div>
      {!configLoaded && <p className="muted" role="status">尚未获得已保存配置；若读取失败，无法确认是否存在绑定。请返回接入配置重试。</p>}
      {configLoaded && loading && <p className="muted" role="status">正在读取凭据状态…</p>}
      {error && <div className="connector-credential-status-error" role="alert"><p className="error">{error}</p></div>}
      {configLoaded && references.length > 0 && (
        <ul className="connector-credential-reference-list" data-connector-credential-references>
          {references.map((reference) => {
            const row = byId.get(reference.ref);
            const status = referenceStatus(reference.source, row, loading);
            const metadataDetail = referenceMetadata(reference.source, row, loading, Boolean(error));
            const statusClass = reference.source === "保险库" && row && !loading
              ? row.status === "active" ? "status-ok" : "status-warn"
              : "muted";
            return (
              <li className="connector-credential-reference" key={`${reference.source}:${reference.name}:${reference.ref}`}>
                <div className="connector-credential-reference-main">
                  <strong>{reference.name}</strong>
                  <p className="muted"><span>{reference.source}</span><span aria-hidden="true"> · </span><code title={reference.ref}>{maskReference(reference.ref)}</code></p>
                </div>
                <div className="connector-credential-reference-status">
                  <span className={statusClass} data-connector-credential-status={reference.ref} aria-label={`${reference.name}状态`}>{status}</span>
                  <p className="muted">{metadataDetail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {configLoaded && references.length === 0 && <p className="muted">{config?.allow_unauthenticated ? "已保存配置声明该端点允许无鉴权。" : "当前没有绑定凭据引用；请在接入配置中检查鉴权方式。"}</p>}
      <div className="connector-credential-binding-action-row">
        <div className="connector-credential-binding-action-copy">
          <p className="muted">绑定修改仅在接入配置中完成；本面只展示已保存的引用。</p>
          <p className="muted">全局凭据可能被其他连接器共用，停用或删除会影响全部引用方。</p>
        </div>
        <button type="button" className="btn text" data-connector-credential-edit onClick={onOpenConfig}>修改绑定</button>
      </div>
      <Drawer
        title="全局凭据保险库"
        open={vaultOpen}
        onClose={() => { setVaultOpen(false); void load(); }}
        size="large"
        className="connector-global-vault-drawer"
      >
        <p className="muted" data-connector-global-vault-warning>这是全局安全资产管理，不仅限于当前连接器。停用或删除凭据可能影响其他引用方；本次操作不会修改连接器的绑定。</p>
        {vaultOpen && <ConnectorCredentialVault />}
      </Drawer>
    </section>
  );
}
