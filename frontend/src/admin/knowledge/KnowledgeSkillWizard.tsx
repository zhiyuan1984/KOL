import {useEffect,useRef,useState} from 'react';
import {AdminFormDialog} from '../../components/AdminFormDialog';
import {reviewApi,reviewCompany} from '../../reviews/api';
import type {KnowledgeScope} from '../../../../shared/knowledge-scope';
import './knowledge-scope.css';
type Document={id:string;title:string;base_id:string;name:string;version:number;scope:KnowledgeScope};
type Job={id:string;status:string;error_summary?:string;spec?:{id:string;title:string;purpose:string;base_ids:string[];document_ids?:string[];update_policy:string};result?:{body:string;markdown:string}};
export default function KnowledgeSkillWizard({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}) {
  const [documents,setDocuments]=useState<Document[]>([]),[id,setId]=useState(''),[title,setTitle]=useState(''),[purpose,setPurpose]=useState('');
  const [policy,setPolicy]=useState('follow_published'),[bases,setBases]=useState<string[]>([]),[fixed,setFixed]=useState<string[]>([]);
  const [job,setJob]=useState<Job|null>(null),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const keyRef=useRef<HTMLInputElement|null>(null);
  const storageKey=`knowledge-skill-generation:${reviewCompany()}`;
  useEffect(()=>{const saved=sessionStorage.getItem(storageKey);if(!saved)return;let live=true;reviewApi<Job>(`/admin/skills/knowledge-drafts/jobs/${encodeURIComponent(saved)}`).then(next=>{if(!live)return;setJob(next);if(next.spec){setId(next.spec.id);setTitle(next.spec.title);setPurpose(next.spec.purpose);setBases(next.spec.base_ids);setPolicy(next.spec.update_policy);setFixed(next.spec.document_ids || []);}if(next.result)setBody(next.result.body);}).catch(()=>{sessionStorage.removeItem(storageKey);});return()=>{live=false;};},[storageKey]);
  useEffect(()=>{let live=true;reviewApi<{documents:Document[]}>('/admin/knowledge/scope-catalog').then(data=>{if(live)setDocuments(data.documents);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
  const running=Boolean(job && ['queued','running','retrying'].includes(job.status));
  useEffect(()=>{if(!running || !job)return;let live=true;const timer=setInterval(()=>{reviewApi<Job>(`/admin/skills/knowledge-drafts/jobs/${job.id}`).then(next=>{if(!live)return;setJob(next);if(next.result)setBody(next.result.body);if(next.error_summary)setError(next.error_summary);}).catch(e=>{if(live)setError(e.message);});},2500);return()=>{live=false;clearInterval(timer);};},[job?.id,running]);
  async function generate(){setBusy(true);setError('');try{const result=await reviewApi<{jobId:string}>('/admin/skills/knowledge-drafts/generate',{id,title,purpose,base_ids:bases,update_policy:policy,request_id:crypto.randomUUID(),...(policy==='fixed_documents'?{document_ids:fixed}:{})});sessionStorage.setItem(storageKey,result.jobId);setJob({id:result.jobId,status:'queued'});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(){if(!job)return;setBusy(true);setError('');try{const result=await reviewApi<{id:string}>(`/admin/skills/knowledge-drafts/jobs/${job.id}/accept`,{body});sessionStorage.removeItem(storageKey);onCreated(result.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const baseRows=[...new Map(documents.map(d=>[d.base_id,{id:d.base_id,name:d.name}])).values()];
  const generated=job?.status==='succeeded';
  return <AdminFormDialog open title="新建知识技能" subtitle="选择已发布知识范围，生成并核对行为说明。保存为 L2 草稿；发布技能与配置智能体使用权限分别完成。" initialFocusRef={keyRef} error={error} busy={busy} onClose={onClose}
    footer={<><button className="btn" disabled={busy} onClick={onClose}>{running?'关闭（作业继续运行）':'取消'}</button>{generated?<button className="btn work" disabled={busy || !body.trim()} onClick={()=>void save()}>保存技能草稿</button>:<button className="btn work" disabled={busy || running || !id || !title || !purpose || !bases.length || (policy==='fixed_documents' && !fixed.length)} onClick={()=>void generate()}>{running?'正在生成行为说明…':'生成技能草稿'}</button>}</>}>
    {!generated && <fieldset disabled={busy || running} className="knowledge-skill-fields">
      <label>技能 Key<input ref={keyRef} value={id} maxLength={40} pattern="[a-z][a-z0-9_]+" onChange={e=>setId(e.target.value)} placeholder="product_consultation_v2" /></label>
      <label>技能名称<input value={title} maxLength={80} onChange={e=>setTitle(e.target.value)} /></label>
      <label>问答目的<textarea value={purpose} maxLength={2000} onChange={e=>setPurpose(e.target.value)} placeholder="例如：介绍资料中有哪些产品，并查询参数和使用条件" /></label>
      <label>知识更新方式<select value={policy} onChange={e=>setPolicy(e.target.value)}><option value="follow_published">跟随所选库的已发布资料</option><option value="fixed_documents">固定所选文档版本</option></select></label>
      <p>跟随模式在新资料审批发布后更新能力范围；固定模式下，被归档的版本立即不可查询。所有挂载此技能的智能体共享此配置。</p>
      <div aria-label="可用知识范围">{baseRows.map(base=><section key={base.id}><label><input type="checkbox" checked={bases.includes(base.id)} onChange={e=>{setBases(current=>e.target.checked?[...current,base.id]:current.filter(id=>id!==base.id));setFixed(current=>current.filter(id=>documents.find(d=>d.id===id)?.base_id!==base.id));}} />{base.name}</label>
        {bases.includes(base.id) && documents.filter(d=>d.base_id===base.id).map(doc=><details key={doc.id}><summary>{policy==='fixed_documents' && <input aria-label={`选用 ${doc.title} v${doc.version}`} type="checkbox" checked={fixed.includes(doc.id)} onChange={e=>setFixed(current=>e.target.checked?[...current,doc.id]:current.filter(id=>id!==doc.id))} />}{doc.title} · v{doc.version}</summary><p>{doc.scope.summary}</p><p>对象：{doc.scope.entities.map(e=>e.name).join('、') || '未识别明确对象'}</p><p>主题：{doc.scope.topics.map(t=>t.label).join('、')}</p><p>{doc.scope.limitations.join('；')}</p>{doc.scope.coverage.status==='partial' && <p>正文识别不完整，请保留查询限制。</p>}</details>)}</section>)}{!baseRows.length && <p>没有可选的已发布知识范围。请先在知识库完成提炼、核对和审批发布；历史资料通过新版本补齐范围。</p>}</div>
    </fieldset>}
    {running && <p role="status">后台正在依据已发布范围生成说明。关闭后，可在本页恢复该作业。作业编号：{job?.id}</p>}
    {job && ['failed','blocked','cancelled'].includes(job.status) && <p role="alert">生成未完成，请检查错误后重新生成。</p>}
    {generated && <><p>{title} · 草稿（未生效）</p><label>核对技能行为说明<textarea value={body} maxLength={12000} rows={16} onChange={e=>setBody(e.target.value)} /></label><p>查询、来源与只读限制会作为运行约束附在说明后。型号和主题来自实时发布范围，不生成全局必填参数。</p><details><summary>查看生成时的 SKILL.md</summary><pre>{job?.result?.markdown}</pre></details></>}
  </AdminFormDialog>;
}
