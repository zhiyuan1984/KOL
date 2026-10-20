import type { KnowledgeBusinessTaxonomy } from "../../shared/knowledge-taxonomy.js";
import type { KnowledgeRow } from "./api";

export type BusinessScope = { familyId: string; domainId: string; baseId: string };
export const EMPTY_BUSINESS_SCOPE: BusinessScope = { familyId: "", domainId: "", baseId: "" };

/** Directory projection only; the original content/base identity and permissions are untouched. */
export function withBusinessClassification(rows: KnowledgeRow[], taxonomy: KnowledgeBusinessTaxonomy): KnowledgeRow[] {
  const nodes = new Map(taxonomy.nodes.map(node => [node.id, node]));
  const bindings = new Map(taxonomy.bindings.map(binding => [binding.baseId, binding.themeId]));
  return rows.map(row => {
    const theme = nodes.get(bindings.get(row.base_id || "") || "");
    const domain = nodes.get(theme?.parentId || "");
    const family = nodes.get(domain?.parentId || "");
    return { ...row, catalog_family_id: family?.id || "", catalog_domain_id: domain?.id || "", catalog_theme_id: theme?.id || "" };
  });
}

export function businessScopeOptions(taxonomy: KnowledgeBusinessTaxonomy, scope: BusinessScope, level: number) {
  const domainIds = new Set(taxonomy.nodes.filter(node => node.level === 2 && (!scope.familyId || node.parentId === scope.familyId)).map(node => node.id));
  return taxonomy.nodes.filter(node => node.level === level && (level === 1 || level === 2
    ? level === 1 || !scope.familyId || node.parentId === scope.familyId
    : scope.domainId ? node.parentId === scope.domainId : domainIds.has(node.parentId || "")));
}

export function businessThemePath(taxonomy: KnowledgeBusinessTaxonomy, themeId: string): string {
  const nodes = new Map(taxonomy.nodes.map(node => [node.id, node]));
  const theme = nodes.get(themeId), domain = nodes.get(theme?.parentId || ""), family = nodes.get(domain?.parentId || "");
  return [family?.name, domain?.name, theme?.name].filter(Boolean).join(" / ");
}

/** Old saved legacy IDs remain valid for the compatibility API. */
export const isBusinessDirectoryId = (id: string) => /^B\d{2}$|^domain_[a-f0-9]{24}$|^theme_[a-f0-9]{24}$/.test(id);
