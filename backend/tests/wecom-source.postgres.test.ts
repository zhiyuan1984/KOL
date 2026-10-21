import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePostgresPool, postgresPool } from '../src/postgres/pool.js';
import { freshTestDatabase } from './support/pg.js';
import { WecomOntologySourceService, type WecomOntologyRuntime } from '../src/ontology/wecom-source.js';
import { HttpFail } from '../src/host/errors.js';
import type { TicketPrincipal } from '../src/ticket-domain/auth.js';
import {
  wecomOntologyRuntimeTools,
  type WecomDepartmentRecord,
  type WecomPersonRecord,
  type WecomRemoteEnvelope,
  type WecomRemotePage,
  type WecomRuntimeBinding,
  type WecomSyncStatus,
} from '../../shared/wecom-ontology.js';

const company = 'company:wecom-test';
const otherCompany = 'company:wecom-other';
const stamp = '2026-10-20T00:00:00.000Z';
const opaqueCursor = `opaque:${'x'.repeat(360)}`;
const binding: WecomRuntimeBinding = {
  executionPath: 'platform-sync-skill', agentId: 'agent:platform-sync', skillId: 'wecom_ontology_read', connectorId: 'wecom-mcp',
  tools: wecomOntologyRuntimeTools, bindingFingerprint: `sha256:${'a'.repeat(64)}`,
  bindingVersions: {
    agentSkill: 1, connectorConfig: 1, connectorBinding: 1,
    tools: { syncStatus: { skillTool: 1, policy: 1 }, departments: { skillTool: 1, policy: 1 }, users: { skillTool: 1, policy: 1 } },
  },
};
const admin = (id = 'wecom-admin', roles: string[] = ['admin']): TicketPrincipal => ({
  id, username: id, name: id, email: null, roles, active: true,
});
const sourceTables = ['organization_units', 'organization_people', 'organization_memberships', 'users', 'agent_bindings'] as const;

const department = (id: string, parentId: string | null): WecomDepartmentRecord => ({
  id, parentId, name: `Department ${id}`, nameEn: null, sortOrder: Number(id), leaderUserIds: [], syncedAt: stamp, path: `/${id}`,
  parentUnavailable: false,
});
const alice: WecomPersonRecord = {
  userId: 'alice', name: 'Alice', position: 'Owner', mainDepartmentId: '1', activationStatus: 2,
  directLeaderUserIds: [], syncedAt: stamp,
  departments: [
    { departmentId: '1', sortOrder: 1, isLeader: 1, syncedAt: stamp },
    { departmentId: '2', sortOrder: 2, isLeader: false, syncedAt: stamp },
  ],
};
function envelope<T>(data: T, version = 1): WecomRemoteEnvelope<T> {
  return { source: 'wecom', version, lastSyncedAt: stamp, warnings: [], data, errorCode: null, retryable: false };
}
function status(version = 1, batch = `batch-${version}`): WecomSyncStatus {
  return envelope({
    initialized: true, queryEnabled: true, publishedVersion: version,
    publishedDepartmentBatchId: `department-${batch}`, publishedUserBatchId: `user-${batch}`,
    publishedDepartmentBatch: { id: `department-${batch}`, status: 'SUCCESS' },
    publishedUserBatch: { id: `user-${batch}`, status: 'SUCCESS' }, publishedAt: stamp,
  }, version);
}

class Runtime implements WecomOntologyRuntime {
  readonly departmentCursors: Array<string | undefined> = [];
  readonly userDepartmentIds: number[] = [];
  currentBindingCalls = 0;
  finalStatus: WecomSyncStatus | null = null;
  revoked = false;
  departmentMode: 'complete' | 'loop' | 'missing' | 'total-changed' = 'complete';

