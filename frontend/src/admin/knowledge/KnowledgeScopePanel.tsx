import { useCallback,useEffect,useRef,useState } from 'react';
import type { ScopeDetail,KnowledgeScope } from '../../../../shared/knowledge-scope';
import { reviewApi,reviewCompany } from '../../reviews/api';
import { errorMessage } from './shared';
import './knowledge-scope.css';
const states={empty:'尚未提炼',candidate:'范围待核对',checked:'范围已核对 · 未发布',published:'范围已发布'};
const types:Record<string,string>={overview:'产品/内容概览',parameter_lookup:'参数查询',conditions:'适用与测试条件',usage:'使用说明',comparison:'资料内比较'};
export default function KnowledgeScopePanel({id,onReady,onDirty,onChanged}:{id:string;onReady:(value:boolean)=>void;onDirty?:(value:boolean)=>void;onChanged:()=>void}) {
  const [data,setData]=useState<ScopeDetail|null>(null),[explanation,setExplanation]=useState(''),[scope,setScope]=useState<KnowledgeScope|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[topic,setTopic]=useState(''),[evidenceId,setEvidenceId]=useState('');
  const dirtyRef=useRef(false);
  const endpoint=`/admin/knowledge/documents/${encodeURIComponent(id)}/scope`;
  const load=useCallback(async()=>{
    try {const next=await reviewApi<ScopeDetail>(endpoint);setData(next);if(!dirtyRef.current){setExplanation(next.explanation);setScope(next.scope);}setError('');onReady(['checked','published'].includes(next.state) || next.frozen);}
    catch(e){setError(errorMessage(e));onReady(false);}
  },[endpoint,onReady]);
  useEffect(()=>{void load();},[load]);
  const running=Boolean(data?.job && ['queued','running','retrying'].includes(data.job.status));
  useEffect(()=>{if(!running)return;const timer=setTimeout(()=>void load(),2500);return()=>clearTimeout(timer);},[running,data,load]);
  const changed=()=>{dirtyRef.current=true;setDirty(true);onDirty?.(true);onReady(false);};
  const save=async(checked:boolean)=>{
    if(!data)return;setBusy(true);setError('');
    try{const next=await reviewApi<ScopeDetail>(endpoint,{expectedRevision:data.revision,explanation,scope,checked},'PUT');setData(next);setScope(next.scope);dirtyRef.current=false;setDirty(false);onDirty?.(false);onReady(next.state==='checked');onChanged();}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  const generate=async()=>{
    if(!data)return;setBusy(true);setError('');
    try{await reviewApi(`${endpoint}-jobs`,{expectedRevision:data.revision});await load();}
    catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  };
  const edit=Boolean(data?.actions.edit && !busy && !running);
  return <section className="kbw-scope" aria-label="文档知识范围" aria-busy={busy || running}>
    <h3>资料解释与知识范围</h3>
    {error && <p role="alert">{error}<button className="kbv-text-action" onClick={()=>void load()}>重新读取</button></p>}
    {!data && !error && <p role="status">正在读取范围…</p>}
    {data && <>
      <p>{states[data.state]}{dirty?' · 有未保存修改':''}</p>
      <label>资料用途解释<textarea maxLength={4000} value={explanation} disabled={!edit} placeholder="资料讲什么、适合回答什么、适用对象和已知限制。解释不会代替原文事实。" onChange={e=>{setExplanation(e.target.value);changed();}} /></label>
      {data.frozen && <p>本版本材料已冻结。修改原件、解释或知识范围须创建新版本草稿。</p>}
      {running && <p role="status">{data.job?.status==='running'?'正在依据原文提炼知识范围':'等待知识范围提炼服务'} · 自动刷新中</p>}
      {data.job?.status==='failed' && <p role="alert">范围提炼失败：{data.job.error_summary || '请检查加工产物和模型服务后重试'}</p>}
      {scope && <>
        <label>内容范围摘要<textarea maxLength={2000} value={scope.summary} disabled={!edit} onChange={e=>{setScope({...scope,summary:e.target.value});changed();}} /></label>
        <p>目录完整性：未确认。回答仅限收录资料，具体答案仍须查询原文。</p>
        <h4>覆盖主题及依据</h4>
        {scope.topics.map((item,index)=><div className="kbw-scope-row" key={index}>
          <input aria-label={`主题 ${index+1}`} maxLength={200} value={item.label} disabled={!edit} onChange={e=>{setScope({...scope,topics:scope.topics.map((t,i)=>i===index?{...t,label:e.target.value}:t)});changed();}} />
          {item.evidence_ids.map(ref=>{const source=scope.evidence.find(e=>e.id===ref);return source?<a key={ref} href={`/api/admin/knowledge/documents/${encodeURIComponent(id)}/file?company=${encodeURIComponent(reviewCompany())}${source.original_pages.length?`#page=${source.original_pages[0]}`:''}`} target="_blank" rel="noreferrer">{source.original_pages.length?`原件第 ${source.original_pages.join('、')} 页`:'查看原件（页码映射缺失）'}</a>:null;})}
          {edit && <button className="kbv-text-action" onClick={()=>{setScope({...scope,topics:scope.topics.filter((_,i)=>i!==index)});changed();}}>移除主题</button>}
        </div>)}
        {edit && <div className="kbw-scope-row"><input aria-label="新增主题" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="补充有原文支持的主题" /><select aria-label="新增主题原文依据" value={evidenceId} onChange={e=>setEvidenceId(e.target.value)}><option value="">选择原文依据</option>{scope.evidence.map(e=><option key={e.id} value={e.id}>{e.original_pages.length?`原件第 ${e.original_pages.join('、')} 页`:'页码未映射'} · {e.text.slice(0,35)}</option>)}</select><button className="kbv-text-action" disabled={!topic.trim() || !evidenceId} onClick={()=>{setScope({...scope,topics:[...scope.topics,{label:topic.trim(),evidence_ids:[evidenceId]}]});setTopic('');changed();}}>添加主题</button></div>}
        <h4>对象与型号</h4>{scope.entities.map((entity,index)=><div className="kbw-scope-row" key={index}><input aria-label={`对象 ${index+1}`} maxLength={200} disabled={!edit} value={entity.name} onChange={e=>{setScope({...scope,entities:scope.entities.map((item,i)=>i===index?{...item,name:e.target.value}:item)});changed();}} /><span>{entity.evidence_ids.flatMap(ref=>scope.evidence.find(item=>item.id===ref)?.original_pages || []).map(page=>`原件第${page}页`).join('、')}</span>{edit && <button className="kbv-text-action" onClick={()=>{setScope({...scope,entities:scope.entities.filter((_,i)=>i!==index)});changed();}}>移除对象</button>}</div>)}{!scope.entities.length && <p>原文未明确对象</p>}
        <fieldset disabled={!edit}><legend>可支持的问题</legend>{Object.entries(types).map(([type,label])=><label key={type}><input type="checkbox" checked={scope.question_types.includes(type)} onChange={e=>{setScope({...scope,question_types:e.target.checked?[...scope.question_types,type]:scope.question_types.filter(t=>t!==type)});changed();}} />{label}</label>)}</fieldset>
        <label>条件和范围边界（每行一项）<textarea value={scope.limitations.join('\n')} disabled={!edit} onChange={e=>{setScope({...scope,limitations:e.target.value.split('\n').filter(t=>t.trim())});changed();}} /></label>
        {scope.unverified_notes.length>0 && <div role="note"><strong>待证实说明</strong><ul>{scope.unverified_notes.map((note,i)=><li key={i}>{note}</li>)}</ul></div>}
        {scope.coverage.status==='partial' && <p role="alert">部分原文无法识别：{scope.coverage.unreadable_pages.join('、') || '页码映射缺口'}。不能声明完整覆盖。</p>}
        <details><summary>核对原文摘录</summary>{scope.evidence.map(e=><section key={e.id}><strong>{e.original_pages.length?`原件第 ${e.original_pages.join('、')} 页`:'页码未映射'}</strong><pre className="kbv-body">{e.text}</pre></section>)}</details>
      </>}
      {data.actions.edit && <div className="kbv-actions">
        <button className="btn" disabled={busy || running || !dirty} onClick={()=>void save(false)}>保存解释与范围草稿</button>
        <button className="btn" disabled={busy || dirty || !data.actions.generate} onClick={()=>void generate()}>{scope?'重新提炼范围':'提炼知识范围'}</button>
        <button className="btn" disabled={busy || !data.actions.check || !scope || explanation!==data.explanation} onClick={()=>void save(true)}>确认已核对原文范围</button>
      </div>}
      {!scope && !running && !data.frozen && <p>解析完成后可提炼范围；保存解释后再提炼，核对原文范围后才能提交发布审批。</p>}
    </>}
  </section>;
}
