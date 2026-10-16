import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePostgresPool } from '../src/postgres/pool.js';
import { performanceSchema, performanceApprovalSchema } from '../src/performance/schema.js';
import { PerformanceService } from '../src/performance/service.js';
import type { PerformanceRules } from '../../shared/performance.js';
const url=process.env.PERFORMANCE_TEST_DATABASE_URL;
const suite=url?describe:describe.skip;
const schema=`performance_test_${process.pid}_${Date.now()}`;
const actors=['admin','employee','manager','department','hr','payroll','outsider'];
const service=(actor:string)=>new PerformanceService({id:actor,username:actor,name:actor,email:null,active:true,roles:actor==='admin'?['admin']:['employee']},'company:test');
const command=(actor:string,body:Record<string,unknown>)=>service(actor).command({...body,confirmed:true,commandId:randomUUID()});
const rules:PerformanceRules={bands:[{grade:'A',min:90,coefficient:.18},{grade:'B',min:80,coefficient:.15},{grade:'C',min:0,coefficient:0}],adjustmentCap:5,maxObjectives:7,distributionNote:'审核人员说明',coefficientBasis:'initial'};
let root:Pool;
async function provision(){
 const publish=async(kind:string,data:unknown,name:string,rulesId?:unknown)=>{const draft=await command('admin',{type:'save_asset',kind,name,data,publish:false});let version=Number(draft.version);await command('admin',{type:'asset_action',id:draft.id,expectedVersion:version++,action:'submit',reviewerIds:['department','hr'],rulesId});await command('department',{type:'asset_action',id:draft.id,expectedVersion:version++,action:'approve',reason:'核对目标与标准'});await command('hr',{type:'asset_action',id:draft.id,expectedVersion:version++,action:'approve',reason:'复核制度与系数'});await command('admin',{type:'asset_action',id:draft.id,expectedVersion:version,action:'publish'});return draft;};
 const rule=await publish('rules',rules,'集成测试规则');
 const template=await publish('template',{instructions:'测试',objectives:[{title:'交付',definition:'验收结果',standard:'按约定标准',weight:100}]},'集成测试模板',rule.id);
 const cycle=await command('admin',{type:'create_cycle',name:'集成测试周期',month:'2026-09',templateId:template.id,rulesId:rule.id});
 const record=await command('admin',{type:'assign_record',cycleId:cycle.id,employeeId:'employee',unitId:'unit:test',managerId:'manager',departmentId:'department',hrId:'hr',payrollId:'payroll'});
 await command('admin',{type:'cycle_action',id:cycle.id,action:'activate',expectedVersion:1});
 return {cycleId:cycle.id as string,recordId:record.id as string};
}
suite('native PostgreSQL performance authority and durable workflow',()=>{
 beforeAll(async()=>{
  root=new Pool({connectionString:url});await root.query(`CREATE SCHEMA ${schema}`);
  const scoped=new URL(url!);scoped.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=scoped.toString();await closePostgresPool();
  const db=new Pool({connectionString:scoped.toString()});try{
   await db.query(`CREATE TABLE users(id text PRIMARY KEY,active integer);CREATE TABLE organization_people(person_ref text,user_id text,display_name text,status text);CREATE TABLE organization_memberships(person_ref text,company_id text,org_unit_id text,position text,status text,effective_from text,effective_to text);CREATE TABLE organization_units(id text,company_id text,display_name text,status text,parent_id text);${performanceSchema}${performanceApprovalSchema}`);
   await db.query("INSERT INTO organization_units VALUES('unit:test','company:test','测试组','active',NULL)");
   for(const actor of actors){await db.query('INSERT INTO users VALUES($1,1)',[actor]);await db.query("INSERT INTO organization_people VALUES($1,$1,$1,'active')",[actor]);await db.query("INSERT INTO organization_memberships VALUES($1,'company:test','unit:test','','active',NULL,NULL)",[actor]);}
  }finally{await db.end();}
 });
 afterAll(async()=>{await closePostgresPool();if(root){await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}});
 it('does not grant sensitive record access to admins or unrelated members',async()=>{const {recordId}=await provision();await expect(service('admin').detail(recordId)).rejects.toMatchObject({status:404});await expect(service('outsider').detail(recordId)).rejects.toMatchObject({status:404});expect((await service('employee').detail(recordId)).record.employeeId).toBe('employee');});
 it('saves drafts durably and rejects stale writes, tampered authority and unconfirmed formal commands',async()=>{const {recordId}=await provision();const view=await service('employee').detail(recordId);const objectives=view.record.objectives.map(o=>({...o,weight:100}));const saved=await command('employee',{type:'save_record',id:recordId,expectedVersion:1,section:'plan',objectives});expect(saved.version).toBe(2);expect((await service('employee').detail(recordId)).record.objectives[0].weight).toBe(100);await expect(command('employee',{type:'save_record',id:recordId,expectedVersion:1,section:'plan',objectives})).rejects.toMatchObject({status:409});await expect(command('employee',{type:'save_record',id:recordId,expectedVersion:2,section:'manager',objectives})).rejects.toMatchObject({status:403});await expect(service('employee').command({type:'record_action',id:recordId,expectedVersion:2,action:'submit_plan',commandId:randomUUID()})).rejects.toMatchObject({status:409});});
 it('returns the original receipt for duplicate commands and rejects changed payloads',async()=>{const {recordId}=await provision();const view=await service('employee').detail(recordId);const request={type:'save_record',id:recordId,expectedVersion:1,section:'plan',objectives:view.record.objectives,commandId:randomUUID()};const first=await service('employee').command(request);expect(await service('employee').command(request)).toEqual(first);await expect(service('employee').command({...request,expectedVersion:2})).rejects.toMatchObject({status:409});});
 it('completes all human review stages, shields unpublished scores, publishes and acknowledges',async()=>{const {cycleId,recordId}=await provision();let view=await service('employee').detail(recordId);await command('employee',{type:'save_record',id:recordId,section:'plan',expectedVersion:view.record.version,objectives:view.record.objectives.map(o=>({...o,weight:100}))});
  const step=async(actor:string,action:string,reason='已核对并通过')=>{const v=await service(actor).detail(recordId);await command(actor,{type:'record_action',id:recordId,expectedVersion:v.record.version,action,reason});};
  await step('employee','submit_plan');await step('manager','confirm_plan');view=await service('employee').detail(recordId);await command('employee',{type:'save_record',id:recordId,section:'self',expectedVersion:view.record.version,objectives:view.record.objectives.map(o=>({...o,selfScore:96,actual:'已验收',evidence:'测试依据'}))});await step('employee','submit_self');view=await service('manager').detail(recordId);await command('manager',{type:'save_record',id:recordId,section:'manager',expectedVersion:view.record.version,objectives:view.record.objectives.map(o=>({...o,managerScore:85,managerComment:'核对完成情况'}))});
  const hidden=await service('employee').detail(recordId);expect(hidden.result.score).toBeNull();expect(hidden.record.objectives[0].managerScore).toBeNull();expect(hidden.record.objectives[0].managerComment).toBe('');await step('manager','submit_manager');await step('department','approve_department');await step('hr','approve_hr');await step('payroll','approve_payroll');await command('admin',{type:'cycle_action',id:cycleId,expectedVersion:2,action:'release'});view=await service('employee').detail(recordId);expect(view.resultVisible).toBe(true);expect(view.result.score).toBe(85);await step('employee','acknowledge');expect((await service('employee').detail(recordId)).record.stage).toBe('acknowledged');});
});
