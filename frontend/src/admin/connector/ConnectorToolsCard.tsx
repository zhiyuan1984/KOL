import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { sanitizeAdminText } from "../../adminGovernance";
import {
  errorMessage,
  policyKey,
  versionConflictMessage,
  type RuntimeToolDefinition,
  type RuntimeToolPolicy,
} from "../../runtimeConnectorUi";

type ApprovalRisk = "L1" | "L2" | "L3";
type ApprovalAccess = "read" | "write";

const RISK_OPTIONS: Array<{ value: ApprovalRisk; label: string }> = [
  { value: "L1", label: "L1 · 只读" },
  { value: "L2", label: "L2 · 草稿" },
  { value: "L3", label: "L3 · 正式动作" },
];

function errorCodeOf(error: unknown): string {
  const payload = (error as { payload?: unknown } | null)?.payload;
  for (const candidate of [payload, (payload as { detail?: unknown } | null)?.detail]) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { code?: unknown; error_code?: unknown };
    if (typeof record.code === "string" && record.code) return record.code;
    if (typeof record.error_code === "string" && record.error_code) return record.error_code;
  }
  return "";
}

function friendlyDiscoveryFailure(code: string): string {
  if (code === "runtime_connector_disabled") return "连接器已停用，无法发现工具。请在详情完成验证后再启用。";
  if (code === "runtime_connector_not_configured") return "尚未保存接入配置。请先完成连接草稿。";
  return "";
}

function schemaText(schema: Record<string, unknown>) {
  return JSON.stringify(schema, null, 2);
}

function ConnectorToolRow({
  connectorId,
  users,
  tool,
  policy,
  onSaved,
}: {
  connectorId: string;
  users: Array<Record<string, unknown>>;
  tool: RuntimeToolDefinition;
  policy?: RuntimeToolPolicy;
  onSaved: (row: RuntimeToolPolicy) => void;
}) {
  const [enabled, setEnabled] = useState(Boolean(policy?.enabled));
  const [risk, setRisk] = useState<ApprovalRisk>(policy?.risk || "L1");
  const [access, setAccess] = useState<ApprovalAccess>(policy?.access || "read");
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
    <article className="connector-tool" data-connector-tool={tool.name} data-risk={risk}>
      <div className="connector-tool-main">
        <div className="connector-tool-name">
          <strong>{tool.name}</strong>
          <span className={"runtime-risk risk-" + risk.toLowerCase()}>{risk}</span>
          {policy?.enabled
            ? <span className="chip chip-ok">已审阅 · 启用</span>
            : policy
              ? <span className="chip">已审阅 · 未启用</span>
              : <span className="chip chip-warn">未审阅 · 默认拒绝</span>}
        </div>
        <p className="muted">{tool.description || "无远端描述"}</p>
      </div>
      <details className="connector-tool-detail runtime-schema">
        <summary>展开 Schema 与审批</summary>
        <code className="runtime-hash">{tool.schema_hash || "未提供来源指纹"}</code>
        <pre>{schemaText(tool.inputSchema || {})}</pre>
        <div className="runtime-tool-controls">
          <label className="check"><input type="checkbox" data-connector-tool-enabled checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> 审批并启用</label>
          <label className="field runtime-compact-field">风险
            <select data-connector-tool-risk value={risk} onChange={(event) => setRisk(event.target.value as ApprovalRisk)}>
              {RISK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field runtime-compact-field">连接器权限
            <select data-connector-tool-access value={access} onChange={(event) => setAccess(event.target.value as ApprovalAccess)}>
              <option value="read">read</option>
              <option value="write">write</option>
            </select>
          </label>
          {risk === "L3" && <p className="runtime-l3-notice">L3 不会因这里启用而直接可调用；它仍必须经过通用确认、版本与 Gateway 闸门。</p>}
          {error && <p className="error runtime-inline-error" role="alert">{conflict || sanitizeAdminText(error)}</p>}
          <button className="btn" type="button" data-connector-tool-save disabled={busy || !tool.schema_hash} onClick={() => void save()}>
            {busy ? "保存中…" : policy ? "保存审批" : "首次审批"}
          </button>
        </div>
      </details>
      {policy && <RuntimeToolScopeEditor connectorId={connectorId} tool={tool} users={users} />}
    </article>
  );
}