  async currentBinding(): Promise<WecomRuntimeBinding> {
    this.currentBindingCalls += 1;
    if (this.revoked) throw new HttpFail(503, { code: 'wecom_runtime_binding_required', message: 'connector revoked' });
    return binding;
  }
  async captureStatus(): Promise<{ binding: WecomRuntimeBinding; syncStatus: WecomSyncStatus }> {
    if (this.revoked) throw new HttpFail(503, { code: 'wecom_runtime_binding_required', message: 'connector revoked' });
    const syncStatus = this.finalStatus && this.departmentCursors.length > 0 ? this.finalStatus : status();
    return { binding, syncStatus };
  }
  async listDepartments(_binding: WecomRuntimeBinding, args: { pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomDepartmentRecord>>> {
    this.departmentCursors.push(args.cursor);
    if (this.departmentMode === 'loop') return envelope({ records: [department('1', null)], total: 2, nextCursor: 'repeat' });
    if (this.departmentMode === 'missing') return envelope({ records: [department('1', null)], total: 2, nextCursor: null });
    if (this.departmentMode === 'total-changed') {
      return args.cursor
        ? envelope({ records: [department('2', null)], total: 3, nextCursor: null })
        : envelope({ records: [department('1', null)], total: 2, nextCursor: 'changed-total' });
    }
    return args.cursor
      ? envelope({ records: [department('2', null)], total: 2, nextCursor: null })
      : envelope({ records: [department('1', null)], total: 2, nextCursor: opaqueCursor });
  }
  async listUsers(_binding: WecomRuntimeBinding, args: { departmentId: number; includeDescendants: true; pageSize: number; cursor?: string }): Promise<WecomRemoteEnvelope<WecomRemotePage<WecomPersonRecord>>> {
    this.userDepartmentIds.push(args.departmentId);
    return envelope({ records: [structuredClone(alice)], total: 1, nextCursor: null });
  }
}

async function businessState() {
  return Object.fromEntries(await Promise.all(sourceTables.map(async (table) => [
    table,
    (await postgresPool().query(`SELECT * FROM ${table}`)).rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ])));
}
async function sourceCounts() {
  const tables = ['ontology_wecom_source_previews', 'ontology_wecom_source_snapshots', 'ontology_wecom_source_external_refs', 'ontology_wecom_source_receipts'];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, Number((await postgresPool().query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]!.count)])));
}
async function preview(runtime = new Runtime(), actor = admin()) {
  const service = new WecomOntologySourceService(actor, runtime);
  return { service, runtime, response: await service.preview({ companyId: company, pageSize: 1, maxRows: 20 }) };
}

beforeAll(async () => {
  await freshTestDatabase({ empty: true });
  const db = postgresPool();
  await db.query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES
    ('wecom-admin','wecom-admin','WeCom Admin','not-a-password','["admin"]','[]','',1,$1,$1),
    ('wecom-member','wecom-member','WeCom Member','not-a-password','["employee"]','[]','',1,$1,$1),
    ('wecom-other-admin','wecom-other-admin','Other Admin','not-a-password','["admin"]','[]','',1,$1,$1)`, [stamp]);
  await db.query(`INSERT INTO organization_people(person_ref,display_name,user_id,status,created_at,updated_at) VALUES
    ('person:wecom-admin','WeCom Admin','wecom-admin','active',$1,$1),
    ('person:wecom-member','WeCom Member','wecom-member','active',$1,$1),
    ('person:wecom-other-admin','Other Admin','wecom-other-admin','active',$1,$1)`, [stamp]);
  await db.query(`INSERT INTO organization_units(id,company_id,display_name,type,level,status,created_at,updated_at) VALUES
    ('unit:wecom', $1, 'WeCom', 'department', 1, 'active', $3, $3),
    ('unit:wecom-other', $2, 'Other', 'department', 1, 'active', $3, $3)`, [company, otherCompany, stamp]);
  await db.query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,status,created_at,updated_at) VALUES
    ('membership:wecom-admin','person:wecom-admin',$1,'unit:wecom','active',$3,$3),
    ('membership:wecom-member','person:wecom-member',$1,'unit:wecom','active',$3,$3),
    ('membership:wecom-other-admin','person:wecom-other-admin',$2,'unit:wecom-other','active',$3,$3)`, [company, otherCompany, stamp]);
  await db.query(`INSERT INTO ontology_wecom_source_bindings
    (source,company_id,connector_id,configured_by,configuration_fingerprint,configured_at) VALUES
    ('wecom',$1,'wecom-mcp','wecom-admin',$2,$3)`, [company, `sha256:${'b'.repeat(64)}`, stamp]);
}, 120_000);
afterAll(async () => { await closePostgresPool(); });

