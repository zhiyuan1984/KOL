import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {postgresPool,postgresTransaction} from '../postgres/pool.js';
import {HttpFail} from '../host/errors.js';
import {skillDependencyIssues} from '../host/skill-lifecycle.js';
import {assertRuntimeSkill} from '../runtime/execution.js';
import {businessCompanyForUser} from '../ontology/runtime-dependencies.js';
import {taskDefinition} from './registry.js';
import {appendTaskEventIn} from '../task-events.js';
import {messageContextInput} from '../host/context-resolve.js';
import {assertNoPlaintextSkillSecrets} from '../host/skill-authoring-contract.js';
import type {Json,Row} from '../types.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const record=(v:unknown):Json=>{if(typeof v==='string'){try{return record(JSON.parse(v));}catch{return {};}}return v&&typeof v==='object'&&!Array.isArray(v)?v as Json:{};};
const text=(v:unknown,max=512)=>typeof v==='string'?v.trim().slice(0,max):'';
async function owned(db:Pick<PoolClient,'query'>,actor:string,id:string,lock=false){const task=(await db.query<Row>(`SELECT * FROM tickets WHERE id=$1 AND owner_user_id=$2 ${lock?'FOR UPDATE':''}`,[id,actor])).rows[0];if(!task)throw new HttpFail(404,'任务不存在或无权访问');return task;}
async function target(actor:string,agent:string,skill:string){await assertRuntimeSkill({userId:actor,agentId:agent,skillId:skill,runId:'task-handoff-check'});const issues=await skillDependencyIssues(skill);if(issues.unregistered.length||issues.unmounted.length)throw new HttpFail(409,'目标技能的工具依赖尚未就绪；原任务与成果保留');return (await taskDefinition(skill))!;}
function reference(input:Json,key:string){const v=record(input[key]);return v.id?{id:text(String(v.id)),...(v.version!==undefined?{version:text(String(v.version),128)}:{})}:null;}
/** Only stable references cross the boundary. No source tool results, raw mail,
 * secret, permission grant, or automatic business command is transferred. */
