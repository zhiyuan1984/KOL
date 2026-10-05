import type { PoolClient } from "pg";
import { buildReviewContext, buildReviewOrganization, type ReviewMembership } from "./review-access.js";
import { HttpFail } from "../host/errors.js";

export async function postgresReviewContext(
  db: PoolClient,
  actorId: string,
  tenant?: string,
) {
  const actor = (
    await db.query("SELECT roles FROM users WHERE id=$1 AND active=1", [
      actorId,
    ])
  ).rows[0];
  if (!actor) throw new HttpFail(403, "账号已停用");
  const now = new Date().toISOString();
  const rows = (
    await db.query<ReviewMembership>(
      `SELECT p.user_id,p.display_name,m.company_id,m.org_unit_id,m.relation,u.head_person_ref
    FROM organization_people p JOIN users a ON a.id=p.user_id AND a.active=1
    JOIN organization_memberships m ON m.person_ref=p.person_ref
    JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
    WHERE p.status='active' AND m.status='active' AND u.status='active'
    AND (m.effective_from IS NULL OR m.effective_from<=$1) AND (m.effective_to IS NULL OR m.effective_to>$1)`,
      [now],
    )
  ).rows;
  const refs = (
    await db.query(
      "SELECT person_ref,user_id FROM organization_people WHERE status='active'",
    )
  ).rows;
  const roles = (
    await db.query(
      "SELECT user_id,approval_role FROM approval_role_bindings WHERE (valid_from IS NULL OR valid_from<=$1) AND (valid_to IS NULL OR valid_to>$1)",
      [now],
    )
  ).rows;
  const ctx=buildReviewContext(
    actorId,
    actor.roles,
    rows,
    refs as { person_ref: string; user_id: string }[],
    roles as { user_id: string; approval_role: string }[],
    tenant,
  );
  const stored=(await db.query(`SELECT id,display_name AS name,parent_id AS "parentId",level FROM organization_units WHERE company_id=$1 AND status='active' ORDER BY level,display_name,id`,[ctx.tenant])).rows;
  const foreignRoot=(await db.query("SELECT 1 FROM organization_units WHERE id=$1 AND company_id<>$1",[ctx.tenant])).rowCount;
  ctx.organization=buildReviewOrganization(ctx.tenant,stored,rows.filter(r=>r.user_id===actorId && r.company_id===ctx.tenant && r.relation==='primary').map(r=>r.org_unit_id),!foreignRoot);
  return ctx;
}
export async function postgresReviewCompanies(db: PoolClient, actorId: string) {
  const now = new Date().toISOString();
  return (
    await db.query<{ id: string; name: string }>(
      `SELECT DISTINCT m.company_id AS id,COALESCE(root.display_name,m.company_id) AS name
    FROM organization_people p JOIN users a ON a.id=p.user_id AND a.active=1
    JOIN organization_memberships m ON m.person_ref=p.person_ref
    JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
    LEFT JOIN organization_units root ON root.id=m.company_id AND root.company_id=m.company_id
    WHERE p.user_id=$1 AND p.status='active' AND m.status='active' AND u.status='active'
    AND (m.effective_from IS NULL OR m.effective_from<=$2) AND (m.effective_to IS NULL OR m.effective_to>$2) ORDER BY id`,
      [actorId, now],
    )
  ).rows;
}
