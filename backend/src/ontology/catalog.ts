import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ontologyDimensions, type OntologyDefinition, type OntologyItem } from '../../../shared/ontology.js';
import { HttpFail } from '../host/errors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const files = ['config/objects-registry.yaml', 'config/event-catalog.yaml', 'config/ontology-semantics.json'];
const code = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/);
const text = z.string().max(8000);
const itemSchema = z.object({
  code, name: z.string().trim().min(1).max(200), description: text, source: z.string().trim().min(1).max(1000),
  type: text.optional(), required: z.boolean().optional(), defaultValue: text.optional(), dictionary: text.optional(),
  target: code.optional(), cardinality: z.enum(['1:1', '1:N', 'N:1', 'N:N']).optional(), inverse: text.optional(),
  producer: text.optional(), payload: text.optional(), condition: text.optional(), clause: text.optional(),
  executionPoint: text.optional(), priority: text.optional(), risk: z.enum(['R1', 'R2', 'R3']).optional(),
  executor: text.optional(), asynchronous: z.boolean().optional(), input: text.optional(),
}).strict();
const definitionSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/), id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200), description: text,
  layer: z.enum(['platform', 'kol_business', 'org_governance']), taxonomy: z.tuple([z.string().trim().min(1).max(100),z.string().trim().min(1).max(100),z.string().trim().min(1).max(100)]),
  source: z.string().trim().min(1).max(1000), items: z.object(Object.fromEntries(ontologyDimensions.map(d => [d,z.array(itemSchema).max(300)])) as Record<typeof ontologyDimensions[number], z.ZodArray<typeof itemSchema>>).strict(),
}).strict();

export function loadOntologyCatalog(): { sourceVersion: string; objects: OntologyDefinition[] } {
  const sources = files.map(file => fs.readFileSync(path.join(root,file), 'utf8').replace(/^\uFEFF/,''));
  const registry = JSON.parse(sources[0]) as { objects: Array<{code:string;id:string;name:string;layer:OntologyDefinition['layer'];authority_source?:string;source_ref:string;properties:Array<{code:string;name:string;rule?:string;lineage?:string;biz_type:string}>}> };
  const events = JSON.parse(sources[1]) as {events:Array<{code:string;name:string;object_type:string;producer?:string;category?:string;source_ref:string;payload?:string[]}>};
  const semantics = JSON.parse(sources[2]) as {taxonomy:Record<string,[string,string,string]>;relations:Array<OntologyItem & {object:string}>;rules:Array<OntologyItem & {object:string}>;actions:Array<OntologyItem & {object:string}>};
  const objects: OntologyDefinition[] = registry.objects.map(o => {
    const items: OntologyDefinition['items'] = { properties:[], relations:[], events:[], rules:[], actions:[] };
    items.properties = o.properties.map(p => ({code:p.code,name:p.name,description:(p.rule||'').replace(/\bL([123])\b/g,'R$1'),source:p.lineage||o.source_ref,type:p.biz_type}));
    items.events = events.events.filter(e=>e.object_type===o.code).map(e=>({code:e.code,name:e.name,description:'事件类型定义；历史事实由事件生产者记录。目录登记不代表已接线。',source:'config/event-catalog.yaml '+e.source_ref,producer:e.producer,type:e.category,payload:JSON.stringify({type:'object',properties:Object.fromEntries((e.payload||[]).map(k=>[k,{}]))},null,2)}));
    for (const dimension of ['relations','rules','actions'] as const) items[dimension] = semantics[dimension].filter(i=>i.object===o.code).map(({object:_,...i})=>i);
    return {code:o.code,id:o.id,name:o.name,description:o.authority_source||'业务语义来源待补充',layer:o.layer,taxonomy:semantics.taxonomy[o.code]||[o.layer==='platform'?'智能体平台':'企业治理','未分类','待业务负责人分类'],source:'config/objects-registry.yaml '+o.source_ref,items};
  });
  return {sourceVersion:createHash('sha256').update(sources.join('\n')).digest('hex'),objects};
}

export function validateDefinition(raw:unknown, knownCodes:Set<string>, baseline:OntologyDefinition[]):OntologyDefinition {
  const parsed=definitionSchema.safeParse(raw);
  if(!parsed.success) throw new HttpFail(422,{message:'本体定义格式无效',issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
  const value=parsed.data as OntologyDefinition;
  const riskRank={R1:1,R2:2,R3:3};
  for(const dimension of ontologyDimensions){
    const seen=new Set<string>();
    for(const item of value.items[dimension]){
      if(seen.has(item.code))throw new HttpFail(422,`${dimension} 编码重复：${item.code}`);
      seen.add(item.code);
      if(dimension==='relations'&&(!item.target||!knownCodes.has(item.target)||!item.cardinality))throw new HttpFail(422,'关系需要有效目标对象与基数');
      if(dimension==='properties'&&!item.type?.trim())throw new HttpFail(422,'属性需要数据类型');
      if(dimension==='rules'&&!item.clause?.trim())throw new HttpFail(422,'规则说明必须注明条款依据；编辑不改变现行规则执行');
      if(dimension==='actions'){
        const registered=baseline.find(o=>o.code===value.code)?.items.actions.find(a=>a.code===item.code&&a.executor===item.executor);
        const floor=registered?.risk||'R3';
        if(!item.risk||riskRank[item.risk]<riskRank[floor])throw new HttpFail(422,'动作风险不得低于已有工具/技能风险下限；未登记依赖按 R3 管理');
      }
      for(const field of ['payload','input'] as const)if(item[field]){
        try{const schema=JSON.parse(item[field]!);if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error();}
        catch{throw new HttpFail(422,`${field} 必须是有效 JSON 对象`);}
      }
    }
  }
  return value;
}

/** Employee projection contains business semantics, never internal tool bindings. */
export function employeeDefinition(definition:OntologyDefinition):OntologyDefinition {
  const out=structuredClone(definition);
  for(const dimension of ontologyDimensions)out.items[dimension]=out.items[dimension].map(item=>{
    const {executor:_,producer:__,executionPoint:___,input:____,payload:_____,...publicItem}=item;
    return publicItem;
  });
  return out;
}
