import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PerformanceAsset, PerformanceAssetAction, PerformancePreset, PerformanceTemplate } from '../../../shared/performance.js';
import type { ReviewInstance, ReviewNode } from '../../../shared/review.js';
import { advanceReview, decideReview } from '../approval/review-engine.js';
import { fail, text } from './domain.js';

const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(value);
export const assetDigest=(asset:Pick<PerformanceAsset,'name'|'kind'|'data'>)=>createHash('sha256').update(canonical({name:asset.name,kind:asset.kind,data:asset.data})).digest('hex');
export const workbookPreset=JSON.parse(readFileSync(new URL('./presets/amperetime-monthly-v3.json',import.meta.url),'utf8')) as PerformancePreset;
export function assetActions(a:PerformanceAsset,actor:string,admin:boolean):PerformanceAssetAction[]{
 const mine=admin&&a.createdBy===actor;
 if(a.status==='published')return admin?['revise']:[];
 if(a.status==='reviewing')return [...(a.approval?.requester===actor?['withdraw' as const]:[]),...(a.approval?.tasks.some(t=>t.userId===actor&&t.nodeId===a.approval?.currentNode&&t.status==='pending')?['approve' as const,'reject' as const]:[])];
 if(a.status==='approved')return mine?['publish']:[];
 return mine||admin&&!a.createdBy?['edit','submit']:[];
}
export function templateValid(t:PerformanceTemplate,complete=false){
 if(!t||!Array.isArray(t.objectives)||t.objectives.length>30)fail('模板最多支持30项指标');
 text(t.instructions,'填写说明');
 for(const o of t.objectives){if(!o||typeof o!=='object'||Array.isArray(o))fail('无效模板指标');for(const key of ['title','definition','standard','annualGoal','annualProgress','actions','notes'] as const)text(o[key]??'',key);for(const key of ['weight','annualWeight'] as const)if(o[key]!==undefined&&(!Number.isFinite(o[key])||o[key]!<0||o[key]!>100))fail('模板权重须为0–100');}
 if(complete){
  if(!t.objectives.length)fail('请配置至少一项指标');
  if(t.objectives.some(o=>!o.title.trim()||!o.definition.trim()||!o.standard.trim()))fail('请补齐每项指标的目标、定义和评分标准');
  const weighted=t.objectives.some(o=>o.weight!==undefined);
  if(weighted&&(t.objectives.some(o=>!o.weight)||Math.abs(t.objectives.reduce((n,o)=>n+(o.weight??0),0)-100)>.00001))fail('模板月度权重合计须为100%，请核对原表130%的异常');
 }
}
const named=(node:ReviewNode)=>node.assignee?.kind==='named'?node.assignee.userIds:[];
export function startAssetReview(asset:PerformanceAsset,requester:string,reviewers:{id:string;name:string}[],at:string):ReviewInstance{
 if(reviewers.length!==2||reviewers.some(r=>!r.id||r.id===requester)||new Set(reviewers.map(r=>r.id)).size!==2)fail('请选择两位不同且非申请人本人的模板审批人：部门负责人、HRBP');
 const instance:ReviewInstance={id:randomUUID(),templateId:'performance-asset-review-v1',templateVersion:1,version:1,requester,title:asset.name,definition:{schema:'review.definition.v1',name:'绩效配置审批',description:'部门负责人审核后交HRBP复核，通过后由申请人发布。',fields:[],nodes:[{id:'start',name:'提交审批',type:'start',next:'department'},...reviewers.map((r,i):ReviewNode=>({id:i===0?'department':'hr',name:`${i===0?'部门负责人审核':'HRBP复核'} · ${r.name}`,type:'review',mode:'single',assignee:{kind:'named',userIds:[r.id]},next:i===0?'hr':'end'})),{id:'end',name:'审批完成',type:'end'}]},values:{contentHash:assetDigest(asset),assetId:asset.id},currentNode:'start',status:'reviewing',tasks:[],createdAt:at,updatedAt:at};
 advanceReview(instance,'start',named,at);if(instance.status==='blocked')fail(instance.blockedReason||'审批人解析失败');return instance;
}
export function decideAssetReview(asset:PerformanceAsset,actor:string,action:'approve'|'reject',reason:string,validMembers:Set<string>,at:string){
 if(!asset.approval||asset.approval.values.contentHash!==assetDigest(asset))fail('审批内容已变化，请重新提交审批',409);
 if(!reason.trim())fail('请填写审批意见');
 if(!assetActions(asset,actor,false).includes(action))fail('当前用户没有此配置的待审批任务',403);
 const review=structuredClone(asset.approval!);
 try{decideReview(review,actor,action,reason,node=>named(node).filter(id=>validMembers.has(id)),at);}catch(e){fail(e instanceof Error?e.message:'审批未完成',403);}
 if(review.status==='blocked')fail(review.blockedReason||'下一审批人组织资格已失效',409);
 review.version++;review.updatedAt=at;return review;
}
