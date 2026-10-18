import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_ROOT } from '../config.js';
import type { Json } from '../types.js';
import { HttpFail } from '../host/errors.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

/** Business dependencies are separate from connector/tool bindings and never grant access. */
export type CapabilityReference = { id: string; version: number; optional?: boolean };
export type OntologyReference = { object: string; revision: number; actions?: string[] };
export type OperationContract = {
  id: string; version: number; name: string; description: string;
  effect: 'read' | 'draft' | 'write'; risk: 'R1' | 'R2' | 'R3'; asynchronous: boolean;
  inputSchema?: Json;
  result?: { kind: 'paged'; items: string[]; total: string[]; page?:string[]; pageSize?:string[]; itemFields: Record<string,string[]> };
  implementation: { connector: string; tool: string; version: number; jsonArgument?: string; inputFields?: Record<string,string>; topLevelFields?:string[] };
};
export type ContractCatalog = { version: number; operations: OperationContract[] };
let catalogCache:{source:string;catalog:ContractCatalog}|undefined;
const idPattern = /^[a-z][a-z0-9_.-]{1,99}$/;
const safeField = (value:unknown):value is string => typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const validPaths = (value:unknown):boolean => Array.isArray(value)&&value.length>0&&value.length<=16&&value.every(path=>typeof path==='string'&&path.split('.').length<=8&&path.split('.').every(safeField));

/** Validate configuration before it can change the model-visible or execution contract. */
export function validateOperationAdapter(operation:OperationContract):void {
  const mapping=operation.implementation;
  if(mapping.jsonArgument!==undefined&&!safeField(mapping.jsonArgument))throw new Error('invalid_operation_adapter');
  if(mapping.inputFields!==undefined){
    if(!mapping.inputFields||typeof mapping.inputFields!=='object'||Array.isArray(mapping.inputFields))throw new Error('invalid_operation_adapter');
    const fields=Object.entries(mapping.inputFields);
    if(fields.some(([from,to])=>!safeField(from)||!safeField(to))||new Set(fields.map(([,to])=>to)).size!==fields.length)throw new Error('invalid_operation_adapter');
  }
  if(mapping.jsonArgument&&!mapping.inputFields)throw new Error('invalid_operation_adapter');
  if(mapping.topLevelFields!==undefined&&(!mapping.jsonArgument||!Array.isArray(mapping.topLevelFields)||new Set(mapping.topLevelFields).size!==mapping.topLevelFields.length||mapping.topLevelFields.some(name=>!safeField(name)||!Object.hasOwn(mapping.inputFields||{},name))))throw new Error('invalid_operation_adapter');
  if(operation.inputSchema!==undefined){
    if(!operation.inputSchema||operation.inputSchema.type!=='object')throw new Error('invalid_operation_input_schema');
    try{new AjvJsonSchemaValidator().getValidator(operation.inputSchema as object);}catch{throw new Error('invalid_operation_input_schema');}
    if(mapping.inputFields){
      const properties=operation.inputSchema.properties;
      if(!properties||typeof properties!=='object'||Array.isArray(properties)||Object.keys(properties).some(name=>!Object.hasOwn(mapping.inputFields!,name))||Object.keys(mapping.inputFields).some(name=>!Object.hasOwn(properties,name)))throw new Error('invalid_operation_adapter');
    }
  }
  const result=operation.result;
  if(result&&(result.kind!=='paged'||!validPaths(result.items)||!validPaths(result.total)||(result.page!==undefined&&!validPaths(result.page))||(result.pageSize!==undefined&&!validPaths(result.pageSize))||!result.itemFields||typeof result.itemFields!=='object'||Array.isArray(result.itemFields)||!Object.keys(result.itemFields).length||Object.entries(result.itemFields).some(([name,paths])=>!safeField(name)||!validPaths(paths))))throw new Error('invalid_operation_result_adapter');
}

