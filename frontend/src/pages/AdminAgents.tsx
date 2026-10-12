import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {Link,useBlocker,useSearchParams} from "react-router-dom";
import {useAccount} from "../components/AuthGate";
import {useAdminConfirm} from "../components/ConfirmDialog";
import {agentPublishConfirm,agentDisableConfirm} from "../adminConfirm";
import {reviewApi,reviewCompany} from "../reviews/api";
import {api,type AdminAgentAuditResponse,type AdminSkillRecommendation} from "../api";
import * as client from "../admin/agents/api";
import AgentPersonnel from "../admin/agents/AgentPersonnel";
import SkillKnowledgeRange from "../admin/knowledge/SkillKnowledgeRange";
import {KnowledgeBrowseWorkspace} from "../components/KnowledgeBrowse";
import {LifecycleNavigation} from "../components/LifecycleNavigation";
import CompactButton from "../components/CompactButton";
import {TaskTheme} from "../tasks/TaskTheme";
import {Form,Input} from "antd";
import {HorizontalForm} from "../components/InformationLayout";
import WorkspaceSearchInput from "../components/WorkspaceSearchInput";
import {AgentBrowse,AgentOverview} from "../admin/agents/AgentBrowse";
import AgentOrganizationPanel from "../admin/agents/AgentOrganizationPanel";
import {randomUuid} from '../uuid';
import type {AgentBrowseFilters,AgentOrganizationDirectory} from "../../../shared/agent-organization";
import type {AgentReleaseCheck,AgentSkillOption} from "../../../shared/agent-workspace";
import "../knowledge-browse.css";
import "../components/lifecycle-workspace.css";
import "../admin/agents/agent-workspace.css";

type Mode="list"|"detail"|"create"|"edit"|"publish"|"bindings";
const modes:Mode[]=["list","detail","create","edit","publish","bindings"];
const statusName=(status:string)=>({published:"已发布",disabled:"已停用",draft:"未发布"}[status] || status);
const errorName=(error:unknown)=>error instanceof Error?error.message:"操作失败，请重试";
const time=(value:string|null|undefined)=>value?new Date(value).toLocaleString("zh-CN",{hour12:false}):"—";
const skillLink=(id:string)=>`/admin/skills?skillId=${encodeURIComponent(id)}`;

