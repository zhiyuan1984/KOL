import { describe,expect,it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCapabilityReferences,parseOntologyReferences,resolveOperations,operationAlias,operationArguments,operationResult,operationFingerprint,validateOperationAdapter } from '../src/capability/contracts.js';
import { taskDefinitions } from '../src/tasks/registry.js';
import { formatSkillMarkdown } from '../src/host/skill-publish.js';

describe('versioned business operation dependencies',()=>{
  it('rejects malformed adapters before a configuration can enter discovery',()=>{
    const [query]=resolveOperations([{id:'creator.query',version:1}]);
    expect(()=>validateOperationAdapter(query)).not.toThrow();
    const duplicated=structuredClone(query);duplicated.implementation.inputFields!.keyword='pageNo';
    expect(()=>validateOperationAdapter(duplicated)).toThrow('invalid_operation_adapter');
    const missing=structuredClone(query);delete missing.implementation.inputFields!.keyword;
    expect(()=>validateOperationAdapter(missing)).toThrow('invalid_operation_adapter');
    const prototype=structuredClone(query);prototype.result!.items=['__proto__.list'];
    expect(()=>validateOperationAdapter(prototype)).toThrow('invalid_operation_result_adapter');
    const invalidSchema=structuredClone(query);invalidSchema.inputSchema={type:'object',properties:{keyword:{type:'made-up'}}};
    expect(()=>validateOperationAdapter(invalidSchema)).toThrow('invalid_operation_input_schema');
    expect(()=>operationArguments(query,{constructor:'unsafe'})).toThrow('capability_argument_not_mapped');
  });
  it('resolves a supplier independent operation to the existing reviewed tool binding',()=>{
    const [query]=resolveOperations([{id:'creator.query',version:1}]);
    expect(operationAlias(query)).toBe('cap_creator_query_v1');
    expect(operationArguments(query,{keyword:'solar',page_no:2,page_size:10})).toEqual({requestJson:JSON.stringify({keyword:'solar',pageNo:2,pageSize:10})});
    expect(operationArguments(query,{})).toEqual({requestJson:'{}'});
    expect(()=>operationArguments(query,{company_override:'another'})).toThrow('capability_argument_not_mapped');
  });
  it('fails closed for missing implementations/versions and duplicate dependencies',()=>{
    expect(()=>resolveOperations([{id:'missing.operation',version:1}])).toThrow('capability_dependency_unavailable');
    expect(resolveOperations([{id:'missing.operation',version:1,optional:true}])).toEqual([]);
    expect(()=>resolveOperations([{id:'creator.query',version:2}])).toThrow('capability_dependency_unavailable');
    expect(()=>parseCapabilityReferences([{id:'creator.query',version:1},{id:'creator.query',version:1}])).toThrow();
    expect(()=>parseCapabilityReferences([{id:'creator.query',version:0}])).toThrow();
    expect(()=>parseOntologyReferences([{object:'kol_profile',revision:0}])).toThrow();
  });
  it('reuses generic adapters for profile and platform reads without confusing UID and numeric mail identity',()=>{
    const [profile,platform,mail]=resolveOperations([{id:'creator.profile.read',version:1},{id:'creator.platform_data.read',version:1},{id:'mail.conversations.query',version:1}]);
    expect(operationArguments(profile,{creator_id:'KOL-stable-1'})).toEqual({kolUid:'KOL-stable-1'});
    expect(operationArguments(platform,{creator_id:'KOL-stable-1'})).toEqual({kolUid:'KOL-stable-1'});
    expect(operationArguments(mail,{creator_record_id:42,page_no:1,page_size:3})).toEqual({kolId:42,pageNo:1,pageSize:3});
    expect(()=>operationArguments(profile,{kolUid:'unmapped'})).toThrow('capability_argument_not_mapped');
    const unavailable={isError:true,content:[{type:'text',text:'source unavailable'}]};expect(operationResult(profile,{},unavailable)).toBe(unavailable);
  });
  it('changes the execution fingerprint when implementation changes while keeping the public name stable',()=>{
    const operations=resolveOperations([{id:'creator.query',version:1}]);
    const original=operationFingerprint(operations);operations[0].implementation.version++;
    expect(operationFingerprint(operations)).not.toBe(original);
    expect(operationAlias(operations[0])).toBe('cap_creator_query_v1');
  });
  it('normalizes real records and does not invent missing totals or contacts',()=>{
    const [query]=resolveOperations([{id:'creator.query',version:1}]);
    const result=operationResult(query,{page_no:2},{structuredContent:{data:{list:[{kolUid:'external-1',kolName:'Source creator'}]}}});
    expect(result.structuredContent).toMatchObject({items:[{id:'external-1',name:'Source creator',stage_code:null,owner_name:null}],total:null,page_no:2});
    const realShape=operationResult(query,{}, {structuredContent:{data:{list:[{kolUid:'external-1',kolId:42,primaryPlatformName:'YouTube',currentStageCode:'source-stage',currentStageName:'Source stage',riskTagCode:'source-risk',riskTagName:'Source risk'}],total:1}}});
    expect(realShape.structuredContent).toMatchObject({items:[{id:'external-1',record_id:42,platform:'YouTube',stage_code:'source-stage',stage_name:'Source stage',risk_tags:'source-risk',risk_tag_name:'Source risk'}]});
    expect(()=>operationResult(query,{}, {content:[{type:'text',text:'upstream unavailable'}]})).toThrow();
    expect(()=>operationResult(query,{}, {structuredContent:{total:0}})).toThrow();
    expect(()=>operationResult(query,{page_no:2}, {structuredContent:{list:[],total:0,pageNo:1}})).toThrow();
    const error={isError:true,content:[{type:'text',text:'source failed'}]};expect(operationResult(query,{},error)).toBe(error);
  });
  it('retains dependency declarations through authoring and registry parsing',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'business-operation-contract-'));
    try{
      const dir=path.join(root,'shared_query');fs.mkdirSync(dir);
      const text=formatSkillMarkdown({id:'shared_query',title:'查询',description:'查询',category:'查询',profile:'lead',output:'task_result',mcp:[],capabilities:[{id:'creator.query',version:1}],ontology:[{object:'kol_profile',revision:2}],required_inputs:[],permissions:[],actions:[],aliases:[],in_market:true,body:'读取已授权事实，失败如实报告。'});
      fs.writeFileSync(path.join(dir,'SKILL.md'),text);
      const [definition]=await taskDefinitions(root);
      expect(definition.mcp).toEqual(['starrykol.pageKolProfiles']);
      expect(definition.ontology).toEqual([{object:'kol_profile',revision:2}]);
      expect(text).not.toContain('pageKolProfiles');
      fs.writeFileSync(path.join(dir,'SKILL.md'),text.replace('mcp: []','mcp: ["vendor.bypass"]'));
      await expect(taskDefinitions(root)).rejects.toThrow('cannot combine');
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
