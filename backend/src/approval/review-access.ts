import type { SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { organizationCompanyName } from "../runtime/organization-tree.js";
import type { ReviewContext } from "./review-service.js";
/** Scope comes only from current effective organization memberships, never display names. */
export function reviewContextForActor(
  db: SqliteConn,
  actorId: string,
  selectedTenant?: string,
): ReviewContext {
  const actor = db
    .prepare("SELECT roles FROM users WHERE id=? AND active=1")
    .get(actorId) as { roles: string } | undefined;
  if (!actor) throw new HttpFail(403, "账号已停用");
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT p.user_id,p.display_name,m.company_id,m.org_unit_id,m.relation,u.head_person_ref
    FROM organization_people p JOIN users a ON a.id=p.user_id AND a.active=1
    JOIN organization_memberships m ON m.person_ref=p.person_ref
    JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
    WHERE p.status='active' AND m.status='active' AND u.status='active'
    AND (m.effective_from IS NULL OR m.effective_from<=?) AND (m.effective_to IS NULL OR m.effective_to>?)`,
    )
    .all(now, now) as {
    user_id: string;
    display_name: string;
    company_id: string;
    org_unit_id: string;
    relation: string;
    head_person_ref: string | null;
  }[];
  const tenants = [
    ...new Set(
      rows.filter((r) => r.user_id === actorId).map((r) => r.company_id),
    ),
  ];
  const primaryCompanies = [...new Set(rows.filter(r => r.user_id === actorId && r.relation === "primary").map(r => r.company_id))];
  const tenant = selectedTenant || (primaryCompanies.length === 1 ? primaryCompanies[0] : tenants.length === 1 ? tenants[0] : "");
  if (!tenant || !tenants.includes(tenant))
    throw new HttpFail(403, {
      message:
        tenants.length > 1
          ? "请明确选择当前组织"
          : "缺少有效的权威组织成员关系",
      companies: tenants,
    });
  const scoped = rows.filter((r) => r.company_id === tenant);
  const refs = db
    .prepare(
      "SELECT person_ref,user_id FROM organization_people WHERE status='active'",
    )
    .all() as { person_ref: string; user_id: string }[];
  const roles = db
    .prepare(
      "SELECT user_id,approval_role FROM approval_role_bindings WHERE (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>?)",
    )
    .all(now, now) as { user_id: string; approval_role: string }[];
  const people = [...new Set(scoped.map((r) => r.user_id))]
    .sort()
    .map((id) => ({
      id,
      name: scoped.find((r) => r.user_id === id)!.display_name,
      roles: roles.filter((r) => r.user_id === id).map((r) => r.approval_role),
      managerIds: [
        ...new Set(
          scoped
            .filter((r) => r.user_id === id)
            .map(
              (r) =>
                refs.find((p) => p.person_ref === r.head_person_ref)?.user_id,
            )
            .filter((x): x is string =>
              Boolean(x && x !== id && scoped.some((p) => p.user_id === x)),
            ),
        ),
      ],
    }));
  return {
    tenant,
    actor: actorId,
    admin: JSON.parse(actor.roles).includes("admin"),
    people,
    organization: reviewOrganization(db, tenant, scoped.filter(r => r.user_id === actorId && r.relation === "primary").map(r => r.org_unit_id)),
  };
}

/** Return only active units connected to this company's authoritative root. */
function reviewOrganization(db: SqliteConn, tenant: string, primaryIds: string[]) {
  const stored = db.prepare('SELECT id,display_name AS name,parent_id AS "parentId",level FROM organization_units WHERE company_id=? AND status=\'active\' ORDER BY level,display_name,id').all(tenant) as { id: string; name: string; parentId: string | null; level: number }[];
  // The authority stores top-level departments with parent_id=NULL; companies
  // are a separate registry, not necessarily organization_units rows.
  const rows = stored.map(unit => ({ id:unit.id, name:unit.name, parentId: unit.id === tenant ? unit.parentId : unit.parentId || (unit.level === 1 ? tenant : null) }));
  if (!stored.some(unit => unit.id === tenant) && !db.prepare("SELECT 1 FROM organization_units WHERE id=?").get(tenant))
    rows.unshift({ id: tenant, name: organizationCompanyName(tenant), parentId: null });
  const byId = new Map(rows.map(unit => [unit.id, unit]));
  const units = rows.filter(unit => {
    const seen = new Set<string>();
    let current: typeof unit | undefined = unit;
    while (current && !seen.has(current.id) && seen.size < 64) {
      if (current.id === tenant && !current.parentId) return true;
      seen.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return false;
  });
  const defaults = [...new Set(primaryIds)].filter(id => units.some(unit => unit.id === id));
  return { units, ...(defaults.length === 1 ? { defaultUnitId: defaults[0] } : {}) };
}

export function reviewCompaniesForActor(db: SqliteConn, actorId: string) {
  const now = new Date().toISOString();
  const companies = db
    .prepare(
      `SELECT DISTINCT m.company_id AS id,COALESCE(root.display_name,m.company_id) AS name
    FROM organization_people p JOIN users a ON a.id=p.user_id AND a.active=1
    JOIN organization_memberships m ON m.person_ref=p.person_ref
    JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
    LEFT JOIN organization_units root ON root.id=m.company_id AND root.company_id=m.company_id
    WHERE p.user_id=? AND p.status='active' AND m.status='active' AND u.status='active'
    AND (m.effective_from IS NULL OR m.effective_from<=?) AND (m.effective_to IS NULL OR m.effective_to>?) ORDER BY id`,
    )
    .all(actorId, now, now) as { id: string; name: string }[];
  return companies.map(company => ({ ...company, name: company.name === company.id ? organizationCompanyName(company.id) : company.name }));
}
