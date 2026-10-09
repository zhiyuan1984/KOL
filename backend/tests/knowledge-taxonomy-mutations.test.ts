import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HttpFail } from '../src/host/errors.js';

const test = vi.hoisted(() => ({
  state: {} as any,
  calls: [] as string[],
  transaction: null as any,
  query: null as any,
}));
vi.mock('../src/auth.js', () => ({ requireAdmin: () => {
  if (!test.state.admin) throw new HttpFail(403, 'admin required');
  return { id: 'admin' };
} }));
vi.mock('../src/postgres/pool.js', () => ({ postgresTransaction: (fn: any) => test.transaction(fn) }));
import { knowledgeTaxonomyMutations } from '../src/routers/knowledge-taxonomy.js';
import { knowledgeBindingMatchesRow } from '../src/knowledge/binding-selector.js';

const stamp = '2026-10-08T10:00:00.000Z';
const domain = { id: 'domain', code: 'domain', name: '域', level: 'domain', parent_id: 'family', status: 'active', sort: 0, note: '', updated_at: stamp };
const base = { id: 'base', code: 'base', name: '库', domain_id: 'domain', kind: 'structured', status: 'active', version: 2, settings: '{}', updated_at: stamp };
const confirmed = { confirmed: true, expected_updated_at: stamp };
const app = new Hono();
app.route('/api', knowledgeTaxonomyMutations);
app.onError((error, c) => error instanceof HttpFail ? c.json({ detail: error.detail }, error.status as any) : c.json({ message: error.message }, 500));
async function request(collection: 'domains' | 'bases', method = 'DELETE', body: any = confirmed) {
  const path = method === 'POST'
    ? `/api/admin/knowledge/${collection}`
    : `/api/admin/knowledge/${collection}/${collection === 'domains' ? 'domain' : 'base'}`;
  const response = await app.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}
function changed() { return test.calls.some(sql => /^(DELETE FROM knowledge_(domains|bases)|UPDATE knowledge_(domains|bases))/.test(sql)); }

