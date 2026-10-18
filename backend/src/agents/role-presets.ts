import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {requireAdmin} from '../auth.js';import {REPO_ROOT} from '../config.js';import {postgresPool} from '../postgres/pool.js';import {HttpFail} from '../host/errors.js';
import {agentWorkspaceDetail,saveAgentDraft,prepareAgentRelease,publishAgentRelease} from './workspace.js';
/** Optional business-pack installation. No runtime bootstrap or silent grants:
 * caller must be administrator and explicitly publish through existing governance. */
export async function publishKolRolePresets(){
 const actor=requireAdmin(),config=JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'config/kol-agent-assemblies.json'),'utf8').replace(/^\uFEFF/,'')) as {version:number;source_agent:string;profiles:Array<{id:string;name:string;description:string;skills:string[]}>};
 if(config.version!==1||config.profiles.length!==2)throw new HttpFail(409,'业务智能体预设无效');const db=postgresPool(),source=await agentWorkspaceDetail(config.source_agent);
 const bindings=(await db.query(`SELECT company_id,target_type,target_id,effective_from,effective_to FROM agent_bindings WHERE agent_id=$1 AND status='active' AND (effective_from IS NULL OR effective_from::timestamptz<=now()) AND (effective_to IS NULL OR effective_to::timestamptz>now()) ORDER BY company_id,target_type,target_id`,[source.id])).rows;
 if(bindings.some(b=>b.effective_to))throw new HttpFail(409,'原绑定有到期边界，请用原治理入口配置目标Agent，不能隐式延长使用资格');
 if(!bindings.length)throw new HttpFail(409,'原Agent没有有效绑定，不能推断目标人员范围');let org: {company_id:string;org_unit_id:string}|null=source.organization.assignment;
 if(!org){
  const companies=[...new Set(bindings.map(b=>b.company_id))];
  const memberships=(await db.query<{company_id:string;org_unit_id:string}>(`SELECT DISTINCT m.company_id,m.org_unit_id FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id WHERE p.user_id=$1 AND p.status='active' AND m.status='active' AND m.relation='primary' AND u.status='active' AND m.company_id=ANY($2::text[]) AND (m.effective_from IS NULL OR m.effective_from<=$3) AND (m.effective_to IS NULL OR m.effective_to>$3)`,[actor.id,companies,new Date().toISOString()])).rows;
  if(memberships.length!==1)throw new HttpFail(409,'新增Agent治理归属需要唯一的已确认主组织；原Agent保持原状');org=memberships[0];
 }

 const results=[];for(const profile of config.profiles){if(!/^agent:[a-z][a-z0-9_-]{1,60}$/.test(profile.id)||profile.skills.some(id=>!source.effective.skills.some(s=>s.skill_id===id)))throw new HttpFail(409,'预设超出原Agent已装配范围');
  const existing=(await db.query('SELECT status FROM managed_agents WHERE id=$1',[profile.id])).rows[0];if(existing?.status==='published'){results.push({id:profile.id,status:'preserved_existing'});continue;}
  await db.query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at) VALUES($1,$2,$3,'draft',1,$4,$4) ON CONFLICT(id) DO NOTHING`,[profile.id,profile.name,profile.description,new Date().toISOString()]);
  const current=await agentWorkspaceDetail(profile.id);if(current.draft&&current.draft.updated_by!==actor.id)throw new HttpFail(409,'目标已有其他人的修订草稿，已保留');
  await saveAgentDraft(actor.id,profile.id,{name:profile.name,description:profile.description,skill_ids:profile.skills,expected_revision:current.draft?.revision||0,expected_version:current.version,governance:{organization:{company_id:org.company_id,org_unit_id:org.org_unit_id},bindings:bindings.map(({company_id,target_type,target_id})=>({company_id,target_type,target_id})),basis:current.governance_basis,reason:'用户授权阶段7：首批双Agent装配，仅复用原Agent覆盖人员和已有技能；不带入额外使用资格'}});
  const check=await prepareAgentRelease(actor.id,profile.id);if(check.blockers.length)throw new HttpFail(409,{code:'role_preset_dependencies_unready',message:check.blockers.join('；')});
  const receipt=await publishAgentRelease(actor.id,profile.id,{preparation_id:check.preparation_id,request_id:randomUUID(),confirmed:true});results.push({id:profile.id,status:'published',version:receipt.version});
 }return results;
}