export function handoffReferences(task:Row,company:string):Json{
 const input=record(task.input),entities=record(task.entities),refs=messageContextInput(input);
 const objects=Array.isArray(refs.object_refs)?refs.object_refs:[];
 for(const [key,kind] of [['candidate_id','candidate'],['creator_id','kol_profile'],['kolUid','kol_profile'],['cooperation_id','collaboration']] as const){const id=text(String(input[key]||entities[key]||''));if(id&&!objects.some(v=>record(v).kind===kind&&record(v).id===id))objects.push({kind,id});}
 return {company_id:company,object_refs:objects,...(text(input.brand)?{brand:text(input.brand)}:{}),...(text(input.campaign_id)?{campaign_id:text(input.campaign_id)}:{}),...refs,
  followup:reference(input,'followup_ref'),evaluation:reference(input,'evaluation_ref'),source:reference(input,'source_ref'),contact_source:reference(input,'contact_source_ref'),draft:reference(input,'draft_ref'),
  confirmed_selections:Array.isArray(input.confirmed_selections)?input.confirmed_selections.slice(0,16).flatMap(v=>{const r=record(v);return r.id?[{kind:text(r.kind,64),id:text(String(r.id)),...(r.version?{version:text(String(r.version),128)}:{})}]:[]}):[],
  todos:Array.isArray(input.todo_refs)?input.todo_refs.slice(0,20).flatMap(v=>{const r=record(v);return r.id?[{id:text(String(r.id))}]:[]}):[],
  permission_context_ref:{source_task_id:task.id,source_version:Number(task.data_version||1),source_agent_id:text(input.agent_id)||'agent:kol',revalidation_required:true},
 };
}
export async function listTaskHandoffs(actor:string,taskId:string){await owned(postgresPool(),actor,taskId);return (await postgresPool().query('SELECT id,target_agent_id,target_skill_id,package,fingerprint,target_task_id,created_at,accepted_at FROM task_agent_handoffs WHERE task_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 20',[taskId,actor])).rows;}
export async function handoffTargets(actor:string,taskId:string){const source=await owned(postgresPool(),actor,taskId);const sourceAgent=text(record(source.input).agent_id)||'agent:kol';const rows=(await postgresPool().query<{agent_id:string;skill_id:string;name:string}>(`SELECT r.agent_id,r.skill_id,a.name FROM runtime_agent_skills r JOIN managed_agents a ON a.id=r.agent_id AND a.status='published' WHERE r.enabled=1 AND r.agent_id<>$1 ORDER BY a.name,r.skill_id`,[sourceAgent])).rows;const options=[];for(const row of rows){try{const d=await target(actor,row.agent_id,row.skill_id);options.push({...row,skill_name:d.title});}catch(error){if(!(error instanceof HttpFail))throw error;}}return options;}
export async function proposeTaskHandoff(actor:string,taskId:string,body:Json){
 const agent=text(body.target_agent_id),skill=text(body.target_skill_id),reason=text(body.reason,2000),command=text(body.command_id,200),version=Number(body.expected_version);
 if(!agent||!skill||!reason||command.length<8||!Number.isSafeInteger(version)||version<1)throw new HttpFail(422,'请选择目标智能体、技能，填写交接原因并刷新任务版本');
 try{assertNoPlaintextSkillSecrets(reason);}catch{throw new HttpFail(422,'交接原因不得包含明文凭据');}
 await target(actor,agent,skill);const commandHash=hash([taskId,agent,skill,reason,version]);
 return postgresTransaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['handoff:'+actor+':'+command]);const prior=(await db.query('SELECT * FROM task_agent_handoffs WHERE actor_id=$1 AND command_id=$2',[actor,command])).rows[0];if(prior){if(prior.command_hash!==commandHash)throw new HttpFail(409,'交接请求标识已用于不同内容');return prior;}
  const task=await owned(db,actor,taskId,true);if(Number(task.data_version||1)!==version)throw new HttpFail(409,'原任务已变化，请重新核对交接');
  const company=await businessCompanyForUser(actor,db),refs=handoffReferences(task,company),packageValue={schema:'task-agent-handoff.v1',task:{id:task.id,title:task.title,source:task.source,version},source_agent_id:text(record(task.input).agent_id)||'agent:kol',target_agent_id:agent,target_skill_id:skill,reason,references:refs,missing_refs:['followup','evaluation','source','contact_source','draft'].filter(k=>!refs[k]),automatic_actions:false};
  try{assertNoPlaintextSkillSecrets(JSON.stringify(packageValue));}catch{throw new HttpFail(422,'交接引用中包含疑似明文凭据，请先修正原任务');}
  const id='handoff_'+randomUUID(),fingerprint=hash(packageValue);const row=(await db.query(`INSERT INTO task_agent_handoffs(id,actor_id,task_id,command_id,command_hash,source_version,target_agent_id,target_skill_id,package,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,actor,taskId,command,commandHash,version,agent,skill,JSON.stringify(packageValue),fingerprint])).rows[0];
  await appendTaskEventIn(db,taskId,null,'task.handoff.prepared','已准备智能体交接',String(task.status),'交接候选已保存；尚未创建后续任务或执行任何业务动作');return row;
 });
}
/** The router supplies its ORIGINAL task creator inside the native transaction.
 * Receipt+linked task commit together; source task and legacy Agent remain intact. */
export async function acceptTaskHandoff(actor:string,taskId:string,id:string,body:Json,create:(body:Json)=>Promise<Json>){
 if(body.confirmed!==true||typeof body.fingerprint!=='string')throw new HttpFail(409,'请核对交接包后确认创建后续任务');
 return postgresTransaction(async db=>{const task=await owned(db,actor,taskId,true);const row=(await db.query('SELECT * FROM task_agent_handoffs WHERE id=$1 AND task_id=$2 AND actor_id=$3 FOR UPDATE',[id,taskId,actor])).rows[0];if(!row)throw new HttpFail(404,'交接不存在');
  if(row.fingerprint!==body.fingerprint)throw new HttpFail(409,'交接内容已变化，请重新核对');await target(actor,row.target_agent_id,row.target_skill_id);
  if(row.target_task_id){await owned(db,actor,row.target_task_id);return {id:row.id,target_task_id:row.target_task_id,replayed:true};}
  if(Number(task.data_version||1)!==Number(row.source_version))throw new HttpFail(409,'原任务已变化，请重新准备交接');
  const pkg=record(row.package),refs=record(pkg.references),source=record(task.input),definition=(await taskDefinition(row.target_skill_id))!;
  const declared=Object.fromEntries((definition.input_schema||[]).filter(f=>source[f.key]!==undefined).map(f=>[f.key,source[f.key]]));
  const created=await create({task_type:row.target_skill_id,title:String(task.title).slice(0,160)+' · 后续工作',agent_id:row.target_agent_id,input:{...declared,...messageContextInput(refs),object_refs:refs.object_refs||[],company_id:refs.company_id,_handoff:{id,source_task_id:taskId,source_version:row.source_version,fingerprint:row.fingerprint}},source:'agent_handoff'});
  const targetId=String(created.id||record(created.task).id||'');if(!targetId)throw new HttpFail(500,'原任务创建器未返回任务标识');await owned(db,actor,targetId);
  await db.query('UPDATE task_agent_handoffs SET target_task_id=$1,accepted_at=now() WHERE id=$2',[targetId,id]);await appendTaskEventIn(db,taskId,null,'task.handoff.accepted','已关联后续任务',String(task.status),'后续任务 '+targetId+' 已创建；原任务、负责人和业务状态保持原状');
  return {id,target_task_id:targetId,replayed:false};
 });
}
/** Resolve only a server-persisted receipt, never a user-forged input._handoff. */
export async function taskHandoffExecutionEvidence(actor:string,taskId:string,agent:string,skill:string){
 const db=postgresPool();await owned(db,actor,taskId);const row=(await db.query('SELECT * FROM task_agent_handoffs WHERE target_task_id=$1 AND actor_id=$2',[taskId,actor])).rows[0];if(!row)return null;
 if(row.target_agent_id!==agent||row.target_skill_id!==skill)throw new HttpFail(409,{code:'handoff_target_mismatch',message:'交接任务的目标智能体或技能已变化，请重新核对'});
 const source=await owned(db,actor,row.task_id);await target(actor,agent,skill);if(Number(source.data_version||1)!==Number(row.source_version))throw new HttpFail(409,{code:'handoff_source_changed',message:'来源任务已更新，请回到原任务重新准备交接；旧成果保留'});
 return {schema:'task-handoff-execution.v1',handoff_id:row.id,source_task_id:row.task_id,source_version:row.source_version,package:row.package,references_only:true,revalidate_live_evidence:true};
}
export async function taskHandoffOrigin(actor:string,taskId:string){
 const db=postgresPool();await owned(db,actor,taskId);const row=(await db.query('SELECT task_id,source_version FROM task_agent_handoffs WHERE target_task_id=$1 AND actor_id=$2',[taskId,actor])).rows[0];if(!row)return null;
 const source=(await db.query('SELECT title,data_version FROM tickets WHERE id=$1 AND owner_user_id=$2',[row.task_id,actor])).rows[0];return {task_id:row.task_id,readable:Boolean(source),...(source?{title:source.title,stale:Number(source.data_version)!==Number(row.source_version)}:{})};
}
