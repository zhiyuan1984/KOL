import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePostgresPool, postgresPool } from '../src/postgres/pool.js';
import { freshTestDatabase } from './support/pg.js';
import { BusinessMapService } from '../src/business-map/service.js';
import { managedWecomOntologyRuntime, WecomOntologySourceService, type WecomOntologyRuntime } from '../src/ontology/wecom-source.js';
import { HttpFail } from '../src/host/errors.js';
import { ticketPrincipalFromWorkbenchUser, withTicketPrincipal, type TicketPrincipal } from '../src/ticket-domain/auth.js';
import { businessMapRouter } from '../src/routers/business-map.js';
import { createApp } from '../src/app.js';
import { tokenDigest } from '../src/auth.js';
import {
  wecomOntologyRuntimeTools,
  type WecomDepartmentRecord,
  type WecomPersonRecord,
  type WecomRemoteEnvelope,
  type WecomRemotePage,
  type WecomRuntimeBinding,
  type WecomSyncStatus,
} from '../../shared/wecom-ontology.js';

const company = 'company:business-map';
const otherCompany = 'company:business-map-other';
const stamp = '2026-10-21T00:00:00.000Z';
const admin = (id = 'business-map-admin', roles: string[] = ['admin']): TicketPrincipal => ({ id, username: id, name: id, email: null, roles, active: true });
const binding: WecomRuntimeBinding = {
  executionPath: 'platform-sync-skill', agentId: 'agent:platform-sync', skillId: 'wecom_ontology_read', connectorId: 'wecom-mcp',
  tools: wecomOntologyRuntimeTools, bindingFingerprint: `sha256:${'a'.repeat(64)}`,
  bindingVersions: { agentSkill: 1, connectorConfig: 1, connectorBinding: 1, tools: { syncStatus: { skillTool: 1, policy: 1 }, departments: { skillTool: 1, policy: 1 }, users: { skillTool: 1, policy: 1 } } },
};
function envelope<T>(data: T): WecomRemoteEnvelope<T> { return { source: 'wecom', version: 1, lastSyncedAt: stamp, warnings: [], data, errorCode: null, retryable: false }; }
function status(): WecomSyncStatus {
  return envelope({ initialized: true, queryEnabled: true, publishedVersion: 1, publishedDepartmentBatchId: 'departments-v1', publishedUserBatchId: 'users-v1', publishedDepartmentBatch: { id: 'departments-v1', status: 'SUCCESS' }, publishedUserBatch: { id: 'users-v1', status: 'SUCCESS' }, publishedAt: stamp });
}
class Runtime implements WecomOntologyRuntime {
  revoked = false;
  async currentBinding(): Promise<WecomRuntimeBinding> { if (this.revoked) throw new HttpFail(503, { code: 'wecom_runtime_binding_required', message: 'revoked' }); return binding; }
  async captureStatus(): Promise<{ binding: WecomRuntimeBinding; syncStatus: WecomSyncStatus }> { await this.currentBinding(); return { binding, syncStatus: status() }; }
  async listDepartments(_binding: WecomRuntimeBinding, _args: { pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomDepartmentRecord>>> {
    return envelope({ total: 2, nextCursor: null, records: [
      { id: '1', parentId: null, name: '企业微信根部门', nameEn: null, sortOrder: 1, leaderUserIds: [], syncedAt: stamp, path: '/1', parentUnavailable: false },
      { id: '2', parentId: '1', name: '企业微信推广部', nameEn: null, sortOrder: 2, leaderUserIds: ['alice'], syncedAt: stamp, path: '/1/2', parentUnavailable: false },
    ] });
  }
  async listUsers(_binding: WecomRuntimeBinding, _args: { departmentId: number; includeDescendants: true; pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomPersonRecord>>> {
    return envelope({ total: 1, nextCursor: null, records: [{ userId: 'alice', name: '企微 Alice', position: '运营', mainDepartmentId: '2', activationStatus: 2, directLeaderUserIds: [], syncedAt: stamp, departments: [{ departmentId: '2', sortOrder: 1, isLeader: 1, syncedAt: stamp }] }] });
  }
}

const readOnlyTables = [
  'ticket_accounts',
  'workbench_principal_bindings',
  'workbench_principal_binding_events',
  'runtime_bootstrap_migrations',
  'runtime_agent_skills',
  'skill_lifecycle',
  'audit_events',
] as const;

async function readOnlyState(): Promise<Record<(typeof readOnlyTables)[number], unknown>> {
  const db = postgresPool();
  const entries = await Promise.all(readOnlyTables.map(async (table) => {
    // This is a complete, canonically ordered row snapshot, rather than a count.
    const result = await db.query<{ snapshot: unknown }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS snapshot FROM ${table} t`,
    );
    return [table, result.rows[0]?.snapshot ?? []] as const;
  }));
  return Object.fromEntries(entries) as Record<(typeof readOnlyTables)[number], unknown>;
}

type MutableClient = {
  query: (...args: unknown[]) => unknown;
  release: (...args: unknown[]) => unknown;
};
type MutablePool = {
  query: (...args: unknown[]) => unknown;
  connect: (...args: unknown[]) => Promise<MutableClient>;
};

function statementText(args: unknown[]): string {
  const statement = args[0];
  if (typeof statement === 'string') return statement;
  if (statement && typeof statement === 'object' && 'text' in statement) return String(statement.text || '');
  return '';
}

/** Records every application SQL call including transaction-scoped client calls. */
async function observeWrites<T>(action: () => Promise<T>): Promise<{ result: T; writes: string[] }> {
  const pool = postgresPool() as unknown as MutablePool;
  const writes: string[] = [];
  const observe = (args: unknown[]) => {
    const sql = statementText(args);
    if (/\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke)\b/i.test(sql)) writes.push(sql);
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (...args) => { observe(args); return originalQuery.apply(pool, args); };
  const instrument = (client: MutableClient): MutableClient => {
    const originalClientQuery = client.query;
    const originalRelease = client.release;
    client.query = (...queryArgs) => { observe(queryArgs); return originalClientQuery.apply(client, queryArgs); };
    client.release = (...releaseArgs) => {
      client.query = originalClientQuery;
      client.release = originalRelease;
      return originalRelease.apply(client, releaseArgs);
    };
    return client;
  };
  pool.connect = ((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === 'function') {
      const callbackArgs = [...args.slice(0, -1), (error: unknown, client?: MutableClient, ...rest: unknown[]) =>
        callback(error, client ? instrument(client) : client, ...rest)];
      return originalConnect.apply(pool, callbackArgs);
    }
    return Promise.resolve(originalConnect.apply(pool, args)).then(instrument);
  }) as MutablePool['connect'];
  try {
    return { result: await action(), writes };
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

async function sessionCookie(userId: string, token: string): Promise<string> {
  await postgresPool().query(
    'INSERT INTO auth_sessions(id_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)',
    [tokenDigest(token), userId, '2099-01-01T00:00:00.000Z', stamp],
  );
  return `lingong_session=${token}`;
}

async function seed(): Promise<void> {
  const db = postgresPool();
  await db.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES
    ('business-map-admin','business-map-admin','Map Admin','x','["admin"]','[]','',1,$1,$1),
    ('business-map-second-admin','business-map-second-admin','Second Map Admin','x','["admin"]','[]','',1,$1,$1),
    ('business-map-employee','business-map-employee','Map Employee','x','["employee"]','[]','',1,$1,$1),
    ('business-map-other-admin','business-map-other-admin','Other Admin','x','["admin"]','[]','',1,$1,$1),
    ('business-map-inactive','business-map-inactive','Inactive Map Admin','x','["admin"]','[]','',0,$1,$1)`, [stamp]);
  await db.query(`INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at) VALUES
    ('person:map-admin','Map Admin','business-map-admin','active',$1,$1),
    ('person:map-second-admin','Second Map Admin','business-map-second-admin','active',$1,$1),
    ('person:map-employee','Map Employee','business-map-employee','active',$1,$1),
    ('person:map-alice','Alice',NULL,'active',$1,$1),
    ('person:map-bob','Bob',NULL,'active',$1,$1),
    ('person:map-other','Other Admin','business-map-other-admin','active',$1,$1)`, [stamp]);
  await db.query(`INSERT INTO organization_units(id,company_id,display_name,type,parent_id,level,status,created_at,updated_at) VALUES
    ('unit:map-root',$1,'业务地图中心','center',NULL,1,'active',$3,$3),
    ('unit:map-promo',$1,'推广部','department','unit:map-root',2,'active',$3,$3),
    ('unit:map-market',$1,'市场部','department','unit:map-root',2,'active',$3,$3),
    ('unit:map-other',$2,'其他公司','department',NULL,1,'active',$3,$3)`, [company, otherCompany, stamp]);
  await db.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,position,status,effective_from,created_at,updated_at) VALUES
    ('membership:map-admin','person:map-admin',$1,'unit:map-root','primary','管理员','active',$3,$3,$3),
    ('membership:map-second-admin','person:map-second-admin',$1,'unit:map-root','primary','管理员','active',$3,$3,$3),
    ('membership:map-employee','person:map-employee',$1,'unit:map-root','primary','员工','active',$3,$3,$3),
    ('membership:map-alice','person:map-alice',$1,'unit:map-promo','primary','推广运营','active',$3,$3,$3),
    ('membership:map-bob','person:map-bob',$1,'unit:map-market','collaborative','市场运营','active',$3,$3,$3),
    ('membership:map-other','person:map-other',$2,'unit:map-other','primary','管理员','active',$3,$3,$3)`, [company, otherCompany, stamp]);
  await db.query(`INSERT INTO ontology_wecom_source_bindings(source,company_id,connector_id,configured_by,configuration_fingerprint,configured_at)
    VALUES('wecom',$1,'wecom-mcp','business-map-admin',$2,$3)`, [company, `sha256:${'b'.repeat(64)}`, stamp]);
}

beforeAll(async () => { await freshTestDatabase({ empty: true }); await seed(); }, 120_000);
afterAll(async () => { await closePostgresPool(); });

describe('business-map on isolated PostgreSQL', () => {
  it('keeps cold runtime reads fail-closed and authenticated catalog/records GETs free of principal or runtime writes', async () => {
    const coldBefore = await readOnlyState();
    const cold = await observeWrites(async () => {
      await expect(managedWecomOntologyRuntime.currentBinding({ readonly: true })).rejects.toMatchObject({
        status: 503, detail: { code: 'wecom_runtime_binding_required' },
      });
      const catalog = await new BusinessMapService(admin(), company).catalog();
      const records = await new BusinessMapService(admin(), company).records({ entityCode: 'org_unit', source: 'platform' });
      return { catalog, records };
    });
    expect(cold.writes).toEqual([]);
    expect(cold.result.catalog.groups).not.toHaveLength(0);
    expect(cold.result.records).toMatchObject({ status: 'ready', sourceLabel: '组织档案' });
    expect(coldBefore.runtime_bootstrap_migrations).toEqual([]);
    expect(await readOnlyState()).toEqual(coldBefore);

    // Full app startup is intentionally outside the read-only observation: it
    // has its established explicit bootstrap responsibilities.  The baseline
    // below is therefore the state immediately before browser GETs.
    const previousAuthMode = process.env.AUTH_MODE;
    process.env.AUTH_MODE = 'enabled';
    try {
      const app = await createApp();
      const adminCookie = await sessionCookie('business-map-admin', 'business-map-admin-cookie');
      const employeeCookie = await sessionCookie('business-map-employee', 'business-map-employee-cookie');
      const inactiveCookie = await sessionCookie('business-map-inactive', 'business-map-inactive-cookie');
      expect(ticketPrincipalFromWorkbenchUser({
        id: 'business-map-admin', username: 'business-map-admin', name: 'Map Admin', email: '', roles: ['admin', 'admin'], active: true,
      })).toEqual({ id: 'business-map-admin', username: 'business-map-admin', name: 'Map Admin', email: null, roles: ['admin'], active: true });

      const beforeGets = await readOnlyState();
      const requests = await observeWrites(async () => {
        const catalog = await app.request('/api/business-map/catalog', { headers: { Cookie: adminCookie } });
        const records = await app.request('/api/business-map/records?entityCode=org_unit&source=platform&pageSize=1', { headers: { Cookie: adminCookie } });
        const employee = await app.request('/api/business-map/catalog', { headers: { Cookie: employeeCookie } });
        const wrongCompany = await app.request(`/api/business-map/catalog?companyId=${encodeURIComponent(otherCompany)}`, { headers: { Cookie: adminCookie } });
        const inactive = await app.request('/api/business-map/catalog', { headers: { Cookie: inactiveCookie } });
        return { catalog, records, employee, wrongCompany, inactive };
      });

      expect(requests.writes).toEqual([]);
      expect(requests.result.catalog.status).toBe(200);
      expect(await requests.result.catalog.json()).toMatchObject({ context: { companyId: company } });
      expect(requests.result.records.status).toBe(200);
      expect(await requests.result.records.json()).toMatchObject({ sourceLabel: '组织档案', status: 'ready' });
      // Current active status, admin role, and current-company scope continue
      // to come from their existing authoritative tables; no DTO bypass exists.
      expect(requests.result.employee.status).toBe(403);
      expect(requests.result.wrongCompany.status).toBe(403);
      expect(requests.result.inactive.status).toBe(401);
      expect(await readOnlyState()).toEqual(beforeGets);
    } finally {
      if (previousAuthMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousAuthMode;
    }
  }, 120_000);

  it('keeps platform records company-isolated, projects no internal IDs, and applies search, opaque unit filter and pagination on the server', async () => {
    const service = new BusinessMapService(admin(), company);
    await expect(new BusinessMapService(admin()).catalog()).resolves.toMatchObject({ context: { companyId: company } });
    const endpoint = await withTicketPrincipal(admin(), () => businessMapRouter.request('/business-map/records?entityCode=org_unit&source=platform&q=%E6%8E%A8%E5%B9%BF&pageSize=1'));
    expect(endpoint.status).toBe(200);
    await expect(endpoint.json()).resolves.toMatchObject({ companyId: company, entityCode: 'org_unit', status: 'ready', total: 1 });
    const units = await service.records({ entityCode: 'org_unit', source: 'platform', q: '推广', pageSize: 1 });
    expect(units).toMatchObject({ companyId: company, entityCode: 'org_unit', status: 'ready', total: 1 });
    expect(units.sourceLabel).toBe('组织档案');
    expect(units.records[0]?.values.type).toBe('部门');
    expect(units.records[0]?.fields.find((item) => item.key === 'source_note')?.value).toBe('现有组织资料；仅显示当前公司有效组织单元。');
    expect(JSON.stringify(units)).not.toContain('"department"');
    const unitFilter = units.records[0]?.links?.find((link) => link.entityCode === 'membership')?.unit;
    expect(unitFilter).toMatch(/^bm_[a-f0-9]{32}$/);

    const memberships = await service.records({ entityCode: 'membership', source: 'platform', unit: unitFilter, pageSize: 10 });
    expect(memberships.records).toHaveLength(1);
    expect(memberships.records[0]?.values).toMatchObject({ person: 'Alice', unit: '推广部', relation: '主要归属' });
    expect(memberships.records[0]?.fields.find((item) => item.key === 'source_note')?.value).toBe('成员关系资料；不以账号、姓名或职位推断其他成员关系。');
    const serialized = JSON.stringify(memberships);
    expect(serialized).not.toContain('membership:map-alice');
    expect(serialized).not.toContain('person:map-alice');
    expect(serialized).not.toContain('unit:map-promo');

    const secondPage = await service.records({ entityCode: 'membership', source: 'platform', page: 2, pageSize: 1 });
    expect(secondPage).toMatchObject({ total: 5, page: 2, pageSize: 1 });
    expect(secondPage.records).toHaveLength(1);
    await expect(new BusinessMapService(admin(), otherCompany).catalog()).rejects.toMatchObject({ status: 403 });
    await expect(new BusinessMapService(admin('business-map-employee', ['employee']), company).catalog()).rejects.toMatchObject({ status: 403 });
  });

  it('reports not-connected rather than inventing responsibility records', async () => {
    const result = await new BusinessMapService(admin(), company).records({ entityCode: 'responsibility', source: 'platform' });
    expect(result).toMatchObject({ status: 'not_connected', note: '该实体的数据尚未接入', records: [], total: null });
    const unbound = await new BusinessMapService(admin('business-map-other-admin'), otherCompany)
      .records({ entityCode: 'org_unit', source: 'wecom' });
    expect(unbound).toMatchObject({ status: 'not_connected', note: '企业微信来源尚未接入当前公司', records: [], total: null });
  });

  it('reads an expired caller-owned historical preview without importing it and does not share a snapshot', async () => {
    const runtime = new Runtime();
    const source = new WecomOntologySourceService(admin(), runtime);
    const preview = await source.preview({ companyId: company, pageSize: 20, maxRows: 20 });
    await postgresPool().query("UPDATE ontology_wecom_source_previews SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1", [preview.previewToken]);
    // A locally saved preview time must never be rendered as the older source
    // data collection time.  Use deliberately different dates as a regression.
    await postgresPool().query(`UPDATE ontology_wecom_source_previews
      SET created_at='2026-10-21T12:00:00.000Z', source_version_json=jsonb_set(source_version_json,'{lastSyncedAt}','"2026-03-01T08:30:00+08:00"'::jsonb)
      WHERE id=$1`, [preview.previewToken]);
    const before = await postgresPool().query<{ snapshots: string; refs: string }>(`SELECT
      (SELECT count(*)::text FROM ontology_wecom_source_snapshots) AS snapshots,
      (SELECT count(*)::text FROM ontology_wecom_source_external_refs) AS refs`);

    const result = await new BusinessMapService(admin(), company, source).records({ entityCode: 'membership', source: 'wecom', q: '企微 Alice' });
    expect(result).toMatchObject({ status: 'ready', observedAt: '2026-03-01T00:30:00.000Z', total: 1 });
    expect(result.note).toContain('历史预览');
    expect(JSON.stringify(result)).not.toContain(preview.contentHash);
    expect(JSON.stringify(result)).not.toContain(preview.previewToken);
    const after = await postgresPool().query<{ snapshots: string; refs: string }>(`SELECT
      (SELECT count(*)::text FROM ontology_wecom_source_snapshots) AS snapshots,
      (SELECT count(*)::text FROM ontology_wecom_source_external_refs) AS refs`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('returns not-read before a caller has preview history, rechecks runtime availability, and rejects after active administration is revoked', async () => {
    const secondaryRuntime = new Runtime();
    const secondarySource = new WecomOntologySourceService(admin('business-map-second-admin'), secondaryRuntime);
    // A preview saved by the first administrator exists from the preceding test,
    // but is never visible to a different valid administrator in this company.
    await expect(new BusinessMapService(admin('business-map-second-admin'), company, secondarySource).records({ entityCode: 'org_unit', source: 'wecom' }))
      .resolves.toMatchObject({ status: 'not_read', records: [], total: null });

    const runtime = new Runtime();
    const source = new WecomOntologySourceService(admin('business-map-other-admin'), runtime);
    // This actor has a different company membership, so it cannot read another company or any preview saved by the first admin.
    await expect(new BusinessMapService(admin('business-map-other-admin'), company, source).records({ entityCode: 'org_unit', source: 'wecom' })).rejects.toMatchObject({ status: 403 });

    const primaryRuntime = new Runtime();
    const primarySource = new WecomOntologySourceService(admin(), primaryRuntime);
    primaryRuntime.revoked = true;
    await expect(new BusinessMapService(admin(), company, primarySource).records({ entityCode: 'org_unit', source: 'wecom' })).rejects.toMatchObject({
      status: 502, detail: { code: 'business_map_source_read_failed', message: '资料暂时无法读取，请重试' },
    });

    await postgresPool().query("UPDATE organization_memberships SET status='ended' WHERE id='membership:map-admin'");
    await expect(new BusinessMapService(admin(), company).records({ entityCode: 'org_unit', source: 'platform' })).rejects.toMatchObject({ status: 403 });
  });
});
