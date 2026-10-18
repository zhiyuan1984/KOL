import { randomUUID,createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OntologyContext,OntologyScopeSettings,OntologyScopeOptions,OntologyRelevance,OntologyScopeMapping,OntologyMaintenanceRequest } from '../../../shared/ontology.js';
import { ontologyDimensions } from '../../../shared/ontology.js';
import { HttpFail } from '../host/errors.js';
import { loadOntologyCatalog } from './catalog.js';
type DB={query:PoolClient['query']};
export const relevanceSchema=`
CREATE TABLE IF NOT EXISTS ontology_scope_settings(company_id text PRIMARY KEY,revision integer NOT NULL,mappings jsonb NOT NULL,updated_at text NOT NULL);
CREATE TABLE IF NOT EXISTS ontology_scope_history(id text PRIMARY KEY,company_id text NOT NULL,revision integer NOT NULL,actor text NOT NULL,reason text NOT NULL,mappings jsonb NOT NULL,created_at text NOT NULL,UNIQUE(company_id,revision));
CREATE TABLE IF NOT EXISTS ontology_maintenance_requests(id text PRIMARY KEY,company_id text NOT NULL,actor text NOT NULL,command_id text NOT NULL,command_hash text NOT NULL,code text NOT NULL,dimension text NOT NULL,note text NOT NULL,created_at text NOT NULL,UNIQUE(company_id,actor,command_id));
CREATE INDEX IF NOT EXISTS ontology_maintenance_company ON ontology_maintenance_requests(company_id,created_at DESC);
CREATE OR REPLACE FUNCTION ontology_scope_keep_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ontology scope history is immutable'; END $$;
DROP TRIGGER IF EXISTS ontology_scope_history_immutable ON ontology_scope_history;
CREATE TRIGGER ontology_scope_history_immutable BEFORE UPDATE OR DELETE ON ontology_scope_history FOR EACH ROW EXECUTE FUNCTION ontology_scope_keep_history();
`;
const active=`m.status='active' AND p.status='active' AND ou.status='active' AND (m.effective_from IS NULL OR m.effective_from<=$2) AND (m.effective_to IS NULL OR m.effective_to>$2)`;
export async function scopeSettings(db:DB,company:string):Promise<OntologyScopeSettings>{const r=(await db.query('SELECT revision,mappings,updated_at FROM ontology_scope_settings WHERE company_id=$1',[company])).rows[0];return {revision:r?.revision||0,mappings:r?.mappings||[],updatedAt:r?.updated_at||null};}
export async function scopeOptions(db:DB,company:string):Promise<OntologyScopeOptions>{
 const stamp=new Date().toISOString();
 const units=(await db.query("SELECT id,display_name AS name FROM organization_units WHERE company_id=$1 AND status='active' ORDER BY display_name",[company])).rows as {id:string;name:string}[];
 const people=(await db.query(`SELECT DISTINCT p.person_ref AS id,p.display_name AS name FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref JOIN organization_units ou ON ou.id=m.org_unit_id AND ou.company_id=m.company_id WHERE m.company_id=$1 AND ${active} ORDER BY name`,[company,stamp])).rows as {id:string;name:string}[];
 const positions=(await db.query(`SELECT DISTINCT m.position FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref JOIN organization_units ou ON ou.id=m.org_unit_id AND ou.company_id=m.company_id WHERE m.company_id=$1 AND ${active} AND NULLIF(trim(m.position),'') IS NOT NULL ORDER BY m.position`,[company,stamp])).rows.map(r=>r.position as string);
 return {units,people,positions};
}
export async function relevance(db:DB,ctx:OntologyContext,userId:string):Promise<OntologyRelevance>{
 const settings=await scopeSettings(db,ctx.companyId);if(!settings.mappings.length)return {configured:false,relatedDomains:[],matchedMappings:[],owners:[]};
 const memberships=(await db.query(`SELECT m.org_unit_id,m.position,p.person_ref FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref JOIN organization_units ou ON ou.id=m.org_unit_id AND ou.company_id=m.company_id JOIN users u ON u.id=p.user_id AND u.active=1 WHERE m.company_id=$1 AND ${active} AND p.user_id=$3`,[ctx.companyId,new Date().toISOString(),userId])).rows;
 const units=(await db.query("SELECT id,parent_id FROM organization_units WHERE company_id=$1 AND status='active'",[ctx.companyId])).rows;
 const related=settings.mappings.filter(mapping=>memberships.some(m=>{
  if(mapping.subjectType==='person')return m.person_ref===mapping.subjectId;
  if(mapping.subjectType==='position')return m.position===mapping.subjectId;
  let id=m.org_unit_id;const visited=new Set<string>();while(id&&!visited.has(id)){if(id===mapping.subjectId)return true;if(!mapping.includeDescendants)return false;visited.add(id);id=units.find(u=>u.id===id)?.parent_id;}return false;
 }));
 const owners:OntologyRelevance['owners']=[];
 const refs=[...new Set(settings.mappings.map(m=>m.ownerPersonRef).filter((v):v is string=>!!v))];
 if(refs.length){const people=(await scopeOptions(db,ctx.companyId)).people;for(const m of settings.mappings){const person=people.find(p=>p.id===m.ownerPersonRef);if(person&&!owners.some(o=>JSON.stringify(o.domain)===JSON.stringify(m.domain)&&o.name===person.name))owners.push({domain:m.domain,name:person.name});}}
 return {configured:true,relatedDomains:[...new Map(related.map(m=>[JSON.stringify(m.domain),m.domain])).values()],matchedMappings:related.map(m=>m.id),owners};
}
export async function saveScope(db:DB,ctx:OntologyContext,actor:string,body:Record<string,unknown>){
 if(body.confirmed!==true)throw new HttpFail(409,'请确认默认范围配置；该操作不改变访问权限');
 if(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)throw new HttpFail(422,'请提供有效版本和变更原因');
 if(!Array.isArray(body.mappings)||body.mappings.length>500)throw new HttpFail(422,'范围映射格式无效');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ontology-scope:'+ctx.companyId]);
 const current=await scopeSettings(db,ctx.companyId);if(current.revision!==body.expectedRevision)throw new HttpFail(409,'范围配置已变化，请重新读取');
 const choices=await scopeOptions(db,ctx.companyId);const domains=loadOntologyCatalog().objects.map(o=>o.taxonomy.slice(0,2));const seen=new Set<string>();const mappings:OntologyScopeMapping[]=[];
 for(const raw of body.mappings){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!raw.id||raw.id.length>100||seen.has(raw.id)||!['organization_unit','position','person'].includes(raw.subjectType)||typeof raw.subjectId!=='string'||typeof raw.includeDescendants!=='boolean'||!Array.isArray(raw.domain)||raw.domain.length!==2||!domains.some(d=>d[0]===raw.domain[0]&&d[1]===raw.domain[1]))throw new HttpFail(422,'范围映射字段或业务域无效');
  const valid=raw.subjectType==='organization_unit'?choices.units.some(u=>u.id===raw.subjectId):raw.subjectType==='position'?choices.positions.includes(raw.subjectId):choices.people.some(p=>p.id===raw.subjectId);
  if(!valid||raw.subjectType!=='organization_unit'&&raw.includeDescendants||raw.ownerPersonRef&&!choices.people.some(p=>p.id===raw.ownerPersonRef))throw new HttpFail(422,'范围主体或维护责任人不是当前公司有效组织／岗位／人员');
  seen.add(raw.id);mappings.push({id:raw.id,subjectType:raw.subjectType,subjectId:raw.subjectId,domain:raw.domain,includeDescendants:raw.includeDescendants,...(raw.ownerPersonRef?{ownerPersonRef:raw.ownerPersonRef}:{})});
 }
 const revision=current.revision+1,createdAt=new Date().toISOString(),id=randomUUID();
 await db.query('INSERT INTO ontology_scope_settings(company_id,revision,mappings,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(company_id) DO UPDATE SET revision=$2,mappings=$3,updated_at=$4',[ctx.companyId,revision,JSON.stringify(mappings),createdAt]);
 await db.query('INSERT INTO ontology_scope_history(id,company_id,revision,actor,reason,mappings,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,ctx.companyId,revision,actor,body.reason.trim(),JSON.stringify(mappings),createdAt]);
 return {id,code:'scope-settings',revision,action:'configure_scope',createdAt};
}
export async function feedback(db:DB,ctx:OntologyContext,actor:string,body:Record<string,unknown>,visibleCodes:Set<string>){
 if(typeof body.code!=='string'||!visibleCodes.has(body.code)||!ontologyDimensions.includes(body.dimension as never)||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000||typeof body.commandId!=='string'||!body.commandId||body.commandId.length>120)throw new HttpFail(422,'请提供可见对象、定义类型和维护说明');
 const hash=createHash('sha256').update(JSON.stringify([body.code,body.dimension,body.note.trim()])).digest('hex');
 await db.query('INSERT INTO ontology_maintenance_requests(id,company_id,actor,command_id,command_hash,code,dimension,note,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(company_id,actor,command_id) DO NOTHING',[randomUUID(),ctx.companyId,actor,body.commandId,hash,body.code,body.dimension,body.note.trim(),new Date().toISOString()]);
 const r=(await db.query('SELECT * FROM ontology_maintenance_requests WHERE company_id=$1 AND actor=$2 AND command_id=$3',[ctx.companyId,actor,body.commandId])).rows[0];if(r.command_hash!==hash)throw new HttpFail(409,'请求标识已用于不同维护说明');
 return {id:r.id,code:r.code,revision:0,action:'maintenance_feedback',createdAt:r.created_at};
}
export async function maintenanceRequests(db:DB,company:string):Promise<{items:OntologyMaintenanceRequest[]}>{return {items:(await db.query('SELECT id,code,dimension,note,created_at AS "createdAt" FROM ontology_maintenance_requests WHERE company_id=$1 ORDER BY created_at DESC LIMIT 100',[company])).rows as OntologyMaintenanceRequest[]};}
