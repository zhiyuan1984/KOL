/** One-time migration of historical mailbox tokens. Defaults to a metadata-only dry run. */
import { postgresDb } from "../src/postgres/access.js";
import { createCredential, deleteCredential } from "../src/runtime/credentials.js";
import type { Row } from "../src/types.js";
const db = postgresDb();
try {
  const rows = ((await db.many("SELECT user_id,mailbox_email,bearer_token FROM user_starry_bindings")) as Row[])
    .filter((row) => String(row.bearer_token || "").trim() && !/^cred_[A-Za-z0-9_-]{8,160}$/.test(String(row.bearer_token)));
  let migrated = 0;
  if (process.argv.includes("--apply")) {
    for (const row of rows) {
      const credential = await createCredential({ type: "user_account", owner_user_id: row.user_id,
        label: "Starry mailbox", purpose: "Migrated mailbox authentication",
        secret: String(row.bearer_token).trim().replace(/^Bearer\s+/i, "") }, String(row.user_id));
      try {
        const changed = (await db.execute("UPDATE user_starry_bindings SET bearer_token=$1 WHERE user_id=$2 AND mailbox_email=$3 AND bearer_token=$4", credential.id, row.user_id, row.mailbox_email, row.bearer_token)).changes;
        if (changed)
          migrated++;
        else
          await deleteCredential(credential.id, credential.version);
      }
      catch (error) {
        await deleteCredential(credential.id, credential.version);
        throw error;
      }
    }
  }
  console.log(JSON.stringify({ pending: rows.length, migrated, applied: process.argv.includes("--apply") }));
}
catch {
  console.error("Starry mailbox credential migration failed; no secrets logged. Check vault readiness and active account ownership.");
  process.exitCode = 1;
}
finally {
  await db.close();
}
