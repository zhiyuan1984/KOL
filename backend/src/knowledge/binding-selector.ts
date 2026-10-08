/** Shared exact matching semantics for legacy structured knowledge bindings. */
export type BindingSelector = {
  ids?: string[]; base_ids?: string[]; kinds?: string[]; tags?: string[];
  stage_codes?: string[]; brand?: string; lang?: string;
};
export function knowledgeBindingMatchesRow(selector: BindingSelector, row: Record<string, unknown>): boolean {
  if (selector.ids?.length && !selector.ids.includes(String(row.id || ''))) return false;
  if (selector.base_ids?.length && !selector.base_ids.includes(String(row.base_id || ''))) return false;
  if (selector.kinds?.length && !selector.kinds.includes(String(row.kind || ''))) return false;
  if (selector.tags?.length) {
    const tags = String(row.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
    if (!selector.tags.some(tag => tags.includes(tag))) return false;
  }
  const brand = String(selector.brand || '').trim();
  if (brand && String(row.brand || '*') !== '*' && String(row.brand || '*') !== brand) return false;
  const lang = String(selector.lang || '').trim();
  if (lang && String(row.lang || 'en') !== lang) return false;
  // Preserve the runtime's existing behavior: stage matching is done separately.
  return true;
}