export function parseCapabilityReferences(raw: unknown): CapabilityReference[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 64) throw new Error('invalid_capability_dependencies');
  const seen = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== 'object' || !idPattern.test(value.id) || !Number.isSafeInteger(value.version) || value.version < 1 || seen.has(value.id)) throw new Error('invalid_capability_dependency');
    if(value.optional!==undefined&&typeof value.optional!=='boolean')throw new Error('invalid_capability_dependency');
    seen.add(value.id); return Object.freeze({id: value.id, version: value.version,...(value.optional!==undefined?{optional:value.optional}:{})});
  });
}
export function parseOntologyReferences(raw: unknown): OntologyReference[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 32) throw new Error('invalid_ontology_dependencies');
  const seen = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== 'object' || !idPattern.test(value.object) || !Number.isSafeInteger(value.revision) || value.revision < 1 || seen.has(value.object)) throw new Error('invalid_ontology_dependency');
    if (value.actions !== undefined && (!Array.isArray(value.actions) || value.actions.some((action: unknown) => typeof action !== 'string' || !idPattern.test(action)) || new Set(value.actions).size !== value.actions.length)) throw new Error('invalid_ontology_action_dependency');
    seen.add(value.object); return Object.freeze({object: value.object, revision: value.revision, ...(value.actions ? {actions: Object.freeze([...value.actions]) as unknown as string[]} : {})});
  });
}
export function loadOperationContracts(): ContractCatalog {
  const source=fs.readFileSync(path.join(REPO_ROOT,'config/capability-operations.json'),'utf8');
  if(catalogCache?.source===source)return structuredClone(catalogCache.catalog);
  const catalog = JSON.parse(source) as ContractCatalog;
  validateOperationCatalog(catalog);
  catalogCache={source,catalog:structuredClone(catalog)};
  return catalog;
}
export function validateOperationCatalog(catalog:ContractCatalog):void {
  if (catalog.version !== 1 || !Array.isArray(catalog.operations) || catalog.operations.length>10000) throw new Error('invalid_operation_catalog');
  const seen = new Set<string>();
  const aliases = new Set<string>();
  for (const operation of catalog.operations) {
    const key = `${operation.id}@${operation.version}`;
    if (!idPattern.test(operation.id) || seen.has(key) || !Number.isSafeInteger(operation.version) || operation.version < 1 || !operation.name?.trim() || !operation.description?.trim()
      || !['read','draft','write'].includes(operation.effect) || !['R1','R2','R3'].includes(operation.risk) || typeof operation.asynchronous !== 'boolean'
      || (operation.effect === 'write' && operation.risk !== 'R3') || (operation.effect === 'draft' && operation.risk === 'R1')
      || !idPattern.test(operation.implementation?.connector) || !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(operation.implementation?.tool) || !Number.isSafeInteger(operation.implementation?.version) || operation.implementation.version < 1) throw new Error('invalid_operation_contract');
    const alias=operationAlias(operation);
    if(aliases.has(alias))throw new Error('operation_alias_collision');
    aliases.add(alias);seen.add(key);
    validateOperationAdapter(operation);
  }
}
export function resolveOperations(references: readonly CapabilityReference[], catalog=loadOperationContracts()): OperationContract[] {
  if (!references.length) return [];
  return references.flatMap(reference => {
    const found = catalog.operations.find(operation => operation.id === reference.id && operation.version === reference.version);
    if (!found) {if(reference.optional)return [];throw new HttpFail(409,{code:'capability_dependency_unavailable',capability_id:reference.id,version:reference.version});}
    return [structuredClone(found)];
  });
}
export function operationFingerprint(operations: readonly OperationContract[]): string {
  return createHash('sha256').update(JSON.stringify(operations)).digest('hex');
}
export function operationAlias(operation: OperationContract): string {
  return `cap_${operation.id.replace(/[^a-z0-9]/g,'_')}_v${operation.version}`;
}
export function operationTools(references: readonly CapabilityReference[], allowUnresolved=false,catalog=loadOperationContracts()): string[] {
  if(!allowUnresolved)return resolveOperations(references,catalog).map(operation => `${operation.implementation.connector}.${operation.implementation.tool}`);
  if(!references.length)return [];
  return references.flatMap(reference=>{
    const operation=catalog.operations.find(item=>item.id===reference.id&&item.version===reference.version);
    return operation?[`${operation.implementation.connector}.${operation.implementation.tool}`]:[];
  });
}
export function operationCatalogFingerprint(catalog=loadOperationContracts()):string {return operationFingerprint(catalog.operations);}
export function capabilityRiskFloor(references:readonly CapabilityReference[],catalog=loadOperationContracts()):'L1'|'L2'|'L3'|null{
  if(!references.length)return null;
  try{
    const risks=resolveOperations(references,catalog).map(operation=>operation.risk);
    return risks.includes('R3')?'L3':risks.includes('R2')?'L2':'L1';
  }catch{return 'L3';}
}

/** Only registered field remapping/string-envelope operations are configurable. */
export function operationArguments(operation: OperationContract, args: Json): Json {
  if (!operation.implementation.inputFields && !operation.implementation.jsonArgument) return args;
  const mapped:Json={},top:Json={};
  for(const [key,value] of Object.entries(args)){
    const target=operation.implementation.inputFields&&Object.hasOwn(operation.implementation.inputFields,key)?operation.implementation.inputFields[key]:undefined;
    if(!target) throw new Error('capability_argument_not_mapped');
    (operation.implementation.topLevelFields?.includes(key)?top:mapped)[target]=value;
  }
  return operation.implementation.jsonArgument ? {...top,[operation.implementation.jsonArgument]:JSON.stringify(mapped)} : mapped;
}

function field(value:unknown,paths:string[]):unknown{
  for(const candidate of paths){let current=value;for(const key of candidate.split('.'))current=current&&typeof current==='object'&&!Array.isArray(current)&&Object.hasOwn(current,key)?(current as Record<string,unknown>)[key]:undefined;if(current!==undefined&&current!==null)return current;}
  return null;
}
/** Standard results retain missing totals as null; an invalid response never becomes an empty page. */
export function operationResult(operation:OperationContract,args:Json,response:Json):Json{
  if(!operation.result||response.isError===true)return response;
  let payload:unknown=response.structuredContent;
  if(!payload&&Array.isArray(response.content)){
    const block=(response.content as Array<{type?:string;text?:string}>).find(item=>item.type==='text'&&typeof item.text==='string');
    try{payload=JSON.parse(block?.text||'');}catch{throw new HttpFail(502,{code:'capability_result_contract_invalid'});}
  }
  const items=field(payload,operation.result.items),total=field(payload,operation.result.total);
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||Array.isArray(item))||(total!==null&&(typeof total!=='number'||!Number.isSafeInteger(total)||total<0)))throw new HttpFail(502,{code:'capability_result_contract_invalid'});
  const page=field(payload,operation.result.page||[]),pageSize=field(payload,operation.result.pageSize||[]);
  if((page!==null&&page!==(args.page_no??1))||(pageSize!==null&&pageSize!==(args.page_size??20)))throw new HttpFail(502,{code:'capability_pagination_contract_invalid'});
  const normalized:Json={items:items.map(item=>Object.fromEntries(Object.entries(operation.result!.itemFields).map(([name,paths])=>[name,field(item,paths)]))),total,
    page_no:args.page_no??1,page_size:args.page_size??20,
    source:{capability_id:operation.id,contract_version:operation.version,implementation_version:operation.implementation.version,received_at:new Date().toISOString()}};
  return {content:[{type:'text',text:JSON.stringify(normalized)}],structuredContent:normalized};
}
