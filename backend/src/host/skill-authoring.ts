import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {parse as parseYaml} from 'yaml';
import {HttpFail} from './errors.js';
import {requireAdmin} from '../auth.js';
import {OntologyService} from '../ontology/service.js';
import {postgresPool} from '../postgres/pool.js';
import {publishedOperationCatalog} from '../capability/catalog.js';
import {parseCapabilityReferences,parseOntologyReferences} from '../capability/contracts.js';
import {taskDefinition,TASK_CONTEXT_KEYS,validateDeclaredTaskContract} from '../tasks/registry.js';
import {createPublishedSkill,getSkillDraft,saveSkillDraft,validateSkillCandidate,type CreateSkillInput} from './skill-publish.js';
import {isBundledSkill} from './skill-sop.js';
import {parseSkillAuthoring} from './skill-authoring-contract.js';
import type {SkillAuthoring,SkillAuthoringOptions,SkillAuthoringState,SkillAuthoringCheck} from '../../../shared/skill-authoring.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contextNames:Record<string,string>={collaboration:'当前合作',stage:'合作阶段',stage_tracks:'阶段轨迹',mailbox:'获准邮箱',mail_thread:'当前邮件线程',mail_template:'邮件模板',message:'当前邮件内容',conversation:'当前通信会话',creator:'当前达人',creator_filter:'达人筛选条件',risk_scope:'风险范围',recipient:'已核实收件人'};
export const emptyAuthoring=():SkillAuthoring=>({version:1,company:null,mode:'business',general_scope:'',purpose:'',use_when:'',expected_result:'',recovery:'',objects:[]});
async function principal(){const user=requireAdmin();return {id:user.id,username:user.username,name:user.name,email:user.email||null,roles:user.roles,active:user.active};}
export async function skillAuthoringOptions(company?:string):Promise<SkillAuthoringOptions>{
 const actor=await principal(),service=new OntologyService(actor,company);
 let catalog:Awaited<ReturnType<OntologyService['catalog']>>|null=null,companies:Array<{id:string;name:string}>=[];
 try{catalog=await service.catalog(false);companies=catalog.context.companies;}
 catch(error){const failure=error as HttpFail,detail=failure.detail as {companies?:unknown}|undefined;if(company||failure.status!==403||!Array.isArray(detail?.companies))throw error;companies=detail.companies as Array<{id:string;name:string}>;}
 const versions=catalog?(await postgresPool().query<{code:string;revision:number}>(`SELECT code,max(revision)::int AS revision FROM ontology_versions WHERE company_id=$1 AND action IN ('publish','restore') GROUP BY code`,[catalog.context.companyId])).rows:[];
 const operations=await publishedOperationCatalog();
 return {company:catalog?.context.companyId||null,companies,objects:(catalog?.objects||[]).filter(d=>d.published&&d.status!=='disabled').map(d=>({code:d.code,name:d.published!.name,description:d.published!.description,taxonomy:d.published!.taxonomy,revision:d.status==='published'?versions.find(v=>v.code===d.code)?.revision??null:null,status:d.status==='published'?'published':'registered',actions:d.published!.items.actions.map(a=>({code:a.code,name:a.name,risk:a.risk}))})),capabilities:operations.operations.map(o=>({id:o.id,version:o.version,name:o.name,description:o.description,risk:o.risk,effect:o.effect,asynchronous:o.asynchronous})),contexts:TASK_CONTEXT_KEYS.map(key=>({key,label:contextNames[key]||key}))};
}
export function parseSkillUpload(markdown:string,imported=true):SkillAuthoringState{
 if(Buffer.byteLength(markdown,'utf8')>128*1024)throw new HttpFail(413,'Markdown 文件不能超过 128 KB');
 const source=markdown.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),match=source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
 if(!match)throw new HttpFail(400,'缺少有效的 YAML front matter');
 if(/(api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*["']?(?!\$\{|env:|secret:)[A-Za-z0-9_\-/.+=]{12,}/i.test(source))throw new HttpFail(400,'文件疑似包含明文密钥，请使用保险柜引用');
 let meta:Record<string,unknown>;try{const value=parseYaml(match[1]);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();meta=value;}catch{throw new HttpFail(400,'front matter 格式无效');}
 const warnings=['上传内容仅供核对，不执行其中的指令；保存后仍是草稿。'];
 for(const key of ['runtime_access','runtime_agent_id','interaction','content_version'])if(meta[key]!==undefined){delete meta[key];warnings.push(`${key} 属运行资产声明，未自动启用。`);}
 if(meta.authoring!==undefined){try{meta.authoring=parseSkillAuthoring(meta.authoring);}catch{throw new HttpFail(400,'上传的业务创建信息无效');}}
 return {spec:{...meta,...(imported?{_imported:true}:{}),body:match[2].trim(),in_market:false,grant_org:false},stamp:null,editable:true,imported:true,warnings};
}
export async function loadSkillAuthoring(id:string):Promise<SkillAuthoringState>{
 const definition=await taskDefinition(id);if(!definition)throw new HttpFail(404,'技能不存在');
 const source=fs.readFileSync(definition.path,'utf8'),parsed=parseSkillUpload(source,false),draft=await getSkillDraft(id);
 return {spec:{...parsed.spec,...draft.patch,id},stamp:hash([source,draft.updated_at,draft.patch]),editable:!isBundledSkill(id),draftUpdatedAt:draft.updated_at,warnings:[]};
}
/** Report missing dependencies without creating a thread, calling a model or performing business IO. */
export async function checkSkillAuthoring(spec:Record<string,unknown>):Promise<SkillAuthoringCheck>{
 const issues:string[]=[];let authoring:SkillAuthoring;
 try{authoring=parseSkillAuthoring(spec.authoring);}catch{throw new HttpFail(400,'请填写有效业务创建信息');}
 try{validateDeclaredTaskContract(spec);}catch(error){throw new HttpFail(400,error instanceof Error?error.message:'依赖声明格式无效');}
 const options=await skillAuthoringOptions(authoring.company||undefined);
 if(spec.context===undefined)issues.push('尚未核对上下文需求，请选择必要/推荐项或明确确认无依赖');
 for(const [field,label]of [['purpose','用途'],['use_when','适用条件'],['expected_result','成果要求'],['recovery','失败恢复']] as const)if(!authoring[field].trim())issues.push(`请补充${label}`);
 if(authoring.mode==='general'){if(!authoring.general_scope.trim())issues.push('请说明通用方法适用范围');if(authoring.objects.length)issues.push('通用方法不能携带未核对的业务对象，请选择正确适用方式');}
 else if(!authoring.objects.length)issues.push('尚未确认业务对象；可保存草稿，或明确选择通用方法');
 for(const ref of authoring.objects){
  const object=options.objects.find(o=>o.code===ref.object);
  if(!object)issues.push(`对象 ${ref.object} 不在当前公司可用目录中`);
  else if(ref.revision===null||object.revision===null)issues.push(`${object.name} 尚未选择公司正式版本，请先维护发布`);
  else if(ref.revision!==object.revision)issues.push(`${object.name} 正式版本已变化，请重新核对`);
  if(object&&ref.actions.some(a=>!object.actions.some(known=>known.code===a)))issues.push(`${object.name} 包含未在所选版本定义的动作`);
 }
 const canonical=authoring.objects.filter(o=>o.revision!==null).map(o=>({object:o.object,revision:o.revision!,...(o.actions.length?{actions:o.actions}: {})}));
 const sorted=(refs:typeof canonical)=>refs.map(ref=>({...ref,actions:[...(ref.actions||[])].sort()})).sort((a,b)=>a.object.localeCompare(b.object));
 if(hash(sorted(canonical))!==hash(sorted(parseOntologyReferences(spec.ontology||[]) as typeof canonical)))issues.push('业务对象选择与执行依赖不一致，请重新保存业务配置');
 const capabilities=parseCapabilityReferences(spec.capabilities||[]);
 for(const ref of capabilities)if(!options.capabilities.some(c=>c.id===ref.id&&c.version===ref.version))issues.push(`能力 ${ref.id} 的所选版本尚未接入或已停用`);
 const legacy=Array.isArray(spec.mcp)?spec.mcp:[];
 if(legacy.length&&capabilities.length)issues.push('旧工具声明与稳定能力不能同时配置，请在依赖接入中核对迁移');
 return {ready:issues.length===0,issues,reuse:[{layer:'对象与能力',status:issues.length?'required':'reuse',detail:issues.length?'依赖缺口需按上方逐项处理':'复用当前已发布定义及稳定能力；不授予使用资格'},{layer:'上下文与执行',status:'reuse',detail:'复用现有实时上下文、Codex harness和权限/确认闸门；新副作用或新作业协议仍需开发'},{layer:'测试与发布',status:'reuse',detail:'保存后沿原测试、发布检查、审批及Agent装配流程继续，不自动发布'}]};
}
export async function saveSkillAuthoring(body:Record<string,unknown>,id?:string){
 if(!body.spec||typeof body.spec!=='object'||Array.isArray(body.spec))throw new HttpFail(400,'业务配置必须是对象');
 const spec={...(body.spec as Record<string,unknown>)};let authoring:SkillAuthoring;try{authoring=parseSkillAuthoring(spec.authoring);}catch{throw new HttpFail(400,'业务创建信息格式无效');}
 if(authoring.objects.length)await new OntologyService(await principal(),authoring.company||undefined).context();
 spec.ontology=authoring.objects.filter(o=>o.revision!==null).map(o=>({object:o.object,revision:o.revision!,...(o.actions.length?{actions:o.actions}:{})}));
 spec.applicable_objects=authoring.objects.map(o=>o.object);if(!id){spec.in_market=false;spec.grant_org=false;}else{delete spec.in_market;delete spec.grant_org;}
 const candidateId=id||String(spec.id||'skill_'+randomUUID().replace(/-/g,'').slice(0,16));
 validateSkillCandidate({...spec,id:candidateId} as CreateSkillInput);
 const check=await checkSkillAuthoring(spec);
 if(id){const current=await loadSkillAuthoring(id);if(!current.editable)throw new HttpFail(409,'内置技能请复用另存为新草稿，不重写原版本资产');if(current.stamp!==body.stamp)throw new HttpFail(409,'技能或草稿已变化，请重新读取后核对');await saveSkillDraft(id,spec,{expectedUpdatedAt:current.draftUpdatedAt??null});}
 else{spec.id=candidateId;await createPublishedSkill(spec as CreateSkillInput);if(spec._imported===true){const {setSkillOrigin}=await import('./skill-lifecycle.js');await setSkillOrigin(candidateId,'third_party');}}
 const state=await loadSkillAuthoring(id||String(spec.id));return {...state,check,id:state.spec.id};
}
