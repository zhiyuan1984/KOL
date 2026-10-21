import type { BusinessMapCatalog, BusinessMapColumn, BusinessMapEntity, BusinessMapGroup, BusinessMapSource } from '../../../shared/business-map.js';
import type { OntologyCatalog, OntologyDefinition } from '../../../shared/ontology.js';

/** The view is explicit: these existing definitions are not merged or renamed in ontology. */
export const organizationArchitectureEntityCodes = [
  'org_unit',
  'membership',
  'responsibility',
  'ent_b14_b4d203dea5b9121c',
  'ent_b14_f128cdf1dae21223',
  'ent_b14_345b3c5bd988b2d6',
] as const;

const organizationArchitectureCodeSet = new Set<string>(organizationArchitectureEntityCodes);
// The browser is a business-reading view, not a platform/runtime or credential
// catalog. Keep this governance exclusion explicit: organization and business
// governance remain visible unless they are one of these framework bindings.
const frameworkGovernanceCodes = new Set(['credential_ref', 'skill_tool_binding', 'skill_grant']);
const platformCodes = new Set([
  'org_unit',
  'user',
  'membership',
  'ent_b14_f128cdf1dae21223',
  'ent_b14_345b3c5bd988b2d6',
]);
const wecomCodes = new Set([
  'org_unit',
  'user',
  'membership',
  'ent_b14_f128cdf1dae21223',
  'ent_b14_345b3c5bd988b2d6',
]);

const columnsByCode: Record<string, BusinessMapColumn[]> = {
  org_unit: [
    { key: 'name', label: '组织单元' },
    { key: 'parent', label: '上级单元' },
    { key: 'type', label: '单元类型' },
  ],
  user: [
    { key: 'name', label: '通讯录人员' },
    { key: 'unit', label: '所属组织单元' },
    { key: 'title', label: '通讯录职位' },
  ],
  membership: [
    { key: 'person', label: '通讯录人员' },
    { key: 'unit', label: '组织单元' },
    { key: 'relation', label: '归属类型' },
  ],
  responsibility: [
    { key: 'subject', label: '责任主体' },
    { key: 'scope', label: '责任范围' },
  ],
  ent_b14_b4d203dea5b9121c: [
    { key: 'name', label: '组织' },
  ],
  ent_b14_f128cdf1dae21223: [
    { key: 'name', label: '部门' },
    { key: 'parent', label: '上级单元' },
  ],
  ent_b14_345b3c5bd988b2d6: [
    { key: 'child', label: '下级组织单元' },
    { key: 'parent', label: '上级组织单元' },
  ],
};

function columns(definition: OntologyDefinition): BusinessMapColumn[] {
  const mapped = columnsByCode[definition.code];
  if (mapped) return mapped;
  const properties = definition.items.properties.slice(0, 3).map((item) => ({ key: item.code, label: item.name }));
  return properties.length ? properties : [{ key: 'name', label: definition.name }];
}

export function businessMapSources(code: string, wecomConnected: boolean): BusinessMapSource[] {
  return [
    {
      id: 'platform',
      label: code === 'user' ? '现有组织资料（通讯录人员，不等同于账号）' : '组织档案',
      available: platformCodes.has(code),
    },
    {
      id: 'wecom',
      label: '企业微信历史预览（未应用到平台组织）',
      available: wecomCodes.has(code) && wecomConnected,
    },
  ];
}

function pathFor(catalog: OntologyCatalog, definition: OntologyDefinition): [string, string, string] {
  const placement = catalog.taxonomy?.placements.find((item) => item.objectCode === definition.code && item.primary)
    || catalog.taxonomy?.placements.find((item) => item.objectCode === definition.code);
  return placement?.path || definition.taxonomy;
}

function entity(definition: OntologyDefinition, wecomConnected: boolean): BusinessMapEntity {
  return {
    code: definition.code,
    name: definition.name,
    columns: columns(definition),
    sources: businessMapSources(definition.code, wecomConnected),
  };
}

function visibleInBusinessMap(definition: OntologyDefinition): boolean {
  return definition.layer !== 'platform' && !frameworkGovernanceCodes.has(definition.code);
}

/**
 * Projects registered ontology definitions as business-reading objects.  Apart
 * from the documented organization-architecture group, each definition gets a
 * separate view object so taxonomy proximity never implies ontology merging.
 */
export function buildBusinessMapCatalog(catalog: OntologyCatalog, options: { wecomConnected: boolean }): BusinessMapCatalog {
  const definitions = catalog.objects
    .filter((document): document is typeof document & { published: OntologyDefinition } => {
      if (!document.published || document.status === 'disabled') return false;
      return visibleInBusinessMap(document.published);
    })
    .map((document) => document.published);
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const groups: BusinessMapGroup[] = [];

  const organizationEntities = organizationArchitectureEntityCodes
    .map((code) => byCode.get(code))
    .filter((definition): definition is OntologyDefinition => Boolean(definition));
  if (organizationEntities.length) {
    const anchor = organizationEntities.find((definition) => definition.code === 'org_unit') || organizationEntities[0]!;
    const taxonomy = pathFor(catalog, anchor);
    groups.push({
      id: 'business-map:organization-architecture',
      name: '组织架构',
      // The first three values are the catalog's actual taxonomy.  The fourth
      // is an explicit display-view mapping, not a mutation of that taxonomy.
      path: [taxonomy[0], taxonomy[1], taxonomy[2], '组织架构'],
      entities: organizationEntities.map((definition) => entity(definition, options.wecomConnected)),
    });
  }

  for (const definition of definitions) {
    if (organizationArchitectureCodeSet.has(definition.code)) continue;
    const taxonomy = pathFor(catalog, definition);
    groups.push({
      id: `business-map:object:${definition.code}`,
      name: definition.name,
      path: [taxonomy[0], taxonomy[1], taxonomy[2], definition.name],
      entities: [entity(definition, options.wecomConnected)],
    });
  }

  groups.sort((left, right) => left.path.join('\u0000').localeCompare(right.path.join('\u0000'), 'zh-Hans-CN'));
  return { context: catalog.context, groups };
}

export function supportsPlatformBusinessMapRecords(code: string): boolean { return platformCodes.has(code); }
export function supportsWecomBusinessMapRecords(code: string): boolean { return wecomCodes.has(code); }
