import {useCallback,useEffect,useState} from 'react';
import {reviewApi} from '../../reviews/api';
import type {KnowledgeManifest,KnowledgeScope} from '../../../../shared/knowledge-scope';
import './knowledge-scope.css';
type Document={id:string;title:string;base_id:string;name:string;version:number;scope:KnowledgeScope};
type Detail={config:null|{revision:number;published_revision:number|null;selector:{base_ids:string[];document_ids?:string[]};update_policy:string};agents:{id:string;name:string}[];documents:Document[];test?:{status:string;error_summary?:string;result?:{results:{question:string;answer:{summary:string};tool_calls:{result:{content:{text:string}[]}}[]}[]}}|null};
export default function SkillKnowledgeRange({skillId,compact=false}:{skillId:string;compact?:boolean}) {
  const [detail,setDetail]=useState<Detail|null>(null),[manifest,setManifest]=useState<KnowledgeManifest|null>(null),[catalog,setCatalog]=useState<Document[]>([]);
  const [bases,setBases]=useState<string[]>([]),[fixed,setFixed]=useState<string[]>([]),[policy,setPolicy]=useState('follow_published'),[question,setQuestion]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
  const load=useCallback(async()=>{try{const [data,effective]=await Promise.all([reviewApi<Detail>(`/admin/skills/${skillId}/knowledge-config`),reviewApi<KnowledgeManifest>(`/admin/skills/${skillId}/capability-manifest`)]);setDetail(data);setManifest(effective);setError('');return data;}catch(e){setError((e as Error).message);return null;}},[skillId]);
  useEffect(()=>{let live=true;void load().then(data=>{if(!live || !data?.config)return;setBases(data.config.selector.base_ids);setFixed(data.config.selector.document_ids || []);setPolicy(data.config.update_policy);});if(!compact)reviewApi<{documents:Document[]}>('/admin/knowledge/scope-catalog').then(data=>{if(live)setCatalog(data.documents);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[load,compact]);
  const running=detail?.test && ['queued','running','retrying'].includes(detail.test.status);
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>void load(),2500);return()=>clearInterval(timer);},[running,load]);
  async function save(){if(!detail?.config)return;setBusy(true);setError('');try{const next=await reviewApi<Detail>(`/admin/skills/${skillId}/knowledge-config`,{expectedRevision:detail.config.revision,base_ids:bases,update_policy:policy,...(policy==='fixed_documents'?{document_ids:fixed}:{})},'PUT');setDetail(next);setDirty(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function test(){setBusy(true);setError('');try{await reviewApi(`/admin/skills/${skillId}/knowledge-test`,{question:question || undefined});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const baseRows=[...new Map(catalog.map(d=>[d.base_id,{id:d.base_id,name:d.name}])).values()];
  if(!detail && !error)return <p role="status">正在读取知识范围…</p>;
  if(!detail?.config && !manifest?.bases.length && !error)return null;
  return <section className="skill-detail-card knowledge-range" aria-label="技能知识范围"><h3>{compact?'挂载技能的有效知识范围':'知识范围与真实试算'}</h3>
    {error && <p role="alert" className="error">{error}</p>}
    <p>此依赖属于技能，所有挂载它的智能体共享。{detail?.agents.length?`关联智能体：${detail.agents.map(a=>a.name).join('、')}。`:'目前没有挂载的智能体。'}不同范围请新建独立知识技能。行为或依赖发布后，需要在智能体页明确应用；库内资料更新自动联动。</p>
    {manifest?.bases.map(base=><details key={base.id}><summary>{base.name} · {base.documents.length} 份有效资料</summary>{base.documents.map(doc=><div key={doc.id}><strong>{doc.title} · v{doc.version}</strong><p>{doc.scope?.summary || '历史资料尚未归纳范围，查询仍仅依据原文。'}</p><p>{doc.scope?.topics.map(t=>t.label).join('、')}</p></div>)}</details>)}{!manifest?.bases.length && <p>目前没有已生效的可用资料范围。</p>}
    {detail?.config && <p>依赖草稿版本 {detail.config.revision} · 已生效版本 {detail.config.published_revision || '无'} · {detail.config.update_policy==='follow_published'?'跟随已发布资料':'固定文档版本'}。{detail.config.revision!==detail.config.published_revision && '依赖草稿尚未生效。'}</p>}
    {!compact && detail?.config && <>
      <details><summary>修改知识依赖草稿</summary><label>更新策略<select value={policy} disabled={busy || Boolean(running)} onChange={e=>{setPolicy(e.target.value);setDirty(true);}}><option value="follow_published">跟随库中已发布资料</option><option value="fixed_documents">固定文档版本</option></select></label>
        {baseRows.map(base=><section key={base.id}><label><input type="checkbox" checked={bases.includes(base.id)} disabled={busy || Boolean(running)} onChange={e=>{setBases(current=>e.target.checked?[...current,base.id]:current.filter(id=>id!==base.id));setFixed(current=>current.filter(id=>catalog.find(d=>d.id===id)?.base_id!==base.id));setDirty(true);}} />{base.name}</label>{bases.includes(base.id) && catalog.filter(d=>d.base_id===base.id).map(doc=><label key={doc.id}>{policy==='fixed_documents' && <input type="checkbox" checked={fixed.includes(doc.id)} disabled={busy || Boolean(running)} onChange={e=>{setFixed(current=>e.target.checked?[...current,doc.id]:current.filter(id=>id!==doc.id));setDirty(true);}} />}{doc.title} · v{doc.version}</label>)}</section>)}
        <button className="btn" disabled={busy || Boolean(running) || !dirty} onClick={()=>void save()}>保存依赖草稿</button><p>保存不改变员工可用范围。修改后须重新试算并按技能生命周期发布。</p>
      </details>
      <label>具体问题（可选）<textarea value={question} maxLength={2000} onChange={e=>setQuestion(e.target.value)} placeholder="留空时根据资料主题提出问题；另自动试问概览问题" /></label>
      <button className="btn" disabled={busy || Boolean(running) || dirty} onClick={()=>void test()}>{running?'正在调用原文工具试算…':'真实试算当前技能草稿（L1）'}</button>
      {detail.test && <p role="status">试算状态：{({queued:'等待执行',running:'查询资料与生成回答',succeeded:'实际查询与回答已完成，请核对结果',failed:'试算失败',blocked:'执行受阻',cancelled:'已取消'} as Record<string,string>)[detail.test.status] || detail.test.status}</p>}
      {detail.test?.error_summary && <p role="alert">{detail.test.error_summary}</p>}
      {detail.test?.result?.results.map((result,index)=><details key={index}><summary>{result.question}</summary><p>{result.answer.summary}</p>{result.tool_calls.flatMap(call=>{try{const value=JSON.parse(call.result.content[0]?.text || '{}');return (value.citations || []) as {page:number;source_url:string;title?:string}[];}catch{return [];}}).map((citation,i)=><a key={i} href={citation.source_url} target="_blank" rel="noreferrer">{citation.title || '原文'} · 第{citation.page}页 </a>)}</details>)}
    </>}
  </section>;
}
