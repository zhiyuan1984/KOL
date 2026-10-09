/**
 * Explicit opt-in only. Never falls back to DATABASE_URL or an existing app DB.
 * Creates a randomly named disposable database, runs the real schema runner in
 * that database, and drops only that database afterward. Not run by mock tests.
 * KNOWLEDGE_TAXONOMY_PG_TEST=1 TEST_DATABASE_URL=postgres://.../test_admin
 *   npx vitest run --config vitest.knowledge-planning.config.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, Pool, type PoolClient } from 'pg';
const state = vi.hoisted(() => ({ pool: null as any }));
vi.mock('../src/auth.js', () => ({ requireAdmin: () => ({ id: 'taxonomy-test-admin' }) }));
vi.mock('../src/postgres/pool.js', () => ({ postgresTransaction: async (fn: (db: PoolClient) => Promise<unknown>) => {
  const db = await state.pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
} }));
import { createCatalogBase, createCatalogDomain, deleteCatalogBase, editCatalogBase } from '../src/knowledge/taxonomy-mutations.js';

const enabled = process.env.KNOWLEDGE_TAXONOMY_PG_TEST === '1' && Boolean(process.env.TEST_DATABASE_URL);
const stamp = '2026-10-08T10:00:00.000Z';
const confirmation = { confirmed: true, expected_updated_at: stamp };
let admin: Client | undefined, disposable = '', created = false;
const insertion = `INSERT INTO knowledge(id,title,body,kind,base_id,status,created_by,created_at,updated_at)
  VALUES('entry','Draft','Test content','policy','base','draft','taxonomy-test-admin',$1,$1)`;

async function waitForMutationLock(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = (await state.pool.query(`SELECT EXISTS(
      SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE a.datname=current_database() AND l.locktype='advisory' AND NOT l.granted
        AND a.query LIKE 'SELECT pg_advisory_xact_lock(%') AS waiting`)).rows[0].waiting;
    if (waiting) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('The catalog mutation never waited for the writer advisory lock');
}

// Both switches are necessary: absent opt-in, not even a connection is opened.
describe.skipIf(!enabled)('taxonomy real PostgreSQL migration and two-connection races (disposable DB)', () => {
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('TEST_DATABASE_URL must be PostgreSQL');
    disposable = `knowledge_taxonomy_test_${randomUUID().replaceAll('-', '')}`;
    admin = new Client({ connectionString: url.toString() }); await admin.connect();
    await admin.query(`CREATE DATABASE "${disposable}"`); created = true;
    url.pathname = `/${disposable}`;
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/apply-postgres-schema.ts'], {
      cwd, env: { ...process.env, DATABASE_URL: url.toString() }, timeout: 120_000, stdio: 'pipe',
    });
    state.pool = new Pool({ connectionString: url.toString(), max: 5 });
    await state.pool.query(`INSERT INTO users(id,username,name,password_hash,roles,active,created_at,updated_at)
      VALUES('taxonomy-test-admin','taxonomy-test-admin','Test admin','test-only-not-a-login','["admin"]',1,$1,$1)`, [stamp]);
  }, 150_000);
  afterAll(async () => {
    if (state.pool) { await state.pool.end(); state.pool = null; }
    if (created && admin && /^knowledge_taxonomy_test_[a-f0-9]{32}$/.test(disposable)) {
      // pg Pool.end() can resolve before the server observes every socket close.
      // Wait for that acknowledgement instead of FORCE-killing closing clients.
      const deadline = Date.now() + 5_000;
      while ((await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1', [disposable])).rowCount) {
        if (Date.now() >= deadline) throw new Error('Disposable test database still has open connections');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await admin.query(`DROP DATABASE "${disposable}"`);
    }
    await admin?.end();
  }, 30_000);
  beforeEach(async () => {
    // This is exclusively the database created above, containing test fixtures.
    await state.pool.query('TRUNCATE knowledge_bindings,skill_knowledge_configs,knowledge,knowledge_versions,knowledge_documents,knowledge_domains,knowledge_bases,execution_jobs,audit_events CASCADE');
    await state.pool.query(`INSERT INTO knowledge_domains(id,code,name,level,parent_id,status,created_at,updated_at)
      VALUES('family','family','Family','family',NULL,'active',$1,$1),('domain','domain','Domain','domain','family','active',$1,$1)`, [stamp]);
    await state.pool.query(`INSERT INTO knowledge_bases(id,code,name,domain_id,kind,status,version,created_at,updated_at)
      VALUES('base','base','Base','domain','structured','active',1,$1,$1)`, [stamp]);
  });
  it('creates catalog nodes with generated codes, defaults, and same-transaction audit receipts', async () => {
    const family = await createCatalogDomain({ name: 'Generated family', level: 'family', code: ' ' });
    expect(family.domain).toMatchObject({ name: 'Generated family', level: 'family', parent_id: null, status: 'active' });
    expect(family.domain.code).toMatch(/^family_[a-f0-9]{32}$/);
    const domain = await createCatalogDomain({ name: 'Generated domain', level: 'domain', parent_id: family.domain.id });
    expect(domain.domain.code).toMatch(/^domain_[a-f0-9]{32}$/);
    const base = await createCatalogBase({ name: 'Generated base', domain_id: domain.domain.id, kind: 'unstructured', settings: { source: 'test' }, external_ref: { library: 'fixture' } });
    expect(base.base).toMatchObject({ domain_id: domain.domain.id, kind: 'unstructured', owner_user_id: 'taxonomy-test-admin', status: 'active', version: 1, settings: { source: 'test' }, external_ref: { library: 'fixture' } });
    expect(base.base.code).toMatch(/^base_[a-f0-9]{32}$/);
    const audits = (await state.pool.query("SELECT event_type,payload FROM audit_events WHERE event_type IN ('knowledge.domain.create','knowledge.base.create')")).rows;
    expect(audits).toHaveLength(3);
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'knowledge.base.create', payload: expect.stringContaining(base.base.code) }),
      expect.objectContaining({ event_type: 'knowledge.domain.create', payload: expect.stringContaining(family.domain.code) }),
      expect.objectContaining({ event_type: 'knowledge.domain.create', payload: expect.stringContaining(domain.domain.code) }),
    ]));
  });
  it('preserves explicit code conflicts and refuses archived parents for newly created nodes', async () => {
    await expect(createCatalogDomain({ name: 'Conflict', level: 'family', code: 'family' })).rejects.toMatchObject({ status: 409, detail: { code: 'knowledge_domain_code_conflict' } });
    await expect(createCatalogBase({ name: 'Conflict', domain_id: 'domain', kind: 'structured', code: 'base' })).rejects.toMatchObject({ status: 409, detail: { code: 'knowledge_base_code_conflict' } });
    await state.pool.query(`INSERT INTO knowledge_domains(id,code,name,level,parent_id,status,created_at,updated_at)
      VALUES('archived-family','archived_family','Archived family','family',NULL,'archived',$1,$1),
        ('archived-domain','archived_domain','Archived domain','domain','family','archived',$1,$1)`, [stamp]);
    await expect(createCatalogDomain({ name: 'Unavailable child', level: 'domain', parent_id: 'archived-family' })).rejects
      .toMatchObject({ status: 409, detail: { code: 'knowledge_taxonomy_parent_unavailable' } });
    await expect(createCatalogBase({ name: 'Unavailable base', domain_id: 'archived-domain', kind: 'structured' })).rejects
      .toMatchObject({ status: 409, detail: { code: 'knowledge_taxonomy_parent_unavailable' } });
  });
  it('validates installed trigger version and commits a deletion with its audit receipt', async () => {
    expect((await state.pool.query('SELECT knowledge_taxonomy_guard_version() AS version')).rows[0].version).toBe(1);
    expect(await deleteCatalogBase('base', confirmation)).toMatchObject({ deleted: true });
    expect((await state.pool.query("SELECT * FROM audit_events WHERE event_type='knowledge.base.delete'")).rowCount).toBe(1);
  });
  it('detects a disabled guard trigger and refuses mutation', async () => {
    await state.pool.query('ALTER TABLE knowledge DISABLE TRIGGER knowledge_taxonomy_asset');
    try { await expect(deleteCatalogBase('base', confirmation)).rejects.toMatchObject({ status: 503 }); }
    finally { await state.pool.query('ALTER TABLE knowledge ENABLE TRIGGER knowledge_taxonomy_asset'); }
  });
  it('writer first: waits for its transaction, then sees committed content and refuses deletion', async () => {
    const writer = await state.pool.connect();
    try {
      await writer.query('BEGIN'); await writer.query(insertion, [stamp]);
      const outcome = deleteCatalogBase('base', confirmation).then(value => ({ value, error: null }), error => ({ value: null, error }));
      await waitForMutationLock();
      await writer.query('COMMIT'); expect((await outcome).error).toMatchObject({ status: 409 });
      expect((await state.pool.query("SELECT 1 FROM knowledge_bases WHERE id='base'")).rowCount).toBe(1);
    } finally { await writer.query('ROLLBACK'); writer.release(); }
  });
  it('delete first: rejects an orphan INSERT even when the writer preflight read was earlier', async () => {
    const writer = await state.pool.connect();
    try {
      await writer.query('BEGIN');
      expect((await writer.query("SELECT status FROM knowledge_bases WHERE id='base'")).rows[0].status).toBe('active');
      await deleteCatalogBase('base', confirmation);
      await expect(writer.query(insertion, [stamp])).rejects.toMatchObject({ code: '23514' });
    } finally { await writer.query('ROLLBACK'); writer.release(); }
  });
  it('archive first: rejects a late wildcard binding matching archived draft content', async () => {
    await state.pool.query(insertion, [stamp]);
    const writer = await state.pool.connect();
    try {
      await writer.query('BEGIN'); await writer.query("SELECT status FROM knowledge_bases WHERE id='base'");
      await editCatalogBase('base', { ...confirmation, expected_version: 1, status: 'archived' });
      await expect(writer.query(`INSERT INTO knowledge_bindings(id,skill_id,selector,created_at,updated_at)
        VALUES('binding','test_skill','{"kinds":["policy"]}',$1,$1)`, [stamp])).rejects.toMatchObject({ code: '23514' });
      expect((await state.pool.query("SELECT status FROM knowledge WHERE id='entry'")).rows[0].status).toBe('draft');
    } finally { await writer.query('ROLLBACK'); writer.release(); }
  });
  it('binding first: archive observes matching wildcard selector after the writer commits', async () => {
    await state.pool.query(insertion, [stamp]);
    const writer = await state.pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`INSERT INTO knowledge_bindings(id,skill_id,selector,created_at,updated_at)
        VALUES('binding','test_skill','{"tags":["support"]}',$1,$1)`, [stamp]);
      await writer.query("UPDATE knowledge SET tags='support' WHERE id='entry'");
      const outcome = editCatalogBase('base', { ...confirmation, expected_version: 1, status: 'archived' })
        .then(value => ({ value, error: null }), error => ({ value: null, error }));
      await waitForMutationLock();
      await writer.query('COMMIT'); expect((await outcome).error).toMatchObject({ status: 409 });
    } finally { await writer.query('ROLLBACK'); writer.release(); }
  });
});
