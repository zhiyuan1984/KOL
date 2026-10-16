import type { PerformanceAsset, PerformanceContext, PerformanceCycle, PerformanceRecord, PerformanceRecordView, PerformanceResult, PerformanceAction } from '../../../shared/performance';
export type Overview={context:PerformanceContext;cycles:PerformanceCycle[];assets:PerformanceAsset[]};
export type RecordListItem={record:PerformanceRecord;cycleName:string;month:string;result:PerformanceResult|null;actions:PerformanceAction[]};
export type Receipt={id:string;message:string;receiptId:string;occurredAt:string;version?:number};
export class PerformanceApiError extends Error {constructor(message:string,readonly companies:{id:string;name:string}[]=[]){super(message);}}
export async function performanceApi<T>(path:string,company:string,body?:unknown):Promise<T>{
 const response=await fetch(`/api/performance/${path}`,{credentials:'same-origin',cache:'no-store',method:body===undefined?'GET':'POST',headers:{...(company?{'X-Performance-Company':company}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;try{data=await response.json();}catch{throw new Error('绩效服务未返回有效结果，请稍后重试');}
 if(!response.ok){const detail=data.detail??data;const message=['performance_schema_required','performance_postgres_required','workbench_identity_provider_required'].includes(detail.code)?'绩效服务尚未完成初始化，请联系管理员。':typeof detail==='string'?detail:detail.message||'绩效请求失败';throw new PerformanceApiError(message,detail.companies||[]);}return data;
}
export const getOverview=(company:string,admin=false)=>performanceApi<Overview>(`overview${admin?'?admin=1':''}`,company);
export const getRecord=(company:string,id:string)=>performanceApi<PerformanceRecordView>(`records/${encodeURIComponent(id)}`,company);
export const getRecords=(company:string,view:string,cycleId='')=>performanceApi<{items:RecordListItem[]}>(`records?view=${encodeURIComponent(view)}${cycleId?`&cycleId=${encodeURIComponent(cycleId)}`:''}`,company);
