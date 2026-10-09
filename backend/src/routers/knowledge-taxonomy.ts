import { Hono, type Context } from 'hono';
import { HttpFail } from '../host/errors.js';
import { createCatalogDomain, createCatalogBase, deleteCatalogDomain, deleteCatalogBase, editCatalogDomain, editCatalogBase } from '../knowledge/taxonomy-mutations.js';

/** Mounted under /api; fixed catalog routes preserve the existing admin surface. */
export const knowledgeTaxonomyMutations = new Hono();
async function mutationBody(c: Context): Promise<Record<string, any>> {
  const value: unknown = await c.req.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpFail(400, { code: 'knowledge_taxonomy_invalid', message: '请提交有效的节点操作参数' });
  }
  return value as Record<string, any>;
}
knowledgeTaxonomyMutations.post('/admin/knowledge/domains', async c =>
  c.json(await createCatalogDomain(await mutationBody(c)), 201));
knowledgeTaxonomyMutations.post('/admin/knowledge/bases', async c =>
  c.json(await createCatalogBase(await mutationBody(c)), 201));
knowledgeTaxonomyMutations.put('/admin/knowledge/domains/:id', async c =>
  c.json(await editCatalogDomain(c.req.param('id'), await mutationBody(c))));
knowledgeTaxonomyMutations.put('/admin/knowledge/bases/:id', async c =>
  c.json(await editCatalogBase(c.req.param('id'), await mutationBody(c))));
knowledgeTaxonomyMutations.delete('/admin/knowledge/domains/:id', async c =>
  c.json(await deleteCatalogDomain(c.req.param('id'), await mutationBody(c))));
knowledgeTaxonomyMutations.delete('/admin/knowledge/bases/:id', async c =>
  c.json(await deleteCatalogBase(c.req.param('id'), await mutationBody(c))));
