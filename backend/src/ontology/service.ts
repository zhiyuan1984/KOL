import {syncOrganizationObjects} from './organization-links.js';
import {relevance,scopeSettings,scopeOptions,saveScope,feedback,maintenanceRequests} from './relevance.js';
import { enterpriseTaxonomy, enterpriseSource, enterpriseHash } from './enterprise.js';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { OntologyCatalog, OntologyConfirmation, OntologyContext, OntologyDefinition, OntologyDocument, OntologyReceipt, OntologyVersion } from '../../../shared/ontology.js';
import type { TicketPrincipal } from '../ticket-domain/auth.js';
import { postgresPool, postgresTransaction } from '../postgres/pool.js';
import { HttpFail } from '../host/errors.js';
import { employeeDefinition, loadOntologyCatalog, validateDefinition } from './catalog.js';

type DB={query:PoolClient['query']};
type DocumentRow=QueryResultRow & {code:string;revision:number;draft:OntologyDefinition|null;published:OntologyDefinition|null;disabled:boolean;updated_at:string};
const now=()=>new Date().toISOString();
const digest=(body:unknown)=>createHash('sha256').update(JSON.stringify(body)).digest('hex');
const string=(v:unknown,label:string,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new HttpFail(422,`请填写有效${label}`);return v.trim();};
const revision=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<0)throw new HttpFail(422,'预期版本无效');return Number(v);};
const members=`SELECT DISTINCT m.company_id AS id FROM organization_people p
 JOIN users u ON u.id=p.user_id AND u.active=1
 JOIN organization_memberships m ON m.person_ref=p.person_ref
 JOIN organization_units ou ON ou.id=m.org_unit_id AND ou.company_id=m.company_id
 WHERE p.user_id=$1 AND p.status='active' AND m.status='active' AND ou.status='active'
 AND (m.effective_from IS NULL OR m.effective_from<=$2) AND (m.effective_to IS NULL OR m.effective_to>$2)`;