beforeEach(() => {
  test.calls = [];
  test.state = { admin: true, activeAdmin: true, ready: true, guardVersion: 1, row: { ...domain }, counts: {}, assets: [], refs: [], audits: [], onLock: null, auditFailure: false,
    parents: { family: { id: 'family', level: 'family', status: 'active' }, domain: { ...domain } }, domainCodes: new Set<string>(), baseCodes: new Set<string>() };
  test.query = vi.fn(async (sql: string, args: any[] = []) => {
    test.calls.push(sql);
    let rows: any[] = [];
    if (sql.startsWith('SELECT roles FROM users')) rows = test.state.activeAdmin ? [{ roles: '["admin"]' }] : [];
    else if (sql.includes('to_regprocedure')) rows = [{ ready: test.state.ready }];
    else if (sql === 'SELECT knowledge_taxonomy_guard_version() AS version') rows = [{ version: test.state.guardVersion }];
    else if (sql.startsWith('SET LOCAL')) { /* transaction-local setting */ }
    else if (sql.startsWith('SELECT pg_advisory_xact_lock')) { test.state.onLock?.(); }
    else if (sql.startsWith('SELECT id,level,status,parent_id FROM knowledge_domains WHERE id=$1 FOR UPDATE')) {
      const parent = test.state.parents[args[0]]; rows = parent ? [{ ...parent }] : [];
    }
    else if (sql.startsWith('SELECT id,level,status FROM knowledge_domains WHERE id=$1 FOR UPDATE')) {
      const parent = test.state.parents[args[0]]; rows = parent ? [{ ...parent }] : [];
    }
    else if (sql.startsWith("SELECT 1 FROM knowledge_domains WHERE code=$1 AND COALESCE(parent_id,'')=$2")) {
      rows = test.state.domainCodes.has(args[0]) ? [{ '?column?': 1 }] : [];
    }
    else if (sql.startsWith('SELECT 1 FROM knowledge_bases WHERE code=$1')) {
      rows = test.state.baseCodes.has(args[0]) ? [{ '?column?': 1 }] : [];
    }
    else if (/SELECT \* FROM knowledge_(domains|bases) WHERE id=\$1 FOR UPDATE/.test(sql)) rows = test.state.row ? [{ ...test.state.row }] : [];
    else if (sql.startsWith('SELECT id,base_id,kind')) rows = test.state.assets;
    else if (sql.includes("'binding' AS source")) rows = test.state.refs;
    else if (sql.includes(' AS code,') && sql.includes(' AS count')) {
      const codes = [...sql.matchAll(/(?:SELECT|UNION ALL SELECT) '([^']+)'/g)].map(match => match[1]);
      rows = codes.map(code => ({ code, message: `blocked: ${code}`, count: test.state.counts[code] || 0 }));
    }
    else if (sql.includes("set_config('knowledge.taxonomy_mutation'")) { /* validated mutation token */ }
    else if (sql.startsWith('INSERT INTO knowledge_domains')) {
      test.state.createdDomain = { id: args[0], code: args[1], name: args[2], level: args[3], parent_id: args[4], sort: args[5], status: 'active', note: args[6], created_by: args[7], created_at: args[8], updated_at: args[8] };
      rows = [{ ...test.state.createdDomain }];
    }
    else if (sql.startsWith('INSERT INTO knowledge_bases')) {
      test.state.createdBase = { id: args[0], code: args[1], name: args[2], domain_id: args[3], kind: args[4], description: args[5], owner_user_id: args[6], status: 'active', settings: args[7], external_ref: args[8], version: 1, created_at: args[9], updated_at: args[9] };
      rows = [{ ...test.state.createdBase }];
    }
    else if (sql.startsWith('DELETE FROM knowledge_')) { test.state.row = null; }
    else if (sql.startsWith('SELECT id FROM knowledge_domains') || sql.startsWith('SELECT d.id FROM knowledge_domains')) rows = test.state.parentMissing ? [] : [{ id: 'parent' }];
    else if (sql.startsWith('UPDATE knowledge_domains')) {
      test.state.row = { ...test.state.row, name: args[1], sort: args[2], status: args[3], note: args[4], updated_at: args[5] };
      rows = [{ ...test.state.row }];
    }
    else if (sql.startsWith('UPDATE knowledge_bases')) {
      test.state.row = { ...test.state.row, name: args[1], description: args[2], status: args[3], version: test.state.row.version + 1, updated_at: args[4] };
      rows = [{ ...test.state.row }];
    }
    else if (sql.startsWith('INSERT INTO audit_events')) {
      if (test.state.auditFailure) throw new Error('audit unavailable');
      test.state.audits.push({ actor: args[1], type: args[2], payload: JSON.parse(args[3]) }); rows = [{ id: 7 }];
    }
    else if (sql.startsWith('SELECT b.*,d.name')) rows = [{ ...(test.state.createdBase || test.state.row), entries: 3, domain_name: '域', family_id: 'family', family_name: '族' }];
    else throw new Error(`Unexpected SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  });
  test.transaction = async (fn: any) => {
    test.calls.push('BEGIN');
    const before = structuredClone({ row: test.state.row, audits: test.state.audits });
    try { const result = await fn({ query: test.query }); test.calls.push('COMMIT'); return result; }
    catch (error) { Object.assign(test.state, before); test.calls.push('ROLLBACK'); throw error; }
  };
});

describe('real catalog mutation routes, native service and transaction guards (mocked PostgreSQL)', () => {
  it.each(['domains', 'bases'] as const)('rejects non-admin %s mutation before DB access', async collection => {
    test.state.admin = false;
    expect((await request(collection)).status).toBe(403); expect(test.calls).toEqual([]);
  });
  it.each([null, [], 'invalid'])('rejects a malformed mutation body %o before touching the DB', async body => {
    expect((await request('domains', 'DELETE', body)).status).toBe(400); expect(test.calls).toEqual([]);
  });
  it('rechecks current active administrator inside the transaction', async () => {
    test.state.activeAdmin = false;
    expect((await request('domains')).status).toBe(403); expect(changed()).toBe(false);
  });
  it('creates a family through the native route with a generated stable code and atomic audit', async () => {
    const result = await request('domains', 'POST', { name: '新主题域族', level: 'family' });
    expect(result.status).toBe(201);
    expect(result.body.domain).toMatchObject({ name: '新主题域族', level: 'family', parent_id: null, status: 'active' });
    expect(result.body.domain.code).toMatch(/^family_[a-f0-9]{32}$/);
    expect(test.state.audits[0]).toMatchObject({ actor: 'admin', type: 'knowledge.domain.create', payload: { before: null, after: { code: result.body.domain.code }, confirmed: false } });
    expect(test.calls.findIndex(sql => sql.startsWith('SELECT pg_advisory_xact_lock'))).toBeLessThan(test.calls.findIndex(sql => sql.startsWith('INSERT INTO knowledge_domains')));
  });
  it('keeps an explicit valid domain code and rejects a same-parent conflict', async () => {
    const created = await request('domains', 'POST', { name: '显式编码', level: 'family', code: 'operations' });
    expect(created.status).toBe(201); expect(created.body.domain.code).toBe('operations');
    test.state.domainCodes.add('operations');
    const conflict = await request('domains', 'POST', { name: '冲突', level: 'family', code: 'operations' });
    expect(conflict.status).toBe(409); expect(conflict.body.detail.code).toBe('knowledge_domain_code_conflict');
  });
  it('rejects a new domain below an archived family', async () => {
    test.state.parents.family.status = 'archived';
    const result = await request('domains', 'POST', { name: '子域', level: 'domain', parent_id: 'family' });
    expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_taxonomy_parent_unavailable');
    expect(test.calls.some(sql => sql.startsWith('INSERT INTO knowledge_domains'))).toBe(false);
  });
  it('creates a base through the native route with generated code and legacy-compatible defaults', async () => {
    const result = await request('bases', 'POST', { name: '资料库', domain_id: 'domain', kind: 'unstructured', settings: { mode: 'review' }, external_ref: { library: 'remote' } });
    expect(result.status).toBe(201);
    expect(result.body.base).toMatchObject({ name: '资料库', domain_id: 'domain', kind: 'unstructured', owner_user_id: 'admin', status: 'active', version: 1, settings: { mode: 'review' }, external_ref: { library: 'remote' } });
    expect(result.body.base.code).toMatch(/^base_[a-f0-9]{32}$/);
    expect(test.state.audits[0]).toMatchObject({ type: 'knowledge.base.create', payload: { before: null, after: { code: result.body.base.code }, confirmed: false } });
  });
  it('rejects new bases below an archived domain or family and explicit global code conflicts', async () => {
    test.state.parents.domain.status = 'archived';
    let result = await request('bases', 'POST', { name: '拒绝库', domain_id: 'domain', kind: 'structured' });
    expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_taxonomy_parent_unavailable');
    test.state.parents.domain.status = 'active'; test.state.parents.family.status = 'archived';
    result = await request('bases', 'POST', { name: '拒绝库', domain_id: 'domain', kind: 'structured' });
    expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_taxonomy_parent_unavailable');
    test.state.parents.family.status = 'active'; test.state.baseCodes.add('taken');
    result = await request('bases', 'POST', { name: '冲突库', domain_id: 'domain', kind: 'structured', code: 'taken' });
    expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_base_code_conflict');
  });
  it.each([{}, { confirmed: 'true', expected_updated_at: stamp }, { confirmed: true }])('requires explicit boolean confirmation and current timestamp: %o', async body => {
    expect((await request('domains', 'DELETE', body)).status).toBe(400); expect(changed()).toBe(false);
  });
  it.each([['ready', false], ['guardVersion', 0], ['guardVersion', 2]])('fails closed for missing/disabled/incorrect migration %s', async (key, value) => {
    test.state[key as string] = value;
    const result = await request('domains'); expect(result.status).toBe(503); expect(result.body.detail.code).toBe('knowledge_taxonomy_guard_required'); expect(changed()).toBe(false);
  });
  it('rejects stale confirmation before counting or deleting', async () => {
    const result = await request('domains', 'DELETE', { ...confirmed, expected_updated_at: 'old' });
    expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_taxonomy_version_conflict'); expect(changed()).toBe(false);
  });
  it('rejects an already-deleted node', async () => {
    test.state.row = null; expect((await request('domains')).status).toBe(404); expect(changed()).toBe(false);
  });
  it.each(['child_domains', 'child_bases'])('retains parent with %s including archived children', async code => {
    test.state.counts[code] = 1;
    const result = await request('domains'); expect(result.status).toBe(409); expect(result.body.detail.reasons[0].code).toBe(code); expect(changed()).toBe(false);
  });
  it('deletes an empty leaf and writes its receipt in the same transaction', async () => {
    const result = await request('domains'); expect(result.status).toBe(200); expect(result.body).toMatchObject({ id: 'domain', deleted: true, receipt_id: 7 });
    expect(test.state.row).toBeNull(); expect(test.state.audits[0]).toMatchObject({ actor: 'admin', type: 'knowledge.domain.delete', payload: { before: { id: 'domain', name: '域' }, after: null, confirmed: true } });
    const lockIndex = test.calls.findIndex(sql => sql.startsWith('SELECT pg_advisory_xact_lock'));
    expect(lockIndex).toBeLessThan(test.calls.findIndex(sql => sql.includes('FOR UPDATE'))); expect(test.calls.at(-1)).toBe('COMMIT');
  });
  it('rolls the deletion back when audit persistence fails', async () => {
    test.state.auditFailure = true;
    expect((await request('domains')).status).toBe(500); expect(test.state.row).toEqual(domain); expect(test.calls.at(-1)).toBe('ROLLBACK');
  });
  it('observes a child committed while it waited for the mutation lock', async () => {
    test.state.onLock = () => { test.state.counts.child_domains = 1; };
    expect((await request('domains')).status).toBe(409); expect(changed()).toBe(false);
  });
  it.each(['entries', 'documents', 'versions', 'publication_binding', 'publication_requests', 'publication_applications', 'knowledge_jobs'])('does not delete a base with %s', async code => {
    test.state.row = { ...base }; test.state.counts[code] = 1;
    const result = await request('bases'); expect(result.status).toBe(409); expect(result.body.detail.reasons.some((r: any) => r.code === code)).toBe(true); expect(changed()).toBe(false);
  });
  it('deletes an empty base without touching content/history or cascading', async () => {
    test.state.row = { ...base };
    expect((await request('bases')).status).toBe(200);
    expect(test.calls.filter(sql => sql.startsWith('DELETE'))).toEqual(['DELETE FROM knowledge_bases WHERE id=$1']);
  });
  it.each(['selector', 'published_selector'])('retains bases referenced by skill config %s', async field => {
    test.state.row = { ...base }; test.state.refs = [{ source: 'config', selector: { base_ids: ['elsewhere'] }, [field]: { base_ids: ['base'] } }];
    const result = await request('bases'); expect(result.status).toBe(409); expect(result.body.detail.reasons[0].code).toBe('skill_dependencies');
  });
  it('retains disabled explicit bindings as dependencies', async () => {
    test.state.row = { ...base }; test.state.refs = [{ source: 'binding', enabled: 0, selector: '{"base_ids":["base"]}' }];
    expect((await request('bases')).status).toBe(409);
  });
  it.each(['not json', '{"unexpected_scope":[]}', '{"base_ids":"base"}', '{"kinds":false}'])('fails closed on unresolved selector %s', async selector => {
    test.state.row = { ...base }; test.state.refs = [{ source: 'binding', selector }];
    const result = await request('bases'); expect(result.status).toBe(409); expect(result.body.detail.reasons[0].code).toBe('unresolved_dependencies');
  });
  it('retains external resources instead of silently orphaning them', async () => {
    test.state.row = { ...base, external_ref: '{"library":"external"}' };
    const result = await request('bases'); expect(result.status).toBe(409); expect(result.body.detail.reasons[0].code).toBe('external_reference');
  });
  it('does not mistake an unrelated valid binding for a dependency', async () => {
    test.state.row = { ...base }; test.state.refs = [{ source: 'binding', selector: { base_ids: ['other'] } }];
    expect((await request('bases')).status).toBe(200);
  });
  it('archive requires confirmation, and retains the node and its history', async () => {
    expect((await request('domains', 'PUT', { status: 'archived' })).status).toBe(400);
    expect((await request('domains', 'PUT', { ...confirmed, status: 'archived' })).status).toBe(200);
    expect(test.state.row.status).toBe('archived'); expect(test.state.row.id).toBe('domain');
    expect(test.calls.some(sql => sql.startsWith('DELETE'))).toBe(false); expect(test.state.audits[0].type).toBe('knowledge.domain.archive');
  });
  it.each(['published_entries', 'published_versions', 'published_documents', 'publication_binding', 'pending_entries', 'pending_documents', 'document_jobs', 'publication_applications', 'legacy_publications', 'knowledge_jobs'])('blocks base archival with %s', async code => {
    test.state.row = { ...base }; test.state.counts[code] = 1;
    const result = await request('bases', 'PUT', { ...confirmed, status: 'archived', expected_version: 2 });
    expect(result.status).toBe(409); expect(result.body.detail.reasons.some((r: any) => r.code === code)).toBe(true); expect(changed()).toBe(false);
  });
  it('allows safe draft archival without deleting or modifying the drafts', async () => {
    test.state.row = { ...base }; test.state.assets = [{ id: 'draft', base_id: 'base', kind: 'policy', status: 'draft' }];
    const result = await request('bases', 'PUT', { ...confirmed, status: 'archived', expected_version: 2 });
    expect(result.status).toBe(200); expect(result.body.base).toMatchObject({ status: 'archived', entries: 3, version: 3, domain_name: '域' });
    expect(test.state.assets[0].status).toBe('draft'); expect(test.calls.some(sql => sql.startsWith('DELETE'))).toBe(false);
  });
  it.each([{}, { kinds: ['policy'] }, { tags: ['support'] }, { brand: 'brand-a', lang: 'en' }])('blocks matching wildcard/filter dependencies on retained content: %o', async selector => {
    test.state.row = { ...base }; test.state.assets = [{ id: 'draft', base_id: 'base', kind: 'policy', tags: 'support,price', brand: '*', lang: 'en' }];
    test.state.refs = [{ source: 'binding', selector }];
    const result = await request('bases', 'PUT', { ...confirmed, status: 'archived', expected_version: 2 });
    expect(result.status).toBe(409); expect(result.body.detail.reasons[0].code).toBe('skill_dependencies');
  });
  it('allows unrelated kind/tag/language filters when no row matches', async () => {
    test.state.row = { ...base }; test.state.assets = [{ id: 'draft', base_id: 'base', kind: 'policy', tags: 'price', brand: 'a', lang: 'en' }];
    test.state.refs = [{ source: 'binding', selector: { kinds: ['prompt'] } }, { source: 'binding', selector: { tags: ['other'] } }, { source: 'binding', selector: { lang: 'zh' } }];
    expect((await request('bases', 'PUT', { ...confirmed, status: 'archived', expected_version: 2 })).status).toBe(200);
  });
  it('keeps numeric base optimistic concurrency as well as archive timestamp', async () => {
    test.state.row = { ...base };
    expect((await request('bases', 'PUT', { ...confirmed, status: 'archived', expected_version: 1 })).status).toBe(409); expect(changed()).toBe(false);
  });
  it('rejects reactivation below an archived or missing parent', async () => {
    test.state.row = { ...domain, status: 'archived' }; test.state.parentMissing = true;
    expect((await request('domains', 'PUT', { expected_updated_at: stamp, status: 'active' })).status).toBe(409); expect(changed()).toBe(false);
  });
  it('does not allow ordinary domain edits to omit their expected timestamp', async () => {
    expect((await request('domains', 'PUT', { name: 'renamed' })).status).toBe(400); expect(changed()).toBe(false);
  });
  it('maps a lock/deadlock conflict to a recoverable 409 without blind retry', async () => {
    test.state.onLock = () => { throw Object.assign(new Error('lock timeout'), { code: '55P03' }); };
    const result = await request('domains'); expect(result.status).toBe(409); expect(result.body.detail.code).toBe('knowledge_taxonomy_busy'); expect(changed()).toBe(false);
  });
});

describe('migration source contract (not an executed PostgreSQL integration test)', () => {
  it('installs writer rechecks and verifies complete enabled trigger installation', () => {
    const sql = fs.readFileSync(new URL('../migrations/031_knowledge_taxonomy_guards.sql', import.meta.url), 'utf8');
    expect(sql).toContain("pg_advisory_xact_lock_shared(hashtext('knowledge-taxonomy-mutation-v1'))");
    expect(sql).toContain('knowledge_taxonomy_assert_base'); expect(sql).toContain("t.tgenabled IN ('O','A')");
    expect(sql).toContain('t.tgrelid=to_regclass(e.rel)'); expect(sql).toContain('p.proname=e.function_name');
    expect(sql).not.toMatch(/DELETE FROM|ON DELETE CASCADE|TRUNCATE/i);
    expect(sql).toContain("IF NEW.job_type NOT LIKE 'knowledge.%' THEN RETURN NEW;");
  });
  it('uses shared runtime binding matching, including wildcard brand semantics', () => {
    expect(knowledgeBindingMatchesRow({ brand: 'a', tags: ['x'], lang: 'en' }, { brand: '*', tags: ' x , y', lang: 'en' })).toBe(true);
    expect(knowledgeBindingMatchesRow({ kinds: ['prompt'] }, { kind: 'policy' })).toBe(false);
  });
});
