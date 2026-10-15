import { processExecutionJobById } from "../../src/execution-jobs/dispatcher.js";
import { resetConn } from "../../src/db.js";
import { postgresPool } from "../../src/postgres/pool.js";

// A recovery child may only use the exact freshTestDatabase clone explicitly
// handed over by its root test process. This guards against a child inheriting
// a shell/production DATABASE_URL while preserving the real child process.
const databaseUrl = String(process.env.DATABASE_URL || "");
const expectedDatabase = String(process.env.KOL_NATIVE_CRAWL_TEST_DATABASE || "");
const prefix = String(process.env.TEST_DB_PREFIX || "");
const rootPid = String(process.env.KOL_NATIVE_CRAWL_TEST_ROOT_PID || "");
let database: URL;
try {
  database = new URL(databaseUrl);
} catch {
  throw new Error("isolated_test_database_required");
}
const actualDatabase = database.pathname.replace(/^\//, "");
if (!expectedDatabase || !prefix || !/^\d+$/.test(rootPid)
  || actualDatabase !== expectedDatabase
  || !actualDatabase.startsWith(`${prefix}_${rootPid}_`)) {
  throw new Error("isolated_test_database_required");
}

try {
  // Do not use the legacy synchronous fixture connection: prove that this
  // child opened the exact inherited native PostgreSQL database before it can
  // claim a persistent execution job.
  const current = await postgresPool().query<{ database: string }>("SELECT current_database() AS database");
  if (current.rows[0]?.database !== expectedDatabase) throw new Error("isolated_test_database_mismatch");
  const result = await processExecutionJobById(process.argv[2], `recovery-child:${process.pid}`, { lease_ms: 1000, renew_ms: 500 });
  process.send?.({ result });
} finally {
  await resetConn();
  process.disconnect?.();
}
