import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AdminAgentAccess, type AdminAgentRow, type AdminAgentsResponse, type AdminAuditEvent, type AdminBindingPreview } from "../api";
import { useAdminConfirm } from "../components/ConfirmDialog";
import { AdminTextDialog } from "../components/AdminTextDialog";
import { AdminFormDialog } from "../components/AdminFormDialog";
import {
  agentBindingRevokeConfirm,
  agentDisableConfirm,
  agentKnowledgeUnbindConfirm,
  agentPublishConfirm,
} from "../adminConfirm";
import "../admin/governance-layout.css";

const statusName = (status: AdminAgentRow["status"]) => status === "published" ? "已发布" : status === "disabled" ? "已停用" : "草稿";
const errorName = (cause: unknown) => cause instanceof Error ? cause.message : "保存失败";
const VIA_LABEL: Record<AdminAgentAccess["via"], string> = {
  binding_target: "直接绑定",
  unit_head: "部门负责人",
  unit_member: "部门成员",
  ancestor_head: "上级负责人",
};
const VIA_ORDER: AdminAgentAccess["via"][] = ["binding_target", "unit_head", "unit_member", "ancestor_head"];
const viaLabel = (via: string) => VIA_LABEL[via as AdminAgentAccess["via"]] || via;
const targetTypeLabel = (type: string) => type === "person" ? "人员" : "组织单元";
const levelLabel = (level: number) => level === 1 ? "一级部门" : level === 2 ? "二级部门" : level === 3 ? "三级组" : `${level} 级单元`;

function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

const AUDIT_KEY_LABEL: Record<string, string> = {
  target_type: "目标类型", target_id: "目标", binding_id: "绑定点", skill_id: "技能", base_id: "知识库",
  status: "状态", reason: "原因", name: "名称", enabled: "启用", version: "版本", user_id: "员工",
};

