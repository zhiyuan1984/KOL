import assert from "node:assert/strict";
import {
  assertRuntimeIsolationInput,
  createFreshRuntimeDatabase,
  makeFreshRuntimeDatabaseName,
  quotePostgresIdentifier,
} from "./prepare-runtime-e2e-database.mjs";

const valid = {
  databaseUrl: "postgresql://runtime_user:never-log-this@127.0.0.1:5432/kol_gate_runtime_v2",
  prefix: "kol_gate",
  nodeEnv: "test",
  e2eMode: "stub",
  e2eAuthMode: "enabled",
  token: "d543a055_20261016_1234_a1b2c3d4",
};

assert.deepEqual(assertRuntimeIsolationInput(valid), {
  databaseUrl: valid.databaseUrl,
  prefix: "kol_gate",
  sourceDatabase: "kol_gate_runtime_v2",
});

for (const [label, input] of [
  ["prefix mismatch", { ...valid, databaseUrl: "postgresql://user:password@127.0.0.1:5432/other_gate_e2e" }],
  ["database missing", { ...valid, databaseUrl: "postgresql://user:password@127.0.0.1:5432/" }],
  ["production name", { ...valid, databaseUrl: "postgresql://user:password@127.0.0.1:5432/lingong" }],
  ["production suffix", { ...valid, databaseUrl: "postgresql://user:password@127.0.0.1:5432/kol_gate_production" }],
  ["unsafe prefix", { ...valid, prefix: "kol_gate;drop_database" }],
  ["wrong test mode", { ...valid, e2eAuthMode: "disabled" }],
]) {
  let factoryCalls = 0;
  await assert.rejects(
    createFreshRuntimeDatabase(input, { clientFactory: () => { factoryCalls += 1; throw new Error("must not connect"); } }),
    undefined,
    label,
  );
  assert.equal(factoryCalls, 0, `${label} must fail before creating a PostgreSQL client`);
}

const generated = makeFreshRuntimeDatabaseName("kol_gate", "D543A055/2026-10-16 pid=1234 random=A1B2");
assert.match(generated, /^kol_gate_runtime_[a-z_][a-z0-9_]*$/);
assert.ok(Buffer.byteLength(generated, "utf8") <= 63);
assert.equal(quotePostgresIdentifier(generated), `"${generated}"`);
assert.throws(() => quotePostgresIdentifier("kol_gate;DROP DATABASE lingong"));

const calls = [];
const client = {
  async connect() { calls.push("connect"); },
  async query(sql) {
    calls.push(sql);
    if (sql === "SELECT current_database() AS name") return { rows: [{ name: "kol_gate_runtime_v2" }] };
    return { rows: [] };
  },
  async end() { calls.push("end"); },
};
const created = await createFreshRuntimeDatabase(valid, { clientFactory: () => client });
assert.match(created, /^kol_gate_runtime_d543a055_20261016_1234_a1b2c3d4$/);
assert.deepEqual(calls.slice(0, 2), ["connect", "SELECT current_database() AS name"]);
assert.match(calls[2], /^CREATE DATABASE "kol_gate_runtime_[a-z_][a-z0-9_]*"$/);
assert.equal(calls.at(-1), "end");

const mismatchCalls = [];
await assert.rejects(
  createFreshRuntimeDatabase(valid, {
    clientFactory: () => ({
      async connect() { mismatchCalls.push("connect"); },
      async query(sql) { mismatchCalls.push(sql); return { rows: [{ name: "kol_gate_other" }] }; },
      async end() { mismatchCalls.push("end"); },
    }),
  }),
  /source database identity/,
);
assert.equal(mismatchCalls.some((sql) => String(sql).startsWith("CREATE DATABASE")), false);

console.log("runtime_e2e_database_helper: 6 fail-before-connect guards + safe fresh name + quoted CREATE sequencing passed");
