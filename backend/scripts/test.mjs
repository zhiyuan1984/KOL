import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe PostgreSQL identifier: ${name}`);
  return name;
}

function childExit(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function listSuites(args, env) {
  const child = spawn(process.execPath, [vitest, "list", "--configLoader", "runner", "--filesOnly", ...args], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`Vitest could not list suites (exit ${code}): ${stderr.trim()}`);
  const suites = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(line) && fs.existsSync(path.resolve(root, line));
  });
  if (!suites.length) throw new Error("Vitest did not resolve any test suites");
  return [...new Set(suites)];
}

function isSuiteFilter(arg) {
  return /^(?:\.\.?\/)?(?:tests|frontend)\//.test(arg)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(arg)
    || arg.includes("*");
}

async function createDatabase(adminUrl, database, template) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${ident(database)} TEMPLATE ${ident(template)}`);
  } finally {
    await admin.end();
  }
}

async function dropOwnedDatabases(adminUrl, suiteDatabase, prefix) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const failures = [];
  try {
    const { rows } = await admin.query("SELECT datname FROM pg_database");
    const names = rows
      .map((row) => String(row.datname))
      .filter((name) => name === suiteDatabase || name.startsWith(`${prefix}_`));
    for (const name of names) {
      let failure;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()",
            [name],
          );
          await admin.query(`DROP DATABASE IF EXISTS ${ident(name)}`);
          failure = undefined;
          break;
        } catch (error) {
          failure = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
      if (failure) failures.push(failure);
    }
  } finally {
    await admin.end();
  }
  if (failures.length) throw new AggregateError(failures, "isolated PostgreSQL suite cleanup failed");
}

async function applyManifest(env) {
  const program = [
    'import { applyNativePostgresTestManifest } from "./tests/support/pg.ts";',
    'import { closePostgresPool } from "./src/postgres/pool.ts";',
    "void (async () => {",
    "try {",
    "  const receipt = await applyNativePostgresTestManifest();",
    '  console.log(JSON.stringify({ event: "pg_test_manifest", ...receipt }));',
    "} finally {",
    "  await closePostgresPool();",
    "}",
    "})().catch((error) => { console.error(error); process.exitCode = 1; });",
  ].join("\n");
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const code = await childExit(tsx, ["--eval", program], { env, stdio: "inherit" });
  if (code !== 0) throw new Error(`native PostgreSQL manifest bootstrap failed (exit ${code})`);
}

const requestedArgs = process.argv.slice(2);
const adminUrl = String(process.env.TEST_DATABASE_URL || "").trim();
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required as the isolated PostgreSQL management connection");
const parsedAdmin = new URL(adminUrl);
if (!/^postgres(?:ql)?:$/.test(parsedAdmin.protocol)) throw new Error("TEST_DATABASE_URL must be PostgreSQL");
const template = ident(String(process.env.TEST_DB_TEMPLATE || "kol_native_uiux_template").trim());
const basePrefix = ident(String(process.env.TEST_DB_PREFIX || "kol_rem_pgbase").trim());
if (!fs.existsSync(vitest)) throw new Error("locked Vitest entry point is unavailable; install the backend lockfile before testing");

// Suite discovery occurs before any database is created.  Each resolved test
// file then receives an independent cloned database, manifest receipt, and
// teardown; TEST_DATABASE_URL remains management-only throughout.
const listEnv = {
  ...process.env,
  CODEX_MODE: process.env.CODEX_MODE || "stub",
  AUTH_MODE: process.env.AUTH_MODE || "disabled",
  NODE_ENV: "test",
  NO_COLOR: "1",
};
const suites = await listSuites(requestedArgs, listEnv);
const passthroughArgs = requestedArgs.filter((arg) => !isSuiteFilter(arg));
let failed = false;

for (const [index, suite] of suites.entries()) {
  const suffix = `${process.pid}${index + 1}`;
  const suiteDatabase = ident(`kolnative_resolution_suite_${suffix}`);
  const prefix = ident(`${basePrefix}_${suffix}`);
  const suiteUrl = new URL(adminUrl);
  suiteUrl.pathname = `/${suiteDatabase}`;
  const env = {
    ...listEnv,
    TEST_DATABASE_URL: adminUrl,
    TEST_DB_TEMPLATE: template,
    TEST_DB_PREFIX: prefix,
    DATABASE_URL: suiteUrl.toString(),
    TEST_POSTGRES_URL: suiteUrl.toString(),
  };
  console.log(JSON.stringify({ event: "pg_test_suite_start", suite, database: suiteDatabase, template, prefix }));
  let suiteFailed = false;
  try {
    await createDatabase(adminUrl, suiteDatabase, template);
    await applyManifest(env);
    const code = await childExit(process.execPath, [vitest, "run", "--configLoader", "runner", ...passthroughArgs, suite], {
      env,
      stdio: "inherit",
    });
    suiteFailed = code !== 0;
  } catch (error) {
    suiteFailed = true;
    console.error(error);
  } finally {
    try {
      await dropOwnedDatabases(adminUrl, suiteDatabase, prefix);
      console.log(JSON.stringify({ event: "pg_test_suite_cleanup", suite, database: suiteDatabase }));
    } catch (error) {
      suiteFailed = true;
      console.error(error);
    }
  }
  failed ||= suiteFailed;
}

process.exitCode = failed ? 1 : 0;
