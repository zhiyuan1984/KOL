import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {postgresTransaction} from '../postgres/pool.js';
import {HttpFail} from '../host/errors.js';
import {PLATFORM_SYNC_AGENT} from '../runtime/platform-principal.js';
import {organizationPath} from './organization-browse.js';
import type {AgentOrganizationDirectory,AgentOrganizationState,AgentOrganizationAssignment,AgentOrganizationCheck,AgentOrganizationReceipt} from '../../../shared/agent-organization.js';
const now=()=>new Date().toISOString();
export async function organizationDirectory(db:PoolClient):Promise<AgentOrganizationDirectory>{
 const units=(await db.query('SELECT id,company_id,display_name,parent_id,level,status,org_version FROM organization_units ORDER BY company_id,level,id')).rows.map(row=>({...row,level:Number(row.level),org_version:Number(row.org_version)}));
 const versions=Object.fromEntries((await db.query('SELECT company_id,MAX(version) AS version FROM org_versions GROUP BY company_id')).rows.map(row=>[row.company_id,Number(row.version)]));
 return {units,versions,selectable_ids:units.filter(unit=>organizationPath(unit.id,unit.company_id,units).valid).map(unit=>unit.id)};
}
export async function organizationState(db:PoolClient,id:string,directory?:AgentOrganizationDirectory):Promise<AgentOrganizationState>{
 const data=directory||await organizationDirectory(db);
 const revision=Number((await db.query('SELECT COALESCE(MAX(revision),0) AS revision FROM agent_organization_receipts WHERE agent_id=$1',[id])).rows[0].revision);
 const row=(await db.query("SELECT * FROM agent_organization_memberships WHERE agent_id=$1 AND status='active'",[id])).rows[0];
 const assignment:AgentOrganizationAssignment|null=row?{id:row.id,company_id:row.company_id,org_unit_id:row.org_unit_id,...organizationPath(row.org_unit_id,row.company_id,data.units),assigned_at:row.effective_from,assigned_by:row.assigned_by}:null;
 return {revision,assignment,system:id===PLATFORM_SYNC_AGENT};
}
const receipt=(row:Record<string,any>):AgentOrganizationReceipt=>({id:row.id,agent_id:row.agent_id,actor:row.actor,revision:Number(row.revision),changed_at:row.changed_at,before:row.before_state,after:row.after_state,reason:row.reason});
export async function organizationHistory(db:PoolClient,id:string):Promise<AgentOrganizationReceipt[]>{
 return (await db.query('SELECT * FROM agent_organization_receipts WHERE agent_id=$1 ORDER BY revision DESC LIMIT 20',[id])).rows.map(receipt);
}
async function context(db:PoolClient,id:string,company:string|null,unit:string|null){
 const directory=await organizationDirectory(db),current=await organizationState(db,id,directory);
 let after:AgentOrganizationAssignment|null=null;
 if(unit){
  const target=directory.units.find(value=>value.id===unit);
  if(!target||target.company_id!==company)throw new HttpFail(400,'请选择同一公司内的有效归属部门');
  const path=organizationPath(unit,company!,directory.units);if(!path.valid)throw new HttpFail(409,path.issues.join('；'));
  after={id:'proposed',company_id:company!,org_unit_id:unit,...path,assigned_at:'',assigned_by:''};
 }
 const companies=[...new Set([current.assignment?.company_id,company].filter((value):value is string=>Boolean(value)))];
 const orgVersions=Object.fromEntries(companies.map(value=>[value,directory.versions[value]||0]));
 const fingerprint=createHash('sha256').update(JSON.stringify({current,after,orgVersions})).digest('hex');
 return {current,after,fingerprint,org_version:company?orgVersions[company]:current.assignment?orgVersions[current.assignment.company_id]:0};
}
export async function prepareAgentOrganization(actor:string,id:string,input:{company_id?:unknown;org_unit_id?:unknown;expected_revision?:unknown}):Promise<AgentOrganizationCheck>{
 if(!Number.isSafeInteger(input.expected_revision)||Number(input.expected_revision)<0)throw new HttpFail(400,'请提供当前组织归属版本');
 const unit=input.org_unit_id===null?null:typeof input.org_unit_id==='string'&&input.org_unit_id.length<=200?input.org_unit_id:null;
 const company=input.company_id===null?null:typeof input.company_id==='string'&&input.company_id.length<=200?input.company_id:null;
 if((input.org_unit_id!==null&&!unit)||Boolean(unit)!==Boolean(company))throw new HttpFail(400,'请选择归属公司和部门；清除归属时需明确选择清除');
 return postgresTransaction(async db=>{
  if(!(await db.query('SELECT id FROM managed_agents WHERE id=$1',[id])).rowCount)throw new HttpFail(404,'Agent 不存在');
  const ctx=await context(db,id,company,unit);
  if(ctx.current.revision!==input.expected_revision)throw new HttpFail(409,'组织归属已被其他人修改，请重新读取后预览');
  if((ctx.current.assignment?.org_unit_id===unit&&ctx.current.assignment?.company_id===company)||(!ctx.current.assignment&&!unit))throw new HttpFail(400,'组织归属未变化');
  const preparation=randomUUID(),created=now(),expires=new Date(Date.now()+10*60*1000).toISOString();
  await db.query('INSERT INTO agent_organization_preparations(id,agent_id,actor,revision,company_id,org_unit_id,fingerprint,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[preparation,id,actor,ctx.current.revision,company,unit,ctx.fingerprint,expires,created]);
  return {preparation_id:preparation,expires_at:expires,revision:ctx.current.revision,org_version:ctx.org_version,before:ctx.current.assignment,after:ctx.after};
 },{isolation:'REPEATABLE READ'});
}
export async function changeAgentOrganization(actor:string,id:string,input:{preparation_id?:unknown;request_id?:unknown;confirmed?:unknown;reason?:unknown}):Promise<AgentOrganizationReceipt>{
 if(input.confirmed!==true||typeof input.preparation_id!=='string'||typeof input.request_id!=='string'||!/^[-\w]{8,100}$/.test(input.request_id)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500)throw new HttpFail(400,'归属调整须确认，提供预览依据、请求标识和变更原因');
 const reason=input.reason.trim();
 return postgresTransaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`agent-organization:${actor}:${input.request_id}`]);
  if(!(await db.query('SELECT id FROM managed_agents WHERE id=$1 FOR UPDATE',[id])).rowCount)throw new HttpFail(404,'Agent 不存在');
  const previous=(await db.query('SELECT * FROM agent_organization_receipts WHERE actor=$1 AND request_id=$2',[actor,input.request_id])).rows[0];
  if(previous){if(previous.agent_id!==id||previous.preparation_id!==input.preparation_id||previous.reason!==reason)throw new HttpFail(409,'请求标识已用于其他归属调整');return receipt(previous);}
  const prepared=(await db.query('SELECT * FROM agent_organization_preparations WHERE id=$1 AND agent_id=$2 AND actor=$3',[input.preparation_id,id,actor])).rows[0];
  if(!prepared||prepared.expires_at<=now())throw new HttpFail(409,'归属预览已过期，请重新预览');
  if((await db.query('SELECT id FROM agent_organization_receipts WHERE preparation_id=$1',[prepared.id])).rowCount)throw new HttpFail(409,'此预览已执行，请读取回执');
  await db.query('LOCK TABLE organization_units,org_versions IN SHARE MODE');
  const ctx=await context(db,id,prepared.company_id,prepared.org_unit_id);
  if(ctx.current.revision!==Number(prepared.revision)||ctx.fingerprint!==prepared.fingerprint)throw new HttpFail(409,'组织归属或部门关系已变化，请重新读取并预览');
  const revision=ctx.current.revision+1,changed=now(),receiptId=randomUUID();
  await db.query("UPDATE agent_organization_memberships SET status='ended',effective_to=$2 WHERE agent_id=$1 AND status='active'",[id,changed]);
  let after:AgentOrganizationAssignment|null=null;
  if(ctx.after){const membership=randomUUID();after={...ctx.after,id:membership,assigned_at:changed,assigned_by:actor};
   await db.query("INSERT INTO agent_organization_memberships(id,agent_id,company_id,org_unit_id,revision,status,assigned_by,effective_from) VALUES($1,$2,$3,$4,$5,'active',$6,$7)",[membership,id,after.company_id,after.org_unit_id,revision,actor,changed]);
  }
  await db.query('INSERT INTO agent_organization_receipts(id,agent_id,actor,revision,request_id,preparation_id,before_state,after_state,reason,changed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[receiptId,id,actor,revision,input.request_id,prepared.id,JSON.stringify(ctx.current.assignment),JSON.stringify(after),reason,changed]);
  const result:AgentOrganizationReceipt={id:receiptId,agent_id:id,actor,revision,changed_at:changed,before:ctx.current.assignment,after,reason};
  await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[changed,actor,'admin.agent.organization.change',JSON.stringify(result)]);
  return result;
 });
}
