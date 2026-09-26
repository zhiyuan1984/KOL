import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { errorMessage, type RuntimeConnectorConfig, type RuntimeToolDefinition, type RuntimeToolPolicy } from "../runtimeConnectorUi";

type ScopeNode = { id: string; parent_id: string | null; name: string; level: 1 | 2 | 3 };
type ScopeSnapshot = { nodes: ScopeNode[] };

const TOOL_NAMES: Record<string, string> = {
  listAllKolProfiles: "全量达人画像", pageKolProfiles: "查询达人画像", getKolProfileDetail: "查询达人详情",
  pageMailboxes: "查询品牌邮箱", getMailboxDetail: "查询邮箱详情", getMailboxPermissions: "查询邮箱权限",
  pageEmailConversations: "查询邮件会话", previewEmailDraft: "生成邮件草稿", saveEmailDraft: "保存邮件草稿",
  sendEmailNow: "发送邮件", changeLifecycleStage: "变更合作阶段", decryptKolContact: "解密达人联系方式",
};

const title = (tool: RuntimeToolDefinition) => TOOL_NAMES[tool.name] || tool.name;
const defaultRisk = (tool: RuntimeToolDefinition): "L1" | "L2" | "L3" => /send|delete|change|decrypt|import|update/i.test(tool.name) ? "L3" : /draft|create|add|save/i.test(tool.name) ? "L2" : "L1";

type ScopeEditorProps = {
  tool: RuntimeToolDefinition | null;
  nodes: ScopeNode[];
  selected: string[];
  onChanged: (nodes: ScopeNode[]) => void;
  onSaved: (tool: string, nodeIds: string[]) => void;
};

function ScopeEditor({ tool, nodes, selected, onChanged, onSaved }: ScopeEditorProps) {
  const [nodeName, setNodeName] = useState("");
  const [nodeLevel, setNodeLevel] = useState<1 | 2 | 3>(1);
  const [parentId, setParentId] = useState("");
  const [picked, setPicked] = useState(selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPicked(selected); }, [selected, tool?.name]);
  const levelOne = nodes.filter((node) => node.level === 1);
  const parentOptions = nodes.filter((node) => node.level === nodeLevel - 1);
  const saveNode = async (event: FormEvent) => {
    event.preventDefault();
    if (!nodeName.trim() || (nodeLevel > 1 && !parentId)) { setError("请填写名称，并为二级部门或岗位选择上级。 "); return; }
    setBusy(true); setError("");
    try {
      const result = await api.addRuntimeOrganizationScopeNode("starrykol", {
        name: nodeName.trim(), level: nodeLevel, ...(nodeLevel > 1 ? { parent_id: parentId } : {}),
      });
      onChanged(result.nodes); setNodeName(""); setParentId("");
    } catch (cause) { setError(errorMessage(cause, "新增授权节点失败")); }
    finally { setBusy(false); }
  };
  const saveScope = async () => {
    if (!tool) return;
    if (!picked.length) { setError("至少选择一个一级部门、二级部门或岗位。 "); return; }
    setBusy(true); setError("");
    try { const result = await api.saveRuntimeToolScope("starrykol", tool.name, picked); onSaved(tool.name, result.node_ids); }
    catch (cause) { setError(errorMessage(cause, "工具授权未保存")); }
    finally { setBusy(false); }
  };
  const tree = (node: ScopeNode) => <div className={`starry-tree-node level-${node.level}`} key={node.id}>
    <label><input type="checkbox" checked={picked.includes(node.id)} onChange={() => setPicked((current) => current.includes(node.id) ? current.filter((id) => id !== node.id) : [...current, node.id])} /><span><small>{node.level === 1 ? "一级部门" : node.level === 2 ? "二级部门" : "岗位"}</small><strong>{node.name}</strong></span></label>
    {nodes.filter((child) => child.parent_id === node.id).map(tree)}
  </div>;
  return <section className="starry-scope-editor" data-starry-scope-editor>
    <div><h3>{tool ? `“${title(tool)}”的授权范围` : "工具授权范围"}</h3><p className="muted">只授权三个层级：一级部门、二级部门、岗位。不显示人数，也不做员工逐个授权。</p></div>
    <form className="starry-node-form" onSubmit={(event) => void saveNode(event)}>
      <label className="field">新增<select value={nodeLevel} onChange={(event) => { setNodeLevel(Number(event.target.value) as 1 | 2 | 3); setParentId(""); }}><option value={1}>一级部门</option><option value={2}>二级部门</option><option value={3}>岗位</option></select></label>
      <label className="field">名称<input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder={nodeLevel === 1 ? "例如：营销中心" : nodeLevel === 2 ? "例如：KOL 合作部" : "例如：KOL 经理"} /></label>
      {nodeLevel > 1 && <label className="field">上级<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">选择上级{nodeLevel === 2 ? "一级部门" : "二级部门"}</option>{parentOptions.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>}
      <button className="btn" disabled={busy}>{busy ? "保存中…" : "增加"}</button>
    </form>
    {levelOne.length ? <div className="starry-tree">{levelOne.map(tree)}</div> : <p className="muted">先增加一个一级部门，再逐级增加二级部门和岗位。</p>}
    {error && <p className="error">{error}</p>}
    {tool && <div className="starry-scope-save"><span className="muted">勾选的部门或岗位可以调用该工具。</span><button type="button" className="btn work" disabled={busy || !nodes.length} onClick={() => void saveScope()}>{busy ? "保存中…" : "保存工具授权"}</button></div>}
  </section>;
}

