import { Drawer } from "antd";
import WorkspaceSearchInput from "../../components/WorkspaceSearchInput";
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

type ToolDisplayCategory = "读取与查询" | "写入与执行" | "文件与媒体" | "其他";
type PlatformStatusFilter = "all" | "enabled" | "disabled";

export type ConnectorToolsReadOnlyListProps = {
  connectorId: string;
  /** Bump to re-discover; the caller owns the trigger button. */
  requestKey?: number;
  /** false ⇒ the caller triggers the first discovery through `requestKey`. */
  autoLoad?: boolean;
  /** Retains the established name/description search for hub and wizard callers. */
  filterable?: boolean;
  /** Uses compact catalog rows; presentation only, with no policy-writing affordance. */
  compact?: boolean;
  /** Enables detail-page browsing filters and the read-only schema Drawer. */
  detailMode?: boolean;
  /** Raw Schema is platform-internal detail; the hub drawer turns it off. */
  showSchema?: boolean;
  /** Receives a successful live-discovery count, suitable for the parent tab label. */
  onToolCountChange?: (count: number) => void;
  /** Reports the actual network discovery state so an owning trigger can disable itself. */
  onDiscoveringChange?: (discovering: boolean) => void;
};

function friendlyDiscoveryFailure(code: string): string {
  if (code === "runtime_connector_disabled") return "连接器已停用，无法发现工具。请先完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先完成连接草稿。";
  if (code === "runtime_endpoint_invalid") return "尚未填写 Base URL，或端点无效；请先在接入配置中补齐。";
  return remoteFailureMessage(code);
}

function schemaText(schema: Record<string, unknown>) {
  return JSON.stringify(schema, null, 2);
}

/** Display-only grouping inferred from public tool metadata, never from policy or grants. */
function displayCategory(tool: RuntimeToolDefinition): ToolDisplayCategory {
  const text = `${tool.name} ${tool.description || ""}`.toLowerCase();
  if (/(file|media|image|document|upload|download|文件|媒体|图片|文档|上传|下载)/.test(text)) return "文件与媒体";
  if (/(create|update|delete|send|write|upload|import|export|start|stop|change|set|run|execute|创建|更新|删除|发送|写入|导入|导出|启动|停止|变更|执行)/.test(text)) return "写入与执行";
  if (/(get|list|read|search|query|find|fetch|status|查看|读取|查询|搜索|检索|列表|状态)/.test(text)) return "读取与查询";
  return "其他";
}

/**
 * Read-only tool catalog of one connector. Tools are discovered from the live
 * server; risk and enablement come from the platform's saved internal policy and
 * are shown for information only — this surface never writes a grant or a scope.
 * Shared by the detail card, the hub drawer and the setup wizard's third step.
 */
