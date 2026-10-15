import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scopeHash } from '../src/knowledge/scope-contract.js';

// REAL PostgreSQL progress SQL + actual generateScope; deterministic model fixture.
// This does not claim live-model quality, Redis transport, or production execution.
const state = vi.hoisted(() => ({ pool: null as any, observations: [] as any[], modelCalls: 0 }));
vi.mock('../src/postgres/pool.js', () => ({ postgresTransaction: async (callback: any) => {
  const client = await state.pool.connect();
  await client.query('BEGIN');
  try { const result = await callback(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} }));
vi.mock('../src/knowledge-publication/service.js', () => ({ adminDocument: async () => ({ tenant: 'company' }) }));
vi.mock('../src/approval/review-postgres-access.js', () => ({ postgresReviewCompanies: async () => [] }));
vi.mock('../src/execution-jobs/postgres-store.js', () => ({ pgEnqueueExecutionJob: vi.fn() }));
vi.mock('../src/worker/structured-background.js', () => ({ structuredBackground: async (prompt: string) => {
  state.modelCalls++;
  const data = JSON.parse(prompt.slice(prompt.indexOf('数据：') + 3));
  return { summary: '仅覆盖收录资料', entities: [], topics: [{ label: '参数条件', evidence_ids: [data.evidence[0].id] }], question_types: ['overview'], limitations: ['仅限当前资料'], unverified_notes: [] };
} }));
import { generateScope } from '../src/knowledge/scopes.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
(enabled ? describe : describe.skip)('knowledge scope actual PostgreSQL batch progress', () => {
  const database = `scope_progress_${randomUUID().replaceAll('-', '')}`;
  let maintenance: Pool, temp: string, doc: any, job: any;
  beforeAll(async () => {
    maintenance = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await maintenance.query(`CREATE DATABASE "${database}"`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${database}`;
    state.pool = new Pool({ connectionString: url.toString() });
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kol-scope-progress-'));
    const library = path.join(temp, 'library');
    await fs.mkdir(path.join(library, 'docs', 'indexed'), { recursive: true });
    const sourcePath = path.join(temp, 'source.pdf');
    await fs.writeFile(sourcePath, 'actual test source');
    await fs.writeFile(path.join(library, 'docs', 'indexed', 'pages.json'), JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ page_index: i + 1, text: `原件第${i + 1}页参数条件。` + '原文参数'.repeat(3000) }))));
    doc = { id: 'doc', status: 'pending_review', source_path: sourcePath, artifacts: { index: { library, doc_id: 'indexed' } } };
    const sourceFingerprint = scopeHash({ source: scopeHash(Buffer.from('actual test source').toString('base64')), artifacts: doc.artifacts, explanation: '用途' });
    job = { id: 'job', attempts: 1, worker_id: 'worker-1', actor_ref: 'actor', tenant_ref: 'company', payload_json: JSON.stringify({ document_id: 'doc', explanation: '用途', source_fingerprint: sourceFingerprint }) };
    await state.pool.query(`
      CREATE TABLE knowledge_documents(id TEXT PRIMARY KEY,status TEXT,source_path TEXT,artifacts JSONB,updated_at TEXT);
      CREATE TABLE execution_jobs(id TEXT PRIMARY KEY,status TEXT,attempts INTEGER,lease_owner TEXT);
      CREATE TABLE knowledge_publications(document_id TEXT);
      CREATE TABLE knowledge_publication_applications(document_id TEXT,status TEXT);
      CREATE TABLE knowledge_publication_requests(document_id TEXT,instance_id TEXT);
      CREATE TABLE knowledge_document_scopes(document_id TEXT PRIMARY KEY,tenant TEXT,revision INTEGER DEFAULT 1,explanation TEXT,state TEXT DEFAULT 'empty',scope JSONB,fingerprint TEXT,source_fingerprint TEXT,job_id TEXT,updated_at TEXT,checked_by TEXT,checked_at TEXT);
    `);
    await state.pool.query(await fs.readFile(new URL('../migrations/043_20261015_knowledge_scope_async.sql', import.meta.url), 'utf8'));
    await state.pool.query('INSERT INTO knowledge_documents VALUES($1,$2,$3,$4,$5)', [doc.id, doc.status, doc.source_path, doc.artifacts, 'initial']);
    await state.pool.query("INSERT INTO execution_jobs VALUES('job','running',1,'worker-1')");
    await state.pool.query("INSERT INTO knowledge_document_scopes(document_id,tenant,explanation,fingerprint,job_id) VALUES('doc','company','用途','initial','job')");
  });
  afterAll(async () => {
    await state.pool?.end();
    if (maintenance) { await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await maintenance.end(); }
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });
  it('persists only completed batches, with timestamp unchanged by read checkpoints', async () => {
    const checkpoint = async () => {
      const row = (await state.pool.query("SELECT scope_progress_done AS done,scope_progress_total AS total,scope_last_progress_at AS last FROM knowledge_document_scopes WHERE document_id='doc'")).rows[0];
      state.observations.push(row);
    };
    const result = await generateScope(job, checkpoint);
    const end = (await state.pool.query("SELECT state,scope_progress_done AS done,scope_progress_total AS total,scope_last_progress_at AS last FROM knowledge_document_scopes WHERE document_id='doc'")).rows[0];
    expect(state.modelCalls).toBeGreaterThan(1);
    expect(end).toMatchObject({ state: 'candidate', done: state.modelCalls, total: state.modelCalls });
    expect(end.last).toMatch(/^\d{4}-/);
    expect(result).toMatchObject({ status: 'candidate', progress: { done: state.modelCalls, total: state.modelCalls, unit: 'batches' } });
    const progress = state.observations.map(value => value.done);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    for (let i = 1; i < state.observations.length; i++) if (progress[i] === progress[i - 1]) expect(state.observations[i].last).toBe(state.observations[i - 1].last);
  });
  it('rejects stale worker/attempt before it can reset or advance real progress', async () => {
    const before = (await state.pool.query("SELECT scope_progress_done,scope_last_progress_at FROM knowledge_document_scopes WHERE document_id='doc'")).rows[0];
    await state.pool.query("UPDATE execution_jobs SET attempts=2,lease_owner='worker-2' WHERE id='job'");
    await expect(generateScope(job, async () => {})).rejects.toThrow('execution_job_claim_lost_or_cancelled');
    const after = (await state.pool.query("SELECT scope_progress_done,scope_last_progress_at FROM knowledge_document_scopes WHERE document_id='doc'")).rows[0];
    expect(after).toEqual(before);
  });
});
