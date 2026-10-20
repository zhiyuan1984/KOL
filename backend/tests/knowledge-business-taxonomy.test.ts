import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/postgres/pool.js', () => ({ postgresTransaction: vi.fn() }));
vi.mock('../src/approval/review-postgres-access.js', () => ({ postgresReviewContext: vi.fn() }));

import { HttpFail } from '../src/host/errors.js';
import { loadOntologyCatalog } from '../src/ontology/catalog.js';
import { enterpriseTaxonomy } from '../src/ontology/enterprise.js';
import {
  canonicalKnowledgeBusinessTaxonomy,
  readKnowledgeBusinessTaxonomyForBases,
  requestedThemeBinding,
  resolveCatalogThemeIds,
} from '../src/knowledge/business-taxonomy.js';
import {
  DOC_COLS,
  ROW_COLS,
  buildUnion,
  facetCounts,
  normalizeWorkspaceFilter,
} from '../src/knowledge/workspace.js';

describe('knowledge business taxonomy canonical tree and mapping', () => {
  const canonical = canonicalKnowledgeBusinessTaxonomy();
  const firstTheme = canonical.nodes.find(node => node.level === 3)!.id;

  it('uses the exact ontology loader and enterprise tree source (18/153/354)', () => {
    const ontology = loadOntologyCatalog();
    const enterprise = enterpriseTaxonomy(ontology.objects);
    expect(canonical.sourceVersion).toBe(ontology.sourceVersion);
    expect(canonical.nodes).toEqual(enterprise.nodes);
    expect(canonical.nodes.filter(node => node.level === 1)).toHaveLength(18);
    expect(canonical.nodes.filter(node => node.level === 2)).toHaveLength(153);
    expect(canonical.nodes.filter(node => node.level === 3)).toHaveLength(354);
  });

  it('keeps legacy bases unmapped and never synthesizes a taxonomy base', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as any;
    const result = await readKnowledgeBusinessTaxonomyForBases(db, ['kbase_legacy']);
    expect(result.bindings).toEqual([]);
    expect(result.nodes.filter(node => node.level === 3)).toHaveLength(354);
    expect(db.query.mock.calls[0][1]).toEqual([['kbase_legacy']]);
  });

  it('retains every canonical theme as a zero-valued facet when no mapping exists', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as any;
    const facets = await facetCounts(db, { ids: ['allowed-user'], tenant: 'tenant-a' }, normalizeWorkspaceFilter({}));
    expect(facets.catalog_theme.all).toBe(0);
    expect(Object.keys(facets.catalog_theme.values)).toHaveLength(354);
    expect(Object.values(facets.catalog_theme.values).every(value => value === 0)).toBe(true);
    expect(Object.keys(facets.catalog_family.values)).toHaveLength(18);
    expect(Object.keys(facets.catalog_domain.values)).toHaveLength(153);
  });

  it('uses a parameterized EXISTS predicate for a canonical theme subtree', () => {
    const filter = normalizeWorkspaceFilter({ catalogThemeId: firstTheme });
    const result = buildUnion({ ids: ['allowed-user'], tenant: 'tenant-a' }, filter, null, entry => entry ? ROW_COLS : DOC_COLS);
    expect(result.sql).toContain('EXISTS(SELECT 1 FROM knowledge_ontology_theme_bindings catalog_binding');
    expect(result.sql).toContain('catalog_binding.theme_id=ANY($3::text[])');
    expect(result.params[2]).toEqual([firstTheme]);
  });

  it('rejects invalid current-tree theme IDs instead of interpolating request text in SQL', () => {
    expect(() => normalizeWorkspaceFilter({ catalogThemeId: "theme_x'); DROP TABLE knowledge; --" })).toThrow(HttpFail);
    try {
      normalizeWorkspaceFilter({ catalogThemeId: 'theme_not_current' });
    } catch (error) {
      expect(error).toMatchObject({ status: 422, detail: { code: 'knowledge_catalog_theme_invalid' } });
    }
    expect(() => requestedThemeBinding('theme_not_current')).toThrow(HttpFail);
  });

  it('preserves workspace organization/tenant permission predicates when catalog mapping filters apply', () => {
    const filter = normalizeWorkspaceFilter({ catalogThemeId: firstTheme });
    const result = buildUnion({ ids: ['allowed-user'], tenant: 'tenant-a' }, filter, null, entry => entry ? ROW_COLS : DOC_COLS);
    expect(result.sql).toContain('k.created_by=ANY($1::text[])');
    expect(result.sql).toContain("p.tenant<>$2");
    expect(result.sql).toContain('(binding.tenant IS NULL OR binding.tenant=$2)');
  });

  it('validates a real canonical theme and treats empty input as explicit unmapping', () => {
    expect(resolveCatalogThemeIds({ catalogThemeId: firstTheme })).toEqual([firstTheme]);
    expect(requestedThemeBinding(firstTheme)).toMatchObject({ provided: true, themeId: firstTheme });
    expect(requestedThemeBinding('')).toMatchObject({ provided: true, themeId: null });
  });
});
