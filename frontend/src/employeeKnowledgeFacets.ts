import type { KnowledgeRow } from "./api";

export type EmployeeKnowledgeView = "all" | "favorites" | "recent";
export type EmployeeKnowledgeFacetAxis = "family" | "domain" | "base" | "brand" | "stage" | "kind" | "view";

/**
 * These are employee-page UI conditions only. `rows` must already be the
 * authorized, query-filtered result from api.knowledge; this helper never
 * widens that data set or applies a client-side keyword search.
 */
export type EmployeeKnowledgeFilters = {
  familyId: string;
  domainId: string;
  baseId: string;
  brandFilters: readonly string[];
  stageFilters: readonly string[];
  kindFilter: string;
  view: EmployeeKnowledgeView;
  favoriteIds: readonly string[];
  recentIds: readonly string[];
};

export type EmployeeKnowledgeFacet = {
  /** Rows matching every other active axis (the current facet is omitted). */
  all: number;
  /** Exact selectable values and their conditional counts. */
  values: Record<string, number>;
};

export type EmployeeKnowledgeFacets = Record<EmployeeKnowledgeFacetAxis, EmployeeKnowledgeFacet>;

function valueOf(row: KnowledgeRow, axis: "family" | "domain" | "base" | "kind") {
  if (axis === "family") return String(row.family_id || "");
  if (axis === "domain") return String(row.domain_id || "");
  if (axis === "base") return String(row.base_id || "");
  return String(row.kind || "");
}

/** Existing employee behaviour: a universal (`*`) or blank brand matches every selected brand. */
function matchesBrand(row: KnowledgeRow, selected: ReadonlySet<string>) {
  if (!selected.size) return true;
  const brand = String(row.brand || "");
  return !brand || brand === "*" || selected.has(brand);
}

/** Existing employee behaviour: an empty stage list never matches a specified stage. */
function matchesStage(row: KnowledgeRow, selected: ReadonlySet<string>) {
  if (!selected.size) return true;
  return (row.stage_codes || []).some((stage) => selected.has(stage));
}

function matchesView(row: KnowledgeRow, view: EmployeeKnowledgeView, favoriteIds: ReadonlySet<string>, recentIds: ReadonlySet<string>) {
  if (view === "favorites") return favoriteIds.has(row.id);
  if (view === "recent") return recentIds.has(row.id);
  return true;
}

/**
 * Applies the employee page's normal intersection rules, optionally leaving
 * one axis unconstrained for conditional facet counts. Brand and stage retain
 * their same-axis multi-select union semantics.
 */
export function filterEmployeeKnowledgeRows(
  rows: readonly KnowledgeRow[],
  filters: EmployeeKnowledgeFilters,
  skip?: EmployeeKnowledgeFacetAxis,
): KnowledgeRow[] {
  const brands = new Set(filters.brandFilters);
  const stages = new Set(filters.stageFilters);
  const favorites = new Set(filters.favoriteIds);
  const recent = new Set(filters.recentIds);

  return rows.filter((row) => {
    if (skip !== "family" && filters.familyId && String(row.family_id || "") !== filters.familyId) return false;
    if (skip !== "domain" && filters.domainId && String(row.domain_id || "") !== filters.domainId) return false;
    if (skip !== "base" && filters.baseId && String(row.base_id || "") !== filters.baseId) return false;
    if (skip !== "brand" && !matchesBrand(row, brands)) return false;
    if (skip !== "stage" && !matchesStage(row, stages)) return false;
    if (skip !== "kind" && filters.kindFilter && valueOf(row, "kind") !== filters.kindFilter) return false;
    if (skip !== "view" && !matchesView(row, filters.view, favorites, recent)) return false;
    return true;
  });
}

function countExact(rows: readonly KnowledgeRow[], axis: "family" | "domain" | "base" | "kind", selected: readonly string[] = []) {
  const values = new Set(selected.filter(Boolean));
  for (const row of rows) {
    const value = valueOf(row, axis);
    if (value) values.add(value);
  }
  return Object.fromEntries([...values].map((value) => [value, rows.filter((row) => valueOf(row, axis) === value).length]));
}

function countBrands(rows: readonly KnowledgeRow[], candidates: readonly KnowledgeRow[], selected: readonly string[]) {
  const values = new Set(selected.filter(Boolean));
  for (const row of candidates) {
    const brand = String(row.brand || "");
    if (brand && brand !== "*") values.add(brand);
  }
  return Object.fromEntries([...values].map((brand) => [brand, rows.filter((row) => matchesBrand(row, new Set([brand]))).length]));
}

function countStages(rows: readonly KnowledgeRow[], selected: readonly string[]) {
  const values = new Set(selected.filter(Boolean));
  for (const row of rows) for (const stage of row.stage_codes || []) if (stage) values.add(stage);
  return Object.fromEntries([...values].map((stage) => [stage, rows.filter((row) => (row.stage_codes || []).includes(stage)).length]));
}

/**
 * Computes all employee facets from the complete authorized response. Every
 * axis is conditional on the current other axes, including the favorites /
 * recent view and the selected type; it never derives counts from pagination.
 */
export function employeeKnowledgeFacets(rows: readonly KnowledgeRow[], filters: EmployeeKnowledgeFilters): EmployeeKnowledgeFacets {
  const familyRows = filterEmployeeKnowledgeRows(rows, filters, "family");
  const domainRows = filterEmployeeKnowledgeRows(rows, filters, "domain");
  const baseRows = filterEmployeeKnowledgeRows(rows, filters, "base");
  const brandRows = filterEmployeeKnowledgeRows(rows, filters, "brand");
  const stageRows = filterEmployeeKnowledgeRows(rows, filters, "stage");
  const kindRows = filterEmployeeKnowledgeRows(rows, filters, "kind");
  const viewRows = filterEmployeeKnowledgeRows(rows, filters, "view");
  const favorites = new Set(filters.favoriteIds);
  const recent = new Set(filters.recentIds);

  return {
    family: { all: familyRows.length, values: countExact(familyRows, "family", [filters.familyId]) },
    domain: { all: domainRows.length, values: countExact(domainRows, "domain", [filters.domainId]) },
    base: { all: baseRows.length, values: countExact(baseRows, "base", [filters.baseId]) },
    brand: { all: brandRows.length, values: countBrands(brandRows, rows, filters.brandFilters) },
    stage: { all: stageRows.length, values: countStages(stageRows, filters.stageFilters) },
    kind: { all: kindRows.length, values: countExact(kindRows, "kind", [filters.kindFilter]) },
    view: {
      all: viewRows.length,
      values: {
        all: viewRows.length,
        favorites: viewRows.filter((row) => favorites.has(row.id)).length,
        recent: viewRows.filter((row) => recent.has(row.id)).length,
      },
    },
  };
}
