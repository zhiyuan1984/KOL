import {enterpriseSource,enterpriseTaxonomy} from '../src/ontology/enterprise.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { loadOntologyCatalog, employeeDefinition, validateDefinition } from '../src/ontology/catalog.js';
import { OntologyService } from '../src/ontology/service.js';
import { ontology } from '../src/routers/ontology-workspace.js';
import { withTicketPrincipal, type TicketPrincipal } from '../src/ticket-domain/auth.js';
import { HttpFail } from '../src/host/errors.js';
import type { OntologyDefinition } from '../../shared/ontology.js';

const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../src/postgres/pool.js',()=>({postgresPool:()=>({query}),postgresTransaction:(fn:Function)=>fn({query})}));
const actor:TicketPrincipal={id:'employee',username:'employee',name:'员工',email:null,roles:['employee'],active:true};
const admin={...actor,id:'admin',roles:['employee','admin']};
const baseline=loadOntologyCatalog();
const codes=new Set(baseline.objects.map(o=>o.code));
const profile=()=>structuredClone(baseline.objects.find(o=>o.code==='kol_profile')!);
const validate=(value:unknown)=>validateDefinition(value,codes,baseline.objects);

describe('ontology definition semantics',()=>{
  it('loads real registered definitions and validates all cross-object references',()=>{
    expect(baseline.objects).toHaveLength(930);
    expect(baseline.objects.reduce((n,o)=>n+o.items.properties.length,0)).toBeGreaterThan(214);
    expect(baseline.objects.reduce((n,o)=>n+o.items.events.length,0)).toBe(140);
    for(const definition of baseline.objects)expect(validate(definition).code).toBe(definition.code);
    expect(baseline.objects.flatMap(o=>Object.values(o.items).flat()).some(i=>i.code.startsWith('example_'))).toBe(false);
  });
  it('rejects duplicate item codes, invalid relation targets and malformed schema',()=>{
    const duplicate=profile();duplicate.items.properties.push(duplicate.items.properties[0]);expect(()=>validate(duplicate)).toThrow(/编码重复/);
    const reference=profile();reference.items.relations[0].target='missing_object';expect(()=>validate(reference)).toThrow(/目标/);
    const payload=profile();payload.items.events[0].payload='[1,2]';expect(()=>validate(payload)).toThrow(/JSON/);
  });
  it('keeps risk floors even if the action executor is tampered with',()=>{
    const definition=profile();const action=definition.items.actions.find(i=>i.code==='decrypt_contact')!;
    action.risk='R1';expect(()=>validate(definition)).toThrow(/风险/);
    action.executor='creator_profile';expect(()=>validate(definition)).toThrow(/风险/);
    action.risk='R3';expect(validate(definition).items.actions[1].risk).toBe('R3');
  });
  it('requires documented rule clauses and rejects executable or unknown fields',()=>{
    const definition=profile();definition.items.rules[0].clause='';expect(()=>validate(definition)).toThrow(/条款/);
    expect(()=>validate({...profile(),grants:['admin']})).toThrow(/格式/);
    const unsafe=profile();Object.assign(unsafe.items.actions[0],{executeUrl:'/api/send'});expect(()=>validate(unsafe)).toThrow(/格式/);
  });
  it('projects employee semantics without exposing tool dependency details',()=>{
    const definition=profile();const result=employeeDefinition(definition);
    expect(result.items.actions[0].executor).toBeUndefined();expect(result.items.events[0].producer).toBeUndefined();
    expect(result.items.events[0].payload).toBeUndefined();expect(result.items.rules[0].executionPoint).toBeUndefined();
    expect(definition.items.actions[0].executor).toBeTruthy();
  });
});

