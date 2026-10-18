import {postgresTransaction} from '../src/postgres/pool.js';
import {enterpriseSchema,enterpriseSource,importEnterpriseCatalog,enterpriseHash} from '../src/ontology/enterprise.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ontologySchema } from '../src/ontology/schema.js';
import { OntologyService } from '../src/ontology/service.js';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
import { closePostgresPool, postgresPool } from '../src/postgres/pool.js';
import { ontology } from '../src/routers/ontology-workspace.js';
import { withTicketPrincipal, type TicketPrincipal } from '../src/ticket-domain/auth.js';
import { HttpFail } from '../src/host/errors.js';
import type { OntologyDefinition } from '../../shared/ontology.js';

const url=process.env.ONTOLOGY_TEST_DATABASE_URL;
if(url&&!/^ontology_it_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)))throw Error('This suite requires its own ontology_it_* disposable database');
const suite=url?describe:describe.skip;
const actor=(id='admin_a'):TicketPrincipal=>({id,username:id,name:id,email:null,active:true,roles:id.startsWith('admin')?['admin','employee']:['employee']});
const service=(id='admin_a',company=id.endsWith('_b')?'company:b':'company:a')=>new OntologyService(actor(id),company);
const baseline=loadOntologyCatalog();
const definition=(code='native_object'):OntologyDefinition=>({code,id:'TEST-'+code,name:'Native PostgreSQL '+code,description:'隔离测试定义',layer:'kol_business',taxonomy:['测试业务族','测试业务域','测试业务主题'],source:'isolated integration fixture',items:{properties:[{code:'title',name:'名称',description:'测试字段',source:'isolated integration fixture',type:'text'}],relations:[],events:[],rules:[],actions:[]}});
const save=(d:OntologyDefinition,expectedRevision=0,id='admin_a')=>service(id).save({definition:d,expectedRevision,sourceVersion:baseline.sourceVersion,reason:'集成测试保存草稿'});
async function commit(code:string,expectedRevision:number,action='publish',id='admin_a',targetVersion?:string){
  const preview=await service(id).prepare({code,expectedRevision,action,targetVersion});
  return service(id).commit({token:preview.token,commandId:randomUUID(),confirmed:true,reason:'集成测试确认'+action});
}
const objectFrom=async(code:string,id='employee_a')=>(await service(id).catalog()).objects.find(o=>o.code===code);

