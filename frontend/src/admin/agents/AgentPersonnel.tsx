import {useState} from 'react';
import CompactButton from '../../components/CompactButton';
import {api} from '../../api';
import {useAdminConfirm} from '../../components/ConfirmDialog';
import {agentBindingRevokeConfirm} from '../../adminConfirm';
import type {AgentRow,AgentWorkspace} from './api';
export const VIA_LABEL={binding_target:'直接绑定',unit_head:'部门负责人',unit_member:'部门成员',ancestor_head:'上级负责人'};
export default function AgentPersonnel({row,data,onChanged,notify}:{row:AgentRow;data:AgentWorkspace;onChanged:()=>Promise<void>;onDirty:(value:boolean)=>void;notify:(value:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const {ask,dialog}=useAdminConfirm();
 const name=(target:AgentRow['bindings'][number])=>target.target_type==='person'?data.people.find(person=>person.person_ref===target.target_id)?.display_name||target.target_id:data.units.find(unit=>unit.id===target.target_id)?.display_name||target.target_id;
 async function revoke(binding:AgentRow['bindings'][number]){if(busy)return;setBusy(true);setError('');try{const preview=await api.adminAgentRevokePreview(row.id,binding.id);ask(agentBindingRevokeConfirm({agentName:row.name,agentId:row.id,targetLabel:name(binding),removed:preview.removed.map(person=>person.display_name||person.person_ref)}),async reason=>{await api.adminAgentUnbind(row.id,binding.id,reason,preview.org_version,preview.preview_signature);notify('紧急撤权已生效；相关草稿须重新读取依据');await onChanged();});}catch(e){setError(e instanceof Error?e.message:'撤权预览失败');}finally{setBusy(false);}}
 return <>{dialog}<section><h3>紧急撤权</h3><p>撤销当前有效的使用绑定，确认后立即生效。日常添加或调整人员范围请创建修订草稿。</p>{row.bindings.map(binding=><div className="agent-flat-row" key={binding.id}><span>{binding.target_type==='person'?'人员':'组织'} · {name(binding)}</span><CompactButton disabled={busy} onClick={()=>void revoke(binding)}>撤销</CompactButton></div>)}{!row.bindings.length&&<p>没有有效使用绑定。</p>}{error&&<p role="alert">{error}</p>}</section>
 <section><h3>当前覆盖 · {row.coverage.user_ids.length} 个员工账号</h3><p>组织版本 {row.coverage.org_version}。撤销一个绑定后，人员可能仍通过其他绑定获得资格。</p>{Object.entries(VIA_LABEL).map(([via,label])=>{const users=row.coverage.users.filter(value=>value.via===via);return users.length?<details key={via}><summary>{label} · {users.length} 人</summary>{users.map(person=><p key={person.person_ref}>{person.display_name||person.person_ref}</p>)}</details>:null;})}</section></>;
}