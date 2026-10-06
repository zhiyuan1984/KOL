import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type AdminAgentAccess, type AdminAgentRow, type AdminAgentsResponse, type AdminBindingPreview, type AdminSkillRecommendation } from "../api";
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
import SkillKnowledgeRange from '../admin/knowledge/SkillKnowledgeRange';

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

function formatTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
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
  const [bindingType, setBindingType] = useState<"all" | "company" | "level1" | "level2" | "level3" | "person" | "unbound">("person");
  const [companyFilter, setCompanyFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState<Record<number, string>>({});
  const [bindingSelection, setBindingSelection] = useState<Set<string>>(new Set());
  const [skillPage, setSkillPage] = useState(0);
  const [pendingSkills, setPendingSkills] = useState<Set<string>>(new Set());
  const [skillRecommendations, setSkillRecommendations] = useState<AdminSkillRecommendation["items"]>([]);
  const [skillRecommendationState, setSkillRecommendationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [skillRecommendationMessage, setSkillRecommendationMessage] = useState("");
  const [targetType, setTargetType] = useState<"organization_unit" | "person">("organization_unit");
  const [knowledgeSkillId, setKnowledgeSkillId] = useState("");
  const [knowledgePage, setKnowledgePage] = useState(0);
  const [pendingKnowledgeBases, setPendingKnowledgeBases] = useState<Set<string>>(new Set());
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
  const [panelOpen, setPanelOpen] = useState({ skills: true, knowledge: false, bindings: true });
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
  useEffect(() => { setPendingSkills(new Set(selected?.skills.filter((skill) => skill.enabled).map((skill) => skill.skill_id) || [])); setSkillPage(0); setSkillRecommendations([]); setSkillRecommendationState("idle"); }, [selectedId]);
  const orderedSkills = useMemo(() => {
    if (!skillRecommendations.length) return data?.skills || [];
    const rank = new Map(skillRecommendations.map((item) => [item.id, item.rank]));
    return [...(data?.skills || [])].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999) || a.label.localeCompare(b.label, "zh-CN"));
  }, [data, skillRecommendations]);
  const pagedSkills = orderedSkills.slice(skillPage * 10, skillPage * 10 + 10);
  const skillsDirty = Boolean(selected && (data?.skills || []).some((skill) => pendingSkills.has(skill.id) !== selected.skills.some((row) => row.skill_id === skill.id && Boolean(row.enabled))));
  const orgUnits = data?.units || [];
  const companyIds = useMemo(() => [...new Set(orgUnits.map((unit) => unit.company_id))].sort(), [data]);
  useEffect(() => { if (!companyFilter && companyIds.length) setCompanyFilter(companyIds[0]); }, [companyFilter, companyIds]);
  const selectedOrgParent = unitFilter[3] || unitFilter[2] || unitFilter[1] || "";
  const descendantsFor = (rootId: string) => {
    const found = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const unit of orgUnits) if (unit.parent_id && found.has(unit.parent_id) && !found.has(unit.id)) { found.add(unit.id); changed = true; }
    }
    return found;
  };
  const level1Options = orgUnits.filter((unit) => unit.company_id === companyFilter && unit.level === 1);
  const level2Options = orgUnits.filter((unit) => unit.company_id === companyFilter && unit.level === 2 && (!unitFilter[1] || unit.parent_id === unitFilter[1]));
  const level3Options = orgUnits.filter((unit) => unit.company_id === companyFilter && unit.level === 3 && (!unitFilter[2] || unit.parent_id === unitFilter[2]));
  const filteredUnits = useMemo(() => {
    if (!companyFilter) return [];
    if (selectedOrgParent) return orgUnits.filter((unit) => unit.company_id === companyFilter && unit.id === selectedOrgParent);
    return orgUnits.filter((unit) => unit.company_id === companyFilter && unit.level === 1);
  }, [data, companyFilter, selectedOrgParent]);
  const filteredPeople = useMemo(() => {
    const inScope = selectedOrgParent ? descendantsFor(selectedOrgParent) : null;
    return (data?.people || []).filter((person) => person.user_id && person.company_id === companyFilter
      && (!inScope || (person.unit_ids || []).some((unitId) => inScope.has(unitId))));
  }, [data, companyFilter, selectedOrgParent]);
  const bindCandidates = targetType === "person"
    ? filteredPeople.map((person) => ({ key: `person:${person.user_id}`, label: person.display_name, payload: { target_type: "person" as const, user_id: person.user_id || undefined } }))
    : filteredUnits.map((unit) => ({ key: `unit:${unit.id}`, label: unit.display_name, payload: { target_type: "organization_unit" as const, target_id: unit.id } }));
  const selectedBindTargets = bindCandidates.filter((target) => bindingSelection.has(target.key)).map((target) => target.payload);
  const boundKnowledgeBaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of selected?.knowledge || []) if (row.skill_id === knowledgeSkillId) {
      try { for (const id of (JSON.parse(row.selector) as { base_ids?: string[] }).base_ids || []) ids.add(id); } catch { /* retain malformed rows outside the editable set */ }
    }
    return ids;
  }, [selected, knowledgeSkillId]);
  const knowledgeDirty = [...pendingKnowledgeBases].some((id) => !boundKnowledgeBaseIds.has(id)) || [...boundKnowledgeBaseIds].some((id) => !pendingKnowledgeBases.has(id));
  const visibleKnowledgeBases = (data?.bases || []).filter((base) => base.status === "active"
    && (base.kind === "structured" || data?.skills.find((skill) => skill.id === knowledgeSkillId)?.document_query));
  const pagedKnowledgeBases = visibleKnowledgeBases.slice(knowledgePage * 10, knowledgePage * 10 + 10);
  useEffect(() => { setPendingKnowledgeBases(new Set(boundKnowledgeBaseIds)); setKnowledgePage(0); }, [selectedId, knowledgeSkillId, selected?.knowledge]);

  const matchesBindingFilter = (agent: AdminAgentRow, filter: typeof bindingType) => {
    const active = agent.bindings.filter((binding) => binding.status !== "revoked");
    if (filter === "all") return true;
    if (filter === "unbound") return active.length === 0;
    if (filter === "person") return active.some((binding) => binding.target_type === "person");
    return filter === "company"
      ? active.some((binding) => Boolean(binding.company_id))
      : active.some((binding) => binding.target_type === "organization_unit" && data?.units.find((unit) => unit.id === binding.target_id)?.level === Number(filter.slice(-1)));
  };
  const matchesQuery = (agent: AdminAgentRow) => `${agent.name} ${agent.description} ${agent.id}`.toLowerCase().includes(query.toLowerCase().trim());
  const visible = useMemo(() => (data?.agents || []).filter((agent) =>
    (status === "all" || agent.status === status) && matchesBindingFilter(agent, bindingType) && matchesQuery(agent)),
  [data, query, status, bindingType]);
  const countForStatus = (filter: typeof status) => (data?.agents || []).filter((agent) =>
    (filter === "all" || agent.status === filter) && matchesBindingFilter(agent, bindingType) && matchesQuery(agent)).length;
  const countForBinding = (filter: typeof bindingType) => (data?.agents || []).filter((agent) =>
    (status === "all" || agent.status === status) && matchesBindingFilter(agent, filter) && matchesQuery(agent)).length;
  const selectAgent = (agentId: string) => {
    if (agentId === selectedId) return;
    if ((skillsDirty || knowledgeDirty) && !window.confirm("存在未保存的技能或知识库选择。切换 Agent 将放弃这些修改，是否继续？")) return;
    setSelectedId(agentId); setBindingSelection(new Set()); setBindPreview(null); setKnowledgeSkillId("");
  };
  const changeKnowledgeSkill = (skillId: string) => {
    if (knowledgeDirty && !window.confirm("当前知识库选择尚未保存，切换技能将放弃这些修改。是否继续？")) return;
    setKnowledgeSkillId(skillId);
  };

  const create = async () => {
    if (!name.trim()) { setCreateError("请填写 Agent 名称。"); return; }
    setBusy(true); setCreateError("");
    try {
      const row = await api.adminAgentCreate({ name: name.trim(), description: description.trim() });
      setCreateOpen(false); setName(""); setDescription(""); setSelectedId(row.id);
      setBindingSelection(new Set()); setBindPreview(null);
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
  const previewBind = async () => {
    if (!selected || !selectedBindTargets.length) return;
    if (selectedBindTargets.length > 200) { setError("单次最多可选择 200 个绑定目标，请缩小筛选范围。"); return; }
    setBindPreviewBusy(true); setError("");
    try { setBindPreview(await api.adminAgentBindingsBulkPreview(selected.id, selectedBindTargets)); }
    catch (cause) { setError(errorName(cause)); }
    finally { setBindPreviewBusy(false); }
  };
  const bind = async () => {
    if (!selected || !selectedBindTargets.length || !bindPreview) return;
    setBusy(true); setError("");
    try {
      const response = await api.adminAgentBindingsBulkSave(selected.id, selectedBindTargets, bindPreview.org_version, "管理侧 Agent 页面绑定");
      setData((current) => current ? { ...current, agents: current.agents.map((agent) => agent.id === selected.id ? response.agent : agent) } : current);
      setNotice(`绑定已保存，覆盖人员已按组织树重算（${selectedBindTargets.length} 个目标）。`);
      setBindPreview(null); setBindingSelection(new Set());
      await load();
    } catch (cause) { setError(errorName(cause)); }
    finally { setBusy(false); }
  };
  const setSkillSelection = (checked: boolean) => setPendingSkills(new Set(checked ? data?.skills.map((skill) => skill.id) || [] : []));
  const saveSkills = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const changes = (data?.skills || []).flatMap((skill) => {
        const current = selected.skills.find((row) => row.skill_id === skill.id);
        const nextEnabled = pendingSkills.has(skill.id);
        return Boolean(current?.enabled) === nextEnabled ? [] : [{ skill_id: skill.id, enabled: nextEnabled, expected_version: current?.version || 0 }];
      });
      await api.adminAgentSkillsSave(selected.id, changes);
      setNotice("技能绑定已保存生效。"); await load();
    } catch (cause) { setError(errorName(cause)); }
    finally { setBusy(false); }
  };
  const recommendSkills = async () => {
    if (!selected || !data?.skills.length) return;
    setSkillRecommendationState("loading"); setSkillRecommendationMessage("");
    try {
      const response = await api.adminAgentSkillRecommendations(selected.id, data.skills.map((skill) => skill.id));
      setSkillRecommendations(response.items);
      setSkillRecommendationState("ready");
    } catch (cause) {
      setSkillRecommendationState("error");
      setSkillRecommendationMessage(errorName(cause));
    }
  };
  const saveKnowledgeSelection = async () => {
    if (!selected || !knowledgeSkillId) return;
    const additions = [...pendingKnowledgeBases].filter((id) => !boundKnowledgeBaseIds.has(id));
    const removals = [...boundKnowledgeBaseIds].filter((id) => !pendingKnowledgeBases.has(id));
    const apply = async () => {
      setBusy(true); setError("");
      try {
        if (removals.length) {
          const affected = selected.knowledge.filter((row) => row.skill_id === knowledgeSkillId && (() => {
            try { return ((JSON.parse(row.selector) as { base_ids?: string[] }).base_ids || []).some((id) => removals.includes(id)); } catch { return false; }
          })());
          for (const row of affected) {
            const ids = (() => { try { return (JSON.parse(row.selector) as { base_ids?: string[] }).base_ids || []; } catch { return []; } })();
            await api.adminAgentKnowledgeDelete(selected.id, row.id);
            for (const baseId of ids.filter((id) => !removals.includes(id))) await api.adminAgentKnowledge(selected.id, knowledgeSkillId, baseId);
          }
        }
        for (const baseId of additions) await api.adminAgentKnowledge(selected.id, knowledgeSkillId, baseId);
        setNotice("知识库绑定已保存；该技能依赖由装配此技能的 Agent 共享。");
        await load();
      } catch (cause) { setError(errorName(cause)); await load(); }
      finally { setBusy(false); }
    };
    if (removals.length) {
      ask(agentKnowledgeUnbindConfirm({ agentName: selected.name, agentId: selected.id, skillLabel: skillLabel(knowledgeSkillId), baseLabel: removals.map((id) => data?.bases.find((base) => base.id === id)?.name || id).join("、") }), apply);
    } else await apply();
  };
  const unitName = (id: string) => data?.units.find((unit) => unit.id === id)?.display_name || id;
  const personName = (id: string) => data?.people.find((person) => person.person_ref === id)?.display_name || id;
  const bindingName = (binding: AdminAgentRow["bindings"][number]) => binding.target_type === "person" ? personName(binding.target_id) : unitName(binding.target_id);
  const skillLabel = (id: string) => data?.skills.find((skill) => skill.id === id)?.label || id;
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
  const enabledSkills = selected?.skills.filter((skill) => Number(skill.enabled) === 1).length || 0;
  const revealPanel = (key: keyof typeof panelOpen, id: string) => {
    setPanelOpen((current) => ({ ...current, [key]: true }));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return <section className="governance-workspace" data-admin-page="agents">
    <aside className="governance-rail">
      <div className="governance-scroll">
        <label className="governance-search-wrap"><span aria-hidden="true">⌕</span><input className="governance-search" aria-label="搜索 Agent" placeholder="请搜索Agent名称或说明" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="governance-filter-group"><strong>发布状态</strong><div className="governance-filter-options">{([["all", "全部"], ["draft", "草稿"], ["published", "已发布"], ["disabled", "已停用"]] as const).map(([id, label]) => <button className="governance-filter-choice" type="button" key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}<span className="governance-filter-badge">{countForStatus(id)}</span></button>)}</div></div>
        <div className="governance-filter-group"><strong>绑定类型</strong><div className="governance-filter-options">{([["all", "全部"], ["company", "公司"], ["level1", "一级部门"], ["level2", "二级部门"], ["level3", "三级部门"], ["person", "人员"], ["unbound", "未绑定"]] as const).map(([id, label]) => <button className="governance-filter-choice" type="button" key={id} aria-pressed={bindingType === id} onClick={() => setBindingType(id)}>{label}<span className="governance-filter-badge">{countForBinding(id)}</span></button>)}</div></div>
        <h2 className="governance-subheading">Agent 列表</h2>
        <p className="governance-count">{visible.length} / {data?.agents.length || 0} 个 Agent</p>
        <div className="governance-list">{visible.map((agent) => <button type="button" className={`governance-list-row governance-agent-row${selectedId === agent.id ? " is-selected" : ""}`} key={agent.id} onClick={() => selectAgent(agent.id)}>
          <strong>{agent.name}</strong>
        </button>)}{!visible.length && <p className="governance-empty">没有符合条件的 Agent。</p>}</div>
      </div>
      <div className="governance-rail-footer"><button className="governance-text-action" type="button" onClick={openCreate}>＋ 新增 Agent</button></div>
    </aside>
    <div className="governance-main">
      <header className="governance-main-head"><h2>{selected ? "Agent 治理" : "Agent 详情"}</h2></header>
      <div className="governance-scroll">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {selected ? <>
          {selected.skills.filter(skill=>skill.enabled && data?.skills.find(s=>s.id===skill.skill_id)?.document_query).map(skill=><SkillKnowledgeRange key={`${selected.id}-${skill.skill_id}`} skillId={skill.skill_id} compact />)}
          {selected.status==='published' && selected.skills.some(skill=>skill.enabled && data?.skills.find(s=>s.id===skill.skill_id)?.document_query) && <button className="governance-text-action" disabled={busy} onClick={async()=>{setBusy(true);try{await api.adminAgentSkillsSave(selected.id,selected.skills.map(skill=>({skill_id:skill.skill_id,enabled:Boolean(skill.enabled),expected_version:Number(skill.version)})));setNotice('已明确应用当前发布的知识技能版本；人员使用资格仍按当前绑定计算。');await load();}catch(e){setError(errorName(e));}finally{setBusy(false);}}}>应用已发布知识技能版本</button>}
          <section className="governance-card agent-summary-card"><div className="agent-summary-top"><strong>{selected.name}</strong><span className="agent-status">{statusName(selected.status)}</span><span className="muted">v{selected.version}</span><button type="button" className="governance-text-action" disabled={busy} onClick={() => { setRenameValue(selected.name); setRenameError(""); setRenaming(true); }}>修改名称</button>{selected.status === "published" ? <button type="button" className="governance-text-action" disabled={busy} onClick={disable}>停用智能体</button> : selected.status === "disabled" ? <button type="button" className="governance-text-action" disabled={busy} onClick={publish}>启用智能体</button> : <button type="button" className="governance-text-action" disabled={busy} onClick={publish}>发布智能体</button>}</div><div className="agent-summary-description"><strong>职责</strong><span>{selected.description || "暂无职责说明"}</span></div><div className="agent-summary-metrics"><button type="button" aria-expanded={panelOpen.skills} aria-controls="agent-skills-card" onClick={() => revealPanel("skills", "agent-skills-card")}><strong>{enabledSkills}</strong> 项技能　⌄</button><button type="button" aria-expanded={panelOpen.bindings} aria-controls="agent-bindings-card" onClick={() => revealPanel("bindings", "agent-bindings-card")}><strong>{selected.coverage.user_ids.length}</strong> 人覆盖　⌄</button><button type="button" aria-expanded={panelOpen.bindings} aria-controls="agent-bindings-card" onClick={() => revealPanel("bindings", "agent-bindings-card")}><strong>{selected.bindings.length}</strong> 个绑定点　⌄</button></div></section>

          <details className="governance-card agent-collapsible" id="agent-skills-card" open={panelOpen.skills} onToggle={(event) => { const isOpen = event.currentTarget.open; setPanelOpen((p) => p.skills === isOpen ? p : { ...p, skills: isOpen }); }}><summary><span>绑定技能</span><span className="agent-summary-count">{enabledSkills} 项已装配</span></summary><div className="agent-card-content"><div className="agent-card-head"><label className="agent-select-all"><input type="checkbox" checked={Boolean(data?.skills.length && data.skills.every((skill) => pendingSkills.has(skill.id)))} onChange={(event) => setSkillSelection(event.target.checked)} />全选</label><button type="button" className="governance-text-action" disabled={skillRecommendationState === "loading"} onClick={() => void recommendSkills()}>{skillRecommendationState === "loading" ? "JEV 评估中…" : skillRecommendationState === "ready" ? "重新评估" : "JEV 智能排序"}</button><button type="button" className="governance-text-action" disabled={busy || !skillsDirty} onClick={() => void saveSkills()}>保存生效</button></div>{skillRecommendationState === "error" && <p className="error" role="alert">JEV 评估失败：{skillRecommendationMessage}。当前按技能名称显示。</p>}{skillRecommendationState === "ready" && <p className="muted" role="status">JEV 按技能名称和说明评估与此 Agent 职责的相关性；推荐仅用于排序，不会自动绑定。</p>}<div className="governance-checkbox-list">{pagedSkills.map((skill) => { const enabled = pendingSkills.has(skill.id); const recommendation = skillRecommendations.find((item) => item.id === skill.id); return <label className="agent-skill-row" key={skill.id}><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setPendingSkills((prev) => { const next = new Set(prev); event.target.checked ? next.add(skill.id) : next.delete(skill.id); return next; })} /><span><strong>{skill.label}</strong><span className="muted">{skill.summary}</span></span>{recommendation && <span className="agent-recommendation" title={recommendation.reason}>推荐 {recommendation.rank} · {recommendation.reason}</span>}</label>; })}</div><div className="agent-pagination"><span>{orderedSkills.length ? `${skillPage * 10 + 1}–${Math.min((skillPage + 1) * 10, orderedSkills.length)} / ${orderedSkills.length}` : "0 项技能"}</span><button type="button" disabled={skillPage === 0} onClick={() => setSkillPage((p) => p - 1)}>上一页</button><span>{skillPage + 1} / {Math.max(1, Math.ceil(orderedSkills.length / 10))}</span><button type="button" disabled={(skillPage + 1) * 10 >= orderedSkills.length} onClick={() => setSkillPage((p) => p + 1)}>下一页</button></div></div></details>

          <details className="governance-card agent-collapsible" id="agent-knowledge-card" open={panelOpen.knowledge} onToggle={(event) => { const isOpen = event.currentTarget.open; setPanelOpen((p) => p.knowledge === isOpen ? p : { ...p, knowledge: isOpen }); }}><summary><span>绑定知识库</span><span className="agent-summary-count">{selected.knowledge.length} 项技能依赖</span></summary><div className="agent-card-content"><p className="muted">知识库通过技能调用；同一技能的知识库依赖由装配该技能的 Agent 共享。</p><label>调用技能<select value={knowledgeSkillId} onChange={(event) => changeKnowledgeSkill(event.target.value)}><option value="">请选择已装配的知识库查询技能</option>{selected.skills.filter((skill) => skill.enabled && data?.skills.find((catalogSkill) => catalogSkill.id === skill.skill_id)?.document_query).map((skill) => <option key={skill.skill_id} value={skill.skill_id}>{skillLabel(skill.skill_id)}</option>)}</select></label>{knowledgeSkillId && <><div className="agent-card-head"><span className="muted">选择知识库后保存；移除现有项会影响该技能的其他 Agent。</span><button type="button" className="governance-text-action" disabled={busy || ![...pendingKnowledgeBases].some((id) => !boundKnowledgeBaseIds.has(id)) && ![...boundKnowledgeBaseIds].some((id) => !pendingKnowledgeBases.has(id))} onClick={() => void saveKnowledgeSelection()}>保存生效</button></div><div className="governance-checkbox-list">{pagedKnowledgeBases.map((base) => <label className="agent-skill-row" key={base.id}><input type="checkbox" checked={pendingKnowledgeBases.has(base.id)} disabled={busy} onChange={(event) => setPendingKnowledgeBases((prev) => { const next = new Set(prev); event.target.checked ? next.add(base.id) : next.delete(base.id); return next; })} /><span><strong>{base.name}</strong><span className="muted">{base.kind === "unstructured" ? "非结构化" : "结构化"}</span></span></label>)}</div><div className="agent-pagination"><span>{visibleKnowledgeBases.length ? `${knowledgePage * 10 + 1}–${Math.min((knowledgePage + 1) * 10, visibleKnowledgeBases.length)} / ${visibleKnowledgeBases.length}` : "0 个知识库"}</span><button type="button" disabled={knowledgePage === 0} onClick={() => setKnowledgePage((p) => p - 1)}>上一页</button><span>{knowledgePage + 1} / {Math.max(1, Math.ceil(visibleKnowledgeBases.length / 10))}</span><button type="button" disabled={(knowledgePage + 1) * 10 >= visibleKnowledgeBases.length} onClick={() => setKnowledgePage((p) => p + 1)}>下一页</button></div></>}</div></details>

          <details className="governance-card agent-collapsible" id="agent-bindings-card" open={panelOpen.bindings} onToggle={(event) => { const isOpen = event.currentTarget.open; setPanelOpen((p) => p.bindings === isOpen ? p : { ...p, bindings: isOpen }); }}><summary><span>组织人员绑定</span><span className="agent-summary-count">组织版本 {selected.coverage.org_version}</span></summary><div className="agent-card-content"><p className="muted">绑定资格与覆盖名单由服务端依据权威组织树计算。</p>
            <h4 className="governance-subheading">绑定点</h4>
            {selected.bindings.length ? <div className="governance-checkbox-list">{selected.bindings.map((binding) => <div className="governance-list-row governance-row-split" key={binding.id}><span>{targetTypeLabel(binding.target_type)} · <strong>{bindingName(binding)}</strong></span><button type="button" className="governance-minor" disabled={busy || previewBusyId === binding.id} onClick={() => void revokeBinding(binding)}>{previewBusyId === binding.id ? "读取中…" : "撤销"}</button></div>)}</div> : <p className="muted">尚未绑定组织单元或人员，员工无法使用该 Agent。</p>}
            <h4 className="governance-subheading">覆盖名单（按来源分组 · 共 {selected.coverage.user_ids.length} 人）</h4>
            {VIA_ORDER.map((via) => { const rows = selected.coverage.users.filter((user) => user.via === via); return rows.length ? <div className="governance-via-group" key={via}><h4>{viaLabel(via)} · {rows.length} 人</h4><ul>{rows.map((user) => <li key={`${user.person_ref}:${user.binding_id}`}><strong>{user.display_name || user.person_ref}</strong><span>通过 {[...new Set((user.sources?.length ? user.sources : [user]).map((source) => source.via_unit_display_name || source.via_unit_id))].join("、")}</span></li>)}</ul></div> : null; })}
            {!selected.coverage.users.length && <p className="muted">当前绑定点未覆盖任何员工。</p>}
            <h4 className="governance-subheading">添加绑定</h4>
            <label>绑定目标类型<select value={targetType} onChange={(event) => { setTargetType(event.target.value as typeof targetType); setBindingSelection(new Set()); setBindPreview(null); }}><option value="organization_unit">组织单元</option><option value="person">人员</option></select></label>
            <div className="agent-org-filter-row"><label>公司<select value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); setUnitFilter({}); setBindingSelection(new Set()); setBindPreview(null); }}><option value="">选择公司</option>{companyIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>{targetType === "organization_unit" && <>{([{ level: 1, options: level1Options }, { level: 2, options: level2Options }, { level: 3, options: level3Options }] as const).map(({ level, options }) => <label key={level}>{level}级部门<select aria-label={`筛选${level}级部门`} value={unitFilter[level] || ""} disabled={!companyFilter || (level > 1 && !unitFilter[level - 1])} onChange={(event) => { setUnitFilter((prev) => ({ ...prev, [level]: event.target.value, ...(level < 2 ? { 2: "", 3: "" } : level < 3 ? { 3: "" } : {}) })); setBindingSelection(new Set()); setBindPreview(null); }}><option value="">全部</option>{options.map((unit) => <option key={unit.id} value={unit.id}>{unit.display_name}</option>)}</select></label>)}</>}</div>
            <div className="agent-target-list-head"><strong>{targetType === "person" ? "可绑定人员" : "可绑定组织单元"} · {bindCandidates.length}</strong><label className="agent-select-all"><input type="checkbox" checked={Boolean(bindCandidates.length && bindCandidates.every((target) => bindingSelection.has(target.key)))} onChange={(event) => setBindingSelection((prev) => { const next = new Set(prev); for (const target of bindCandidates) event.target.checked ? next.add(target.key) : next.delete(target.key); return next; })} />全选当前筛选</label></div>
            <div className="agent-target-list">{bindCandidates.map((target) => <label key={target.key}><input type="checkbox" checked={bindingSelection.has(target.key)} onChange={(event) => { setBindingSelection((prev) => { const next = new Set(prev); event.target.checked ? next.add(target.key) : next.delete(target.key); return next; }); setBindPreview(null); }} /><span>{target.label}</span></label>)}{!bindCandidates.length && <p className="muted">请先选择公司及部门范围，或当前范围内没有可绑定目标。</p>}</div>
            <button type="button" className="governance-minor" disabled={!selectedBindTargets.length || busy || bindPreviewBusy} onClick={() => void previewBind()}>{bindPreviewBusy ? "试算中…" : `预览绑定影响（${selectedBindTargets.length} 个目标）`}</button>
            {bindPreview && <div className="governance-via-group" data-agent-binding-preview>
              <p>组织版本 {bindPreview.org_version} · 将新增覆盖 {bindPreview.added.length} 人{bindPreview.added.length ? `（绑定后共 ${bindPreview.after.user_ids.length} 人）` : "，覆盖名单不变"}</p>
              {bindPreview.added.length > 0 && <ul>{bindPreview.added.map((entry) => <li key={`${entry.person_ref}:${entry.binding_id}`}><strong>{entry.display_name || entry.person_ref}</strong><span>{viaLabel(entry.via)}{entry.via_unit_display_name ? ` · ${entry.via_unit_display_name}` : ""}</span></li>)}</ul>}
              {!bindPreview.added.length && bindPreview.removed.length > 0 && <ul>{bindPreview.removed.map((entry) => <li key={`${entry.person_ref}:${entry.binding_id}`}><strong>{entry.display_name || entry.person_ref}</strong><span>将失去覆盖</span></li>)}</ul>}
              <div className="governance-inline-actions"><button type="button" className="btn work" disabled={busy} onClick={() => void bind()}>确认绑定</button><button type="button" className="governance-minor" disabled={busy} onClick={() => setBindPreview(null)}>取消</button></div>
            </div>}
          </div></details>

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
