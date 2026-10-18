import {useMemo,useState} from 'react';
import {Select,Button,Tag} from 'antd';
import WorkspaceSearchInput from './WorkspaceSearchInput';
import type {SkillObjectOption,SkillObjectSelection} from '../../../shared/skill-authoring';
export function OntologyObjectPicker({options,value,onChange,disabled=false}:{options:SkillObjectOption[];value:SkillObjectSelection[];onChange:(value:SkillObjectSelection[])=>void;disabled?:boolean}){
 const [query,setQuery]=useState(''),[family,setFamily]=useState<string>(),[domain,setDomain]=useState<string>(),[theme,setTheme]=useState<string>();
 const families=[...new Set(options.map(o=>o.taxonomy[0]))],domains=[...new Set(options.filter(o=>!family||o.taxonomy[0]===family).map(o=>o.taxonomy[1]))],themes=[...new Set(options.filter(o=>(!family||o.taxonomy[0]===family)&&(!domain||o.taxonomy[1]===domain)).map(o=>o.taxonomy[2]))];
 const filtered=useMemo(()=>options.filter(o=>(!family||o.taxonomy[0]===family)&&(!domain||o.taxonomy[1]===domain)&&(!theme||o.taxonomy[2]===theme)&&(!query||`${o.name} ${o.description} ${o.taxonomy.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))),[options,family,domain,theme,query]);
 const selected=new Set(value.map(v=>v.object));
 return <section className="skill-object-picker" aria-label="选择业务对象">
  <div className="skill-authoring-filters"><WorkspaceSearchInput aria-label="搜索业务对象" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索业务名称或含义"/>
   <Select aria-label="业务族" placeholder="全部业务族" allowClear value={family} options={families.map(value=>({value,label:value}))} onChange={v=>{setFamily(v);setDomain(undefined);setTheme(undefined);}}/>
   <Select aria-label="业务域" placeholder="全部业务域" allowClear value={domain} options={domains.map(value=>({value,label:value}))} onChange={v=>{setDomain(v);setTheme(undefined);}}/>
   <Select aria-label="业务主题" placeholder="全部业务主题" allowClear value={theme} options={themes.map(value=>({value,label:value}))} onChange={setTheme}/>
  </div>
  <Select<string> aria-label="添加业务对象" placeholder="选择对象，可添加多个" showSearch optionFilterProp="label" value={undefined} disabled={disabled} options={filtered.filter(o=>!selected.has(o.code)).map(o=>({value:o.code,label:`${o.name} · ${o.taxonomy.join(' / ')} · ${o.revision===null?'尚未发布':`正式 r${o.revision}`}`}))} onChange={code=>{const o=options.find(o=>o.code===code)!;onChange([...value,{object:o.code,revision:o.revision,actions:[]}]);}}/>
  <p className="muted">{filtered.length} 项匹配。已选对象不会因筛选消失；登记不等于发布。</p>
  {value.map((ref,index)=>{const object=options.find(o=>o.code===ref.object);return <div className="skill-authoring-object" key={ref.object}>
   <div><strong>{object?.name||ref.object}</strong> <Tag>{ref.revision===null?'待发布/未选版本':`已选 r${ref.revision}`}</Tag><Button type="text" disabled={disabled} onClick={()=>onChange(value.filter(o=>o.object!==ref.object))}>移除</Button></div>
   {object&&<p>{object.taxonomy.join(' / ')} · {object.description}</p>}
   {object&&ref.revision!==object.revision&&<p role="status">正式版本已变化，当前选择保留。<Button type="text" disabled={disabled} onClick={()=>onChange(value.map((r,i)=>i===index?{...r,revision:object.revision}:r))}>核对采用当前正式版本</Button></p>}
   {object?.revision===null&&<p>尚无公司正式版本，可先保存草稿，发布前需完成本体维护。</p>}
   <Select aria-label={`对象动作：${object?.name||ref.object}`} mode="multiple" optionFilterProp="label" placeholder="可选：引用该版本中的业务动作" value={ref.actions} disabled={disabled||!object} options={object?.actions.map(a=>({value:a.code,label:`${a.name}${a.risk?' · '+a.risk:''}`}))||[]} onChange={actions=>onChange(value.map((r,i)=>i===index?{...r,actions}:r))}/>
  </div>;})}
 </section>;
}
