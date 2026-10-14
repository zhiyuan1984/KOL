import type { Row } from "../types.js";
import { postgresQuery, postgresTransaction } from "./pool.js";
export async function pgFindUserForLoginRows(identifier: string): Promise<Row[]> {
  return (await postgresQuery<Row>(`SELECT * FROM users WHERE active=1 AND (username=$1 OR lower(coalesce(email,''))=$2 OR lower(trim(name))=lower($3) OR ($4<>'' AND phone IS NOT NULL AND trim(phone)<>'') ) ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END,id`, [identifier, identifier.includes("@") ? identifier.toLowerCase() : "", identifier, /^\+?[0-9 ()-]{7,}$/.test(identifier) ? "phone" : ""]));
}
export async function pgSetApprovalRoles(userId: string, grants: Array<{
  role: string;
  kind: string;
  validFrom?: string | null;
  validTo?: string | null;
}>, now: string): Promise<void> {
  await postgresTransaction(async (client) => {
    await client.query("DELETE FROM approval_role_bindings WHERE user_id=$1", [userId]);
    for (const grant of grants)
      await client.query("INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,valid_from,valid_to,created_at) VALUES($1,$2,$3,$4,$5,$6)", [userId, grant.role, grant.kind, grant.validFrom || null, grant.validTo || null, now]);
  });
}
export async function pgBindApprovalRole(userId: string, role: string, kind: string, now: string): Promise<void> { await postgresQuery("INSERT INTO approval_role_bindings(user_id,approval_role,role_kind,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [userId, role, kind, now]); }
export async function pgUnbindApprovalRole(userId: string, role: string): Promise<void> { await postgresQuery("DELETE FROM approval_role_bindings WHERE user_id=$1 AND approval_role=$2", [userId, role]); }
export async function pgUpdatePreferences(userId: string, analytics: boolean, preferences: Record<string, unknown>, now: string, defaultMailbox?: string): Promise<Row | undefined> {
  return (await postgresTransaction(async (client) => {
    if (defaultMailbox !== undefined) {
      await client.query("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1", [userId]);
      if (defaultMailbox)
        await client.query("UPDATE user_starry_bindings SET is_default=1 WHERE user_id=$1 AND lower(mailbox_email)=lower($2)", [userId, defaultMailbox]);
    }
    const rows = await client.query<Row>(`INSERT INTO user_preferences(user_id,analytics_cookies,preferences,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET analytics_cookies=EXCLUDED.analytics_cookies,preferences=EXCLUDED.preferences,updated_at=EXCLUDED.updated_at RETURNING *`, [userId, analytics ? 1 : 0, JSON.stringify(preferences), now]);
    return rows.rows[0];
  }));
}
