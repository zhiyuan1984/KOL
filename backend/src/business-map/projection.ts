import { createHash } from 'node:crypto';
import type { BusinessMapRecord, BusinessMapRecordField } from '../../../shared/business-map.js';
import type { WecomSnapshotRow } from '../../../shared/wecom-ontology.js';

const departmentCode = 'ent_b14_f128cdf1dae21223';
const hierarchyCode = 'ent_b14_345b3c5bd988b2d6';

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function opaque(companyId: string, entityCode: string, source: string, identity: string): string {
  return `bm_${createHash('sha256').update(`business-map/v1/${companyId}/${entityCode}/${source}/${identity}`).digest('hex').slice(0, 32)}`;
}

export function opaqueBusinessMapUnit(companyId: string, source: string, identity: string): string {
  return opaque(companyId, 'organization-unit-filter', source, identity);
}

function compact(key: string, label: string, value: string | null, width: 'small' | 'medium' | 'wide' = 'medium'): BusinessMapRecordField {
  return { key, label, value, layout: 'compact', width };
}
function long(key: string, label: string, value: string | null): BusinessMapRecordField {
  return { key, label, value, layout: 'long' };
}
function record(companyId: string, entityCode: string, identity: string, values: Record<string, string | null>, fields: BusinessMapRecordField[], links?: BusinessMapRecord['links']): BusinessMapRecord {
  return { id: opaque(companyId, entityCode, 'wecom', identity), values, fields, ...(links?.length ? { links } : {}) };
}

/**
 * Whitelist projection of a caller-owned historic preview. Raw attributes,
 * source external IDs, ontology properties, relation IDs, hashes and binding
 * metadata stay inside the server process.
 */
export function projectWecomPreviewRows(companyId: string, entityCode: string, rows: readonly WecomSnapshotRow[]): BusinessMapRecord[] {
  const departments = new Map(rows.filter((row) => row.kind === 'department').map((row) => [row.externalId, row]));
  const people = new Map(rows.filter((row) => row.kind === 'person').map((row) => [row.externalId, row]));
  const departmentName = (externalId: unknown) => departments.get(String(externalId || '')) ? text(departments.get(String(externalId || ''))!.attributes.name) : null;
  const personName = (externalId: unknown) => people.get(String(externalId || '')) ? text(people.get(String(externalId || ''))!.attributes.name) : null;

  if (entityCode === 'org_unit' || entityCode === departmentCode) {
    return rows.filter((row) => row.kind === 'department').map((row) => {
      const name = text(row.attributes.name);
      const parent = departmentName(row.relations.parentDepartmentExternalId);
      const leaders = Array.isArray(row.relations.leaderPersonExternalIds)
        ? row.relations.leaderPersonExternalIds.map(personName).filter((value): value is string => Boolean(value)).join('、') || null : null;
      return record(companyId, entityCode, row.externalId, { name, parent, type: '部门' }, [
        compact('name', entityCode === departmentCode ? '部门' : '组织单元', name, 'wide'),
        compact('parent', '上级单元', parent, 'wide'),
        compact('leaders', '通讯录负责人', leaders, 'wide'),
        long('source_note', '来源说明', '企业微信历史预览，尚未应用到平台组织。'),
      ], [{ label: '查看成员关系', entityCode: 'membership', unit: opaqueBusinessMapUnit(companyId, 'wecom', row.externalId) }]);
    });
  }

  if (entityCode === hierarchyCode) {
    return rows.filter((row) => row.kind === 'department' && departmentName(row.relations.parentDepartmentExternalId)).map((row) => {
      const child = text(row.attributes.name);
      const parent = departmentName(row.relations.parentDepartmentExternalId);
      return record(companyId, entityCode, row.externalId, { child, parent }, [
        compact('child', '下级组织单元', child, 'wide'),
        compact('parent', '上级组织单元', parent, 'wide'),
        long('source_note', '来源说明', '企业微信历史预览，尚未应用到平台组织。'),
      ]);
    });
  }

  if (entityCode === 'user') {
    return rows.filter((row) => row.kind === 'person').map((row) => {
      const name = text(row.attributes.name);
      const title = text(row.attributes.position);
      const unit = departmentName(row.relations.mainDepartmentExternalId);
      return record(companyId, entityCode, row.externalId, { name, title, unit }, [
        compact('name', '通讯录人员', name, 'wide'),
        compact('unit', '主组织单元', unit, 'wide'),
        compact('title', '通讯录职位', title, 'medium'),
        long('source_note', '来源说明', '企业微信历史预览，尚未应用到平台组织；通讯录人员不等同于平台账号或 HR 在职状态。'),
      ]);
    });
  }

  if (entityCode === 'membership') {
    return rows.filter((row) => row.kind === 'membership').map((row) => {
      const person = personName(row.relations.personExternalId);
      const unit = departmentName(row.relations.departmentExternalId);
      const isMain = row.relations.role === 'main';
      const relation = isMain ? '主要归属' : '协作归属';
      return record(companyId, entityCode, row.externalId, { person, unit, relation }, [
        compact('person', '通讯录人员', person, 'wide'),
        compact('unit', '组织单元', unit, 'wide'),
        compact('relation', '归属类型', relation, 'medium'),
        long('source_note', '来源说明', '企业微信历史预览，尚未应用到平台组织。'),
      ], [{ label: '查看组织单元', entityCode: 'org_unit', unit: opaqueBusinessMapUnit(companyId, 'wecom', String(row.relations.departmentExternalId || '')) }]);
    });
  }
  return [];
}

export function filterBusinessMapRecords(records: readonly BusinessMapRecord[], query?: string, unit?: string): BusinessMapRecord[] {
  const q = query?.trim().toLocaleLowerCase('zh-Hans-CN') || '';
  return records.filter((entry) => {
    const unitMatches = !unit || entry.links?.some((link) => link.unit === unit) || false;
    if (!unitMatches && unit) return false;
    if (!q) return true;
    return [...Object.values(entry.values), ...entry.fields.map((field) => field.value)]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLocaleLowerCase('zh-Hans-CN').includes(q));
  });
}
