import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {freshTestDatabase} from './support/pg.js';
import {getConn,resetConn} from '../src/db.js';
import {postgresPool,postgresTransaction} from '../src/postgres/pool.js';
import {loadOntologyCatalog} from '../src/ontology/catalog.js';
import {enterpriseHash,enterpriseSource,importEnterpriseCatalog} from '../src/ontology/enterprise.js';
import {OntologyService} from '../src/ontology/service.js';
import {publishedBusinessContext} from '../src/ontology/runtime-dependencies.js';
import {syncUserOrganization} from '../src/runtime/organization-tree.js';
import type {TicketPrincipal} from '../src/ticket-domain/auth.js';
const actor:TicketPrincipal={id:'stage4-admin',username:'stage4-admin',name:'Isolated administrator',email:null,roles:['admin','employee'],active:true};
const catalog=loadOntologyCatalog(),selected=Object.keys(enterpriseSource().definitionOverrides!),company='company:amperetime';
let before:unknown[],oldDefinition:typeof catalog.objects[number];
beforeAll(async()=>{
 await freshTestDatabase({empty:true});process.env.NODE_ENV='test';process.env.AUTH_MODE='enabled';
 await getConn().query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES($1,$1,'Isolated test','not-a-password','["admin","employee"]','["LT"]','',1,$2,$2)`,[actor.id,new Date().toISOString()]);
 await syncUserOrganization(actor.id,'org:lt_team');
 oldDefinition=structuredClone(catalog.objects.find(d=>d.code==='kol_profile')!);oldDefinition.items.relations=oldDefinition.items.relations.filter(r=>r.code==='has_collaboration');
 const draft={...oldDefinition,name:'尚未发布的公司修订'};const db=postgresPool(),stamp=new Date().toISOString();
 await db.query(`INSERT INTO ontology_documents(company_id,code,revision,draft,published,disabled,updated_at) VALUES($1,'kol_profile',3,$2,$3,false,$4)`,[company,JSON.stringify(draft),JSON.stringify(oldDefinition),stamp]);
 await db.query(`INSERT INTO ontology_versions(id,company_id,code,revision,action,actor,reason,definition,created_at) VALUES($1,$2,'kol_profile',2,'publish',$3,'isolated old publication',$4,$5)`,[randomUUID(),company,actor.id,JSON.stringify(oldDefinition),stamp]);
 before=(await db.query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows;
});
afterAll(async()=>{await resetConn();delete process.env.AUTH_MODE;});
describe('six-theme native catalog import and publication boundaries',()=>{
 it('persists the complete definition graph and replays without changing tenant publications or drafts',async()=>{
  const result=await postgresTransaction(db=>importEnterpriseCatalog(db,catalog.objects,actor.id));expect(result).toMatchObject({objects:930,replayed:false});
  const rows=(await postgresPool().query('SELECT code,definition FROM ontology_catalog_objects WHERE code=ANY($1::text[])',[selected])).rows;expect(rows).toHaveLength(25);
  for(const row of rows){expect(row.definition.items.relations.length).toBeGreaterThan(0);expect(row.definition.items.properties.length).toBeGreaterThan(0);}
  expect((await postgresPool().query('SELECT * FROM ontology_documents ORDER BY company_id,code')).rows).toEqual(before);
  expect(await postgresTransaction(db=>importEnterpriseCatalog(db,catalog.objects,actor.id))).toMatchObject({replayed:true});
  expect((await postgresPool().query('SELECT source_version FROM ontology_catalog_imports')).rows).toEqual([{source_version:enterpriseHash()}]);
 });
 it('keeps published runtime semantics pinned and rejects guessed company scopes',async()=>{
  const runtime=await publishedBusinessContext(actor.id,[{object:'kol_profile',revision:2,actions:['read_profile']}]);
  expect(runtime?.objects[0].revision).toBe(2);expect(runtime?.objects[0].definition.items.relations).toHaveLength(1);
  const admin=await new OntologyService(actor,company).catalog(true);expect(admin.objects.find(d=>d.code==='kol_profile')?.draft?.name).toBe('尚未发布的公司修订');
  const employee=await new OntologyService({...actor,roles:['employee']},company).catalog();expect(employee.objects.every(d=>d.draft===null)).toBe(true);
  expect(employee.objects.find(d=>d.code==='ent_b04_84f240141be6ae60')?.published?.items.relations.some(r=>r.target==='kol_profile')).toBe(true);
  await expect(new OntologyService(actor,'company:unrelated').catalog(true)).rejects.toMatchObject({status:403});
 });
 it('publishes a selected definition only through the original confirmed version flow',async()=>{
  const service=new OntologyService(actor,company),definition=catalog.objects.find(d=>d.code==='ent_b04_84f240141be6ae60')!;
  await service.save({definition,expectedRevision:0,sourceVersion:catalog.sourceVersion,reason:'isolated account definition review'});
  const prepared=await service.prepare({code:definition.code,action:'publish',expectedRevision:1});
  await expect(service.commit({token:prepared.token,commandId:randomUUID(),reason:'missing confirmation'})).rejects.toMatchObject({status:409});
  const receipt=await service.commit({token:prepared.token,commandId:randomUUID(),reason:'isolated confirmed publication',confirmed:true});expect(receipt.revision).toBe(2);
  expect((await publishedBusinessContext(actor.id,[{object:definition.code,revision:2}]))?.objects[0].definition.items.relations.length).toBeGreaterThan(0);
  expect((await postgresPool().query("SELECT draft,published,revision FROM ontology_documents WHERE code='kol_profile'")).rows[0].revision).toBe(3);
 });
});
