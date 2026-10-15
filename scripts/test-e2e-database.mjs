import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-e2e-db-safety-"));
try {
  fs.mkdirSync(path.join(dir, "backend/scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "backend/node_modules/pg"), { recursive: true });
  const script = path.join(dir, "backend/scripts/e2e-database.mjs");
  fs.copyFileSync(path.join(root, "backend/scripts/e2e-database.mjs"), script);
  fs.writeFileSync(path.join(dir, "backend/node_modules/pg/package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
  fs.writeFileSync(path.join(dir, "backend/node_modules/pg/index.js"), `import fs from 'node:fs'; export class Client {async connect(){} async end(){} async query(sql){fs.appendFileSync(process.env.SQL_RECORD,sql+'\\n');return {rows:[]};}}\n`);
  const record = path.join(dir, "owned.json"); const queries = path.join(dir, "queries.txt");
  const run = (url, op = "create", owner = "321") => {
    const env = { ...process.env, DATABASE_URL: url, SQL_RECORD: queries };
    fs.writeFileSync(path.join(dir, ".env"), `DATABASE_URL=${url}\n`);
    return spawnSync(process.execPath, [script, op, record, owner], { env, encoding: "utf8" });
  };
  for (const url of ["postgresql://fixture@127.0.0.1/lingong", "postgresql://fixture@10.0.0.1/lingong_e2e", "postgresql://fixture@127.0.0.1/postgres"]) {
    assert.notEqual(run(url).status, 0, "unsafe source must fail");
    assert.equal(fs.existsSync(queries), false, "unsafe source must execute zero SQL");
  }
  const source = "postgresql://fixture@127.0.0.1/lingong_e2e";
  assert.equal(run(source).status, 0);
  const value = JSON.parse(fs.readFileSync(record, "utf8"));
  assert.match(value.database, /^lingong_t_server_e2e_321_[a-z0-9]+$/);
  assert.equal(fs.statSync(record).mode & 0o777, 0o600);
  assert.notEqual(run(source, "create").status, 0, "cannot overwrite owner record");
  assert.notEqual(run(source, "drop", "322").status, 0, "different process cannot delete database");
  assert.equal(fs.readFileSync(queries, "utf8").trim().split("\n").length, 1);
  assert.equal(run(source, "drop").status, 0);
  const sql = fs.readFileSync(queries, "utf8").trim().split("\n");
  assert.equal(sql.length, 2); assert.match(sql[0], /^CREATE DATABASE "lingong_t_server_e2e_/); assert.match(sql[1], /^DROP DATABASE "lingong_t_server_e2e_/);
  assert.doesNotMatch(sql.join("\n"), /FORCE|terminate|TRUNCATE|DELETE|RESET/);
  assert.equal(fs.existsSync(record), false);
  console.log("E2E database safety: production/remote/admin sources and wrong owner refused with zero unsafe SQL; one private owned CREATE/plain DROP passed");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
