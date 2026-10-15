import fs from "node:fs";
import path from "node:path";
/**
 * 测试用 PostgreSQL：每个用例从模板库拷一个全新库（文件级拷贝，实测 ~0.2s），跑完统一 DROP。
 *
 * 用法：测试文件的 beforeEach 里调用 `await freshTestDatabase()`，它会把 DATABASE_URL 指向新库；
 * 模板库由 `npm run db:apply:postgres-schema` 建出（见 docs 与 migrations/pg-baseline.sql）。
 * 管理连接只用显式 TEST_DATABASE_URL，仅用于 CREATE/DROP 本 worker 以唯一前缀创建的测试库。
 */
import { Client } from "pg";
import { resetConn } from "../../src/db.js";
import { closePostgresPool } from "../../src/postgres/pool.js";

const ADMIN_URL = String(process.env.TEST_DATABASE_URL || "").trim();
const TEMPLATE = String(process.env.TEST_DB_TEMPLATE || "lingong_template").trim();
const PREFIX = String(process.env.TEST_DB_PREFIX || "lingong_t").trim();

const created: string[] = [];
let counter = 0;

function urlWithDatabase(name: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe database identifier: ${name}`);
  return name;
}

/** 建一个全新测试库并把 DATABASE_URL 指向它，返回库名。 */
export async function freshTestDatabase(options: { empty?: boolean; reclaimPrevious?: boolean } = {}): Promise<string> {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL is required for isolated PostgreSQL tests");
  // Only an explicit sequential beforeEach fixture opts into reclaiming its
  // completed previous case. The created list never contains production DBs.
  if (options.reclaimPrevious) await dropTestDatabases();
  const name = ident(`${PREFIX}_${process.pid}_${++counter}`);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(options.empty ? `CREATE DATABASE ${name}` : `CREATE DATABASE ${name} TEMPLATE ${ident(TEMPLATE)}`);
  } finally {
    await admin.end();
  }
  created.push(name);
  // Close the previous native pool before selecting the new independent database.
  // Close it before switching, then make the new clone the only application target.
  await closePostgresPool();
  process.env.DATABASE_URL = urlWithDatabase(name);
  await resetConn();
  const { postgresPool } = await import("../../src/postgres/pool.js");
  // A shared historical template is a starting snapshot, not schema authority.
  // Apply the complete checksum-protected manifest only to this owned clone.
  // Empty and historical clones must expose the same current formal schema.
  const { applyPostgresMigrations } = await import("../../src/postgres/migrations.js");
  const client = await postgresPool().connect();
  try { await applyPostgresMigrations(client); } finally { client.release(); }
  const { runtimeActionSchema, crawlQueueStateMigration } = await import("../../src/runtime/action-schema.js");
  await postgresPool().query(runtimeActionSchema);
  for (const statement of crawlQueueStateMigration) await postgresPool().query(statement);
  const { crawlResultSchema } = await import("../../src/crawl/result-schema.js");
  await postgresPool().query(crawlResultSchema);
  const { replyContextSchema } = await import("../../src/mail/reply-context-schema.js");
  await postgresPool().query(replyContextSchema);
  const { collaborationSchema } = await import("../../src/ticket-domain/collaboration-schema.js");
  await postgresPool().query(collaborationSchema);
  const { workOrderAdoptionSchema } = await import("../../src/ticket-domain/work-order-adoption-schema.js");
  await postgresPool().query(workOrderAdoptionSchema);
  const { taskCollaborationSessionSchema } = await import("../../src/ticket-domain/task-collaboration-session.js");
  await postgresPool().query(taskCollaborationSessionSchema);
  const { candidateActionsSchema } = await import("../../src/crawl/candidate-actions-schema.js");
  await postgresPool().query(candidateActionsSchema);
  const { candidateAssessmentSchema } = await import("../../src/crawl/assessment-schema.js");
  await postgresPool().query(candidateAssessmentSchema);
  const { runtimeActionEventSchema } = await import("../../src/runtime/action-event-schema.js");
  await postgresPool().query(runtimeActionEventSchema);
  // Formal domain extensions are executed only against this newly created test DB.
  // The test runner's cwd is backend. Vite's web transform rewrites dynamic
  // new URL(..., import.meta.url) in sibling jsdom tests into browser asset URLs.
  for (const filename of ["032_review_postgres.sql", "033_credential_native_default.sql", "042_organization_native_postgres.sql", "043_mail_send_native.sql", "044_mail_memory_native_cache.sql", "045_skill_presentation_overlays.sql"]) {
    await postgresPool().query(fs.readFileSync(path.resolve(process.cwd(), "migrations", filename), "utf8"));
  }
  return name;
}

/** 删掉本 worker 建过的所有测试库（由 tests/setup.ts 的 afterAll 调用）。 */
export async function dropTestDatabases(): Promise<void> {
  if (!ADMIN_URL || !created.length) return;
  // Never reconnect application clients to the management URL during cleanup.
  await resetConn();
  const names = created.splice(0, created.length);
  const admin = new Client({ connectionString: ADMIN_URL });
  const failures: unknown[] = [];
  try {
    await admin.connect();
    // Serial, bounded retries keep teardown deterministic and retain a real
    // failure if PostgreSQL cannot release one of our own databases.
    for (const name of names) {
      let failure: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await admin.query(`DROP DATABASE IF EXISTS ${ident(name)}`);
          failure = undefined;
          break;
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      if (failure) {
        if (process.env.NODE_ENV === "test" && process.env.TEST_PG_CLEANUP_DIAGNOSTICS === "1") {
          try {
            const sessions = await admin.query(`SELECT pid,state,application_name,client_addr,client_port,
              wait_event_type,wait_event,backend_start,state_change,
              LEFT(regexp_replace(query, $2, $3, 'g'),300) AS query_shape
              FROM pg_stat_activity WHERE datname=$1`, [name, "'[^']*'", "'?'"]);
            console.error("TEST_PG_CLEANUP_SESSIONS", process.pid, name, JSON.stringify(sessions.rows));
            const { execFileSync } = await import("node:child_process");
            const sockets = execFileSync("ss", ["-ntp"], { encoding: "utf8" }).split("\n")
              .filter((line) => /:543[23]\b/.test(line));
            console.error("TEST_PG_CLEANUP_SOCKETS", sockets.join("\n"));
            console.error("TEST_PG_CLEANUP_PROCESS_IDS", execFileSync("ps", ["-eo", "pid,ppid,comm"], { encoding: "utf8" }));
          } catch (diagnosticError) {
            console.error("TEST_PG_CLEANUP_DIAGNOSTIC_UNAVAILABLE", diagnosticError instanceof Error ? diagnosticError.name : "unknown");
          }
        }
        failures.push(failure);
      }
    }
    if (failures.length) throw new AggregateError(failures, "test database cleanup failed");
  } finally {
    await admin.end();
  }
}
