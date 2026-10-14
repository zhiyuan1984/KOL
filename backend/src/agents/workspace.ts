import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { PoolClient } from "pg";
import { postgresTransaction } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinitions } from "../tasks/registry.js";
import { runtimeHash } from "../runtime/execution.js";
import { computeEffectiveAgentUsers, type AgentBindingRow, type OrganizationCoverageSource } from "../runtime/organization-tree.js";
import type { AgentContent, AgentDraft, AgentGovernanceDraft, AgentReleaseCheck, AgentReleaseReceipt, AgentSkillOption, AgentVersionRecord, AgentWorkspaceState } from "../../../shared/agent-workspace.js";
import {organizationDirectory,organizationState,organizationHistory,organizationProposal,applyPublishedOrganization} from './organization.js';
import {governanceBasis,bindingTargets,targetKey,validateGovernance,proposedBindings,applyPublishedBindings} from './governance.js';
import {agentBrowse} from './organization-browse.js';
import type {AgentBrowseFilters,AgentOrganizationDirectory} from '../../../shared/agent-organization.js';

type Row = Record<string, any>;
const stamp = () => new Date().toISOString();
const json = (value: unknown, fallback: any = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
async function rows(db: PoolClient, sql: string, args: unknown[] = []): Promise<Row[]> { return (await db.query(sql, args)).rows; }
async function agent(db: PoolClient, id: string, lock = false): Promise<Row> {
  const value = (await rows(db, `SELECT * FROM managed_agents WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]))[0];
  if (!value) throw new HttpFail(404, "Agent 不存在");
  if(!value.workspace_managed&&!value.published_revision&&['published','disabled'].includes(value.status))value.published_revision=Number(value.version);
  return value;
}
async function record(db: PoolClient, actor: string, event: string, payload: Row) {
  await db.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)", [stamp(), actor, event, JSON.stringify(payload)]);
}

/** Native PG projection; the same coverage kernel is also used by runtime authorization. */
async function organization(db: PoolClient) {
  const units = await rows(db, "SELECT * FROM organization_units WHERE status='active' ORDER BY level,id");
  const people = await rows(db, "SELECT p.* FROM organization_people p LEFT JOIN users u ON u.id=p.user_id WHERE p.status='active' AND (p.user_id IS NULL OR u.active=1) ORDER BY person_ref");
  const memberships = await rows(db, "SELECT * FROM organization_memberships WHERE status='active' ORDER BY id");
  const versions = await rows(db, "SELECT company_id,MAX(version) AS version FROM org_versions GROUP BY company_id ORDER BY company_id");
  return { units, people, memberships, versions } as unknown as OrganizationCoverageSource;
}
async function bindings(db: PoolClient, id: string) {
  return await rows(db, "SELECT * FROM agent_bindings WHERE agent_id=$1 AND status='active' ORDER BY id", [id]) as unknown as AgentBindingRow[];
}

export async function agentSkillCatalog(db: PoolClient): Promise<AgentSkillOption[]> {
  const lifecycle = new Map((await rows(db, "SELECT skill_id,stage FROM skill_lifecycle")).map(row => [row.skill_id, row.stage]));
  const sops = new Map((await rows(db, "SELECT id,summary,body,updated_at FROM skill_sops")).map(({ id, ...row }) => [id, row]));
  const configs = new Map((await rows(db, "SELECT * FROM skill_knowledge_configs")).map(row => [row.skill_id, row]));
  const mounts = await rows(db, "SELECT * FROM runtime_skill_tools WHERE enabled=1 ORDER BY skill_id,connector_id,tool_name");
  const resources = await rows(db, "SELECT * FROM runtime_skill_connectors ORDER BY skill_id,connector_id");
  const policies = await rows(db, "SELECT * FROM runtime_tool_policies");
  const connectors = new Map((await rows(db, "SELECT connector_id,config_json FROM runtime_connector_config")).map(row => [row.connector_id, json(row.config_json)]));
  return taskDefinitions().map<AgentSkillOption>(definition => {
    const release = runtimeHash({ definition, body: fs.readFileSync(definition.path, "utf8"), sop: sops.get(definition.id) });
    const tools = mounts.filter(row => row.skill_id === definition.id);
    const documentQuery = definition.mcp.includes("knowledge.ask_documents") || tools.some(row => row.connector_id === "knowledge");
    const cfg = configs.get(definition.id);
    const risks = tools.map(tool => policies.find(row => row.connector_id === tool.connector_id && row.tool_name === tool.tool_name)?.risk);
    const risk = documentQuery && !tools.length ? "R1" : risks.includes("L3") || risks.includes("R3") ? "R3" : risks.includes("L2") || risks.includes("R2") ? "R2" : risks.length && risks.every(value => value === "L1" || value === "R1") ? "R1" : null;
    return {
      id: definition.id, label: definition.title, summary: definition.employee_summary || definition.description,
      category: definition.category, release_hash: release,
      published: lifecycle.has(definition.id) ? lifecycle.get(definition.id) === "published" : definition.source === "bundled",
      document_query: documentQuery, risk,
      knowledge_revision: cfg?.published_revision ? Number(cfg.published_revision) : null,
      knowledge_ready: !cfg || Boolean(cfg.published_revision && cfg.published_hash === release),
      resources: resources.filter(row => row.skill_id === definition.id).map(row => ({
        id: String(row.connector_id), configured: connectors.has(row.connector_id),
        enabled: Boolean(Number(row.enabled) && connectors.get(row.connector_id)?.enabled),
        tool_count: tools.filter(tool => tool.connector_id === row.connector_id).length,
      })),
      execution: definition.mcp.some(tool => /(?:claw|mediacrawler)\..*(?:start_crawl|startCrawl)/i.test(tool)) ? "async_job" : "skill",
    };
  }).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

async function content(db: PoolClient, item: Row, catalog: AgentSkillOption[]): Promise<AgentContent> {
  const snapshot = item.published_revision && (await rows(db, "SELECT content FROM agent_workspace_versions WHERE agent_id=$1 AND version=$2", [item.id, item.published_revision]))[0];
  if (snapshot) return json(snapshot.content);
  const assembly = await rows(db, "SELECT * FROM runtime_agent_skills WHERE agent_id=$1 AND enabled=1 ORDER BY skill_id", [item.id]);
  return { name: item.name, description: item.description, skills: assembly.map(row => ({
    skill_id: row.skill_id, release_hash: row.release_hash || catalog.find(skill => skill.id === row.skill_id)?.release_hash || "",
    knowledge_revision: catalog.find(skill => skill.id === row.skill_id)?.knowledge_revision ?? null,
  })) };
}
async function state(db: PoolClient, item: Row, catalog: AgentSkillOption[], directory?:AgentOrganizationDirectory): Promise<AgentWorkspaceState> {
  const stored = (await rows(db, "SELECT * FROM agent_workspace_drafts WHERE agent_id=$1", [item.id]))[0];
  const draft: AgentDraft | null = stored ? { ...json(stored.content), revision: Number(stored.revision), updated_at: stored.updated_at, updated_by: stored.updated_by } : null;
  const owner=await organizationState(db,item.id,directory),bound=await bindings(db,item.id);
  return { id: item.id, name: item.name, description: item.description, status: item.status,
    version: Number(item.version), published_revision: item.published_revision ? Number(item.published_revision) : null,
    created_at: item.created_at, updated_at: item.updated_at, effective: await content(db, item, catalog), draft, organization:owner,governance_basis:governanceBasis(bound,owner),
    actions: { edit: true, publish: Boolean(draft), disable: item.status === "published", enable: item.status === "disabled" && Boolean(item.published_revision) } };
}
export async function agentWorkspace(filters:Partial<AgentBrowseFilters>={}) {
  return postgresTransaction(async db => {
    const catalog = await agentSkillCatalog(db), org = await organization(db),directory=await organizationDirectory(db);
    const agents = [];
    for (const item of await rows(db, "SELECT * FROM managed_agents ORDER BY created_at,id")) {
      const bound = await bindings(db, item.id);
      agents.push({ ...await state(db, item, catalog,directory), bindings: bound,
        coverage: await computeEffectiveAgentUsers(item.id, bound, undefined, org) });
    }
    return { agents, browse:agentBrowse(agents,directory.units,filters),organization_directory:directory, skills: catalog, units: org.units, people: org.people.map(person => ({ ...person,
      company_id: org.memberships.find(row => row.person_ref === person.person_ref)?.company_id || null,
      company_ids: [...new Set(org.memberships.filter(row=>row.person_ref===person.person_ref).map(row=>row.company_id))],
      unit_ids: org.memberships.filter(row => row.person_ref === person.person_ref).map(row => row.org_unit_id),
    })) };
  }, { isolation: "REPEATABLE READ" });
}
export async function agentWorkspaceDetail(id: string) {
  return postgresTransaction(async db => {
    const item = await agent(db, id), catalog = await agentSkillCatalog(db);
    const bound = await bindings(db, id), org = await organization(db);
    const coverage = await computeEffectiveAgentUsers(id, bound, undefined, org);
    const versions = (await rows(db, "SELECT * FROM agent_workspace_versions WHERE agent_id=$1 ORDER BY version DESC", [id]))
      .map(row => ({ ...json(row.content), version: Number(row.version), published_at: row.published_at, published_by: row.published_by, receipt_id: row.receipt_id })) as AgentVersionRecord[];
    const examBlocked = await rows(db, `SELECT a.user_id,u.name,COUNT(*) AS missing FROM exam_assignments a
      JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.user_id
      WHERE a.user_id=ANY($1::text[]) AND a.required=1 AND e.status='published' AND e.version>0
      AND NOT EXISTS(SELECT 1 FROM exam_attempts t WHERE t.assignment_id=a.id AND t.user_id=a.user_id AND t.passed=1 AND t.status='graded')
      GROUP BY a.user_id,u.name ORDER BY a.user_id`, [coverage.user_ids]);
    const active = (await state(db, item, catalog)).effective;
    const issues = active.skills.flatMap(pin => {
      const skill = catalog.find(row => row.id === pin.skill_id);
      return !skill ? [`技能 ${pin.skill_id} 已不存在`] : [
        ...(!skill.published ? [`${skill.label} 未发布或已停用`] : []),
        ...(pin.release_hash !== skill.release_hash ? [`${skill.label} 版本已变化，需要修订并应用新版本`] : []),
        ...(pin.knowledge_revision !== skill.knowledge_revision ? [`${skill.label} 的知识依赖版本已变化，需要重新确认应用`] : []),
        ...(!skill.knowledge_ready ? [`${skill.label} 的知识依赖尚未正式发布`] : []),
        ...skill.resources.filter(row => !row.enabled || !row.configured || !row.tool_count).map(row => `${skill.label} 的资源 ${row.id} 未就绪`),
      ];
    });
    return { ...await state(db, item, catalog), bindings: bound, coverage, versions, exam_blocked: examBlocked.map(row=>({...row,missing:Number(row.missing)})),
      organization_history:await organizationHistory(db,id),dependency_issues: issues, health_evidence: "configuration_only" as const };
  }, { isolation: "REPEATABLE READ" });
}
function validateContent(input: { name?: unknown; description?: unknown; skill_ids?: unknown }, catalog: AgentSkillOption[]): AgentContent {
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) throw new HttpFail(400, "Agent 名称须为 1–80 字");
  if (typeof input.description !== "string" || input.description.length > 500) throw new HttpFail(400, "职责说明不能超过 500 字");
  if (!Array.isArray(input.skill_ids) || input.skill_ids.length > 200 || input.skill_ids.some(id => typeof id !== "string") || new Set(input.skill_ids).size !== input.skill_ids.length) throw new HttpFail(400, "请选择有效且不重复的技能");
  const skills = input.skill_ids.map(id => {
    const skill = catalog.find(row => row.id === id);
    if (!skill) throw new HttpFail(400, `技能 ${id} 不存在`);
    return { skill_id: skill.id, release_hash: skill.release_hash, knowledge_revision: skill.knowledge_revision };
  }).sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  return { name: input.name.trim(), description: input.description.trim(), skills };
}
export async function saveAgentDraft(actor: string, id: string | null, input: { name?: unknown; description?: unknown; skill_ids?: unknown; governance?:unknown; expected_revision?: number; expected_version?: number }) {
  if(id&&(!Number.isInteger(input.expected_version)||Number(input.expected_version)<1))throw new HttpFail(400,"修订须携带当前 Agent 版本依据");
  return postgresTransaction(async db => {
    const catalog = await agentSkillCatalog(db), candidate:AgentContent & {governance?:AgentGovernanceDraft} = validateContent(input, catalog), now = stamp(),isNew=!id;
    if (!id) {
      id = `agent:${randomUUID()}`;
      await db.query("INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at,workspace_managed) VALUES($1,$2,$3,'draft',1,$4,$4,TRUE)", [id, candidate.name, candidate.description, now]);
    }
    const item = await agent(db, id, true);
    if (input.expected_version !== undefined && Number(item.version) !== input.expected_version) throw new HttpFail(409, "Agent 有效版本或启停状态已变化，请刷新后重试");
    const draft = (await rows(db, "SELECT * FROM agent_workspace_drafts WHERE agent_id=$1", [id]))[0];
    if (!Number.isInteger(input.expected_revision) || Number(draft?.revision || 0) !== input.expected_revision) throw new HttpFail(409, "草稿已被其他人修改，请刷新后核对；本地输入保留");
    if(input.governance!==undefined){const owner=await organizationState(db,id),bound=await bindings(db,id),source=await organization(db),basis=governanceBasis(bound,owner);
      candidate.governance=validateGovernance(isNew&&input.governance&&typeof input.governance==='object'?{...input.governance,basis}:input.governance,basis,id,source);
      if(candidate.governance.organization)await organizationProposal(db,id,candidate.governance.organization.company_id,candidate.governance.organization.org_unit_id);
    }else if(draft&&json(draft.content).governance)candidate.governance=json(draft.content).governance;
    if (item.published_revision) {
      await db.query("INSERT INTO agent_workspace_versions(agent_id,version,content,published_by,published_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, item.published_revision, JSON.stringify(await content(db, item, catalog)), "legacy-release", item.updated_at]);
    }
    const revision = Number(draft?.revision || 0) + 1;
    await db.query(`INSERT INTO agent_workspace_drafts(agent_id,revision,content,updated_by,updated_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(agent_id) DO UPDATE SET revision=EXCLUDED.revision,content=EXCLUDED.content,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`, [id, revision, JSON.stringify(candidate), actor, now]);
    await db.query("UPDATE managed_agents SET workspace_managed=TRUE,published_revision=$2 WHERE id=$1", [id,item.published_revision || null]);
    await record(db, actor, "admin.agent.draft.save", { agent_id: id, revision, published_revision: item.published_revision, skill_ids: candidate.skills.map(skill => skill.skill_id) });
    return state(db, item, catalog);
  });
}
async function releaseContext(db: PoolClient, id: string) {
  const item = await agent(db, id), catalog = await agentSkillCatalog(db), current = await state(db, item, catalog);
  if (!current.draft) throw new HttpFail(409, "请先保存 Agent 修订草稿");
  const bound = await bindings(db, id), org = await organization(db),beforeCoverage=await computeEffectiveAgentUsers(id,bound,undefined,org),owner=await organizationState(db,id);
  const governance=current.draft.governance;
  const candidateBound=governance?proposedBindings(id,governance.bindings,bound):bound,coverage=await computeEffectiveAgentUsers(id,candidateBound,undefined,org);
  const blockers: string[] = [], warnings: string[] = [];
  let proposedOwner=owner.assignment;
  if(governance){try{validateGovernance(governance,governanceBasis(bound,owner),id,org);proposedOwner=(await organizationProposal(db,id,governance.organization?.company_id||null,governance.organization?.org_unit_id||null)).after;}catch(e){blockers.push(e instanceof Error?e.message:'治理草稿依据无效');}}
  const ownerChanged=(owner.assignment?.company_id||null)!==(governance?.organization?.company_id||null)||(owner.assignment?.org_unit_id||null)!==(governance?.organization?.org_unit_id||null);
  const beforeTargets=bindingTargets(bound),afterTargets=governance?.bindings||beforeTargets;
  const added=afterTargets.filter(target=>!beforeTargets.some(row=>targetKey(row)===targetKey(target))),removed=beforeTargets.filter(target=>!afterTargets.some(row=>targetKey(row)===targetKey(target)));
  if(governance&&(ownerChanged||added.length||removed.length)&&!governance.reason)blockers.push('请在草稿中填写归属或使用绑定变更原因');
  if (!current.draft.skills.length) blockers.push("发布前请先装配至少一项技能");
  if (!candidateBound.length&&id!=='agent:platform-sync') blockers.push("发布前请先绑定组织或人员");
  for (const pin of current.draft.skills) {
    const skill = catalog.find(row => row.id === pin.skill_id);
    if (!skill) { blockers.push(`技能 ${pin.skill_id} 已不存在`); continue; }
    if (!skill.published) blockers.push(`${skill.label} 尚未发布或已停用`);
    if (pin.release_hash !== skill.release_hash || pin.knowledge_revision !== skill.knowledge_revision) blockers.push(`${skill.label} 版本已变化，请重新保存草稿`);
    if (!skill.knowledge_ready) blockers.push(`${skill.label} 的知识依赖尚未正式发布`);
    for (const resource of skill.resources) if (!resource.configured || !resource.enabled || !resource.tool_count) warnings.push(`${skill.label} 的资源 ${resource.id} 未就绪；发布不代表实际调用可用`);
    if (!skill.risk) warnings.push(`${skill.label} 暂无完整工具风险登记；执行仍按服务端闸门校验`);
  }
  if (!coverage.user_ids.length) warnings.push("当前绑定没有覆盖有效员工账号");
  const relevant = catalog.filter(skill => current.draft!.skills.some(pin => pin.skill_id === skill.id));
  const skillIds=relevant.map(skill=>skill.id);
  const resourceMounts=await rows(db,"SELECT * FROM runtime_skill_connectors WHERE skill_id=ANY($1::text[]) ORDER BY skill_id,connector_id",[skillIds]);
  const toolMounts=await rows(db,"SELECT * FROM runtime_skill_tools WHERE skill_id=ANY($1::text[]) ORDER BY skill_id,connector_id,tool_name",[skillIds]);
  const resourceIds=[...new Set(resourceMounts.map(row=>row.connector_id))];
  const resourceConfigs=await rows(db,"SELECT * FROM runtime_connector_config WHERE connector_id=ANY($1::text[]) ORDER BY connector_id",[resourceIds]);
  const resourcePolicies=await rows(db,"SELECT * FROM runtime_tool_policies WHERE connector_id=ANY($1::text[]) ORDER BY connector_id,tool_name",[resourceIds]);
  const fingerprint = runtimeHash({ agent_version: item.version, status: item.status, published_revision: item.published_revision,
    draft: current.draft, catalog: relevant, bindings: bound, ownership:governance?owner:null,organization: org,resourceMounts,toolMounts,resourceConfigs,resourcePolicies });
  const changes:NonNullable<AgentReleaseCheck['changes']>={name:current.effective.name!==current.draft.name?{before:current.effective.name,after:current.draft.name}:null,description:current.effective.description!==current.draft.description?{before:current.effective.description,after:current.draft.description}:null,organization:governance&&ownerChanged?{before:owner.assignment,after:proposedOwner}:null,bindings_added:added,bindings_removed:removed,users_added:coverage.users.filter(row=>row.user_id&&!beforeCoverage.user_ids.includes(row.user_id)).map(row=>({user_id:row.user_id!,display_name:row.display_name})),users_removed:beforeCoverage.users.filter(row=>row.user_id&&!coverage.user_ids.includes(row.user_id)).map(row=>({user_id:row.user_id!,display_name:row.display_name})),reason:governance?.reason||'',total:0};
  changes.total=Number(Boolean(changes.name))+Number(Boolean(changes.description))+Number(Boolean(changes.organization))+added.length+removed.length+current.draft.skills.filter(pin=>!current.effective.skills.some(old=>old.skill_id===pin.skill_id&&old.release_hash===pin.release_hash&&old.knowledge_revision===pin.knowledge_revision)).length+current.effective.skills.filter(pin=>!current.draft!.skills.some(next=>next.skill_id===pin.skill_id)).length;
  if(!changes.total)blockers.push('草稿与当前生效配置相同，无需发布新版本');
  return { current, bound, coverage, blockers, warnings, fingerprint,changes,org };
}
export async function prepareAgentRelease(actor: string, id: string): Promise<AgentReleaseCheck> {
  return postgresTransaction(async db => {
    const ctx = await releaseContext(db, id), preparation = randomUUID(), now = stamp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.query("INSERT INTO agent_release_preparations(id,agent_id,actor,revision,fingerprint,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [preparation, id, actor, ctx.current.draft!.revision, ctx.fingerprint, expires, now]);
    const candidate = ctx.current.draft!, before = ctx.current.effective.skills, next = candidate.skills;
    return { preparation_id: preparation, expires_at: expires, revision: candidate.revision, org_version: ctx.coverage.org_version,
      content: { name: candidate.name, description: candidate.description, skills: candidate.skills },
      added_skills: next.filter(pin => !before.some(old => old.skill_id === pin.skill_id)).map(pin => pin.skill_id),
      removed_skills: before.filter(pin => !next.some(value => value.skill_id === pin.skill_id)).map(pin => pin.skill_id),
      updated_skills: next.filter(pin => before.some(old => old.skill_id === pin.skill_id && (old.release_hash !== pin.release_hash || old.knowledge_revision !== pin.knowledge_revision))).map(pin => pin.skill_id),
      coverage_count: ctx.coverage.user_ids.length, binding_count: ctx.current.draft?.governance?.bindings.length??ctx.bound.length, blockers: ctx.blockers, warnings: ctx.warnings,changes:ctx.changes };
  }, { isolation: "REPEATABLE READ" });
}
export async function publishAgentRelease(actor: string, id: string, input: { preparation_id?: string; request_id?: string; confirmed?: boolean }): Promise<AgentReleaseReceipt> {
  if (input.confirmed !== true || typeof input.request_id !== "string" || !/^[\w-]{8,100}$/.test(input.request_id) || typeof input.preparation_id !== "string") throw new HttpFail(400, "发布须确认并携带预检与请求标识");
  return postgresTransaction(async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${actor}:${input.request_id}`]);
    await agent(db, id, true);
    const previous = (await rows(db, "SELECT * FROM agent_release_receipts WHERE actor=$1 AND request_id=$2", [actor, input.request_id]))[0];
    if (previous) {
      if (previous.agent_id !== id || previous.preparation_id !== input.preparation_id) throw new HttpFail(409, "请求标识已用于其他发布");
      return { ...previous, version: Number(previous.version) } as AgentReleaseReceipt;
    }
    const prepared = (await rows(db, "SELECT * FROM agent_release_preparations WHERE id=$1 AND agent_id=$2 AND actor=$3", [input.preparation_id, id, actor]))[0];
    if (!prepared || prepared.expires_at <= stamp()) throw new HttpFail(409, "发布预检已过期，请重新检查");
    if ((await rows(db, "SELECT id FROM agent_release_receipts WHERE preparation_id=$1", [prepared.id])).length) throw new HttpFail(409, "本次预检已发布，请读取回执");
    // Authorization and dependency rows cannot change between recheck and commit.
    await db.query("LOCK TABLE agent_bindings,agent_organization_memberships,agent_organization_receipts IN SHARE ROW EXCLUSIVE MODE");
    await db.query("LOCK TABLE organization_units,organization_people,organization_memberships,org_versions,users,skill_lifecycle,skill_sops,skill_knowledge_configs,runtime_skill_connectors,runtime_skill_tools,runtime_tool_policies,runtime_connector_config IN SHARE MODE");
    const ctx = await releaseContext(db, id);
    if (ctx.fingerprint !== prepared.fingerprint) throw new HttpFail(409, "草稿、技能或授权依据已变化，请重新预检确认");
    if (ctx.blockers.length) throw new HttpFail(409, ctx.blockers.join("；"));
    const receiptId = randomUUID(), now = stamp(), version = Number(ctx.current.published_revision || 0) + 1;
    const draft = ctx.current.draft!, released: AgentContent = { name: draft.name, description: draft.description, skills: draft.skills };
    if(draft.governance){
      if(ctx.changes.organization)await applyPublishedOrganization(db,actor,id,draft.governance.organization,draft.governance.reason,receiptId);
      await applyPublishedBindings(db,actor,id,draft.governance.bindings,ctx.bound,draft.governance.reason,ctx.org);
      Object.assign(released,{governance:draft.governance});
    }
    await db.query("UPDATE runtime_agent_skills SET enabled=0,version=version+1,updated_at=$2 WHERE agent_id=$1 AND enabled=1", [id, now]);
    for (const pin of draft.skills) {
      await db.query(`INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at,release_hash) VALUES($1,$2,1,1,$3,$4)
        ON CONFLICT(agent_id,skill_id) DO UPDATE SET enabled=1,version=runtime_agent_skills.version+1,updated_at=EXCLUDED.updated_at,release_hash=EXCLUDED.release_hash`, [id, pin.skill_id, now, pin.release_hash]);
      if (pin.knowledge_revision) await db.query(`INSERT INTO agent_knowledge_skill_releases(agent_id,skill_id,skill_hash,config_revision,confirmed_by,confirmed_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(agent_id,skill_id) DO UPDATE SET skill_hash=EXCLUDED.skill_hash,config_revision=EXCLUDED.config_revision,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=EXCLUDED.confirmed_at`, [id, pin.skill_id, pin.release_hash, pin.knowledge_revision, actor, now]);
    }
    await db.query("INSERT INTO agent_workspace_versions(agent_id,version,content,published_by,published_at,receipt_id) VALUES($1,$2,$3,$4,$5,$6)", [id, version, JSON.stringify(released), actor, now, receiptId]);
    await db.query("UPDATE managed_agents SET name=$2,description=$3,status='published',version=version+1,published_revision=$4,workspace_managed=TRUE,updated_at=$5 WHERE id=$1", [id, draft.name, draft.description, version, now]);
    await db.query("DELETE FROM agent_workspace_drafts WHERE agent_id=$1", [id]);
    const receipt: AgentReleaseReceipt = { id: receiptId, agent_id: id, version, published_at: now, request_id: input.request_id! };
    await db.query("INSERT INTO agent_release_receipts(id,agent_id,actor,preparation_id,request_id,version,published_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [receiptId, id, actor, prepared.id, input.request_id, version, now]);
    await record(db, actor, "admin.agent.release.publish", { ...receipt, before_version: ctx.current.published_revision, revision: draft.revision, org_version: ctx.coverage.org_version, preparation_id: prepared.id });
    return receipt;
  });
}
export async function changeAgentAvailability(actor: string, id: string, input: { status?: string; expected_version?: number; confirmed?: boolean }) {
  if (input.confirmed !== true || !["published", "disabled"].includes(input.status || "")) throw new HttpFail(400, "请确认启停动作");
  return postgresTransaction(async db => {
    const item = await agent(db, id, true);
    if (Number(item.version) !== input.expected_version) throw new HttpFail(409, "Agent 已变化，请刷新后重新确认");
    if (!item.published_revision) throw new HttpFail(409, "Agent 尚无已发布版本");
    const now = stamp();
    if (item.status !== input.status) {
      await db.query("UPDATE managed_agents SET status=$2,version=version+1,updated_at=$3 WHERE id=$1", [id, input.status, now]);
      await record(db, actor, "admin.agent.availability", { agent_id: id, before: item.status, after: input.status, published_revision: item.published_revision });
    }
    return state(db, await agent(db, id), await agentSkillCatalog(db));
  });
}

export async function assertLegacyAgentWriteAllowed(id: string) {
  await postgresTransaction(async db => {
    if ((await agent(db, id)).workspace_managed) throw new HttpFail(409, "此 Agent 已使用版本治理，请保存修订草稿并确认发布；启停请使用独立治理动作");
  });
}
