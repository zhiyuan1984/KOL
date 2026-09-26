import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { useFocusLock } from "../../hooks/useFocusLock";
import {
  errorMessage,
  policyKey,
  type RuntimeToolDefinition,
  type RuntimeToolPolicy,
} from "../../runtimeConnectorUi";
import { ConnectorMark } from "./ConnectorMark";
import { ConnectorScopeCard } from "./ConnectorScopeCard";
import { ConnectorToolRow } from "./ConnectorToolsCard";
import { connectorHref, type ConnectorCardView } from "./entity";

type ScopeNode = {
  id: string;
  parent_id: string | null;
  name: string;
  level: 1 | 2 | 3;
  is_person: boolean;
  status: "matched" | "unmatched";
};

type BatchMode = "all" | "none" | "selected";

function nodeLabel(node: ScopeNode): string {
  if (node.is_person) return "个人";
  if (node.level === 1) return "一级部门";
  if (node.level === 2) return "二级部门";
  return "岗位 / 组";
}

function errorCodeOf(error: unknown): string {
  const payload = (error as { payload?: { code?: unknown; error_code?: unknown } } | null)?.payload;
  if (typeof payload?.code === "string") return payload.code;
  if (typeof payload?.error_code === "string") return payload.error_code;
  return "";
}

/**
 * Hub-side tools drawer: the full tool catalog of one MCP server, plus
 * connector-level and per-tool organization grants. Shares the tool row and
 * scope editor with the detail tools card (single source of behaviour).
 */