describe('WeCom source over disposable native PostgreSQL', () => {
  it('uses company-scoped active DB administration, preserves all business tables, projects source fields, and commits one immutable snapshot', async () => {
    const before = await businessState();
    const { service, runtime, response } = await preview();
    expect(runtime.departmentCursors).toEqual([undefined, opaqueCursor]);
    expect(runtime.userDepartmentIds).toEqual([1, 2]);
    expect(response.counts).toEqual({ department: 2, person: 1, membership: 2 });
    expect(response.rows.find((row) => row.kind === 'department')?.ontologyProperties.wecom_department_id).toBe(1);
    expect(response.rows.find((row) => row.kind === 'person')?.ontologyProperties.wecom_departments).toEqual([
      { departmentId: 1, sortOrder: 1, isLeader: 1, syncedAt: stamp },
      { departmentId: 2, sortOrder: 2, isLeader: false, syncedAt: stamp },
    ]);
    expect(await businessState()).toEqual(before);

    const receipt = await service.commit({ companyId: company, confirmed: true, previewToken: response.previewToken, contentHash: response.contentHash, commandId: 'commit-once', reason: 'confirm source snapshot' });
    expect(receipt.rowCounts).toEqual({ department: 2, person: 1, membership: 2 });
    expect(await businessState()).toEqual(before);
    expect(await sourceCounts()).toMatchObject({ ontology_wecom_source_previews: 1, ontology_wecom_source_snapshots: 1, ontology_wecom_source_external_refs: 5, ontology_wecom_source_receipts: 1 });

    const replay = await service.commit({ companyId: company, confirmed: true, previewToken: response.previewToken, contentHash: response.contentHash, commandId: 'commit-once', reason: 'confirm source snapshot' });
    expect(replay).toMatchObject({ snapshotId: receipt.snapshotId, replayed: true });
    expect(runtime.currentBindingCalls).toBeGreaterThanOrEqual(2);
    expect((await service.receipt(company, 'commit-once')).receipt).toMatchObject({ receiptId: receipt.receiptId });
    expect((await service.receipt(company, 'unknown-command')).receipt).toBeNull();
    await expect(new WecomOntologySourceService(admin('wecom-member', ['admin']), runtime).receipt(company, 'commit-once')).rejects.toMatchObject({ status: 403 });

    const first = await service.snapshot({ companyId: company, snapshotId: receipt.snapshotId, pageSize: 1 });
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const next = await service.snapshot({ companyId: company, snapshotId: receipt.snapshotId, pageSize: 1, cursor: first.nextCursor! });
    expect(next.rows).toHaveLength(1);
    await expect(service.snapshot({ companyId: company, snapshotId: receipt.snapshotId, cursor: 'tampered' })).rejects.toMatchObject({ status: 400 });
    await expect(new WecomOntologySourceService(admin('wecom-other-admin'), runtime).snapshot({ companyId: otherCompany, snapshotId: receipt.snapshotId })).rejects.toMatchObject({ status: 403 });
    await expect(new WecomOntologySourceService(admin('wecom-member', ['admin']), runtime).snapshot({ companyId: company, snapshotId: receipt.snapshotId })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects unconfirmed, expired, source-changed, malformed-page, looping-page, and changed-total inputs without source writes', async () => {
    const service = new WecomOntologySourceService(admin(), new Runtime());
    await expect(service.commit({ companyId: company, confirmed: false as never, previewToken: 'none', contentHash: `sha256:${'c'.repeat(64)}`, commandId: 'unconfirmed', reason: 'must reject' })).rejects.toMatchObject({ status: 409 });

    for (const mode of ['loop', 'missing', 'total-changed'] as const) {
      const runtime = new Runtime(); runtime.departmentMode = mode;
      await expect(new WecomOntologySourceService(admin(), runtime).preview({ companyId: company, pageSize: 1, maxRows: 20 })).rejects.toMatchObject({ status: mode === 'loop' ? 502 : 502 });
    }

    const expired = await preview();
    await postgresPool().query("UPDATE ontology_wecom_source_previews SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=$1", [expired.response.previewToken]);
    await expect(expired.service.commit({ companyId: company, confirmed: true, previewToken: expired.response.previewToken, contentHash: expired.response.contentHash, commandId: 'expired', reason: 'expired preview' })).rejects.toMatchObject({ status: 409 });

    const changed = await preview();
    changed.runtime.finalStatus = status(2, 'changed');
    await expect(changed.service.commit({ companyId: company, confirmed: true, previewToken: changed.response.previewToken, contentHash: changed.response.contentHash, commandId: 'changed-version', reason: 'changed source' })).rejects.toMatchObject({ status: 409 });

    const corrupt = await preview();
    await postgresPool().query("UPDATE ontology_wecom_source_previews SET payload=jsonb_set(payload,'{rows,0,attributes,name}','\"tampered\"'::jsonb) WHERE id=$1", [corrupt.response.previewToken]);
    await expect(corrupt.service.commit({ companyId: company, confirmed: true, previewToken: corrupt.response.previewToken, contentHash: corrupt.response.contentHash, commandId: 'corrupt', reason: 'corrupt preview' })).rejects.toMatchObject({ status: 409, detail: { code: 'wecom_preview_corrupt' } });

    const revoked = await preview();
    revoked.runtime.revoked = true;
    await expect(revoked.service.snapshot({ companyId: company, snapshotId: 'latest' })).rejects.toMatchObject({ status: 503 });
    await expect(revoked.service.commit({ companyId: company, confirmed: true, previewToken: revoked.response.previewToken, contentHash: revoked.response.contentHash, commandId: 'revoked', reason: 'connector revoked' })).rejects.toMatchObject({ status: 503 });
    expect(await service.receipt(company, 'missing-command')).toEqual({ receipt: null });
  });
});
