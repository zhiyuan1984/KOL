import { createHash } from 'node:crypto';
import { HttpFail } from '../host/errors.js';
import { postgresPool, postgresTransaction } from '../postgres/pool.js';
import type { TicketPrincipal } from '../ticket-domain/auth.js';
import { OntologyService } from './service.js';
import { taskDefinition } from '../tasks/registry.js';
import { PLATFORM_SYNC_AGENT } from '../runtime/platform-principal.js';
import {
  ensureRuntimeSchema, getAgentSkills, getSkillConnectors, getSkillTools,
  getToolPolicy, getConnectorConfig, setAgentSkill, setSkillConnector, setSkillTool,
} from '../runtime/store.js';
import { wecomOntologyRuntimeTools } from '../../../shared/wecom-ontology.js';

export const WECOM_SOURCE_SKILL = 'wecom_ontology_read';
const CONNECTOR = 'wecom-mcp';
const fail = (message: string): never => { throw new HttpFail(409, { code: 'wecom_setup_not_ready', message }); };

/** Explicit administrative setup, never an application-start bootstrap or an account import. */
export async function setupWecomOntologySource(actor: TicketPrincipal, input: Record<string, unknown>) {
  if (input.confirmed !== true || typeof input.companyId !== 'string' || !input.companyId.trim()
    || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) {
    throw new HttpFail(422, { code: 'wecom_setup_confirmation_required', message: '请明确确认公司范围并填写只读来源装配原因' });
  }
  const companyId = input.companyId.trim();
  const reason = input.reason.trim();
  await new OntologyService(actor, companyId).context(postgresPool(), true);
  await ensureRuntimeSchema();
  const definition = await taskDefinition(WECOM_SOURCE_SKILL);
  const expectedTools = Object.values(wecomOntologyRuntimeTools);
  if (!definition || definition.mcp.length !== expectedTools.length
    || expectedTools.some(name => !definition.mcp.includes(`${CONNECTOR}.${name}`))) {
    fail('企业微信只读来源技能声明不匹配，未装配任何声明外工具');
  }
  if (!await getConnectorConfig(CONNECTOR)) fail('企业微信连接器未配置，请先在连接器管理中完成配置');

  return postgresTransaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['wecom-source-setup']);
    await new OntologyService(actor, companyId).context(db, true);
    const currentUser = (await db.query<{ roles: string }>('SELECT roles FROM users WHERE id=$1 AND active=1 FOR SHARE', [actor.id])).rows[0];
    if (!currentUser || !JSON.parse(currentUser.roles).includes('admin')) throw new HttpFail(403, '当前账号没有来源装配管理权限');
    const agent = (await db.query<{ status: string }>('SELECT status FROM managed_agents WHERE id=$1 FOR SHARE', [PLATFORM_SYNC_AGENT])).rows[0];
    if (agent?.status !== 'published') fail('平台同步 Agent 未发布或已停用，不自动恢复');
    const connector = (await db.query<{ enabled: number }>('SELECT enabled FROM connectors WHERE id=$1 FOR SHARE', [CONNECTOR])).rows[0];
    if (Number(connector?.enabled) !== 1) fail('企业微信连接器未启用或已停用，不自动恢复');
    const priorBinding = (await db.query<{ company_id: string; connector_id: string }>(
      'SELECT company_id,connector_id FROM ontology_wecom_source_bindings WHERE source=$1', ['wecom'],
    )).rows[0];
    if (priorBinding && (priorBinding.company_id !== companyId || priorBinding.connector_id !== CONNECTOR)) {
      throw new HttpFail(403, { code: 'wecom_source_company_mismatch', message: '该企业微信来源已经绑定其他公司，不允许重新定向' });
    }
    const lifecycle = (await db.query<{ stage: string }>('SELECT stage FROM skill_lifecycle WHERE skill_id=$1 FOR SHARE', [WECOM_SOURCE_SKILL])).rows[0];
    if (lifecycle && lifecycle.stage !== 'published') fail('已有来源技能未发布或已停用，不自动恢复或覆盖草稿');
    const agentBinding = (await getAgentSkills(PLATFORM_SYNC_AGENT)).find(row => row.skill_id === WECOM_SOURCE_SKILL);
    const connectorBinding = (await getSkillConnectors(WECOM_SOURCE_SKILL)).find(row => row.connector_id === CONNECTOR);
    const toolBindings = await getSkillTools(WECOM_SOURCE_SKILL, CONNECTOR);
    if (agentBinding && Number(agentBinding.enabled) !== 1) fail('来源技能的 Agent 装配已停用，不自动恢复');
    if (connectorBinding && Number(connectorBinding.enabled) !== 1) fail('来源技能的连接器挂载已停用，不自动恢复');
    for (const name of expectedTools) {
      const policy = await getToolPolicy(CONNECTOR, name);
      if (!policy || Number(policy.enabled) !== 1 || policy.risk !== 'L1' || policy.access !== 'read') {
        fail(`工具 ${name} 尚无已启用的 L1 只读策略；本操作不创建或降低工具策略`);
      }
      const existing = toolBindings.find(row => row.tool_name === name);
      if (existing && Number(existing.enabled) !== 1) fail(`工具 ${name} 的技能挂载已停用，不自动恢复`);
    }
    const configuredAt = new Date().toISOString();
    const configurationFingerprint = createHash('sha256').update(JSON.stringify({ companyId, connector: CONNECTOR, skillId: WECOM_SOURCE_SKILL, tools: expectedTools })).digest('hex');
    // The shared runtime store enforces optimistic versions, parent mount and policy existence.
    // The outer transaction makes the initial assembly and source binding atomic.
    if (!lifecycle) await db.query('INSERT INTO skill_lifecycle(skill_id,stage,updated_at) VALUES($1,$2,$3)', [WECOM_SOURCE_SKILL, 'published', configuredAt]);
    if (!agentBinding) await setAgentSkill(PLATFORM_SYNC_AGENT, WECOM_SOURCE_SKILL, true, 0);
    if (!connectorBinding) await setSkillConnector(WECOM_SOURCE_SKILL, CONNECTOR, true, 0);
    for (const name of expectedTools) if (!toolBindings.some(row => row.tool_name === name)) await setSkillTool(WECOM_SOURCE_SKILL, CONNECTOR, name, true, 0);
    if (!priorBinding) await db.query(`INSERT INTO ontology_wecom_source_bindings
      (source,company_id,connector_id,configured_by,configuration_fingerprint,configured_at) VALUES($1,$2,$3,$4,$5,$6)`,
    ['wecom', companyId, CONNECTOR, actor.id, configurationFingerprint, configuredAt]);
    const receipt = {
      companyId, connectorId: CONNECTOR, skillId: WECOM_SOURCE_SKILL, agentId: PLATFORM_SYNC_AGENT,
      tools: expectedTools, configurationFingerprint, configuredAt, replayed: !!priorBinding,
      doesNotChange: ['users', 'organization_units', 'organization_people', 'organization_memberships', 'existing_tool_policies', 'employee_agent_bindings'],
    };
    await db.query('INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)',
      [configuredAt, actor.id, 'ontology.wecom.source_setup', JSON.stringify({ ...receipt, reason })]);
    return receipt;
  });
}
