/** One-time migration of historical mailbox tokens. Defaults to a metadata-only dry run. */
import { getConn } from "../src/db.js";
import { createCredential, deleteCredential } from "../src/runtime/credentials.js";
import type { Row } from "../src/types.js";

const db = getConn();
try {
  const rows = (db.prepare("SELECT user_id,mailbox_email,bearer_token FROM user_starry_bindings").all() as Row[])
    .filter((row) => String(row.bearer_token || "").trim() && !/^cred_[A-Za-z0-9_-]{8,160}$/.test(String(row.bearer_token)));
  let migrated = 0;
  if (process.argv.includes("--apply")) {
    for (const row of rows) {
      const credential = createCredential({ type: "user_account", owner_user_id: row.user_id,
        label: "Starry mailbox", purpose: "Migrated mailbox authentication",
        secret: String(row.bearer_token).trim().replace(/^Bearer\s+/i, "") }, String(row.user_id));
      try {
        const changed = db.prepare("UPDATE user_starry_bindings SET bearer_token=? WHERE user_id=? AND mailbox_email=? AND bearer_token=?")
          .run(credential.id, row.user_id, row.mailbox_email, row.bearer_token).changes;
        if (changed) migrated++;
        else deleteCredential(credential.id, credential.version);
      } catch (error) { deleteCredential(credential.id, credential.version); throw error; }
    }
  }
  console.log(JSON.stringify({ pending: rows.length, migrated, applied: process.argv.includes("--apply") }));
} catch {
  console.error("Starry mailbox credential migration failed; no secrets logged. Check vault readiness and active account ownership.");
  process.exitCode = 1;
} finally { db.close(); }
