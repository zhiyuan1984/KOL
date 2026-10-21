import type { PoolClient } from 'pg';
import type { KnowledgeBusinessTaxonomy } from '../../../shared/knowledge-taxonomy.js';
import { HttpFail } from '../host/errors.js';
import { loadOntologyCatalog } from '../ontology/catalog.js';
import { enterpriseTaxonomy } from '../ontology/enterprise.js';

type CatalogNode = KnowledgeBusinessTaxonomy['nodes'][number];
type CatalogFilter = {
  catalogFamilyId?: string;
  catalogDomainId?: string;
  catalogThemeId?: string;
};

export type CanonicalKnowledgeBusinessTaxonomy = Omit<KnowledgeBusinessTaxonomy, 'bindings'>;

/**
 * The knowledge catalog is derived directly from the same versioned source as
 * the ontology workspace. It neither reads nor creates knowledge base rows.
 */
export function canonicalKnowledgeBusinessTaxonomy(): CanonicalKnowledgeBusinessTaxonomy {
  const catalog = loadOntologyCatalog();
  const tree = enterpriseTaxonomy(catalog.objects);
  return { sourceVersion: catalog.sourceVersion, nodes: tree.nodes };
}

export function canonicalThemeIds(nodes = canonicalKnowledgeBusinessTaxonomy().nodes): Set<string> {
  return new Set(nodes.filter(node => node.level === 3).map(node => node.id));
}

function nodeMap(nodes: CatalogNode[]) {
  return new Map(nodes.map(node => [node.id, node]));
}

/**
 * Resolves only IDs present in the static canonical tree. SQL always receives
 * the resulting values as an array parameter; no request value becomes SQL.
 */
export function resolveCatalogThemeIds(
  filter: CatalogFilter,
  nodes = canonicalKnowledgeBusinessTaxonomy().nodes,
): string[] {
  const familyId = String(filter.catalogFamilyId || '').trim();
  const domainId = String(filter.catalogDomainId || '').trim();
  const themeId = String(filter.catalogThemeId || '').trim();
  if (!familyId && !domainId && !themeId) return [];

  const byId = nodeMap(nodes);
  const requireLevel = (id: string, level: number, field: string) => {
    const node = byId.get(id);
    if (!node || node.level !== level) {
      throw new HttpFail(422, { code: 'knowledge_catalog_theme_invalid', message: `${field} 不是当前业务目录节点` });
    }
    return node;
  };
  if (familyId) requireLevel(familyId, 1, 'catalog_family_id');
  if (domainId) requireLevel(domainId, 2, 'catalog_domain_id');
  if (themeId) requireLevel(themeId, 3, 'catalog_theme_id');

  const result: string[] = [];
  for (const theme of nodes.filter(node => node.level === 3)) {
    const domain = theme.parentId ? byId.get(theme.parentId) : undefined;
    const family = domain?.parentId ? byId.get(domain.parentId) : undefined;
    if (!domain || !family) continue;
    if (familyId && family.id !== familyId) continue;
    if (domainId && domain.id !== domainId) continue;
    if (themeId && theme.id !== themeId) continue;
    result.push(theme.id);
  }
  return result;
}

export function catalogPathByTheme(nodes = canonicalKnowledgeBusinessTaxonomy().nodes): Map<string, { familyId: string; domainId: string }> {
  const byId = nodeMap(nodes);
  const paths = new Map<string, { familyId: string; domainId: string }>();
  for (const theme of nodes.filter(node => node.level === 3)) {
    const domain = theme.parentId ? byId.get(theme.parentId) : undefined;
    const family = domain?.parentId ? byId.get(domain.parentId) : undefined;
    if (domain && family) paths.set(theme.id, { familyId: family.id, domainId: domain.id });
  }
  return paths;
}

export async function readKnowledgeBusinessTaxonomy(
  db: PoolClient,
  options: { activeOnly: boolean },
): Promise<KnowledgeBusinessTaxonomy> {
  const canonical = canonicalKnowledgeBusinessTaxonomy();
  const rows = (await db.query(
    `SELECT binding.base_id,binding.theme_id
       FROM knowledge_ontology_theme_bindings binding
       JOIN knowledge_bases base ON base.id=binding.base_id
      WHERE ($1::boolean = false OR base.status='active')
      ORDER BY binding.base_id`,
    [options.activeOnly],
  )).rows as Array<{ base_id: string; theme_id: string }>;
  return {
    ...canonical,
    bindings: rows.map(row => ({ baseId: String(row.base_id), themeId: String(row.theme_id) })),
  };
}

export async function readKnowledgeBusinessTaxonomyForBases(
  db: PoolClient,
  baseIds: string[],
): Promise<KnowledgeBusinessTaxonomy> {
  const canonical = canonicalKnowledgeBusinessTaxonomy();
  if (!baseIds.length) return { ...canonical, bindings: [] };
  const rows = (await db.query(
    `SELECT base_id,theme_id FROM knowledge_ontology_theme_bindings
      WHERE base_id=ANY($1::text[]) ORDER BY base_id`,
    [baseIds],
  )).rows as Array<{ base_id: string; theme_id: string }>;
  return {
    ...canonical,
    bindings: rows.map(row => ({ baseId: String(row.base_id), themeId: String(row.theme_id) })),
  };
}

export async function currentBaseThemeBinding(db: PoolClient, baseId: string): Promise<string | null> {
  const row = (await db.query(
    'SELECT theme_id FROM knowledge_ontology_theme_bindings WHERE base_id=$1',
    [baseId],
  )).rows[0] as { theme_id?: string } | undefined;
  return row?.theme_id ? String(row.theme_id) : null;
}

/** Validates one explicit admin write. An empty string means an audited unmap. */
export function requestedThemeBinding(value: unknown): { provided: boolean; themeId: string | null; sourceVersion: string } {
  const canonical = canonicalKnowledgeBusinessTaxonomy();
  if (value === undefined) return { provided: false, themeId: null, sourceVersion: canonical.sourceVersion };
  if (typeof value !== 'string') {
    throw new HttpFail(422, { code: 'knowledge_catalog_theme_invalid', message: 'ontology_theme_id 必须是当前业务目录主题 ID 或空字符串' });
  }
  const themeId = value.trim();
  if (!themeId) return { provided: true, themeId: null, sourceVersion: canonical.sourceVersion };
  if (!canonicalThemeIds(canonical.nodes).has(themeId)) {
    throw new HttpFail(422, { code: 'knowledge_catalog_theme_invalid', message: 'ontology_theme_id 不是当前业务目录主题' });
  }
  return { provided: true, themeId, sourceVersion: canonical.sourceVersion };
}
