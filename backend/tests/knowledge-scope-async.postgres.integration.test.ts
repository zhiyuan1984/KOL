import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const configured = Boolean(process.env.TEST_DATABASE_URL?.trim());
const describePostgres = configured ? describe : describe.skip;

describePostgres('knowledge scope async PostgreSQL persistence', () => {
  const database = `scope_async_${randomUUID().replaceAll('-', '')}`;
  const maintenanceUrl = process.env.TEST_DATABASE_URL!;
  let maintenance: Pool;
  let pool: Pool;

  beforeAll(async () => {
    maintenance = new Pool({ connectionString: maintenanceUrl });
    await maintenance.query(`CREATE DATABASE "${database}"`);
    const url = new URL(maintenanceUrl); url.pathname = `/${database}`;
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(`
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, source_path TEXT NOT NULL,
        artifacts JSONB, updated_at TEXT NOT NULL
      );
      CREATE TABLE execution_jobs (id TEXT PRIMARY KEY);
      CREATE TABLE knowledge_document_scopes (
        document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        tenant TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, explanation TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'empty', scope JSONB, fingerprint TEXT NOT NULL,
        source_fingerprint TEXT, job_id TEXT REFERENCES execution_jobs(id), checked_by TEXT,
        checked_at TEXT, updated_at TEXT NOT NULL
      );
      INSERT INTO knowledge_documents(id,status,source_path,artifacts,updated_at)
        VALUES('doc-1','pending_review','source.pdf','{"index":{"doc_id":"before"}}','2026-10-15T09:00:00.000Z');
      INSERT INTO execution_jobs(id) VALUES('job-before-migration');
      INSERT INTO knowledge_document_scopes(document_id,tenant,fingerprint,job_id,updated_at)
        VALUES('doc-1','company','old-fingerprint','job-before-migration','2026-10-15T09:00:00.000Z');
    `);
    const migration = await fs.readFile(new URL('../migrations/043_20261015_knowledge_scope_async.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(`CREATE TRIGGER knowledge_scope_source_changed
      AFTER UPDATE OF source_path,artifacts,status ON knowledge_documents
      FOR EACH ROW EXECUTE FUNCTION invalidate_knowledge_scope()`);
  });

  afterAll(async () => {
    await pool?.end();
    if (maintenance) {
      await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await maintenance.end();
    }
  });

  it('backfills only actual prior queue handoffs, keeping no-intent behavior explicit', async () => {
    const row = (await pool.query(`SELECT scope_handoff_status,scope_handoff_requested_at,scope_progress_done,scope_progress_total
      FROM knowledge_document_scopes WHERE document_id='doc-1'`)).rows[0];
    expect(row).toMatchObject({ scope_handoff_status: 'queued', scope_progress_done: 0, scope_progress_total: null });
    expect(row.scope_handoff_requested_at).toBe('2026-10-15T09:00:00.000Z');
  });

  it('clears automatic intent and old attempt progress atomically when source artifacts change', async () => {
    await pool.query(`UPDATE knowledge_document_scopes
      SET scope_handoff_status='pending',scope_handoff_requested_at='2026-10-15T09:01:00.000Z',scope_handoff_error=NULL,
          scope_progress_done=2,scope_progress_total=5,scope_progress_unit='batches',scope_progress_attempt=1,
          scope_last_progress_at='2026-10-15T09:02:00.000Z'
      WHERE document_id='doc-1'`);
    await pool.query(`UPDATE knowledge_documents SET artifacts='{"index":{"doc_id":"after"}}',updated_at='2026-10-15T09:03:00.000Z' WHERE id='doc-1'`);
    const row = (await pool.query(`SELECT state,job_id,scope_handoff_status,scope_handoff_requested_at,scope_handoff_error,
      scope_progress_done,scope_progress_total,scope_progress_unit,scope_progress_attempt,scope_last_progress_at
      FROM knowledge_document_scopes WHERE document_id='doc-1'`)).rows[0];
    expect(row).toEqual({
      state: 'empty', job_id: null, scope_handoff_status: 'none', scope_handoff_requested_at: null, scope_handoff_error: null,
      scope_progress_done: 0, scope_progress_total: null, scope_progress_unit: 'batches', scope_progress_attempt: 0, scope_last_progress_at: null,
    });
  });

  it('retains a pending authorized handoff through initial normalization and indexing artifacts', async () => {
    await pool.query(`INSERT INTO knowledge_documents(id,status,source_path,updated_at)
      VALUES('initial-doc','draft','initial-source.pptx','2026-10-15T09:00:00Z')`);
    await pool.query(`INSERT INTO knowledge_document_scopes(document_id,tenant,fingerprint,updated_at,scope_handoff_status,scope_handoff_requested_at)
      VALUES('initial-doc','company','initial','2026-10-15T09:00:00Z','pending','2026-10-15T09:00:00Z')`);
    for (const status of ['uploaded', 'normalizing', 'indexing', 'pending_review']) {
      await pool.query(`UPDATE knowledge_documents SET status=$1,artifacts=$2,updated_at=$3 WHERE id='initial-doc'`,
        [status, JSON.stringify({ [status]: { actual: true } }), `2026-10-15T09:01:00Z`]);
      const row = (await pool.query(`SELECT scope_handoff_status,scope_handoff_requested_at,job_id FROM knowledge_document_scopes WHERE document_id='initial-doc'`)).rows[0];
      expect(row).toEqual({ scope_handoff_status: 'pending', scope_handoff_requested_at: '2026-10-15T09:00:00Z', job_id: null });
    }
    await pool.query(`UPDATE knowledge_documents SET source_path='replacement.pptx',status='uploaded',updated_at='2026-10-15T09:02:00Z' WHERE id='initial-doc'`);
    const reset = (await pool.query(`SELECT scope_handoff_status,scope_handoff_requested_at FROM knowledge_document_scopes WHERE document_id='initial-doc'`)).rows[0];
    expect(reset).toEqual({ scope_handoff_status: 'none', scope_handoff_requested_at: null });
  });
});
