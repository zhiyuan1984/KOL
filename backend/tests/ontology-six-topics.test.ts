import fs from 'node:fs';
import {describe,it,expect} from 'vitest';
import {loadOntologyCatalog,applyDefinitionSupplements,employeeDefinition} from '../src/ontology/catalog.js';
import {enterpriseSource,enterpriseHash} from '../src/ontology/enterprise.js';
import {readOntologySources,ontologySourceHash} from '../src/ontology/sources.js';
const catalog=loadOntologyCatalog(),source=enterpriseSource();
const sixTopics=new Set(['达人资源','达人评估','达人关系与沟通','达人合作与交付','达人样品履约','达人费用与结算']);
const selected=Object.keys(source.definitionOverrides!).filter(code=>sixTopics.has(catalog.objects.find(d=>d.code===code)?.taxonomy[2]||''));
const find=(code:string)=>catalog.objects.find(d=>d.code===code)!;
const patch=(code:string,items:object)=>({version:1,source:'isolated generic contract test',objects:[{code,items}]});
const property={code:'other_domain_field',name:'其它领域属性',description:'不属于达人业务',source:'isolated test',type:'string'};
describe('six-theme object contracts and generic catalog enrichment',()=>{
 it('aligns the confirmed 25 objects to six themes while preserving all existing stable identities',()=>{
  expect(selected).toHaveLength(25);expect(new Set(selected.map(code=>find(code).taxonomy[2]))).toEqual(sixTopics);
  expect(catalog.objects).toHaveLength(930);
  const registry=JSON.parse(fs.readFileSync(new URL('../../config/objects-registry.yaml',import.meta.url),'utf8'));
  for(const original of [...registry.objects,...source.objects.filter(o=>!o.existing)])expect(find(original.code).id).toBe(original.id);
  for(const code of selected){const d=find(code);expect(d.items.properties.length).toBeGreaterThan(0);expect(d.items.relations.length).toBeGreaterThan(0);expect(d.items.rules.every(rule=>!!rule.clause)).toBe(true);}
 });
 it('resolves relationship targets and inverses and keeps communication, task and financial master references shared',()=>{
  for(const code of selected)for(const relation of find(code).items.relations){expect(find(relation.target!)).toBeDefined();if(relation.inverse){const back=find(relation.target!).items.relations.find(i=>i.code===relation.inverse)!;expect(back.target).toBe(code);expect(back.inverse).toBe(relation.code);}}
  const targets=(code:string)=>find(code).items.relations.map(r=>r.target);
  expect(targets('ent_b04_c55e1a376c064575')).toContain('email');expect(targets('ent_b04_c55e1a376c064575')).not.toContain('session_thread');
  for(const code of ['ent_b04_7ebb1c2ee662a0e6','follow_task','ent_b04_68908b46dcca9512'])expect(targets(code)).toContain('task');
  expect(targets('settlement')).toContain('ent_b13_909ee190e69566f4');expect(targets('ent_b04_3cc7c46d5c5aa4e7')).toContain('ent_b09_5cb76ef34b653115');
 });
 it('preserves independent ownership, identity evidence, lifecycle meanings and executable risk floors',()=>{
  const props=(code:string)=>find(code).items.properties.map(p=>p.code);
  expect(props('kol_profile')).toContain('profile_owner_ref');expect(props('follow_relation')).toContain('employee_ref');expect(props('collaboration')).toContain('cooperation_owner_ref');
  expect(find('creator_candidate').items.properties.find(p=>p.code==='candidate_status')?.description).toMatch(/独立于合作阶段/);
  expect(find('creator_candidate').items.rules.find(r=>r.code==='identity_confirmation')?.description).toMatch(/候选ID不足/);
  expect(find('collaboration').items.properties.find(p=>p.code==='source_cooperation_id')?.description).toContain('kol_cooperations');
  expect(find('crawl_batch').items.actions.find(a=>a.code==='collect_candidates')).toMatchObject({risk:'R3',asynchronous:true,executor:'crawler_collect'});
  expect(employeeDefinition(find('kol_profile')).items.actions.every(a=>!a.executor)).toBe(true);
 });
 it('enriches another business domain through the same data contract without mutating its inputs',()=>{
  const before=structuredClone(find('project'));const result=applyDefinitionSupplements(catalog.objects,patch('project',{properties:[property]}));
  expect(result.find(d=>d.code==='project')?.items.properties).toContainEqual(property);expect(find('project')).toEqual(before);
 });
 it('rejects unknown objects, duplicates, dangling relationships, bad inverses and unreviewed risk downgrades',()=>{
  expect(()=>applyDefinitionSupplements(catalog.objects,patch('missing',{properties:[property]}))).toThrow(/unknown/);
  expect(()=>applyDefinitionSupplements(catalog.objects,patch('project',{properties:[property,property]}))).toThrow(/duplicate/);
  const relation={code:'bad_reference',name:'错误关系',description:'test',source:'isolated test',target:'missing',cardinality:'N:1'};
  expect(()=>applyDefinitionSupplements(catalog.objects,patch('project',{relations:[relation]}))).toThrow(/目标/);
  expect(()=>applyDefinitionSupplements(catalog.objects,patch('project',{relations:[{...relation,target:'campaign',inverse:'missing_inverse'}]}))).toThrow(/inverse/);
  expect(()=>applyDefinitionSupplements(catalog.objects,patch('project',{actions:[{code:'unknown_write',name:'未登记动作',description:'test',source:'isolated test',risk:'R1',executor:'unknown'}]}))).toThrow(/风险/);
 });
 it('uses every source file in both the import and confirmation fingerprint',()=>{
  const sources=readOntologySources(),fingerprint=ontologySourceHash(sources);expect(enterpriseHash()).toBe(fingerprint);expect(catalog.sourceVersion).toBe(fingerprint);
  expect(ontologySourceHash(sources.map(s=>({...s,content:s.content.replace(/\r?\n/g,'\r\n')})))).toBe(fingerprint);
  for(let i=0;i<sources.length;i++){const changed=structuredClone(sources);changed[i].content+='\n ';expect(ontologySourceHash(changed)).not.toBe(fingerprint);}
 });
});
