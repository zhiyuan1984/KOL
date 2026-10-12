import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Form,Select,TreeSelect} from 'antd';
import {useAdminConfirm} from '../../components/ConfirmDialog';
import CompactButton from '../../components/CompactButton';
import {HorizontalForm,PropertyList} from '../../components/InformationLayout';
import {TaskTheme} from '../../tasks/TaskTheme';
import * as client from './api';
import type {AgentOrganizationAssignment,AgentOrganizationCheck,AgentOrganizationDirectory} from '../../../../shared/agent-organization';

const departmentLabel=(assignment:AgentOrganizationAssignment|null)=>assignment?assignment.path.map(unit=>unit.display_name).join(' / ')||assignment.org_unit_id:'未设置组织归属';
export const organizationLabel=(assignment:AgentOrganizationAssignment|null)=>assignment?`${assignment.company_id} · ${departmentLabel(assignment)}`:departmentLabel(null);
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
export default function AgentOrganizationPanel({row,directory,actionTarget,onDirty,onChanged,notify}:{
 row:client.AgentDetail;directory:AgentOrganizationDirectory;actionTarget:HTMLElement|null;
 onDirty:(value:boolean)=>void;onChanged:()=>Promise<void>;notify:(value:string)=>void;
}){
 const assignment=row.organization.assignment;
 const [editing,setEditing]=useState(false),[company,setCompany]=useState(''),[unit,setUnit]=useState(''),[clearing,setClearing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[check,setCheck]=useState<AgentOrganizationCheck|null>(null);
 const request=useRef(''),submittedReason=useRef(''),previewSequence=useRef(0),{ask,dialog,open}=useAdminConfirm();
 const companies=useMemo(()=>[...new Set(directory.units.map(value=>value.company_id))].map(id=>({value:id,label:directory.units.find(value=>value.id===id)?.display_name||id})),[directory]);
 const tree=useMemo(()=>directory.units.filter(value=>value.company_id===company&&directory.selectable_ids.includes(value.id)).map(value=>({id:value.id,pId:value.parent_id===company?null:value.parent_id,value:value.id,title:value.display_name})),[directory,company]);
 // The service validates selectable nodes and their paths; the client only presents that projection.
 useEffect(()=>{setCheck(null);++previewSequence.current;},[row.organization.revision,directory]);
 useEffect(()=>()=>{++previewSequence.current;},[]);
 const invalidate=()=>{++previewSequence.current;setCheck(null);setError('');};
 const start=()=>{invalidate();setCompany(assignment?.company_id||(companies.length===1?companies[0].value:''));setUnit(assignment?.org_unit_id||'');setClearing(false);setEditing(true);onDirty(true);};
 const cancel=()=>{invalidate();setEditing(false);onDirty(false);};
 async function preview(){const sequence=++previewSequence.current;setBusy(true);setError('');setCheck(null);try{const next=await client.previewOrganization(row,clearing?null:company,clearing?null:unit);if(sequence===previewSequence.current){setCheck(next);request.current=crypto.randomUUID();submittedReason.current='';}}catch(e){if(sequence===previewSequence.current)setError(e instanceof Error?e.message:'组织归属读取失败');}finally{setBusy(false);}}
 async function refreshBasis(){invalidate();setBusy(true);try{await onChanged();setError('已重新读取归属依据，请核对保留的选择后重新预览');}catch(e){setError(e instanceof Error?e.message:'归属依据读取失败，请重试');}finally{setBusy(false);}}
 function confirm(){if(!check)return;ask({kind:'agent-organization',title:'调整数字员工组织归属',object:`${row.name}（${row.id}）`,scope:`${organizationLabel(check.before)} → ${organizationLabel(check.after)}`,consequence:'确认后更新该数字员工的部门归属，并记录变更回执。人员使用资格、技能装配和知识范围继续独立管理。',requireReason:true,reasonLabel:'归属变更原因',reasonPlaceholder:'说明本次岗位归属或调动依据',cancelHint:'取消只关闭确认，部门选择和预览会保留。',ruleVersion:`归属版本 ${check.revision} · 组织版本 ${check.org_version}`,confirmLabel:'确认调整归属',confirmTone:'primary'},async reason=>{
  // A retry after a lost response must replay the exact same confirmed request.
  submittedReason.current ||= reason;
  const receipt=await client.changeOrganization(row.id,check.preparation_id,request.current,submittedReason.current);
  onDirty(false);setEditing(false);setCheck(null);notify(`组织归属已更新 · 回执 ${receipt.id}`);
  try{await onChanged();}catch{notify(`组织归属已更新 · 回执 ${receipt.id}；详情刷新失败，请重新读取。`);}
 });}
 return <section data-agent-organization>{dialog}<h3>数字员工组织归属</h3>
  <PropertyList labelWidth="short" items={[
   {key:'company',label:'所属公司',value:assignment?companies.find(value=>value.value===assignment.company_id)?.label||assignment.company_id:'—'},
   {key:'department',label:'部门路径',value:departmentLabel(assignment)},
   ...(assignment?[{key:'revision',label:'归属记录',value:`r${row.organization.revision} · ${time(assignment.assigned_at)} · ${assignment.assigned_by}`}]:[]),
  ]}/>
  {assignment&&!assignment.valid&&<p role="alert">归属待核对：{assignment.issues.join('；')}。请调整到有效部门。</p>}
  {row.organization.system&&<p className="agent-help">平台后台 Agent · 保留系统身份。</p>}
  <p className="agent-help">部门归属描述数字员工在哪任职；人员绑定管理哪些真人有使用资格。</p>
  {!editing?<CompactButton onClick={start}>{assignment?'调整组织归属':'设置组织归属'}</CompactButton>:<>
   <TaskTheme><HorizontalForm component={false}>
    <Form.Item label="所属公司" className="ui-field-wide"><Select aria-label="归属公司" value={company||undefined} options={companies} disabled={busy||open||clearing} placeholder="选择公司" onChange={value=>{invalidate();setCompany(value);setUnit('');}}/></Form.Item>
    <Form.Item label="归属部门" className="ui-field-wide"><TreeSelect aria-label="归属部门" value={unit||undefined} treeData={tree} treeDataSimpleMode showSearch treeNodeFilterProp="title" treeDefaultExpandAll disabled={!company||busy||open||clearing} placeholder="搜索或选择实际任职部门" onChange={value=>{invalidate();setUnit(value);}}/></Form.Item>
   </HorizontalForm></TaskTheme>
   {assignment&&<label className="agent-checkbox"><input type="checkbox" checked={clearing} disabled={busy||open} onChange={event=>{invalidate();setClearing(event.target.checked);}}/>明确清除当前归属</label>}
   {error&&<p role="alert">{error}。选择仍保留，可在底栏刷新归属依据。</p>}
   {check&&<div data-agent-organization-preview><p><strong>本次归属调整</strong></p><p>{organizationLabel(check.before)} → {organizationLabel(check.after)}</p><p className="agent-help">归属 r{check.revision} · 组织版本 {check.org_version} · 有效至 {time(check.expires_at)}</p></div>}
   {actionTarget&&createPortal(<><span>R3 · 组织归属调整</span><span className="agent-action-spacer"/><CompactButton disabled={busy||open} onClick={cancel}>取消归属调整</CompactButton><CompactButton disabled={busy||open} onClick={()=>void refreshBasis()}>刷新归属依据</CompactButton>{check&&<CompactButton disabled={busy||open} onClick={()=>void preview()}>重新预览归属</CompactButton>}<CompactButton emphasis="primary" disabled={busy||open||(!clearing&&(!company||!unit))} onClick={()=>check?confirm():void preview()}>{busy?'正在核对归属…':check?'确认归属调整（R3）':'预览组织归属'}</CompactButton></>,actionTarget)}
  </>}
  {row.organization_history.length>0&&<details><summary>归属变更记录 · 最近 {row.organization_history.length} 条</summary>{row.organization_history.map(value=><details key={value.id}><summary>r{value.revision} · {time(value.changed_at)} · {value.actor}</summary><p>{organizationLabel(value.before)} → {organizationLabel(value.after)}</p><p>原因：{value.reason}</p><p>回执：{value.id}</p></details>)}</details>}
 </section>;
}
