import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { BusinessMapCatalog, BusinessMapRecord, BusinessMapRecordField, BusinessMapRecords, BusinessMapSourceId } from '../../../shared/business-map.js';
import type { WecomSnapshotRow } from '../../../shared/wecom-ontology.js';
import { HttpFail } from '../host/errors.js';
import { WecomOntologySourceService } from '../ontology/wecom-source.js';
import { OntologyService } from '../ontology/service.js';
import { postgresPool } from '../postgres/pool.js';
import type { TicketPrincipal } from '../ticket-domain/auth.js';
import { buildBusinessMapCatalog, supportsPlatformBusinessMapRecords, supportsWecomBusinessMapRecords } from './catalog.js';
import { filterBusinessMapRecords, opaqueBusinessMapUnit, projectWecomPreviewRows } from './projection.js';

type Db = Pick<PoolClient, 'query'>;
type WecomHistoryReader = {
  isConnected(companyId: string): Promise<boolean>;
  historicalPreview(companyId: string): Promise<{ createdAt: string; observedAt: string | null; rows: WecomSnapshotRow[] } | null>;
};
type RecordsInput = {
  companyId?: string;
  entityCode?: string;
  source?: string;
  page?: string | number;
  pageSize?: string | number;
  q?: string;
  unit?: string;
};
type PlatformRow = {
  identity: string;
  unitIdentity?: string | null;
  name?: string | null;
  parent?: string | null;
  type?: string | null;
  leader?: string | null;
  person?: string | null;
  unit?: string | null;
  title?: string | null;
  relation?: string | null;
};

const departmentCode = 'ent_b14_f128cdf1dae21223';
const hierarchyCode = 'ent_b14_345b3c5bd988b2d6';
const organizationCode = 'ent_b14_b4d203dea5b9121c';
const sourceLabels: Record<BusinessMapSourceId, string> = {
  platform: '组织档案',
  wecom: '企业微信历史预览（未应用到平台组织）',
};

const activeMembership = `(m.effective_from IS NULL OR m.effective_from <= $2) AND (m.effective_to IS NULL OR m.effective_to > $2)`;
const now = () => new Date().toISOString();

