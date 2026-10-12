import {useMemo,useState} from 'react';
import {Form,Select,TreeSelect,Input} from 'antd';
import {HorizontalForm} from '../../components/InformationLayout';
import {TaskTheme} from '../../tasks/TaskTheme';
import WorkspaceSearchInput from '../../components/WorkspaceSearchInput';
import type {AgentGovernanceDraft,AgentBindingTarget} from '../../../../shared/agent-workspace';
import type {AgentWorkspace} from './api';

const key=(target:AgentBindingTarget)=>`${target.company_id}:${target.target_type}:${target.target_id}`;
export default function AgentGovernanceEditor({value,data,disabled,system,onChange}:{value:AgentGovernanceDraft;data:AgentWorkspace;disabled:boolean;system:boolean;onChange:(value:AgentGovernanceDraft)=>void}){
 const [query,setQuery]=useState(''),[company,setCompany]=useState(value.organization?.company_id||Object.keys(data.organization_directory.versions)[0]||'');
 const directory=data.organization_directory,companies=Object.keys(directory.versions).map(id=>({value:id,label:directory.units.find(unit=>unit.id===id)?.display_name||id}));
 const tree=useMemo(()=>directory.units.filter(unit=>unit.company_id===company&&directory.selectable_ids.includes(unit.id)).map(unit=>({id:unit.id,pId:unit.parent_id===company?null:unit.parent_id,value:unit.id,title:unit.display_name})),[directory,company]);
 const label=(target:AgentBindingTarget)=>target.target_type==='person'?data.people.find(person=>person.person_ref===target.target_id)?.display_name||target.target_id:directory.units.find(unit=>unit.id===target.target_id)?.display_name||target.target_id;
 const choices:AgentBindingTarget[]=[...directory.units.filter(unit=>unit.status==='active').map(unit=>({target_type:'organization_unit' as const,target_id:unit.id,company_id:unit.company_id})),...data.people.filter(person=>person.user_id).flatMap(person=>(person.company_ids||[person.company_id]).filter((id):id is string=>Boolean(id)).map(id=>({target_type:'person' as const,target_id:person.person_ref,company_id:id})))];
 const toggle=(target:AgentBindingTarget,checked:boolean)=>onChange({...value,bindings:checked?[...value.bindings,target]:value.bindings.filter(row=>key(row)!==key(target))});
 return <>
  <details><summary>组织归属 · {value.organization?directory.units.find(unit=>unit.id===value.organization!.org_unit_id)?.display_name||value.organization.org_unit_id:'未设置'}</summary>
   <p>选择数字员工的任职部门。保存草稿后，确认发布才生效。</p>
   <TaskTheme><HorizontalForm component={false}>
    <Form.Item label="所属公司" className="ui-field-wide"><Select aria-label="草稿归属公司" value={company||undefined} options={companies} disabled={disabled} onChange={setCompany}/></Form.Item>
    <Form.Item label="归属部门" className="ui-field-wide"><TreeSelect aria-label="草稿归属部门" value={value.organization?.company_id===company?value.organization.org_unit_id:undefined} treeData={tree} treeDataSimpleMode treeDefaultExpandAll showSearch treeNodeFilterProp="title" disabled={disabled||!company} placeholder="选择任职部门" onChange={id=>onChange({...value,organization:{company_id:company,org_unit_id:id}})}/></Form.Item>
   </HorizontalForm></TaskTheme>
   <label className="agent-checkbox"><input type="checkbox" disabled={disabled} checked={value.organization===null} onChange={event=>{if(event.target.checked)onChange({...value,organization:null});}}/>不设置组织归属 / 清除归属</label>
  </details>
  <details><summary>使用绑定 · 草稿 {value.bindings.length} 个目标</summary><p>候选绑定仅保存在草稿。人员覆盖由服务端在发布检查中计算，任职部门不自动授予使用资格。</p>
   {value.bindings.map(target=><label className="agent-checkbox" key={key(target)}><input type="checkbox" checked disabled={disabled||system} onChange={()=>toggle(target,false)}/>{target.target_type==='person'?'人员':'组织'} · {label(target)}</label>)}
   {system?<p>平台后台 Agent 使用系统身份，不绑定人员。</p>:<><WorkspaceSearchInput aria-label="搜索草稿绑定目标" placeholder="搜索部门或人员" value={query} onChange={event=>setQuery(event.target.value)}/>
    {choices.filter(target=>!value.bindings.some(row=>key(row)===key(target))&&label(target).includes(query)).map(target=><label className="agent-checkbox" key={key(target)}><input type="checkbox" disabled={disabled} checked={false} onChange={()=>toggle(target,true)}/>{target.target_type==='person'?'人员':'组织'} · {label(target)}</label>)}</>}
  </details>
  <TaskTheme><HorizontalForm component={false}><Form.Item label="配置变更原因" className="ui-field-stacked"><Input.TextArea aria-label="配置变更原因" rows={2} maxLength={500} disabled={disabled} value={value.reason} placeholder="调整归属或使用绑定时填写依据" onChange={event=>onChange({...value,reason:event.target.value})}/></Form.Item></HorizontalForm></TaskTheme>
 </>;
}