export function StarryConnectorSetup({ onEnable }: { onEnable: () => void }) {
  const [config, setConfig] = useState<RuntimeConnectorConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [tools, setTools] = useState<RuntimeToolDefinition[]>([]);
  const [policies, setPolicies] = useState<RuntimeToolPolicy[]>([]);
  const [nodes, setNodes] = useState<ScopeNode[]>([]);
  const [scopes, setScopes] = useState<Record<string, string[]>>({});
  const [selectedTool, setSelectedTool] = useState<RuntimeToolDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [savedConfig, savedPolicies, savedScope] = await Promise.allSettled([
      api.runtimeConnectorConfig("starrykol"), api.runtimeConnectorPolicies("starrykol"), api.runtimeOrganizationScope("starrykol"),
    ]);
    if (savedConfig.status === "fulfilled") { setConfig(savedConfig.value.config); setVersion(savedConfig.value.version); setUrl(savedConfig.value.config.url || ""); }
    if (savedPolicies.status === "fulfilled") {
      setPolicies(savedPolicies.value);
      const values = await Promise.all(savedPolicies.value.filter((policy) => policy.enabled).map(async (policy) => {
        try { return [policy.tool_name, (await api.runtimeToolScope("starrykol", policy.tool_name)).node_ids] as const; }
        catch { return [policy.tool_name, []] as const; }
      }));
      setScopes(Object.fromEntries(values));
    }
    if (savedScope.status === "fulfilled") setNodes(savedScope.value.nodes);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || !secret) { setError("填写 Starry MCP 地址和一次性 API Key 后再测试。 "); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.onboardStarryConnector({ url: url.trim(), secret, expected_version: version });
      setSecret(""); setConfig({ protocol: "mcp", url: result.config.url, timeout_ms: result.config.timeout_ms }); setVersion(result.config.version); setTools(result.tools);
      setNotice(`连接已验证，已发现 ${result.tools.length} 个工具。`);
    } catch (cause) { setSecret(""); setError(errorMessage(cause, "连接验证失败，请检查地址和 API Key 后重试。")); }
    finally { setBusy(false); }
  };
  const discover = async () => {
    setBusy(true); setError("");
    try { const result = await api.runtimeConnectorDiscovery("starrykol"); setTools(result.tools); setNotice(`已读取 ${result.tools.length} 个工具。`); }
    catch (cause) { setError(errorMessage(cause, "无法读取工具清单")); }
    finally { setBusy(false); }
  };
  const prepareTool = async (tool: RuntimeToolDefinition) => {
    const current = policies.find((policy) => policy.tool_name === tool.name);
    setBusy(true); setError("");
    try {
      const risk = current?.risk || defaultRisk(tool);
      const saved = current || await api.saveRuntimeConnectorPolicy("starrykol", tool.name, { enabled: true, risk, access: risk === "L1" ? "read" : "write", schema_hash: tool.schema_hash, expected_version: 0 });
      setPolicies((rows) => [...rows.filter((policy) => policy.tool_name !== saved.tool_name), saved]);
      const existing = scopes[tool.name] || (await api.runtimeToolScope("starrykol", tool.name)).node_ids;
      setScopes((value) => ({ ...value, [tool.name]: existing })); setSelectedTool(tool);
    } catch (cause) { setError(errorMessage(cause, "工具无法进入授权配置")); }
    finally { setBusy(false); }
  };
  const policyByTool = useMemo(() => new Map(policies.map((policy) => [policy.tool_name, policy])), [policies]);
  const scopedTools = Object.values(scopes).filter((scope) => scope.length).length;

  return <section className="starry-onboarding" data-starry-onboarding>
    <div className="starry-stage-head"><div><p className="page-kicker">Starry KOL MCP</p><h2>连接与授权</h2><p className="muted">保存连接后读取工具清单；为需要的工具选择部门或岗位即可。</p></div></div>
    {notice && <p className="runtime-notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}
    <form className="starry-connect-card" onSubmit={(event) => void connect(event)}><div><h3>连接 Starry KOL MCP</h3><p className="muted">固定使用 MCP。API Key 只提交一次，加密保存且不会显示。</p></div><label className="field">Starry MCP 地址<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://由 Starry 提供的地址/mcp" required /></label><label className="field">Starry API Key<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="保存后不显示" autoComplete="new-password" required /></label><div className="starry-form-foot"><span className="muted">测试只读取工具清单，不会执行业务操作。</span><button className="btn work" disabled={busy}>{busy ? "测试中…" : config ? "重新测试" : "保存并测试"}</button></div></form>
    <section className="starry-step-card"><div className="starry-card-head"><div><h3>工具授权</h3><p className="muted">选择一个工具后，配置它可以由哪些部门或岗位调用。</p></div><button className="btn" type="button" onClick={() => void discover()} disabled={busy || !config}>{busy ? "读取中…" : "读取工具清单"}</button></div>{!tools.length ? <p className="muted">连接成功后读取工具清单。</p> : <div className="starry-simple-tools">{tools.map((tool) => { const policy = policyByTool.get(tool.name); const scope = scopes[tool.name] || []; return <article key={`${tool.name}:${tool.schema_hash}`} className={selectedTool?.name === tool.name ? "selected" : ""}><div><strong>{title(tool)}</strong><code>{tool.name}</code><p>{tool.description || "用途由 Starry MCP 提供"}</p></div><div><span className="admin-status">{policy ? policy.risk : "未配置"}</span><button className="btn sm" type="button" disabled={busy} onClick={() => void prepareTool(tool)}>{scope.length ? "编辑授权" : "配置授权"}</button></div></article>; })}</div>}</section>
    <ScopeEditor tool={selectedTool} nodes={nodes} selected={selectedTool ? scopes[selectedTool.name] || [] : []} onChanged={setNodes} onSaved={(toolName, ids) => { setScopes((value) => ({ ...value, [toolName]: ids })); setNotice("工具授权已保存。 "); }} />
    <section className="starry-enable-card"><div><h3>启用 Starry KOL MCP</h3><p>已授权 {scopedTools} 个工具。未设置部门或岗位的工具不可调用。</p></div><button className="btn work" type="button" disabled={!config || !scopedTools} onClick={onEnable}>启用</button></section>
  </section>;
}