function nonEmpty(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new HttpFail(422, `请提供有效${label}`);
  return value.trim();
}
function optionalText(value: unknown, label: string, maximum = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return nonEmpty(value, label, maximum);
}
function positive(value: unknown, label: string, fallback: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new HttpFail(422, `${label} 必须为 1–${maximum} 的整数`);
  return parsed;
}
function field(key: string, label: string, value: string | null, layout: 'compact' | 'long', width?: 'small' | 'medium' | 'wide'): BusinessMapRecordField {
  return { key, label, value, layout, ...(width ? { width } : {}) };
}
function nullable(value: unknown): string | null {
  if (typeof value !== 'string') return value === null || value === undefined ? null : String(value);
  const trimmed = value.trim();
  return trimmed || null;
}
function opaqueRecordId(companyId: string, entityCode: string, source: BusinessMapSourceId, identity: string): string {
  return `bm_${createHash('sha256').update(`business-map/v1/${companyId}/${entityCode}/${source}/${identity}`).digest('hex').slice(0, 32)}`;
}
function relationLabel(value: string | null | undefined): string | null {
  if (value === 'primary') return '主要归属';
  if (value === 'collaborative') return '协作归属';
  return value === null || value === undefined ? null : '未标注';
}
function organizationUnitTypeLabel(value: string | null | undefined): string {
  // Storage enums are not a browser contract. Unknown values must not turn into
  // a newly exposed internal enum when platform configuration evolves.
  return ({ center: '中心', department: '部门', team: '团队', project_group: '项目组' } as Record<string, string>)[String(value || '')] || '未标注';
}
function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpFail) || !error.detail || typeof error.detail !== 'object' || Array.isArray(error.detail)) return null;
  const code = (error.detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
function safeSourceFailure(): never {
  throw new HttpFail(502, { code: 'business_map_source_read_failed', message: '资料暂时无法读取，请重试' });
}

export class BusinessMapService {
  private readonly ontology: OntologyService;
  private readonly wecom: WecomHistoryReader;

  constructor(private readonly actor: TicketPrincipal, companyId?: string, wecom?: WecomHistoryReader) {
    this.ontology = new OntologyService(actor, companyId);
    this.wecom = wecom || new WecomOntologySourceService(actor);
  }

  private async connected(companyId: string): Promise<boolean> {
    try { return await this.wecom.isConnected(companyId); } catch { return false; }
  }

  async catalog(): Promise<BusinessMapCatalog> {
    // catalog(true) deliberately reuses the existing company-admin context and
    // registered definitions; it is a reading view, not a second ontology pipeline.
    const catalog = await this.ontology.catalog(true);
    return buildBusinessMapCatalog(catalog, { wecomConnected: await this.connected(catalog.context.companyId) });
  }

  private async authorizedEntity(entityCodeInput: string | undefined): Promise<{ companyId: string; entityCode: string }> {
    const entityCode = nonEmpty(entityCodeInput, '业务实体编码', 120);
    const catalog = await this.ontology.catalog(true);
    const found = catalog.objects.find((document) => document.code === entityCode && document.status !== 'disabled' && document.published);
    if (!found) throw new HttpFail(404, { code: 'business_map_entity_not_found', message: '未找到当前公司可读的业务实体' });
    return { companyId: catalog.context.companyId, entityCode };
  }

  private empty(companyId: string, entityCode: string, source: BusinessMapSourceId, status: BusinessMapRecords['status'], note: string, page: number, pageSize: number): BusinessMapRecords {
    // Not-connected and not-read states have no completed query total.  Do not
    // present an invented zero as if it meant the current scope is empty.
    return { companyId, entityCode, source, sourceLabel: sourceLabels[source], status, note, observedAt: null, records: [], total: null, page, pageSize };
  }

  private paginate(records: BusinessMapRecord[], page: number, pageSize: number): { records: BusinessMapRecord[]; total: number } {
    return { records: records.slice((page - 1) * pageSize, page * pageSize), total: records.length };
  }

  private platformRecord(companyId: string, entityCode: string, row: PlatformRow): BusinessMapRecord {
    if (entityCode === 'org_unit' || entityCode === departmentCode) {
      const name = nullable(row.name); const parent = nullable(row.parent); const type = organizationUnitTypeLabel(row.type); const leader = nullable(row.leader);
      return {
        id: opaqueRecordId(companyId, entityCode, 'platform', row.identity), values: { name, parent, type }, fields: [
          field('name', entityCode === departmentCode ? '部门' : '组织单元', name, 'compact', 'wide'),
          field('parent', '上级单元', parent, 'compact', 'wide'),
          field('type', '单元类型', type, 'compact', 'medium'),
          field('leader', '负责人', leader, 'compact', 'wide'),
          field('source_note', '来源说明', '现有组织资料；仅显示当前公司有效组织单元。', 'long'),
        ], links: [{ label: '查看成员关系', entityCode: 'membership', unit: opaqueBusinessMapUnit(companyId, 'platform', row.identity) }],
      };
    }
    if (entityCode === hierarchyCode) {
      const child = nullable(row.name); const parent = nullable(row.parent);
      return {
        id: opaqueRecordId(companyId, entityCode, 'platform', row.identity), values: { child, parent }, fields: [
          field('child', '下级组织单元', child, 'compact', 'wide'),
          field('parent', '上级组织单元', parent, 'compact', 'wide'),
          field('source_note', '来源说明', '由平台有效组织单元的已确认上下级关系生成；部门根节点不会被推断为公司组织。', 'long'),
        ],
      };
    }
    if (entityCode === 'user') {
      const name = nullable(row.person); const unit = nullable(row.unit); const title = nullable(row.title);
      return {
        id: opaqueRecordId(companyId, entityCode, 'platform', row.identity), values: { name, unit, title }, fields: [
          field('name', '通讯录人员', name, 'compact', 'wide'),
          field('unit', '所属组织单元', unit, 'compact', 'wide'),
          field('title', '通讯录职位', title, 'compact', 'medium'),
          field('source_note', '来源说明', '现有组织资料中的人员；人员记录不等同于账号，也不表示 HR 在职状态。', 'long'),
        ],
      };
    }
    const person = nullable(row.person); const unit = nullable(row.unit); const relation = relationLabel(row.relation); const title = nullable(row.title);
    return {
      id: opaqueRecordId(companyId, entityCode, 'platform', row.identity), values: { person, unit, relation }, fields: [
        field('person', '通讯录人员', person, 'compact', 'wide'),
          field('unit', '组织单元', unit, 'compact', 'wide'),
          field('relation', '归属类型', relation, 'compact', 'medium'),
          field('title', '通讯录职位', title, 'compact', 'medium'),
          field('source_note', '来源说明', '成员关系资料；不以账号、姓名或职位推断其他成员关系。', 'long'),
        ], links: row.unitIdentity ? [{ label: '查看组织单元', entityCode: 'org_unit', unit: opaqueBusinessMapUnit(companyId, 'platform', row.unitIdentity) }] : undefined,
      };
  }

  private async platformRows(companyId: string, entityCode: string, query: string | undefined): Promise<PlatformRow[]> {
    const db: Db = postgresPool();
    const pattern = `%${query || ''}%`;
    if (entityCode === 'org_unit' || entityCode === departmentCode) {
      const typeClause = entityCode === departmentCode ? ` AND unit.type='department'` : '';
      const result = await db.query<{ id: string; name: string; parent: string | null; type: string; leader: string | null }>(
        `SELECT unit.id,unit.display_name AS name,parent.display_name AS parent,unit.type,unit.head_display_name AS leader
           FROM organization_units unit LEFT JOIN organization_units parent
             ON parent.id=unit.parent_id AND parent.company_id=unit.company_id AND parent.status='active'
          WHERE unit.company_id=$1 AND unit.status='active'${typeClause}
            AND ($2='' OR unit.display_name ILIKE $3 OR COALESCE(parent.display_name,'') ILIKE $3 OR COALESCE(unit.head_display_name,'') ILIKE $3)
          ORDER BY unit.display_name,unit.id`, [companyId, query || '', pattern]);
      return result.rows.map((row) => ({ identity: row.id, name: row.name, parent: row.parent, type: row.type, leader: row.leader }));
    }
    if (entityCode === hierarchyCode) {
      const result = await db.query<{ id: string; child: string; parent: string }>(
        `SELECT unit.id,unit.display_name AS child,parent.display_name AS parent
           FROM organization_units unit JOIN organization_units parent
             ON parent.id=unit.parent_id AND parent.company_id=unit.company_id AND parent.status='active'
          WHERE unit.company_id=$1 AND unit.status='active'
            AND ($2='' OR unit.display_name ILIKE $3 OR parent.display_name ILIKE $3)
          ORDER BY parent.display_name,unit.display_name,unit.id`, [companyId, query || '', pattern]);
      return result.rows.map((row) => ({ identity: row.id, name: row.child, parent: row.parent }));
    }
    if (entityCode === 'user') {
      const result = await db.query<{ person_ref: string; person: string; unit: string | null; title: string | null }>(
        `SELECT DISTINCT ON (person.person_ref) person.person_ref,person.display_name AS person,unit.display_name AS unit,m.position AS title
           FROM organization_people person JOIN organization_memberships m ON m.person_ref=person.person_ref
           LEFT JOIN organization_units unit ON unit.id=m.org_unit_id AND unit.company_id=m.company_id AND unit.status='active'
          WHERE person.status='active' AND m.company_id=$1 AND m.status='active' AND ${activeMembership}
            AND ($3='' OR person.display_name ILIKE $4 OR COALESCE(unit.display_name,'') ILIKE $4 OR COALESCE(m.position,'') ILIKE $4)
          ORDER BY person.person_ref,m.relation='primary' DESC,m.created_at DESC`, [companyId, now(), query || '', pattern]);
      return result.rows.map((row) => ({ identity: row.person_ref, person: row.person, unit: row.unit, title: row.title }));
    }
    const result = await db.query<{ id: string; person: string; unit: string | null; relation: string; title: string | null; unit_id: string }>(
      `SELECT m.id,person.display_name AS person,unit.display_name AS unit,m.relation,m.position AS title,m.org_unit_id AS unit_id
         FROM organization_memberships m JOIN organization_people person ON person.person_ref=m.person_ref AND person.status='active'
         JOIN organization_units unit ON unit.id=m.org_unit_id AND unit.company_id=m.company_id AND unit.status='active'
        WHERE m.company_id=$1 AND m.status='active' AND ${activeMembership}
          AND ($3='' OR person.display_name ILIKE $4 OR unit.display_name ILIKE $4 OR COALESCE(m.position,'') ILIKE $4)
        ORDER BY unit.display_name,person.display_name,m.id`, [companyId, now(), query || '', pattern]);
    return result.rows.map((row) => ({ identity: row.id, unitIdentity: row.unit_id, person: row.person, unit: row.unit, relation: row.relation, title: row.title }));
  }

  private async platformRecords(companyId: string, entityCode: string, page: number, pageSize: number, query: string | undefined, unit: string | undefined): Promise<BusinessMapRecords> {
    if (!supportsPlatformBusinessMapRecords(entityCode)) return this.empty(companyId, entityCode, 'platform', 'not_connected', '该实体的数据尚未接入', page, pageSize);
    try {
      const projected = (await this.platformRows(companyId, entityCode, query)).map((row) => this.platformRecord(companyId, entityCode, row));
      // unit is opaque; comparison is intentionally server-side after its raw
      // organization key has been withheld from the response.
      const filtered = unit ? projected.filter((record) => record.links?.some((link) => link.unit === unit)) : projected;
      const paged = this.paginate(filtered, page, pageSize);
      return {
        companyId, entityCode, source: 'platform', sourceLabel: sourceLabels.platform, status: 'ready',
        note: paged.total ? '当前公司授权范围内的平台组织资料。' : (query || unit ? '没有符合当前条件的记录' : '当前可见范围暂无记录'),
        observedAt: null, records: paged.records, total: paged.total, page, pageSize,
      };
    } catch (error) {
      if (error instanceof HttpFail) throw error;
      safeSourceFailure();
    }
  }

  private async wecomRecords(companyId: string, entityCode: string, page: number, pageSize: number, query: string | undefined, unit: string | undefined): Promise<BusinessMapRecords> {
    if (!supportsWecomBusinessMapRecords(entityCode)) return this.empty(companyId, entityCode, 'wecom', 'not_connected', '该实体的数据尚未接入', page, pageSize);
    let historical: { createdAt: string; observedAt: string | null; rows: WecomSnapshotRow[] } | null;
    try {
      historical = await this.wecom.historicalPreview(companyId);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'wecom_source_binding_required' || code === 'wecom_source_company_mismatch') {
        return this.empty(companyId, entityCode, 'wecom', 'not_connected', '企业微信来源尚未接入当前公司', page, pageSize);
      }
      if (error instanceof HttpFail && error.status === 403) throw error;
      safeSourceFailure();
    }
    if (!historical) return this.empty(companyId, entityCode, 'wecom', 'not_read', '尚未读取资料', page, pageSize);
    const filtered = filterBusinessMapRecords(projectWecomPreviewRows(companyId, entityCode, historical.rows), query, unit);
    const paged = this.paginate(filtered, page, pageSize);
    return {
      companyId, entityCode, source: 'wecom', sourceLabel: sourceLabels.wecom, status: 'ready',
      note: paged.total ? '当前调用者保存的企业微信历史预览，尚未应用到平台组织。' : (query || unit ? '没有符合当前条件的记录' : '当前可见范围暂无记录'),
      // createdAt is the local preview-save time.  observedAt may only expose
      // the source publication/synchronization observation time.
      observedAt: historical.observedAt, records: paged.records, total: paged.total, page, pageSize,
    };
  }

  async records(input: RecordsInput): Promise<BusinessMapRecords> {
    const page = positive(input.page, 'page', 1, 100_000);
    const pageSize = positive(input.pageSize, 'pageSize', 20, 100);
    const source = nonEmpty(input.source, '来源') as BusinessMapSourceId;
    if (source !== 'platform' && source !== 'wecom') throw new HttpFail(422, '来源必须为 platform 或 wecom');
    const entity = await this.authorizedEntity(input.entityCode);
    const query = optionalText(input.q, '搜索词', 200);
    const unit = optionalText(input.unit, '归属筛选', 200);
    return source === 'platform'
      ? this.platformRecords(entity.companyId, entity.entityCode, page, pageSize, query, unit)
      : this.wecomRecords(entity.companyId, entity.entityCode, page, pageSize, query, unit);
  }
}

export type { RecordsInput, WecomHistoryReader };