export class OntologyService {
  constructor(private actor:TicketPrincipal,private company?:string){}
  async context(db:DB=postgresPool(),admin=false):Promise<OntologyContext>{
    if(!this.actor.active)throw new HttpFail(403,'账号已停用');
    if(admin&&!this.actor.roles.includes('admin'))throw new HttpFail(403,'需要本体治理管理权限');
    const companies=(await db.query<{id:string}>(members,[this.actor.id,now()])).rows.map(r=>({id:r.id,name:r.id}));
    const companyId=this.company||(companies.length===1?companies[0].id:'');
    if(!companies.some(c=>c.id===companyId))throw new HttpFail(403,{message:'请选择本人当前有效组织所属公司',companies});
    return {companyId,companies,admin:this.actor.roles.includes('admin')};
  }
  async catalog(admin=false):Promise<OntologyCatalog>{
    const context=await this.context(postgresPool(),admin);
    const baseline=loadOntologyCatalog();
    const stored=(await postgresPool().query<{definition:OntologyDefinition}>('SELECT definition FROM ontology_catalog_objects WHERE source_version=$1',[enterpriseHash()])).rows;
    const bases=stored.length?stored.map(r=>baseline.objects.find(o=>o.code===r.definition.code)||r.definition):baseline.objects;
    const enterpriseCodes=new Set(enterpriseSource().objects.map(o=>o.code));
    const rows=(await postgresPool().query<DocumentRow>('SELECT * FROM ontology_documents WHERE company_id=$1',[context.companyId])).rows;
    const codes=[...new Set([...bases.map(o=>o.code),...rows.map(r=>r.code)])];
    const objects:OntologyDocument[]=[];
    for(const code of codes){
      const base=bases.find(o=>o.code===code)||null;
      const row=rows.find(r=>r.code===code);
      const published=row?.disabled&&!admin?null:row?.published||base;
      if(!admin&&(!published||published.layer!=='kol_business'&&!enterpriseCodes.has(code)))continue;
      objects.push({code,revision:row?.revision||0,draft:admin?row?.draft||null:null,
        published:admin?published:employeeDefinition(published!),status:row?.disabled?'disabled':row?.published?'published':published?'registered':'draft',updatedAt:row?.updated_at||null});
    }
    const taxonomy=enterpriseTaxonomy(bases);
    if(stored.length){
      taxonomy.nodes=(await postgresPool().query<{metadata:typeof taxonomy.nodes[number]}>('SELECT metadata FROM ontology_catalog_nodes WHERE source_version=$1 ORDER BY level,id',[enterpriseHash()])).rows.map(r=>r.metadata);
      taxonomy.placements=(await postgresPool().query<{objectCode:string;path:[string,string,string];primary:boolean}>(`SELECT p.object_code AS "objectCode", ARRAY[f.name,d.name,t.name] AS path,p.is_primary AS "primary" FROM ontology_catalog_placements p JOIN ontology_catalog_nodes t ON t.id=p.theme_id JOIN ontology_catalog_nodes d ON d.id=t.parent_id JOIN ontology_catalog_nodes f ON f.id=d.parent_id WHERE p.source_version=$1`,[enterpriseHash()])).rows;
    }
    // Tenant drafts/published classifications take precedence over the shared catalog's primary path.
    for(const doc of objects){const override=rows.find(r=>r.code===doc.code);const definition=admin?(override?.draft||override?.published):override?.published;
      if(!definition)continue;
      taxonomy.placements=taxonomy.placements.filter(p=>p.objectCode!==doc.code||!p.primary);
      taxonomy.placements.push({objectCode:doc.code,path:definition.taxonomy,primary:true});
    }
    const visible=new Set(objects.map(o=>o.code));taxonomy.placements=taxonomy.placements.filter(p=>visible.has(p.objectCode));
    return {context,sourceVersion:baseline.sourceVersion,objects,taxonomy,relevance:await relevance(postgresPool(),context,this.actor.id)};
  }
  async scope(){const ctx=await this.context(postgresPool(),true);return {...await scopeSettings(postgresPool(),ctx.companyId),options:await scopeOptions(postgresPool(),ctx.companyId)};}
  async configureScope(body:Record<string,unknown>){return postgresTransaction(async db=>{const ctx=await this.context(db,true);return saveScope(db,ctx,this.actor.id,body);});}
  async requestMaintenance(body:Record<string,unknown>){const catalog=await this.catalog();return postgresTransaction(async db=>feedback(db,await this.context(db),this.actor.id,body,new Set(catalog.objects.map(o=>o.code))));}
  async maintenance(){const ctx=await this.context(postgresPool(),true);return maintenanceRequests(postgresPool(),ctx.companyId);}
  async history(code:string):Promise<{items:OntologyVersion[]}>{
    const ctx=await this.context(postgresPool(),true);
    const rows=await postgresPool().query('SELECT * FROM ontology_versions WHERE company_id=$1 AND code=$2 ORDER BY revision DESC LIMIT 100',[ctx.companyId,code]);
    return {items:rows.rows.map(r=>({id:r.id,code:r.code,revision:r.revision,action:r.action,actor:r.actor,reason:r.reason,createdAt:r.created_at,definition:r.definition}))};
  }
  private async lock(db:DB,companyId:string,code:string){
    // Serialize definition mutations per tenant so disabling a relation target
    // cannot race publication of another object's new reference.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['ontology-tenant',companyId])]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([companyId,code])]);
    return (await db.query<DocumentRow>('SELECT * FROM ontology_documents WHERE company_id=$1 AND code=$2 FOR UPDATE',[companyId,code])).rows[0];
  }
  async save(body:Record<string,unknown>):Promise<OntologyReceipt>{
    const expected=revision(body.expectedRevision);const reason=string(body.reason,'变更原因',2000);
    const code=string((body.definition as {code?:unknown})?.code,'对象编码',100);
    return postgresTransaction(async db=>{
      const ctx=await this.context(db,true);const current=await this.lock(db,ctx.companyId,code);
      if((current?.revision||0)!==expected)throw new HttpFail(409,'定义已被修改，请刷新并对比最新版本');
      const baseline=loadOntologyCatalog();
      if(body.sourceVersion!==baseline.sourceVersion)throw new HttpFail(409,'注册目录已变化，请刷新后重新编辑');
      const registered=(await db.query<{code:string}>('SELECT code FROM ontology_documents WHERE company_id=$1 AND (published IS NOT NULL OR code=$2)',[ctx.companyId,code])).rows;
      const definition=validateDefinition(body.definition,new Set([...baseline.objects.map(o=>o.code),...registered.map(r=>r.code),code]),baseline.objects);
      const duplicate=baseline.objects.some(o=>o.code!==code&&o.id===definition.id)||(await db.query("SELECT 1 FROM ontology_documents WHERE company_id=$1 AND code<>$2 AND (draft->>'id'=$3 OR published->>'id'=$3) LIMIT 1",[ctx.companyId,code,definition.id])).rows.length>0;
      if(duplicate)throw new HttpFail(422,'对象稳定 ID 已被其他对象使用');
      const original=current?.published||baseline.objects.find(o=>o.code===code);
      if(original&&(definition.id!==original.id||definition.layer!==original.layer))throw new HttpFail(422,'已登记对象的稳定 ID 和分层不可修改');
      const next=expected+1;const time=now();
      await db.query(`INSERT INTO ontology_documents(company_id,code,revision,draft,updated_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(company_id,code) DO UPDATE SET revision=$3,draft=$4,updated_at=$5`,[ctx.companyId,code,next,JSON.stringify(definition),time]);
      const id=randomUUID();
      await db.query('INSERT INTO ontology_versions(id,company_id,code,revision,action,actor,reason,definition,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,ctx.companyId,code,next,'save_draft',this.actor.id,reason,JSON.stringify(definition),time]);
      return {id,code,revision:next,action:'save_draft',createdAt:time};
    });
  }
  private async target(db:DB,companyId:string,code:string,action:string,current:DocumentRow|undefined,targetVersion?:string):Promise<OntologyDefinition|null>{
    if(action==='publish'){
      if(!current?.draft)throw new HttpFail(409,'没有待发布草稿');
      return current.draft;
    }
    if(action==='disable'){
      if(current?.disabled)throw new HttpFail(409,'对象已停用');
      if(!current?.published&&!loadOntologyCatalog().objects.some(o=>o.code===code))throw new HttpFail(404,'对象不存在');
      const rows=(await db.query<DocumentRow>('SELECT * FROM ontology_documents WHERE company_id=$1',[companyId])).rows;
      const definitions=new Map(loadOntologyCatalog().objects.map(o=>[o.code,o]));
      for(const row of rows)if(row.disabled)definitions.delete(row.code);else if(row.published)definitions.set(row.code,row.published);
      if([...definitions.values()].some(o=>o.code!==code&&o.items.relations.some(i=>i.target===code)))throw new HttpFail(409,'对象仍被已登记或已发布关系引用，请先处理引用');
      return null;
    }
    if(action==='restore'){
      const version=(await db.query('SELECT definition FROM ontology_versions WHERE company_id=$1 AND code=$2 AND id=$3 AND action IN (\'publish\',\'restore\')',[companyId,code,targetVersion])).rows[0];
      if(!version?.definition)throw new HttpFail(404,'未找到可回滚的已发布版本');
      return version.definition;
    }
    throw new HttpFail(422,'不支持的本体操作');
  }
  async prepare(body:Record<string,unknown>):Promise<OntologyConfirmation>{
    const code=string(body.code,'对象编码');const expected=revision(body.expectedRevision);const action=string(body.action,'操作');
    return postgresTransaction(async db=>{
      const ctx=await this.context(db,true);const current=await this.lock(db,ctx.companyId,code);
      if((current?.revision||0)!==expected)throw new HttpFail(409,'定义版本已变化，请刷新');
      const next=await this.target(db,ctx.companyId,code,action,current,body.targetVersion as string|undefined);
      const baseline=loadOntologyCatalog();const id=randomUUID();const expiresAt=new Date(Date.now()+5*60_000).toISOString();
      await db.query('INSERT INTO ontology_confirmations(id,company_id,actor,code,revision,action,target_version,source_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,ctx.companyId,this.actor.id,code,expected,action,body.targetVersion||null,baseline.sourceVersion,expiresAt]);
      return {token:id,code,revision:expected,action,expiresAt,previous:current?.disabled?null:current?.published||baseline.objects.find(o=>o.code===code)||null,next};
    });
  }
  async commit(body:Record<string,unknown>):Promise<OntologyReceipt>{
    const token=string(body.token,'确认标识');const commandId=string(body.commandId,'幂等标识');const reason=string(body.reason,'变更原因',2000);
    if(body.confirmed!==true)throw new HttpFail(409,'正式操作必须明确确认');
    const hash=digest([token,reason,true]);
    return postgresTransaction(async db=>{
      const ctx=await this.context(db,true);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['ontology-command',ctx.companyId,this.actor.id,commandId])]);
      const prior=(await db.query('SELECT * FROM ontology_receipts WHERE company_id=$1 AND actor=$2 AND command_id=$3',[ctx.companyId,this.actor.id,commandId])).rows[0];
      if(prior){if(prior.command_hash!==hash)throw new HttpFail(409,'幂等标识不能用于不同内容');return prior.receipt;}
      const confirmation=(await db.query('SELECT * FROM ontology_confirmations WHERE id=$1 AND company_id=$2 AND actor=$3 FOR UPDATE',[token,ctx.companyId,this.actor.id])).rows[0];
      if(!confirmation||confirmation.consumed||confirmation.expires_at<now())throw new HttpFail(409,'确认已失效，请重新预览');
      const current=await this.lock(db,ctx.companyId,confirmation.code);
      if((current?.revision||0)!==confirmation.revision)throw new HttpFail(409,'内容已变化，原确认不能覆盖新版本');
      const baseline=loadOntologyCatalog();
      if(confirmation.source_version!==baseline.sourceVersion)throw new HttpFail(409,'注册目录已变化，请重新预览');
      const target=await this.target(db,ctx.companyId,confirmation.code,confirmation.action,current,confirmation.target_version);
      if(target){
        const rows=(await db.query<DocumentRow>('SELECT code,disabled,published FROM ontology_documents WHERE company_id=$1',[ctx.companyId])).rows;
        const active=new Set([...baseline.objects.map(o=>o.code),...rows.filter(r=>r.published&&!r.disabled).map(r=>r.code),target.code]);
        for(const row of rows)if(row.disabled&&row.code!==target.code)active.delete(row.code);
        validateDefinition(target,active,baseline.objects);
      }
      const next=confirmation.revision+1;const time=now();const id=randomUUID();
      const stored=confirmation.action==='disable'?(current?.published||baseline.objects.find(o=>o.code===confirmation.code)||null):target;
      const remainingDraft=confirmation.action==='publish'?null:current?.draft||null;
      await db.query(`INSERT INTO ontology_documents(company_id,code,revision,published,disabled,updated_at,draft) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(company_id,code) DO UPDATE SET revision=$3,published=$4,disabled=$5,draft=$7,updated_at=$6`,[ctx.companyId,confirmation.code,next,stored?JSON.stringify(stored):null,confirmation.action==='disable',time,remainingDraft?JSON.stringify(remainingDraft):null]);
      await syncOrganizationObjects(db,ctx.companyId);
      await db.query('UPDATE ontology_confirmations SET consumed=true WHERE id=$1',[token]);
      await db.query('INSERT INTO ontology_versions(id,company_id,code,revision,action,actor,reason,definition,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,ctx.companyId,confirmation.code,next,confirmation.action,this.actor.id,reason,target?JSON.stringify(target):null,time]);
      const receipt:OntologyReceipt={id,code:confirmation.code,revision:next,action:confirmation.action,createdAt:time};
      await db.query('INSERT INTO ontology_receipts(company_id,actor,command_id,command_hash,receipt) VALUES($1,$2,$3,$4,$5)',[ctx.companyId,this.actor.id,commandId,hash,JSON.stringify(receipt)]);
      return receipt;
    });
  }
}
