import { Client } from "pg";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const adminUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const admin = new Client({ connectionString: adminUrl });
await admin.connect();
const name = `lingong_grantcheck_${process.pid}`;
const url = new URL(adminUrl); url.pathname = `/${name}`;
const c = new Client({ connectionString: url.toString() });
try {
  await admin.query(`CREATE DATABASE ${name}`); await c.connect();
  await c.query(`CREATE TABLE runtime_tool_policies(connector_id text,tool_name text,enabled int,risk text,access text,version int,PRIMARY KEY(connector_id,tool_name));
    CREATE TABLE runtime_skill_tools(skill_id text,connector_id text,tool_name text,enabled int,version int,updated_at text,PRIMARY KEY(skill_id,connector_id,tool_name));
    CREATE TABLE audit_events(ts text,actor text,event_type text,payload jsonb);
    INSERT INTO runtime_tool_policies VALUES('starrykol','addKolProfile',1,'L3','write',9),('starrykol','importKolProfilesFromCrawler',1,'L3','write',3);
    INSERT INTO runtime_skill_tools VALUES('other_skill','starrykol','addKolProfile',1,4,'baseline');`);
  const run = (marker = "20261009-1127") => spawnSync(process.execPath, ["scripts/enable-discovery-add-profile.mjs"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: url.toString(), CONFIRMED_DISCOVERY_ADD_GRANT: marker } });
  assert.notEqual(run("unapproved").status, 0);
  const first = run(); assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).changed, true);
  const second = run(); assert.equal(second.status, 0, second.stderr); assert.equal(JSON.parse(second.stdout).changed, false);
  const audits = (await c.query("SELECT * FROM audit_events")).rows; assert.equal(audits.length, 1);
  assert.equal((await c.query("SELECT version FROM runtime_skill_tools WHERE skill_id='other_skill'")).rows[0].version, 4);
  await c.query("UPDATE runtime_tool_policies SET risk='L1',access='read' WHERE tool_name='addKolProfile'");
  assert.notEqual(run().status, 0);
  assert.equal((await c.query("SELECT count(*)::int AS n FROM audit_events")).rows[0].n, 1);
  console.log("Grant tests passed: approved-only, exact scope, idempotent replay, policy mismatch denied; production untouched");
} finally {
  await c.end().catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}
