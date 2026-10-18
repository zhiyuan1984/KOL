import { Select } from 'antd';
import WorkspaceSearchInput from '../components/WorkspaceSearchInput';
import { ProjectTheme } from '../components/ProjectTheme';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
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
  const dirty=!!reason||JSON.stringify({definition,item})!==initial.current;
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
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

function Confirmation({value,onClose,onCommit,references=[]}:{value:OntologyConfirmation;onClose:()=>void;onCommit:(reason:string,id:string)=>Promise<void>;references?:string[]}){
  const [reason,setReason]=useState('');const [accepted,setAccepted]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const id=useRef(crypto.randomUUID());
  const action=value.action==='publish'?'发布':value.action==='disable'?'停用':'回滚发布';
  return <Modal title={`确认${action}定义 · R3`} onClose={onClose} busy={busy} footer={<><button disabled={busy} className="onto-outline" onClick={onClose}>取消</button><button className="onto-primary" disabled={busy||!accepted||!reason.trim()} onClick={async()=>{setBusy(true);setError('');try{await onCommit(reason,id.current);onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}}>{busy?'提交中…':`确认${action}`}</button></>}>
    <p>对象：{value.next?.name||value.previous?.name} · {value.code}</p><p className="onto-hint">影响当前公司的定义浏览；不会修改业务实例、现行权限或规则执行器，也不会执行工具。停用或回滚会保留尚未发布的草稿。</p>
    <p className="onto-impact">已登记的引用对象：{references.length?references.join('、'):'未发现'}。运行使用方未提供；服务端会在提交时再次检查引用与版本。</p><div className="onto-diff"><div><strong>变更前</strong><p>{value.previous?.name||'无已发布定义'}</p></div><div><strong>变更后</strong><p>{value.next?.name||'已停用，员工端不再显示'}</p></div></div>
    <table className="onto-table"><thead><tr><th>定义</th><th>变更前</th><th>变更后</th></tr></thead><tbody>{ontologyDimensions.map(d=><tr key={d}><td>{titles[d]}</td><td>{value.previous?.items[d].length||0}</td><td>{value.next?.items[d].length||0}</td></tr>)}</tbody></table>
    <details className="onto-full-diff"><summary>核对完整内容差异（含同数量修改）</summary><h3>变更前</h3><pre>{JSON.stringify(value.previous,null,2)}</pre><h3>变更后</h3><pre>{JSON.stringify(value.next,null,2)}</pre></details>
    <label className="onto-form-label">变更原因<textarea value={reason} onChange={e=>setReason(e.target.value)} rows={2}/></label>
    <label className="onto-accept"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>我已核对对象、完整定义内容和影响范围</label><small>确认有效期至 {new Date(value.expiresAt).toLocaleTimeString()}</small>
    {error&&<p className="onto-error" role="alert">{error}。内容若已变化，请关闭并刷新后重新预览。</p>}
  </Modal>;
}

function ObjectGlyph(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10"/></svg>;}
const dimensionColumns:Record<OntologyDimension,string[]>={properties:['数据类型','必填'],relations:['目标业务对象','关系基数'],events:['事件类型','触发条件'],rules:['条款依据','优先级'],actions:['风险级别','执行方式']};
const shortName=(name:string)=>name.replace(/\s*[（(].*$/,'').trim()||name;
const realDescription=(text:string)=>text&&!/业务语义来源待补充|企业业务架构规划目录/.test(text)?text:'';

export default function OntologyWorkspace({admin=false}:{admin?:boolean}){
  const {account}=useAccount();const [params,setParams]=useSearchParams();
  const [data,setData]=useState<OntologyCatalog|null>(null);const [company,setCompany]=useState(params.get('company')||'');
  const [companies,setCompanies]=useState<{id:string;name:string}[]>([]);
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [reload,setReload]=useState(0);const [receipt,setReceipt]=useState('');
  const [definitionSearch,setDefinitionSearch]=useState('');const [edit,setEdit]=useState<Edit|null>(null);
  const [confirmation,setConfirmation]=useState<OntologyConfirmation|null>(null);const [history,setHistory]=useState<OntologyVersion[]|null>(null);
  const [pending,setPending]=useState(false);const [pendingLabel,setPendingLabel]=useState('');const [publishedView,setPublishedView]=useState(false);
  const [viewItem,setViewItem]=useState<OntologyItem|null>(null);const [help,setHelp]=useState(false);
  const root=useRef<HTMLDivElement>(null);const dragging=useRef(false);
  const [catalogWidth,setCatalogWidth]=useState(()=>{try{return Math.max(320,Math.min(520,Number(localStorage.getItem('ontology:catalog-width'))||360));}catch{return 360;}});
  useEffect(()=>{try{localStorage.setItem('ontology:catalog-width',String(catalogWidth));}catch{/* Preference storage is optional. */}},[catalogWidth]);
  const allowed=!admin||isAdminAccount(account);
  const updateView=(changes:Record<string,string|undefined>)=>setParams(previous=>{const next=new URLSearchParams(previous);for(const [key,value] of Object.entries(changes))if(value===undefined||value==='')next.delete(key);else next.set(key,value);return next;},{replace:true});
  const filters=[params.get('family')||'全部',params.get('domain')||'全部',params.get('topic')||'全部'];
  const search=params.get('q')||'';const globalSearch=params.get('global')==='1';
  const pageSize=params.get('size')==='50'?50:20;
  const page=Math.max(1,Number.parseInt(params.get('page')||'1',10)||1);
  useEffect(()=>{
    if(!allowed){setLoading(false);setError('需要本体治理管理权限');return;}
    const controller=new AbortController();setLoading(true);setError('');setData(null);setEdit(null);setConfirmation(null);setHistory(null);
    ontologyApi.catalog(company,admin,controller.signal).then(result=>{setData(result);setCompanies(result.context.companies);}).catch(e=>{if(controller.signal.aborted)return;setError(message(e));if(e instanceof OntologyApiError)setCompanies(e.companies);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[company,admin,reload,allowed]);
  const definitions=useMemo(()=>data?.objects.map(d=>({document:d,definition:display(d,admin)})).filter((d):d is {document:OntologyDocument;definition:OntologyDefinition}=>!!d.definition)||[],[data,admin]);
  const pathsByCode=useMemo(()=>{const map=new Map<string,[string,string,string][]>();for(const p of data?.taxonomy?.placements||[])map.set(p.objectCode,[...(map.get(p.objectCode)||[]),p.path]);return map;},[data]);
  const pathsFor=(code:string,path:[string,string,string])=>pathsByCode.get(code)||[path];
  const pathMatches=(path:string[],level=3)=>filters.every((f,i)=>i>=level||f==='全部'||path[i]===f);
  const branchPaths=[...(data?.taxonomy?.nodes.filter(n=>n.level===1).map(n=>[n.name,'',''] as [string,string,string])||[]),...(data?.taxonomy?.placements.map(p=>p.path)||definitions.map(d=>d.definition.taxonomy))];
  const query=search.trim().toLocaleLowerCase();
  const matched=definitions.filter(({definition:d})=>(globalSearch&&query||pathsFor(d.code,d.taxonomy).some(p=>pathMatches(p)))&&`${d.name} ${d.id} ${d.code}`.toLocaleLowerCase().includes(query));
  const selection=matched.find(d=>d.document.code===params.get('object'))||(params.has('page')?matched[(Math.min(page,Math.max(1,Math.ceil(matched.length/pageSize)))-1)*pageSize]:matched.find(d=>d.document.code==='kol_profile'))||matched[0];
  const document=selection?.document;const definition=publishedView&&document?.published?document.published:selection?.definition;
  const dimension:OntologyDimension=ontologyDimensions.includes(params.get('dimension') as OntologyDimension)?params.get('dimension') as OntologyDimension:'properties';
  const dimensionItems=definition?.items[dimension]||[];
  const rows=dimensionItems.filter(i=>[i.name,i.code,i.description].join(' ').toLowerCase().includes(definitionSearch.toLowerCase()));
  const pages=Math.max(1,Math.ceil(matched.length/pageSize));const selectedIndex=matched.findIndex(d=>d.document.code===document?.code);
  const currentPage=Math.min(params.has('page')?page:selectedIndex>=0?Math.floor(selectedIndex/pageSize)+1:page,pages);
  const currentCompany=data?.context.companyId||company;
  const canManage=admin&&allowed&&!!data?.context.admin;
  const incoming=useMemo(()=>data?.objects.filter(d=>d.code!==document?.code&&d.published?.items.relations.some(r=>r.target===document?.code)).map(d=>d.published!.name)||[],[data,document?.code]);
  const definedDimensions=definition?ontologyDimensions.filter(d=>definition.items[d].length>0):[];
  const select=(code:string)=>{
    const chosen=definitions.find(d=>d.definition.code===code)?.definition;
    updateView({object:code,...((globalSearch||filters.every(f=>f==='全部'))&&chosen?{family:chosen.taxonomy[0],domain:chosen.taxonomy[1],topic:chosen.taxonomy[2],global:undefined,page:undefined}:{})});
    setPublishedView(false);setDefinitionSearch('');setViewItem(null);
  };
  const changeFilter=(level:number,value:string)=>{const keys=['family','domain','topic'];const changes:Record<string,string|undefined>={page:'1',object:undefined,global:undefined};for(let i=level;i<3;i++)changes[keys[i]]=i===level&&value!=='全部'?value:undefined;updateView(changes);setPublishedView(false);setDefinitionSearch('');};
  const changeDimension=(d:OntologyDimension)=>{updateView({dimension:d});setDefinitionSearch('');setViewItem(null);};
  const showReceipt=(r:{id:string;revision:number;action:string})=>{setReceipt(`${r.action==='save_draft'?'草稿已保存 · 未生效':'操作已完成'} · 回执 ${r.id}`);setReload(n=>n+1);};
  const prepare=async(action:string,targetVersion?:string)=>{if(!document)return;setPending(true);setPendingLabel('正在核验版本和变更影响…');setError('');try{setConfirmation(await ontologyApi.prepare(currentCompany,document.code,document.revision,action,targetVersion));}catch(e){setError(message(e));}finally{setPending(false);}};
  const newObject=()=>setEdit({newObject:true,definition:{code:'',id:'',name:'',description:'',source:'',layer:'kol_business',taxonomy:filters.map((value,i)=>value==='全部'?(definition?.taxonomy[i]||['营销','KOL营销','达人资源'][i]):value) as [string,string,string],items:{properties:[],relations:[],events:[],rules:[],actions:[]}}});
  const openHistory=async()=>{if(!document)return;setPending(true);setPendingLabel('正在读取版本历史…');setError('');try{setHistory((await ontologyApi.history(currentCompany,document.code)).items);}catch(e){setError(message(e));}finally{setPending(false);}};
  const resize=(width:number)=>setCatalogWidth(Math.max(320,Math.min(520,Math.min(width,(root.current?.clientWidth||1000)-380))));
  const itemType=(item:OntologyItem)=>dimension==='relations'?(definitions.find(d=>d.definition.code===item.target)?.definition.name||item.target||'—'):dimension==='actions'?(item.risk||'未提供'):dimension==='rules'?(item.clause||'未提供'):(typeNames[item.type||'']||item.type||'未填写');
  const itemExtra=(item:OntologyItem)=>dimension==='properties'?(item.required?'是':'否'):dimension==='relations'?(item.cardinality||'未填写'):dimension==='events'?(item.condition||'未填写'):dimension==='rules'?(item.priority||'未填写'):(item.asynchronous?'异步作业':'受控技能');
  return <ProjectTheme><div ref={root} className="ontology-workspace onto-compact" style={{'--onto-catalog-width':catalogWidth+'px'} as CSSProperties} data-ontology-mode={admin?'admin':'employee'}>
    <aside className="onto-catalog" aria-label="业务对象目录">
      <header className="onto-catalog-head"><h1>{admin?'业务对象管理':'业务对象'}</h1><button className="onto-text onto-help" aria-label="对象定义帮助" onClick={()=>setHelp(true)}>?</button></header>
      <div className="onto-catalog-tools"><WorkspaceSearchInput aria-label="搜索业务对象" placeholder="搜索对象名称、编码" size="small" value={search} onChange={e=>updateView({q:e.target.value,page:'1',object:undefined})}/>{canManage&&<button className="onto-outline" onClick={newObject} disabled={!data||pending}>＋ 新建对象</button>}</div>
      <div className="onto-range"><span title="基于当前公司的服务端可见范围；不按组织归属隐去跨部门治理对象">全部可见对象</span>{query&&<label><input type="checkbox" checked={globalSearch} onChange={e=>updateView({global:e.target.checked?'1':undefined,page:'1',object:undefined})}/>跨分类搜索</label>}{companies.length>1&&<select aria-label="所属公司" value={currentCompany} onChange={e=>{setCompany(e.target.value);setReceipt('');updateView({company:e.target.value,family:undefined,domain:undefined,topic:undefined,q:undefined,object:undefined,page:'1'});}}><option value="">选择公司</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
      <div className="onto-filters" aria-label="业务分类筛选">{['业务族','业务域','业务主题'].map((label,level)=>{
        const disabled=loading||(level>0&&filters[level-1]==='全部');
        const values=[...new Set(branchPaths.filter(p=>pathMatches(p,level)).map(p=>p[level]).filter(Boolean))];
        return <div className="onto-filter-line" key={label}><label htmlFor={'onto-filter-'+level}>{label}</label><Select id={'onto-filter-'+level} aria-label={label} size="small" showSearch optionFilterProp="label" disabled={disabled} value={filters[level]} onChange={value=>changeFilter(level,value)} options={[{value:'全部',label:'全部'},...values.map(value=>({value,label:value}))]} placeholder={level===1?'先选择业务族':'先选择业务域'}/></div>;
      })}<button className="onto-text onto-clear-filters" disabled={filters.every(f=>f==='全部')&&!search} onClick={()=>{updateView({family:undefined,domain:undefined,topic:undefined,q:undefined,global:undefined,page:'1',object:undefined});setDefinitionSearch('');}}>清除筛选</button></div>
      <div className="onto-object-list">{loading?<p className="onto-empty" role="status">正在读取对象定义…</p>:error&&!data?<div className="onto-error" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重试</button></div>:<>
        <table className="onto-table onto-object-table" aria-label="业务对象"><thead><tr><th>对象名称</th><th>编码</th></tr></thead><tbody>{matched.slice((currentPage-1)*pageSize,currentPage*pageSize).map(({document:doc,definition:d})=><tr key={d.code} className={document?.code===d.code?'selected':''} onClick={()=>select(d.code)}><td><button className="onto-object-link" onClick={e=>{e.stopPropagation();select(d.code);}} aria-current={document?.code===d.code?'true':undefined} title={d.name}><span className="onto-mini"><ObjectGlyph/></span><span>{shortName(d.name)}</span></button>{globalSearch&&query&&<small className="onto-result-path" title={d.taxonomy.join(' / ')}>{d.taxonomy.join(' / ')}</small>}{doc.status==='disabled'&&<small>已停用</small>}{doc.draft&&<small>草稿</small>}</td><td className="onto-code" title={d.id}>{d.id}</td></tr>)}</tbody></table>
        {!matched.length&&<p className="onto-empty">没有匹配对象。请调整筛选或搜索。</p>}
      </>}</div>
      <footer><span>{loading?'正在读取…':error&&!data?'范围读取失败':`当前范围 ${matched.length} 个对象`}</span><div><button disabled={currentPage===1||loading} onClick={()=>updateView({page:String(currentPage-1),object:undefined})} aria-label="上一页">‹</button><span>{currentPage}/{pages}</span><button disabled={currentPage===pages||loading} onClick={()=>updateView({page:String(currentPage+1),object:undefined})} aria-label="下一页">›</button></div><select aria-label="每页条数" value={pageSize} onChange={e=>updateView({size:e.target.value,page:'1',object:undefined})}><option value={20}>20 条/页</option><option value={50}>50 条/页</option></select></footer>
    </aside>
    <div className="onto-resizer" role="separator" aria-label="调整对象列表宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={520} aria-valuenow={catalogWidth} tabIndex={0} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?320:e.key==='End'?520:catalogWidth+(e.key==='ArrowRight'?16:-16));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);dragging.current=true;}} onPointerMove={e=>{if(dragging.current)resize(e.clientX-(root.current?.getBoundingClientRect().left||0));}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}/>
    <section className="onto-detail" aria-label="对象定义">
      <header className="onto-object-head"><span className="onto-symbol"><ObjectGlyph/></span><div className="onto-object-copy"><div><h2 title={definition?.name}>{definition?shortName(definition.name):loading?'正在读取…':'选择业务对象'}</h2>{definition&&<span className="onto-code" title="稳定业务编码">{definition.id}</span>}</div>{definition&&<><nav className="onto-object-path" aria-label="对象所属分类" title={definition.taxonomy.join(' / ')}>{definition.taxonomy.join(' / ')}</nav><p className={realDescription(definition.description)?'':'onto-missing-definition'}>{realDescription(definition.description)||'未填写业务定义'}{!realDescription(definition.description)&&canManage&&<button className="onto-text" disabled={pending||publishedView} onClick={()=>setEdit({definition})}>补充定义</button>}</p></>}</div>
        {definition&&<div className="onto-head-actions">{canManage&&<><button className="onto-text" aria-label="编辑对象" disabled={pending||publishedView} onClick={()=>setEdit({definition})}>编辑</button><button className="onto-text" disabled={pending} onClick={openHistory}>版本历史</button></>}<details className="onto-more"><summary aria-label="对象更多操作">更多</summary><div><p><strong>完整名称</strong><br/>{definition.name}</p><p><strong>定义依据</strong><br/>{definition.source}</p>{!realDescription(definition.description)&&definition.description&&<p>{definition.description}</p>}<p>已登记引用：{incoming.length} 个对象{incoming.length?' · '+incoming.join('、'):''}</p><p>运行使用方未接入；发布与停用会由服务端核验。</p>{canManage&&<Link to="/admin/ontology/governance">注册表与审批治理</Link>}{canManage&&document?.status!=='disabled'&&document?.published&&<button className="onto-text onto-danger" disabled={pending} onClick={()=>prepare('disable')}>停用对象</button>}</div></details></div>}
      </header>
      <div className="onto-object-status" aria-label="定义维护状态">{document&&<><span className={'onto-state '+(document.status==='published'?'published':'')}>{document.draft&&!publishedView?'草稿 · 未生效':document.status==='registered'?'目录已收录':statusNames[document.status]}</span><span>已维护 {definedDimensions.length}/5 类定义</span>{document.draft&&document.published&&canManage&&<button className="onto-text" onClick={()=>setPublishedView(v=>!v)}>{publishedView?'返回草稿':'查看生效定义'}</button>}{canManage&&document.draft&&<button className="onto-outline" disabled={pending} onClick={()=>prepare('publish')}>预览发布</button>}</>}{publishedView&&<span>正在查看生效定义；返回草稿后可编辑</span>}{pending&&<span role="status">{pendingLabel}</span>}{receipt&&<span className="onto-receipt" role="status">{receipt}</span>}</div>
      <div className="onto-tabs" role="tablist" aria-label="本体五维">{ontologyDimensions.map(d=><button key={d} role="tab" id={'onto-tab-'+d} aria-controls="onto-panel" aria-selected={dimension===d} title={descriptions[d]} onClick={()=>changeDimension(d)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();let i=ontologyDimensions.indexOf(d);i=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:4))%5;changeDimension(ontologyDimensions[i]);requestAnimationFrame(()=>window.document.getElementById('onto-tab-'+ontologyDimensions[i])?.focus());}}>{titles[d]} <small>{loading||!data?'—':definition?.items[d].length?definition.items[d].length:'未定义'}</small></button>)}</div>
      <div className="onto-panel" id="onto-panel" role="tabpanel" aria-labelledby={'onto-tab-'+dimension}>
        {error&&data&&<div className="onto-error" role="alert">{error}<button onClick={()=>setReload(n=>n+1)}>重试</button></div>}
        {loading?<p className="onto-empty" role="status">正在读取定义，请稍候…</p>:!definition?<p className="onto-empty">{error?'定义暂不可用，请重试目录读取。':'选择一个业务对象查看定义。'}</p>:dimensionItems.length===0?<div className="onto-first-definition"><p>尚未定义{titles[dimension]}</p><span>{dimension==='properties'?`为“${shortName(definition.name)}”说明需要记录哪些业务特征。`:dimension==='relations'?`说明“${shortName(definition.name)}”与哪些对象有关联。`:dimension==='events'?'记录对象生命周期中需要识别的业务事件类型。':dimension==='rules'?'登记已有业务约束及依据，执行规则仍由现有程序负责。':'说明已授权的业务操作及风险；实际执行通过 Agent。'}</span>{canManage&&!publishedView&&<button className="onto-primary" disabled={pending} onClick={()=>setEdit({definition,dimension})}>＋ 新建{titles[dimension]}</button>}</div>:<>
          <div className="onto-toolbar"><WorkspaceSearchInput size="small" aria-label="搜索定义" placeholder="搜索名称、编码或说明" value={definitionSearch} onChange={e=>setDefinitionSearch(e.target.value)}/>{canManage&&!publishedView&&<button className="onto-primary" disabled={pending} onClick={()=>setEdit({definition,dimension})}>＋ 新建{titles[dimension]}</button>}</div>
          <div className="onto-table-wrap"><table className="onto-table onto-definition-table" aria-label={titles[dimension]+'定义'}><thead><tr><th>名称 / 编码</th>{dimensionColumns[dimension].map(c=><th key={c}>{c}</th>)}<th>业务说明</th><th>定义依据</th><th className="onto-operations">操作</th></tr></thead><tbody>{rows.map(item=><tr key={item.code}><td><span>{item.name}</span><small className="onto-item-code" title={item.code}>{item.code}</small></td><td title={itemType(item)}>{itemType(item)}</td><td title={itemExtra(item)}>{itemExtra(item)}</td><td title={item.description}>{item.description||'未填写'}</td><td title={item.source}>{item.source}</td><td><button className="onto-text" aria-label={'查看'+item.name} onClick={()=>setViewItem(item)}>详情</button>{canManage&&<><button className="onto-text" disabled={pending||publishedView} aria-label={'编辑'+item.name} onClick={()=>setEdit({definition,dimension,index:definition.items[dimension].findIndex(i=>i.code===item.code)})}>编辑</button><button className="onto-text" disabled={pending||publishedView} aria-label={'移除'+item.name} onClick={()=>setEdit({definition,dimension,index:definition.items[dimension].findIndex(i=>i.code===item.code),remove:true})}>移除</button></>}</td></tr>)}</tbody></table>{!rows.length&&<p className="onto-empty">没有匹配定义，请调整搜索。</p>}</div>
        </>}
      </div>
    </section>
    {edit&&data&&<Editor key={edit.definition.code+':'+edit.dimension+':'+edit.index+':'+edit.remove} edit={edit} known={definitions.map(o=>o.definition)} onClose={()=>setEdit(null)} onSave={async(d,reason)=>{const doc=data.objects.find(o=>o.code===d.code);const r=await ontologyApi.save(currentCompany,d,doc?.revision||0,data.sourceVersion,reason);updateView({object:d.code,family:d.taxonomy[0],domain:d.taxonomy[1],topic:d.taxonomy[2],q:undefined,page:undefined,global:undefined});showReceipt(r);}}/>}
    {confirmation&&<Confirmation value={confirmation} references={incoming} onClose={()=>setConfirmation(null)} onCommit={async(reason,id)=>showReceipt(await ontologyApi.commit(currentCompany,confirmation.token,id,reason))}/>}
    {history&&<Modal title="版本历史" onClose={()=>setHistory(null)} footer={<button className="onto-outline" onClick={()=>setHistory(null)}>关闭</button>}><p className="onto-hint">当前生效：{document?.status==='disabled'?'已停用':document?.published?document.status==='registered'?'来源目录定义':'已发布定义（修订见发布记录）':'尚未发布'}。{document?.draft?'有未发布草稿。':''}回滚会生成新版本并保留草稿。</p>{!history.length?<p>尚无变更记录，当前内容来自来源目录。</p>:history.map(v=><article className="onto-history" key={v.id}><strong>修订 {v.revision} · {v.action==='save_draft'?'保存草稿':v.action==='publish'?'发布':v.action==='disable'?'停用':v.action==='restore'?'回滚发布':v.action}</strong><p>{v.actor} · {new Date(v.createdAt).toLocaleString()}</p><p>{v.reason}</p>{['publish','restore'].includes(v.action)&&<button className="onto-text" disabled={pending} onClick={()=>{setHistory(null);void prepare('restore',v.id);}}>预览回滚到此版本</button>}<details><summary>查看变更内容</summary><pre>{JSON.stringify(v.definition,null,2)}</pre></details></article>)}</Modal>}
    {viewItem&&<Modal title={viewItem.name} onClose={()=>setViewItem(null)} footer={<button className="onto-outline" onClick={()=>setViewItem(null)}>关闭</button>}><dl className="onto-item-details"><dt>编码</dt><dd>{viewItem.code}</dd>{fields[dimension].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{typeof viewItem[key]==='boolean'?viewItem[key]?'是':'否':String(viewItem[key]??'未填写')}</dd></div>)}<dt>业务说明</dt><dd>{viewItem.description||'未填写'}</dd><dt>定义依据</dt><dd>{viewItem.source}</dd></dl></Modal>}
    {help&&<Modal title="业务对象定义管理" onClose={()=>setHelp(false)} footer={<button className="onto-outline" onClick={()=>setHelp(false)}>关闭</button>}><p>这里维护对象类型的定义，不管理实际账号、交易或日志实例。业务族、业务域、业务主题是分类；五类定义入口保持固定。</p><p>“目录已收录”仅表示有目录条目；“已维护 N/5 类”是当前内容计数，不表示已完成业务验收，也不代表每类都适用。未提供适用性信息时显示“未定义”。</p><p>当前范围为所在公司内全部可见定义。后端尚未配置对象负责人映射，不能据部门猜测“我负责的”，也不会隐藏跨部门治理对象。</p><p>草稿不会生效；发布、停用、回滚需要核对完整差异及确认。权限、引用和并发版本由服务端复核。动作经<Link to="/agents">已授权 Agent</Link>执行，事件定义与历史事件分别管理。</p>{admin&&<Link to="/admin/ontology/governance">进入注册表与审批治理</Link>}</Modal>}
  </div></ProjectTheme>;
}
