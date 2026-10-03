/**
 * 测试用 PostgreSQL：每个用例从模板库拷一个全新库（文件级拷贝，实测 ~0.2s），跑完统一 DROP。
 *
 * 用法：测试文件的 beforeEach 里调用 `await freshTestDatabase()`，它会把 DATABASE_URL 指向新库；
 * 模板库由 `npm run db:apply:postgres-schema` 建出（见 docs 与 migrations/pg-baseline.sql）。
 * 管理连接只用 TEST_DATABASE_URL（缺省回落到 DATABASE_URL），仅用于 CREATE/DROP 测试库。
 */
import { Client } from "pg";

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
  return name;
}

/** 删掉本 worker 建过的所有测试库（由 tests/setup.ts 的 afterAll 调用）。 */
export async function dropTestDatabases(): Promise<void> {
  if (!ADMIN_URL || !created.length) return;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    for (const name of created.splice(0, created.length)) {
      await admin.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
