import type {PoolClient} from 'pg';import type {Json} from '../types.js';
import {requireCoop,requireLead} from './kol-leads.js';import {HttpFail} from '../host/errors.js';
/** Native relationship only: a legacy id/name never proves a formal cooperation.
 * Existing domain readers remain the authority for all instance access. */
export async function formalTaskContext(db:PoolClient,actor:string,taskId:string){
 const user=(await db.query('SELECT roles FROM users WHERE id=$1 AND active=1',[actor])).rows[0];if(!user)throw new HttpFail(403,'当前主体不可用');const roles=typeof user.roles==='string'?JSON.parse(user.roles):user.roles,isAdmin=Array.isArray(roles)&&roles.includes('admin');
 const linked=(await db.query('SELECT id FROM kol_cooperations WHERE project_task_id=$1 ORDER BY id LIMIT 20',[taskId])).rows;const objects:Json[]=[];
 for(const row of linked){let coop;try{coop=await requireCoop(actor,isAdmin,row.id);}catch(error){if(error instanceof HttpFail&&error.status===404)continue;throw error;}
  let lead=null;try{lead=await requireLead(actor,isAdmin,coop.lead_id);}catch(error){if(!(error instanceof HttpFail&&error.status===404))throw error;}
  objects.push({object:'collaboration',id:coop.id,source:'kol_cooperations',version:coop.data_version,updated_at:coop.updated_at,brand:coop.brand,project_task_id:coop.project_task_id,
   cooperation_stage:coop.coop_stage,exception_kind:coop.exception_kind,lead_ref:{id:coop.lead_id,source:'kol_leads'},platform_account:lead?{platform:lead.platform,platform_creator_id:lead.platform_creator_id}:null,
   owners:{cooperation_owner:coop.owner_principal_id,followup_owner:lead?.owner_principal_id||null,profile_owner:null},profile_owner_status:'not_provided_by_this_source'});
 }
 return {schema:'formal-task-business-context.v1',objects,source:'kol_cooperations.project_task_id',business_rules_unchanged:true};
}
