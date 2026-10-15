import { fileURLToPath } from "node:url";
import fs from "node:fs";
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
export async function freshTestDatabase(): Promise<string> {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL is required for isolated PostgreSQL tests");
  const name = ident(`${PREFIX}_${process.pid}_${++counter}`);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${ident(TEMPLATE)}`);
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
  for (const filename of ["032_review_postgres.sql", "033_credential_native_default.sql", "042_organization_native_postgres.sql", "043_mail_send_native.sql", "044_mail_memory_native_cache.sql"]) {
    await postgresPool().query(fs.readFileSync(fileURLToPath(new URL(`../../migrations/${filename}`, import.meta.url)), "utf8"));
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
          await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
          failure = undefined;
          break;
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      if (failure) failures.push(failure);
    }
    if (failures.length) throw new AggregateError(failures, "test database cleanup failed");
  } finally {
    await admin.end();
  }
}