export function ConnectorToolsDrawer({ card, users, onClose }: {
  card: ConnectorCardView;
  users: Array<Record<string, unknown>>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusLock({ open: true, rootRef: panelRef, onEscape: onClose, lockBody: true, restore: true });

  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discovered, setDiscovered] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<BatchMode>("selected");
  const [nodes, setNodes] = useState<ScopeNode[]>([]);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    setPoliciesError("");
    try {
      setPolicies(await api.runtimeConnectorPolicies(card.id));
    } catch (cause) {
      setPoliciesError(errorMessage(cause, "无法读取已审批的工具策略"));
    } finally {
      setPoliciesLoading(false);
    }
  }, [card.id]);

  const discover = useCallback(async () => {
    setDiscovering(true);
    setDiscoveryError("");
    try {
      const result = await api.runtimeConnectorDiscovery(card.id);
      setTools(result.tools);
      setDiscovered(true);
    } catch (cause) {
      const code = errorCodeOf(cause);
      setDiscoveryError(code === "runtime_connector_not_configured"
        ? "尚未保存接入配置，无法读取工具目录。"
        : code === "runtime_connector_disabled"
          ? "连接器已停用，无法读取工具目录。"
          : errorMessage(cause, "工具发现失败；请检查已保存的受控配置与服务状态"));
    } finally {
      setDiscovering(false);
    }
  }, [card.id]);

  useEffect(() => { void discover(); }, [discover]);
  useEffect(() => { void loadPolicies(); }, [loadPolicies]);

  useEffect(() => {
    if (!batchOpen) return;
    api.runtimeOrganizationScope(card.id)
      .then((result) => setNodes(result.nodes as ScopeNode[]))
      .catch(() => setNodes([]));
  }, [batchOpen, card.id]);

  const policyByTool = useMemo(
    () => new Map(policies.map((policy) => [policyKey(policy.connector_id, policy.tool_name), policy])),
    [policies],
  );
  const reviewedCount = tools.filter((tool) => policyByTool.has(policyKey(card.id, tool.name))).length;
  const orphanPolicies = useMemo(() => {
    const known = new Set(tools.map((tool) => tool.name));
    return policies.filter((policy) => !known.has(policy.tool_name));
  }, [policies, tools]);
  const policiesReady = !policiesLoading && !policiesError;

  const needle = q.trim().toLowerCase();
  const visible = tools.filter((tool) => !needle
    || tool.name.toLowerCase().includes(needle)
    || String(tool.description || "").toLowerCase().includes(needle));

  const toggleSelect = (name: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleNode = (id: string) =>
    setNodeIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  const applyBatch = async () => {
    if (!selected.size) return;
    if (batchMode === "selected" && !nodeIds.length) {
      setBatchError("请选择至少一个部门、岗位或个人，或改为「所有员工 / 无人」。");
      return;
    }
    setBatchBusy(true);
    setBatchError("");
    setNotice("");
    try {
      for (const name of selected) {
        await api.saveRuntimeToolScope(card.id, name, batchMode === "selected" ? nodeIds : [], batchMode === "all");
      }
      setNotice(batchMode === "none"
        ? `已为 ${selected.size} 个工具移除范围授权。`
        : `已为 ${selected.size} 个工具保存范围授权。`);
      setSelected(new Set());
      setBatchOpen(false);
      setNodeIds([]);
      setRefreshKey((value) => value + 1);
    } catch (cause) {
      setBatchError(errorMessage(cause, "批量授权未保存"));
    } finally {
      setBatchBusy(false);
    }
  };

  const renderNode = (node: ScopeNode) => {
    const children = nodes.filter((child) => child.parent_id === node.id);
    return (
      <li key={node.id} className="connector-scope-node">
        <label>
          <input
            type="checkbox"
            checked={nodeIds.includes(node.id)}
            disabled={batchBusy}
            data-connector-batch-node={node.id}
            onChange={() => toggleNode(node.id)}
          />
          <span><small>{nodeLabel(node)}</small><strong>{node.name}</strong></span>
        </label>
        {children.length > 0 && <ul>{children.map(renderNode)}</ul>}
      </li>
    );
  };
  const topLevel = nodes.filter((node) => !node.parent_id);

  return createPortal(
    <div className="connector-drawer-layer" data-connector-tools-drawer>
      <div className="connector-drawer-backdrop" onClick={onClose} />
      <aside ref={panelRef} className="connector-drawer" role="dialog" aria-modal="true" aria-label={`${card.label} · 工具`}>
        <header className="connector-drawer-head">
          <div className="connector-drawer-title">
            <ConnectorMark id={card.id} label={card.label} iconUrl={card.iconUrl} />
            <div>
              <h2>{card.label} · 工具</h2>
              <p className="muted" data-connector-drawer-counts>
                {discovered
                  ? `共 ${tools.length} 个工具（已审阅 ${reviewedCount} · 未审阅 ${tools.length - reviewedCount}）`
                  : "正在读取工具目录…"}
              </p>
            </div>
          </div>
          <div className="connector-drawer-actions">
            <button type="button" className="btn sm" data-connector-drawer-discover disabled={discovering} onClick={() => void discover()}>
              {discovering ? "发现中…" : "重新发现"}
            </button>
            <button type="button" className="icon-btn" aria-label="关闭" data-connector-drawer-close onClick={onClose}>
              <svg viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </div>
        </header>

        <div className="connector-drawer-body">
          <p className="muted connector-drawer-note">授权不等于审阅：未审阅工具仍不可调用；任何授权只在工具已审阅启用后生效。</p>
          {notice && <p className="runtime-notice" role="status" data-connector-drawer-notice>{notice}</p>}

          <details className="connector-drawer-scope" data-connector-drawer-default-scope>
            <summary>
              <b>本 MCP 的可用范围</b>
              <span className="muted">按部门 / 个人授予默认访问（read / write）；工具级授权沿用它，并可另行收窄</span>
            </summary>
            <ConnectorScopeCard connectorId={card.id} users={users} />
          </details>

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

          {policiesError && (
            <div className="runtime-state runtime-state-error" role="alert">
              <strong>无法读取已有的工具审批</strong>
              <span>{policiesError}</span>
              <button type="button" className="btn sm" onClick={() => void loadPolicies()}>重试读取审批</button>
            </div>
          )}

          {discoveryError && (
            <div className="runtime-state runtime-state-error" role="alert" data-connector-drawer-error>
              <strong>工具目录不可用</strong>
              <span>{discoveryError}</span>
              <div className="connector-drawer-error-actions">
                <button type="button" className="btn sm" disabled={discovering} onClick={() => void discover()}>重试发现</button>
                <Link className="btn sm" to={connectorHref(card.id)}>去配置</Link>
              </div>
            </div>
          )}

          {discovered && !discovering && !discoveryError && !tools.length && (
            <p className="muted" data-connector-drawer-empty>该 MCP 当前没有返回任何工具。</p>
          )}
          {discovered && !discovering && !discoveryError && tools.length > 0 && !visible.length && (
            <p className="muted">没有匹配的工具。</p>
          )}

          {policiesReady && (
            <ul className="connector-drawer-tools">
              {visible.map((tool) => {
                const policy = policyByTool.get(policyKey(card.id, tool.name));
                return (
                  <li
                    key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}:${refreshKey}`}
                    className="connector-drawer-tool"
                    data-connector-drawer-tool={tool.name}
                  >
                    <label className="connector-drawer-pick">
                      <input
                        type="checkbox"
                        checked={selected.has(tool.name)}
                        aria-label={`选择工具 ${tool.name}`}
                        data-connector-drawer-pick={tool.name}
                        onChange={() => toggleSelect(tool.name)}
                      />
                    </label>
                    <ConnectorToolRow
                      connectorId={card.id}
                      users={users}
                      tool={tool}
                      policy={policy}
                      onSaved={(saved) => {
                        setPolicies((current) => [
                          ...current.filter((item) => policyKey(item.connector_id, item.tool_name) !== policyKey(saved.connector_id, saved.tool_name)),
                          saved,
                        ]);
                        setNotice(`工具“${saved.tool_name}”的审批策略已保存。`);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {policiesReady && discovered && orphanPolicies.length > 0 && (
            <p className="muted" data-connector-drawer-orphans>
              另有 {orphanPolicies.length} 条已保存的工具审批不在本次发现结果中（{orphanPolicies.slice(0, 5).map((policy) => policy.tool_name).join("、")}{orphanPolicies.length > 5 ? " 等" : ""}）；如需确认请重新发现。
            </p>
          )}
        </div>

        {selected.size > 0 && (
          <footer className="connector-drawer-foot" data-connector-drawer-batch>
            {!batchOpen ? (
              <>
                <span>已选 {selected.size} 个工具</span>
                <div className="connector-drawer-foot-actions">
                  <button type="button" className="btn sm" onClick={() => setSelected(new Set())}>取消选择</button>
                  <button type="button" className="btn work" data-connector-batch-open onClick={() => setBatchOpen(true)}>授权给…</button>
                </div>
              </>
            ) : (
              <div className="connector-drawer-batch">
                <label className="field">授权对象
                  <select value={batchMode} disabled={batchBusy} data-connector-batch-mode onChange={(event) => setBatchMode(event.target.value as BatchMode)}>
                    <option value="all">所有员工（仍需连接器授权）</option>
                    <option value="none">无人（移除工具范围授权）</option>
                    <option value="selected">指定部门、岗位或个人</option>
                  </select>
                </label>
                {batchMode === "selected" && (topLevel.length ? (
                  <ul className="runtime-scope-tree connector-batch-tree">{topLevel.map(renderNode)}</ul>
                ) : (
                  <p className="muted">组织树还是空的：先在上方「本 MCP 的可用范围」里添加一级部门或绑定个人。</p>
                ))}
                {batchError && <p className="error" role="alert">{batchError}</p>}
                <div className="connector-drawer-foot-actions">
                  <button type="button" className="btn sm" disabled={batchBusy} onClick={() => setBatchOpen(false)}>返回</button>
                  <button type="button" className="btn work" data-connector-batch-apply disabled={batchBusy} onClick={() => void applyBatch()}>
                    {batchBusy ? "保存中…" : `应用到 ${selected.size} 个工具`}
                  </button>
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}
