import type { OntologyCatalog, OntologyConfirmation, OntologyDefinition, OntologyReceipt, OntologyVersion, OntologyScopeSettings, OntologyScopeOptions, OntologyScopeMapping, OntologyMaintenanceRequest, OntologyDimension } from '../../../shared/ontology';
export class OntologyApiError extends Error {
  constructor(message:string,readonly companies:{id:string;name:string}[]=[]) { super(message); }
}
export async function ontologyRequest<T>(endpoint:string,company:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api/ontology/workspace/'+endpoint,{credentials:'same-origin',cache:'no-store',signal,
    method:body===undefined?'GET':'POST',headers:{...(company?{'X-Ontology-Company':company}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await response.json();}catch{throw new Error('本体服务没有返回有效结果，请重试');}
  if(!response.ok){const detail=data.detail??data;throw new OntologyApiError(typeof detail==='string'?detail:detail.message||'本体请求失败',detail.companies||[]);}
  return data;
}
export const ontologyApi={
  scope:(company:string)=>ontologyRequest<OntologyScopeSettings & {options:OntologyScopeOptions}>('scope',company),
  configureScope:(company:string,expectedRevision:number,mappings:OntologyScopeMapping[],reason:string)=>ontologyRequest<OntologyReceipt>('scope',company,{expectedRevision,mappings,reason,confirmed:true}),
  requestMaintenance:(company:string,code:string,dimension:OntologyDimension,note:string,commandId:string)=>ontologyRequest<OntologyReceipt>('maintenance',company,{code,dimension,note,commandId}),
  maintenance:(company:string)=>ontologyRequest<{items:OntologyMaintenanceRequest[]}>('maintenance',company),
  catalog:(company:string,admin:boolean,signal?:AbortSignal)=>ontologyRequest<OntologyCatalog>('catalog'+(admin?'?admin=1':''),company,undefined,signal),
  save:(company:string,definition:OntologyDefinition,expectedRevision:number,sourceVersion:string,reason:string)=>ontologyRequest<OntologyReceipt>('drafts',company,{definition,expectedRevision,sourceVersion,reason}),
  history:(company:string,code:string)=>ontologyRequest<{items:OntologyVersion[]}>('history/'+encodeURIComponent(code),company),
  prepare:(company:string,code:string,expectedRevision:number,action:string,targetVersion?:string)=>ontologyRequest<OntologyConfirmation>('prepare',company,{code,expectedRevision,action,targetVersion}),
  commit:(company:string,token:string,commandId:string,reason:string)=>ontologyRequest<OntologyReceipt>('commit',company,{token,commandId,reason,confirmed:true}),
};