function auditSummary(payload: Record<string, unknown> = {}): string {
  if (payload.truncated === true) {
    return `审计附加信息过大，已截断预览（原始 ${Number(payload.payload_size || 0).toLocaleString("zh-CN")} 字符）`;
  }
  const render = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  };
  const parts: string[] = [];
  for (const [key, label] of Object.entries(AUDIT_KEY_LABEL)) {
    const value = payload[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${label}=${render(value)}`);
  }
  if (parts.length) return parts.join(" · ");
  const entries = Object.entries(payload).filter(([, value]) => value !== null && value !== "").slice(0, 3);
  if (!entries.length) return "无附加字段";
  return entries.map(([key, value]) => `${key}=${render(value)}`).join(" · ");
}

export function AdminAgents() {
  const [data, setData] = useState<AdminAgentsResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const createNameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | AdminAgentRow["status"]>("all");
  const [bindingType, setBindingType] = useState<"all" | "organization_unit" | "person" | "unbound">("all");
  const [targetType, setTargetType] = useState<"organization_unit" | "person">("organization_unit");
  const [targetId, setTargetId] = useState("");
  const [knowledgeSkillId, setKnowledgeSkillId] = useState("");
  const [knowledgeBaseId, setKnowledgeBaseId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [previewBusyId, setPreviewBusyId] = useState("");
  const [bindPreview, setBindPreview] = useState<AdminBindingPreview | null>(null);
  const [bindPreviewBusy, setBindPreviewBusy] = useState(false);
  const [audit, setAudit] = useState<AdminAuditEvent[] | null>(null);
  const [auditError, setAuditError] = useState("");
  const { ask, dialog } = useAdminConfirm();

  const load = useCallback(async (retain = true) => {
    try {
      const response = await api.adminAgents();
      setData(response);
      setError("");
      if (retain) setSelectedId((id) => response.agents.some((agent) => agent.id === id) ? id : response.agents[0]?.id || "");
    } catch (cause) { setError(errorName(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = data?.agents.find((agent) => agent.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId) { setAudit(null); setAuditError(""); return; }
    let live = true;
    setAudit(null);
    setAuditError("");
    void api.adminAgentAudit(selectedId).then((response) => {
      if (live) setAudit(response.items || []);
    }).catch((cause) => {
      if (live) setAuditError(errorName(cause));
    });
    return () => { live = false; };
  }, [selectedId, data]);

  const visible = useMemo(() => (data?.agents || []).filter((agent) => {
    if (status !== "all" && agent.status !== status) return false;
    if (bindingType === "unbound") { if (agent.bindings.length) return false; }
    else if (bindingType !== "all" && !agent.bindings.some((binding) => binding.target_type === bindingType && binding.status !== "revoked")) return false;
    return `${agent.name} ${agent.description} ${agent.id}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [data, query, status, bindingType]);

  const unitGroups = useMemo(() => {
    const groups = new Map<number, AdminAgentsResponse["units"]>();
    for (const unit of data?.units || []) {
      const rows = groups.get(unit.level) || [];
      rows.push(unit);
      groups.set(unit.level, rows);
    }
    return [...groups.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([level, rows]) => ({ level, label: levelLabel(level), rows: [...rows].sort((left, right) => left.display_name.localeCompare(right.display_name, "zh-CN")) }));
  }, [data]);

  const execute = async (action: () => Promise<unknown>, receipt: string) => {
    setBusy(true); setError("");
    try { await action(); setNotice(receipt); await load(); return true; }
    catch (cause) { setError(errorName(cause)); return false; }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!name.trim()) { setCreateError("请填写 Agent 名称。"); return; }
    setBusy(true); setCreateError("");
    try {
      const row = await api.adminAgentCreate({ name: name.trim(), description: description.trim() });
      setCreateOpen(false); setName(""); setDescription(""); setSelectedId(row.id);
      setTargetId(""); setBindPreview(null);
      setNotice("Agent 草稿已创建。请绑定组织或人员并装配技能后发布。");
      await load(false);
    } catch (cause) { setCreateError(errorName(cause)); }
    finally { setBusy(false); }
  };
  const openCreate = () => { setName(""); setDescription(""); setCreateError(""); setCreateOpen(true); };
  const submitRename = async () => {
    if (!selected || !renameValue.trim()) return;
    setRenameBusy(true); setRenameError("");
    try {
      await api.adminAgentUpdate(selected.id, { name: renameValue.trim(), expected_version: selected.version });
      setRenaming(false);
      setNotice("Agent 名称已更新。");
      await load();
    } catch (cause) { setRenameError(errorName(cause)); }
    finally { setRenameBusy(false); }
  };
  const publish = () => {
    if (!selected) return;
    ask(agentPublishConfirm({
      name: selected.name,
      id: selected.id,
      enabledSkills: selected.skills.filter((skill) => Number(skill.enabled) === 1).length,
      bindings: selected.bindings.length,
      users: selected.coverage.user_ids.length,
      orgVersion: selected.coverage.org_version,
    }), async () => {
      await api.adminAgentUpdate(selected.id, { status: "published", expected_version: selected.version });
      setNotice("Agent 已发布，覆盖范围内的员工可立即使用。");
      await load();
    });
  };
  const disable = () => {
    if (!selected) return;
    ask(agentDisableConfirm(selected.name, selected.id), async () => {
      await api.adminAgentUpdate(selected.id, { status: "disabled", expected_version: selected.version });
      setNotice("Agent 已停用；绑定与覆盖名单保留。");
      await load();
    });
  };
  const bindingTarget = () => targetType === "person"
    ? { target_type: "person" as const, user_id: targetId }
    : { target_type: "organization_unit" as const, target_id: targetId };
  const previewBind = async () => {
    if (!selected || !targetId) return;
    setBindPreviewBusy(true); setError("");
    try { setBindPreview(await api.adminAgentBindingsPreview(selected.id, bindingTarget())); }
    catch (cause) { setError(errorName(cause)); }
    finally { setBindPreviewBusy(false); }
  };
  const bind = async () => {
    if (!selected || !targetId || !bindPreview) return;
    const saved = await execute(
      () => api.adminAgentBind(selected.id, { ...bindingTarget(), reason: "管理侧 Agent 页面绑定" }),
      "绑定已保存，覆盖人员按组织树重新计算。",
    );
    if (saved) { setBindPreview(null); setTargetId(""); }
  };
  const toggleSkill = (skillId: string, enabled: boolean) => {
    if (!selected) return;
    const current = selected.skills.find((skill) => skill.skill_id === skillId);
    void execute(() => api.adminAgentSkill(selected.id, skillId, { enabled, expected_version: current?.version || 0 }), enabled ? "技能已装配到 Agent。" : "技能已从 Agent 移除。");
  };
  const unitName = (id: string) => data?.units.find((unit) => unit.id === id)?.display_name || id;
  const personName = (id: string) => data?.people.find((person) => person.person_ref === id)?.display_name || id;
  const bindingName = (binding: AdminAgentRow["bindings"][number]) => binding.target_type === "person" ? personName(binding.target_id) : unitName(binding.target_id);
  const skillLabel = (id: string) => data?.skills.find((skill) => skill.id === id)?.label || id;
  const knowledgeBases = (selector: string) => {
    try {
      const parsed = JSON.parse(selector) as { base_ids?: string[] };
      return (parsed.base_ids || []).map((id) => data?.bases.find((base) => base.id === id)?.name || id).join("、");
    } catch { return ""; }
  };

  const revokeBinding = async (binding: AdminAgentRow["bindings"][number]) => {
    if (!selected) return;
    setPreviewBusyId(binding.id);
    setError("");
    try {
      const preview = await api.adminAgentRevokePreview(selected.id, binding.id);
      const removed = preview.removed.map((entry) => entry.display_name || entry.person_ref);
      ask(agentBindingRevokeConfirm({
        agentName: selected.name,
        agentId: selected.id,
        targetLabel: `${targetTypeLabel(binding.target_type)} · ${bindingName(binding)}`,
        removed,
      }), async (reason) => {
        await api.adminAgentUnbind(selected.id, binding.id, reason || "管理侧撤销");
        setNotice("绑定已撤销，覆盖名单已按组织树重算。");
        await load();
      });
    } catch (cause) { setError(errorName(cause)); }
    finally { setPreviewBusyId(""); }
  };
  const removeKnowledge = (row: AdminAgentRow["knowledge"][number]) => {
    if (!selected) return;
    ask(agentKnowledgeUnbindConfirm({
      agentName: selected.name,
      agentId: selected.id,
      skillLabel: skillLabel(row.skill_id),
      baseLabel: knowledgeBases(row.selector) || row.note || row.id,
    }), async () => {
      await api.adminAgentKnowledgeDelete(selected.id, row.id);
      setNotice("知识库依赖已移除；该技能的其他 Agent 同步生效。");
      await load();
    });
  };
  const enabledSkills = selected?.skills.filter((skill) => Number(skill.enabled) === 1).length || 0;

  return <section className="governance-workspace" data-admin-page="agents">
    <aside className="governance-rail">
      <div className="governance-scroll">
        <input className="governance-search" aria-label="搜索 Agent" placeholder="搜索名称或说明" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="governance-count">{visible.length} / {data?.agents.length || 0} 个 Agent</p>
        <div className="governance-filter-group"><strong>发布状态</strong><div className="governance-filter-options">{([["all", "全部"], ["draft", "草稿"], ["published", "已发布"], ["disabled", "已停用"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}</div></div>
        <div className="governance-filter-group"><strong>绑定类型</strong><div className="governance-filter-options">{([["all", "全部"], ["organization_unit", "组织单元"], ["person", "人员"], ["unbound", "未绑定"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={bindingType === id} onClick={() => setBindingType(id)}>{label}</button>)}</div></div>
        <h2 className="governance-subheading">Agent 列表</h2>
        <div className="governance-list">{visible.map((agent) => <button type="button" className={`governance-list-row governance-agent-row${selectedId === agent.id ? " is-selected" : ""}`} key={agent.id} onClick={() => { setSelectedId(agent.id); setTargetId(""); setBindPreview(null); setKnowledgeSkillId(""); setKnowledgeBaseId(""); }}>
          <strong>{agent.name}</strong><span>{statusName(agent.status)}</span><span>{agent.skills.filter((skill) => skill.enabled).length} 项技能</span><span>{agent.coverage.user_ids.length} 人可用</span>
        </button>)}{!visible.length && <p className="governance-empty">没有符合条件的 Agent。</p>}</div>
      </div>
      <div className="governance-rail-footer"><button className="btn work" type="button" onClick={openCreate}>新增 Agent</button></div>
    </aside>
    <div className="governance-main">
      <header className="governance-main-head"><h2>{selected?.name || "Agent 详情"}</h2>{selected && <span>{statusName(selected.status)} · v{selected.version}</span>}</header>
      <div className="governance-scroll">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {selected ? <>
          <section className="governance-card"><h3>职责</h3><p>{selected.description || "暂无职责说明"}</p><p className="muted">权限只在 Agent 层控制；技能通过此 Agent 使用。</p><div className="governance-inline-actions"><button type="button" disabled={busy} onClick={() => { setRenameValue(selected.name); setRenameError(""); setRenaming(true); }}>修改名称</button></div></section>

          <section className="governance-card"><h3>技能与知识库</h3><p className="muted">知识库查询也是技能。MCP、API 和知识库由技能调用；技能被多个 Agent 装配时依赖共享。</p><div className="governance-checkbox-list">{data?.skills.map((skill) => { const enabled = selected.skills.some((row) => row.skill_id === skill.id && row.enabled); return <label key={skill.id}><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => toggleSkill(skill.id, event.target.checked)} /><span><strong>{skill.label}</strong> · {skill.summary}</span></label>; })}</div>
            <h4 className="governance-subheading">知识库依赖</h4>
            {selected.knowledge.length ? <div className="governance-checkbox-list">{selected.knowledge.map((row) => <div className="governance-list-row governance-row-split" key={row.id}><span>技能 <strong>{skillLabel(row.skill_id)}</strong> · {knowledgeBases(row.selector) || row.note || row.id}</span><button type="button" className="governance-minor" disabled={busy} onClick={() => removeKnowledge(row)}>移除</button></div>)}</div> : <p className="muted">已装配技能暂无知识库绑定。</p>}
            <label>调用技能<select value={knowledgeSkillId} onChange={(event) => setKnowledgeSkillId(event.target.value)}><option value="">请选择</option>{selected.skills.filter((skill) => skill.enabled).map((skill) => <option key={skill.skill_id} value={skill.skill_id}>{skillLabel(skill.skill_id)}</option>)}</select></label>
            <label>知识库<select value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}><option value="">请选择</option>{data?.bases.filter((base) => base.status === "active" && (base.kind === "structured" || data.skills.find((skill) => skill.id === knowledgeSkillId)?.document_query)).map((base) => <option key={base.id} value={base.id}>{base.name}（{base.kind === "unstructured" ? "非结构化" : "结构化"}）</option>)}</select></label>
            <button type="button" className="governance-minor" disabled={!knowledgeSkillId || !knowledgeBaseId || busy} onClick={() => void execute(() => api.adminAgentKnowledge(selected.id, knowledgeSkillId, knowledgeBaseId), "知识库已绑定到技能；引用该技能的 Agent 共用此依赖。")}>绑定知识库</button>
          </section>

          <section className="governance-card"><h3>人员范围</h3><p className="muted">绑定组织单元：该单元负责人、该单元及全部下级成员、沿上级链的各级上级负责人；绑定人员：本人与所属各级上级负责人。组织版本 {selected.coverage.org_version}。</p>
            <h4 className="governance-subheading">绑定点</h4>
            {selected.bindings.length ? <div className="governance-checkbox-list">{selected.bindings.map((binding) => <div className="governance-list-row governance-row-split" key={binding.id}><span>{targetTypeLabel(binding.target_type)} · <strong>{bindingName(binding)}</strong></span><button type="button" className="governance-minor" disabled={busy || previewBusyId === binding.id} onClick={() => void revokeBinding(binding)}>{previewBusyId === binding.id ? "读取中…" : "撤销"}</button></div>)}</div> : <p className="muted">尚未绑定组织单元或人员，员工无法使用该 Agent。</p>}
            <h4 className="governance-subheading">覆盖名单（按来源分组 · 共 {selected.coverage.user_ids.length} 人）</h4>
            {VIA_ORDER.map((via) => { const rows = selected.coverage.users.filter((user) => user.via === via); return rows.length ? <div className="governance-via-group" key={via}><h4>{viaLabel(via)} · {rows.length} 人</h4><ul>{rows.map((user) => <li key={`${user.person_ref}:${user.binding_id}`}><strong>{user.display_name || user.person_ref}</strong><span>通过 {user.via_unit_display_name || user.via_unit_id}</span></li>)}</ul></div> : null; })}
            {!selected.coverage.users.length && <p className="muted">当前绑定点未覆盖任何员工。</p>}
            <h4 className="governance-subheading">添加绑定</h4>
            <label>绑定目标类型<select value={targetType} onChange={(event) => { setTargetType(event.target.value as typeof targetType); setTargetId(""); setBindPreview(null); }}><option value="organization_unit">组织单元</option><option value="person">人员</option></select></label>
            <label>选择目标<select value={targetId} onChange={(event) => { setTargetId(event.target.value); setBindPreview(null); }}><option value="">请选择</option>{targetType === "organization_unit" ? unitGroups.map((group) => <optgroup key={group.level} label={group.label}>{group.rows.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}</optgroup>) : data?.people.filter((person) => person.user_id).map((person) => <option key={person.person_ref} value={person.user_id || ""}>{person.display_name}</option>)}</select></label>
            <button type="button" className="governance-minor" disabled={!targetId || busy || bindPreviewBusy} onClick={() => void previewBind()}>{bindPreviewBusy ? "试算中…" : "预览绑定影响"}</button>
            {bindPreview && <div className="governance-via-group" data-agent-binding-preview>
              <p>组织版本 {bindPreview.org_version} · 将新增覆盖 {bindPreview.added.length} 人{bindPreview.added.length ? `（绑定后共 ${bindPreview.after.user_ids.length} 人）` : "，覆盖名单不变"}</p>
              {bindPreview.added.length > 0 && <ul>{bindPreview.added.map((entry) => <li key={`${entry.person_ref}:${entry.binding_id}`}><strong>{entry.display_name || entry.person_ref}</strong><span>{viaLabel(entry.via)}{entry.via_unit_display_name ? ` · ${entry.via_unit_display_name}` : ""}</span></li>)}</ul>}
              {!bindPreview.added.length && bindPreview.removed.length > 0 && <ul>{bindPreview.removed.map((entry) => <li key={`${entry.person_ref}:${entry.binding_id}`}><strong>{entry.display_name || entry.person_ref}</strong><span>将失去覆盖</span></li>)}</ul>}
              <div className="governance-inline-actions"><button type="button" className="btn work" disabled={busy} onClick={() => void bind()}>确认绑定</button><button type="button" className="governance-minor" disabled={busy} onClick={() => setBindPreview(null)}>取消</button></div>
            </div>}
          </section>

          <section className="governance-card"><h3>发布</h3><p>当前状态：<strong>{statusName(selected.status)}</strong> · v{selected.version}</p><ul className="governance-summary-list"><li><span>启用技能</span><strong>{enabledSkills} 项</strong></li><li><span>绑定点</span><strong>{selected.bindings.length} 个</strong></li><li><span>覆盖人数</span><strong>{selected.coverage.user_ids.length} 人</strong></li><li><span>组织版本</span><strong>{selected.coverage.org_version}</strong></li></ul>
            <p className="muted">发布前需至少装配一项技能并至少绑定一个组织单元或人员；条件不满足时服务端会拒绝并返回原因。</p>
            <div className="governance-inline-actions">{selected.status !== "published" && <button type="button" className="btn work" disabled={busy} onClick={publish}>发布 Agent</button>}{selected.status === "published" && <button type="button" disabled={busy} onClick={disable}>停用 Agent</button>}</div>
          </section>

          <section className="governance-card"><h3>运行与审计</h3><p className="muted">只读展示该 Agent 的最近审计记录（最多 50 条）。</p>
            {auditError && <p className="error" role="alert">{auditError}</p>}
            {!audit && !auditError && <p className="muted">正在读取审计记录…</p>}
            {audit && !audit.length && <p className="muted">暂无记录</p>}
            {audit && audit.length > 0 && <div className="governance-list">{audit.map((event) => <div className="governance-list-row governance-audit-row" key={event.id}><span>{formatTime(event.ts)}</span><span>{event.actor}</span><span>{event.event_type}</span><span className="muted">{auditSummary(event.payload)}</span></div>)}</div>}
          </section>

          <section className="governance-card"><h3>版本</h3><p className="governance-meta-row"><span>版本 v{selected.version}</span><span>创建 {formatTime(selected.created_at)}</span><span>更新 {formatTime(selected.updated_at)}</span></p></section>
        </> : <p className="governance-empty">选择一个 Agent 查看详情。</p>}
      </div>
    </div>
    <AdminTextDialog
      open={renaming}
      title="修改 Agent 名称"
      description="名称用于员工界面与审计；只改展示名，不改 Agent ID。"
      label="Agent 名称"
      value={renameValue}
      required
      confirmLabel="保存名称"
      busy={renameBusy}
      error={renameError}
      onChange={setRenameValue}
      onConfirm={() => void submitRename()}
      onCancel={() => { setRenaming(false); setRenameError(""); }}
    />
    {dialog}
    <AdminFormDialog
      open={createOpen}
      title="新增 Agent"
      subtitle="创建后为草稿：装配技能并绑定组织或人员后才能发布。"
      error={createError}
      busy={busy}
      initialFocusRef={createNameRef}
      onClose={() => { setCreateOpen(false); setCreateError(""); }}
      footer={<><button type="button" className="btn" disabled={busy} onClick={() => { setCreateOpen(false); setCreateError(""); }}>取消</button><button type="button" className="btn work" disabled={busy} onClick={() => void create()}>{busy ? "创建中…" : "创建 Agent"}</button></>}
    >
      <label>Agent 名称<input ref={createNameRef} type="text" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    </AdminFormDialog>
  </section>;
}
