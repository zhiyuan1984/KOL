import { useCallback, useEffect, useState } from "react";
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
  const references = connectorCredentialBindings(config);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setMetadata(await api.runtimeCredentials()); }
    catch (cause) { setError(errorMessage(cause, "无法读取凭据元数据；以下绑定引用仍来自已保存配置。")); }
    finally { setLoading(false); }
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
        <button type="button" className="btn text" data-connector-global-vault-open onClick={() => setVaultOpen(true)}>管理全局保险库</button>
      </div>
      {!configLoaded && <p className="muted" role="status">正在读取已保存配置；若读取失败，请返回接入配置重试。</p>}
      {configLoaded && loading && <p className="muted" role="status">正在读取凭据状态…</p>}
      {error && <div role="alert"><p className="error">{error}</p><button type="button" className="btn text" disabled={loading} onClick={() => void load()}>重试读取状态</button></div>}
      {configLoaded && references.length > 0 && (
        <ul className="connector-credential-reference-list" data-connector-credential-references>
          {references.map((reference) => {
            const row = byId.get(reference.ref);
            return (
              <li key={`${reference.source}:${reference.name}:${reference.ref}`}>
                <div><strong>{reference.name}</strong><p className="muted">{reference.source} · <code>{reference.ref}</code></p></div>
                {reference.source === "保险库" && (
                  <div>
                    <span className={row?.status === "disabled" ? "status-warn" : row?.status === "active" ? "status-ok" : "muted"}>
                      {row ? row.status === "active" ? "可用" : "已停用" : loading ? "状态读取中" : "状态未确认"}
                    </span>
                    {row && <p className="muted">{row.label || "未命名"} · 密钥 v{row.key_version}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {configLoaded && references.length === 0 && <p className="muted">{config?.allow_unauthenticated ? "已保存配置声明该端点允许无鉴权。" : "当前没有绑定凭据引用；请在接入配置中检查鉴权方式。"}</p>}
      <p className="muted">修改绑定请前往<button type="button" className="btn text" onClick={onOpenConfig}>接入配置</button>。全局凭据可能被其他连接器共用，停用或删除会影响全部引用方。</p>
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
