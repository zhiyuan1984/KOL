/**
 * 测试用 PostgreSQL：每个用例从模板库拷一个全新库（文件级拷贝，实测 ~0.2s），跑完统一 DROP。
 *
 * 用法：测试文件的 beforeEach 里调用 `await freshTestDatabase()`，它会把 DATABASE_URL 指向新库；
 * 模板库由 `npm run db:apply:postgres-schema` 建出（见 docs 与 migrations/pg-baseline.sql）。
 * 管理连接只用 TEST_DATABASE_URL（缺省回落到 DATABASE_URL），仅用于 CREATE/DROP 测试库。
 */
import { Client, Pool } from "pg";
import { resetConn } from "../../src/db.js";
import { closePostgresPool } from "../../src/postgres/pool.js";

const ADMIN_URL = String(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "").trim();
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
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL（或 DATABASE_URL）未设置：PostgreSQL 测试需要它");
  const name = ident(`${PREFIX}_${process.pid}_${++counter}`);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${ident(TEMPLATE)}`);
  } finally {
    await admin.end();
  }
  created.push(name);
  process.env.DATABASE_URL = urlWithDatabase(name);
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
  const { runtimeActionEventSchema } = await import("../../src/runtime/action-event-schema.js");
  await postgresPool().query(runtimeActionEventSchema);
  return name;
}

/** 删掉本 worker 建过的所有测试库（由 tests/setup.ts 的 afterAll 调用）。 */
export async function dropTestDatabases(): Promise<void> {
  if (!ADMIN_URL || !created.length) return;
  // Durable job routes use the native pool alongside historical mail fixtures.
  // Release it before DROP rather than waiting for PostgreSQL to evict it.
  await closePostgresPool();
  // 先把应用侧连接从测试库上摘下来：resetConn() 会立即重连，所以先把 DATABASE_URL 指回管理库，
  // 否则 DROP 会踢掉在线连接并抛 57P01（admin_shutdown）噪声错误。
  process.env.DATABASE_URL = ADMIN_URL;
  try {
    resetConn();
  } catch {
    /* 连接已关闭等情形忽略 */
  }
  // Drop only databases this worker created. Bounded parallel drops share the
  // server checkpoint instead of waiting for one Windows checkpoint per DB.
  const admin = new Pool({ connectionString: ADMIN_URL, max: 8 });
  try {
    const results = await Promise.allSettled(created.splice(0, created.length).map((name) =>
      admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`),
    ));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "test database cleanup failed");
  } finally { await admin.end(); }
}
