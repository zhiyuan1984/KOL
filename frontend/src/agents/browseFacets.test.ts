import { describe, expect, it } from "vitest";
import type { EmployeeAgentBrowseRow, EmployeeAgentPreference, EmployeeAgentScope } from "../api";
import type { Expert } from "../experts";
import { agentBrowseFacets, filterAgentRows, NO_SCOPE, type AgentBrowseFilters } from "./browseFacets";

const experts = [{ id: "one", kind: "business" }, { id: "two", kind: "business" }, { id: "job", kind: "collector" }] as Expert[];
const scope = (family: string, brand: string | null, stages = ["INITIAL_CONTACT"]): EmployeeAgentScope => ({
  family_id: family, domain_id: `${family}-domain`, base_id: `${family}-base`, brand, stage_codes: stages,
});
const row = (id: string, scopes: EmployeeAgentScope[]): EmployeeAgentBrowseRow => ({ expert_id: id, scopes, published_by: null, updated_at: null });
const browse = new Map([
  ["one", row("one", [scope("growth", "LT"), scope("growth", "LT"), scope("products", "RO", ["TESTING"])])],
  ["two", row("two", [scope("growth", "*"), scope("products", null, [])])],
  ["job", row("job", [])],
]);
const prefs = new Map<string, EmployeeAgentPreference>([["one", { expert_id: "one", favorite: true, viewed_at: "2026-10-13" }]]);
const defaults: AgentBrowseFilters = { familyId: "", domainId: "", baseId: "", brands: [], stages: [], kind: "", view: "all" };
const ids = (filters: Partial<AgentBrowseFilters>) => filterAgentRows(experts, browse, prefs, { ...defaults, ...filters }).map(row => row.id);

describe("employee Agent findability", () => {
  it("counts distinct Agents across duplicate references and preserves multi-select unions", () => {
    const facets = agentBrowseFacets(experts, browse, prefs, defaults);
    expect(facets.family.values.growth).toBe(2);
    expect(facets.brand.values.LT).toBe(2);
    expect(ids({ brands: ["LT", "RO"], stages: ["INITIAL_CONTACT", "TESTING"] })).toEqual(["one", "two"]);
  });
  it("does not combine a family from one reference with a brand or stage from another", () => {
    expect(ids({ familyId: "growth", brands: ["RO"], stages: ["TESTING"] })).toEqual([]);
    expect(ids({ familyId: "products", brands: ["LT"] })).toEqual([]);
  });
  it("treats unknown document applicability separately from explicit generic references", () => {
    expect(ids({ familyId: "products", brands: ["LT"] })).toEqual([]);
    expect(ids({ familyId: "products" })).toEqual(["one", "two"]);
    expect(ids({ baseId: NO_SCOPE })).toEqual(["job"]);
  });
  it("counts a facet with other filters and view retained; selected zero values remain available", () => {
    const filters = { ...defaults, view: "favorites" as const, brands: ["LT"], stages: ["TESTING"] };
    const facets = agentBrowseFacets(experts, browse, prefs, filters);
    expect(facets.brand.values).toEqual({ LT: 0, RO: 1 });
    expect(facets.stage.values.INITIAL_CONTACT).toBe(1);
    expect(facets.kind.all).toBe(0);
    expect(facets.view.values.favorites).toBe(0);
  });
});
