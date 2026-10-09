import { describe, expect, it } from "vitest";
import type { KnowledgeRow } from "../../api";
import {
  employeeKnowledgeFacets,
  filterEmployeeKnowledgeRows,
  type EmployeeKnowledgeFilters,
} from "../../employeeKnowledgeFacets";

const INITIAL = "INITIAL_CONTACT";
const INTERESTED = "INTERESTED";

function row(id: string, values: Partial<KnowledgeRow> = {}): KnowledgeRow {
  return {
    id,
    title: id,
    body: "",
    family_id: "family-a",
    domain_id: "domain-a",
    base_id: "base-a",
    kind: "mail_template",
    ...values,
  };
}

function filters(values: Partial<EmployeeKnowledgeFilters> = {}): EmployeeKnowledgeFilters {
  return {
    familyId: "",
    domainId: "",
    baseId: "",
    brandFilters: [],
    stageFilters: [],
    kindFilter: "",
    view: "all",
    favoriteIds: [],
    recentIds: [],
    ...values,
  };
}

describe("employee knowledge facets", () => {
  const rows = [
    row("lt-initial", { brand: "LT", stage_codes: [INITIAL] }),
    row("generic-interested", { brand: "*", stage_codes: [INTERESTED] }),
    row("empty-brand-initial", { brand: "", stage_codes: [INITIAL] }),
    row("ro-initial", { brand: "RO", stage_codes: [INITIAL] }),
    row("lt-empty-stage", { brand: "LT", stage_codes: [] }),
    row("lt-policy", { brand: "LT", stage_codes: [INITIAL], kind: "policy" }),
  ];

  it("keeps brand and stage multi-selects as unions while intersecting every other axis", () => {
    const result = filterEmployeeKnowledgeRows(rows, filters({
      brandFilters: ["LT", "RO"],
      stageFilters: [INITIAL, INTERESTED],
      kindFilter: "mail_template",
    }));

    expect(result.map((item) => item.id)).toEqual([
      "lt-initial",
      "generic-interested",
      "empty-brand-initial",
      "ro-initial",
    ]);
    expect(result.map((item) => item.id)).not.toContain("lt-empty-stage");
    expect(result.map((item) => item.id)).not.toContain("lt-policy");
  });

  it("computes every facet from all authorized rows, skips only its own axis, and includes active view/type", () => {
    const facetRows = [
      row("lt-favorite", { brand: "LT", stage_codes: [INITIAL], family_id: "family-a", kind: "mail_template" }),
      row("generic-policy", { brand: "*", stage_codes: [INITIAL], family_id: "family-b", kind: "policy" }),
      row("empty-brand-favorite", { brand: "", stage_codes: [INITIAL], family_id: "family-b", kind: "mail_template" }),
      row("ro-favorite", { brand: "RO", stage_codes: [INITIAL], family_id: "family-c", kind: "mail_template" }),
      row("lt-recent-stage", { brand: "LT", stage_codes: [INTERESTED], family_id: "family-a", kind: "mail_template" }),
      row("lt-empty-stage", { brand: "LT", stage_codes: [], family_id: "family-a", kind: "mail_template" }),
      row("lt-not-favorite", { brand: "LT", stage_codes: [INITIAL], family_id: "family-a", kind: "mail_template" }),
    ];
    const facetFilters = filters({
      brandFilters: ["LT"],
      stageFilters: [INITIAL],
      kindFilter: "mail_template",
      view: "favorites",
      favoriteIds: ["lt-favorite", "generic-policy", "empty-brand-favorite", "ro-favorite", "lt-recent-stage", "lt-empty-stage"],
      recentIds: ["lt-recent-stage"],
    });

    const facets = employeeKnowledgeFacets(facetRows, facetFilters);

    // Type skips kind, but keeps selected brand, stage, and favorites view.
    expect(facets.kind).toEqual({ all: 3, values: { mail_template: 2, policy: 1 } });
    // Stage skips stage, retains LT's generic/blank-brand matching, and keeps empty stages in "all" only.
    expect(facets.stage.all).toBe(4);
    expect(facets.stage.values[INITIAL]).toBe(2);
    expect(facets.stage.values[INTERESTED]).toBe(1);
    // Brand skips brand but retains the selected kind, stage, and favorites view.
    expect(facets.brand.all).toBe(3);
    expect(facets.brand.values.LT).toBe(2);
    expect(facets.brand.values.RO).toBe(2);
    // View skips only the view condition; the normal active-result count remains conditional on all other axes.
    expect(facets.view.values).toEqual({ all: 3, favorites: 2, recent: 0 });
    expect(facets.family.values).toEqual({ "family-a": 1, "family-b": 1 });
  });

  it("preserves selected values with an honest zero count when the authorized response has no match", () => {
    const facets = employeeKnowledgeFacets([], filters({
      familyId: "selected-empty-family",
      brandFilters: ["selected-empty-brand"],
      stageFilters: [INITIAL],
      kindFilter: "selected-empty-kind",
    }));

    expect(facets.family.values["selected-empty-family"]).toBe(0);
    expect(facets.brand.values["selected-empty-brand"]).toBe(0);
    expect(facets.stage.values[INITIAL]).toBe(0);
    expect(facets.kind.values["selected-empty-kind"]).toBe(0);
  });
});