describe('ontology tenant and draft boundaries (mocked database unit tests)',()=>{
  beforeEach(()=>{query.mockReset();});
  function authorize(rows:unknown[]=[]){query.mockImplementation(async(sql:string)=>({rows:sql.includes('organization_people')?[{id:'company:a'}]:sql.includes('ontology_catalog_')||sql.includes('ontology_scope_')?[]:rows}));}
  it('requires current organization membership even for an administrator',async()=>{
    authorize();await expect(new OntologyService(admin,'company:b').catalog(true)).rejects.toMatchObject({status:403});
    query.mockResolvedValue({rows:[]});await expect(new OntologyService(admin).catalog(true)).rejects.toMatchObject({status:403});
  });
  it('denies management operations and inactive accounts before any write',async()=>{
    authorize();await expect(new OntologyService(actor,'company:a').history('kol_profile')).rejects.toMatchObject({status:403});
    await expect(new OntologyService({...admin,active:false},'company:a').catalog(true)).rejects.toMatchObject({status:403});
    expect(query).not.toHaveBeenCalled();
  });
  it('does not expose drafts, disabled definitions, runtime-only assets or tool bindings to employees',async()=>{
    const draft=profile();draft.name='尚未发布的敏感草稿';
    authorize([{code:'kol_profile',revision:2,draft,published:null,disabled:false,updated_at:'2026-10-18'},
      {code:'email',revision:3,draft:null,published:null,disabled:true,updated_at:'2026-10-18'}]);
    const result=await new OntologyService(actor,'company:a').catalog();
    expect(result.objects.find(o=>o.code==='kol_profile')?.published?.name).not.toBe(draft.name);
    expect(result.objects.every(o=>o.draft===null&&(o.published?.layer==='kol_business'||enterpriseSource().objects.some(e=>e.code===o.code)))).toBe(true);
    expect(result.objects.some(o=>o.code==='email')).toBe(false);expect(result.objects.some(o=>o.code==='credential_ref')).toBe(false);
    expect(result.objects.find(o=>o.code==='kol_profile')?.published?.items.actions[0].executor).toBeUndefined();
  });
  it('keeps tenant draft classifications separate from employee catalog classifications',async()=>{
    const draft=profile();draft.taxonomy=['产品','商品管理','SKU管理'];authorize([{code:'kol_profile',revision:1,draft,published:null,disabled:false,updated_at:'2026-10-18'}]);
    const adminView=await new OntologyService(admin,'company:a').catalog(true);
    expect(adminView.taxonomy?.placements.find(p=>p.objectCode==='kol_profile'&&p.primary)?.path).toEqual(draft.taxonomy);
    const employeeView=await new OntologyService(actor,'company:a').catalog();
    expect(employeeView.taxonomy?.placements.find(p=>p.objectCode==='kol_profile'&&p.primary)?.path[0]).toBe('营销');
  });
  it('rejects stale draft saves without writing and rejects absent confirmation',async()=>{
    query.mockImplementation(async(sql:string)=>({rows:sql.includes('organization_people')?[{id:'company:a'}]:sql.includes('FOR UPDATE')?[{revision:5}]:[]}));
    await expect(new OntologyService(admin,'company:a').save({definition:profile(),reason:'修订',expectedRevision:4,sourceVersion:baseline.sourceVersion})).rejects.toMatchObject({status:409});
    expect(query.mock.calls.some(([sql])=>String(sql).includes('INSERT'))).toBe(false);
    await expect(new OntologyService(admin,'company:a').commit({token:'token',commandId:'request',reason:'发布',confirmed:false})).rejects.toMatchObject({status:409});
  });
  it('rejects confirmation from another actor/company or an expired challenge',async()=>{
    authorize();const body={token:'foreign-token',commandId:'request',reason:'发布',confirmed:true};
    await expect(new OntologyService(admin,'company:a').commit(body)).rejects.toMatchObject({status:409});
    query.mockImplementation(async(sql:string)=>({rows:sql.includes('organization_people')?[{id:'company:a'}]:sql.includes('ontology_confirmations')?[{expires_at:'2000-01-01',consumed:false}]:[]}));
    await expect(new OntologyService(admin,'company:a').commit(body)).rejects.toMatchObject({status:409});
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith('UPDATE'))).toBe(false);
  });
  it('invalidates confirmation after a draft changes',async()=>{
    query.mockImplementation(async(sql:string)=>({rows:sql.includes('organization_people')?[{id:'company:a'}]:sql.includes('ontology_confirmations')?[{code:'kol_profile',revision:2,expires_at:'2999-01-01',consumed:false}]:sql.includes('ontology_documents')?[{revision:3}]:[]}));
    await expect(new OntologyService(admin,'company:a').commit({token:'old-token',commandId:'request',reason:'发布',confirmed:true})).rejects.toMatchObject({status:409});
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith('UPDATE'))).toBe(false);
  });
  it('preserves unpublished work on disable and returns one receipt for a repeated confirmed command',async()=>{
    const definition:OntologyDefinition={...profile(),code:'test_object',id:'TEST-1',name:'测试对象'};
    const draft={...definition,name:'待发布修订'};
    const current={code:definition.code,revision:1,draft,published:definition,disabled:false};
    let receiptRow:unknown;
    query.mockImplementation(async(sql:string,values:unknown[]=[])=>{
      if(sql.includes('organization_people'))return {rows:[{id:'company:a'}]};
      if(sql.startsWith('SELECT * FROM ontology_confirmations'))return {rows:[{code:definition.code,revision:1,action:'disable',expires_at:'2999-01-01',consumed:false,source_version:baseline.sourceVersion}]};
      if(sql.startsWith('SELECT * FROM ontology_documents'))return {rows:[current]};
      if(sql.startsWith('SELECT * FROM ontology_receipts'))return {rows:receiptRow?[receiptRow]:[]};
      if(sql.startsWith('INSERT INTO ontology_receipts'))receiptRow={command_hash:values[3],receipt:JSON.parse(String(values[4]))};
      return {rows:[]};
    });
    const service=new OntologyService(admin,'company:a');const body={token:'confirmed-token',commandId:'one-command',reason:'停用',confirmed:true};
    const first=await service.commit(body);expect(await service.commit(body)).toEqual(first);
    const writes=query.mock.calls.filter(([sql])=>String(sql).startsWith('INSERT INTO ontology_documents'));
    expect(writes).toHaveLength(1);expect(JSON.parse(writes[0][1][6]).name).toBe('待发布修订');
    await expect(service.commit({...body,reason:'不同内容'})).rejects.toMatchObject({status:409});
  });
});

