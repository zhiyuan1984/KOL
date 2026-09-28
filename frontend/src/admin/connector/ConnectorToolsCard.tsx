import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { sanitizeAdminText } from "../../adminGovernance";
import {
  errorMessage,
  policyKey,
  remoteFailureMessage,
  type RuntimeToolDefinition,
  type RuntimeToolPolicy,
} from "../../runtimeConnectorUi";
import { errorCodeOf } from "./connectorSetup";

function friendlyDiscoveryFailure(code: string): string {
  if (code === "runtime_connector_disabled") return "连接器已停用，无法发现工具。请先完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先完成连接草稿。";
  if (code === "runtime_endpoint_invalid") return "尚未填写 Base URL，或端点无效；请先在接入配置中补齐。";
  return remoteFailureMessage(code);
}

function schemaText(schema: Record<string, unknown>) {
  return JSON.stringify(schema, null, 2);
}

/**
 * Read-only tool catalog of one connector. Tools are discovered from the live
 * server; risk and enablement come from the platform's saved internal policy and
 * are shown for information only — this surface never writes a grant or a scope.
 * Shared by the detail card, the hub drawer and the setup wizard's third step.
 */
export function ConnectorToolsReadOnlyList({ connectorId, requestKey = 0, autoLoad = true, filterable = false }: {
  connectorId: string;
  /** Bump to re-discover; the caller owns the trigger button. */
  requestKey?: number;
  /** false ⇒ the caller triggers the first discovery through `requestKey`. */
  autoLoad?: boolean;
  filterable?: boolean;
}) {
  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [discovering, setDiscovering] = useState(autoLoad);
  const [discovered, setDiscovered] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryCode, setDiscoveryCode] = useState("");
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const [q, setQ] = useState("");
  const firstRun = useRef(true);

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    setPoliciesError("");
    try {
      setPolicies(await api.runtimeConnectorPolicies(connectorId));
    } catch (cause) {
      setPoliciesError(errorMessage(cause, "无法读取已有的工具策略"));
    } finally {
      setPoliciesLoading(false);
    }
  }, [connectorId]);

  const discover = useCallback(async () => {
    setDiscovering(true);
    setDiscoveryError("");
    setDiscoveryCode("");
    try {
      const result = await api.runtimeConnectorDiscovery(connectorId);
      setTools(result.tools);
      setDiscovered(true);
    } catch (cause) {
      const code = errorCodeOf(cause);
      setDiscoveryCode(code);
      setDiscoveryError(friendlyDiscoveryFailure(code) || errorMessage(cause, "工具发现失败；请检查已保存的受控配置与服务状态"));
    } finally {
      setDiscovering(false);
    }
  }, [connectorId]);

  useEffect(() => { void loadPolicies(); }, [loadPolicies]);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (!autoLoad) return;
    }
    void discover();
  }, [discover, autoLoad, requestKey]);

  const policyByTool = useMemo(
    () => new Map(policies.map((policy) => [policyKey(policy.connector_id, policy.tool_name), policy])),
    [policies],
  );
  const orphanPolicies = useMemo(() => {
    const known = new Set(tools.map((tool) => tool.name));
    return policies.filter((policy) => !known.has(policy.tool_name));
  }, [policies, tools]);

  const needle = q.trim().toLowerCase();
  const visible = tools.filter((tool) => !needle
    || tool.name.toLowerCase().includes(needle)
    || String(tool.description || "").toLowerCase().includes(needle));

  return (
    <>
      {filterable && (
        <label className="connector-search connector-drawer-search">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M16 16.4 20 20.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="connector-search-input"
            data-connector-drawer-search
            placeholder="搜索工具"
            aria-label="搜索工具"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>
      )}

      {discovering && <p className="muted" role="status" data-connector-tools-loading>正在读取工具清单…</p>}

      {discoveryError && (
        <div className="runtime-state runtime-state-error" role="alert" data-connector-tools-error>
          <strong>工具发现未完成</strong>
          <span>{sanitizeAdminText(discoveryError)}{discoveryCode ? `（错误码：${sanitizeAdminText(discoveryCode)}）` : ""}</span>
        </div>
      )}

      {discoveryError && tools.length > 0 && (
        <p className="muted" data-connector-tools-stale>以下清单来自上一次成功的发现结果；本次发现未完成。</p>
      )}

      {policiesError && (
        <div className="runtime-state runtime-state-error" role="alert" data-connector-tools-policies-error>
          <strong>无法读取已有的工具策略</strong>
          <span>{sanitizeAdminText(policiesError)}</span>
          <button type="button" className="btn sm" data-connector-tools-policies-retry disabled={policiesLoading} onClick={() => void loadPolicies()}>重试读取策略</button>
        </div>
      )}

      {discovered && !discovering && !discoveryError && !tools.length && (
        <p className="muted" data-connector-tools-empty>该 MCP 当前没有返回任何工具。</p>
      )}
      {discovered && !discovering && !discoveryError && tools.length > 0 && !visible.length && (
        <p className="muted">没有匹配的工具。</p>
      )}

      {!policiesLoading && !policiesError && tools.length > 0 && (
        <div className="connector-tools-list" data-connector-tools-list>
          {visible.map((tool) => {
            const policy = policyByTool.get(policyKey(connectorId, tool.name));
            return (
              <article className="connector-tool" key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}`} data-connector-tool={tool.name}>
                <div className="connector-tool-main">
                  <div className="connector-tool-name">
                    <strong>{tool.name}</strong>
                    {policy
                      ? <span className={"runtime-risk risk-" + policy.risk.toLowerCase()}>{policy.risk}</span>
                      : <span className="chip">风险档未记录</span>}
                    {policy?.enabled
                      ? <span className="chip chip-ok">平台已启用</span>
                      : <span className="chip chip-warn">未启用 · 调用默认拒绝</span>}
                  </div>
                  <p className="muted">{tool.description || "无远端描述"}</p>
                </div>
                <details className="connector-tool-detail runtime-schema">
                  <summary>展开 Schema（只读）</summary>
                  <code className="runtime-hash">{tool.schema_hash || "未提供来源指纹"}</code>
                  <pre>{schemaText(tool.inputSchema || {})}</pre>
                  <p className="muted">风险档由平台在测试时按 07 规则自动推导登记；是否可用由平台校验与技能挂载决定，本页不提供授权或范围操作。</p>
                </details>
              </article>
            );
          })}
        </div>
      )}

      {!policiesLoading && !policiesError && discovered && orphanPolicies.length > 0 && (
        <p className="muted" data-connector-tools-orphans>
          另有 {orphanPolicies.length} 条已保存的工具策略不在本次发现结果中（{orphanPolicies.slice(0, 5).map((policy) => policy.tool_name).join("、")}{orphanPolicies.length > 5 ? " 等" : ""}）。它们可能已从服务端移除；如需确认请重新发现。
        </p>
      )}
    </>
  );
}

export function ConnectorToolsCard({ connectorId }: { connectorId: string }) {
  const [requestKey, setRequestKey] = useState(0);

  return (
    <section className="panel connector-detail-card" data-connector-tools>
      <div className="connector-card-head">
        <div>
          <h3>接口</h3>
          <p className="muted">
            该 MCP 服务暴露的工具清单（只读）。是否可用由平台校验与技能挂载决定，本页不做授权。
          </p>
        </div>
        <button type="button" className="btn" data-connector-tools-discover onClick={() => setRequestKey((value) => value + 1)}>
          重新发现
        </button>
      </div>
      <ConnectorToolsReadOnlyList connectorId={connectorId} requestKey={requestKey} />
    </section>
  );
}
