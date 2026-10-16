import { HttpFail } from '../host/errors.js';
import type { PerformanceAction, PerformanceCycle, PerformanceObjective, PerformanceRecord, PerformanceResult, PerformanceRules, PerformanceStage } from '../../../shared/performance.js';

export const fail = (message:string,status=422):never => {throw new HttpFail(status,{code:'performance_validation',message});};
export function text(value:unknown,label:string,max=10000):string {if(typeof value!=='string'||value.length>max) return fail(`${label}格式错误或过长`);return value.trim();}
export function rulesValid(r:PerformanceRules):void {
 if(!r||!['initial','calibrated'].includes(r.coefficientBasis))fail('请明确基准系数采用初始等级还是校准后等级');
 if(!r||!Array.isArray(r.bands)||r.bands.length<2||r.bands.length>10) fail('请配置绩效等级与系数');
 if(!Number.isInteger(r.maxObjectives)||r.maxObjectives<1||r.maxObjectives>30) fail('指标数量上限须为1–30');
 if(!Number.isFinite(r.adjustmentCap)||r.adjustmentCap<0||r.adjustmentCap>100) fail('请明确额外系数加点上限（百分点）');
 const names=new Set<string>(); let previous=101;
 for(const b of r.bands){if(!b||typeof b.grade!=='string'||!b.grade.trim()||b.grade.length>20||names.has(b.grade)||!Number.isFinite(b.min)||b.min<0||b.min>=previous||!Number.isFinite(b.coefficient)||b.coefficient<0||b.coefficient>1) fail('等级须按分数降序配置，名称唯一，系数在0–1之间');names.add(b.grade);previous=b.min;}
 if(r.bands.at(-1)?.min!==0) fail('最低等级的起始分须为0');
 if(r.vetoGrade&&!r.bands.some(b=>b.grade===r.vetoGrade))fail('否决等级须存在于等级规则中');
 text(r.distributionNote,'分布规则说明');
}
export function objectivesValid(rows:PerformanceObjective[],rules:PerformanceRules,phase:'plan'|'self'|'manager'):void {
 if(!rows.length||rows.length>rules.maxObjectives) fail(`指标数量须为1–${rules.maxObjectives}项`);
 if(Math.abs(rows.reduce((s,o)=>s+o.weight,0)-100)>0.00001) fail('月度指标权重合计须为100%');
 for(const o of rows){if(!o.title.trim()||!o.standard.trim()||!o.definition.trim()||o.weight<=0) fail('请补齐指标、定义、评分标准与正数权重');
 if(phase!=='plan'&&(!o.actual.trim()||o.selfScore===null)) fail('请补齐实际完成情况与自评分');
 if(phase==='manager'&&(o.managerScore===null||!o.managerComment.trim())) fail('请补齐上级评分与评分说明');}
}
export function resultFor(r:PerformanceRecord,rules:PerformanceRules):PerformanceResult {
 const weighted=(key:'selfScore'|'managerScore')=> r.objectives.length&&Math.abs(r.objectives.reduce((s,o)=>s+o.weight,0)-100)<0.00001&&r.objectives.every(o=>o[key]!==null)?r.objectives.reduce((s,o)=>s+o.weight*(o[key]??0)/100,0):null;
 const score=weighted('managerScore'),selfScore=weighted('selfScore');
 const band=score===null?undefined:rules.bands.find(b=>score>=b.min);
 const finalGrade=r.vetoReason&&rules.vetoGrade?rules.vetoGrade:r.hrGrade||r.calibratedGrade||band?.grade||null;
 const finalBand=rules.bands.find(b=>b.grade===(r.vetoReason&&rules.vetoGrade?rules.vetoGrade:rules.coefficientBasis==='initial'?band?.grade:finalGrade));
 const points=r.adjustments.reduce((s,a)=>s+a.points,0);
 return {score,selfScore,initialGrade:band?.grade??null,finalGrade,baseCoefficient:finalBand?.coefficient??null,adjustmentPoints:points,finalCoefficient:finalBand?Math.round((finalBand.coefficient+points/100)*1000000)/1000000:null};
}
export const publicResult=(stage:PerformanceStage)=>['published','acknowledged','disputed'].includes(stage);
export function editsFor(r:PerformanceRecord,actorId:string):('plan'|'self'|'manager'|'department'|'hr')[]{
 return [...(r.employeeId===actorId&&r.stage==='plan'?['plan' as const]:[]),...(r.employeeId===actorId&&r.stage==='self'?['self' as const]:[]),...(r.managerId===actorId&&r.stage==='manager'?['manager' as const]:[]),...(r.departmentId===actorId&&r.stage==='department'?['department' as const]:[]),...(r.hrId===actorId&&r.stage==='hr'?['hr' as const]:[])];
}
export function actionsFor(r:PerformanceRecord,actorId:string):PerformanceAction[]{
 const actions:PerformanceAction[]=[];
 const next:Partial<Record<PerformanceStage,[string,PerformanceAction]>>={plan:[r.employeeId,'submit_plan'],plan_review:[r.managerId,'confirm_plan'],self:[r.employeeId,'submit_self'],manager:[r.managerId,'submit_manager'],department:[r.departmentId,'approve_department'],hr:[r.hrId,'approve_hr'],payroll:[r.payrollId,'approve_payroll']};
 const n=next[r.stage];if(n?.[0]===actorId) actions.push(n[1]);
 if(n?.[0]===actorId&&['plan_review','manager','department','hr','payroll'].includes(r.stage)) actions.push('return');
 if(publicResult(r.stage)&&r.employeeId===actorId&&r.stage!=='disputed') {if(r.stage==='published')actions.push('acknowledge');actions.push('dispute');}
 if(r.stage==='disputed'&&r.departmentId===actorId)actions.push('resolve_dispute');
 if(publicResult(r.stage)&&(r.managerId===actorId||r.hrId===actorId)) actions.push('save_meeting');
 return actions;
}
export function transition(r:PerformanceRecord,action:PerformanceAction,actor:string,cycle:PerformanceCycle,reason:string):PerformanceStage {
 if(cycle.status!=='active') fail('当前周期不允许办理',409);
 if(!actionsFor(r,actor).includes(action)) fail('当前身份或环节不允许此操作',403);
 const map:Partial<Record<PerformanceAction,PerformanceStage>>={submit_plan:'plan_review',confirm_plan:'self',submit_self:'manager',submit_manager:'department',approve_department:'hr',approve_hr:'payroll',approve_payroll:'ready',acknowledge:'acknowledged',dispute:'disputed',resolve_dispute:'published'};
 if(['return','dispute','resolve_dispute','save_meeting','approve_department','approve_hr','approve_payroll'].includes(action)&&!reason) fail('请填写原因或记录');
 if(['submit_plan','confirm_plan'].includes(action))objectivesValid(r.objectives,cycle.rules,'plan');
 if(action==='submit_self')objectivesValid(r.objectives,cycle.rules,'self');
 if(['submit_manager','approve_department','approve_hr','approve_payroll'].includes(action))objectivesValid(r.objectives,cycle.rules,'manager');
 if(['approve_department','approve_hr'].includes(action)&&cycle.rules.gradeEvidenceRequired){const result=resultFor(r,cycle.rules);if(result.finalGrade!=='B'&&!(action==='approve_hr'?(r.hrRemark||r.assessmentReason)?.trim():r.assessmentReason?.trim()))fail('非B等级须填写绩效评分明细；S/A须提供事实依据和案例');if(['S','A'].includes(result.finalGrade||'')&&!r.objectives.some(o=>o.evidence.trim()))fail('S/A等级须补充事实依据和案例');}
 if(action==='return')return ({plan_review:'plan',manager:'self',department:'manager',hr:'department',payroll:'hr'} as Partial<Record<PerformanceStage,PerformanceStage>>)[r.stage]!;
 return map[action]??r.stage;
}
