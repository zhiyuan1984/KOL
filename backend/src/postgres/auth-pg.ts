import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import { isDemoAdminIdentifier, looksLikePhone, normalizeAccount, normalizeEmail, normalizePhone } from "../host/identity.js";

export async function pgFindUserForLogin(raw: string): Promise<Row | undefined> {
  const ident = String(raw || "").trim();
  if (!ident) return undefined;
  const account = normalizeAccount(ident);
  const email = ident.includes("@") ? normalizeEmail(ident) : "";
  const rows = await postgresQuery<Row>(
    `SELECT * FROM users WHERE active=1 AND (
      username=$1 OR lower(coalesce(email,''))=$2 OR lower(trim(name))=lower($3)
      OR ($4 <> '' AND phone IS NOT NULL AND trim(phone) <> '')
    ) ORDER BY CASE WHEN username=$1 THEN 0 ELSE 1 END, id`,
    [email || account, email, ident, looksLikePhone(ident) ? "phone" : ""],
  );
  const phone = looksLikePhone(ident) ? normalizePhone(ident) : "";
  const candidates = rows.filter((row) => !phone || normalizePhone(String(row.phone || "")) === phone);
  if (isDemoAdminIdentifier(ident)) {
    return candidates.find((row) => String(row.username) === "lingong" || normalizeEmail(String(row.email || "")) === normalizeEmail("qiyouhuang@163.com")) || candidates[0];
  }
  if (email || account) return candidates.find((row) => String(row.username) === (email || account)) || candidates.find((row) => normalizeEmail(String(row.email || "")) === email) || (candidates.length === 1 ? candidates[0] : undefined);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function pgUserCount(): Promise<number> {
  const [row] = await postgresQuery<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
  return Number(row?.n || 0);
}

export async function pgCreateUser(input: { id: string; username: string; name: string; passwordHash: string; brands: Json; site: string; email: string; phone: string; now: string; }): Promise<Row> {
  return postgresTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at,email,phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$9,$10)`,
      [input.id, input.username, input.name, input.passwordHash, JSON.stringify(["employee", "admin"]), JSON.stringify(input.brands || []), input.site, input.now, input.email, input.phone],
    );
    return (await client.query<Row>("SELECT * FROM users WHERE id=$1", [input.id])).rows[0];
  });
}

export async function pgCreateSession(idHash: string, userId: string, expiresAt: string, createdAt: string): Promise<void> {
  await postgresQuery("INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4)", [idHash, userId, expiresAt, createdAt]);
}

export async function pgDeleteSession(idHash: string): Promise<void> {
  await postgresQuery("DELETE FROM auth_sessions WHERE id_hash=$1", [idHash]);
}

export async function pgConnectorPermissions(userId: string): Promise<Record<string, string>> {
  const rows = await postgresQuery<{ connector_id: string; access: string }>(
    "SELECT g.connector_id,g.access FROM user_connector_grants g JOIN connectors c ON c.id=g.connector_id WHERE g.user_id=$1 AND c.enabled=1",
    [userId],
  );
  return Object.fromEntries(rows.map((row) => [String(row.connector_id), String(row.access)]));
}

export async function pgDefaultBinding(userId: string): Promise<Row | undefined> {
  const [row] = await postgresQuery<Row>(
    "SELECT mailbox_email,mailbox_id,owner_name,status,bearer_token,updated_at FROM user_starry_bindings WHERE user_id=$1 AND is_default=1 ORDER BY updated_at ASC,mailbox_email ASC LIMIT 1",
    [userId],
  );
  return row;
}