export function ConnectorToolsReadOnlyList({
  connectorId,
  requestKey = 0,
  autoLoad = true,
  filterable = false,
  compact = false,
  detailMode = false,
  showSchema = true,
  onToolCountChange,
  onDiscoveringChange,
}: ConnectorToolsReadOnlyListProps) {
  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [discovering, setDiscovering] = useState(autoLoad);
  const [discovered, setDiscovered] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryCode, setDiscoveryCode] = useState("");
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | ToolDisplayCategory>("all");
  const [riskFilter, setRiskFilter] = useState<"all" | RuntimeToolPolicy["risk"]>("all");
  const [platformStatusFilter, setPlatformStatusFilter] = useState<PlatformStatusFilter>("all");
  const [schemaTool, setSchemaTool] = useState<RuntimeToolDefinition | null>(null);
  const firstRun = useRef(true);
  const schemaTriggerRef = useRef<HTMLButtonElement | null>(null);

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
  useEffect(() => { onDiscoveringChange?.(discovering); }, [discovering, onDiscoveringChange]);
  useEffect(() => {
    if (discovered) onToolCountChange?.(tools.length);
  }, [discovered, onToolCountChange, tools.length]);

  const policyByTool = useMemo(
    () => new Map(policies.map((policy) => [policyKey(policy.connector_id, policy.tool_name), policy])),
    [policies],
  );
  const orphanPolicies = useMemo(() => {
    const known = new Set(tools.map((tool) => tool.name));
    return policies.filter((policy) => !known.has(policy.tool_name));
  }, [policies, tools]);
  const categories = useMemo(
    () => Array.from(new Set(tools.map(displayCategory))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [tools],
  );

  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => tools.filter((tool) => {
    const policy = policyByTool.get(policyKey(connectorId, tool.name));
    const matchesSearch = !needle
      || tool.name.toLowerCase().includes(needle)
      || String(tool.description || "").toLowerCase().includes(needle);
    const matchesCategory = categoryFilter === "all" || displayCategory(tool) === categoryFilter;
    const matchesRisk = riskFilter === "all" || policy?.risk === riskFilter;
    const matchesPlatformStatus = platformStatusFilter === "all"
      || (platformStatusFilter === "enabled" ? policy?.enabled === true : policy?.enabled !== true);
    return matchesSearch && matchesCategory && matchesRisk && matchesPlatformStatus;
  }), [categoryFilter, connectorId, needle, platformStatusFilter, policyByTool, riskFilter, tools]);
  const hasActiveFilters = Boolean(needle)
    || categoryFilter !== "all"
    || riskFilter !== "all"
    || platformStatusFilter !== "all";

  const clearFilters = useCallback(() => {
    setQ("");
    setCategoryFilter("all");
    setRiskFilter("all");
    setPlatformStatusFilter("all");
  }, []);

  const openSchema = useCallback((tool: RuntimeToolDefinition, trigger: HTMLButtonElement) => {
    schemaTriggerRef.current = trigger;
    setSchemaTool(tool);
  }, []);
  const closeSchema = useCallback(() => {
    setSchemaTool(null);
    // Early ESC can close before Drawer has emitted its opening animation event.
    // In that path destroyOnHidden skips afterOpenChange(false), so restore here too.
    requestAnimationFrame(() => schemaTriggerRef.current?.focus({ preventScroll: true }));
  }, []);

  const content = (
    <>
      {detailMode ? (
        <div className="connector-tool-catalog-toolbar" data-connector-tools-toolbar>
          <WorkspaceSearchInput
            className="connector-search connector-drawer-search connector-search-input connector-tool-catalog-toolbar-search"
            data-connector-drawer-search
            placeholder="搜索工具"
            aria-label="搜索工具"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />

          <div className="connector-tool-catalog-filters" role="group" aria-label="工具目录筛选">
            <label className="connector-tool-catalog-filter">
              <span className="connector-tool-catalog-filter-label">展示分类</span>
              <select className="connector-tool-catalog-filter-control" data-connector-tools-category-filter value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | ToolDisplayCategory)}>
                <option value="all">全部分类</option>
                {categories.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
            </label>
            <label className="connector-tool-catalog-filter">
              <span className="connector-tool-catalog-filter-label">平台风险</span>
              <select className="connector-tool-catalog-filter-control" data-connector-tools-risk-filter value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as "all" | RuntimeToolPolicy["risk"])}>
                <option value="all">全部风险</option>
                <option value="L1">L1</option>
                <option value="L2">L2</option>
                <option value="L3">L3</option>
              </select>
            </label>
            <label className="connector-tool-catalog-filter">
              <span className="connector-tool-catalog-filter-label">平台状态</span>
              <select className="connector-tool-catalog-filter-control" data-connector-tools-platform-filter value={platformStatusFilter} onChange={(event) => setPlatformStatusFilter(event.target.value as PlatformStatusFilter)}>
                <option value="all">全部状态</option>
                <option value="enabled">平台已启用</option>
                <option value="disabled">平台未启用</option>
              </select>
            </label>
          </div>

          <div className="connector-tool-catalog-toolbar-meta">
            <p className="muted connector-tool-catalog-category-note">分类仅按工具名称和描述推导，仅供浏览；不构成授权或范围依据。</p>
            {hasActiveFilters && (
              <button type="button" className="btn text connector-tool-catalog-clear-filters" data-connector-tools-clear-filters onClick={clearFilters}>
                清空筛选
              </button>
            )}
          </div>
        </div>
      ) : filterable ? (
        <div className="connector-drawer-toolbar">
          <WorkspaceSearchInput
            className="connector-search connector-drawer-search connector-search-input"
            data-connector-drawer-search
            placeholder="搜索工具"
            aria-label="搜索工具"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {!detailMode && discovered && !discovering && !discoveryError && tools.length > 0 && (
            <p className="muted connector-drawer-count" data-connector-tools-count role="status" aria-live="polite" aria-atomic="true">
              {hasActiveFilters ? `${visible.length} / ${tools.length} 项` : `共 ${tools.length} 项`}
            </p>
          )}
        </div>
      ) : null}

      {detailMode && discovered && (
        <p className="muted connector-tool-catalog-count" data-connector-tools-count role="status" aria-live="polite" aria-atomic="true">
          已发现 {tools.length} 项；数量来源为最近一次服务端工具发现。当前显示 {visible.length} 项。
        </p>
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
        detailMode ? (
          <div className="connector-tool-catalog-filter-empty" data-connector-tools-filter-empty>
            <p className="muted">没有匹配的工具。</p>
            {hasActiveFilters && (
              <button type="button" className="btn text connector-tool-catalog-filter-empty-reset" data-connector-tools-filter-empty-reset onClick={clearFilters}>
                恢复全部工具
              </button>
            )}
          </div>
        ) : <p className="muted">没有匹配的工具。</p>
      )}

      {!policiesLoading && !policiesError && tools.length > 0 && (
        <div className={compact ? "connector-tools-list" : "connector-tools-list connector-tools-list-dense"} data-connector-tools-list>
          {visible.map((tool) => {
            const policy = policyByTool.get(policyKey(connectorId, tool.name));
            const category = displayCategory(tool);
            return compact ? (
              <article className="connector-tool connector-tool-compact" key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}`} data-connector-tool={tool.name}>
                <div className="connector-tool-main">
                  <div className="connector-tool-name"><strong>{tool.name}</strong></div>
                  <p className="muted connector-tool-description" title={tool.description || "无远端描述"}>{tool.description || "无远端描述"}</p>
                </div>
                <div className="connector-tool-compact-meta" aria-label="平台工具信息">
                  <span className="connector-tool-category">{category}</span>
                  {policy
                    ? <span className={"runtime-risk risk-" + policy.risk.toLowerCase()} title={`平台风险 ${policy.risk}`}>{policy.risk}</span>
                    : <span className={detailMode ? "connector-tool-platform-state muted" : "chip"} title="平台风险档未记录">风险档未记录</span>}
                  {policy?.enabled
                    ? <span className={detailMode ? "connector-tool-platform-state status-ok" : "chip chip-ok"} title="平台已启用">已启用</span>
                    : <span className={detailMode ? "connector-tool-platform-state status-warn" : "chip chip-warn"} title="平台未启用，调用默认拒绝">未启用 · 调用默认拒绝</span>}
                </div>
                {detailMode ? (
                  <button
                    type="button"
                    className="btn connector-tool-schema-button"
                    aria-haspopup="dialog"
                    aria-label={`查看 ${tool.name} 的 Schema（只读）`}
                    onClick={(event) => openSchema(tool, event.currentTarget)}
                  >
                    查看 Schema
                  </button>
                ) : (
                  <details className="connector-tool-detail runtime-schema">
                    <summary>展开 Schema（只读）</summary>
                    <code className="runtime-hash">{tool.schema_hash || "未提供来源指纹"}</code>
                    <pre>{schemaText(tool.inputSchema || {})}</pre>
                  </details>
                )}
              </article>
            ) : (
              <details className="connector-tool connector-tool-row" key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}`} data-connector-tool={tool.name}>
                <summary className="connector-tool-row-line" title="展开或收起描述">
                  <svg className="connector-tool-caret" viewBox="0 0 16 16" aria-hidden><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span className="connector-tool-line">
                    <span className="connector-tool-id">{tool.name}</span>
                    <span className="connector-tool-desc">{tool.description || "无远端描述"}</span>
                  </span>
                  <span
                    className={`connector-tool-status ${policy?.enabled ? "is-ok" : "is-warn"}`}
                    title={policy?.enabled ? "平台已启用" : "平台未启用，调用默认拒绝"}
                  >
                    {policy?.enabled
                      ? <svg viewBox="0 0 16 16" aria-hidden><path d="M3.2 8.4l3.1 3.1 6.5-6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      : <svg viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M4.4 11.6l7.2-7.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
                    <span className="sr-only">{policy?.enabled ? "平台已启用" : "平台未启用"}</span>
                  </span>
                </summary>
                {showSchema && (
                  <details className="connector-tool-detail runtime-schema">
                    <summary>展开 Schema（只读）</summary>
                    <code className="runtime-hash">{tool.schema_hash || "未提供来源指纹"}</code>
                    <pre>{schemaText(tool.inputSchema || {})}</pre>
                  </details>
                )}
              </details>
            );
          })}
        </div>
      )}

      {!policiesLoading && !policiesError && discovered && orphanPolicies.length > 0 && (
        <p className="muted" data-connector-tools-orphans>
          另有 {orphanPolicies.length} 条已保存的工具策略不在本次发现结果中（{orphanPolicies.slice(0, 5).map((policy) => policy.tool_name).join("、")}{orphanPolicies.length > 5 ? " 等" : ""}）。它们可能已从服务端移除；如需确认请重新发现。
        </p>
      )}

      {detailMode && (
        <Drawer
          className="connector-detail-tool-schema-drawer"
          destroyOnHidden
          keyboard
          focusable={{ focusTriggerAfterClose: false }}
          open={Boolean(schemaTool)}
          placement="right"
          title={schemaTool ? `工具 Schema · ${schemaTool.name}` : "工具 Schema"}
          width="var(--drawer-w-md)"
          onClose={closeSchema}
          afterOpenChange={(open) => {
            if (!open) requestAnimationFrame(() => schemaTriggerRef.current?.focus({ preventScroll: true }));
          }}
        >
          {schemaTool && (
            <div className="connector-tool-schema-readonly" data-connector-tools-schema-readonly>
              <p>{schemaTool.description || "无远端描述"}</p>
              <dl>
                <div>
                  <dt>schema_hash</dt>
                  <dd><code className="runtime-hash">{schemaTool.schema_hash || "未提供来源指纹"}</code></dd>
                </div>
              </dl>
              <h4>原始 inputSchema（只读）</h4>
              <pre>{schemaText(schemaTool.inputSchema || {})}</pre>
              <p className="muted">仅供核对远端目录返回的说明与 Schema；此处不提供执行、授权或范围操作。</p>
            </div>
          )}
        </Drawer>
      )}
    </>
  );

  return detailMode && compact
    ? <div className="connector-tool-catalog-compact" data-connector-tools-catalog="detail-compact">{content}</div>
    : content;
}

