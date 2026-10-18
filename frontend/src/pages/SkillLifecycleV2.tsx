import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {useSearchParams} from "react-router-dom";
import { api } from "../api";
import { DetailPanel, type SkillRow, useUnsavedDetailGuard } from "./SkillLifecycle";
import { useAdminConfirm } from "../components/ConfirmDialog";
import {SkillAuthoringForm} from './SkillAuthoringForm';
import { skillLifecyclePublishConfirm, skillStageConfirm } from "../adminConfirm";
import type { SkillCoverage } from "../runtimeConnectorUi";
import "../admin/governance-layout.css";
import "./skill-governance.css";
import "./skill-governance-v2.css";
import KnowledgeSkillWizard from '../admin/knowledge/KnowledgeSkillWizard';
import SkillKnowledgeRange from '../admin/knowledge/SkillKnowledgeRange';

const stageName = (skill: SkillRow) => skill.lifecycle?.stage_label || skill.lifecycle?.stage || "草稿";
const STAGE_NAME: Record<string, string> = { draft: "草稿", editing: "编辑", testing: "测试", published: "已发布", disabled: "停用" };
export default function SkillLifecycleV2() {
  const [params,setParams]=useSearchParams();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [selectedId, setSelectedId] = useState(params.get("skillId") || "");
  useEffect(()=>{const requested=params.get("skillId");if(requested)setSelectedId(requested);},[params]);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<"all" | "official" | "third_party">("all");
  const [stage, setStage] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor,setEditor]=useState<{mode:'new'|'import'|'edit'|'clone';id?:string}|null>(null);
  const [knowledgeCreateOpen,setKnowledgeCreateOpen]=useState(false);
  const [metricsDays, setMetricsDays] = useState(7);
  const [coverage, setCoverage] = useState<SkillCoverage | null>(null);
  const [legacyGrants, setLegacyGrants] = useState<{ notice: string; count: number } | null>(null);
  const { ask, dialog } = useAdminConfirm();
  const detailDirtyRef = useRef(false);
  const { onDirtyChange, confirmDiscard, modalHolder } = useUnsavedDetailGuard();
  const onDetailDirtyChange = useCallback((dirty: boolean) => {
    detailDirtyRef.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);
  const load = useCallback(async () => {
    // 实现度读数是运行时覆盖的独立读模型：读不到不能让整个技能页失效，详情里降级为「未读取」。
    const [skillsResult, coverageResult] = await Promise.allSettled([api.adminSkills(), api.runtimeSkillCoverage()]);
    if (skillsResult.status === "fulfilled") {
      const response = skillsResult.value as { skills?: SkillRow[] };
      const rows = response.skills || [];
      // DetailPanel retains dirty local fields section-by-section.  Keep the
      // list projection fresh after a successful save, but never let a stale
      // response clear the selected id while that panel is still dirty.
      setSkills(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) || detailDirtyRef.current ? current : rows[0]?.id || "");
      setError("");
    } else {
      setError(skillsResult.reason instanceof Error ? skillsResult.reason.message : "技能读取失败");
    }
    setCoverage(coverageResult.status === "fulfilled" ? coverageResult.value : null);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // user_skill_grants 已退役：有残留记录时提示迁移，不阻塞页面。
    api.legacySkillGrants()
      .then((result) => { if (result.count > 0) setLegacyGrants({ notice: result.notice, count: result.count }); })
      .catch(() => {});
  }, []);
  const coverageById = useMemo(() => new Map((coverage?.skills || []).map((row) => [row.skill_id, row])), [coverage]);
  const selected = skills.find((skill) => skill.id === selectedId) || null;
  const visible = useMemo(() => skills.filter((skill) => {
    const official = skill.lifecycle?.origin === "official" || (skill.lifecycle?.origin !== "third_party" && skill.source === "bundled");
    if (origin === "official" && !official) return false;
    if (origin === "third_party" && official) return false;
    if (stage !== "all" && skill.lifecycle?.stage !== stage) return false;
    return `${skill.label} ${skill.id} ${skill.description}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [skills, origin, stage, query]);
  useEffect(()=>{const mode=params.get('authoring');setEditor(mode&&['new','import','edit','clone'].includes(mode)?{mode:mode as 'new'|'import'|'edit'|'clone',...(['edit','clone'].includes(mode)&&params.get('skillId')?{id:params.get('skillId')!}:{})}:null);},[params]);
  const authoringRoute=(mode?:'new'|'import'|'edit'|'clone',id?:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(mode)next.set('authoring',mode);else next.delete('authoring');if(id)next.set('skillId',id);return next;});
  const openEditor=(mode:'new'|'import'|'edit'|'clone',id?:string)=>confirmDiscard(()=>authoringRoute(mode,id));
  const selectSkill = useCallback((id: string) => {
    if (id === selectedId&&!params.get('authoring')) return;
    confirmDiscard(() => {setSelectedId(id);setParams(previous=>{const next=new URLSearchParams(previous);next.set('skillId',id);next.delete('authoring');return next;});});
  }, [confirmDiscard, selectedId,params,setParams]);
  const closeDetail = useCallback(() => {
    confirmDiscard(() => setSelectedId(""));
  }, [confirmDiscard]);
  const moveStage = (next: string, needReason?: boolean) => {
    if (!selected) return;
    ask(
      next === "published"
        ? skillLifecyclePublishConfirm(selected.label, selected.id)
        : skillStageConfirm({ title: selected.label, id: selected.id, from: stageName(selected), to: STAGE_NAME[next] || next, needReason }),
      async (reason) => {
        await api.skillLifecycleStage(selected.id, next, reason || undefined);
        setNotice(`技能阶段已更新为 ${STAGE_NAME[next] || next}。`);
        await load();
      },
    );
  };
  return <section className="governance-workspace skill-governance-v2" data-admin-page="skills">
    <aside className="governance-rail">
      <div className="governance-scroll">
        <WorkspaceSearchInput className="governance-search" aria-label="搜索技能" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、Key 或说明" />
        <p className="governance-count">{visible.length} / {skills.length} 项技能</p>
        <div className="governance-filter-group"><strong>来源</strong><div className="governance-filter-options">{([["all", "全部"], ["official", "官方"], ["third_party", "第三方"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={origin === key} onClick={() => setOrigin(key)}>{label}</button>)}</div></div>
        <div className="governance-filter-group"><strong>阶段</strong><div className="governance-filter-options">{([["all", "全部"], ["draft", "草稿"], ["editing", "编辑"], ["testing", "测试"], ["published", "已发布"], ["disabled", "停用"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={stage === key} onClick={() => setStage(key)}>{label}</button>)}</div></div>
        <h2 className="governance-subheading">技能列表</h2>
        <div className="governance-list">{visible.map((skill) => <button type="button" key={skill.id} className={`governance-list-row skill-v2-row${selectedId === skill.id ? " is-selected" : ""}`} onClick={() => selectSkill(skill.id)}><strong>{skill.label}</strong><span className="muted">{skill.category || "未分类"}</span><span>{stageName(skill)}</span></button>)}{!visible.length && <p className="governance-empty">没有符合条件的技能。</p>}</div>
      </div>
      <div className="governance-rail-footer"><button type="button" className={editor?'governance-minor':'btn work'} onClick={()=>openEditor('new')}>新增技能</button></div>
    </aside>
    <div className="governance-main"><header className="governance-main-head"><h2>{editor?'技能业务配置':selected?.label || "技能详情"}</h2>{selected&&<><button type="button" className="governance-minor" onClick={()=>openEditor('edit',selected.id)}>业务配置</button><button type="button" className="governance-minor" onClick={()=>openEditor('clone',selected.id)}>复用为新技能</button></>}<button type="button" className="governance-minor" onClick={()=>confirmDiscard(()=>setKnowledgeCreateOpen(true))}>新建知识技能</button><button type="button" className="governance-minor" onClick={() => openEditor('import')}>上传 SKILL.md</button></header>
      <div className="governance-scroll">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="governance-notice" role="status">{notice}</p>}
        {legacyGrants && <p className="skill-governance-notice" role="note">直接技能授权已退役：残留 {legacyGrants.count} 条待迁移记录（{legacyGrants.notice}）</p>}
        {editor?<SkillAuthoringForm key={`${editor.mode}:${editor.id||''}`} mode={editor.mode} skillId={editor.id} onDirtyChange={onDetailDirtyChange} onClose={()=>confirmDiscard(()=>authoringRoute(undefined,selectedId))} onSaved={id=>{setSelectedId(id);authoringRoute(undefined,id);setNotice('技能草稿已保存；请在原生命周期完成依赖接入、测试与发布，再装配到Agent。');void load();}}/>:selected ? <div className="skill-v2-detail">{selected.document_query && <SkillKnowledgeRange key={`range-${selected.id}`} skillId={selected.id} />}<DetailPanel key={selected.id} skill={selected} coverageRow={coverageById.get(selected.id) || null} onStage={(next, reason) => moveStage(next, reason)} onChanged={load} onDirtyChange={onDetailDirtyChange} metricsDays={metricsDays} onMetricsDays={setMetricsDays} onClose={closeDetail} /></div>
          : <p className="governance-empty">选择一项技能查看详情。</p>}
      </div>
    </div>
    {dialog}
    {modalHolder}
    {knowledgeCreateOpen && <KnowledgeSkillWizard onClose={()=>setKnowledgeCreateOpen(false)} onCreated={id=>{setKnowledgeCreateOpen(false);setSelectedId(id);setNotice('知识技能草稿已保存。请核对知识依赖、完成真实试算后发布，再挂载到智能体。');void load();}} />}
  </section>;
}
