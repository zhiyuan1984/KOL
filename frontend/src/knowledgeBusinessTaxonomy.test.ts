import { describe, expect, it } from "vitest";
import { businessScopeOptions, businessThemePath, withBusinessClassification } from "./knowledgeBusinessTaxonomy";
import { employeeKnowledgeFacets, filterEmployeeKnowledgeRows } from "./employeeKnowledgeFacets";
import type { KnowledgeBusinessTaxonomy } from "../../shared/knowledge-taxonomy.js";
import type { KnowledgeRow } from "./api";
const taxonomy: KnowledgeBusinessTaxonomy = { sourceVersion: "test", nodes: [
  { id: "B04", name: "营销", level: 1, parentId: null }, { id: "B05", name: "产品", level: 1, parentId: null },
  { id: "d1", name: "KOL营销", level: 2, parentId: "B04" }, { id: "d2", name: "产品管理", level: 2, parentId: "B05" },
  { id: "t1", name: "达人资源", level: 3, parentId: "d1" }, { id: "t2", name: "规格", level: 3, parentId: "d2" },
], bindings: [{ baseId: "structured", themeId: "t1" }, { baseId: "documents", themeId: "t1" }] };
const rows = [
  { id: "visible", base_id: "structured", title: "可见资料", status: "published", family_id: "legacy", domain_id: "legacy-domain", brand: "LT", kind: "policy" },
  { id: "old", base_id: "legacy", title: "历史知识", status: "published", family_id: "legacy", domain_id: "legacy-domain", brand: "LT", kind: "policy" },
] as KnowledgeRow[];
const filters = { familyId: "", domainId: "", baseId: "", brandFilters: [], stageFilters: [], kindFilter: "", view: "all" as const, favoriteIds: [], recentIds: [] };
describe("shared ontology directory projection", () => {
  it("retains original base/content identity and never fabricates or grants content", () => {
    const projected = withBusinessClassification(rows, taxonomy);
    expect(projected.map(row => row.id)).toEqual(["visible", "old"]);
    expect(projected[0]).toMatchObject({ base_id: "structured", family_id: "legacy", catalog_family_id: "B04", catalog_domain_id: "d1", catalog_theme_id: "t1" });
    expect(projected[1]).toMatchObject({ base_id: "legacy", catalog_family_id: "", catalog_domain_id: "", catalog_theme_id: "" });
    expect(rows[0]).not.toHaveProperty("catalog_family_id");
  });
  it("keeps zero-content directories and only scopes descendants", () => {
    expect(businessScopeOptions(taxonomy, { ...filters, familyId: "B05" }, 1)).toHaveLength(2);
    expect(businessScopeOptions(taxonomy, { ...filters, familyId: "B05" }, 2).map(node => node.id)).toEqual(["d2"]);
    expect(businessScopeOptions(taxonomy, { ...filters, familyId: "B05" }, 3).map(node => node.id)).toEqual(["t2"]);
    expect(businessThemePath(taxonomy, "t1")).toBe("营销 / KOL营销 / 达人资源");
  });
  it("counts only already-authorized rows and preserves unmapped history in all", () => {
    const projected = withBusinessClassification(rows, taxonomy);
    expect(filterEmployeeKnowledgeRows(projected, filters)).toHaveLength(2);
    expect(filterEmployeeKnowledgeRows(projected, { ...filters, familyId: "B04" }).map(row => row.id)).toEqual(["visible"]);
    expect(filterEmployeeKnowledgeRows(projected, { ...filters, baseId: "t2" })).toEqual([]);
    expect(employeeKnowledgeFacets(projected, filters).base.values).toEqual({ t1: 1 });
  });
});
