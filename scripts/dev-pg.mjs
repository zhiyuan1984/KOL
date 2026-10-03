#!/usr/bin/env node
/**
 * 本地开发切 PostgreSQL：运行/测试不再使用 SQLite 的 data/ 作为库。
 *
 * 用法：
 *   node scripts/dev-pg.mjs                 # 使用 DATABASE_URL（缺省 127.0.0.1:5432/lingong_dev）
 *   node scripts/dev-pg.mjs --docker        # 先起一个仅监听 127.0.0.1 的 postgres:16 容器，再初始化
 *   node scripts/dev-pg.mjs --fresh         # 删除并重建开发库（丢本地数据；从 data/lingong.db 重迁）
 *   node scripts/dev-pg.mjs --no-start      # 只准备数据库，不启动后端 dev
 *   node scripts/dev-pg.mjs --url <url>     # 指定目标连接串
 *
 * 行为：等待 PG 可达 → 建库 → 应用 schema（幂等）→ 若库为空（或 --fresh）且有
 *       data/lingong.db 则一次性迁移历史数据 → 在 backend/ 以 DATABASE_URL 启动 `npm run dev`。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const useDocker = has("--docker");
const fresh = has("--fresh");
const noStart = has("--no-start");
const urlIndex = args.indexOf("--url");
const databaseUrl = (urlIndex >= 0 ? args[urlIndex + 1] : undefined)
  || process.env.DATABASE_URL
  || "postgresql://lingong:local-dev-only@127.0.0.1:5432/lingong_dev";

function fail(message) {
  console.error(`dev-pg: ${message}`);
  process.exit(1);
}

function run(command, runArgs, options = {}) {
  const result = spawnSync(command, runArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`命令失败（exit ${result.status}）：${command} ${runArgs.join(" ")}`);
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

const target = new URL(databaseUrl);
const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (!dbName) fail("DATABASE_URL 里没有数据库名");
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

const require = createRequire(path.join(root, "backend", "package.json"));
let pg;
try {
  pg = require("pg");
} catch {
  fail("backend 依赖未安装：先 cd backend && npm ci");
}
const { Client } = pg;

async function connectWithRetry(url, attempts = 30) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  fail(`PostgreSQL 不可达（${target.hostname}:${target.port}）：${lastError?.message || "未知错误"}`);
}

if (useDocker) {
  const container = "kol-dev-pg";
  const inspected = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", container], { encoding: "utf8" });
  if (inspected.status === 0 && inspected.stdout.trim() === "true") {
    console.log("dev-pg: 复用已运行的容器 kol-dev-pg");
  } else if (inspected.status === 0) {
    run("docker", ["start", container]);
  } else {
    run("docker", ["run", "-d", "--name", container,
      "-e", "POSTGRES_USER=lingong", "-e", "POSTGRES_PASSWORD=local-dev-only", "-e", "POSTGRES_DB=lingong_dev",
      "-p", "127.0.0.1:5432:5432", "postgres:18-alpine"]);
  }
}

const admin = await connectWithRetry(adminUrl.toString());
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (fresh && exists.rowCount) {
  await admin.query(`DROP DATABASE ${quoteIdent(dbName)}`);
  console.log(`dev-pg: 已删除开发库 ${dbName}（--fresh）`);
}
if (fresh || !exists.rowCount) {
  await admin.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
  console.log(`dev-pg: 已创建开发库 ${dbName}`);
}
await admin.end();

const backendDir = path.join(root, "backend");
const tsx = path.join(backendDir, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsx)) fail("backend 依赖未安装：先 cd backend && npm ci");
const env = { ...process.env, DATABASE_URL: databaseUrl };

console.log("dev-pg: 应用 schema（幂等）…");
run(process.execPath, [tsx, "scripts/apply-postgres-schema.ts"], { cwd: backendDir, env });

const seedSource = path.join(root, "data", "lingong.db");
const probe = await connectWithRetry(databaseUrl);
const counts = await probe.query("SELECT count(*)::int AS n FROM knowledge").catch(() => ({ rows: [{ n: 0 }] }));
await probe.end();
if (fresh || !counts.rows[0]?.n) {
  if (fs.existsSync(seedSource)) {
    console.log(`dev-pg: 从 ${path.relative(root, seedSource)} 迁移历史数据（--replace）…`);
    run(process.execPath, [tsx, "scripts/migrate-sqlite-to-postgres.ts", "--source", seedSource, "--replace"], { cwd: backendDir, env });
    console.log("dev-pg: 迁移后重放 schema 补充（触发器/索引）…");
    run(process.execPath, [tsx, "scripts/apply-postgres-schema.ts"], { cwd: backendDir, env });
  } else {
    console.log("dev-pg: data/lingong.db 不存在，跳过历史数据迁移（空库开发）");
  }
} else {
  console.log("dev-pg: 开发库已有数据，跳过迁移（需要重建用 --fresh）");
}

// 新环境的第三步：参考数据（连接器目录、默认知识分类）——PG 侧唯一来源，幂等。
console.log("dev-pg: 写入参考数据（幂等）…");
run(process.execPath, [tsx, "scripts/seed-reference-data.ts"], { cwd: backendDir, env });

// 后端测试从模板库克隆测试库（tests/support/pg.ts）：确保 lingong_template 存在且「schema + 参考数据」就绪。
const templateUrl = new URL(databaseUrl);
templateUrl.pathname = "/lingong_template";
const tplAdmin = await connectWithRetry(adminUrl.toString());
const tplExists = await tplAdmin.query("SELECT 1 FROM pg_database WHERE datname = 'lingong_template'");
if (!tplExists.rowCount) {
  await tplAdmin.query('CREATE DATABASE "lingong_template"');
  console.log("dev-pg: 已创建模板库 lingong_template");
}
await tplAdmin.end();
run(process.execPath, [tsx, "scripts/apply-postgres-schema.ts"], { cwd: backendDir, env: { ...env, DATABASE_URL: templateUrl.toString() } });
run(process.execPath, [tsx, "scripts/seed-reference-data.ts"], { cwd: backendDir, env: { ...env, DATABASE_URL: templateUrl.toString() } });
console.log("dev-pg: 模板库 schema + 参考数据已对齐（供后端测试克隆）");

console.log(`\ndev-pg: 数据库就绪 → ${dbName}`);
console.log(`  后端：cd backend && DATABASE_URL=<url> npm run dev   （默认 8765）`);
console.log("  前端：cd frontend && npm run dev                    （Vite 4177，代理 /api）");
console.log("  测试：cd backend && TEST_DATABASE_URL=<同一 PG 的 postgres 库> npm test");
if (!noStart) {
  console.log("\ndev-pg: 启动后端 dev（Ctrl+C 退出）…");
  const child = spawn("npm", ["run", "dev"], {
    cwd: backendDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