export function AdminAgents(){
 const {account}=useAccount();
 const contextKey=`agents.workspace:${account?.id || "current"}:${reviewCompany()}`;
 return <AgentWorkspace key={contextKey} contextKey={contextKey}/>;
}
function AgentWorkspace({contextKey}:{contextKey:string}){
 const [params,setParams]=useSearchParams();
 const restore=useMemo(()=>{try{return JSON.parse(sessionStorage.getItem(contextKey)||"{}");}catch{return {};}},[contextKey]);
 const mode:Mode=modes.includes(params.get("mode") as Mode)?params.get("mode") as Mode:"list";
 const selectedId=params.get("agentId") || (mode==="create"?"":restore.selectedId) || "";
 const [query,setQuery]=useState<string>(restore.query || ""),[status,setStatus]=useState<string>(restore.status || "all"),[binding,setBinding]=useState<string>(restore.binding || "all"),[draft,setDraft]=useState<string>(restore.draft || "all"),[page,setPage]=useState<number>(restore.page || 1);
 const [level1,setLevel1]=useState<string>(restore.level1||""),[level2,setLevel2]=useState<string>(restore.level2||""),[level3,setLevel3]=useState<string>(restore.level3||""),[ownership,setOwnership]=useState<string>(restore.ownership||"all");
 const filters=useMemo<AgentBrowseFilters>(()=>({query,status,binding,draft,level1,level2,level3,ownership}),[query,status,binding,draft,level1,level2,level3,ownership]);
 const [data,setData]=useState<client.AgentWorkspace|null>(null),[row,setRow]=useState<client.AgentDetail|null>(null),[loading,setLoading]=useState(true),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [detailError,setDetailError]=useState("");
 const [dirty,setDirty]=useState(false),dirtyRef=useRef(false),bodyRef=useRef<HTMLDivElement>(null),positions=useRef<Record<string,number>>(restore.positions || {}),headingRef=useRef<HTMLHeadingElement>(null);
 const listRef=useRef<HTMLElement>(null);
 const [detailActions,setDetailActions]=useState<HTMLElement|null>(null),loadSequence=useRef(0);
 const onDirty=useCallback((next:boolean)=>{dirtyRef.current=next;setDirty(next);},[]);
 const load=useCallback(async()=>{const sequence=++loadSequence.current;setLoading(true);try{const next=await client.workspace(filters);if(sequence!==loadSequence.current)return false;setData(next);setError("");setLevel1(next.browse.filters.level1);setLevel2(next.browse.filters.level2);setLevel3(next.browse.filters.level3);return true;}catch(e){if(sequence===loadSequence.current)setError(errorName(e));return false;}finally{if(sequence===loadSequence.current)setLoading(false);}},[filters]);
 useEffect(()=>{++loadSequence.current;setLoading(true);const delay=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-control'))||0;const timer=window.setTimeout(()=>void load(),delay);return()=>{window.clearTimeout(timer);++loadSequence.current;};},[load]);
 const loadDetail=useCallback(async()=>{if(!selectedId)return;try{setRow(await client.detail(selectedId));setDetailError("");}catch(e){setDetailError(errorName(e));throw e;}},[selectedId]);
 useEffect(()=>{if(mode==="list"||mode==="create"){setRow(null);setDetailError("");return;}let live=true;setDetailLoading(true);setRow(null);setDetailError("");client.detail(selectedId).then(next=>{if(live){setRow(next);setDetailError("");}}).catch(e=>{if(live)setDetailError(errorName(e));}).finally(()=>{if(live)setDetailLoading(false);});return()=>{live=false;};},[selectedId,mode]);
 const refresh=useCallback(async()=>{const [loaded]=await Promise.all([load(),loadDetail()]);if(!loaded)throw new Error('Agent 列表及组织选项读取失败，请重新读取');},[load,loadDetail]);
 const switchMode=(next:Mode,id=selectedId)=>{
  if(dirtyRef.current&&!window.confirm("当前有未保存内容，放弃修改并离开？"))return;
  onDirty(false);if(bodyRef.current)positions.current[`${mode}:${selectedId}`]=bodyRef.current.scrollTop;
  const updated=new URLSearchParams(params);updated.set("mode",next);id?updated.set("agentId",id):updated.delete("agentId");setParams(updated);
 };
 const blocker=useBlocker(()=>dirtyRef.current),asking=useRef(false);
 useEffect(()=>{if(blocker.state!=="blocked"){asking.current=false;return;}if(asking.current)return;asking.current=true;if(window.confirm("当前有未保存内容，放弃修改并离开？")){onDirty(false);blocker.proceed();}else blocker.reset();},[blocker,onDirty]);
 useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",before);return()=>window.removeEventListener("beforeunload",before);},[]);
 useEffect(()=>{sessionStorage.setItem(contextKey,JSON.stringify({...filters,page,selectedId,positions:positions.current}));},[filters,page,selectedId,mode,contextKey]);
 useLayoutEffect(()=>{if(bodyRef.current)bodyRef.current.scrollTop=positions.current[`${mode}:${selectedId}`] || 0;if(mode==="list"){if(listRef.current)listRef.current.scrollTop=positions.current.list || 0;if(selectedId)document.querySelector<HTMLButtonElement>(`[data-agent-record="${CSS.escape(selectedId)}"]`)?.focus({preventScroll:true});}else headingRef.current?.focus({preventScroll:true});},[mode,selectedId,detailLoading]);
 const changeFilter=(action:()=>void)=>{action();setPage(1);positions.current.list=0;if(listRef.current)listRef.current.scrollTop=0;};
 const saveListScroll=()=>{if(!listRef.current)return;positions.current.list=listRef.current.scrollTop;try{const saved=JSON.parse(sessionStorage.getItem(contextKey)||"{}");sessionStorage.setItem(contextKey,JSON.stringify({...saved,positions:positions.current}));}catch{/* Session storage may be unavailable; the mounted list still keeps its position. */}};
 const [check,setCheck]=useState<AgentReleaseCheck|null>(null),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState(""),requestId=useRef("");
 const prepare=useCallback(async()=>{setCheck(null);setCheckError("");setChecking(true);try{const next=await client.prepareRelease(selectedId);requestId.current=randomUuid();setCheck(next);}catch(e){setCheckError(errorName(e));}finally{setChecking(false);}},[selectedId]);
 useEffect(()=>{if(mode==="publish")void prepare();},[mode,prepare]);
 const {ask,dialog}=useAdminConfirm();
 const publish=()=>{if(!check||!row)return;const copy=agentPublishConfirm({name:check.content.name,id:row.id,enabledSkills:check.content.skills.length,bindings:check.binding_count,users:check.coverage_count,orgVersion:check.org_version});ask({...copy,scope:`修订草稿 r${check.revision} → 已发布 v${(row.published_revision || 0)+1}`,consequence:"确认后应用本次名称、职责与技能装配。覆盖表示人员资格；考试、依赖状态与执行规则仍由服务端校验。绑定和启停是独立动作。"},async()=>{const receipt=await client.release(row.id,check.preparation_id,requestId.current);setNotice(`已发布 v${receipt.version} · 回执 ${receipt.id}`);await load();switchMode("detail",row.id);});};
 const availability=(next:"published"|"disabled")=>{if(!row)return;const copy=agentDisableConfirm(row.name,row.id);ask(next==="disabled"?copy:{...copy,title:"启用 Agent",scope:`恢复已发布 v${row.published_revision} · 修订草稿继续保留`,consequence:"确认后恢复已有发布版本的使用资格；本次不应用修订草稿。考试与执行规则仍由服务端校验。",confirmLabel:"确认启用",confirmTone:"primary"},async()=>{await client.availability(row,next);setNotice(next==="disabled"?"Agent 已停用，绑定与修订草稿保留":"已恢复已有发布版本");await refresh();});};
 const title=mode==="list"?"Agent":mode==="create"?"新建 Agent 草稿":mode==="edit"?"修订 Agent":mode==="publish"?"发布检查":mode==="bindings"?"人员绑定":row?.name || "Agent 详情";
 const pane = mode==="create"?"edit":mode==="list"?"detail":mode;
 return <div className="agent-workspace knowledge-browse" data-agent-mode={mode} aria-busy={loading||detailLoading||checking}>{dialog}
  <KnowledgeBrowseWorkspace detailOpen={mode!=="list"}>
   <AgentBrowse data={data} loading={loading} error={error} filters={filters} page={page} selectedId={selectedId} listRef={listRef} onScroll={saveListScroll}
    onFilter={(key,value)=>changeFilter(()=>{({query:setQuery,status:setStatus,binding:setBinding,draft:setDraft,level1:setLevel1,level2:setLevel2,level3:setLevel3,ownership:setOwnership}[key])(value);if(key==='level1'){setLevel2('');setLevel3('');}if(key==='level2')setLevel3('');})}
    onPage={next=>{setPage(next);positions.current.list=0;if(listRef.current)listRef.current.scrollTop=0;}} onSelect={id=>switchMode("detail",id)} onCreate={()=>switchMode("create","")} onReset={()=>changeFilter(()=>{setQuery("");setStatus("all");setBinding("all");setDraft("all");setLevel1('');setLevel2('');setLevel3('');setOwnership('all');})} onReload={()=>void load()}/>
   <main className="kbv-rail agent-workarea" aria-label="Agent 治理工作区" data-agent-right>
    <LifecycleNavigation label="Agent 管理视图" mode="views" idPrefix="agent-view" value={pane}
     options={[{id:"detail",label:"Agent 资产"},{id:"edit",label:"修订草稿",disabled:mode!=="create"&&!row},{id:"publish",label:"发布检查",disabled:!row?.draft},{id:"bindings",label:"人员绑定",disabled:!row}]}
     onChange={next=>switchMode(next==="detail"?(mode==="list"?"list":"detail"):next==="edit"&&mode==="create"?"create":next as Mode)}/>
    <header className="agent-workhead"><div><h2 tabIndex={-1} ref={headingRef}>{mode==="list"?"Agent 资产":title}</h2><p>{mode==="list"?"管理职责、技能装配与人员使用资格":mode==="create"||mode==="edit"?"保存草稿后，检查并确认发布才会应用能力变更":mode==="bindings"?"绑定独立于修订草稿，确认后立即生效":mode==="publish"?"核对变更、人员覆盖与依赖条件后确认":statusName(row?.status || "")+(row?.published_revision?" · v"+row.published_revision:"")}</p></div>{mode!=="list"&&<CompactButton onClick={()=>switchMode("list")}>返回列表</CompactButton>}</header>
    {notice&&<p className="agent-notice" role="status">{notice}</p>}{detailError&&mode!=="list"&&<div className="agent-notice" role="alert">{detailError} <CompactButton onClick={()=>void loadDetail().catch(()=>undefined)}>重新读取详情</CompactButton></div>}
    <div className="agent-workbody" ref={bodyRef} role="tabpanel" id={"agent-view-panel-"+pane} aria-labelledby={"agent-view-tab-"+pane}>
     {mode==="list"&&data&&<AgentOverview data={data} onCreate={()=>switchMode("create","")} onUnbound={()=>changeFilter(()=>setBinding("unbound"))} onDrafts={()=>changeFilter(()=>setDraft("with"))} onUnassigned={()=>changeFilter(()=>{setLevel1('');setLevel2('');setLevel3('');setOwnership('unassigned');})}/>}
     {mode==="list"&&!data&&!error&&<p role="status">正在读取 Agent 资产…</p>}
    {mode==="create"&&data&&<AgentEditor skills={data.skills} onDirty={onDirty} onCancel={()=>switchMode("list")} onSaved={async id=>{onDirty(false);setNotice("草稿已保存，尚未发布");await load();switchMode("detail",id);}}/>}
    {mode!=="list"&&mode!=="create"&&detailLoading&&<p role="status">正在读取 Agent 有效版本、草稿与覆盖依据…</p>}
    {row&&!detailLoading&&mode==="detail"&&data&&<AgentInformation key={row.id} row={row} skills={data.skills} directory={data.organization_directory} actionTarget={detailActions} onDirty={onDirty} onChanged={refresh} notify={setNotice}/>}
    {row&&!detailLoading&&mode==="edit"&&data&&<AgentEditor key={row.id} row={row} skills={data.skills} onDirty={onDirty} onCancel={()=>switchMode("detail")} onSaved={async id=>{onDirty(false);setNotice("修订草稿已保存；现有发布版本继续保留");await load();switchMode("detail",id);}}/>}
    {row&&!detailLoading&&mode==="bindings"&&data&&<AgentPersonnel row={row} data={data} onChanged={refresh} onDirty={onDirty} notify={setNotice}/>}
    {mode==="publish"&&<>{checking&&<p role="status">正在核对草稿、技能版本、人员绑定与组织依据…</p>}{checkError&&<p role="alert">{checkError}</p>}{check&&<><section><h3>本次应用 · 修订草稿 r{check.revision}</h3><p><strong>{check.content.name}</strong></p><p>{check.content.description || "尚未填写职责说明"}</p><p>已装配 {check.content.skills.length} 项技能。{check.added_skills.length+check.removed_skills.length+check.updated_skills.length===0&&"技能装配未变化；名称和职责按上述草稿应用。"}</p>{([['新增',check.added_skills],['移除',check.removed_skills],['应用新版本',check.updated_skills]] as const).map(([label,ids])=>ids.length>0&&<p key={label}>{label}：{ids.map(id=>data?.skills.find(value=>value.id===id)?.label || id).join("、")}</p>)}</section><section><h3>人员覆盖</h3><p>组织版本 {check.org_version} · {check.binding_count} 个绑定点 · 覆盖 {check.coverage_count} 个员工账号</p><p>覆盖表示使用资格来源，仍须满足考试和业务执行规则。</p></section><section><h3>发布条件</h3>{check.blockers.length?<ul role="alert">{check.blockers.map(value=><li key={value}>{value}</li>)}</ul>:<p>服务端已通过本次发布条件核对。</p>}{check.warnings.length>0&&<ul>{check.warnings.map(value=><li key={value}>{value}</li>)}</ul>}<p>预检有效至 {time(check.expires_at)}。确认时会重新核对，依据变化后须重新检查。</p></section></>}</>}
   </div>
   {mode==="detail"&&row&&<footer ref={setDetailActions} className="agent-actionbar">{!dirty&&<><CompactButton className="agent-text-action" onClick={()=>switchMode("bindings")}>管理人员绑定</CompactButton>{row.status==="published"&&<CompactButton className="agent-text-action" onClick={()=>availability("disabled")}>停用</CompactButton>}{row.status==="disabled"&&<CompactButton className="agent-text-action" onClick={()=>availability("published")}>启用已有版本</CompactButton>}<span className="agent-action-spacer"/>{row.draft?<><CompactButton onClick={()=>switchMode("edit")}>继续修订草稿</CompactButton><CompactButton emphasis="primary" className="btn work" onClick={()=>switchMode("publish")}>检查并发布</CompactButton></>:<CompactButton emphasis="primary" className="btn work" onClick={()=>switchMode("edit")}>创建修订草稿</CompactButton>}</>}</footer>}
   {mode==="publish"&&<footer className="agent-actionbar"><CompactButton className="agent-text-action" onClick={()=>switchMode("detail")}>返回详情</CompactButton><CompactButton className="agent-text-action" disabled={checking} onClick={()=>void prepare()}>重新检查</CompactButton><span className="agent-action-spacer"/><CompactButton emphasis="primary" className="btn work" disabled={!check||checking||Boolean(check.blockers.length)||detailLoading} onClick={publish}>确认发布（R3）</CompactButton></footer>}
   {mode==="bindings"&&<footer className="agent-actionbar"><span>{dirty?"尚有未确认的绑定选择":"已确认绑定独立生效"}</span><span className="agent-action-spacer"/><CompactButton className="agent-text-action" onClick={()=>switchMode("detail")}>返回详情</CompactButton></footer>}
  </main>
  </KnowledgeBrowseWorkspace>
 </div>;
}

function AgentEditor({row,skills,onDirty,onCancel,onSaved}:{row?:client.AgentDetail;skills:AgentSkillOption[];onDirty:(value:boolean)=>void;onCancel:()=>void;onSaved:(id:string)=>Promise<void>}){
 const initial=row?.draft || row?.effective;
 const [name,setName]=useState(initial?.name || ""),[description,setDescription]=useState(initial?.description || ""),[chosen,setChosen]=useState<Set<string>>(new Set(initial?.skills.map(value=>value.skill_id) || [])),[query,setQuery]=useState(""),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [recommendations,setRecommendations]=useState<AdminSkillRecommendation["items"]>([]),[recommendationBusy,setRecommendationBusy]=useState(false),[recommendationMessage,setRecommendationMessage]=useState("");
 const saving=useRef(false);
 const missingRef=useRef<HTMLElement>(null);
 const [basis,setBasis]=useState<{revision:number;version:number}|null>(null);
 const missingSkills=[...new Set([...(initial?.skills.map(value=>value.skill_id)||[]),...chosen])].filter(id=>!skills.some(skill=>skill.id===id));
 const selectedMissing=missingSkills.filter(id=>chosen.has(id));
 const visible=skills.filter(value=>`${value.label} ${value.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b)=>(recommendations.find(value=>value.id===a.id)?.rank || 999)-(recommendations.find(value=>value.id===b.id)?.rank || 999));
 const pages=Math.max(1,Math.ceil(visible.length/10)),currentPage=Math.min(page,pages);
 const touch=(action:()=>void)=>{action();onDirty(true);};
 async function save(){if(saving.current)return;if(selectedMissing.length){setError(`请先取消选择目录中不存在的技能：${selectedMissing.join('、')}`);missingRef.current?.focus();return;}saving.current=true;setBusy(true);setError("");try{const next=await client.saveDraft(row?.id || null,{name,description,skill_ids:[...chosen],expected_revision:basis?.revision ?? row?.draft?.revision ?? 0,...(row?{expected_version:basis?.version ?? row.version}:{})});onDirty(false);await onSaved(next.id);}catch(e){setError(errorName(e));}finally{saving.current=false;setBusy(false);}}
 async function refreshBasis(){if(!row)return;setBusy(true);try{const latest=await client.detail(row.id),candidate=latest.draft || latest.effective;if(!window.confirm(`服务端最新版本：${candidate.name}，${candidate.skills.length} 项技能，${latest.draft?`草稿 r${latest.draft.revision}`:`已发布 v${latest.published_revision}`}。保留当前输入，并采用最新版本依据重新保存？`))return;setBasis({revision:latest.draft?.revision || 0,version:latest.version});setError("已重新读取版本依据；请核对当前输入后保存");}catch(e){setError(errorName(e));}finally{setBusy(false);}}
 async function recommend(){if(!row)return;setRecommendationBusy(true);setRecommendationMessage("");try{const value=await api.adminAgentSkillRecommendations(row.id,skills.map(skill=>skill.id));setRecommendations(value.items);setPage(1);setRecommendationMessage(`建议已生成 · ${value.items.length} 项；请按职责自行选择`);}catch(e){setRecommendationMessage(errorName(e));}finally{setRecommendationBusy(false);}}
 return <div className="agent-editor"><div className="agent-editor-body"><section><h3>职责与身份</h3><TaskTheme><HorizontalForm component={false}>
  <Form.Item label="Agent 名称" className="ui-field-wide"><Input aria-label="Agent 名称" value={name} maxLength={80} disabled={busy} onChange={e=>touch(()=>setName(e.target.value))}/></Form.Item>
  <Form.Item label="职责说明" className="ui-field-stacked"><Input.TextArea aria-label="职责说明" value={description} maxLength={500} disabled={busy} rows={3} onChange={e=>touch(()=>setDescription(e.target.value))}/></Form.Item>
 </HorizontalForm></TaskTheme>{row&&<><p className="agent-help">数字员工组织归属：{row.organization.assignment?.path.map(unit=>unit.display_name).join(' / ')||'未设置组织归属'}</p><CompactButton onClick={onCancel}>在资产详情中调整归属</CompactButton></>}</section>
  <section><h3>装配技能 · 已选 {chosen.size} 项</h3><p>知识、工具与数据依赖随技能装配；不同知识范围应使用独立知识技能。</p>
   {missingSkills.length>0&&<section ref={missingRef} tabIndex={-1} aria-label="目录缺失技能"><h4>目录缺失技能 · {selectedMissing.length} 项仍选中</h4><p>以下技能已不在当前目录。请确认后取消选择，才能保存草稿；移除需确认发布才生效。</p>{missingSkills.map(id=><div className="agent-capability-row" key={id}><label className="agent-checkbox"><input type="checkbox" disabled={busy} checked={chosen.has(id)} onChange={e=>touch(()=>{const next=new Set(chosen);e.target.checked?next.add(id):next.delete(id);setChosen(next);})}/><strong>{id}</strong></label><p>{chosen.has(id)?'目录缺失 · 尚未移除':'已从当前草稿选择中移除 · 尚未发布'}</p></div>)}</section>}
   <div className="agent-skill-tools"><WorkspaceSearchInput aria-label="搜索技能" placeholder="搜技能名称、职责关键词" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>{row&&<CompactButton className="agent-text-action" disabled={busy||recommendationBusy} onClick={()=>void recommend()}>{recommendationBusy?"正在生成建议…":"获取技能建议"}</CompactButton>}</div>{recommendationMessage&&<p role="status">{recommendationMessage}</p>}
   <label className="agent-checkbox"><input type="checkbox" disabled={busy||!visible.length} checked={Boolean(visible.length&&visible.every(value=>chosen.has(value.id)))} onChange={e=>touch(()=>{const next=new Set(chosen);visible.forEach(value=>e.target.checked?next.add(value.id):next.delete(value.id));setChosen(next);})}/>全选当前筛选（{visible.length} 项）</label>
   {visible.slice((currentPage-1)*10,currentPage*10).map(skill=><div className="agent-capability-row" key={skill.id}><label className="agent-checkbox"><input type="checkbox" disabled={busy} checked={chosen.has(skill.id)} onChange={e=>touch(()=>{const next=new Set(chosen);e.target.checked?next.add(skill.id):next.delete(skill.id);setChosen(next);})}/><strong>{skill.label}</strong></label><p>{skill.summary}</p><p>{skill.published?"已发布":"尚未发布或已停用"} · {skill.risk || "风险尚未登记"}{skill.execution==="async_job"?" · 异步作业（需进度、取消与重试）":""}{skill.document_query?` · 知识依赖 ${skill.knowledge_revision?`v${skill.knowledge_revision}`:"尚未正式发布"}`:""}</p>{recommendations.find(value=>value.id===skill.id)?.reason&&<p>建议依据：{recommendations.find(value=>value.id===skill.id)?.reason}</p>}<Link to={skillLink(skill.id)}>查看技能与依赖</Link></div>)}{!visible.length&&<p>没有符合搜索条件的技能。</p>}
   <div className="agent-pagination"><span>第 {currentPage} / {pages} 页</span><CompactButton className="agent-text-action" disabled={currentPage<=1} onClick={()=>setPage(currentPage-1)}>上一页</CompactButton><CompactButton className="agent-text-action" disabled={currentPage>=pages} onClick={()=>setPage(currentPage+1)}>下一页</CompactButton></div>
  </section>{error&&<div role="alert"><p>{error}。当前输入仍保留。</p>{row&&<CompactButton className="agent-text-action" disabled={busy} onClick={()=>void refreshBasis()}>重新读取版本依据</CompactButton>}</div>}
 </div><footer className="agent-actionbar"><span>R2 · 保存仅写入草稿</span><span className="agent-action-spacer"/><CompactButton className="agent-text-action" disabled={busy} onClick={onCancel}>取消修订</CompactButton><CompactButton emphasis="primary" className="btn work" disabled={busy||!name.trim()} onClick={()=>void save()}>{busy?"正在保存…":"保存草稿"}</CompactButton></footer></div>;
}

function KnowledgeRange({id}:{id:string}){const [open,setOpen]=useState(false);return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>有效知识范围与共享依赖</summary>{open&&<SkillKnowledgeRange skillId={id} compact/>}</details>;}
function AgentInformation({row,skills,...organizationProps}:{row:client.AgentDetail;skills:AgentSkillOption[];directory:AgentOrganizationDirectory;actionTarget:HTMLElement|null;onDirty:(value:boolean)=>void;onChanged:()=>Promise<void>;notify:(value:string)=>void}){
 return <><section><h3>职责与身份</h3><p>{row.effective.description || "尚未填写职责说明"}</p><p className="agent-help">更新于 {time(row.updated_at)}{!row.published_revision?" · 尚无已发布版本":""}</p>{row.draft&&<p className="agent-help">有修订草稿 r{row.draft.revision} · {time(row.draft.updated_at)} · 保存者 {row.draft.updated_by}。能力变更尚未应用。</p>}</section>
  <AgentOrganizationPanel row={row} {...organizationProps}/>
  <section><h3>{row.published_revision?"有效能力":"待装配能力"} · {row.effective.skills.length} 项技能</h3>{row.effective.skills.map(pin=>{const skill=skills.find(value=>value.id===pin.skill_id);return <div className="agent-capability-row" key={pin.skill_id}><strong>{skill?.label || pin.skill_id}</strong><p>{skill?.summary || "技能已不在当前目录中"}</p><p>{skill?.risk || "风险尚未登记"} · 发布指纹 {pin.release_hash.slice(0,12)}{skill?.execution==="async_job"?" · 异步作业（需进度、取消与重试）":""}</p>{skill?.resources.map(value=><p key={value.id}>资源 {value.id} · {value.configured&&value.enabled&&value.tool_count?"已配置并启用，未实时探测":"依赖未就绪"}</p>)}<Link to={skillLink(pin.skill_id)}>查看技能与依赖</Link>{skill?.document_query&&<KnowledgeRange id={pin.skill_id}/>}</div>;})}{!row.effective.skills.length&&<p>尚未装配技能；通过修订草稿添加。</p>}</section>
  <section><h3>人员使用资格</h3><p>{row.bindings.length} 个绑定点 · 覆盖 {row.coverage.user_ids.length} 个员工账号 · 组织版本 {row.coverage.org_version}</p><p>覆盖来自组织树和人员绑定。绑定来源与实际执行条件分别核对。</p><p>{row.exam_blocked.length} 个覆盖账号仍有必考任务未通过</p>{row.exam_blocked.length>0&&<details><summary>查看考试阻断</summary><ul>{row.exam_blocked.map(value=><li key={value.user_id}>{value.name || value.user_id} · {value.missing} 项</li>)}</ul></details>}</section>
  <section><h3>依赖与执行条件</h3>{row.dependency_issues.length?<ul>{row.dependency_issues.map(value=><li key={value}>{value}</li>)}</ul>:<p>当前配置未发现依赖问题。</p>}<p>此处是配置状态投影；真实调用仍需通过资源探测、人员资格、考试与业务规则。</p></section>
  <section><h3>发布版本与回执</h3>{row.versions.map(value=><details key={value.version}><summary>v{value.version} · {value.receipt_id?`${time(value.published_at)} · ${value.published_by}`:`历史现有装配记录 · 最后管理更新时间 ${time(value.published_at)}`}</summary><p>{value.name} · {value.description}</p><ul>{value.skills.map(pin=><li key={pin.skill_id}>{skills.find(skill=>skill.id===pin.skill_id)?.label || pin.skill_id} · {pin.release_hash.slice(0,12)}{pin.knowledge_revision?` · 知识依赖 v${pin.knowledge_revision}`:""}</li>)}</ul>{value.receipt_id?<p>回执：{value.receipt_id}</p>:<p>此记录在首次修订时归档现有装配；原始发布人、发布时间及回执未记录。</p>}</details>)}{!row.versions.length&&<p>{row.published_revision?"历史 Agent 尚未形成完整版本快照，首次修订时归档现有装配。":"尚无发布记录。"}</p>}</section>
  <AgentAudit key={row.id} id={row.id}/>
 </>;
}
const auditNames:Record<string,string>={"admin.agent.draft.save":"保存修订草稿","admin.agent.release.publish":"确认发布版本","admin.agent.availability":"启停 Agent","admin.agent.binding.add":"添加人员绑定","admin.agent.binding.revoke":"撤销人员绑定","admin.agent.organization.change":"调整组织归属"};
function AgentAudit({id}:{id:string}){
 const [data,setData]=useState<AdminAgentAuditResponse|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(async(cursor?:number|string|null)=>{setBusy(true);try{const next=await reviewApi<AdminAgentAuditResponse>(`/admin/agents/${encodeURIComponent(id)}/audit?limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);setData(previous=>cursor?{...next,items:[...(previous?.items || []),...next.items]}:next);setError("");}catch(e){setError(errorName(e));}finally{setBusy(false);}},[id]);
 useEffect(()=>{void load();},[load]);
 return <section><h3>近期审计</h3>{error&&<p role="alert">{error} <CompactButton className="agent-text-action" onClick={()=>void load()}>重试</CompactButton></p>}{!data&&!error&&<p role="status">正在读取审计…</p>}{data?.items.map(value=><details key={value.id}><summary>{auditNames[value.event_type] || value.event_type} · {value.actor} · {time(value.ts)}</summary><pre>{JSON.stringify(value.payload,null,2)}</pre></details>)}{data&&!data.items.length&&<p>暂无审计记录。</p>}{data?.next_cursor&&<CompactButton className="agent-text-action" disabled={busy} onClick={()=>void load(data.next_cursor)}>{busy?"正在读取…":"更多记录"}</CompactButton>}</section>;
}
