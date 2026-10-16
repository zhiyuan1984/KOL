import type { EmployeeAgentBrowseRow, EmployeeAgentPreference, EmployeeAgentScope } from "../api";
import type { Expert } from "../experts";

export type AgentBrowseFilters = {
  familyId: string; domainId: string; baseId: string; brands: string[]; stages: string[];
  kind: string; view: "all" | "favorites" | "recent";
};
type Axis = "family" | "domain" | "base" | "brand" | "stage" | "kind" | "view";
type Facet = { all: number; values: Record<string, number> };
export const NO_SCOPE = "__none__";

function scopeMatches(scope: EmployeeAgentScope, filters: AgentBrowseFilters, skip?: Axis) {
  for (const [axis, key, value] of [["family", "family_id", filters.familyId], ["domain", "domain_id", filters.domainId], ["base", "base_id", filters.baseId]] as const) {
    if (skip !== axis && value && (scope[key] || NO_SCOPE) !== value) return false;
  }
  // An explicitly generic structured reference matches brands. Unknown document scope does not.
  if (skip !== "brand" && filters.brands.length && (!scope.brand || (scope.brand !== "*" && !filters.brands.includes(scope.brand)))) return false;
  if (skip !== "stage" && filters.stages.length && !scope.stage_codes.some(code => filters.stages.includes(code))) return false;
  return true;
}
const emptyScope: EmployeeAgentScope = { family_id: null, domain_id: null, base_id: null, brand: null, stage_codes: [] };
const scopesOf = (row?: EmployeeAgentBrowseRow) => row?.scopes.length ? row.scopes : [emptyScope];

function hasScopeFilter(filters: AgentBrowseFilters, skip?: Axis): boolean {
  return (skip !== "family" && Boolean(filters.familyId))
    || (skip !== "domain" && Boolean(filters.domainId))
    || (skip !== "base" && Boolean(filters.baseId))
    || (skip !== "brand" && filters.brands.length > 0)
    || (skip !== "stage" && filters.stages.length > 0);
}

export function filterAgentRows(experts: readonly Expert[], browse: ReadonlyMap<string, EmployeeAgentBrowseRow>,
  preferences: ReadonlyMap<string, EmployeeAgentPreference>, filters: AgentBrowseFilters, skip?: Axis): Expert[] {
  return experts.filter(expert => {
    if (skip !== "kind" && filters.kind && expert.kind !== filters.kind) return false;
    if (skip !== "view" && filters.view === "favorites" && !preferences.get(expert.id)?.favorite) return false;
    if (skip !== "view" && filters.view === "recent" && !preferences.get(expert.id)?.viewed_at) return false;
    // The roster remains the source of authorization. A missing browse row is
    // unknown applicability, not a synthetic "unassociated knowledge" scope.
    if (!hasScopeFilter(filters, skip)) return true;
    const browseRow = browse.get(expert.id);
    if (!browseRow) return false;
    // All chosen scope dimensions must match the SAME associated reference.
    return scopesOf(browseRow).some(scope => scopeMatches(scope, filters, skip));
  });
}

/** Each count is distinct Agents in the complete visible response, ignoring only its own filter axis. */
export function agentBrowseFacets(experts: readonly Expert[], browse: ReadonlyMap<string, EmployeeAgentBrowseRow>,
  preferences: ReadonlyMap<string, EmployeeAgentPreference>, filters: AgentBrowseFilters): Record<Axis, Facet> {
  const result = {} as Record<Axis, Facet>;
  for (const axis of ["family", "domain", "base", "brand", "stage", "kind", "view"] as const) {
    const candidates = filterAgentRows(experts, browse, preferences, filters, axis);
    const keys = new Set<string>();
    if (axis === "brand") filters.brands.forEach(value => keys.add(value));
    else if (axis === "stage") filters.stages.forEach(value => keys.add(value));
    else if (axis === "family" || axis === "domain" || axis === "base") { const selected = filters[`${axis}Id`]; if (selected) keys.add(selected); }
    if (axis === "kind") experts.forEach(row => keys.add(row.kind));
    else if (axis === "view") ["all", "favorites", "recent"].forEach(value => keys.add(value));
    else for (const expert of experts) {
      const browseRow = browse.get(expert.id);
      if (!browseRow) continue;
      for (const scope of scopesOf(browseRow)) {
        if (axis === "brand") { if (scope.brand && scope.brand !== "*") keys.add(scope.brand); }
        else if (axis === "stage") scope.stage_codes.forEach(code => keys.add(code));
        else keys.add(scope[`${axis}_id`] || NO_SCOPE);
      }
    }
    const values = Object.fromEntries([...keys].map(value => {
      const proposed: AgentBrowseFilters = { ...filters };
      if (axis === "kind") proposed.kind = value;
      else if (axis === "view") proposed.view = value as AgentBrowseFilters["view"];
      else if (axis === "brand") proposed.brands = [value];
      else if (axis === "stage") proposed.stages = [value];
      else proposed[`${axis}Id`] = value;
      return [value, filterAgentRows(candidates, browse, preferences, proposed).length];
    }));
    result[axis] = { all: candidates.length, values };
  }
  return result;
}
