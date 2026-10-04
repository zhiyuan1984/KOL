import { processExecutionJobById } from "../../src/execution-jobs/dispatcher.js";
import { closePostgresPool } from "../../src/postgres/pool.js";
import { resetConn } from "../../src/db.js";

// This process may only open a database owned by freshTestDatabase().
const database = new URL(process.env.DATABASE_URL || "");
if (!database.pathname.startsWith("/lingong_t_")) throw new Error("isolated_test_database_required");
try {
  const result = await processExecutionJobById(process.argv[2], `recovery-child:${process.pid}`, { lease_ms: 1000, renew_ms: 500 });
  process.send?.({ result });
} finally {
  resetConn();
  await closePostgresPool();
  process.disconnect?.();
}
