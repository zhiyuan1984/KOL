import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { errorMessage, type OrganizationUnitsResponse, type RuntimeConnectorScopeMode } from "../../runtimeConnectorUi";
import { friendlyScopeFailure } from "./entity";

type ScopeNode = {
  id: string;
  parent_id: string | null;
  name: string;
  level: 1 | 2 | 3;
  is_person: boolean;
  external_id: string;
  local_user_id: string | null;
  status: "matched" | "unmatched";
};

type Access = "read" | "write";

function nodeLabel(node: ScopeNode): string {
  if (node.is_person) return "个人";
  if (node.level === 1) return "一级部门";
  if (node.level === 2) return "二级部门";
  return "岗位 / 组";
}

export function ConnectorScopeCard({ connectorId, users }: { connectorId: string; users: Array<Record<string, unknown>> }) {
  const [mode, setMode] = useState<RuntimeConnectorScopeMode>("unset");
  const [bindings, setBindings] = useState<Record<string, Access>>({});
  const [nodes, setNodes] = useState<ScopeNode[]>([]);
  const [coverage, setCoverage] = useState({ users: 0, read: 0, write: 0 });
  const [registry, setRegistry] = useState<OrganizationUnitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nodeLevel, setNodeLevel] = useState<1 | 2 | 3>(1);
  const [nodeKind, setNodeKind] = useState<"group" | "position" | "person">("group");
  const [parentId, setParentId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [manualName, setManualName] = useState("");
  const [personId, setPersonId] = useState("");

  const activeUsers = useMemo(() => users.filter((user) => user.active !== false && user.active !== 0), [users]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [scope, organization, units] = await Promise.allSettled([
      api.runtimeConnectorScope(connectorId),
      api.runtimeOrganizationScope(connectorId),
      api.adminOrganizationUnits(),
    ]);
    if (scope.status === "fulfilled") {
      setMode(scope.value.mode);
      setCoverage(scope.value.coverage);
      setBindings(Object.fromEntries(scope.value.bindings.map((binding) => [binding.node_id, binding.access])));
    } else {
      setError(errorMessage(scope.reason, "无法读取连接器范围"));
    }
    if (organization.status === "fulfilled") setNodes(organization.value.nodes);
    setRegistry(units.status === "fulfilled" ? units.value : null);
    setLoading(false);
  }, [connectorId]);

  useEffect(() => { void load(); }, [load]);

  const levelCandidates = useMemo(() => {
    if (!registry) return [];
    return registry.units.filter((unit) => unit.level === nodeLevel);
  }, [registry, nodeLevel]);

  const addNode = async () => {
    const isPerson = nodeLevel === 3 && nodeKind === "person";
    const name = nodeLevel === 3 && nodeKind !== "person"
      ? (nodeKind === "group" && candidateId && candidateId !== "__manual"
        ? levelCandidates.find((unit) => unit.id === candidateId)?.display_name || ""
        : manualName.trim())
      : (candidateId && candidateId !== "__manual"
        ? levelCandidates.find((unit) => unit.id === candidateId)?.display_name || ""
        : manualName.trim());
    if (isPerson && !personId) {
      setError("请选择有效账号。");
      return;
    }
    if (!isPerson && !name) {
      setError("请填写名称或选择已登记部门。");
      return;
    }
    if (nodeLevel > 1 && !parentId) {
      setError(`请选择上级${nodeLevel === 2 ? "一级部门" : "二级部门 / 组"}。`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const registryId = candidateId && candidateId !== "__manual" ? candidateId : "";
      const result = await api.addRuntimeOrganizationScopeNode(connectorId, {
        level: nodeLevel,
        ...(nodeLevel > 1 ? { parent_id: parentId } : {}),
        ...(isPerson ? { user_id: personId } : { name, ...(registryId ? { external_id: registryId } : {}) }),
      });
      setNodes(result.nodes as ScopeNode[]);
      setCandidateId("");
      setManualName("");
      setPersonId("");
      setNotice("范围节点已添加；勾选并保存后生效。");
    } catch (cause) {
      setError(errorMessage(cause, "新增范围节点失败"));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const payload = Object.entries(bindings).map(([node_id, access]) => ({ node_id, access }));
    try {
      const snapshot = await api.saveRuntimeConnectorScope(connectorId, {
        mode,
        bindings: mode === "selected" ? payload : [],
      });
      setMode(snapshot.mode);
      setCoverage(snapshot.coverage);
      setBindings(Object.fromEntries(snapshot.bindings.map((binding) => [binding.node_id, binding.access])));
      setNotice(mode === "unset"
        ? "已移除连接器级范围；该连接器回到以逐人授权为准。"
        : "连接器级范围已保存；实际覆盖以每次调用时的身份校验为准。");
    } catch (cause) {
      const code = String((cause as { payload?: { code?: unknown } } | null)?.payload?.code || "");
      setError(friendlyScopeFailure(code) || errorMessage(cause, "范围未保存"));
    } finally {
      setBusy(false);
    }
  };

  const toggleNode = (nodeId: string) =>
    setBindings((current) => {
      const next = { ...current };
      if (next[nodeId]) delete next[nodeId];
      else next[nodeId] = "read";
      return next;
    });

  const renderNode = (node: ScopeNode) => {
    const children = nodes.filter((child) => child.parent_id === node.id);
    return (
      <li key={node.id} className="connector-scope-node">
        <label>
          <input
            type="checkbox"
            checked={Boolean(bindings[node.id])}
            disabled={busy}
            data-connector-scope-node={node.id}
            onChange={() => toggleNode(node.id)}
          />
          <span><small>{nodeLabel(node)}</small><strong>{node.name}</strong></span>
          {!node.is_person && (node.external_id.startsWith("org:") ? <em className="muted">已登记</em> : <em className="muted">未登记名称</em>)}
        </label>
        {node.status === "unmatched" && node.is_person && <em className="muted">未匹配账号</em>}
        {children.length > 0 && <ul>{children.map(renderNode)}</ul>}
      </li>
    );
  };
  const topLevel = nodes.filter((node) => !node.parent_id);

  return (
    <section className="panel connector-detail-card" data-connector-scope>
      <div className="connector-card-head">
        <div>
          <h3>可用范围</h3>
          <p className="muted">
            决定谁可以使用这条连接（一级部门 / 二级部门 / 组 / 个人）。逐人授权与范围取并集；接口级范围仍是附加限制。范围只增加可达范围，停用请用上方按钮。
          </p>
        </div>
      </div>
      {loading && <p className="muted" role="status">正在读取范围…</p>}
      {!loading && (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="runtime-notice" role="status">{notice}</p>}
          <label className="field">范围模式
            <select value={mode} disabled={busy} data-connector-scope-mode onChange={(event) => setMode(event.target.value as RuntimeConnectorScopeMode)}>
              <option value="unset">未设置（以逐人授权为准）</option>
              <option value="all">所有员工（追加 read）</option>
              <option value="selected">指定范围</option>
            </select>
          </label>
          {mode === "unset" && <p className="muted">尚未启用连接器级范围治理；运行时按逐人授权判定。</p>}
          {mode === "all" && <p className="muted">所有有效账号获得 read；write 仍需逐人授权。实际覆盖以保存后的解析为准。</p>}
          {mode === "selected" && (
            <>
              <form className="connector-scope-add" onSubmit={(event) => { event.preventDefault(); void addNode(); }}>
                <label className="field">新增范围节点
                  <select value={nodeLevel} disabled={busy} onChange={(event) => { setNodeLevel(Number(event.target.value) as 1 | 2 | 3); setParentId(""); setCandidateId(""); }}>
                    <option value={1}>一级部门</option>
                    <option value={2}>二级部门</option>
                    <option value={3}>组 / 岗位 / 个人</option>
                  </select>
                </label>
                {nodeLevel === 3 && (
                  <label className="field">节点类型
                    <select value={nodeKind} disabled={busy} onChange={(event) => { setNodeKind(event.target.value as "group" | "position" | "person"); setCandidateId(""); }}>
                      <option value="group">组（已登记）</option>
                      <option value="position">岗位</option>
                      <option value="person">个人账号</option>
                    </select>
                  </label>
                )}
                {nodeLevel > 1 && (
                  <label className="field">上级
                    <select value={parentId} disabled={busy} onChange={(event) => setParentId(event.target.value)}>
                      <option value="">选择{nodeLevel === 2 ? "一级部门" : "二级部门 / 组"}</option>
                      {nodes.filter((node) => node.level === nodeLevel - 1).map((node) => (
                        <option key={node.id} value={node.id}>{node.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {nodeLevel === 3 && nodeKind === "person" ? (
                  <label className="field">个人账号
                    <select value={personId} disabled={busy} onChange={(event) => setPersonId(event.target.value)}>
                      <option value="">选择有效账号</option>
                      {activeUsers.map((user) => (
                        <option key={String(user.id)} value={String(user.id)}>
                          {String(user.name || user.username || user.id)}{user.position ? ` · ${String(user.position)}` : ""}
                        </option>
                      ))}
                    </select>
                    {!activeUsers.length && <small className="muted">没有可授权的有效账号。</small>}
                  </label>
                ) : (nodeLevel < 3 || nodeKind === "group") && levelCandidates.length > 0 ? (
                  <label className="field">已登记{nodeLevel === 1 ? "一级部门" : nodeLevel === 2 ? "二级部门" : "组"}
                    <select value={candidateId} disabled={busy} onChange={(event) => setCandidateId(event.target.value)}>
                      <option value="">选择已登记单位（来自 org-registry）</option>
                      {levelCandidates.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}
                      <option value="__manual">手输名称（未登记）</option>
                    </select>
                  </label>
                ) : null}
                {!(nodeLevel === 3 && nodeKind === "person") && (candidateId === "__manual" || levelCandidates.length === 0 || nodeKind === "position") && (
                  <label className="field">名称
                    <input value={manualName} maxLength={240} disabled={busy} placeholder={nodeKind === "position" ? "例如：KOL 经理" : "未登记名称"} onChange={(event) => setManualName(event.target.value)} />
                  </label>
                )}
                <button className="btn sm" disabled={busy} data-connector-scope-add>{busy ? "添加中…" : "添加节点"}</button>
              </form>
              {topLevel.length ? <ul className="connector-scope-tree">{topLevel.map(renderNode)}</ul> : <p className="muted">还没有范围节点；先添加一级部门。</p>}
              {Object.keys(bindings).length > 0 && (
                <ul className="connector-scope-selected" data-connector-scope-selected>
                  {Object.entries(bindings).map(([nodeId, access]) => {
                    const node = nodes.find((item) => item.id === nodeId);
                    return (
                      <li key={nodeId} data-connector-scope-binding={nodeId}>
                        <span>{node ? `${nodeLabel(node)} · ${node.name}` : nodeId}</span>
                        <select
                          value={access}
                          aria-label={`${node?.name || nodeId} 的访问级别`}
                          disabled={busy}
                          onChange={(event) => setBindings((current) => ({ ...current, [nodeId]: event.target.value as Access }))}
                        >
                          <option value="read">read</option>
                          <option value="write">write</option>
                        </select>
                        <button type="button" className="btn sm" disabled={busy} onClick={() => toggleNode(nodeId)}>移除</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="muted">
                部门 / 组覆盖其下已配置的岗位与个人节点；岗位按账号岗位名称匹配。本地账号没有部门字段，需要精确到人的限制时请绑定个人节点。
              </p>
            </>
          )}
          <div className="connector-card-actions">
            <span className="muted" data-connector-scope-coverage>
              {mode === "all"
                ? `上次保存时预计覆盖 ${coverage.users} 人（read ${coverage.read}）`
                : `上次保存时预计覆盖 ${coverage.users} 人（read ${coverage.read} · write ${coverage.write}）`}
            </span>
            <button type="button" className="btn work" disabled={busy} data-connector-scope-save onClick={() => void save()}>
              {busy ? "保存中…" : mode === "unset" ? "移除范围" : "保存范围"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