describe('ontology HTTP access boundary',()=>{
  const app=new Hono();app.route('/api',ontology);app.onError((e,c)=>c.json({detail:e instanceof HttpFail?e.detail:e.message},e instanceof HttpFail?e.status as 400|403|401|422|409:500));
  beforeEach(()=>{query.mockReset();});
  it('rejects anonymous and inactive requests',async()=>{
    expect((await app.request('/api/ontology/workspace/catalog')).status).toBe(401);
    expect((await withTicketPrincipal({...actor,active:false},()=>app.request('/api/ontology/workspace/catalog'))).status).toBe(403);
  });
  it('rejects employee admin-mode spoofing and malformed JSON',async()=>{
    expect((await withTicketPrincipal(actor,()=>app.request('/api/ontology/workspace/catalog?admin=1'))).status).toBe(403);
    expect((await withTicketPrincipal(admin,()=>app.request('/api/ontology/workspace/drafts',{method:'POST',body:'{'}))).status).toBe(400);
  });
});


describe('user enterprise ontology source normalization',()=>{
 it('retains all 18 families and the 18 supplied family detail trees including completed B01',()=>{
  const source=enterpriseSource();const tree=enterpriseTaxonomy(baseline.objects);
  expect(source.families).toHaveLength(18);expect(tree.nodes.filter(n=>n.level===2)).toHaveLength(153);expect(tree.nodes.filter(n=>n.level===3)).toHaveLength(354);
  expect(tree.nodes.find(n=>n.id==='B01')?.detailStatus).toBe('provided');expect(tree.nodes.filter(n=>n.parentId==='B01')).toHaveLength(5);
  expect(source.missing).toHaveLength(0);expect(source.objects.filter(o=>o.family==='B01')).toHaveLength(34);expect(source.objects).toHaveLength(878);expect(source.placements).toHaveLength(881);
 });
 it('assigns one primary authority and preserves cross-theme references',()=>{
  const tree=enterpriseTaxonomy(baseline.objects);
  for(const d of baseline.objects)expect(tree.placements.filter(p=>p.objectCode===d.code&&p.primary)).toHaveLength(1);
  const profit=baseline.objects.filter(d=>d.name==='渠道利润分析');expect(profit).toHaveLength(1);expect(profit[0].taxonomy[0]).toBe('财经');expect(tree.placements.filter(p=>p.objectCode===profit[0].code).map(p=>p.path[0])).toEqual(expect.arrayContaining(['销售','财经']));
  expect(baseline.objects.filter(d=>['制造工位','办公工位'].includes(d.name))).toHaveLength(2);
 });
 it('reuses existing stable identities and leaves planning definitions without invented capabilities',()=>{
  expect(baseline.objects.find(d=>d.code==='kol_profile')?.id).toBe('B2');
  const enriched=new Set(Object.keys(enterpriseSource().definitionOverrides!));
  for(const d of baseline.objects.filter(d=>d.code.startsWith('ent_'))){
   expect(d.items.actions).toHaveLength(0);expect(d.items.events).toHaveLength(0);
   if(!enriched.has(d.code))expect(Object.values(d.items).flat()).toHaveLength(0);
  }
  expect(baseline.objects.some(d=>d.taxonomy.includes('未分类')||d.taxonomy.includes('待业务负责人分类'))).toBe(false);
 });
});

