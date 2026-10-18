import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ontologyDimensions, type OntologyCatalog, type OntologyConfirmation, type OntologyDefinition, type OntologyDimension, type OntologyDocument, type OntologyItem, type OntologyVersion } from '../../../shared/ontology';
import { ontologyApi, OntologyApiError } from './api';
import { useAccount } from '../components/AuthGate';
import { isAdminAccount } from '../viewMode';
import './ontology.css';

const titles:Record<OntologyDimension,string>={properties:'属性',relations:'关系',events:'事件',rules:'规则',actions:'动作'};
const descriptions:Record<OntologyDimension,string>={properties:'定义业务对象的静态特征与业务含义',relations:'定义当前对象与其他业务对象的语义关联',events:'定义对象生命周期内发生的业务事实',rules:'定义对象必须遵循的业务约束与校验逻辑',actions:'定义可对该对象执行的业务操作与授权入口'};
const typeNames:Record<string,string>={text:'文本',enum:'枚举',reference:'引用',number:'数值',datetime:'日期时间',boolean:'布尔',structured:'结构化',amount:'金额',base:'基础',derived:'派生'};
const statusNames:Record<OntologyDocument['status'],string>={registered:'已登记',published:'已发布',disabled:'已停用',draft:'草稿'};
const display=(d:OntologyDocument,admin:boolean)=>admin?d.draft||d.published:d.published;
const message=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';
type Edit={definition:OntologyDefinition;dimension?:OntologyDimension;index?:number;remove?:boolean;newObject?:boolean};
type ModalProps={title:string;children:ReactNode;onClose:()=>void;busy?:boolean;footer:ReactNode};
function Modal({title,children,onClose,busy,footer}:ModalProps){
  const ref=useRef<HTMLDialogElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return()=>{ref.current?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
  return <dialog className="onto-dialog" ref={ref} aria-labelledby="onto-modal-title" onCancel={e=>{e.preventDefault();if(!busy)closeRef.current();}} onClick={e=>{if(e.target===ref.current&&!busy){const r=ref.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
    <div className="onto-modal"><header><div><h2 id="onto-modal-title">{title}</h2></div><button type="button" aria-label="关闭卡片" disabled={busy} onClick={onClose}>×</button></header><div className="onto-modal-body">{children}</div><footer>{footer}</footer></div>
  </dialog>;
}

const fields:Record<OntologyDimension,[keyof OntologyItem,string,string?][]>={
  properties:[['type','数据类型','type'],['required','是否必填','boolean'],['defaultValue','默认值'],['dictionary','字典引用']],
  relations:[['target','目标业务对象','target'],['cardinality','关系基数','cardinality'],['inverse','反向关系']],
  events:[['type','事件类型'],['producer','生产者'],['condition','触发条件','long'],['payload','事件载荷（JSON Schema）','json']],
  rules:[['clause','条款依据'],['executionPoint','现有程序执行点'],['condition','条件说明','long'],['priority','优先级']],
  actions:[['risk','风险级别','risk'],['executor','技能依赖说明'],['asynchronous','异步作业','boolean'],['input','输入契约（JSON Schema）','json']],
};
function Editor({edit,known,onClose,onSave}:{edit:Edit;known:OntologyDefinition[];onClose:()=>void;onSave:(d:OntologyDefinition,reason:string)=>Promise<void>}){
  const [definition,setDefinition]=useState(()=>structuredClone(edit.definition));
  const [item,setItem]=useState<OntologyItem>(()=>structuredClone(edit.dimension&&edit.index!==undefined?edit.definition.items[edit.dimension][edit.index]:{code:'',name:'',description:'',source:'',...(edit.dimension==='actions'?{risk:'R3' as const}:{}),...(edit.dimension==='properties'?{type:'text'}:{})}));
  const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const initial=useRef(JSON.stringify({definition,item}));
  const close=()=>{if(busy)return;if((reason||JSON.stringify({definition,item})!==initial.current)&&!window.confirm('放弃尚未保存的修改？'))return;onClose();};
  const label=(name:string,input:ReactNode,wide=false)=><label className={wide?'wide':''}><span>{name}</span>{input}</label>;
  const input=(key:keyof OntologyItem)=>String(item[key]??'');
  const update=(key:keyof OntologyItem,value:string|boolean)=>setItem(i=>({...i,[key]:value}));
  async function save(e:FormEvent){e.preventDefault();setError('');if(!reason.trim()){setError('请填写变更原因');return;}setBusy(true);
    try{const next=structuredClone(definition);if(edit.dimension){const items=next.items[edit.dimension];if(edit.remove)items.splice(edit.index!,1);else if(edit.index===undefined)items.push(item);else items[edit.index]=item;}
      await onSave(next,reason);onClose();}catch(e){setError(message(e));}finally{setBusy(false);}
  }
  return <Modal title={edit.remove?'移除定义（保存为草稿）':edit.dimension?`${edit.index===undefined?'新建':'编辑'}${titles[edit.dimension]}`:edit.newObject?'新建业务对象':'编辑业务对象'} onClose={close} busy={busy} footer={<><button className="onto-outline" disabled={busy} onClick={close}>取消</button><button className="onto-primary" form="onto-edit-form" type="submit" disabled={busy}>{busy?'保存中…':'保存草稿'}</button></>}>
    <p className="onto-hint">R2 草稿 · 保存后不会生效。规则与动作仅维护定义说明，执行仍受现行闸门约束。</p>
    <form id="onto-edit-form" onSubmit={save}><fieldset disabled={busy} className="onto-fields">
      {edit.remove?<p className="wide">从下个版本移除“{item.name}”；当前发布版本和历史审计继续保留。</p>:edit.dimension?<>
        {label('编码 *',<input value={item.code} required readOnly={edit.index!==undefined} onChange={e=>update('code',e.target.value)} maxLength={120}/>)}
        {label('名称 *',<input value={item.name} required onChange={e=>update('name',e.target.value)} maxLength={200}/>)}
        {fields[edit.dimension].map(([key,name,kind])=>{
          const required=['type','target','cardinality','clause','risk'].includes(key);
          const options=kind==='type'?['text','number','enum','reference','datetime','boolean','structured','amount']:kind==='cardinality'?['1:1','1:N','N:1','N:N']:kind==='risk'?['R1','R2','R3']:null;
          return <div key={key} className={kind==='long'||kind==='json'?'wide':''}>{label(name+(required?' *':''),kind==='boolean'?<select value={item[key]?'true':'false'} onChange={e=>update(key,e.target.value==='true')}><option value="false">否</option><option value="true">是</option></select>:kind==='target'?<select value={input(key)} required onChange={e=>update(key,e.target.value)}><option value="">选择对象</option>{known.map(d=><option key={d.code} value={d.code}>{d.name} · {d.code}</option>)}</select>:options?<select value={input(key)} required onChange={e=>update(key,e.target.value)}>{!input(key)&&<option value="">请选择</option>}{options.map(v=><option key={v} value={v}>{typeNames[v]||v}</option>)}</select>:kind==='long'||kind==='json'?<textarea value={input(key)} rows={kind==='json'?4:2} onChange={e=>update(key,e.target.value)}/>:<input value={input(key)} required={required} onChange={e=>update(key,e.target.value)}/>)}</div>;
        })}
        {label('来源依据 *',<input value={item.source} required onChange={e=>update('source',e.target.value)} maxLength={1000}/>,true)}
        {label('业务说明',<textarea value={item.description} rows={3} onChange={e=>update('description',e.target.value)}/>,true)}
      </>:<>
        {label('对象编码 *',<input value={definition.code} required readOnly={!edit.newObject} pattern="[a-z][a-z0-9_]*" onChange={e=>setDefinition(d=>({...d,code:e.target.value}))}/>)}
        {label('稳定 ID *',<input value={definition.id} required readOnly={!edit.newObject} onChange={e=>setDefinition(d=>({...d,id:e.target.value}))}/>)}
        {label('对象名称 *',<input value={definition.name} required onChange={e=>setDefinition(d=>({...d,name:e.target.value}))}/>,true)}
        {(['业务族（L1）','业务域（L2）','业务主题（L3）'] as const).map((name,i)=><div key={name}>{label(name+' *',<input value={definition.taxonomy[i]} required onChange={e=>setDefinition(d=>{const taxonomy=[...d.taxonomy] as [string,string,string];taxonomy[i]=e.target.value;return {...d,taxonomy};})}/>)}</div>)}
        {label('来源依据 *',<input value={definition.source} required onChange={e=>setDefinition(d=>({...d,source:e.target.value}))}/>,true)}
        {label('对象定义',<textarea value={definition.description} rows={3} onChange={e=>setDefinition(d=>({...d,description:e.target.value}))}/>,true)}
      </>}
      {label('变更原因 *',<textarea value={reason} rows={2} required onChange={e=>setReason(e.target.value)}/>,true)}
    </fieldset>{error&&<p className="onto-error" role="alert">{error}</p>}</form>
  </Modal>;
}

function Confirmation({value,onClose,onCommit}:{value:OntologyConfirmation;onClose:()=>void;onCommit:(reason:string,id:string)=>Promise<void>}){
  const [reason,setReason]=useState('');const [accepted,setAccepted]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const id=useRef(crypto.randomUUID());
  const action=value.action==='publish'?'发布':value.action==='disable'?'停用':'回滚发布';
  return <Modal title={`确认${action}定义 · R3`} onClose={onClose} busy={busy} footer={<><button disabled={busy} className="onto-outline" onClick={onClose}>取消</button><button className="onto-primary" disabled={busy||!accepted||!reason.trim()} onClick={async()=>{setBusy(true);setError('');try{await onCommit(reason,id.current);onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}}>{busy?'提交中…':`确认${action}`}</button></>}>
    <p>对象：{value.next?.name||value.previous?.name} · {value.code}</p><p className="onto-hint">影响当前公司的定义浏览；不会修改业务实例、现行权限或规则执行器，也不会执行工具。停用或回滚会保留尚未发布的草稿。</p>
    <div className="onto-diff"><div><strong>变更前</strong><p>{value.previous?.name||'无已发布定义'}</p></div><div><strong>变更后</strong><p>{value.next?.name||'已停用，员工端不再显示'}</p></div></div>
    <table className="onto-table"><thead><tr><th>定义</th><th>变更前</th><th>变更后</th></tr></thead><tbody>{ontologyDimensions.map(d=><tr key={d}><td>{titles[d]}</td><td>{value.previous?.items[d].length||0}</td><td>{value.next?.items[d].length||0}</td></tr>)}</tbody></table>
    <details className="onto-full-diff"><summary>核对完整内容差异（含同数量修改）</summary><h3>变更前</h3><pre>{JSON.stringify(value.previous,null,2)}</pre><h3>变更后</h3><pre>{JSON.stringify(value.next,null,2)}</pre></details>
    <label className="onto-form-label">变更原因<textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2}/></label>
    <label className="onto-accept"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>我已核对对象、完整定义内容和影响范围</label><small>确认有效期至 {new Date(value.expiresAt).toLocaleTimeString()}</small>
    {error&&<p className="onto-error" role="alert">{error}。内容若已变化，请关闭并刷新后重新预览。</p>}
  </Modal>;
}

export default function OntologyWorkspace({admin=false}:{admin?:boolean}){
  const {account}=useAccount();const [params,setParams]=useSearchParams();
  const [data,setData]=useState<OntologyCatalog|null>(null);const [company,setCompany]=useState('');const [companies,setCompanies]=useState<{id:string;name:string}[]>([]);
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [reload,setReload]=useState(0);const [receipt,setReceipt]=useState('');
  const [filters,setFilters]=useState(['全部','全部','全部']);const [search,setSearch]=useState('');const [definitionSearch,setDefinitionSearch]=useState('');const [page,setPage]=useState(1);const [pageSize,setPageSize]=useState(20);
  const [edit,setEdit]=useState<Edit|null>(null);const [confirmation,setConfirmation]=useState<OntologyConfirmation|null>(null);const [history,setHistory]=useState<OntologyVersion[]|null>(null);const [pending,setPending]=useState(false);const [publishedView,setPublishedView]=useState(false);
  const allowed=!admin||isAdminAccount(account);
  useEffect(()=>{if(!allowed){setLoading(false);setError('需要本体治理管理权限');return;}const controller=new AbortController();setLoading(true);setError('');setData(null);setEdit(null);setConfirmation(null);setHistory(null);
    ontologyApi.catalog(company,admin,controller.signal).then(result=>{setData(result);setCompanies(result.context.companies);}).catch(e=>{if(controller.signal.aborted)return;setError(message(e));if(e instanceof OntologyApiError)setCompanies(e.companies);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[company,admin,reload,allowed]);
  const definitions=useMemo(()=>data?.objects.map(d=>({document:d,definition:display(d,admin)})).filter((d):d is {document:OntologyDocument;definition:OntologyDefinition}=>!!d.definition)||[],[data,admin]);
  const matched=definitions.filter(({definition:d})=>filters.every((f,i)=>f==='全部'||d.taxonomy[i]===f)&&`${d.name} ${d.id} ${d.code}`.toLowerCase().includes(search.toLowerCase()));
  const selection=definitions.find(d=>d.document.code===params.get('object'))||definitions.find(d=>d.document.code==='kol_profile')||matched[0]||definitions[0];
  const dimension:OntologyDimension=ontologyDimensions.includes(params.get('dimension') as OntologyDimension)?params.get('dimension') as OntologyDimension:'properties';
  const document=selection?.document;const definition=publishedView&&document?.published?document.published:selection?.definition;
  const rows=(definition?.items[dimension]||[]).filter(i=>[i.name,i.code,i.description].join(' ').toLowerCase().includes(definitionSearch.toLowerCase()));
  const currentCompany=data?.context.companyId||company;const pages=Math.max(1,Math.ceil(matched.length/pageSize));const currentPage=Math.min(page,pages);
  const select=(code:string)=>{setParams(p=>{p.set('object',code);return p;},{replace:true});setPublishedView(false);setDefinitionSearch('');};
  const setDimension=(d:OntologyDimension)=>setParams(p=>{p.set('dimension',d);return p;},{replace:true});
  const showReceipt=(r:{id:string;revision:number;action:string})=>{setReceipt(`${r.action==='save_draft'?'草稿已保存 · 未生效':'操作已完成'} · 版本 ${r.revision} · 回执 ${r.id}`);setReload(n=>n+1);};
  const prepare=async(action:string,targetVersion?:string)=>{if(!document)return;setPending(true);setError('');try{setConfirmation(await ontologyApi.prepare(currentCompany,document.code,document.revision,action,targetVersion));}catch(e){setError(message(e));}finally{setPending(false);}};
  const newObject=()=>setEdit({newObject:true,definition:{code:'',id:'',name:'',description:'',source:'',layer:'kol_business',taxonomy:['市场与增长','未分类','未分类'],items:{properties:[],relations:[],events:[],rules:[],actions:[]}}});
  return <div className="ontology-workspace" data-ontology-mode={admin?'admin':'employee'}>
    <aside className="onto-catalog" aria-label="业务对象目录"><header>{admin&&<Link className="onto-text" to="/admin/ontology/governance">注册表与审批治理</Link>}<h1>{admin?'业务对象本体管理':'业务对象'}</h1><p>{admin?'定义和管理业务对象的属性、关系、事件、规则、动作':'按业务分类查找对象，理解定义、关系与受控行为'}</p></header>
      {companies.length>1&&<label className="onto-company">所属公司<select aria-label="所属公司" value={currentCompany} onChange={e=>{setCompany(e.target.value);setReceipt('');setFilters(['全部','全部','全部']);setPage(1);}}><option value="">选择公司</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <div className="onto-filters">{['业务族（L1）','业务域（L2）','业务主题（L3）'].map((label,level)=>{const pool=definitions.filter(({definition:d})=>filters.every((f,i)=>i>=level||f==='全部'||d.taxonomy[i]===f));const values=['全部',...new Set(pool.map(({definition:d})=>d.taxonomy[level]))];return <div className="onto-filter-line" key={label}><span>{label}</span><div>{values.map(value=><button key={value} className={filters[level]===value?'active':''} aria-pressed={filters[level]===value} onClick={()=>{setFilters(f=>f.map((v,i)=>i<level?v:i===level?value:'全部'));setPage(1);}}>{value}<small>{value==='全部'?pool.length:pool.filter(({definition:d})=>d.taxonomy[level]===value).length}</small></button>)}</div></div>;})}</div>
      <div className="onto-catalog-tools"><input type="search" aria-label="搜索业务对象" placeholder="搜索对象ID或对象名称" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>{admin&&allowed&&<button className="onto-outline" onClick={newObject} disabled={!data}>＋ 新建对象</button>}</div>
      <div className="onto-object-list">{loading?<p className="onto-empty" role="status">正在读取对象定义…</p>:<table className="onto-table" aria-label="业务对象"><thead><tr><th className="onto-check"/><th>对象ID</th><th>对象名称</th></tr></thead><tbody>{matched.slice((currentPage-1)*pageSize,currentPage*pageSize).map(({document:doc,definition:d},i)=><tr key={d.code} className={document?.code===d.code?'selected':''}><td><span aria-hidden="true" className={'onto-selection '+(document?.code===d.code?'checked':'')}>{document?.code===d.code?'✓':''}</span></td><td><span className={'onto-mini color-'+i%6} aria-hidden="true">◇</span>{d.id}</td><td><button className="onto-object-link" onClick={()=>select(d.code)} aria-current={document?.code===d.code?'true':undefined} title={d.name}>{d.name}</button>{doc.status==='disabled'&&<small>已停用</small>}{doc.draft&&<small> · 草稿</small>}</td></tr>)}</tbody></table>}{!loading&&!matched.length&&<p className="onto-empty">没有匹配对象。请调整筛选或搜索。</p>}</div>
      <footer><span>共 {matched.length} 条</span><div><button disabled={currentPage===1} onClick={()=>setPage(n=>n-1)} aria-label="上一页">‹</button><span>{currentPage} / {pages}</span><button disabled={currentPage===pages} onClick={()=>setPage(n=>n+1)} aria-label="下一页">›</button></div><select aria-label="每页条数" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}><option value={20}>20 条/页</option><option value={50}>50 条/页</option></select></footer>
    </aside>
    <section className="onto-detail" aria-label="对象定义"><div className="onto-object-head"><div className="onto-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10"/></svg></div><div className="onto-object-copy"><div><h2>{definition?.name||'业务对象'}</h2>{definition&&<><span className="onto-tag">{definition.id}</span><span className="onto-tag blue">业务对象</span></>}</div><p>所属路径：{definition?.taxonomy.join(' / ')||'请选择业务对象'}</p>{definition&&<p>对象定义：{definition.description||'未填写说明'}</p>}</div>{admin&&definition&&<div className="onto-head-actions"><button className="onto-outline" disabled={pending||publishedView} onClick={()=>setEdit({definition})}>编辑对象</button><button className="onto-outline" disabled={pending} onClick={async()=>{setPending(true);setError('');try{setHistory((await ontologyApi.history(currentCompany,document!.code)).items);}catch(e){setError(message(e));}finally{setPending(false);}}}>版本历史</button></div>}</div>
      <div className="onto-tabs" role="tablist" aria-label="本体五维">{ontologyDimensions.map(d=><button key={d} role="tab" id={'onto-tab-'+d} aria-controls="onto-panel" aria-selected={dimension===d} onClick={()=>setDimension(d)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=ontologyDimensions.indexOf(d);i=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:4))%5;setDimension(ontologyDimensions[i]);requestAnimationFrame(()=>window.document.getElementById('onto-tab-'+ontologyDimensions[i])?.focus());}}>{titles[d]}（{definition?.items[d].length||0}）</button>)}</div>
      <div className="onto-panel" id="onto-panel" role="tabpanel" aria-labelledby={'onto-tab-'+dimension}>
        {error&&<div className="onto-error" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重试</button></div>}
        <div className="onto-heading"><h3>{titles[dimension]}</h3><p>{descriptions[dimension]}</p></div>
        {document&&<div className="onto-version-strip"><span className={'onto-state '+(document.status==='published'?'published':'')}>{document.draft&&!publishedView?'草稿 · 未生效':statusNames[document.status]}</span><small>版本 {document.revision} · {admin?'治理定义，不修改业务实例':'仅浏览登记与已发布定义'}</small>{admin&&document.draft&&document.published&&<button onClick={()=>setPublishedView(v=>!v)}>{publishedView?'返回草稿':'查看当前生效定义'}</button>}</div>}
        <div className="onto-toolbar"><input type="search" placeholder="搜索名称、编码或描述" aria-label="搜索定义" value={definitionSearch} onChange={e=>setDefinitionSearch(e.target.value)}/>{admin&&definition&&!publishedView&&<button className="onto-primary" disabled={pending} onClick={()=>setEdit({definition,dimension})}>＋ 新建{titles[dimension]}</button>}</div>
        {loading?<p className="onto-empty" role="status">正在读取定义，请稍候…</p>:<div className="onto-table-wrap"><table className="onto-table onto-definition-table" aria-label={titles[dimension]+'定义'}><thead><tr><th>编码</th><th>名称</th><th>{dimension==='relations'?'目标 / 基数':dimension==='actions'?'风险 / 执行方式':'类型 / 依据'}</th><th>业务说明</th><th>来源</th>{admin&&<th className="onto-operations">操作</th>}</tr></thead><tbody>{rows.map(item=><tr key={item.code}><td className="onto-code" title={item.code}>{item.code}</td><td>{item.name}</td><td>{dimension==='relations'?`${definitions.find(o=>o.definition.code===item.target)?.definition.name||item.target} · ${item.cardinality}`:dimension==='actions'?`${item.risk} · ${item.asynchronous?'异步作业':'受控技能'}`:typeNames[item.type||'']||item.type||item.clause||'事件定义'}</td><td title={item.description}>{item.description||'—'}</td><td title={item.source}>{item.source}</td>{admin&&<td><button className="onto-text" disabled={pending||publishedView} aria-label={'编辑'+item.name} onClick={()=>setEdit({definition:definition!,dimension,index:definition!.items[dimension].findIndex(i=>i.code===item.code)})}>编辑</button><button className="onto-text" disabled={pending||publishedView} aria-label={'移除'+item.name} onClick={()=>setEdit({definition:definition!,dimension,index:definition!.items[dimension].findIndex(i=>i.code===item.code),remove:true})}>移除</button></td>}</tr>)}</tbody></table>{!rows.length&&<p className="onto-empty">{definitionSearch?'没有匹配定义，请调整搜索。':'当前对象尚未登记此类定义。'}</p>}</div>}
        {dimension==='actions'&&<p className="onto-hint">R1 只读；R2 草稿；R3 正式或敏感动作。这里维护行为定义，实际使用请进入<Link to="/agents">已授权 Agent</Link>，执行时再次校验范围、风险和适用审批。</p>}
        {dimension==='events'&&<p className="onto-hint">此处为事件类型，不是已发生的事件；不能在此编辑历史事实。</p>}
        {admin&&definition&&<details className="onto-source"><summary>来源与业务边界</summary><p>{definition.source}</p><p>业务分类为当前登记信息。规则与动作只维护说明；发布不替代现行规则、审批或 Agent 使用权限。</p></details>}
      </div>
      <footer className="onto-detail-foot"><span role="status">{receipt||`${admin?'管理端':'员工端'} · 定义浏览不启动模型或调用外部工具`}</span>{admin&&document&&<div>{document.draft&&<button className="onto-outline" disabled={pending} onClick={()=>prepare('publish')}>预览发布</button>}{document.status!=='disabled'&&document.published&&<button className="onto-text" disabled={pending} onClick={()=>prepare('disable')}>停用对象</button>}</div>}</footer>
    </section>
    {edit&&data&&<Editor key={edit.definition.code+':'+edit.dimension+':'+edit.index+':'+edit.remove} edit={edit} known={definitions.map(o=>o.definition)} onClose={()=>setEdit(null)} onSave={async(d,reason)=>{const doc=data.objects.find(o=>o.code===d.code);const r=await ontologyApi.save(currentCompany,d,doc?.revision||0,data.sourceVersion,reason);select(d.code);showReceipt(r);}}/>}
    {confirmation&&<Confirmation value={confirmation} onClose={()=>setConfirmation(null)} onCommit={async(reason,id)=>showReceipt(await ontologyApi.commit(currentCompany,confirmation.token,id,reason))}/>}
    {history&&<Modal title="版本历史" onClose={()=>setHistory(null)} footer={<button className="onto-outline" onClick={()=>setHistory(null)}>关闭</button>}><p className="onto-hint">保存草稿、正式发布、停用和回滚均保留独立审计。回滚生成新发布版本。</p>{!history.length?<p>尚无变更记录，当前内容来自注册目录。</p>:history.map(v=><article className="onto-history" key={v.id}><strong>版本 {v.revision} · {v.action}</strong><p>{v.actor} · {new Date(v.createdAt).toLocaleString()}</p><p>{v.reason}</p>{['publish','restore'].includes(v.action)&&<button className="onto-text" disabled={pending} onClick={()=>{setHistory(null);void prepare('restore',v.id);}}>预览回滚到此版本</button>}<details><summary>查看版本内容</summary><pre>{JSON.stringify(v.definition,null,2)}</pre></details></article>)}</Modal>}
  </div>;
}
