import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { errorMessage } from "../runtimeConnectorUi";

type OAuthConnector = { id: string; label: string; authorized: boolean };

export function McpAccountSettings() {
  const [searchParams] = useSearchParams();
  const [connectors, setConnectors] = useState<OAuthConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setConnectors(await api.userOAuthConnectors()); }
    catch (cause) { setError(errorMessage(cause, "无法读取需要 OAuth 授权的 MCP 连接器。")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const authorize = async (connector: OAuthConnector) => {
    setBusy(connector.id);
    setError("");
    try {
      const result = await api.startConnectorOAuth(connector.id);
      window.location.assign(result.authorization_url);
    } catch (cause) {
      setError(errorMessage(cause, "无法开始授权。请确认登录认证已启用、连接器配置有效且 APP_ORIGIN 正确。"));
      setBusy("");
    }
  };

  return <section className="settings-field-group" data-user-mcp-oauth>
    <h2>MCP 账号授权</h2><p className="muted">每位使用者单独授权。工具调用使用你自己的云账号权限，不会共用管理员的 token。</p>
    {error && <p className="error" role="alert">{error}</p>}
    {searchParams.get("oauth") === "connected" && <p className="runtime-notice" role="status">OAuth 授权已完成，连接器现在可以使用此账号的权限。</p>}
    {searchParams.get("oauth") === "failed" && <p className="error" role="alert">OAuth 授权未完成。请重新授权，并确认阿里云授权页面完成操作。</p>}
    {loading ? <p role="status">正在读取连接器…</p> : connectors.length === 0
      ? <p className="muted">当前没有需要 OAuth 授权的 MCP 连接器。管理员需先在连接器接入配置中启用 Streamable HTTP OAuth。</p>
      : <ul className="settings-mcp-oauth-list">
        {connectors.map((connector) => <li key={connector.id} data-mcp-oauth-connector={connector.id}>
          <div><strong>{connector.label}</strong><p className="muted">{connector.authorized ? "此账号已授权" : "此账号尚未授权"}</p></div>
          <button type="button" className="btn text" disabled={busy !== ""} onClick={() => void authorize(connector)}>
            {busy === connector.id ? "正在跳转…" : connector.authorized ? "重新授权" : "授权此账号"}
          </button>
        </li>)}
      </ul>}
    <button type="button" className="btn text" disabled={loading || busy !== ""} onClick={() => void load()}>刷新</button>
  </section>;
}
