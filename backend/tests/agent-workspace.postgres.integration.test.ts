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
import {prepareAgentOrganization,changeAgentOrganization} from '../src/agents/organization.js';

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
  await postgresPool().query("INSERT INTO organization_units(id,company_id,type,level,parent_id,display_name,created_at,updated_at) VALUES('owner-root','company','center',1,'company','一级中心',$1,$1),('owner-dept','company','center',2,'owner-root','二级部门',$1,$1),('owner-team','company','department',3,'owner-dept','三级小组',$1,$1),('owner-other','company','department',2,'owner-root','另一部门',$1,$1),('foreign-root','foreign','center',1,'foreign','外公司中心',$1,$1)",[stamp]);
  process.env.AUTH_MODE='enabled';resetConn();
  await postgresPool().query("INSERT INTO organization_units(id,company_id,type,level,parent_id,display_name,created_at,updated_at) VALUES('owner-ai','company','team',4,'owner-team','AI产品组',$1,$1)",[stamp]);
 },150000);
 beforeEach(async()=>{
  await postgresPool().query("TRUNCATE agent_release_receipts,agent_release_preparations,agent_workspace_drafts,agent_workspace_versions,agent_organization_receipts,agent_organization_preparations,agent_organization_memberships");
  await postgresPool().query("DELETE FROM audit_events WHERE event_type LIKE 'admin.agent.%' AND payload::jsonb->>'agent_id'=$1",[agentId]);
  await postgresPool().query("UPDATE organization_units SET status='active',display_name=CASE id WHEN 'owner-dept' THEN '二级部门' WHEN 'owner-team' THEN '三级小组' ELSE display_name END,parent_id=CASE id WHEN 'owner-team' THEN 'owner-dept' ELSE parent_id END WHERE id IN ('owner-dept','owner-team')");
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
 const governanceInput=async(organization:{company_id:string;org_unit_id:string}|null={company_id:'company',org_unit_id:'owner-team'},targets=[{company_id:'company',target_type:'person' as const,target_id:'person-employee'}])=>{
  const row=await agentWorkspaceDetail(agentId);return {...input([skillA]),expected_version:row.version,name:row.name,description:row.description,governance:{organization,bindings:targets,reason:'岗位配置调整',basis:row.governance_basis!}};
 };
 it('saves ownership and personnel changes without changing current grants, then publishes the reviewed configuration together',async()=>{
  const candidate=await governanceInput(),before=await agentWorkspaceDetail(agentId);await saveAgentDraft(actor,agentId,candidate);const saved=await agentWorkspaceDetail(agentId);
  expect(saved.organization).toEqual(before.organization);expect(saved.bindings).toEqual(before.bindings);expect(saved.effective).toEqual(before.effective);expect(saved.draft?.governance?.organization?.org_unit_id).toBe('owner-team');
  const check=await prepareAgentRelease(actor,agentId);expect(check.blockers).toEqual([]);expect(check.changes?.organization?.after?.org_unit_id).toBe('owner-team');expect(check.changes?.bindings_removed).toHaveLength(1);expect(check.changes?.bindings_added[0].target_id).toBe('person-employee');
  const request=randomUUID(),first=await release(check.preparation_id,request),replay=await release(check.preparation_id,request);expect(first.id).toBe(replay.id);const after=await agentWorkspaceDetail(agentId);expect(after.organization.assignment?.org_unit_id).toBe('owner-team');expect(after.bindings).toHaveLength(1);expect(after.bindings[0].target_type).toBe('person');expect(after.effective.skills).toEqual(before.effective.skills);expect(after.organization_history).toHaveLength(1);expect(after.draft).toBeNull();
 });
 it('prevents a pending configuration from restoring an emergency-revoked grant',async()=>{
  await saveAgentDraft(actor,agentId,await governanceInput());const check=await prepareAgentRelease(actor,agentId);await postgresPool().query("UPDATE agent_bindings SET status='revoked',binding_version=binding_version+1 WHERE agent_id=$1",[agentId]);
  await expect(release(check.preparation_id)).rejects.toMatchObject({status:409});expect((await prepareAgentRelease(actor,agentId)).blockers.some(value=>value.includes('绑定已变化'))).toBe(true);expect((await agentWorkspaceDetail(agentId)).bindings).toEqual([]);
 });
 it('invalidates pending configuration after a formal ownership change and requires explicit refreshed draft basis',async()=>{
  const candidate=await governanceInput();await saveAgentDraft(actor,agentId,candidate);const check=await prepareAgentRelease(actor,agentId);await ownerChange((await ownerPreview('owner-other')).preparation_id);
  await expect(release(check.preparation_id)).rejects.toMatchObject({status:409});await expect(saveAgentDraft(actor,agentId,{...candidate,expected_revision:1})).rejects.toMatchObject({status:409});expect((await agentWorkspaceDetail(agentId)).organization.assignment?.org_unit_id).toBe('owner-other');
 });
 it('rejects cross-company candidate targets and blocks missing reasons and an empty change set',async()=>{
  const candidate=await governanceInput();await expect(saveAgentDraft(actor,agentId,{...candidate,governance:{...candidate.governance,bindings:[{target_type:'organization_unit',target_id:'foreign-root',company_id:'company'}]}})).rejects.toMatchObject({status:400});
  await saveAgentDraft(actor,agentId,{...candidate,governance:{...candidate.governance,reason:''}});expect((await prepareAgentRelease(actor,agentId)).blockers.some(value=>value.includes('变更原因'))).toBe(true);
  const row=await agentWorkspaceDetail(agentId);await saveAgentDraft(actor,agentId,{...input([skillA]),name:row.name,description:row.description,expected_revision:1,governance:{organization:null,bindings:row.bindings.map(({company_id,target_type,target_id})=>({company_id,target_type,target_id})),reason:'',basis:row.governance_basis}});expect((await prepareAgentRelease(actor,agentId)).blockers.some(value=>value.includes('无需发布'))).toBe(true);
 });
 it('rolls back ownership, personnel grants and receipts when applying the capability version fails',async()=>{
  await saveAgentDraft(actor,agentId,await governanceInput());const check=await prepareAgentRelease(actor,agentId),before=await agentWorkspaceDetail(agentId);
  await postgresPool().query("CREATE FUNCTION reject_agent_release_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture capability write rejected'; END $$; CREATE TRIGGER reject_agent_release_fixture BEFORE UPDATE ON runtime_agent_skills FOR EACH ROW EXECUTE FUNCTION reject_agent_release_fixture()");
  try{await expect(release(check.preparation_id)).rejects.toThrow('fixture capability write rejected');}finally{await postgresPool().query('DROP TRIGGER reject_agent_release_fixture ON runtime_agent_skills; DROP FUNCTION reject_agent_release_fixture()');}
  const after=await agentWorkspaceDetail(agentId);expect(after.organization).toEqual(before.organization);expect(after.bindings).toEqual(before.bindings);expect(after.effective).toEqual(before.effective);expect(after.draft).toEqual(before.draft);expect(after.organization_history).toEqual([]);expect(Number((await postgresPool().query('SELECT count(*) FROM agent_release_receipts WHERE agent_id=$1',[agentId])).rows[0].count)).toBe(0);
 });
 it('rejects duplicate multi-company personnel selections and updates an existing canonical grant company only on reviewed release',async()=>{
  await postgresPool().query("INSERT INTO organization_memberships(id,company_id,org_unit_id,person_ref,status,created_at,updated_at) VALUES('fixture-foreign-member','foreign','foreign-root','person-employee','active',$1,$1)",[stamp]);
  try{
   const target={company_id:'foreign',target_type:'person' as const,target_id:'person-employee'},candidate=await governanceInput(null);
   await expect(saveAgentDraft(actor,agentId,{...candidate,governance:{...candidate.governance,bindings:[target]}})).rejects.toMatchObject({status:409});
   await postgresPool().query("INSERT INTO org_versions(company_id,version,note,effective_at,created_at) VALUES('foreign',1,'fixture',$1,$1)",[stamp]);
   await expect(saveAgentDraft(actor,agentId,{...candidate,governance:{...candidate.governance,bindings:[...candidate.governance.bindings,target]}})).rejects.toMatchObject({status:400});
   await saveAgentDraft(actor,agentId,candidate);await release((await prepareAgentRelease(actor,agentId)).preparation_id);await saveAgentDraft(actor,agentId,await governanceInput(null,[target]));expect((await agentWorkspaceDetail(agentId)).bindings[0].company_id).toBe('company');
   await release((await prepareAgentRelease(actor,agentId)).preparation_id);expect((await agentWorkspaceDetail(agentId)).bindings[0].company_id).toBe('foreign');
  }finally{await postgresPool().query("DELETE FROM organization_memberships WHERE id='fixture-foreign-member'; DELETE FROM org_versions WHERE company_id='foreign'");}
 });
 it('requires explicit removal of a missing legacy skill, preserving published assembly until confirmed release',async()=>{
  const missing='sop_content_planning';await postgresPool().query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES($1,$2,1,1,$3)",[agentId,missing,stamp]);
  await expect(saveAgentDraft(actor,agentId,input([skillA,missing]))).rejects.toMatchObject({status:400,message:`技能 ${missing} 不存在`});expect((await agentWorkspaceDetail(agentId)).draft).toBeNull();
  await saveAgentDraft(actor,agentId,input([skillA]));const saved=await agentWorkspaceDetail(agentId);expect(saved.effective.skills.map(pin=>pin.skill_id)).toContain(missing);expect(saved.draft?.skills.map(pin=>pin.skill_id)).toEqual([skillA]);expect(saved.published_revision).toBe(1);
  const check=await prepareAgentRelease(actor,agentId);expect(check.removed_skills).toEqual([missing]);expect(check.blockers).toEqual([]);await release(check.preparation_id);const published=await agentWorkspaceDetail(agentId);expect(published.effective.skills.map(pin=>pin.skill_id)).toEqual([skillA]);expect(published.versions.find(version=>version.version===1)?.skills.map(pin=>pin.skill_id)).toContain(missing);
 });
 const ownerPreview=(org_unit_id:string|null='owner-team',expected_revision=0,company_id:string|null=org_unit_id?'company':null)=>prepareAgentOrganization(actor,agentId,{company_id,org_unit_id,expected_revision});
 const ownerChange=(preparation_id:string,request_id=randomUUID())=>changeAgentOrganization(actor,agentId,{preparation_id,request_id,confirmed:true,reason:'明确岗位归属'});
 it('migrates existing Agents as unassigned and uses the native organization directory',async()=>{
  const workspace=await agentWorkspace();expect(workspace.agents.find(row=>row.id===agentId)?.organization.assignment).toBeNull();
  expect(workspace.browse.facets.ownership.find(option=>option.value==='unassigned')?.count).toBe(workspace.agents.length);
  expect(workspace.organization_directory.selectable_ids).toContain('owner-team');
  expect(workspace.browse.facets.level3.find(option=>option.value==='owner-team')?.path).toBe('一级中心 / 二级部门 / 三级小组');
 });
 it('assigns, moves and clears a single primary department with immutable receipts, keeping human qualification and drafts',async()=>{
  // Initialize the existing runtime registry bootstrap before taking either preview snapshot.
  expect(canUseAgent('employee',agentId)).toBe(true);
  await saveAgentDraft(actor,agentId,input());const releaseCheck=await prepareAgentRelease(actor,agentId),before=await agentWorkspaceDetail(agentId);
  const check=await ownerPreview();expect(check.after?.path.map(unit=>unit.level)).toEqual([1,2,3]);
  const key=randomUUID(),[first,replay]=await Promise.all([ownerChange(check.preparation_id,key),ownerChange(check.preparation_id,key)]);expect(first.id).toBe(replay.id);
  const assigned=await agentWorkspaceDetail(agentId);expect(assigned.organization.revision).toBe(1);expect(assigned.bindings).toEqual(before.bindings);expect(assigned.coverage).toEqual(before.coverage);expect(assigned.draft).toEqual(before.draft);expect(assigned.effective).toEqual(before.effective);expect(assigned.version).toBe(before.version);expect(canUseAgent('employee',agentId)).toBe(true);
  const scoped=await agentWorkspace({level1:'owner-root',level2:'owner-dept',level3:'owner-team'});expect(scoped.browse.rows.map(row=>row.id)).toEqual([agentId]);expect(scoped.browse.facets.level1.find(option=>option.value==='owner-root')?.count).toBe(1);
  const moved=await ownerPreview('owner-root',1);await ownerChange(moved.preparation_id);expect((await agentWorkspace({level1:'owner-root'})).browse.rows.map(row=>row.id)).toEqual([agentId]);expect((await agentWorkspace({level2:'owner-dept'})).browse.rows).toEqual([]);
  const cleared=await ownerPreview(null,2);await ownerChange(cleared.preparation_id);const after=await agentWorkspaceDetail(agentId);expect(after.organization.assignment).toBeNull();expect(after.organization_history.map(row=>row.revision)).toEqual([3,2,1]);expect(Number((await postgresPool().query("SELECT COUNT(*) FROM agent_organization_memberships WHERE agent_id=$1 AND status='active'",[agentId])).rows[0].count)).toBe(0);
  // Ownership revisions do not invalidate an independent capability release preparation.
  await release(releaseCheck.preparation_id);expect((await agentWorkspaceDetail(agentId)).published_revision).toBe(2);
 });
 it.each(['name','parent','archived','version','concurrent'])('rejects stale ownership confirmation after %s changes',async(kind)=>{
  const check=await ownerPreview();
  if(kind==='name')await postgresPool().query("UPDATE organization_units SET display_name='改名部门' WHERE id='owner-dept'");
  if(kind==='parent')await postgresPool().query("UPDATE organization_units SET parent_id='owner-other' WHERE id='owner-team'");
  if(kind==='archived')await postgresPool().query("UPDATE organization_units SET status='archived' WHERE id='owner-dept'");
  if(kind==='version')await postgresPool().query("UPDATE org_versions SET version=2 WHERE company_id='company'");
  if(kind==='concurrent'){const other=await ownerPreview('owner-root');await ownerChange(other.preparation_id);}
  await expect(ownerChange(check.preparation_id)).rejects.toMatchObject({status:409});expect((await agentWorkspaceDetail(agentId)).organization.revision).toBe(kind==='concurrent'?1:0);
 });
 it('serializes competing ownership commands and rejects idempotency-key reuse with different confirmed content',async()=>{
  const [first,second]=await Promise.all([ownerPreview('owner-team'),ownerPreview('owner-other')]);
  const key=randomUUID(),results=await Promise.allSettled([ownerChange(first.preparation_id,key),ownerChange(second.preparation_id)]);expect(results.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(results.filter(value=>value.status==='rejected')).toHaveLength(1);
  expect((await agentWorkspaceDetail(agentId)).organization.revision).toBe(1);
  const stored=(await postgresPool().query('SELECT request_id,preparation_id FROM agent_organization_receipts WHERE agent_id=$1',[agentId])).rows[0];
  await expect(changeAgentOrganization(actor,agentId,{...stored,confirmed:true,reason:'换了原因'})).rejects.toMatchObject({status:409});
 });
 it('uses a genuine fourth-level department while exposing the requested three ancestor filters',async()=>{
  const check=await ownerPreview('owner-ai');expect(check.after?.path.map(unit=>unit.level)).toEqual([1,2,3,4]);await ownerChange(check.preparation_id);
  const result=await agentWorkspace({level1:'owner-root',level2:'owner-dept',level3:'owner-team'});expect(result.browse.rows.map(row=>row.id)).toEqual([agentId]);expect(result.organization_directory.selectable_ids).toContain('owner-ai');
 });
 it('refreshes current names and ancestors from organization tables and retains archived ownership for recovery',async()=>{
  await ownerChange((await ownerPreview()).preparation_id);
  await postgresPool().query("UPDATE organization_units SET display_name='新部门名称' WHERE id='owner-dept'");expect((await agentWorkspaceDetail(agentId)).organization.assignment?.path[1].display_name).toBe('新部门名称');
  await postgresPool().query("UPDATE organization_units SET parent_id='owner-other' WHERE id='owner-team'");expect((await agentWorkspace({level2:'owner-other'})).browse.rows.map(row=>row.id)).toEqual([agentId]);
  await postgresPool().query("UPDATE organization_units SET status='archived' WHERE id='owner-team'");const invalid=await agentWorkspace({ownership:'invalid',level3:'owner-team'});expect(invalid.browse.filters.level3).toBe('');expect(invalid.browse.rows.map(row=>row.id)).toEqual([agentId]);expect(invalid.browse.rows[0].organization.assignment?.valid).toBe(false);
  const history=(await agentWorkspaceDetail(agentId)).organization_history;expect(history[0].after?.path[1].display_name).toBe('二级部门');
 });
 it('requires an actor-bound unexpired preview, literal confirmation and reason; composite FK rejects cross-company storage',async()=>{
  await expect(ownerPreview('foreign-root',0,'company')).rejects.toMatchObject({status:400});
  const check=await ownerPreview();const command={preparation_id:check.preparation_id,request_id:randomUUID(),confirmed:true,reason:'依据'};
  await expect(changeAgentOrganization('another-admin',agentId,command)).rejects.toMatchObject({status:409});
  await expect(changeAgentOrganization(actor,agentId,{...command,confirmed:'true'})).rejects.toMatchObject({status:400});
  await expect(changeAgentOrganization(actor,agentId,{...command,reason:' '})).rejects.toMatchObject({status:400});
  await postgresPool().query("UPDATE agent_organization_preparations SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1",[check.preparation_id]);await expect(ownerChange(check.preparation_id)).rejects.toMatchObject({status:409});
  await expect(postgresPool().query("INSERT INTO agent_organization_memberships(id,agent_id,company_id,org_unit_id,revision,status,assigned_by,effective_from) VALUES('invalid-owner',$1,'company','foreign-root',1,'active','admin',$2)",[agentId,stamp])).rejects.toMatchObject({code:'23503'});
  expect((await agentWorkspaceDetail(agentId)).organization.assignment).toBeNull();
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
  for(const suffix of ['organization-preview-v1','organization-v1'])expect((await withScopedUser(user,()=>app.request(`/api/admin/agents/${encodeURIComponent(agentId)}/${suffix}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}))).status).toBe(403);
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