describe('ontology relevance and applicability',()=>{
 it('separates the business definition of a lead from its authority source',()=>{const lead=baseline.objects.find(o=>o.code==='creator_candidate')!;expect(lead.description).toContain('尚未完成合作评估');expect(lead.source).toContain('采集批次');});
 it('requires a reason for not-applicable and rejects conflicting populated definitions',()=>{const d=profile();d.applicability={relations:{status:'not_applicable',reason:'业务边界确认'}};expect(()=>validate(d)).toThrow(/同时有记录/);d.items.relations=[];expect(validate(d).applicability?.relations?.reason).toBe('业务边界确认');d.applicability.relations!.reason='';expect(()=>validate(d)).toThrow(/格式/);});
 it('employee cannot configure scope or read other employees feedback',async()=>{await expect(new OntologyService(actor,'company:a').configureScope({})).rejects.toMatchObject({status:403});await expect(new OntologyService(actor,'company:a').maintenance()).rejects.toMatchObject({status:403});});
});


describe('approved KOL information architecture refresh',()=>{
 it('retains stable identities and classifies all 25 definitions in six bounded themes',()=>{
  const source=enterpriseSource();const themes=new Set(['达人资源','达人评估','达人关系与沟通','达人合作与交付','达人样品履约','达人费用与结算']);
  // WeCom source supplements are governed separately. Retain the original
  // KOL-only twenty-five-object boundary rather than silently widening it.
  const corrections=Object.fromEntries(Object.entries(source.definitionOverrides!).filter(([code])=>themes.has(baseline.objects.find(d=>d.code===code)?.taxonomy[2]||'')));expect(Object.keys(corrections)).toHaveLength(25);
  const revised=baseline.objects.filter(d=>corrections[d.code]);
  expect(new Set(revised.map(d=>d.taxonomy[2]))).toEqual(themes);
  for(const d of revised){expect(d.description).toContain('数据来源与责任边界');expect(d.description).not.toContain('仅登记对象类型');expect(validate(d).code).toBe(d.code);}
  expect(revised.find(d=>d.code==='kol_profile')?.id).toBe('B2');
 });
 it('keeps scalar score and label values out of independent object definitions and preserves action risk',()=>{
  const revised=baseline.objects.filter(d=>enterpriseSource().definitionOverrides?.[d.code]);
  expect(revised.some(d=>d.name==='达人评分'||d.name==='达人标签')).toBe(false);
  expect(revised.find(d=>d.name==='达人评估记录')?.description).toContain('评分是记录的属性');
  expect(revised.find(d=>d.name==='合作协议')?.description).toContain('复用合同身份');
  expect(revised.find(d=>d.code==='follow_relation')?.taxonomy[2]).toBe('达人关系与沟通');
  expect(profile().items.actions.find(a=>a.code==='decrypt_contact')?.risk).toBe('R3');
 });
});
