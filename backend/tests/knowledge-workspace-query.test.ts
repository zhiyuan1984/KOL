import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/postgres/pool.js', () => ({ postgresTransaction: vi.fn() }));
vi.mock('../src/approval/review-postgres-access.js', () => ({ postgresReviewContext: vi.fn() }));
import { buildUnion, filterWhere, parseWorkspaceFilter, workspaceStats, type NormFilter, DOC_COLS, ROW_COLS } from '../src/knowledge/workspace.js';
const filter = (input: Record<string, string> = {}): NormFilter => parseWorkspaceFilter(input) as NormFilter;

describe('workspace knowledge entry/document SQL regression', () => {
  it('uses literal document kind instead of nonexistent k.kind', () => {
    const result = filterWhere(filter({ kind: 'document' }), false, 3);
    expect(result.sql).toBe(" AND ('document' = $3)"); expect(result.params).toEqual(['document']);
  });
  it('retains kind filtering for entries', () => {
    const result = filterWhere(filter({ kind: 'policy' }), true, 3);
    expect(result.sql).toContain('k.kind = $3'); expect(result.params).toEqual(['policy']);
  });
  it('projects documents as unbranded/unscoped without querying absent columns', () => {
    const result = filterWhere(filter({ brands: 'a', stages: 'INITIAL_CONTACT' }), false, 3);
    expect(result.sql).toBe(''); expect(result.params).toEqual([]);
  });
  it('preserves permission predicates and sequential parameter numbering in mixed UNION', () => {
    const result = buildUnion({ ids: ['admin'], tenant: 'company' }, filter({ kind: 'policy', brands: 'a', stages: 'INITIAL_CONTACT', base_id: 'base', q: '50%' }), null, entry => entry ? ROW_COLS : DOC_COLS);
    const [entry, document] = result.sql.split(' UNION ALL SELECT ');
    expect(entry).toContain('k.kind'); expect(document).not.toMatch(/k\.(kind|brand|stage_codes|expires_at)/);
    expect(document).toContain('knowledge_publication_applications'); expect(document).toContain('p.tenant<>$2');
    const placeholders = [...result.sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
    expect(Math.max(...placeholders)).toBe(result.params.length); expect(result.params).toContain('%50\\%%');
  });
  it('facet kind skip removes only that filter on both asset branches', () => {
    const result = buildUnion({ ids: ['admin'], tenant: 'company' }, filter({ kind: 'document', base_id: 'base' }), 'kind', entry => entry ? ROW_COLS : DOC_COLS);
    expect(result.params).not.toContain('document'); expect(result.params.filter(p => p === 'base')).toHaveLength(2);
  });
  it('names the status expression before workspace statistics group by u.status', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await workspaceStats({ query } as any, { ids: ['admin'], tenant: 'company' });
    const sql = (query.mock.calls as any)[0][0] as string;
    expect(sql).toContain('END AS status'); expect(sql).toContain('SELECT k.status AS status');
  });
});
