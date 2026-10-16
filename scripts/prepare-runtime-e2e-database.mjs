#!/usr/bin/env node
/**
 * Creates one empty PostgreSQL database for the native-runtime E2E partition.
 *
 * This module deliberately reads no .env file. Callers must pass every authority
 * input explicitly through the environment (or the exported function arguments).
 * It connects to the already-isolated source database with the same PostgreSQL
 * account, validates that connection's identity, and creates a new empty database.
 * It never clones, drops, or mutates the source database.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MAX_DATABASE_IDENTIFIER_BYTES = 63;
const PROTECTED_DATABASES = new Set(["postgres", "template0", "template1", "prod", "production", "lingong"]);
const PRODUCTION_SEGMENT = /(?:^|_)(?:prod|production)(?:_|$)/;

function fail(message) {
  throw new Error(message);
}

function requireSafePrefix(value) {
  const prefix = String(value || "").trim();
  if (!IDENTIFIER.test(prefix)) fail("TEST_DB_PREFIX must be a lowercase PostgreSQL identifier");
  if (Buffer.byteLength(prefix, "utf8") >= MAX_DATABASE_IDENTIFIER_BYTES - "_runtime_x".length) {
    fail("TEST_DB_PREFIX leaves no room for a fresh runtime database name");
  }
  return prefix;
}

function readDatabaseName(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL must be a PostgreSQL URL with an explicit database name");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    fail("DATABASE_URL must use the PostgreSQL protocol");
  }
  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    fail("DATABASE_URL contains an invalid database name");
  }
  if (!database || database.includes("/")) fail("DATABASE_URL must name one database");
  if (!IDENTIFIER.test(database)) fail("DATABASE_URL database name must be a lowercase PostgreSQL identifier");
  return database;
}

/**
 * Pure fail-closed guard. It intentionally performs no I/O and can be unit tested
 * independently of PostgreSQL. A valid source must be a named, prefixed test DB;
 * the common admin and production names are never authority for this helper.
 */
export function assertRuntimeIsolationInput({ databaseUrl, prefix, nodeEnv, e2eMode, e2eAuthMode }) {
  if (String(nodeEnv || "") !== "test" || String(e2eMode || "") !== "stub" || String(e2eAuthMode || "") !== "enabled") {
    fail("runtime database creation requires NODE_ENV=test, E2E_MODE=stub, and E2E_AUTH_MODE=enabled");
  }
  const safePrefix = requireSafePrefix(prefix);
  const sourceDatabase = readDatabaseName(String(databaseUrl || "").trim());
  if (!sourceDatabase.startsWith(`${safePrefix}_`)) {
    fail("DATABASE_URL must name an explicitly prefixed isolated test database");
  }
  if (PROTECTED_DATABASES.has(sourceDatabase) || PRODUCTION_SEGMENT.test(sourceDatabase)) {
    fail("DATABASE_URL may not name a PostgreSQL admin or production database");
  }
  return { databaseUrl: String(databaseUrl).trim(), prefix: safePrefix, sourceDatabase };
}

function safeToken(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) fail("runtime database token must contain lowercase letters or digits");
  return normalized;
}

function generatedRunToken() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${process.pid}_${randomBytes(5).toString("hex")}`;
}

/** Returns one safe, length-bounded PostgreSQL database name without performing I/O. */
export function makeFreshRuntimeDatabaseName(prefix, token = generatedRunToken()) {
  const safePrefix = requireSafePrefix(prefix);
  const stem = `${safePrefix}_runtime_`;
  const available = MAX_DATABASE_IDENTIFIER_BYTES - Buffer.byteLength(stem, "utf8");
  if (available < 9) fail("TEST_DB_PREFIX leaves no room for a unique runtime database name");

  const normalizedToken = safeToken(token);
  const digest = createHash("sha256").update(normalizedToken).digest("hex").slice(0, 8);
  const boundedToken = normalizedToken.length <= available
    ? normalizedToken
    : `${normalizedToken.slice(0, available - digest.length - 1)}_${digest}`;
  const name = `${stem}${boundedToken}`;
  if (!IDENTIFIER.test(name) || Buffer.byteLength(name, "utf8") > MAX_DATABASE_IDENTIFIER_BYTES) {
    fail("fresh runtime database name is not a safe PostgreSQL identifier");
  }
  return name;
}

/** PostgreSQL identifiers cannot be parameterized; this only accepts the safe grammar above. */
export function quotePostgresIdentifier(identifier) {
  if (!IDENTIFIER.test(identifier) || Buffer.byteLength(identifier, "utf8") > MAX_DATABASE_IDENTIFIER_BYTES) {
    fail("refusing to quote an unsafe PostgreSQL identifier");
  }
  return `"${identifier}"`;
}

function defaultClientFactory(connectionString) {
  const backendRequire = createRequire(new URL("../backend/package.json", import.meta.url));
  const { Client } = backendRequire("pg");
  return new Client({ connectionString });
}

/**
 * Validates before constructing a client, verifies the connected source identity,
 * then creates exactly one new empty database. No cleanup is attempted on failure
 * or success so a failed runtime fixture remains available for investigation.
 */
export async function createFreshRuntimeDatabase(input, { clientFactory = defaultClientFactory } = {}) {
  const authority = assertRuntimeIsolationInput(input);
  const databaseName = makeFreshRuntimeDatabaseName(authority.prefix, input.token);
  const client = clientFactory(authority.databaseUrl);
  try {
    await client.connect();
    const identity = await client.query("SELECT current_database() AS name");
    if (String(identity.rows?.[0]?.name || "") !== authority.sourceDatabase) {
      fail("source database identity did not match the explicitly validated DATABASE_URL");
    }
    await client.query(`CREATE DATABASE ${quotePostgresIdentifier(databaseName)}`);
    return databaseName;
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    const databaseName = await createFreshRuntimeDatabase({
      databaseUrl: process.env.DATABASE_URL,
      prefix: process.env.TEST_DB_PREFIX,
      nodeEnv: process.env.NODE_ENV,
      e2eMode: process.env.E2E_MODE,
      e2eAuthMode: process.env.E2E_AUTH_MODE,
      token: process.env.RUNTIME_E2E_DB_TOKEN,
    });
    // Stdout is intentionally machine-readable and contains only the new name,
    // never the source or target connection URL.
    process.stdout.write(`${databaseName}\n`);
  } catch (error) {
    // Do not echo a connection URL: it can contain a password.
    console.error(`runtime E2E database preparation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
