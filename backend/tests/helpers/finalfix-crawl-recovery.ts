import { processExecutionJobById } from "../../src/execution-jobs/dispatcher.js";
import { closePostgresPool } from "../../src/postgres/pool.js";
import { resetDatabase } from "../../src/postgres/access.js";

/**
 * Recovery scenarios must use the exact database cloned by freshTestDatabase().
 * The historical fixture only accepted the retired `lingong_t_` prefix, while
 * this migration suite owns a distinct prefix through TEST_DB_PREFIX.
 */
const database = new URL(process.env.DATABASE_URL || "");
const prefix = String(process.env.TEST_DB_PREFIX || "").trim();
if (
  database.protocol !== "postgres:" && database.protocol !== "postgresql:"
  || !prefix
  || !database.pathname.startsWith(`/${prefix}_`)
) {
  throw new Error("isolated_test_database_required");
}

try {
  const result = await processExecutionJobById(process.argv[2], `recovery-child:${process.pid}`, {
    lease_ms: 1000,
    renew_ms: 500,
  });
  process.send?.({ result });
} finally {
  await resetDatabase();
  await closePostgresPool();
  process.disconnect?.();
}
