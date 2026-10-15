import { HttpFail } from "../host/errors.js";
import { organizationCompanyName } from "../runtime/organization-tree.js";

export type ReviewContext = {
  organization?: ReviewOrganizationContext;
  tenant: string;
  actor: string;
  admin: boolean;
  people: {
    id: string;
    name: string;
    managerIds: string[];
    roles?: string[];
  }[];
};

export type ReviewOrganizationContext = {
  units: { id: string; name: string; parentId: string | null }[];
  defaultUnitId?: string;
};

export type ReviewMembership = {
  user_id: string;
  display_name: string;
  company_id: string;
  org_unit_id: string;
  head_person_ref: string | null;
  relation?: string;
};

/**
 * Computes an approval context only from authoritative organization rows already
 * selected by the PostgreSQL access layer. This pure projection performs no I/O
 * and must not infer company or approver membership from display values.
 */
export function buildReviewContext(
  actorId: string,
  actorRoles: string,
  rows: ReviewMembership[],
  refs: { person_ref: string; user_id: string }[],
  roles: { user_id: string; approval_role: string }[],
  selectedTenant?: string,
): ReviewContext {
  const tenants = [...new Set(rows.filter((row) => row.user_id === actorId).map((row) => row.company_id))];
  const primaryCompanies = [...new Set(rows.filter((row) => row.user_id === actorId && row.relation === "primary").map((row) => row.company_id))];
  const tenant = selectedTenant || (primaryCompanies.length === 1 ? primaryCompanies[0] : tenants.length === 1 ? tenants[0] : "");
  if (!tenant || !tenants.includes(tenant)) {
    throw new HttpFail(403, {
      message: tenants.length > 1 ? "请明确选择当前组织" : "缺少有效的权威组织成员关系",
      companies: tenants,
    });
  }
  const scoped = rows.filter((row) => row.company_id === tenant);
  return {
    tenant,
    actor: actorId,
    admin: JSON.parse(actorRoles).includes("admin"),
    people: [...new Set(scoped.map((row) => row.user_id))].sort().map((id) => ({
      id,
      name: scoped.find((row) => row.user_id === id)!.display_name,
      roles: roles.filter((row) => row.user_id === id).map((row) => row.approval_role),
      managerIds: [...new Set(scoped.filter((row) => row.user_id === id).map((row) => refs.find((ref) => ref.person_ref === row.head_person_ref)?.user_id).filter((manager): manager is string => Boolean(manager && manager !== id && scoped.some((person) => person.user_id === manager))))],
    })),
  };
}

/** Builds the visible organization tree from active, same-company authority rows. */
export function buildReviewOrganization(
  tenant: string,
  stored: { id: string; name: string; parentId: string | null; level: number }[],
  primaryIds: string[],
  rootAvailable = true,
): ReviewOrganizationContext {
  const rows = stored.map((unit) => ({
    id: unit.id,
    name: unit.name,
    parentId: unit.id === tenant ? unit.parentId : unit.parentId || (unit.level === 1 ? tenant : null),
  }));
  if (!stored.some((unit) => unit.id === tenant) && rootAvailable)
    rows.unshift({ id: tenant, name: organizationCompanyName(tenant), parentId: null });
  const byId = new Map(rows.map((unit) => [unit.id, unit]));
  const units = rows.filter((unit) => {
    const seen = new Set<string>();
    let current: typeof unit | undefined = unit;
    while (current && !seen.has(current.id) && seen.size < 64) {
      if (current.id === tenant && !current.parentId) return true;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  });
  const defaults = [...new Set(primaryIds)].filter((id) => units.some((unit) => unit.id === id));
  return { units, ...(defaults.length === 1 ? { defaultUnitId: defaults[0] } : {}) };
}
