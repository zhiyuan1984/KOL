import { describe,expect,it,vi } from 'vitest';
import { publishedBusinessContext } from '../src/ontology/runtime-dependencies.js';
import type { OntologyDefinition } from '../../shared/ontology.js';
const definition:OntologyDefinition={code:'kol_profile',id:'object:creator',name:'达人',description:'达人主体',layer:'kol_business',taxonomy:['市场','达人','档案'],source:'published test definition',items:{properties:[],relations:[],rules:[],events:[],actions:[{code:'read_profile',name:'查询',description:'查询',source:'test',risk:'R1',executor:'private.tool'}]}};
function repository(options:{companies?:string[];revision?:number;disabled?:boolean;published?:boolean}={}){
  const query=vi.fn().mockResolvedValueOnce({rows:(options.companies??['company:test']).map(company_id=>({company_id}))}).mockResolvedValueOnce({rows:options.published===false?[]:[{code:'kol_profile',published:definition,disabled:options.disabled??false,published_revision:options.revision??2}]});
  return {query} as unknown as Parameters<typeof publishedBusinessContext>[2];
}
describe('published ontology execution dependencies',()=>{
  it('loads only scoped published versions and removes implementation details',async()=>{
    const result=await publishedBusinessContext('actor',[{object:'kol_profile',revision:2,actions:['read_profile']}],repository());
    expect(result?.company_id).toBe('company:test');expect(result?.objects[0].definition.items.actions[0]).not.toHaveProperty('executor');expect(result?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([{published:false},{disabled:true},{revision:3}])('rejects unavailable versions: %j',async options=>{
    await expect(publishedBusinessContext('actor',[{object:'kol_profile',revision:2}],repository(options))).rejects.toMatchObject({status:409});
  });
  it.each([{companies:[]},{companies:['company:a','company:b']}])('does not guess scope: %j',async ({companies})=>{
    await expect(publishedBusinessContext('actor',[{object:'kol_profile',revision:2}],repository({companies}))).rejects.toMatchObject({detail:{code:'ontology_company_context_required'}});
  });
  it('rejects undefined actions and retains compatibility for old skills',async()=>{
    await expect(publishedBusinessContext('actor',[{object:'kol_profile',revision:2,actions:['invented_action']}],repository())).rejects.toMatchObject({detail:{code:'ontology_action_dependency_missing'}});
    const query=vi.fn();expect(await publishedBusinessContext('actor',[],{query} as never)).toBeNull();expect(query).not.toHaveBeenCalled();
  });
});
