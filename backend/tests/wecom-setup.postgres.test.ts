import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { freshTestDatabase } from './support/pg.js';
import { closePostgresPool, postgresPool } from '../src/postgres/pool.js';
import { setupWecomOntologySource } from '../src/ontology/wecom-setup.js';
import { ensureRuntimeSchema, setToolPolicy } from '../src/runtime/store.js';
import { ensureManagedAgents } from '../src/runtime/managed-agents.js';
import type { TicketPrincipal } from '../src/ticket-domain/auth.js';
import { wecomOntologyRuntimeTools } from '../../shared/wecom-ontology.js';

const stamp='2026-10-20T00:00:00.000Z';
const company='company:wecom-setup-test';
const actor:TicketPrincipal={id:'wecom-setup-admin',username:'setup',name:'隔离测试管理员',email:null,roles:['admin'],active:true};
const setup=()=>setupWecomOntologySource(actor,{companyId:company,confirmed:true,reason:'隔离测试仅装配本体只读来源'});

beforeAll(async()=>{
  await freshTestDatabase({empty:true});
  const db=postgresPool();
  await db.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES($1,$1,'测试管理员','not-a-password','["admin"]','[]','',1,$2,$2)`,[actor.id,stamp]);
  await db.query(`INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at)
    VALUES('person:setup','测试管理员',$1,'active',$2,$2)`,[actor.id,stamp]);
  await db.query(`INSERT INTO organization_units(id,company_id,display_name,type,level,status,created_at,updated_at)
    VALUES('unit:setup',$1,'隔离测试组织','department',1,'active',$2,$2)`,[company,stamp]);
  await db.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,status,created_at,updated_at)
    VALUES('membership:setup','person:setup',$1,'unit:setup','active',$2,$2)`,[company,stamp]);
  await ensureRuntimeSchema();
  await ensureManagedAgents();
  await db.query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('wecom-mcp','WeCom local fixture',1,'verified',$1) ON CONFLICT(id) DO UPDATE SET enabled=1", [stamp]);
  await db.query(`INSERT INTO runtime_connector_config(connector_id,config_json,version,updated_at)
    VALUES('wecom-mcp',$1,1,$2)`,[JSON.stringify({url:'http://127.0.0.1:9/mcp',allow_unauthenticated:true}),stamp]);
  for(const tool of Object.values(wecomOntologyRuntimeTools)) await setToolPolicy('wecom-mcp',tool,{enabled:true,risk:'L1',access:'read',schema_hash:'a'.repeat(64)},0);
},120000);
afterAll(async()=>{await closePostgresPool();});

async function protectedState(){
  const db=postgresPool();const tables=['users','organization_units','organization_people','organization_memberships','agent_bindings','runtime_tool_policies'];
  return Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows])));
}

describe('Explicit WeCom source assembly over native disposable PostgreSQL',()=>{
  it('does not mount without confirmation, creates exactly three source tools atomically, and preserves protected records and policies',async()=>{
    await expect(setupWecomOntologySource(actor,{companyId:company,confirmed:false,reason:'不能自动装配'})).rejects.toMatchObject({status:422});
    const before=await protectedState();const first=await setup();
    expect(first).toMatchObject({companyId:company,connectorId:'wecom-mcp',skillId:'wecom_ontology_read',replayed:false});
    expect(first.tools).toEqual(Object.values(wecomOntologyRuntimeTools));
    expect(await protectedState()).toEqual(before);
    const mounted=await postgresPool().query("SELECT tool_name,version FROM runtime_skill_tools WHERE skill_id='wecom_ontology_read' ORDER BY tool_name");
    expect(mounted.rows.map(r=>r.tool_name)).toEqual([...Object.values(wecomOntologyRuntimeTools)].sort());
    const replay=await setup();expect(replay.replayed).toBe(true);
    expect((await postgresPool().query("SELECT tool_name,version FROM runtime_skill_tools WHERE skill_id='wecom_ontology_read' ORDER BY tool_name")).rows).toEqual(mounted.rows);
    expect(Number((await postgresPool().query('SELECT count(*) AS n FROM ontology_wecom_source_snapshots')).rows[0].n)).toBe(0);
  });
  it('never revives a disabled connector, skill, agent or tool mount',async()=>{
    const db=postgresPool();
    await db.query("UPDATE connectors SET enabled=0 WHERE id='wecom-mcp'");await expect(setup()).rejects.toMatchObject({status:409});
    expect((await db.query("SELECT enabled FROM connectors WHERE id='wecom-mcp'")).rows[0].enabled).toBe(0);
    await db.query("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('wecom-mcp','WeCom local fixture',1,'verified',$1) ON CONFLICT(id) DO UPDATE SET enabled=1", [stamp]);
    await db.query("UPDATE skill_lifecycle SET stage='disabled' WHERE skill_id='wecom_ontology_read'");await expect(setup()).rejects.toMatchObject({status:409});
    await db.query("UPDATE skill_lifecycle SET stage='published' WHERE skill_id='wecom_ontology_read'");
    await db.query("UPDATE managed_agents SET status='disabled' WHERE id='agent:platform-sync'");await expect(setup()).rejects.toMatchObject({status:409});
    await db.query("UPDATE managed_agents SET status='published' WHERE id='agent:platform-sync'");
    await db.query("UPDATE runtime_skill_tools SET enabled=0 WHERE skill_id='wecom_ontology_read' AND tool_name='wecom_get_sync_status'");await expect(setup()).rejects.toMatchObject({status:409});
    expect((await db.query("SELECT enabled FROM runtime_skill_tools WHERE skill_id='wecom_ontology_read' AND tool_name='wecom_get_sync_status'")).rows[0].enabled).toBe(0);
  });
});