export type ConnectorToolsCardProps = {
  connectorId: string;
  /** Receives the successful discovery count used by the detail page's tools tab. */
  onToolCountChange?: (count: number) => void;
};

export function ConnectorToolsCard({ connectorId, onToolCountChange }: ConnectorToolsCardProps) {
  const [requestKey, setRequestKey] = useState(0);
  const [discovering, setDiscovering] = useState(true);

  return (
    <section className="panel connector-detail-card" data-connector-tools>
      <div className="connector-card-head">
        <div>
          <h3>工具目录</h3>
          <p className="muted">
            该 MCP 服务暴露的工具清单（只读）。数量来自最近一次服务端工具发现；是否可用由平台校验与技能挂载决定，本页不做授权。
          </p>
        </div>
        <button
          type="button"
          className="btn text connector-tools-discover-action"
          data-connector-tools-discover
          disabled={discovering}
          aria-busy={discovering}
          onClick={() => setRequestKey((value) => value + 1)}
        >
          {discovering ? "读取中…" : "重新发现"}
        </button>
      </div>
      <ConnectorToolsReadOnlyList
        connectorId={connectorId}
        requestKey={requestKey}
        filterable
        compact
        detailMode
        onDiscoveringChange={setDiscovering}
        onToolCountChange={onToolCountChange}
      />
    </section>
  );
}
