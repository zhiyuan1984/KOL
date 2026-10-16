import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PerformanceAction, PerformanceAdjustment, PerformanceAsset, PerformanceContext, PerformanceCycle, PerformanceEvent, PerformanceObjective, PerformanceRecord, PerformanceRecordView, PerformanceRules, PerformanceTemplate } from '../../../shared/performance.js';
import { postgresPool, postgresTransaction } from '../postgres/pool.js';
import type { TicketPrincipal } from '../ticket-domain/auth.js';
import { HttpFail } from '../host/errors.js';
import { assetActions, assetDigest, workbookPreset, templateValid, startAssetReview, decideAssetReview } from './assets.js';
import { performanceCompanyName } from './company-names.js';
import { actionsFor, editsFor, fail, publicResult, resultFor, rulesValid, text, transition } from './domain.js';

type DB={query:PoolClient['query']};
const id=()=>randomUUID();
const now=()=>new Date().toISOString();
const requireValue=(value:unknown,label:string)=>{const out=text(value,label,200);if(!out)fail(`请填写${label}`);return out;};
const recordFrom=(row:any):PerformanceRecord=>({...row.data,id:row.id,cycleId:row.cycle_id,companyId:row.company_id,stage:row.stage,version:row.version,updatedAt:row.updated_at});
const cycleFrom=(row:any):PerformanceCycle=>({id:row.id,companyId:row.company_id,name:row.name,month:row.month,status:row.status,version:row.version,templateId:row.template_id,rulesId:row.rules_id,template:row.template,rules:row.rules,deadlines:row.deadlines,createdAt:row.created_at});
const assetFrom=(row:any):PerformanceAsset=>({createdBy:row.created_by,approval:row.approval,id:row.id,companyId:row.company_id,kind:row.kind,name:row.name,version:row.version,status:row.status,data:row.data});
const memberSql=`SELECT DISTINCT p.user_id AS id,p.display_name AS name,m.company_id,u.id AS "unitId",u.display_name AS "unitName",parent.display_name AS "departmentName",COALESCE(m.position,'') AS position
 FROM organization_people p JOIN users a ON a.id=p.user_id AND a.active=1
 JOIN organization_memberships m ON m.person_ref=p.person_ref JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
 LEFT JOIN organization_units parent ON parent.id=u.parent_id AND parent.company_id=u.company_id
 WHERE p.status='active' AND m.status='active' AND u.status='active'
 AND (m.effective_from IS NULL OR m.effective_from<=$1) AND (m.effective_to IS NULL OR m.effective_to>$1)`;
function adjustmentsFrom(value:any,rules:PerformanceRules){
 if(!Array.isArray(value)||value.length>30)fail('调整项格式无效');
 const rows:PerformanceAdjustment[]=value.map((a:any)=>{if(!Number.isFinite(a.points)||a.points>rules.adjustmentCap)fail('加减系数超出范围');return {id:a.id?requireValue(a.id,'调整标识'):id(),points:a.points,reason:requireValue(a.reason,'调整理由'),source:text(a.source,'依据来源'),category:a.category==='other'?'other' as const:'manager' as const};});
 if(rows.filter(a=>a.points>0).reduce((n,a)=>n+a.points,0)>rules.adjustmentCap)fail('正向加点合计超出上限');return rows;
}
const scopeSql=`($2 IN (r.employee_id,r.manager_id,r.department_id,r.hr_id,r.payroll_id))`;

