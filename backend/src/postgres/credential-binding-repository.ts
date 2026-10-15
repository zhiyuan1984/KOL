import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { postgresQuery, postgresTransaction } from "./pool.js";
import type { Row } from "../types.js";

/** Applied by the test fixture only; production schema changes are delivered by migration 033. */
export const credentialBindingSchema = `
  WITH ranked AS (
    SELECT user_id, mailbox_email, row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC, mailbox_email) AS ordinal
    FROM user_starry_bindings WHERE is_default=1
  ) UPDATE user_starry_bindings b SET is_default=0 FROM ranked r
    WHERE b.user_id=r.user_id AND b.mailbox_email=r.mailbox_email AND r.ordinal > 1;
  CREATE UNIQUE INDEX IF NOT EXISTS user_starry_bindings_one_default_idx
    ON user_starry_bindings(user_id) WHERE is_default=1;
`;
function unavailableDefault(): never { throw new HttpFail(409, { code: "starry_default_mailbox_unavailable" }); }
export async function pgLockMailboxAccount(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`starry-binding:${userId}`]);
}
export async function pgMailboxRows(userId: string, client?: PoolClient): Promise<Row[]> {
  const sql = "SELECT * FROM user_starry_bindings WHERE user_id=$1 ORDER BY is_default DESC,updated_at ASC,mailbox_email ASC";
  return client ? (await client.query<Row>(sql, [userId])).rows : (postgresQuery<Row>(sql, [userId]));
}
export async function pgMailboxRow(userId: string, mailbox?: string, client?: PoolClient, lock = false): Promise<Row | undefined> {
  const suffix = lock ? " FOR UPDATE" : "";
  if (mailbox) {
    const sql = `SELECT * FROM user_starry_bindings WHERE user_id=$1 AND lower(mailbox_email)=lower($2)${suffix}`;
    const rows = client ? (await client.query<Row>(sql, [userId, mailbox])).rows : await postgresQuery<Row>(sql, [userId, mailbox]);
    return rows[0];
  }
  const sql = `SELECT * FROM user_starry_bindings WHERE user_id=$1 AND is_default=1 ORDER BY updated_at ASC,mailbox_email ASC LIMIT 1${suffix}`;
  const rows = client ? (await client.query<Row>(sql, [userId])).rows : await postgresQuery<Row>(sql, [userId]);
  return rows[0];
}
export async function pgDefaultMailboxBinding(userId: string): Promise<Row | undefined> { return pgMailboxRow(userId); }
export async function pgListMailboxBindings(userId: string): Promise<Row[]> { return pgMailboxRows(userId); }
export async function pgSetDefaultMailbox(userId: string, email: string): Promise<void> {
  await postgresTransaction(async (client) => {
    await pgLockMailboxAccount(client, userId);
    if (email) {
      const target = await pgMailboxRow(userId, email, client, true);
      if (!target) unavailableDefault();
      await client.query("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1 AND is_default=1", [userId]);
      await client.query("UPDATE user_starry_bindings SET is_default=1 WHERE user_id=$1 AND mailbox_email=$2", [userId, target.mailbox_email]);
    } else {
      await client.query("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1 AND is_default=1", [userId]);
    }
  });
}
export type MailboxBindingInput = { userId: string; email: string; mailboxId: string; ownerName: string; credentialRef: string; status: string; now: string; ownerOpenId?: string };
/** Caller must hold pgLockMailboxAccount in the supplied transaction. */
export async function pgUpsertMailboxBindingInTransaction(client: PoolClient, input: MailboxBindingInput): Promise<Row> {
  const currentDefault = await pgMailboxRow(input.userId, undefined, client, true);
  const result = await client.query<Row>(`INSERT INTO user_starry_bindings
    (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at,owner_open_id,owner_verified_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text,CASE WHEN $9::text IS NULL THEN NULL ELSE $8 END)
    ON CONFLICT(user_id,mailbox_email) DO UPDATE SET
      is_default=CASE WHEN EXCLUDED.is_default=1 THEN 1 ELSE user_starry_bindings.is_default END,
      mailbox_id=EXCLUDED.mailbox_id,owner_name=EXCLUDED.owner_name,bearer_token=EXCLUDED.bearer_token,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,
      owner_open_id=COALESCE(EXCLUDED.owner_open_id,user_starry_bindings.owner_open_id),
      owner_verified_at=CASE WHEN EXCLUDED.owner_open_id IS NULL THEN user_starry_bindings.owner_verified_at ELSE EXCLUDED.owner_verified_at END
    RETURNING *`, [input.userId, input.email, currentDefault ? 0 : 1, input.mailboxId, input.ownerName, input.credentialRef, input.status, input.now, input.ownerOpenId || null]);
  return result.rows[0]!;
}
export async function pgUpsertMailboxBinding(input: MailboxBindingInput): Promise<Row> {
  return postgresTransaction(async (client) => { await pgLockMailboxAccount(client, input.userId); return pgUpsertMailboxBindingInTransaction(client, input); });
}
export async function pgDeleteMailboxBindingInTransaction(client: PoolClient, userId: string, email: string): Promise<Row | undefined> {
  const result = await client.query<Row>("DELETE FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2 RETURNING *", [userId, email]);
  return result.rows[0];
}
export async function pgDeleteMailboxBinding(userId: string, email: string): Promise<boolean> {
  return postgresTransaction(async (client) => { await pgLockMailboxAccount(client, userId); return Boolean(await pgDeleteMailboxBindingInTransaction(client, userId, email)); });
}
