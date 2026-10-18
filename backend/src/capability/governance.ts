import {createHash,randomUUID} from 'node:crypto';
import {postgresConnection,postgresTransaction} from '../postgres/pool.js';
import {HttpFail} from '../host/errors.js';
import type {TicketPrincipal} from '../ticket-domain/auth.js';
import type {Json} from '../types.js';
import {getConnectorConfig,getToolPolicy} from '../runtime/store.js';
import {publishedOperationCatalog,type OperationDb,type OperationDocument} from './catalog.js';
import {loadOperationContracts,operationFingerprint,validateOperationCatalog,type OperationContract} from './contracts.js';

const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)])):v;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const now=()=>new Date().toISOString();
const text=(v:unknown,label:string,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new HttpFail(422,`请填写有效${label}`);return v.trim();};
const number=(v:unknown,min=0)=>{if(!Number.isSafeInteger(v)||Number(v)<min)throw new HttpFail(422,'版本必须是有效整数');return Number(v);};
const identity=(body:Record<string,unknown>)=>({id:text(body.id,'能力标识',100),version:number(body.version,1)});
type Inspector=(actor:string,connector:string)=>Promise<Json[]>;
type Command={id:string;version:number;expectedRevision:number;action:string;targetVersion?:string};
export class OperationGovernance {
  constructor(private actor:TicketPrincipal,private inspect:Inspector=async(userId,connector)=>{
    const {inspectConnectorTools}=await import('../runtime/execution.js');
    return inspectConnectorTools({userId,agentId:'',skillId:'',runId:'capability-publication-check'},connector);
  }){}
  private admin(){if(!this.actor.active||!this.actor.roles.includes('admin'))throw new HttpFail(403,'需要能力治理管理权限');}
  private async lock(db:OperationDb){await db.query("SELECT pg_advisory_xact_lock(hashtextextended('capability-operation-governance',0))");}
  private async document(db:OperationDb,id:string,version:number){return (await db.query<OperationDocument>('SELECT * FROM capability_operation_documents WHERE id=$1 AND version=$2',[id,version])).rows[0];}
  private baseline(id:string,version:number){return loadOperationContracts().operations.find(o=>o.id===id&&o.version===version)||null;}
  private valid(value:unknown):OperationContract {
    if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>128000)throw new HttpFail(422,'能力定义无效或过大');
    const op=value as OperationContract;
    const allowed=['id','version','name','description','effect','risk','asynchronous','inputSchema','result','implementation'];
    const implementation=['connector','tool','version','jsonArgument','inputFields','topLevelFields'];
    if(Object.keys(op).some(k=>!allowed.includes(k))||!op.implementation||Object.keys(op.implementation).some(k=>!implementation.includes(k)))throw new HttpFail(422,'仅允许能力契约及字段映射；地址和凭据请在连接器中维护');
    try{validateOperationCatalog({version:1,operations:[op]});}catch{throw new HttpFail(422,'能力标识、风险、schema或字段映射无效');}
    return structuredClone(op);
  }
  private async consumers(id:string,version:number){
    const {taskDefinitions}=await import('../tasks/registry.js');
    return (await taskDefinitions()).filter(skill=>skill.capabilities?.some(ref=>ref.id===id&&ref.version===version)).map(skill=>({id:skill.id,title:skill.title,optional:skill.capabilities!.find(ref=>ref.id===id&&ref.version===version)!.optional===true}));
  }
  async list(){
    this.admin();const db=postgresConnection(),baseline=loadOperationContracts();
    const rows=(await db.query<OperationDocument>('SELECT * FROM capability_operation_documents ORDER BY id,version')).rows;
    const keys=new Map(baseline.operations.map(o=>[`${o.id}@${o.version}`,{id:o.id,version:o.version}]));
    for(const row of rows)keys.set(`${row.id}@${row.version}`,row);
    const {taskDefinitions}=await import('../tasks/registry.js'),definitions=await taskDefinitions();
    return {operations:[...keys.values()].map(key=>{
      const row=rows.find(r=>r.id===key.id&&r.version===key.version),base=this.baseline(key.id,key.version);
      return {id:key.id,version:key.version,revision:row?.revision||0,draft:row?.draft||null,published:row?.published||base,
        status:row?.disabled?'disabled':row?.published?'published':base?'bundled_baseline':'draft',updated_at:row?.updated_at||null,used_by:definitions.filter(skill=>skill.capabilities?.some(ref=>ref.id===key.id&&ref.version===key.version)).map(skill=>({id:skill.id,title:skill.title,optional:skill.capabilities!.find(ref=>ref.id===key.id&&ref.version===key.version)!.optional===true}))};
    })};
  }
  async history(id:string,version:number){this.admin();text(id,'能力标识',100);number(version,1);return {versions:(await postgresConnection().query('SELECT receipt_id,id,version,revision,action,definition,actor,reason,created_at FROM capability_operation_versions WHERE id=$1 AND version=$2 ORDER BY revision DESC LIMIT 100',[id,version])).rows};}
  async save(body:Record<string,unknown>){
    this.admin();const operation=this.valid(body.definition),expected=number(body.expectedRevision),reason=text(body.reason,'变更原因');
    return postgresTransaction(async db=>{
      await this.lock(db);const current=await this.document(db,operation.id,operation.version);
      if((current?.revision||0)!==expected)throw new HttpFail(409,'草稿版本已变化，请刷新');
      const revision=expected+1;
      await db.query(`INSERT INTO capability_operation_documents(id,version,revision,draft,updated_at) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id,version) DO UPDATE SET revision=$3,draft=$4,updated_at=$5`,[operation.id,operation.version,revision,JSON.stringify(operation),now()]);
      await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[now(),this.actor.id,'capability.draft.saved',JSON.stringify({id:operation.id,version:operation.version,revision,reason,definition_hash:digest(operation)})]);
      return {id:operation.id,version:operation.version,revision,status:'draft'};
    });
  }
  private async target(db:OperationDb,command:Command,current?:OperationDocument):Promise<OperationContract|null>{
    if(command.action==='disable'){if(!current?.published&&!this.baseline(command.id,command.version))throw new HttpFail(404,'没有可停用的正式能力');return null;}
    if(command.action==='publish'){if(!current?.draft)throw new HttpFail(409,'请先保存能力草稿');return this.valid(current.draft);}
    if(command.action==='restore'){
      const previous=(await db.query('SELECT definition FROM capability_operation_versions WHERE receipt_id=$1 AND id=$2 AND version=$3 AND action IN (\'publish\',\'restore\')',[command.targetVersion,command.id,command.version])).rows[0];
      if(!previous?.definition)throw new HttpFail(404,'未找到同一能力协议版本的发布历史');return this.valid(previous.definition);
    }
    throw new HttpFail(422,'不支持的能力治理动作');
  }
  private async readiness(db:OperationDb,target:OperationContract){
    const binding=target.implementation;
    const connector=(await db.query('SELECT id,enabled FROM connectors WHERE id=$1',[binding.connector])).rows[0];
    const config=await getConnectorConfig(binding.connector),policy=await getToolPolicy(binding.connector,binding.tool);
    if(Number(connector?.enabled)!==1||!config||Number(policy?.enabled)!==1||!policy?.schema_hash)throw new HttpFail(409,'连接器或已审核工具尚未就绪，请先在连接器中配置');
    const ranks:Record<string,number>={R1:1,R2:2,R3:3,L1:1,L2:2,L3:3};
    if(!ranks[String(policy.risk)]||ranks[target.risk]<ranks[String(policy.risk)]||(target.effect==='read'&&policy.access!=='read'))throw new HttpFail(409,'能力声明不能降低已审核工具的风险或把写入声明为只读');
    return {connector:binding.connector,tool:binding.tool,config_version:config.version,policy_version:policy.version,schema_hash:policy.schema_hash};
  }
  private async state(db:OperationDb,command:Command){
    const current=await this.document(db,command.id,command.version);
    if((current?.revision||0)!==command.expectedRevision)throw new HttpFail(409,'定义已变化，请重新读取并确认');
    const next=await this.target(db,command,current),previous=current?.published||this.baseline(command.id,command.version);
    if(next&&command.action==='publish'&&previous){
      const publicResult=(op:OperationContract)=>op.result?{kind:op.result.kind,fields:Object.keys(op.result.itemFields).sort()}:null;
      if(digest([next.inputSchema,publicResult(next),next.effect,next.risk,next.asynchronous])!==digest([previous.inputSchema,publicResult(previous),previous.effect,previous.risk,previous.asynchronous]))throw new HttpFail(409,'公开参数、结果或执行语义发生变化，请注册新的能力协议版本');
      if(digest([next.implementation,next.result])!==digest([previous.implementation,previous.result])&&next.implementation.version<=previous.implementation.version)throw new HttpFail(409,'实现映射已变化，请递增实现版本');
    }
    const dependency=next?await this.readiness(db,next):null;
    const catalog=await publishedOperationCatalog(db);
    if(next)validateOperationCatalog({version:1,operations:[...catalog.operations.filter(o=>o.id!==next.id||o.version!==next.version),next]});
    return {current,next,previous,dependency,fingerprint:digest([command,current||null,next,dependency,operationFingerprint(loadOperationContracts().operations)])};
  }
  async prepare(body:Record<string,unknown>){
    this.admin();const command:Command={...identity(body),expectedRevision:number(body.expectedRevision),action:text(body.action,'动作',20),...(body.targetVersion?{targetVersion:text(body.targetVersion,'历史版本',100)}:{})};
    return postgresTransaction(async db=>{
      await this.lock(db);const state=await this.state(db,command);
      if(state.next){
        const tools=await this.inspect(this.actor.id,state.next.implementation.connector),tool=tools.find(t=>t.name===state.next!.implementation.tool);
        if(!tool||tool.schema_hash!==state.dependency!.schema_hash)throw new HttpFail(409,'上游工具schema与已审核版本不一致，请先刷新并审核工具');
        const {runtimeToolPresentation}=await import('../runtime/action-gates.js');
        const presented=runtimeToolPresentation(state.next.implementation.connector,tool);
        if(!presented)throw new HttpFail(409,'工具尚不具备受支持的运行范围契约');
        const mode=(presented._meta as Json|undefined)?.execution_mode;
        if(state.next.asynchronous!==(mode==='async_job'))throw new HttpFail(409,'异步声明必须与已有作业契约一致；请先接入进度、取消和恢复机制');
        const annotations=tool.annotations as Json|undefined;
        if(state.next.effect==='read'&&(annotations?.readOnlyHint===false||annotations?.destructiveHint===true))throw new HttpFail(409,'上游工具声明与只读能力冲突，请先复核工具风险');
        const schema=tool.inputSchema as Json,properties=schema?.properties as Json||{};
        const mapping=state.next.implementation;
        const fields=mapping.jsonArgument?[mapping.jsonArgument,...(mapping.topLevelFields||[]).map(k=>mapping.inputFields![k])]:Object.values(mapping.inputFields||Object.fromEntries(Object.keys(state.next.inputSchema?.properties as object||{}).map(k=>[k,k])));
        if(fields.some(k=>!Object.hasOwn(properties,k))||(Array.isArray(schema.required)&&schema.required.some(k=>!fields.includes(String(k)))))throw new HttpFail(409,'字段映射无法满足已审核上游工具参数');
      }
      const token=randomUUID(),expiresAt=new Date(Date.now()+5*60_000).toISOString();
      await db.query('INSERT INTO capability_operation_confirmations(token,actor,command,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5)',[token,this.actor.id,JSON.stringify(command),state.fingerprint,expiresAt]);
      return {token,expiresAt,action:command.action,id:command.id,version:command.version,revision:command.expectedRevision,previous:state.previous,next:state.next,dependency:state.dependency,used_by:await this.consumers(command.id,command.version),notice:'此为平台级执行配置。能力发布不授予人员、Agent或工具使用权限；已固定旧指纹的Agent需通过原发布流程升级。'};
    });
  }
  async commit(body:Record<string,unknown>){
    this.admin();const token=text(body.token,'确认标识',100),commandId=text(body.commandId,'幂等标识',100),reason=text(body.reason,'变更原因');
    if(body.confirmed!==true)throw new HttpFail(409,'能力生效操作必须明确确认');const commandHash=digest([token,reason,true]);
    return postgresTransaction(async db=>{
      await this.lock(db);
      const prior=(await db.query('SELECT * FROM capability_operation_versions WHERE actor=$1 AND command_id=$2',[this.actor.id,commandId])).rows[0];
      if(prior){if(prior.command_hash!==commandHash)throw new HttpFail(409,'幂等标识已用于其它确认');return {id:prior.receipt_id,revision:prior.revision,action:prior.action};}
      const confirmation=(await db.query('SELECT * FROM capability_operation_confirmations WHERE token=$1 AND actor=$2 FOR UPDATE',[token,this.actor.id])).rows[0];
      if(!confirmation||confirmation.consumed||confirmation.expires_at<now())throw new HttpFail(409,'确认已失效，请重新核对');
      const command=confirmation.command as Command,state=await this.state(db,command);
      if(state.fingerprint!==confirmation.fingerprint)throw new HttpFail(409,'依赖配置已变化，请重新核对');
      const revision=command.expectedRevision+1,time=now(),receipt=randomUUID(),definition=state.next;
      await db.query(`INSERT INTO capability_operation_documents(id,version,revision,published,disabled,updated_at,draft) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id,version) DO UPDATE SET revision=$3,published=$4,disabled=$5,updated_at=$6,draft=$7`,[command.id,command.version,revision,JSON.stringify(definition||state.previous),command.action==='disable',time,command.action==='publish'?null:state.current?.draft?JSON.stringify(state.current.draft):null]);
      await db.query('INSERT INTO capability_operation_versions(receipt_id,id,version,revision,action,definition,actor,reason,command_id,command_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[receipt,command.id,command.version,revision,command.action,definition?JSON.stringify(definition):null,this.actor.id,reason,commandId,commandHash,time]);
      await db.query('UPDATE capability_operation_confirmations SET consumed=true WHERE token=$1',[token]);
      await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',[time,this.actor.id,'capability.version.'+command.action,JSON.stringify({receipt,id:command.id,version:command.version,revision,definition_hash:digest(definition),dependency:state.dependency})]);
      return {id:receipt,revision,action:command.action};
    });
  }
}
