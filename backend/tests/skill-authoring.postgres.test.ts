import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Hono} from 'hono';
import {freshTestDatabase} from './support/pg.js';
import {getConn,resetConn} from '../src/db.js';
import {withScopedUser,type AppUser} from '../src/auth.js';
import {syncUserOrganization} from '../src/runtime/organization-tree.js';
import {postgresPool,postgresTransaction} from '../src/postgres/pool.js';
import {loadOntologyCatalog} from '../src/ontology/catalog.js';
import {importEnterpriseCatalog} from '../src/ontology/enterprise.js';
import {clearTaskRegistryCache,taskDefinition} from '../src/tasks/registry.js';
import {parseSkillUpload,skillAuthoringOptions,saveSkillAuthoring,loadSkillAuthoring,checkSkillAuthoring,emptyAuthoring} from '../src/host/skill-authoring.js';
import {parseSkillAuthoring} from '../src/host/skill-authoring-contract.js';
import type {SkillAuthoring} from '../../shared/skill-authoring.js';
import {getSkillDraft,updatePublishedSkill} from '../src/host/skill-publish.js';
import {transitionSkillStage,skillPublishCheck} from '../src/host/skill-lifecycle.js';
import {skillAuthoringRouter} from '../src/routers/skill-authoring.js';
const company='company:amperetime';
const user:AppUser={id:'authoring-native-admin',username:'authoring-native-admin',handle:'authoring-native-admin',name:'Isolated authoring administrator',roles:['admin'],role:'admin',brands:['LT'],site:'',manager_user_id:null,active:true,exam_passed:true,exam_todo_count:0,exam_module:''};
const asAdmin=<T>(fn:()=>T)=>withScopedUser(user,fn);
let tmp:string;
const general=(id:string)=>({id,title:'分析方法',body:'# 方法\n逐项分析，保留来源。',context:{requires:['mail_thread'],prefers:['creator']},authoring:{...emptyAuthoring(),company,mode:'general' as SkillAuthoring['mode'],general_scope:'已获准的文本分析',purpose:'分析文本',use_when:'需要分析时',expected_result:'有来源的分析',recovery:'缺信息则停下并指出缺项'}});
beforeAll(async()=>{
 await freshTestDatabase({empty:true});process.env.NODE_ENV='test';process.env.AUTH_MODE='enabled';process.env.CODEX_MODE='real';tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stage5-owned-'));process.env.LINGONG_DATA=tmp;
 const stamp=new Date().toISOString();await getConn().query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES($1,$1,'Isolated admin','not-a-password','["admin"]','["LT"]','',1,$2,$2)`,[user.id,stamp]);await syncUserOrganization(user.id,'org:lt_team');
 const catalog=loadOntologyCatalog();await postgresTransaction(db=>importEnterpriseCatalog(db,catalog.objects,user.id));const definition=catalog.objects.find(o=>o.code==='kol_profile')!;
 await postgresPool().query(`INSERT INTO ontology_documents(company_id,code,revision,draft,published,disabled,updated_at) VALUES($1,'kol_profile',3,$2,$2,false,$3)`,[company,JSON.stringify(definition),stamp]);
 await postgresPool().query(`INSERT INTO ontology_versions(id,company_id,code,revision,action,actor,reason,definition,created_at) VALUES($1,$2,'kol_profile',2,'publish',$3,'isolated fixture',$4,$5)`,[randomUUID(),company,user.id,JSON.stringify(definition),stamp]);clearTaskRegistryCache();
});
afterAll(async()=>{await resetConn();fs.rmSync(tmp,{recursive:true,force:true});delete process.env.AUTH_MODE;delete process.env.CODEX_MODE;delete process.env.LINGONG_DATA;clearTaskRegistryCache();});
describe('stage5 owned native authoring and existing gates',()=>{
 it('rejects duplicate objects and uploaded secrets; strips untrusted runtime activation declarations',()=>{
  const authoring={...general('contract').authoring,objects:[{object:'kol_profile',revision:2,actions:[]},{object:'kol_profile',revision:2,actions:[]}]};expect(()=>parseSkillAuthoring(authoring)).toThrow('重复');
  expect(()=>parseSkillUpload('---\nid: unsafe\n---\napi_key=abcdefghijklmnop')).toThrow('密钥');
  const parsed=parseSkillUpload('---\nid: safe\nruntime_access: true\ncontext: {requires: [mail_thread], prefers: [creator]}\n---\n方法');expect(parsed.spec.context).toEqual({requires:['mail_thread'],prefers:['creator']});expect(parsed.spec.runtime_access).toBeUndefined();expect(parsed.spec._imported).toBe(true);
 });
 it('shows all six themes, registered objects and true published revision, without connector configuration',()=>asAdmin(async()=>{
  const result=await skillAuthoringOptions(company);expect(result.objects.find(o=>o.code==='kol_profile')?.revision).toBe(2);expect(result.objects.find(o=>o.code==='ent_b04_84f240141be6ae60')?.revision).toBeNull();expect(new Set(result.objects.filter(o=>o.code.startsWith('ent_b04_')).map(o=>o.taxonomy[2])).size).toBeGreaterThanOrEqual(6);expect(JSON.stringify(result.capabilities)).not.toMatch(/implementation|secret_ref|api_key/);
  await expect(skillAuthoringOptions('company:unknown')).rejects.toMatchObject({status:403});
 }));
 it('saves a genuine draft preserving realtime mail context and explicit general scope without Agent grants',()=>asAdmin(async()=>{
  const saved=await saveSkillAuthoring({spec:general('authoring_general')});expect(saved.check.ready).toBe(true);const definition=await taskDefinition('authoring_general');expect(definition?.context).toEqual({requires:['mail_thread'],prefers:['creator']});expect(definition?.authoring?.general_scope).toBe('已获准的文本分析');expect((await skillPublishCheck('authoring_general')).can_publish).toBe(false);
  expect((await getConn().query('SELECT to_stage FROM skill_stage_history WHERE skill_id=$1',['authoring_general'])).rows[0].to_stage).toBe('draft');
 }));
 it('keeps edits in the candidate, rejects stale edits and permits exactly one concurrent save',()=>asAdmin(async()=>{
  const state=await loadSkillAuthoring('authoring_general'),definition=await taskDefinition('authoring_general'),source=fs.readFileSync(definition!.path,'utf8');
  const results=await Promise.allSettled(['one','two'].map(body=>saveSkillAuthoring({spec:{...state.spec,body},stamp:state.stamp},'authoring_general')));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect(fs.readFileSync(definition!.path,'utf8')).toBe(source);await expect(saveSkillAuthoring({spec:state.spec,stamp:state.stamp},'authoring_general')).rejects.toMatchObject({status:409});expect((await getSkillDraft('authoring_general')).patch.context).toEqual({requires:['mail_thread'],prefers:['creator']});
 }));
 it('allows incomplete object binding only as draft and blocks existing testing transition',()=>asAdmin(async()=>{
  const spec=general('authoring_pending');spec.authoring={...spec.authoring,mode:'business',objects:[{object:'ent_b04_84f240141be6ae60',revision:null,actions:[]}]} as typeof spec.authoring;
  const saved=await saveSkillAuthoring({spec});expect(saved.check.ready).toBe(false);expect(saved.check.issues.join()).toContain('正式版本');await transitionSkillStage('authoring_pending','editing');await expect(transitionSkillStage('authoring_pending','testing')).rejects.toMatchObject({status:409});
 }));
 it('refuses malformed dependency/context contracts and changed formal versions',()=>asAdmin(async()=>{
  await expect(checkSkillAuthoring({...general('invalid'),context:{requires:['invented'],prefers:[]}})).rejects.toMatchObject({status:400});
  const spec={...general('version'),authoring:{...general('version').authoring,mode:'business',objects:[{object:'kol_profile',revision:1,actions:[]}]},ontology:[{object:'kol_profile',revision:1}]};expect((await checkSkillAuthoring(spec)).issues.join()).toContain('正式版本已变化');
 }));
 it('classifies upload as third party and never auto grants/publishes it',()=>asAdmin(async()=>{
  const parsed=parseSkillUpload('---\nid: authoring_import\ntitle: 上传方法\n---\n方法');const saved=await saveSkillAuthoring({spec:{...parsed.spec,context:{requires:[],prefers:[]},authoring:general('import').authoring}});expect(saved.check.ready).toBe(true);expect((await getConn().query('SELECT stage,origin FROM skill_lifecycle WHERE skill_id=$1',['authoring_import'])).rows[0]).toMatchObject({stage:'draft',origin:'third_party'});
 }));
 it('keeps authoring and mail context through the existing pack-update path, and protects bundled packs',()=>asAdmin(async()=>{
  await updatePublishedSkill('authoring_general',{body:'# 更新后的原方法'});const definition=await taskDefinition('authoring_general');expect(definition?.context).toEqual({requires:['mail_thread'],prefers:['creator']});expect(definition?.authoring?.mode).toBe('general');
  const bundled=await loadSkillAuthoring('creator_profile');expect(bundled.editable).toBe(false);await expect(saveSkillAuthoring({spec:{...bundled.spec,authoring:general('clone').authoring},stamp:bundled.stamp},'creator_profile')).rejects.toMatchObject({status:409});
 }));
 it('rejects unauthenticated/employee authoring over the actual router, preserves validation errors',async()=>{
  const app=new Hono();app.onError((error,c)=>c.json({error:error.message},((error as {status?:number}).status||500) as 400));app.route('/api',skillAuthoringRouter);
  expect((await app.request('/api/admin/skill-authoring/options')).status).toBe(403);
  expect((await withScopedUser({...user,roles:['employee']},()=>app.request('/api/admin/skill-authoring/options'))).status).toBe(403);
  expect((await asAdmin(()=>app.request('/api/admin/skill-authoring/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'[]'}))).status).toBe(400);
 });
});