type RuntimeScopeNode = {
  id: string;
  parent_id: string | null;
  name: string;
  level: 1 | 2 | 3;
  is_person: boolean;
  local_user_id: string | null;
  status: "matched" | "unmatched";
};
type ScopeMode = "unset" | "none" | "all" | "selected";

function RuntimeToolScopeEditor({ connectorId, tool, users }: { connectorId: string; tool: RuntimeToolDefinition; users: Array<Record<string, unknown>> }) {
  const [nodes, setNodes] = useState<RuntimeScopeNode[]>([]);
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ScopeMode>("unset");
  const [scopeConfigured, setScopeConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [nodeLevel, setNodeLevel] = useState<1 | 2 | 3>(1);
  const [nodeKind, setNodeKind] = useState<"position" | "person">("position");
  const [parentId, setParentId] = useState("");
  const [userId, setUserId] = useState("");
  const activeUsers = users.filter((user) => user.active !== false && user.active !== 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [organization, scope] = await Promise.all([
        api.runtimeOrganizationScope(connectorId),
        api.runtimeToolScope(connectorId, tool.name),
      ]);
      setNodes(organization.nodes);
      setNodeIds(scope.node_ids);
      setScopeConfigured(scope.scope_configured);
      setMode(scope.all ? "all" : scope.node_ids.length ? "selected" : scope.scope_configured ? "none" : "unset");
    } catch (cause) {
      setError(errorMessage(cause, "无法读取此工具的范围授权"));
    } finally {
      setLoading(false);
    }
  }, [connectorId, tool.name]);

  useEffect(() => { void load(); }, [load]);

  const addNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const person = nodeLevel === 3 && nodeKind === "person";
    if ((!person && !nodeName.trim()) || (nodeLevel > 1 && !parentId) || (person && !userId)) {
      setError("请填写名称或选择个人，并为二级部门、岗位或个人选择上级。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.addRuntimeOrganizationScopeNode(connectorId, {
        level: nodeLevel,
        ...(nodeLevel > 1 ? { parent_id: parentId } : {}),
        ...(person ? { user_id: userId } : { name: nodeName.trim() }),
      });
      setNodes(result.nodes);
      setScopeConfigured(true);
      setMode((current) => current === "unset" ? "selected" : current);
      setNodeName("");
      setParentId("");
      setUserId("");
      setNotice("组织范围节点已添加。");
    } catch (cause) {
      setError(errorMessage(cause, "新增范围节点失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveScope = async () => {
    if (mode === "unset") return;
    if (mode === "selected" && !nodeIds.length) {
      setError("请选择至少一个部门、岗位或个人，或改为无人可用。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.saveRuntimeToolScope(connectorId, tool.name, mode === "selected" ? nodeIds : [], mode === "all");
      setNotice(mode === "none" ? "已移除该工具的范围授权。" : "工具范围授权已保存。");
    } catch (cause) {
      setError(errorMessage(cause, "工具范围授权未保存"));
    } finally {
      setBusy(false);
    }
  };

  const toggleNode = (id: string) => setNodeIds((current) => current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id]);
  const renderNode = (node: RuntimeScopeNode) => {
    const label = node.is_person
      ? node.status === "matched" ? "个人" : "个人（未匹配）"
      : node.level === 1 ? "一级部门" : node.level === 2 ? "二级部门" : "岗位";
    return (
      <li key={node.id} className="runtime-scope-node">
        <label><input type="checkbox" checked={nodeIds.includes(node.id)} onChange={() => toggleNode(node.id)} />
          <span><small>{label}</small><strong>{node.name}</strong></span>
        </label>
        {nodes.some((child) => child.parent_id === node.id) && <ul>{nodes.filter((child) => child.parent_id === node.id).map(renderNode)}</ul>}
      </li>
    );
  };
  const topLevel = nodes.filter((node) => !node.parent_id);

  return (
    <details className="runtime-tool-scope" data-runtime-tool-scope={tool.name}>
      <summary>使用范围 · {mode === "unset" ? "沿用连接器授权" : mode === "all" ? "所有已授权员工" : mode === "none" ? "无人" : `${nodeIds.length} 个范围节点`}</summary>
      {loading ? <p className="muted" role="status">正在读取范围节点…</p> : (
        <div className="runtime-scope-content">
          <p className="muted">范围在每次调用时按当前身份重新校验；“所有人”仅覆盖已获连接器权限的有效账号，不授予管理员隐式调用权。</p>
          <label className="field">授权对象
            <select value={mode} onChange={(event) => setMode(event.target.value as ScopeMode)} disabled={busy}>
              {!scopeConfigured && <option value="unset">沿用连接器授权（未设工具范围）</option>}
              <option value="none">无人（移除工具范围授权）</option>
              <option value="all">所有员工（仍需连接器授权）</option>
              <option value="selected">指定部门、岗位或个人</option>
            </select>
          </label>
          {mode === "unset" && <p className="muted">尚未启用此连接器的组织范围治理。先配置工具范围后，才会按部门、岗位或个人限制调用。</p>}
          {mode === "selected" && <>
            <form className="runtime-scope-add" onSubmit={(event) => void addNode(event)}>
              <label className="field">新增范围节点
                <select value={nodeLevel} onChange={(event) => { setNodeLevel(Number(event.target.value) as 1 | 2 | 3); setParentId(""); }} disabled={busy}>
                  <option value={1}>一级部门</option><option value={2}>二级部门</option><option value={3}>岗位或个人</option>
                </select>
              </label>
              {nodeLevel === 3 && <label className="field">节点类型
                <select value={nodeKind} onChange={(event) => setNodeKind(event.target.value as "position" | "person")} disabled={busy}>
                  <option value="position">岗位</option><option value="person">个人账号</option>
                </select>
              </label>}
              {nodeLevel > 1 && <label className="field">上级
                <select value={parentId} onChange={(event) => setParentId(event.target.value)} disabled={busy}>
                  <option value="">选择{nodeLevel === 2 ? "一级部门" : "二级部门"}</option>
                  {nodes.filter((node) => node.level === nodeLevel - 1).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                </select>
              </label>}
              {nodeLevel === 3 && nodeKind === "person" ? <label className="field">个人账号
                <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={busy}>
                  <option value="">选择有效账号</option>
                  {activeUsers.map((user) => <option key={String(user.id)} value={String(user.id)}>{String(user.name || user.username || user.id)}{user.position ? ` · ${String(user.position)}` : ""}</option>)}
                </select>
                {!activeUsers.length && <small className="muted">没有可授权的有效账号。</small>}
              </label> : <label className="field">名称<input value={nodeName} onChange={(event) => setNodeName(event.target.value)} maxLength={240} disabled={busy} /></label>}
              <button className="btn ghost sm" disabled={busy}>{busy ? "保存中…" : "添加节点"}</button>
            </form>
            {topLevel.length ? <ul className="runtime-scope-tree">{topLevel.map(renderNode)}</ul> : <p className="muted">还没有范围节点；先添加一级部门。</p>}
            <p className="muted">部门授权覆盖其下已配置的岗位与个人；个人节点只匹配所选账号。岗位按账号岗位名称匹配，本地账号没有部门字段；要精确限制部门成员，请在相应部门下配置个人节点。</p>
          </>}
          {error && <p className="error" role="alert">{sanitizeAdminText(error)}</p>}
          {notice && <p className="runtime-notice" role="status">{notice}</p>}
          {mode !== "unset" && <button type="button" className="btn sm" onClick={() => void saveScope()} disabled={busy}>
            {busy ? "保存中…" : mode === "none" ? "移除范围授权" : "保存范围授权"}
          </button>}
        </div>
      )}
    </details>
  );
}

export function ConnectorToolsCard({ connectorId, users }: { connectorId: string; users: Array<Record<string, unknown>> }) {
  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveredOnce, setDiscoveredOnce] = useState(false);
  const [discoveryError, setDiscoveryError] = useState("");
  const [discoveryCode, setDiscoveryCode] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [policiesLoading, setPoliciesLoading] = useState(true);
  const [policiesError, setPoliciesError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    setPoliciesError("");
    try {
      setPolicies(await api.runtimeConnectorPolicies(connectorId));
    } catch (cause) {
      setPoliciesError(errorMessage(cause, "无法读取已审批的工具策略"));
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
      setAuthorization(result.authorization);
      setDiscoveredOnce(true);
      setNotice(`发现了 ${result.tools.length} 个工具。它们均未自动获批或挂载。`);
    } catch (cause) {
      const code = errorCodeOf(cause);
      setDiscoveryCode(code);
      setDiscoveryError(friendlyDiscoveryFailure(code) || errorMessage(cause, "工具发现失败；请检查已保存的受控配置与服务状态"));
    } finally {
      setDiscovering(false);
    }
  }, [connectorId]);

  useEffect(() => { void discover(); }, [discover]);
  useEffect(() => { void loadPolicies(); }, [loadPolicies]);

  const policyByTool = useMemo(() => new Map(policies.map((policy) => [policyKey(policy.connector_id, policy.tool_name), policy])), [policies]);
  const orphanPolicies = useMemo(() => {
    const discovered = new Set(tools.map((tool) => tool.name));
    return policies.filter((policy) => !discovered.has(policy.tool_name));
  }, [policies, tools]);

  const policiesReady = !policiesLoading && !policiesError;
  const showEmpty = policiesReady && discoveredOnce && !discovering && !discoveryError && !tools.length;
  const showLoadingNote = !policiesError && (policiesLoading || (discovering && !discoveredOnce));

  return (
    <section className="panel connector-detail-card" data-connector-tools>
      <div className="connector-card-head">
        <div>
          <h3>接口</h3>
          <p className="muted">
            该 MCP 服务暴露的工具清单。未审阅的工具默认拒绝；Schema 或描述变化需要重新审阅。
          </p>
        </div>
        <button type="button" className="btn" data-connector-tools-discover disabled={discovering} onClick={() => void discover()}>
          {discovering ? "发现中…" : "重新发现"}
        </button>
      </div>

      {showLoadingNote && <p className="muted" role="status" data-connector-tools-loading>正在读取接口清单与已有审批…</p>}

      {discoveryError && (
        <div className="runtime-state runtime-state-error" role="alert" data-connector-tools-error>
          <strong>工具发现未完成</strong>
          <span>
            {sanitizeAdminText(discoveryError)}{discoveryCode ? `（错误码：${sanitizeAdminText(discoveryCode)}）` : ""}
          </span>
          <button type="button" className="btn sm" data-connector-tools-retry disabled={discovering} onClick={() => void discover()}>重试发现</button>
        </div>
      )}

      {discoveryError && tools.length > 0 && (
        <p className="muted" data-connector-tools-stale>以下清单来自上一次成功的发现结果；本次发现未完成，请重新发现后再逐项审阅。</p>
      )}

      {policiesError && (
        <div className="runtime-state runtime-state-error" role="alert" data-connector-tools-policies-error>
          <strong>无法读取已有的工具审批</strong>
          <span>{sanitizeAdminText(policiesError)}</span>
          <button type="button" className="btn sm" data-connector-tools-policies-retry disabled={policiesLoading} onClick={() => void loadPolicies()}>重试读取审批</button>
        </div>
      )}

      {notice && <p className="runtime-notice" role="status" data-connector-tools-notice>{notice}</p>}
      {authorization && <p className="runtime-discovery-note">{authorization}</p>}

      {showEmpty && (
        <p className="muted" data-connector-tools-empty>
          尚未发现工具。点击“重新发现”后先审阅 Schema，再逐项保存风险与启用状态。
        </p>
      )}

      {policiesReady && discoveredOnce && orphanPolicies.length > 0 && (
        <p className="muted" data-connector-tools-orphans>
          另有 {orphanPolicies.length} 条已保存的工具审批不在本次发现结果中（{orphanPolicies.slice(0, 5).map((policy) => policy.tool_name).join("、")}{orphanPolicies.length > 5 ? " 等" : ""}）。它们可能已从服务端移除；如需确认请重新发现。
        </p>
      )}

      {policiesReady && (
        <div className="connector-tools-list" data-connector-tools-list>
          {tools.map((tool) => {
            const policy = policyByTool.get(policyKey(connectorId, tool.name));
            return (
              <ConnectorToolRow
                key={`${tool.name}:${tool.schema_hash}:${policy?.version ?? 0}`}
                connectorId={connectorId}
                users={users}
                tool={tool}
                policy={policy}
                onSaved={(saved) => {
                  setPolicies((current) => [...current.filter((item) => policyKey(item.connector_id, item.tool_name) !== policyKey(saved.connector_id, saved.tool_name)), saved]);
                  setNotice(`工具“${saved.tool_name}”的审批策略已保存。Skill 仍需单独精确挂载。`);
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
