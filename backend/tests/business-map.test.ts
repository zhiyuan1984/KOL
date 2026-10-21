import { describe, expect, it } from 'vitest';
import { buildBusinessMapCatalog } from '../src/business-map/catalog.js';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
import { projectWecomPreviewRows } from '../src/business-map/projection.js';
import type { OntologyCatalog, OntologyDefinition } from '../../shared/ontology.js';
import type { WecomSnapshotRow } from '../../shared/wecom-ontology.js';

const organizationCodes = [
  ['org_unit', '组织单元'], ['membership', '成员关系'], ['responsibility', '职责分配'],
  ['ent_b14_b4d203dea5b9121c', '组织'], ['ent_b14_f128cdf1dae21223', '部门'], ['ent_b14_345b3c5bd988b2d6', '组织层级关系'],
] as const;
const definition = (code: string, name: string, taxonomy: [string, string, string], layer: OntologyDefinition['layer'] = 'org_governance'): OntologyDefinition => ({
  code, id: `id:${code}`, name, description: '', layer, taxonomy, source: 'test',
  items: { properties: [], relations: [], events: [], rules: [], actions: [] },
});

const catalog: OntologyCatalog = {
  context: { companyId: 'company:a', companies: [{ id: 'company:a', name: 'A' }], admin: true }, sourceVersion: 'test',
  objects: [
    ...organizationCodes.map(([code, name]) => ({ code, revision: 0, draft: null, published: definition(code, name, ['企业治理', '组织管理', '组织关系']), status: 'registered' as const, updatedAt: null })),
    { code: 'campaign', revision: 0, draft: null, published: definition('campaign', '活动', ['业务经营', '营销管理', '活动管理']), status: 'registered', updatedAt: null },
    { code: 'runtime_record', revision: 0, draft: null, published: definition('runtime_record', '运行记录', ['IT与数字化', '智能体管理', 'Agent运行'], 'platform'), status: 'registered', updatedAt: null },
    { code: 'credential_ref', revision: 0, draft: null, published: definition('credential_ref', '凭据引用', ['IT与数字化', '系统集成', '凭据管理']), status: 'registered', updatedAt: null },
    { code: 'skill_tool_binding', revision: 0, draft: null, published: definition('skill_tool_binding', '技能 × 工具绑定', ['IT与数字化', '技能管理', '技能装配']), status: 'registered', updatedAt: null },
    { code: 'skill_grant', revision: 0, draft: null, published: definition('skill_grant', '技能授权', ['IT与数字化', '身份管理', '权限管理']), status: 'registered', updatedAt: null },
  ],
  taxonomy: { nodes: [], missing: [], placements: [
    ...organizationCodes.map(([code]) => ({ objectCode: code, path: ['企业治理', '组织管理', '组织关系'] as [string, string, string], primary: true })),
    { objectCode: 'campaign', path: ['业务经营', '营销管理', '活动管理'], primary: true },
  ] },
};

const wecomRows: WecomSnapshotRow[] = [
  { externalId: 'dept:root', tenantId: 'company:a', source: 'wecom', kind: 'department', objectCode: 'org_unit', upstreamId: '1', ontologyProperties: {}, attributes: { name: '推广部' }, relations: { leaderPersonExternalIds: ['person:a'] } },
  { externalId: 'person:a', tenantId: 'company:a', source: 'wecom', kind: 'person', objectCode: 'user', upstreamId: 'alice', ontologyProperties: {}, attributes: { name: 'Alice', position: '运营' }, relations: { mainDepartmentExternalId: 'dept:root' } },
  { externalId: 'membership:a', tenantId: 'company:a', source: 'wecom', kind: 'membership', objectCode: 'membership', upstreamId: 'alice:1', ontologyProperties: {}, attributes: { secret: 'must-not-leak' }, relations: { personExternalId: 'person:a', departmentExternalId: 'dept:root', role: 'main' } },
];

describe('business-map pure catalog and projection', () => {
  it('keeps six distinct organization definitions in one explicit display group with a real three-level taxonomy path', () => {
    const result = buildBusinessMapCatalog(catalog, { wecomConnected: true });
    const group = result.groups.find((entry) => entry.id === 'business-map:organization-architecture');
    expect(group?.path).toEqual(['企业治理', '组织管理', '组织关系', '组织架构']);
    expect(group?.entities.map((entry) => entry.code)).toEqual(organizationCodes.map(([code]) => code));
    expect(group?.entities.find((entry) => entry.code === 'responsibility')?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'platform', available: false }),
      expect.objectContaining({ id: 'wecom', available: false }),
    ]));
    expect(group?.entities.find((entry) => entry.code === 'org_unit')?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'platform', label: '组织档案' }),
    ]));
    const visibleCodes = result.groups.flatMap((entry) => entry.entities.map((item) => item.code));
    expect(visibleCodes).toContain('campaign');
    expect(visibleCodes).toContain('org_unit');
    expect(visibleCodes).not.toEqual(expect.arrayContaining(['runtime_record', 'credential_ref', 'skill_tool_binding', 'skill_grant']));
    expect(result.groups.find((entry) => entry.entities[0]?.code === 'campaign')?.path).toEqual(['业务经营', '营销管理', '活动管理', '活动']);

    // Verify against the actual registered catalog too: this is only a
    // business-map projection and does not alter ontology definitions/paths.
    const registered = loadOntologyCatalog();
    const realResult = buildBusinessMapCatalog({
      context: catalog.context,
      sourceVersion: registered.sourceVersion,
      objects: registered.objects.map((published) => ({ code: published.code, revision: 0, draft: null, published, status: 'registered' as const, updatedAt: null })),
      taxonomy: { nodes: [], missing: [], placements: [] },
    }, { wecomConnected: false });
    const realCodes = realResult.groups.flatMap((entry) => entry.entities.map((item) => item.code));
    expect(realCodes).toEqual(expect.arrayContaining(['company', 'org_unit', 'user', 'brand', 'region']));
    expect(realCodes).not.toEqual(expect.arrayContaining(['run_record', 'credential_ref', 'skill_tool_binding', 'skill_grant']));
  });

  it('projects historic WeCom data through a field whitelist with opaque IDs and no source metadata', () => {
    const [membership] = projectWecomPreviewRows('company:a', 'membership', wecomRows);
    expect(membership).toMatchObject({ values: { person: 'Alice', unit: '推广部', relation: '主要归属' } });
    expect(membership?.id).toMatch(/^bm_[a-f0-9]{32}$/);
    const serialized = JSON.stringify(membership);
    expect(serialized).not.toContain('membership:a');
    expect(serialized).not.toContain('person:a');
    expect(serialized).not.toContain('dept:root');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('ontologyProperties');
  });
});
