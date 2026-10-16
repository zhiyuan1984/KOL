/** PostgreSQL-only token migration. Default is metadata-only dry run. */
import { getConn } from "../src/db.js";
import { postgresTransaction, closePostgresPool } from "../src/postgres/pool.js";
import { pgLockMailboxAccount } from "../src/postgres/credential-binding-repository.js";
import { createCredentialInTransaction, writeCredentialAudit } from "../src/runtime/credentials.js";
import type { Row } from "../src/types.js";
try {
  const rows = (await getConn().query<Row>("SELECT user_id,mailbox_email,bearer_token FROM user_starry_bindings")).rows
    .filter(row => String(row.bearer_token || "").trim() && !/^cred_[A-Za-z0-9_-]{8,160}$/.test(String(row.bearer_token)));
  let migrated = 0;
  if (process.argv.includes("--apply")) {
    for (const row of rows) {
      const committed = await postgresTransaction(async client => {
        const userId = String(row.user_id), mailbox = String(row.mailbox_email);
        await pgLockMailboxAccount(client, userId);
        const current = (await client.query<Row>("SELECT bearer_token FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2 FOR UPDATE", [userId, mailbox])).rows[0];
        if (!current || String(current.bearer_token) !== String(row.bearer_token)) return false;
        const credential = await createCredentialInTransaction({ type: "user_account", owner_user_id: userId,
          label: "Starry mailbox", purpose: "Migrated mailbox authentication",
          secret: String(row.bearer_token).trim().replace(/^Bearer\s+/i, "") }, userId, client);
        const changed = await client.query("UPDATE user_starry_bindings SET bearer_token=$1 WHERE user_id=$2 AND mailbox_email=$3 AND bearer_token=$4", [credential.id, userId, mailbox, row.bearer_token]);
        if (changed.rowCount !== 1) throw new Error("mailbox credential compare-and-swap did not update one row");
        await writeCredentialAudit(userId, "starry.credential_migrated", { mailbox_email: mailbox, credential_id: credential.id });
        return true;
      });
      if (committed) migrated += 1;
    }
  }
  console.log(JSON.stringify({ pending: rows.length, migrated, applied: process.argv.includes("--apply") }));
} catch {
  console.error("Starry mailbox credential migration failed; no secrets logged. Check vault readiness and active account ownership.");
  process.exitCode = 1;
} finally { await closePostgresPool(); }
