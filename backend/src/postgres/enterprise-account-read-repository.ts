import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import type { Json, Row } from "../types.js";
import { postgresQuery, postgresTransaction } from "./pool.js";

// Management projections, not execution-time authorization. Historic grants
// remain visible for governance; they do not authorize a skill or connector.
// One SQL snapshot for the entire directory avoids per-user bridge/N+1 reads.
const ACCOUNT_SUMMARIES = `
  SELECT (to_jsonb(u) - 'password_hash') AS account,
    p.person_ref, p.email AS person_email, p.employee_no, p.avatar_url,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('org_unit_id', m.org_unit_id, 'relation', m.relation)
      ORDER BY m.relation DESC, m.org_unit_id)
      FROM organization_memberships m WHERE m.person_ref=p.person_ref AND m.status='active'), '[]'::jsonb) AS memberships,
    COALESCE((SELECT jsonb_agg(g.skill_id ORDER BY g.skill_id)
      FROM user_skill_grants g WHERE g.user_id=u.id), '[]'::jsonb) AS skill_grants,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('role', g.approval_role,
      'kind', COALESCE(NULLIF(g.role_kind,''), CASE WHEN g.approval_role='zhang' THEN 'named' ELSE 'position' END),
      'valid_from', g.valid_from, 'valid_to', g.valid_to) ORDER BY g.approval_role)
      FROM approval_role_bindings g WHERE g.user_id=u.id), '[]'::jsonb) AS approval_roles,
    (SELECT COUNT(*) FROM user_starry_bindings b WHERE b.user_id=u.id)::text AS mailbox_count,
    (SELECT COUNT(*) FROM kol_follow_index f WHERE f.employee_id=u.id AND f.status='active')::text AS kol_count
  FROM users u LEFT JOIN LATERAL (
    SELECT person_ref,email,employee_no,to_jsonb(person)->>'avatar_url' AS avatar_url
    FROM organization_people person
    WHERE user_id=u.id ORDER BY person_ref LIMIT 1
  ) p ON true
  WHERE ($1::text IS NULL OR u.id=$1)
  ORDER BY u.created_at,u.id`;

type AccountSummaryRow = Row & {
  account: Row;
  memberships: Array<{ org_unit_id: string; relation: string }>;
};

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function projectAccount(row: AccountSummaryRow): Json {
  const account = row.account;
  const active = Number(account.active) === 1;
  return {
    ...account,
    avatar_url: row.avatar_url || null,
    email: String(account.email || row.person_email || (String(account.username).includes("@") ? account.username : "")),
    person_ref: row.person_ref || null,
    org_unit_ids: row.memberships.map((membership) => membership.org_unit_id),
    primary_org_unit_id: row.memberships.find((membership) => membership.relation === "primary")?.org_unit_id || null,
    employee_no: row.employee_no || null,
    status: active ? "active" : "disabled",
    active,
    roles: parseArray(account.roles),
    brands: parseArray(account.brands),
    skill_grants: row.skill_grants,
    approval_roles: row.approval_roles,
    mailbox_count: Number(row.mailbox_count),
    kol_count: Number(row.kol_count),
  } as Json;
}

async function summaries(client?: PoolClient, userId?: string): Promise<Json[]> {
  const rows = client
    ? (await client.query<AccountSummaryRow>(ACCOUNT_SUMMARIES, [userId ?? null])).rows
    : await postgresQuery<AccountSummaryRow>(ACCOUNT_SUMMARIES, [userId ?? null]);
  return rows.map(projectAccount);
}

export function pgEnterpriseAccounts(): Promise<Json[]> { return summaries(); }

export async function pgEnterpriseAccount(userId: string): Promise<Json> {
  const [row] = await summaries(undefined, userId);
  if (!row) throw new HttpFail(404, "user not found");
  return row;
}

/** Explicit mailbox columns: bearer/credential references never enter this DTO. */
export async function pgEnterpriseEmployeeContext(userId: string): Promise<Json> {
  return postgresTransaction(async (client) => {
    const [user] = await summaries(client, userId);
    if (!user) throw new HttpFail(404, "user not found");
    const mailboxes = (await client.query<Row>(`
      SELECT mailbox_email,mailbox_id,owner_name,status,is_default,updated_at,synced_at,last_error
      FROM user_starry_bindings WHERE user_id=$1
      ORDER BY is_default DESC,updated_at DESC,lower(mailbox_email),mailbox_email`, [userId])).rows.map((binding) => ({
        mailbox_email: String(binding.mailbox_email || ""),
        mailbox_id: binding.mailbox_id ? String(binding.mailbox_id) : null,
        owner_name: String(binding.owner_name || ""),
        status: String(binding.status || "unbound"),
        is_default: Number(binding.is_default) === 1,
        updated_at: binding.updated_at ? String(binding.updated_at) : null,
        synced_at: binding.synced_at ? String(binding.synced_at) : null,
        last_error: binding.last_error ? String(binding.last_error) : null,
      }));
    const kols = (await client.query<Row>(`
      SELECT f.id,f.kol_uid,f.scope_brand,f.claimed_at,
        COALESCE(p.display_name,c.display_name,f.kol_uid) AS display_name,
        COALESCE(c.stage_code,p.public_stage,'') AS stage_code,c.owner_mailbox AS mailbox_email
      FROM kol_follow_index f
      LEFT JOIN kol_profile_index p ON p.company_id=f.company_id AND p.kol_uid=f.kol_uid
      LEFT JOIN collaborations c ON c.id=f.collaboration_id
      WHERE f.employee_id=$1 AND f.status='active'
      ORDER BY f.claimed_at DESC,f.kol_uid,f.id`, [userId])).rows.map((kol) => ({
        id: String(kol.id || ""), kol_uid: String(kol.kol_uid || ""),
        display_name: String(kol.display_name || kol.kol_uid || ""),
        scope_brand: String(kol.scope_brand || ""), stage_code: String(kol.stage_code || ""),
        mailbox_email: kol.mailbox_email ? String(kol.mailbox_email) : null,
        claimed_at: kol.claimed_at ? String(kol.claimed_at) : null,
      }));
    return { user, avatar_url: user.avatar_url, mailboxes, kols } as Json;
  }, { isolation: "REPEATABLE READ" });
}
