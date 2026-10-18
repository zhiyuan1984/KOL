import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach,afterEach,describe,it,expect } from 'vitest';
import { freshTestDatabase } from './support/pg.js';
import { getConn,resetConn } from '../src/db.js';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
import { ontologySchema } from '../src/ontology/schema.js';
import { createAgentBinding,revokeAgentBinding,syncUserOrganization } from '../src/runtime/organization-tree.js';
import { seedPublishedAgent } from './fixtures/runtime-auth.js';
import { setAgentSkill,setSkillConnector,setSkillTool,setConnectorConfig,setToolPolicy,getSkillConnectors,getSkillTool,getToolPolicy } from '../src/runtime/store.js';
import { SkillExecution,toolSchemaHash,runtimeSkillVersion,type RuntimeContext } from '../src/runtime/execution.js';
import {agentSkillCatalog} from '../src/agents/workspace.js';
import {postgresPool} from '../src/postgres/pool.js';
import { createCredential } from '../src/runtime/credentials.js';
import type { Json } from '../src/types.js';

const context:RuntimeContext={agentId:'agent:capability-test',skillId:'creator_library_query',userId:'capability-user',runId:'capability-test-run'};
const descriptor:Json={name:'pageKolProfiles',description:'Supplier implementation',inputSchema:{type:'object',properties:{requestJson:{type:'string'}},required:['requestJson'],additionalProperties:false},annotations:{readOnlyHint:true}};
let temp:string, bindingId:string;
beforeEach(async()=>{
  await freshTestDatabase({empty:true});
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'capability-runtime-'));process.env.LINGONG_DATA=temp;process.env.AUTH_MODE='enabled';process.env.NODE_ENV='test';process.env.RUNTIME_CREDENTIAL_MASTER_KEY=Buffer.alloc(32,7).toString('base64');
  const db=getConn();await db.query(ontologySchema);
  await db.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES($1,$1,'Test actor','not-a-password','["employee"]','["LT"]','',1,$2,$2)`,[context.userId,new Date().toISOString()]);
  const person=await syncUserOrganization(context.userId,'org:lt_team');
  await seedPublishedAgent(context.agentId);await setAgentSkill(context.agentId,context.skillId,true,0);
  bindingId=(await createAgentBinding({agent_id:context.agentId,target_type:'person',target_id:person,company_id:'company:amperetime',source:'test'})).id;
  const definition=loadOntologyCatalog().objects.find(item=>item.code==='kol_profile')!;
  await db.query(`INSERT INTO ontology_documents(company_id,code,revision,published,disabled,updated_at) VALUES('company:amperetime','kol_profile',2,$1,false,$2)`,[JSON.stringify(definition),new Date().toISOString()]);
  await db.query(`INSERT INTO ontology_versions(id,company_id,code,revision,action,actor,reason,definition,created_at) VALUES('capability-publication','company:amperetime','kol_profile',2,'publish',$1,'isolated integration fixture',$2,$3)`,[context.userId,JSON.stringify(definition),new Date().toISOString()]);
  await db.query(`INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('starrykol','test connector',1,'configured',$1) ON CONFLICT(id) DO UPDATE SET enabled=1`,[new Date().toISOString()]);
  const prior=(await getSkillConnectors(context.skillId)).find(item=>item.connector_id==='starrykol');
  await setSkillConnector(context.skillId,'starrykol',true,Number(prior?.version||0));
  const apiKey=await createCredential({type:'organization_secret',secret:'isolated-fixture-key'},context.userId);
  const account=await createCredential({type:'user_account',owner_user_id:context.userId,secret:'isolated-fixture-account'},context.userId);
  await setConnectorConfig('starrykol',{url:'http://capability.example.test/mcp',headers_secret_refs:{'X-MCP-API-KEY':apiKey.id},credential_provider:'user-account',credential_account_id:account.id},0);
  const policy=await getToolPolicy('starrykol','pageKolProfiles');
  await setToolPolicy('starrykol','pageKolProfiles',{enabled:true,risk:'L1',access:'read',schema_hash:toolSchemaHash(descriptor)},Number(policy?.version||0));
  const tool=await getSkillTool(context.skillId,'starrykol','pageKolProfiles');
  await setSkillTool(context.skillId,'starrykol','pageKolProfiles',true,Number(tool?.version||0));
});
afterEach(async()=>{await resetConn();if(temp)fs.rmSync(temp,{recursive:true,force:true});delete process.env.LINGONG_DATA;delete process.env.AUTH_MODE;delete process.env.RUNTIME_CREDENTIAL_MASTER_KEY;});

describe('business capability reuses the native runtime gates',()=>{
  it('uses the same release fingerprint for Agent assembly and actual execution',async()=>{
    const db=await postgresPool().connect();let hash:string;
    try{hash=(await agentSkillCatalog(db)).find(skill=>skill.id===context.skillId)!.release_hash;}finally{db.release();}
    expect(hash).toBe(await runtimeSkillVersion(context.skillId));
    await getConn().query('UPDATE runtime_agent_skills SET release_hash=$1 WHERE agent_id=$2 AND skill_id=$3',[hash,context.agentId,context.skillId]);
    const execution=new SkillExecution(context,()=>({listTools:async()=>[descriptor],callToolRaw:async()=>({}),close:async()=>{}}));
    try{expect((await execution.discover()).tools).toHaveLength(1);}finally{execution.close();}
  });
  it('exposes a stable operation and dispatches through the existing reviewed binding',async()=>{
    const calls:unknown[]=[];
    const execution=new SkillExecution(context,()=>({listTools:async()=>[descriptor],callToolRaw:async(name,args)=>{calls.push({name,args});return {structuredContent:{list:[],total:0},content:[]};},close:async()=>{}}));
    try{
      const catalog=await execution.discover();expect(catalog.tools.map(item=>item.exposed.name)).toEqual(['cap_creator_query_v1']);
      expect(catalog.tools[0].exposed.description).not.toContain('Supplier');
      const result=await execution.invoke('cap_creator_query_v1',{page_no:1,page_size:20});
      expect(result.structuredContent).toMatchObject({items:[],total:0,page_no:1,page_size:20});
      expect(calls).toEqual([{name:'pageKolProfiles',args:{requestJson:'{"pageNo":1,"pageSize":20}'}}]);
      const audits=(await getConn().query(`SELECT payload FROM audit_events WHERE event_type='runtime.tool.completed'`)).rows;
      expect(audits).toHaveLength(1);
    }finally{execution.close();}
  });
  it('rejects revoked eligibility before sending any remote operation',async()=>{
    let calls=0;const execution=new SkillExecution(context,()=>({listTools:async()=>[descriptor],callToolRaw:async()=>{calls++;return {};},close:async()=>{}}));
    try{await execution.discover();await revokeAgentBinding(bindingId,{reason:'integration revocation'});await expect(execution.invoke('cap_creator_query_v1',{})).rejects.toBeDefined();expect(calls).toBe(0);}finally{execution.close();}
  });
  it('rejects an ontology change after discovery before remote dispatch',async()=>{
    let calls=0;const execution=new SkillExecution(context,()=>({listTools:async()=>[descriptor],callToolRaw:async()=>{calls++;return {};},close:async()=>{}}));
    try{await execution.discover();await getConn().query(`UPDATE ontology_documents SET disabled=true WHERE company_id='company:amperetime' AND code='kol_profile'`);await expect(execution.invoke('cap_creator_query_v1',{})).rejects.toMatchObject({detail:{code:'ontology_dependency_not_published'}});expect(calls).toBe(0);}finally{execution.close();}
  });
  it('does not expose unbound supplier operations or bypass a missing implementation',async()=>{
    const execution=new SkillExecution(context,()=>({listTools:async()=>[],callToolRaw:async()=>({}),close:async()=>{}}));
    try{await expect(execution.discover()).rejects.toMatchObject({detail:{code:'capability_implementation_unavailable'}});}finally{execution.close();}
  });
  it('rejects a business contract that understates the reviewed implementation risk',async()=>{
    const policy=await getToolPolicy('starrykol','pageKolProfiles');
    await setToolPolicy('starrykol','pageKolProfiles',{enabled:true,risk:'L2',access:'write',schema_hash:toolSchemaHash(descriptor)},Number(policy!.version));
    let calls=0;const execution=new SkillExecution(context,()=>({listTools:async()=>[descriptor],callToolRaw:async()=>{calls++;return {};},close:async()=>{}}));
    try{await expect(execution.discover()).rejects.toMatchObject({detail:{code:'capability_implementation_unavailable'}});expect(calls).toBe(0);}finally{execution.close();}
  });
});
