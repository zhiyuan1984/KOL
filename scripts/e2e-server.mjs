import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.LINGONG_PORT || "8876";
// A real staging run must explicitly opt in. Ordinary browser acceptance has
// its own database and data root, never a leftover production shell connection.
const mode = String(process.env.E2E_MODE || process.env.CODEX_MODE || "stub").toLowerCase();
if (mode !== "stub" && mode !== "real") throw new Error(`Unsupported E2E_MODE: ${mode}`);
const authMode = process.env.E2E_AUTH_MODE || (mode === "real" ? "enabled" : "disabled");
const requireBackend = createRequire(path.join(root, "backend", "package.json"));
const { Client } = requireBackend("pg");
const adminUrl = String(process.env.TEST_DATABASE_URL || "").trim();
let ownedDatabase = "";
let data = "";
let ownsData = false;
let child;
let finishing = false;

function identifier(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unsafe E2E test database identifier");
  return name;
}
async function prepareDatabase() {
  if (mode === "real") {
    if (!String(process.env.DATABASE_URL || "").trim()) throw new Error("Real staging E2E requires an explicit DATABASE_URL");
    data = process.env.LINGONG_DATA || path.join(root, "data-e2e");
    fs.mkdirSync(data, { recursive: true });
    return;
  }
  if (!adminUrl) throw new Error("Stub E2E requires TEST_DATABASE_URL; production DATABASE_URL is never used as a fallback");
  const name = identifier(`lingong_e2e_${process.pid}_${Date.now()}`);
  const template = identifier(process.env.TEST_DB_TEMPLATE || "lingong_template");
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
    ownedDatabase = name;
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  data = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-e2e-data-"));
  ownsData = true;
  console.log(`[e2e] isolated PostgreSQL database: ${name}`);
}
async function prepareAuthenticatedFixture() {
  if (mode !== "stub" || authMode !== "enabled") return;
  const seed = spawn(process.execPath, [
    path.join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs"), "scripts/seed-e2e-runtime.ts",
  ], { cwd: path.join(root, "backend"), env: { ...process.env,
    NODE_ENV: "test", E2E_MODE: "stub", E2E_OWNED_DATABASE: ownedDatabase,
    AUTH_MODE: "enabled", CODEX_MODE: "stub", LINGONG_DATA: data,
  }, stdio: "inherit", windowsHide: true });
  await new Promise((resolve, reject) => {
    seed.once("error", reject);
    seed.once("exit", code => code === 0 ? resolve() : reject(new Error(`E2E account initializer failed (${code})`)));
  });
}
async function cleanup() {
  try {
    if (ownedDatabase) {
      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      try { await admin.query(`DROP DATABASE IF EXISTS ${identifier(ownedDatabase)} WITH (FORCE)`); }
      finally { await admin.end(); }
      ownedDatabase = "";
    }
  } finally {
    if (ownsData) fs.rmSync(data, { recursive: true, force: true });
  }
}
async function finish(code) {
  if (finishing) return;
  finishing = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    let timer;
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000); })]);
    clearTimeout(timer);
  }
  try { await cleanup(); }
  catch (error) { console.error("E2E-owned resource cleanup failed", error); code = 1; }
  process.exit(code);
}
process.on("SIGINT", () => void finish(0));
process.on("SIGTERM", () => void finish(0));

function startBackend() {
  child = spawn(process.execPath, [
    path.join(root, "backend", "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts",
  ], {
    cwd: path.join(root, "backend"),
    env: {
      ...process.env,
      NODE_ENV: mode === "stub" ? "test" : process.env.NODE_ENV || "production",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${path.join(root, "scripts", "tsx-windows-shim.cjs")}`.trim(),
      CODEX_MODE: mode,
      AUTH_MODE: authMode,
      LINGONG_PORT: port,
      LINGONG_DATA: data,
      KNOWLEDGE_ENGINE_MODE: process.env.KNOWLEDGE_ENGINE_MODE || (mode === "stub" ? "stub" : "real"),
      RUNTIME_CREDENTIAL_MASTER_KEY: mode === "stub" ? "0".repeat(64) : process.env.RUNTIME_CREDENTIAL_MASTER_KEY || "",
    },
    stdio: "inherit", windowsHide: true,
  });
  child.on("error", error => { console.error(error); void finish(1); });
  child.on("exit", code => { if (!finishing) void finish(code || 0); });
}
async function main() {
  await prepareDatabase();
  await prepareAuthenticatedFixture();
  if (finishing) return;
  if (process.env.E2E_SKIP_BUILD === "1") { startBackend(); return; }
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  child = spawn(command, args, { cwd: path.join(root, "frontend"), env: process.env, stdio: "inherit", windowsHide: true });
  child.on("error", error => { console.error(error); void finish(1); });
  child.on("exit", code => {
    if (finishing) return;
    if (code !== 0) { void finish(code || 1); return; }
    startBackend();
  });
}
main().catch(error => { console.error(error); void finish(1); });
