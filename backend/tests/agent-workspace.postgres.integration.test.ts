import {beforeAll,beforeEach,afterAll,describe,it,expect} from "vitest";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import {Hono} from "hono";
import {postgresPool,closePostgresPool} from "../src/postgres/pool.js";
import {getConn,resetConn} from "../src/db.js";
import {withScopedUser,type AppUser} from "../src/auth.js";
import {agentWorkspaceRouter} from "../src/routers/agent-workspace.js";
import {adminAgentsRouter} from "../src/routers/admin-agents.js";
import {canUseAgent} from "../src/runtime/organization-tree.js";
import {HttpFail} from "../src/host/errors.js";
import {agentSkillCatalog,agentWorkspace,agentWorkspaceDetail,saveAgentDraft,prepareAgentRelease,publishAgentRelease,changeAgentAvailability,assertLegacyAgentWriteAllowed} from "../src/agents/workspace.js";
import {assertRuntimeSkill} from "../src/runtime/execution.js";
import {setAgentSkill,setAgentSkills} from "../src/runtime/store.js";

const testDatabaseUrl=process.env.TEST_POSTGRES_URL || process.env.TEST_DATABASE_URL;
describe.skipIf(!testDatabaseUrl)("Agent workspace native PostgreSQL release boundaries",()=>{
 const database=`agent_workspace_${randomUUID().replaceAll('-','')}`,agentId="agent:release-test",actor="admin",stamp="2026-10-12T01:00:00.000Z";
 let maintenance:Pool,skillA:string,skillB:string;
 const oldUrl=process.env.DATABASE_URL,oldAuth=process.env.AUTH_MODE;
 const input=(ids=[skillB])=>({name:"修订后的岗位",description:"新的职责",skill_ids:ids,expected_revision:0,expected_version:1});
 const release=(preparation_id:string,request_id=randomUUID())=>publishAgentRelease(actor,agentId,{preparation_id,request_id,confirmed:true});
 beforeAll(async()=>{
  maintenance=new Pool({connectionString:testDatabaseUrl});await maintenance.query(`CREATE DATABASE "${database}"`);
  const url=new URL(testDatabaseUrl!);url.pathname=`/${database}`;process.env.DATABASE_URL=url.toString();
  await promisify(execFile)(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),'scripts/apply-postgres-schema.ts'],{cwd:process.cwd(),env:process.env,timeout:120000});
  const db=await postgresPool().connect();try{const catalog=await agentSkillCatalog(db);const bundled=catalog.filter(value=>value.published&&!value.document_query);[skillA,skillB]=bundled.slice(0,2).map(value=>value.id);expect(skillB).toBeTruthy();}finally{db.release();}
  await postgresPool().query("INSERT INTO users(id,username,name,password_hash,roles,active,created_at,updated_at) VALUES('admin','admin','管理员','unusable','[\"admin\"]',1,$1,$1),('employee','employee','员工','unusable','[\"employee\"]',1,$1,$1)",[stamp]);
  await postgresPool().query("INSERT INTO organization_people(person_ref,user_id,display_name,created_at,updated_at) VALUES('person-admin','admin','管理员',$1,$1),('person-employee','employee','员工',$1,$1)",[stamp]);
  await postgresPool().query("INSERT INTO organization_units(id,company_id,type,level,parent_id,display_name,head_person_ref,created_at,updated_at) VALUES('company','company','company',1,NULL,'测试公司','person-admin',$1,$1),('department','company','department',2,'company','测试部门',NULL,$1,$1)",[stamp]);
  await postgresPool().query("INSERT INTO organization_memberships(id,company_id,org_unit_id,person_ref,created_at,updated_at) VALUES('membership','company','department','person-employee',$1,$1)",[stamp]);
  process.env.AUTH_MODE='enabled';resetConn();
 },150000);
 beforeEach(async()=>{
  await postgresPool().query("TRUNCATE agent_release_receipts,agent_release_preparations,agent_workspace_drafts,agent_workspace_versions");
  await postgresPool().query("DELETE FROM agent_bindings WHERE agent_id=$1",[agentId]);await postgresPool().query("DELETE FROM runtime_agent_skills WHERE agent_id=$1",[agentId]);await postgresPool().query("DELETE FROM managed_agents WHERE id=$1",[agentId]);
  await postgresPool().query("DELETE FROM skill_sops WHERE id=ANY($1::text[])",[[skillA,skillB]]);await postgresPool().query("DELETE FROM skill_lifecycle WHERE skill_id=ANY($1::text[])",[[skillA,skillB]]);await postgresPool().query("DELETE FROM skill_knowledge_configs WHERE skill_id=ANY($1::text[])",[[skillA,skillB]]);
  await postgresPool().query("DELETE FROM org_versions WHERE company_id='company'");
  await postgresPool().query("INSERT INTO org_versions(company_id,version,note,effective_at,created_at) VALUES('company',1,'fixture',$1,$1)",[stamp]);
  await postgresPool().query("INSERT INTO managed_agents(id,name,description,status,version,published_revision,created_at,updated_at) VALUES($1,'现有岗位','现有职责','published',1,1,$2,$2)",[agentId,stamp]);
  await postgresPool().query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES($1,$2,1,1,$3)",[agentId,skillA,stamp]);
  await postgresPool().query("INSERT INTO agent_bindings(id,agent_id,target_type,target_id,company_id,org_version,status,created_by,created_at,updated_at) VALUES('test-binding',$1,'organization_unit','department','company',1,'active','admin',$2,$2)",[agentId,stamp]);
 });
 afterAll(async()=>{getConn().close();await closePostgresPool();process.env.AUTH_MODE=oldAuth;if(maintenance){await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);await maintenance.end();}process.env.DATABASE_URL=oldUrl;},120000);
 it("keeps effective identity and assembly while a revision draft is saved",async()=>{
  await saveAgentDraft(actor,agentId,input());const row=await agentWorkspaceDetail(agentId);
  expect(row.name).toBe('现有岗位');expect(row.effective.skills.map(value=>value.skill_id)).toEqual([skillA]);expect(row.draft?.name).toBe('修订后的岗位');expect(row.versions[0].version).toBe(1);
  expect(row.coverage.user_ids.sort()).toEqual(['admin','employee']);
 });
 it("rejects concurrent stale edits and does not change the previous draft",async()=>{
  await saveAgentDraft(actor,agentId,input());await expect(saveAgentDraft(actor,agentId,{...input(),name:'过期修订'})).rejects.toMatchObject({status:409});expect((await agentWorkspaceDetail(agentId)).draft?.name).toBe('修订后的岗位');
 });
 it("publishes one immutable snapshot and replays the same receipt on retry",async()=>{
  await saveAgentDraft(actor,agentId,input());const check=await prepareAgentRelease(actor,agentId),key=randomUUID();
  expect(check.removed_skills).toEqual([skillA]);expect(check.added_skills).toEqual([skillB]);
  const [first,replay]=await Promise.all([release(check.preparation_id,key),release(check.preparation_id,key)]);expect(replay.id).toBe(first.id);expect(first.version).toBe(2);
  const row=await agentWorkspaceDetail(agentId);expect(row.draft).toBeNull();expect(row.effective.skills.map(value=>value.skill_id)).toEqual([skillB]);expect(row.versions.map(value=>value.version)).toEqual([2,1]);
  expect(Number((await postgresPool().query("SELECT count(*) FROM audit_events WHERE event_type='admin.agent.release.publish' AND payload::jsonb->>'agent_id'=$1",[agentId])).rows[0].count)).toBe(1);
 });
 it.each(['draft','organization','skill','binding'])("requires another confirmation after %s evidence changes",async(kind)=>{
  await saveAgentDraft(actor,agentId,input());const check=await prepareAgentRelease(actor,agentId);
  if(kind==='draft')await saveAgentDraft(actor,agentId,{...input(),name:'再修订',expected_revision:1});
  if(kind==='organization')await postgresPool().query("UPDATE org_versions SET version=2 WHERE company_id='company'");
  if(kind==='skill')await postgresPool().query("INSERT INTO skill_sops(id,summary,body,updated_at) VALUES($1,'已修订','已修订',$2)",[skillB,stamp]);
  if(kind==='binding')await postgresPool().query("UPDATE agent_bindings SET status='revoked' WHERE id='test-binding'");
  await expect(release(check.preparation_id)).rejects.toMatchObject({status:409});expect((await agentWorkspaceDetail(agentId)).published_revision).toBe(1);
 });
 it("blocks unpublished dependencies and missing assembly or bindings",async()=>{
  await saveAgentDraft(actor,agentId,input([]));expect((await prepareAgentRelease(actor,agentId)).blockers).toContain('发布前请先装配至少一项技能');
  await saveAgentDraft(actor,agentId,{...input(),expected_revision:1});await postgresPool().query("INSERT INTO skill_lifecycle(skill_id,stage,updated_at) VALUES($1,'draft',$2)",[skillB,stamp]);
  const check=await prepareAgentRelease(actor,agentId);expect(check.blockers.some(value=>value.includes('尚未发布'))).toBe(true);await expect(release(check.preparation_id)).rejects.toMatchObject({status:409});
 });
 it("binds preparation to the actor and rejects expiration",async()=>{
  await saveAgentDraft(actor,agentId,input());const check=await prepareAgentRelease(actor,agentId);
  await expect(publishAgentRelease('another-admin',agentId,{preparation_id:check.preparation_id,request_id:randomUUID(),confirmed:true})).rejects.toMatchObject({status:409});
  await postgresPool().query("UPDATE agent_release_preparations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1",[check.preparation_id]);await expect(release(check.preparation_id)).rejects.toMatchObject({status:409});
 });
 it("disables immediately and enables only the previous release without applying the draft",async()=>{
  await saveAgentDraft(actor,agentId,input());await changeAgentAvailability(actor,agentId,{status:'disabled',expected_version:1,confirmed:true});
  await changeAgentAvailability(actor,agentId,{status:'published',expected_version:2,confirmed:true});const row=await agentWorkspaceDetail(agentId);expect(row.draft).not.toBeNull();expect(row.effective.skills[0].skill_id).toBe(skillA);expect(row.published_revision).toBe(1);
 });
 it("does not permit assembly updates through legacy APIs after draft governance starts",async()=>{
  await saveAgentDraft(actor,agentId,input());await expect(assertLegacyAgentWriteAllowed(agentId)).rejects.toMatchObject({status:409});
  expect(()=>setAgentSkill(agentId,skillB,true,0)).toThrow('修订草稿');expect(()=>setAgentSkills(agentId,[{skill_id:skillB,enabled:true,expected_version:0}])).toThrow('修订草稿');
 });
 it("blocks runtime invocation when a pinned skill has changed",async()=>{
  await saveAgentDraft(actor,agentId,input());const check=await prepareAgentRelease(actor,agentId);await release(check.preparation_id);
  expect(()=>assertRuntimeSkill({agentId,skillId:skillB,userId:actor,runId:'test'})).not.toThrow();
  await postgresPool().query("INSERT INTO skill_sops(id,summary,body,updated_at) VALUES($1,'changed','changed',$2)",[skillB,stamp]);
  expect(()=>assertRuntimeSkill({agentId,skillId:skillB,userId:actor,runId:'test'})).toThrow('runtime_agent_skill_upgrade_required');
 });
 it("returns real projection data to admins and denies employees",async()=>{
  const app=new Hono().route('/api',agentWorkspaceRouter);app.onError((e,c)=>c.json({message:e.message},(e instanceof HttpFail?e.status:500) as 403));
  const user:AppUser={id:'employee',username:'employee',name:'员工',handle:'employee',roles:['employee'],role:'employee',brands:[],site:'department',manager_user_id:null,active:true,exam_passed:true,exam_todo_count:0,exam_module:''};
  expect((await withScopedUser(user,()=>app.request('/api/admin/agents/workspace-v1'))).status).toBe(403);
  expect((await agentWorkspace()).agents.find(value=>value.id===agentId)?.coverage.org_version).toBe(1);
 });
 it("requires a fresh revoke preview after another binding changes and immediately removes qualification",async()=>{
  const app=new Hono().route('/api',adminAgentsRouter);app.onError((e,c)=>c.json({message:e.message},(e instanceof HttpFail?e.status:500) as 409));
  const admin:AppUser={id:actor,username:actor,name:'管理员',handle:actor,roles:['admin'],role:'admin',brands:[],site:'department',manager_user_id:null,active:true,exam_passed:true,exam_todo_count:0,exam_module:''};
  const base=`/api/admin/agents/${encodeURIComponent(agentId)}/bindings/test-binding`;
  const call=(method:string,url:string,body?:unknown)=>withScopedUser(admin,()=>app.request(url,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  const check=await (await call('POST',`${base}/revoke-preview`)).json() as {org_version:number;preview_signature:string};
  await postgresPool().query("UPDATE agent_bindings SET binding_version=binding_version+1 WHERE id='test-binding'");
  expect((await call('DELETE',base,{...check,reason:'test'})).status).toBe(409);expect(canUseAgent('employee',agentId)).toBe(true);
  const next=await (await call('POST',`${base}/revoke-preview`)).json();expect((await call('DELETE',base,{...next,reason:'test'})).status).toBe(200);expect(canUseAgent('employee',agentId)).toBe(false);
 });
 it("creates an unpublished draft and requires confirmation for release",async()=>{
  const created=await saveAgentDraft(actor,null,{...input(),expected_version:undefined});expect(created.status).toBe('draft');expect(created.published_revision).toBeNull();expect(created.effective.skills).toEqual([]);
  const check=await prepareAgentRelease(actor,created.id);expect(check.blockers).toContain('发布前请先绑定组织或人员');
  for(const confirmed of [false,'false',1]) {
   await expect(publishAgentRelease(actor,created.id,{preparation_id:check.preparation_id,request_id:randomUUID(),confirmed:confirmed as boolean})).rejects.toMatchObject({status:400});
   await expect(changeAgentAvailability(actor,agentId,{status:'disabled',expected_version:1,confirmed:confirmed as boolean})).rejects.toMatchObject({status:400});
  }
 });
});
