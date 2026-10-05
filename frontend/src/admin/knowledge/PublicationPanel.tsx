import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewCommand, ReviewTemplate, ReviewField } from "../../../../shared/review";
import { ReviewForm } from "../../reviews/ReviewForm";
import { reviewApi, type ReviewContext } from "../../reviews/api";
import { useAdminConfirm } from "../../components/ConfirmDialog";

type State = {
  tenant:string;label?:string;base_id:string;version:number;review_status:string;publication_status:string;
  blocking_reason:string;allowed_actions:string[];instance_id:string|null;error:string|null;attempts:number;
  binding:{template_id:string;version:number;name:string}|null;
  fields?: ReviewField[];
};
function commandKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),b => b.toString(16).padStart(2,"0")).join("");
}
export default function PublicationPanel({id,updatedAt,reload}:{id:string;updatedAt:string;reload:()=>void}) {
  const [state,setState]=useState<State>(),[ctx,setCtx]=useState<ReviewContext>(),[templates,setTemplates]=useState<ReviewTemplate[]>([]);
  const [note,setNote]=useState(""),[chosen,setChosen]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [values,setValues]=useState<Record<string, unknown>>({});
  const [uploadBusy,setUploadBusy]=useState(false);
  useEffect(()=>{setValues({});},[state?.binding?.template_id,state?.binding?.version]);
  const confirm=useAdminConfirm();
  async function load() { setState(await reviewApi<State>(`/admin/knowledge/documents/${id}/publication`)); }
  useEffect(() => {
    let live=true;
    setState(undefined);setError("");setNote("");setValues({});
    Promise.all([reviewApi<State>(`/admin/knowledge/documents/${id}/publication`),reviewApi<ReviewContext>("/approvals/v2/context"),reviewApi<ReviewTemplate[]>("/admin/approval-types/v2/templates")])
      .then(([s,c,t])=>{if(live){setState(s);setCtx(c);setTemplates(t.filter(x=>x.definition.subjectType==="knowledge_publication" && x.publishedVersion && x.enabled!==false));}})
      .catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  },[id,updatedAt]);
  useEffect(()=>{
    if(!state || !["reviewing","awaiting_amendment","approved"].includes(state.review_status) || state.publication_status==="published")return;
    let live=true;
    const timer=setInterval(()=>{reviewApi<State>(`/admin/knowledge/documents/${id}/publication`).then(s=>{if(live)setState(s);}).catch(e=>{if(live)setError(e.message);});},3000);
    return ()=>{live=false;clearInterval(timer);};
  },[id,state?.review_status,state?.publication_status]);
  async function run(action:()=>Promise<unknown>){setBusy(true);setError("");try{await action();await load();reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function submit(){
    setBusy(true);setError("");
    try {
      const p=await reviewApi<{confirmationId:string;command:ReviewCommand;material:{title:string;base_name:string;pages:number;version:number};summary:{consequence:string;reviewers?:string[]}}>(`/admin/knowledge/documents/${id}/review-prepare`,{note,values});
      const key=commandKey();
      confirm.ask({kind:"approval-initiate",title:"确认提交知识发布审批",object:`${p.material.title} · v${p.material.version} · ${p.material.pages}页`,scope:p.material.base_name,
        change:`发布说明：${note}${(state?.fields || []).map(field=>`\n${field.label}：${JSON.stringify(values[field.id] ?? "未填写")}`).join("")}\n审核人：${p.summary.reviewers?.map(x=>ctx?.people.find(y=>y.id===x)?.name || x).join("、") || "由流程解析"}`,
        consequence:p.summary.consequence,confirmLabel:"确认提交审批",confirmTone:"primary"},async()=>{
          await reviewApi("/approvals/v2/commands",{command:p.command,confirmationId:p.confirmationId,idempotencyKey:key});
          await load();reload();
        });
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const back=`/admin/knowledge?document=${encodeURIComponent(id)}`;
  const create=`/admin/approval-types?subject=knowledge_publication&returnTo=${encodeURIComponent(back)}${state ? `&reviewCompany=${encodeURIComponent(state.tenant)}`:""}`;
  return <section aria-label="知识发布审批" data-knowledge-publication>
    {!state && !error && <p role="status">正在检查发布流程…</p>}
    {error && <p role="alert">{error}<button className="kbv-link-plain" onClick={()=>void run(load)} disabled={busy}>重新检查</button></p>}
    {state && <>
      <p role="status">{state.label || "尚未提交审批"} · v{state.version}</p>
      {state.error && <p role="alert">{state.error} · 已尝试{state.attempts}次</p>}
      {state.instance_id && <Link className="kbv-link-plain" to={`/reviews/${encodeURIComponent(state.instance_id)}?reviewCompany=${encodeURIComponent(state.tenant)}`}>查看本次审批与发布回执 →</Link>}
      {!state.instance_id && state.blocking_reason && <p>{state.blocking_reason}；资料与解析产物保留。</p>}
      {ctx?.admin && <details><summary>{state.binding ? `发布流程：${state.binding.name}` : "配置知识发布流程"}</summary>
        <label>选择已发布流程<select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">请选择</option>{templates.map(t=><option key={t.id} value={t.id}>{t.definition.name}</option>)}</select></label>
        <button className="btn" disabled={!chosen || busy} onClick={()=>confirm.ask({kind:"approval-initiate",title:"确认绑定知识发布流程",object:templates.find(t=>t.id===chosen)?.definition.name || chosen,scope:"当前知识库",consequence:"后续新申请使用此流程；已提交的审批保持原流程版本。",confirmLabel:"确认绑定",confirmTone:"primary"},async()=>{await reviewApi(`/admin/knowledge/bases/${state.base_id}/publication-flow`,{template_id:chosen,expected_version:state.binding?.version || 0},"PUT");await load();})}>绑定流程</button>
        <Link className="kbv-link-plain" to={create}>新建审批流程 →</Link>
      </details>}
      {!ctx?.admin && state.blocking_reason && <p>请联系有流程管理资格的管理员配置。</p>}
      {state.allowed_actions.includes("submit") && <><label>发布说明<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} /></label><fieldset disabled={busy}><ReviewForm fields={state.fields || []} values={values} onChange={setValues} onUploadBusy={setUploadBusy} /></fieldset><button className="btn" disabled={busy || uploadBusy || !note.trim()} onClick={()=>void submit()}>提交审批</button></>}
      {state.allowed_actions.includes("retry_publication") && <button className="btn" disabled={busy} onClick={()=>confirm.ask({kind:"approval-initiate",title:"确认重试发布",object:`资料版本 v${state.version}`,scope:state.binding?.name || "当前知识库",
        consequence:"重新执行本次已批准版本的发布，仍会核验资料与权限；不会创建新的审批或重跑咨询任务。",confirmLabel:"确认重试发布",confirmTone:"primary"},async()=>{await reviewApi(`/admin/knowledge/documents/${id}/publication-retry`,{});await load();reload();})}>重试已批准版本的发布</button>}
      {state.allowed_actions.includes("create_revision") && <button className="btn" disabled={busy} onClick={()=>void run(async()=>{
        const r=await reviewApi<{document_id:string}>(`/admin/knowledge/documents/${id}/revision`,{});
        window.location.assign(`/admin/knowledge?document=${encodeURIComponent(r.document_id)}`);
      })}>创建新版本草稿</button>}
      <p>保存、解析、提交审批和发布分别留痕；未发布版本不参与员工问答。</p>
    </>}
    {confirm.dialog}
  </section>;
}
