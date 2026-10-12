import type {PoolClient} from 'pg';
import {HttpFail} from '../host/errors.js';
import {runtimeHash} from '../runtime/execution.js';
import {PLATFORM_SYNC_AGENT} from '../runtime/platform-principal.js';
import type {AgentBindingRow,OrganizationCoverageSource} from '../runtime/organization-tree.js';
import type {AgentBindingTarget,AgentGovernanceDraft} from '../../../shared/agent-workspace.js';
import type {AgentOrganizationState} from '../../../shared/agent-organization.js';

export const targetKey=(target:AgentBindingTarget)=>`${target.company_id}:${target.target_type}:${target.target_id}`;
export const bindingTargets=(bindings:AgentBindingRow[]):AgentBindingTarget[]=>bindings.map(({company_id,target_type,target_id})=>({company_id,target_type,target_id})).sort((a,b)=>targetKey(a).localeCompare(targetKey(b)));
export const governanceBasis=(bindings:AgentBindingRow[],organization:AgentOrganizationState)=>runtimeHash({bindings,organization});
export function validateGovernance(input:unknown,basis:string,id:string,source:OrganizationCoverageSource):AgentGovernanceDraft{
 if(!input||typeof input!=='object')throw new HttpFail(400,'请提供完整治理草稿');
 const value=input as AgentGovernanceDraft;
 if(value.basis!==basis)throw new HttpFail(409,'组织归属或人员绑定已变化，请重新读取依据；当前输入保留');
 if(typeof value.reason!=='string'||value.reason.length>500)throw new HttpFail(400,'配置变更原因不能超过 500 字');
 if(!Array.isArray(value.bindings)||value.bindings.length>500)throw new HttpFail(400,'使用绑定草稿无效');
 const targets=value.bindings.map(target=>{
  if(!target||!['person','organization_unit'].includes(target.target_type)||typeof target.target_id!=='string'||typeof target.company_id!=='string')throw new HttpFail(400,'使用绑定目标无效');
  if(!source.versions.some(row=>row.company_id===target.company_id&&Number(row.version)>0))throw new HttpFail(409,'使用绑定公司的组织版本尚未登记，请核对组织依据');
  const valid=target.target_type==='organization_unit'?source.units.some(unit=>unit.id===target.target_id&&unit.company_id===target.company_id&&unit.status==='active'):
   source.people.some(person=>person.person_ref===target.target_id&&person.status==='active'&&person.user_id)&&source.memberships.some(member=>member.person_ref===target.target_id&&member.company_id===target.company_id&&member.status==='active');
  if(!valid)throw new HttpFail(400,'请选择同公司内已确认的有效组织或人员');
  return {company_id:target.company_id,target_type:target.target_type,target_id:target.target_id};
 }).sort((a,b)=>targetKey(a).localeCompare(targetKey(b)));
 if(new Set(targets.map(target=>`${target.target_type}:${target.target_id}`)).size!==targets.length)throw new HttpFail(400,'使用绑定不能重复或跨公司重复选择同一人员');
 if(id===PLATFORM_SYNC_AGENT&&targets.length)throw new HttpFail(400,'平台系统智能体不能绑定组织或人员');
 const owner=value.organization;
 if(owner!==null&&(!owner||typeof owner.company_id!=='string'||typeof owner.org_unit_id!=='string'))throw new HttpFail(400,'请选择归属部门或明确清除归属');
 if(owner&&!source.versions.some(row=>row.company_id===owner.company_id&&Number(row.version)>0))throw new HttpFail(409,'归属公司的组织版本尚未登记，请核对组织依据');
 return {organization:owner?{company_id:owner.company_id,org_unit_id:owner.org_unit_id}:null,bindings:targets,reason:value.reason.trim(),basis};
}
export function proposedBindings(id:string,targets:AgentBindingTarget[],current:AgentBindingRow[]):AgentBindingRow[]{
 return targets.map(target=>current.find(row=>targetKey(row)===targetKey(target))||{...target,id:`draft:${targetKey(target)}`,agent_id:id,status:'active',binding_version:1,org_version:0,created_by:null,reason:null,effective_from:null,effective_to:null,source:'draft'});
}
export async function applyPublishedBindings(db:PoolClient,actor:string,id:string,targets:AgentBindingTarget[],current:AgentBindingRow[],reason:string,org:OrganizationCoverageSource){
 const changed=new Date().toISOString();
 for(const row of current.filter(row=>!targets.some(target=>targetKey(target)===targetKey(row)))){
  const after=(await db.query("UPDATE agent_bindings SET status='revoked',binding_version=binding_version+1,reason=$2,effective_to=$3,updated_at=$3 WHERE id=$1 RETURNING *",[row.id,reason,changed])).rows[0];
  await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[changed,actor,'admin.agent.binding.revoke',JSON.stringify({agent_id:id,binding_id:row.id,before:row,after,reason,source:'release'})]);
 }
 for(const target of targets.filter(target=>!current.some(row=>targetKey(target)===targetKey(row)))){
  const binding=`binding:${id}:${target.target_type}:${target.target_id}`,version=Number(org.versions.find(row=>row.company_id===target.company_id)?.version||0);
  const before=(await db.query('SELECT * FROM agent_bindings WHERE id=$1',[binding])).rows[0]||null;
  const after=(await db.query(`INSERT INTO agent_bindings(id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,source,created_at,updated_at)
   VALUES($1,$2,$3,$4,$5,'active',1,$6,$7,$8,$9,'release',$9,$9)
   ON CONFLICT(id) DO UPDATE SET status='active',company_id=EXCLUDED.company_id,binding_version=agent_bindings.binding_version+1,org_version=EXCLUDED.org_version,created_by=EXCLUDED.created_by,reason=EXCLUDED.reason,effective_from=EXCLUDED.effective_from,effective_to=NULL,source='release',updated_at=EXCLUDED.updated_at RETURNING *`,[binding,id,target.target_type,target.target_id,target.company_id,version,actor,reason,changed])).rows[0];
  await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[changed,actor,'admin.agent.binding.add',JSON.stringify({agent_id:id,binding_id:binding,...target,before,after,reason,source:'release'})]);
 }
}