suite('ontology native PostgreSQL integration (isolated disposable database)',()=>{
  beforeAll(async()=>{
    await closePostgresPool();process.env.DATABASE_URL=url!;
    await postgresPool().query(`
      CREATE TABLE users(id text PRIMARY KEY,active integer NOT NULL);
      CREATE TABLE organization_people(person_ref text PRIMARY KEY,user_id text,status text);
      CREATE TABLE organization_units(id text PRIMARY KEY,company_id text,status text);
      CREATE TABLE organization_memberships(person_ref text,company_id text,org_unit_id text,status text,effective_from text,effective_to text);
    `);
    await postgresPool().query(ontologySchema);await postgresPool().query(enterpriseSchema);
    // Run twice: a normal feature migration must be idempotent.
    await postgresPool().query(ontologySchema);await postgresPool().query(enterpriseSchema);
    for(const company of ['a','b']){
      await postgresPool().query('INSERT INTO organization_units VALUES($1,$2,$3)',['unit:'+company,'company:'+company,'active']);
      for(const role of ['admin','employee']){
        const id=role+'_'+company;
        await postgresPool().query('INSERT INTO users VALUES($1,1)',[id]);
        await postgresPool().query("INSERT INTO organization_people VALUES($1,$1,'active')",[id]);
        await postgresPool().query("INSERT INTO organization_memberships VALUES($1,$2,$3,'active',NULL,NULL)",[id,'company:'+company,'unit:'+company]);
      }
    }
  });
  beforeEach(async()=>{
    // Only these feature tables, inside the disposable ontology_it_* database.
    await postgresPool().query('TRUNCATE ontology_documents,ontology_versions,ontology_confirmations,ontology_receipts');
    await postgresPool().query("UPDATE organization_memberships SET status='active',effective_to=NULL");
    await postgresPool().query('UPDATE users SET active=1');
  });
  afterAll(async()=>{await closePostgresPool();});

  it('uses native jsonb storage, an idempotent schema and no mock connection',async()=>{
    const types=await postgresPool().query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='ontology_documents'");
    expect(types.rows.find(r=>r.column_name==='draft')?.data_type).toBe('jsonb');
    expect((await postgresPool().query('SELECT current_database() AS name')).rows[0].name).toMatch(/^ontology_it_/);
    expect((await service().catalog(true)).objects).toHaveLength(930);
    expect((await service('employee_a').catalog()).objects).toHaveLength(894);
  });
  it('persists drafts across pool reconnects without exposing them to employees',async()=>{
    const receipt=await save(definition());expect(receipt.revision).toBe(1);
    await closePostgresPool();
    const item=(await service().catalog(true)).objects.find(o=>o.code==='native_object');
    expect(item?.draft?.name).toBe('Native PostgreSQL native_object');expect(item?.published).toBeNull();
    expect(await objectFrom('native_object')).toBeUndefined();
    expect((await service().history('native_object')).items[0].action).toBe('save_draft');
  });
  it('publishes once under duplicate concurrent confirmations and replays the same receipt',async()=>{
    await save(definition());const preview=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    const body={token:preview.token,commandId:randomUUID(),confirmed:true,reason:'并发重复确认'};
    const receipts=await Promise.all([service().commit(body),service().commit(body)]);
    expect(receipts[0]).toEqual(receipts[1]);expect(receipts[0].revision).toBe(2);
    expect((await objectFrom('native_object'))?.published?.name).toBe('Native PostgreSQL native_object');
    expect((await postgresPool().query("SELECT count(*)::int AS count FROM ontology_versions WHERE action='publish'")).rows[0].count).toBe(1);
    expect((await postgresPool().query('SELECT count(*)::int AS count FROM ontology_receipts')).rows[0].count).toBe(1);
    await expect(service().commit({...body,reason:'变更后的请求'})).rejects.toMatchObject({status:409});
  });
  it('permits exactly one concurrent stale-base draft save',async()=>{
    const d=definition();const other=structuredClone(d);other.name='并发修订';
    const results=await Promise.allSettled([save(d),save(other)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const failure=results.find(r=>r.status==='rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({status:409});
    expect((await service().history(d.code)).items).toHaveLength(1);
  });
  it('isolates tenant drafts, published definitions, history and confirmation tokens',async()=>{
    await save(definition());const preview=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    expect((await service('admin_b').history('native_object')).items).toHaveLength(0);
    expect((await service('admin_b').catalog(true)).objects.some(o=>o.code==='native_object')).toBe(false);
    await expect(service('admin_b').commit({token:preview.token,commandId:randomUUID(),confirmed:true,reason:'跨公司确认'})).rejects.toMatchObject({status:409});
    await expect(service('admin_a','company:b').catalog(true)).rejects.toMatchObject({status:403});
    await commit('native_object',1);expect(await objectFrom('native_object','employee_b')).toBeUndefined();
  });
  it('denies writes after membership revocation, expiry or account deactivation',async()=>{
    await save(definition());const preview=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    await postgresPool().query("UPDATE organization_memberships SET status='inactive' WHERE person_ref='admin_a'");
    await expect(service().commit({token:preview.token,commandId:randomUUID(),confirmed:true,reason:'撤权后确认'})).rejects.toMatchObject({status:403});
    await postgresPool().query("UPDATE organization_memberships SET status='active',effective_to='2000-01-01' WHERE person_ref='admin_a'");
    await expect(service().catalog(true)).rejects.toMatchObject({status:403});
    await postgresPool().query("UPDATE organization_memberships SET effective_to=NULL WHERE person_ref='admin_a'");
    await postgresPool().query("UPDATE users SET active=0 WHERE id='admin_a'");
    await expect(service().catalog(true)).rejects.toMatchObject({status:403});
  });
  it('rejects absent, expired, reused or content-stale confirmation',async()=>{
    await save(definition());const preview=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    const body={token:preview.token,commandId:randomUUID(),confirmed:true,reason:'验证确认绑定'};
    await expect(service().commit({...body,confirmed:false})).rejects.toMatchObject({status:409});
    await postgresPool().query("UPDATE ontology_confirmations SET expires_at='2000-01-01' WHERE id=$1",[preview.token]);
    await expect(service().commit(body)).rejects.toMatchObject({status:409});
    const current=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    await save({...definition(),name:'草稿已变化'},1);
    await expect(service().commit({...body,token:current.token})).rejects.toMatchObject({status:409});
    const fresh=await service().prepare({code:'native_object',expectedRevision:2,action:'publish'});
    const valid={...body,token:fresh.token};await service().commit(valid);
    await expect(service().commit({...valid,commandId:randomUUID()})).rejects.toMatchObject({status:409});
  });
  it('rolls back the document and token consumption if audit persistence fails',async()=>{
    await save(definition());const preview=await service().prepare({code:'native_object',expectedRevision:1,action:'publish'});
    // A deterministic real database failure after the document write, inside
    // the same native transaction. This unique fixture trigger is not production code.
    await postgresPool().query(`CREATE FUNCTION ontology_it_fail_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='publish' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ontology_it_fail_publish BEFORE INSERT ON ontology_versions FOR EACH ROW EXECUTE FUNCTION ontology_it_fail_publish();`);
    const body={token:preview.token,commandId:randomUUID(),confirmed:true,reason:'验证回滚'};
    try{
      await expect(service().commit(body)).rejects.toThrow(/injected audit failure/);
      const row=(await postgresPool().query("SELECT * FROM ontology_documents WHERE code='native_object'")).rows[0];
      expect(row.revision).toBe(1);expect(row.published).toBeNull();expect(row.draft).toBeTruthy();
      expect((await postgresPool().query('SELECT consumed FROM ontology_confirmations WHERE id=$1',[preview.token])).rows[0].consumed).toBe(false);
      expect((await postgresPool().query('SELECT count(*)::int AS count FROM ontology_receipts')).rows[0].count).toBe(0);
    }finally{await postgresPool().query('DROP TRIGGER ontology_it_fail_publish ON ontology_versions; DROP FUNCTION ontology_it_fail_publish()');}
    expect((await service().commit(body)).revision).toBe(2);
  });
  it('keeps audit versions and receipts immutable in PostgreSQL',async()=>{
    await save(definition());const receipt=await commit('native_object',1);
    await expect(postgresPool().query('UPDATE ontology_versions SET reason=$1 WHERE id=$2',['tampered',receipt.id])).rejects.toThrow(/immutable/);
    await expect(postgresPool().query('DELETE FROM ontology_versions WHERE id=$1',[receipt.id])).rejects.toThrow(/immutable/);
    await expect(postgresPool().query('UPDATE ontology_receipts SET command_hash=$1',['tampered'])).rejects.toThrow(/immutable/);
    await expect(postgresPool().query('DELETE FROM ontology_receipts')).rejects.toThrow(/immutable/);
  });
  it('preserves pending drafts while disabling and restoring a published version',async()=>{
    await save(definition());const v1=await commit('native_object',1);
    await save({...definition(),name:'第二发布版本'},2);await commit('native_object',3);
    await save({...definition(),name:'仍需保留的草稿'},4);
    await commit('native_object',5,'disable');expect(await objectFrom('native_object')).toBeUndefined();
    let adminView=(await service().catalog(true)).objects.find(o=>o.code==='native_object')!;
    expect(adminView.status).toBe('disabled');expect(adminView.draft?.name).toBe('仍需保留的草稿');
    const restore=await commit('native_object',6,'restore','admin_a',v1.id);expect(restore.revision).toBe(7);
    expect((await objectFrom('native_object'))?.published?.name).toBe('Native PostgreSQL native_object');
    adminView=(await service().catalog(true)).objects.find(o=>o.code==='native_object')!;
    expect(adminView.draft?.name).toBe('仍需保留的草稿');
  });
  it('revalidates relation targets and prevents disable/publication races',async()=>{
    const target=definition('relation_target');const source=definition('relation_source');
    await save(target);await commit(target.code,1);
    source.items.relations.push({code:'points_to',name:'指向目标',description:'测试关联',source:'integration fixture',target:target.code,cardinality:'N:1'});
    await save(source);
    const publish=await service().prepare({code:source.code,expectedRevision:1,action:'publish'});
    const disable=await service().prepare({code:target.code,expectedRevision:2,action:'disable'});
    const outcomes=await Promise.allSettled([
      service().commit({token:publish.token,commandId:randomUUID(),confirmed:true,reason:'发布引用'}),
      service().commit({token:disable.token,commandId:randomUUID(),confirmed:true,reason:'停用目标'}),
    ]);
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.status).toBeGreaterThanOrEqual(400);
    const targetRow=(await postgresPool().query('SELECT disabled FROM ontology_documents WHERE code=$1',[target.code])).rows[0];
    const sourceRow=(await postgresPool().query('SELECT published FROM ontology_documents WHERE code=$1',[source.code])).rows[0];
    expect(targetRow.disabled&&!!sourceRow.published).toBe(false);
  });
  it('rejects duplicate stable IDs, risk downgrades and missing relation targets without partial saves',async()=>{
    await save(definition());
    await expect(save({...definition('duplicate_id'),id:'TEST-native_object'})).rejects.toMatchObject({status:422});
    const risk=definition('bad_risk');risk.items.actions.push({code:'unregistered',name:'未知工具动作',description:'不执行',source:'integration fixture',risk:'R1',executor:'unregistered'});
    await expect(save(risk)).rejects.toMatchObject({status:422});
    const dangling=definition('bad_relation');dangling.items.relations.push({code:'bad',name:'缺失目标',description:'校验',source:'integration fixture',target:'missing_object',cardinality:'1:N'});
    await expect(save(dangling)).rejects.toMatchObject({status:422});
    expect((await postgresPool().query('SELECT count(*)::int AS count FROM ontology_documents')).rows[0].count).toBe(1);
  });
  it('serves the actual HTTP router over native PostgreSQL with employee/admin isolation',async()=>{
    const app=new Hono();app.route('/api',ontology);app.onError((e,c)=>c.json({detail:e instanceof HttpFail?e.detail:e.message},e instanceof HttpFail?e.status as 400|401|403|409|422:500));
    const request=(id:string,p:string,init?:RequestInit)=>withTicketPrincipal(actor(id),()=>app.request('/api/ontology/workspace/'+p,init));
    expect((await app.request('/api/ontology/workspace/catalog')).status).toBe(401);
    expect((await request('employee_a','catalog?admin=1')).status).toBe(403);
    const response=await request('admin_a','drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({definition:definition(),expectedRevision:0,sourceVersion:baseline.sourceVersion,reason:'HTTP集成保存'})});
    expect(response.status).toBe(200);
    expect((await (await request('employee_a','catalog')).json()).objects.some((o:{code:string})=>o.code==='native_object')).toBe(false);
    const preview=await (await request('admin_a','prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'native_object',expectedRevision:1,action:'publish'})})).json();
    const published=await request('admin_a','commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:preview.token,commandId:randomUUID(),confirmed:true,reason:'HTTP确认发布'})});
    expect(published.status).toBe(200);
    const employee=await request('employee_a','catalog');expect(employee.headers.get('Cache-Control')).toBe('no-store');
    expect((await employee.json()).objects.find((o:{code:string})=>o.code==='native_object').published.name).toBe('Native PostgreSQL native_object');
    expect((await request('employee_b','catalog')).status).toBe(200);
    expect((await request('employee_a','history/native_object')).status).toBe(403);
  });
});


describe('enterprise catalog native import',()=>{
 it('rolls back failed imports, persists complete hierarchy, replays idempotently and preserves tenant drafts',async()=>{
  const defs=loadOntologyCatalog().objects;const db=postgresPool();
  await db.query(`CREATE OR REPLACE FUNCTION reject_catalog_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='kol_profile' THEN RAISE EXCEPTION 'injected import failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_catalog_test BEFORE INSERT ON ontology_catalog_objects FOR EACH ROW EXECUTE FUNCTION reject_catalog_test();`);
  await expect(postgresTransaction(c=>importEnterpriseCatalog(c,defs,'isolated-test'))).rejects.toThrow('injected import failure');
  expect(Number((await db.query('SELECT count(*) AS n FROM ontology_catalog_nodes')).rows[0].n)).toBe(0);
  expect(Number((await db.query('SELECT count(*) AS n FROM ontology_catalog_imports')).rows[0].n)).toBe(0);
  await db.query('DROP TRIGGER reject_catalog_test ON ontology_catalog_objects; DROP FUNCTION reject_catalog_test()');
  const before=(await db.query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows;
  const beforeAdmin=await service().catalog(true);const beforeEmployee=await service('employee_a').catalog();
  const report=await postgresTransaction(c=>importEnterpriseCatalog(c,defs,'isolated-test'));expect(report).toMatchObject({families:18,domains:153,themes:354,objects:930,sourceObjects:878,replayed:false});
  expect(await postgresTransaction(c=>importEnterpriseCatalog(c,defs,'isolated-test'))).toMatchObject({replayed:true});
  expect((await db.query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows).toEqual(before);
  const catalog=await service().catalog(true);expect(catalog.objects.map(o=>o.code).sort()).toEqual(beforeAdmin.objects.map(o=>o.code).sort());expect(catalog.taxonomy?.nodes.filter(n=>n.level===1)).toHaveLength(18);
  const employee=await service('employee_a').catalog();expect(employee.objects.map(o=>o.code).sort()).toEqual(beforeEmployee.objects.map(o=>o.code).sort());expect(employee.objects.every(o=>!o.draft)).toBe(true);
  expect((await db.query('SELECT object_code FROM ontology_catalog_placements GROUP BY object_code HAVING count(*) FILTER(WHERE is_primary)<>1')).rows).toHaveLength(0);
 });
 it('refreshes the prior imported catalog with B01 while retaining every previous identity and tenant document',async()=>{
  const db=postgresPool();const definitions=loadOntologyCatalog().objects;
  await postgresTransaction(async c=>{
   await c.query("DELETE FROM ontology_catalog_placements WHERE object_code LIKE 'ent_b01_%'");
   await c.query("DELETE FROM ontology_catalog_objects WHERE code LIKE 'ent_b01_%'");
   await c.query("DELETE FROM ontology_catalog_nodes WHERE parent_id IN (SELECT id FROM ontology_catalog_nodes WHERE parent_id='B01')");
   await c.query("DELETE FROM ontology_catalog_nodes WHERE parent_id='B01'");
   await c.query(`UPDATE ontology_catalog_nodes SET metadata=jsonb_set(metadata,'{detailStatus}','"not-provided"') WHERE id='B01'`);
   for(const table of ['ontology_catalog_nodes','ontology_catalog_objects','ontology_catalog_placements','ontology_catalog_imports'])await c.query('UPDATE '+table+" SET source_version='prior-test-snapshot'");
  });
  const before=(await db.query('SELECT code FROM ontology_catalog_objects ORDER BY code')).rows;
  expect(before).toHaveLength(896);
  const tenants=(await db.query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows;
  const report=await postgresTransaction(c=>importEnterpriseCatalog(c,definitions,'isolated-b01-test'));
  expect(report).toMatchObject({families:18,domains:153,themes:354,sourceObjects:878,objects:930,placements:934,missing:[],replayed:false});
  expect((await db.query("SELECT code FROM ontology_catalog_objects WHERE code NOT LIKE 'ent_b01_%' ORDER BY code")).rows).toEqual(before);
  expect((await db.query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows).toEqual(tenants);
  expect((await db.query("SELECT metadata FROM ontology_catalog_nodes WHERE id='B01'")).rows[0].metadata.detailStatus).toBe('provided');
  expect(await postgresTransaction(c=>importEnterpriseCatalog(c,definitions,'isolated-b01-test'))).toMatchObject({replayed:true});
  expect((await db.query('SELECT source_version FROM ontology_catalog_imports')).rows).toHaveLength(2);
 });

});