export class PerformanceService {
 constructor(private actor:TicketPrincipal,private selectedCompany?:string){}
 async context(db:DB=postgresPool()):Promise<PerformanceContext>{
  const mine=await db.query(`${memberSql} AND p.user_id=$2`,[now(),this.actor.id]);
  const companies=[...new Set(mine.rows.map((r:any)=>String(r.company_id)))].map(company=>({id:company,name:performanceCompanyName(company)}));
  const companyId=this.selectedCompany||(companies.length===1?companies[0].id:'');
  if(!companyId||!companies.some(c=>c.id===companyId))throw new HttpFail(403,{code:'performance_company_required',message:'请选择本人有效组织所属公司',companies});
  const admin=this.actor.roles.includes('admin');
  const people=admin?(await db.query(`${memberSql} AND m.company_id=$2 ORDER BY p.display_name`,[now(),companyId])).rows:mine.rows.filter(r=>r.company_id===companyId);
  const assigned=await db.query(`SELECT bool_or(manager_id=$2) AS evaluate,bool_or(department_id=$2 OR hr_id=$2) AS summary,bool_or(payroll_id=$2) AS payroll FROM performance_records WHERE company_id=$1`,[companyId,this.actor.id]);
  const cap=assigned.rows[0];const configReview=(await db.query("SELECT 1 FROM performance_assets WHERE company_id=$1 AND (created_by=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(approval->'tasks','[]'::jsonb)) t WHERE t->>'userId'=$2)) LIMIT 1",[companyId,this.actor.id])).rowCount;

  return {actorId:this.actor.id,admin,companies,companyId,people:people.map((r:any)=>({id:r.id,name:r.name,unitId:r.unitId,unitName:r.unitName,position:r.position})),capabilities:{configReview:!!configReview,evaluate:!!cap?.evaluate,summary:!!cap?.summary,payroll:!!cap?.payroll}};
 }
 async overview(admin=false){
  const ctx=await this.context();if(admin&&!ctx.admin)fail('需要绩效配置管理权限',403);
  const cycles=await postgresPool().query(`SELECT c.* FROM performance_cycles c WHERE c.company_id=$1 ${admin?'':`AND EXISTS (SELECT 1 FROM performance_records r WHERE r.cycle_id=c.id AND ${scopeSql})`} ORDER BY c.month DESC,c.created_at DESC`,admin?[ctx.companyId]:[ctx.companyId,this.actor.id]);
  const assets=admin?await postgresPool().query('SELECT * FROM performance_assets WHERE company_id=$1 ORDER BY updated_at DESC',[ctx.companyId]):{rows:[]};
  return {context:ctx,cycles:cycles.rows.map(cycleFrom),assets:assets.rows.map(row=>{const a=assetFrom(row);return {...a,actions:assetActions(a,this.actor.id,ctx.admin)};})};
 }
 async presets(){const ctx=await this.context();if(!ctx.admin)fail('需要绩效配置管理权限',403);return {items:ctx.companyId===workbookPreset.companyId?[workbookPreset]:[]};}
 async assetApprovals(){const ctx=await this.context();const rows=await postgresPool().query(`SELECT * FROM performance_assets WHERE company_id=$1 AND (created_by=$2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(approval->'tasks','[]'::jsonb)) t WHERE t->>'userId'=$2)) ORDER BY updated_at DESC`,[ctx.companyId,this.actor.id]);return {items:rows.rows.map(row=>{const a=assetFrom(row);return {...a,actions:assetActions(a,this.actor.id,ctx.admin)};})};}
 async list(view:string,cycleId?:string){
  const ctx=await this.context();
  // No admin bypass: sensitive rows are selected only for explicit participants.
  const rows=await postgresPool().query(`SELECT r.*,c.name AS cycle_name,c.month,c.status AS cycle_status,c.rules FROM performance_records r JOIN performance_cycles c ON c.id=r.cycle_id WHERE r.company_id=$1 AND ${scopeSql} AND ($3::text IS NULL OR r.cycle_id=$3) ORDER BY c.month DESC,r.updated_at DESC`,[ctx.companyId,this.actor.id,cycleId||null]);
  const items=rows.rows.map(row=>{const r=recordFrom(row);const visible=r.employeeId!==this.actor.id||publicResult(r.stage);const out=this.project(r,visible);return {record:out,cycleName:row.cycle_name,month:row.month,result:visible?resultFor(r,row.rules):null,actions:row.cycle_status==='active'?actionsFor(r,this.actor.id):[]};}).filter(x=>view==='mine'?x.record.employeeId===this.actor.id:view==='inbox'?x.actions.length>0:view==='summary'?[x.record.departmentId,x.record.hrId].includes(this.actor.id):view==='payroll'?x.record.payrollId===this.actor.id&&['payroll','ready','published','acknowledged','disputed'].includes(x.record.stage):true);
  return {items};
 }
 private project(r:PerformanceRecord,visible:boolean):PerformanceRecord {
  if(visible)return r;
  return {...r,objectives:r.objectives.map(o=>({...o,managerScore:null,managerComment:''})),adjustments:[],calibratedGrade:null,calibrationReason:'',assessmentReason:'',hrGrade:null,hrRemark:'',vetoReason:'',meeting:'',resolution:''};
 }
 private async load(db:DB,recordId:string,companyId:string,lock=false){
  // Lock the cycle before its record, matching release/archive lock order.
  if(lock){const ref=(await db.query(`SELECT cycle_id FROM performance_records r WHERE id=$1 AND company_id=$2 AND $3 IN(r.employee_id,r.manager_id,r.department_id,r.hr_id,r.payroll_id)`,[recordId,companyId,this.actor.id])).rows[0];if(!ref)fail('绩效单不存在或无访问权限',404);await db.query('SELECT id FROM performance_cycles WHERE id=$1 FOR SHARE',[ref.cycle_id]);}
  const row=(await db.query(`SELECT r.* FROM performance_records r WHERE r.id=$1 AND r.company_id=$2 AND $3 IN(r.employee_id,r.manager_id,r.department_id,r.hr_id,r.payroll_id) ${lock?'FOR UPDATE':''}`,[recordId,companyId,this.actor.id])).rows[0];
  if(!row)fail('绩效单不存在或无访问权限',404);
  const cycle=(await db.query('SELECT * FROM performance_cycles WHERE id=$1 AND company_id=$2',[row.cycle_id,companyId])).rows[0];
  return {record:recordFrom(row),cycle:cycleFrom(cycle)};
 }
 async detail(recordId:string):Promise<PerformanceRecordView>{
  const ctx=await this.context();const {record:r,cycle}=await this.load(postgresPool(),recordId,ctx.companyId);
  const resultVisible=r.employeeId!==this.actor.id||publicResult(r.stage);
  const events=await postgresPool().query(`SELECT e.id,e.actor_id AS "actorId",COALESCE((SELECT p.display_name FROM organization_people p WHERE p.user_id=e.actor_id LIMIT 1),'办理人') AS "actorName",e.action,e.version,e.reason,e.created_at AS "createdAt" FROM performance_events e WHERE e.company_id=$1 AND e.object_id=$2 ORDER BY e.created_at,e.id`,[ctx.companyId,r.id]);
  const result=resultFor(r,cycle.rules);
  return {record:this.project(r,resultVisible),cycle,result:resultVisible?result:{...result,score:null,initialGrade:null,finalGrade:null,baseCoefficient:null,adjustmentPoints:0,finalCoefficient:null},actions:cycle.status==='active'?actionsFor(r,this.actor.id):[],editSections:cycle.status==='active'?editsFor(r,this.actor.id):[],events:events.rows.map(e=>resultVisible?e:{...e,reason:''}) as PerformanceEvent[],resultVisible};
 }
 async audit(){const ctx=await this.context();if(!ctx.admin)fail('需要管理权限',403);const rows=await postgresPool().query('SELECT id,object_id,actor_id,action,version,created_at FROM performance_events WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200',[ctx.companyId]);return {items:rows.rows};}
 async assignments(){
  const ctx=await this.context();if(!ctx.admin)fail('需要绩效配置管理权限',403);
  // Governance projection deliberately excludes scores, comments and results.
  const rows=await postgresPool().query(`SELECT id,cycle_id AS "cycleId",data->>'employeeName' AS "employeeName",data->>'unitName' AS "unitName",manager_id AS "managerId",department_id AS "departmentId",hr_id AS "hrId",payroll_id AS "payrollId" FROM performance_records WHERE company_id=$1 ORDER BY updated_at DESC`,[ctx.companyId]);
  return {items:rows.rows};
 }
 async command(b:any){
  return postgresTransaction(async db=>{
   const ctx=await this.context(db),commandId=requireValue(b.commandId,'请求标识');
   const hash=createHash('sha256').update(JSON.stringify(b)).digest('hex');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${ctx.companyId}:${this.actor.id}:${commandId}`]);
   const old=(await db.query('SELECT * FROM performance_commands WHERE company_id=$1 AND actor_id=$2 AND command_id=$3',[ctx.companyId,this.actor.id,commandId])).rows[0];
   if(old){if(old.request_hash!==hash)fail('请求标识已用于其他内容',409);if(b.type==='export_handover'){for(const ref of old.receipt.records||[]){const r=await this.load(db,ref.id,ctx.companyId);if(r.record.payrollId!==this.actor.id||r.record.version!==ref.version)fail('核算范围或结果版本已变化，请重新导出',409);}}return old.receipt;}
   const formal=b.type!=='save_record'&&b.type!=='save_asset';
   if((formal||b.publish)&&b.confirmed!==true)fail('正式操作须确认当前对象、内容与范围',409);
   const receipt=await this.execute(db,ctx,b);
   const out={...receipt,receiptId:commandId,occurredAt:now()};
   await db.query('INSERT INTO performance_commands VALUES($1,$2,$3,$4,$5,$6)',[ctx.companyId,this.actor.id,commandId,hash,JSON.stringify(out),now()]);
   return out;
  });
 }
 private async event(db:DB,ctx:PerformanceContext,objectId:string,action:string,version:number,before:unknown,after:unknown,reason=''){
  await db.query('INSERT INTO performance_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id(),ctx.companyId,objectId,this.actor.id,action,version,reason,JSON.stringify(before),JSON.stringify(after),now()]);
 }
 private async execute(db:DB,ctx:PerformanceContext,b:any):Promise<Record<string,unknown>>{
  if(b.type==='export_handover'){
   const cycleId=requireValue(b.cycleId,'导出周期');
   const rows=(await db.query(`SELECT r.*,c.month,c.rules FROM performance_records r JOIN performance_cycles c ON c.id=r.cycle_id WHERE r.company_id=$1 AND r.cycle_id=$2 AND r.payroll_id=$3 AND r.stage IN ('ready','published','acknowledged') ORDER BY r.employee_id`,[ctx.companyId,cycleId,this.actor.id])).rows;
   if(!rows.length)fail('本周期没有本人可导出的已复核结果',409);
   // Defend spreadsheet formula injection in all free-text CSV fields.
   const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)&&typeof v!=='number')s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
   const table:unknown[][]=[['序号','部门','小组','姓名','职位','评价人','个人评分','上级评分','绩效等级','基准绩效系数','上级加减分项','其他邮件加减分项目','最终绩效系数','绩效评分明细','HR强制分布绩效等级','HRBP复核备注说明','最终绩效等级','月份','结果版本']];
   const records=rows.map(row=>{const r=recordFrom(row),result=resultFor(r,row.rules);table.push([table.length,r.departmentName||r.unitName,r.groupName||r.unitName,r.employeeName,r.position,r.managerName||'',result.selfScore,result.score,result.initialGrade,result.baseCoefficient,r.adjustments.filter(a=>a.category!=='other').reduce((n,a)=>n+a.points,0)/100,r.adjustments.filter(a=>a.category==='other').reduce((n,a)=>n+a.points,0)/100,result.finalCoefficient,r.assessmentReason||r.calibrationReason,r.hrGrade||result.finalGrade,r.hrRemark||'',result.finalGrade,row.month,r.version]);return {id:r.id,version:r.version};});
   await this.event(db,ctx,cycleId,'export_handover',0,null,{records});
   return {id:cycleId,message:'核算交接文件已生成',csv:'\uFEFF'+table.map(row=>row.map(cell).join(',')).join('\r\n'),records};
  }
  if(['save_asset','create_cycle','cycle_action','assign_record','create_from_preset'].includes(b.type)&&!ctx.admin)fail('需要绩效配置管理权限',403);
  if(b.type==='create_from_preset'){
   if(b.presetId!==workbookPreset.id||ctx.companyId!==workbookPreset.companyId)fail('该公司没有此Excel模板来源',404);
   const templateId=id(),rulesId=id();
   for(const [assetId,kind,data,name] of [[templateId,'template',workbookPreset.template,'安培时代月度绩效指标模板 V3.1'],[rulesId,'rules',workbookPreset.rules,'数字智能中心月度评分规则 V3.0']] as const){
    await db.query(`INSERT INTO performance_assets(id,company_id,kind,name,version,status,data,created_at,updated_at,created_by) VALUES($1,$2,$3,$4,1,'draft',$5,$6,$6,$7)`,[assetId,ctx.companyId,kind,name,JSON.stringify(data),now(),this.actor.id]);
    await this.event(db,ctx,assetId,'create_from_preset',1,null,{presetId:workbookPreset.id,sources:workbookPreset.sources,data});
   }
   return {id:templateId,rulesId,message:'Excel指标模板与评分规则已建立草稿；请核对异常后分别提交审批'};
  }
  if(b.type==='save_asset'){
   if(b.publish)fail('配置须先提交审批，通过后再独立发布',409);
   const kind=b.kind;if(!['template','rules'].includes(kind))fail('无效资产类型');
   const name=requireValue(b.name,'名称');
   if(kind==='rules')rulesValid(b.data);else templateValid(b.data);
   const assetId=b.id||id();const old=(await db.query('SELECT * FROM performance_assets WHERE id=$1 AND company_id=$2 FOR UPDATE',[assetId,ctx.companyId])).rows[0];
   if(b.id&&!old)fail('资产不存在',404);
   if(old&&(old.version!==b.expectedVersion||!assetActions(assetFrom(old),this.actor.id,ctx.admin).includes('edit')||old.kind!==kind))fail('当前配置不可编辑或版本已变化，请刷新后核对',409);
   const version=(old?.version??0)+1;
   // Preserve authenticated source provenance; a client cannot forge a workbook source.
   const origin=b.basedOnId?(await db.query("SELECT * FROM performance_assets WHERE id=$1 AND company_id=$2 AND kind=$3 AND status='published'",[b.basedOnId,ctx.companyId,kind])).rows[0]:null;if(b.basedOnId&&!origin)fail('修订来源不存在',404);const sourceData=old?.data||origin?.data;
   const data=kind==='template'?{...b.data,source:sourceData?.source,fields:sourceData?.fields,summaryFields:sourceData?.summaryFields,submissionRules:sourceData?.submissionRules,signatures:sourceData?.signatures}:{...b.data,source:sourceData?.source};
   await db.query(`INSERT INTO performance_assets(id,company_id,kind,name,version,status,data,created_at,updated_at,created_by,approval) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$7,$8,NULL) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,version=EXCLUDED.version,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at,created_by=EXCLUDED.created_by,approval=NULL`,[assetId,ctx.companyId,kind,name,version,JSON.stringify(data),now(),this.actor.id]);
   await this.event(db,ctx,assetId,'save_asset',version,old??null,data);
   return {id:assetId,version,message:'配置草稿已保存'};
  }
  if(b.type==='asset_action'){
   const row=(await db.query('SELECT * FROM performance_assets WHERE id=$1 AND company_id=$2 FOR UPDATE',[b.id,ctx.companyId])).rows[0];if(!row)fail('配置不存在或无权限',404);
   const asset=assetFrom(row);if(asset.version!==b.expectedVersion)fail('配置版本已变化，请刷新后重新核对',409);
   const action=b.action;if(!assetActions(asset,this.actor.id,ctx.admin).includes(action))fail('当前身份或状态不可执行此配置操作',403);
   let approval=asset.approval??null,status=asset.status;
   const reason=text(b.reason||'','审批意见');
   if(action==='submit'){
    if(asset.kind==='template'){
     templateValid(asset.data as PerformanceTemplate,true);
     const rule=(await db.query(`SELECT * FROM performance_assets WHERE id=$1 AND company_id=$2 AND kind='rules' AND status='published' FOR SHARE`,[b.rulesId,ctx.companyId])).rows[0];if(!rule?.approval||rule.approval.status!=='approved')fail('请选择已审批并发布的评分规则');
     if((asset.data as PerformanceTemplate).objectives.length>rule.data.maxObjectives)fail(`模板指标数量超过评分规则上限${rule.data.maxObjectives}项；请合并指标或先审批规则修订`);
    }else rulesValid(asset.data as PerformanceRules);
    const members=(await db.query(`${memberSql} AND m.company_id=$2`,[now(),ctx.companyId])).rows;
    if(!Array.isArray(b.reviewerIds)||b.reviewerIds.length!==2||b.reviewerIds.some((who:string)=>!members.some(p=>p.id===who)))fail('审批人须为本公司当前有效成员');
    approval=startAssetReview(asset,this.actor.id,b.reviewerIds.map((who:string)=>({id:who,name:members.find(p=>p.id===who)!.name})),now());
    if(asset.kind==='template'){const rule=(await db.query('SELECT * FROM performance_assets WHERE id=$1',[b.rulesId])).rows[0];approval.values.rulesId=rule.id;approval.values.rulesHash=assetDigest(assetFrom(rule));}
    status='reviewing';
   }else if(action==='approve'||action==='reject'){
    const members=(await db.query(`${memberSql} AND m.company_id=$2`,[now(),ctx.companyId])).rows;
    approval=decideAssetReview(asset,this.actor.id,action,reason,new Set(members.map(p=>p.id)),now());status=approval.status==='approved'?'approved':approval.status==='rejected'?'rejected':'reviewing';
   }else if(action==='withdraw'){
    approval=structuredClone(approval!);approval.status='withdrawn';approval.updatedAt=now();approval.tasks.forEach(t=>{if(['pending','waiting'].includes(t.status))t.status='cancelled';});status='draft';
   }else if(action==='publish'){
    if(approval?.status!=='approved'||approval.values.contentHash!==assetDigest(asset))fail('配置缺少对应版本的有效审批',409);
    status='published';
   }else fail('请基于此版本新建修订草稿');
   const version=asset.version+1;
   await db.query('UPDATE performance_assets SET status=$2,approval=$3,version=$4,updated_at=$5 WHERE id=$1',[asset.id,status,JSON.stringify(approval),version,now()]);
   await this.event(db,ctx,asset.id,`asset_${action}`,version,asset,{...asset,status,approval,version},reason);
   return {id:asset.id,version,message:({submit:'已提交部门负责人审核，之后交HRBP复核',approve:status==='approved'?'审批已通过，待申请人发布':'审核通过，已交下一审批人',reject:'已退回修改',withdraw:'已撤回审批',publish:'配置已发布'} as Record<string,string>)[action]};
  }
  if(b.type==='create_cycle'){
   const month=requireValue(b.month,'归属月份');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('月份须为YYYY-MM');
   const asset=async(assetId:string,kind:string)=>{const a=(await db.query('SELECT * FROM performance_assets WHERE id=$1 AND company_id=$2 AND kind=$3 AND status=\'published\'',[assetId,ctx.companyId,kind])).rows[0];if(!a||a.approval?.status!=='approved'||a.approval.values.contentHash!==assetDigest(assetFrom(a)))fail('周期必须引用已审批并发布的模板和规则');return a;};
   const template=await asset(requireValue(b.templateId,'模板'),'template'),rules=await asset(requireValue(b.rulesId,'规则'),'rules');rulesValid(rules.data);templateValid(template.data,true);if(template.data.objectives.length>rules.data.maxObjectives)fail('模板指标数量超过规则上限');if(template.approval.values.rulesHash&&template.approval.values.rulesHash!==assetDigest(assetFrom(rules)))fail('该模板审批时采用另一评分规则，请选择审批时的规则版本');
   const cycleId=id();const deadlines=b.deadlines||{};for(const value of Object.values(deadlines)){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail('截止时间无效');}
   await db.query('INSERT INTO performance_cycles VALUES($1,$2,$3,$4,\'draft\',1,$5,$6,$7,$8,$9,$10)',[cycleId,ctx.companyId,requireValue(b.name,'周期名称'),month,template.id,rules.id,JSON.stringify(template.data),JSON.stringify(rules.data),JSON.stringify(deadlines),now()]);
   await this.event(db,ctx,cycleId,'create_cycle',1,null,{month,templateId:template.id,rulesId:rules.id,deadlines});
   return {id:cycleId,message:'周期已创建为草稿'};
  }
  if(b.type==='assign_record'){
   const cycle=(await db.query('SELECT * FROM performance_cycles WHERE id=$1 AND company_id=$2 FOR UPDATE',[b.cycleId,ctx.companyId])).rows[0];if(!cycle||cycle.status!=='draft')fail('仅草稿周期可配置考核关系',409);
   const members=(await db.query(`${memberSql} AND m.company_id=$2`,[now(),ctx.companyId])).rows;
   const ids=['employeeId','managerId','departmentId','hrId','payrollId'];
   for(const field of ids)if(!members.some(p=>p.id===b[field]))fail('所有考核人员必须具有本公司当前有效成员关系');
   if(ids.slice(1).some(field=>b[field]===b.employeeId))fail('被考核人不能审核自己的绩效');
   const employee=members.find(p=>p.id===b.employeeId&&p.unitId===b.unitId);if(!employee)fail('请选择员工当前有效所属组织');
   const recordId=id();
   const record:PerformanceRecord={id:recordId,cycleId:cycle.id,companyId:ctx.companyId,employeeId:b.employeeId,employeeName:employee.name,unitId:employee.unitId,unitName:employee.unitName,position:employee.position,departmentName:employee.departmentName||employee.unitName,groupName:employee.unitName,managerName:members.find(p=>p.id===b.managerId)?.name||'',assessmentReason:'',hrGrade:null,hrRemark:'',vetoReason:'',managerId:b.managerId,departmentId:b.departmentId,hrId:b.hrId,payrollId:b.payrollId,stage:'plan',version:1,objectives:cycle.template.objectives.map((o:any)=>({id:id(),annualGoal:o.annualGoal||'',annualWeight:o.annualWeight,annualProgress:o.annualProgress||'',notes:o.notes||'',title:o.title,weight:o.weight??0,definition:o.definition,standard:o.standard,actions:o.actions||'',actual:'',evidence:'',selfScore:null,managerScore:null,managerComment:''})),adjustments:[],calibratedGrade:null,calibrationReason:'',meeting:'',dispute:'',resolution:'',updatedAt:now()};
   const exists=(await db.query('SELECT 1 FROM performance_records WHERE cycle_id=$1 AND employee_id=$2',[cycle.id,b.employeeId])).rowCount;if(exists)fail('该员工已在本周期中',409);
   await db.query('INSERT INTO performance_records VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11)',[recordId,cycle.id,ctx.companyId,b.employeeId,b.managerId,b.departmentId,b.hrId,b.payrollId,'plan',JSON.stringify(record),now()]);
   await this.event(db,ctx,cycle.id,'assign_record',1,null,{recordId,employeeId:b.employeeId,managerId:b.managerId,departmentId:b.departmentId,hrId:b.hrId,payrollId:b.payrollId});
   return {id:recordId,message:'考核关系已登记'};
  }
  if(b.type==='cycle_action'){
   const row=(await db.query('SELECT * FROM performance_cycles WHERE id=$1 AND company_id=$2 FOR UPDATE',[b.id,ctx.companyId])).rows[0];if(!row)fail('周期不存在',404);if(row.version!==b.expectedVersion)fail('周期版本已变化，请刷新',409);
   const records=(await db.query('SELECT * FROM performance_records WHERE cycle_id=$1 FOR UPDATE',[row.id])).rows;
   let next=row.status;
   if(b.action==='activate'){if(row.status!=='draft'||!records.length)fail('请先配置至少一名参评人员',409);const assets=(await db.query('SELECT * FROM performance_assets WHERE id IN ($1,$2) AND company_id=$3 FOR SHARE',[row.template_id,row.rules_id,ctx.companyId])).rows;if(assets.length!==2||assets.some(a=>a.status!=='published'||a.approval?.status!=='approved'||a.approval.values.contentHash!==assetDigest(assetFrom(a))))fail('周期缺少已审批发布的模板或规则，请核对配置后新建周期',409);next='active';}
   else if(b.action==='archive'){if(row.status!=='active'||records.some(r=>r.stage!=='acknowledged'))fail('全部员工知悉且无待处理异议后才能归档',409);next='archived';}
   else if(b.action==='release'){
    if(row.status!=='active'||!records.some(r=>r.stage==='ready'))fail('没有可发布的核算复核结果',409);
    for(const r of records.filter(r=>r.stage==='ready')){const data=recordFrom(r);data.stage='published';data.version++;data.updatedAt=now();await db.query('UPDATE performance_records SET stage=$2,version=$3,data=$4,updated_at=$5 WHERE id=$1',[r.id,data.stage,data.version,JSON.stringify(data),data.updatedAt]);await this.event(db,ctx,r.id,'release',data.version,r.data,data);}
   }else fail('未知周期动作');
   await db.query('UPDATE performance_cycles SET status=$2,version=version+1 WHERE id=$1',[row.id,next]);
   await this.event(db,ctx,row.id,b.action,row.version+1,{status:row.status},{status:next});return {id:row.id,message:b.action==='release'?'已发布通过核算复核的结果；未发送邮件':'周期状态已更新'};
  }
  if(b.type==='save_record'||b.type==='record_action'){
   const {record:r,cycle}=await this.load(db,requireValue(b.id,'绩效单'),ctx.companyId,true);
   if(r.version!==b.expectedVersion)fail('绩效单已被修改，请刷新后重新核对',409);if(cycle.status!=='active')fail('周期未启动或已归档',409);
   const before=structuredClone(r);
   if(b.type==='save_record'){
    const section=b.section;if(!editsFor(r,this.actor.id).includes(section))fail('当前身份或环节不可编辑',403);
    if(section==='plan'){
     r.adjustments=[];r.calibratedGrade=null;r.calibrationReason='';r.hrGrade=null;r.hrRemark='';r.vetoReason='';
     if(!Array.isArray(b.objectives)||b.objectives.length>cycle.rules.maxObjectives)fail('指标数量超过配置上限');
     const seen=new Set<string>();
     r.objectives=b.objectives.map((o:any):PerformanceObjective=>{
      const oid=o.id?requireValue(o.id,'指标标识'):id();if(seen.has(oid))fail('指标标识重复');seen.add(oid);
      if(!Number.isFinite(o.weight)||o.weight<0||o.weight>100||o.annualWeight!==undefined&&(!Number.isFinite(o.annualWeight)||o.annualWeight<0||o.annualWeight>100))fail('权重须为0–100');
      return {id:oid,annualGoal:text(o.annualGoal,'年度目标'),annualWeight:o.annualWeight===undefined?undefined:Number(o.annualWeight),notes:text(o.notes||'','备注'),annualProgress:text(o.annualProgress,'累计达成'),title:text(o.title,'月度目标'),weight:o.weight,definition:text(o.definition,'指标定义'),actions:text(o.actions,'关键动作'),standard:text(o.standard,'评分标准'),actual:'',evidence:'',selfScore:null,managerScore:null,managerComment:''};
     });
    } else if(section==='self'||section==='manager'){
     if(!Array.isArray(b.objectives)||b.objectives.length!==r.objectives.length||new Set(b.objectives.map((o:any)=>o.id)).size!==r.objectives.length)fail('指标列表已变化');
     r.objectives=r.objectives.map(o=>{const p=b.objectives.find((v:any)=>v.id===o.id);if(!p)fail('指标已变化');const score=p[section==='self'?'selfScore':'managerScore'];if(score!==null&&(!Number.isFinite(score)||score<0||score>100))fail('评分须为0–100或留空');return section==='self'?{...o,actual:text(p.actual,'完成情况'),evidence:text(p.evidence,'证据链接与说明'),selfScore:score}:{...o,managerScore:score,managerComment:text(p.managerComment,'评分说明')};});
     if(section==='manager'){r.adjustments=adjustmentsFrom(b.adjustments??r.adjustments,cycle.rules);r.assessmentReason=text(b.assessmentReason??r.assessmentReason??'','绩效评分明细');r.vetoReason=text(b.vetoReason??r.vetoReason??'','否决事实');}
     if(section==='self'){r.objectives=r.objectives.map(o=>({...o,managerScore:null,managerComment:''}));r.adjustments=[];r.calibratedGrade=null;r.calibrationReason='';r.hrGrade=null;r.hrRemark='';r.vetoReason='';}
    } else if(section==='hr'){
     r.hrGrade=b.hrGrade?requireValue(b.hrGrade,'HR最终等级'):null;r.hrRemark=text(b.hrRemark||'','HRBP复核备注');if(r.hrGrade&&(!cycle.rules.bands.some(g=>g.grade===r.hrGrade)||!r.hrRemark))fail('HR等级调整须有效并填写复核说明');
    } else {
     r.assessmentReason=text(b.assessmentReason||'','绩效评分明细');r.vetoReason=text(b.vetoReason||'','否决事实');
     r.adjustments=adjustmentsFrom(b.adjustments,cycle.rules);
     r.calibratedGrade=b.calibratedGrade?requireValue(b.calibratedGrade,'校准等级'):null;r.calibrationReason=text(b.calibrationReason||'','校准理由');
     if(r.calibratedGrade&&(!cycle.rules.bands.some(g=>g.grade===r.calibratedGrade)||!r.calibrationReason))fail('校准等级须有效并填写理由');
    }
   } else {
    const reason=text(b.reason||'','操作理由');r.stage=transition(r,b.action,this.actor.id,cycle,reason);
    if(b.action==='return'&&['self','manager'].includes(r.stage)){r.adjustments=[];r.calibratedGrade=null;r.calibrationReason='';r.hrGrade=null;r.hrRemark='';r.vetoReason='';}
    if(b.action==='dispute')r.dispute=reason;
    if(b.action==='resolve_dispute')r.resolution=reason;
    if(b.action==='save_meeting')r.meeting=reason;
   }
   r.version++;r.updatedAt=now();
   await db.query('UPDATE performance_records SET stage=$2,version=$3,data=$4,updated_at=$5 WHERE id=$1',[r.id,r.stage,r.version,JSON.stringify(r),r.updatedAt]);
   await this.event(db,ctx,r.id,b.type==='save_record'?`save_${b.section}`:b.action,r.version,before,r,b.reason||'');
   return {id:r.id,version:r.version,message:b.type==='save_record'?'草稿已保存':'操作已完成'};
  }
  return fail('未知绩效命令');
 }
}
