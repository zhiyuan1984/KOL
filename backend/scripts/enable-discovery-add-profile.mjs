import { Client } from "pg";
import fs from "node:fs";
// Exact authority approved by user on 2026-10-09 11:27 +08:00; not a bulk seed or role grant.
if (process.env.CONFIRMED_DISCOVERY_ADD_GRANT !== "20261009-1127") throw new Error("Explicit approved grant marker required");
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('approved-discovery-add-profile-grant',0))");
  for (const tool of ["addKolProfile", "importKolProfilesFromCrawler"]) {
    const policy = (await c.query("SELECT * FROM runtime_tool_policies WHERE connector_id='starrykol' AND tool_name=$1 FOR UPDATE", [tool])).rows[0];
    if (!policy || Number(policy.enabled) !== 1 || policy.risk !== "L3" || policy.access !== "write") throw new Error(`${tool} policy unavailable or changed; not modifying it`);
  }
  const otherBindings = async () => (await c.query(`SELECT * FROM runtime_skill_tools WHERE NOT
    (skill_id='creator_discovery' AND connector_id='starrykol' AND tool_name='addKolProfile') ORDER BY skill_id,connector_id,tool_name`)).rows;
  const beforeOthers = JSON.stringify(await otherBindings());
  const policiesBefore = JSON.stringify((await c.query("SELECT * FROM runtime_tool_policies ORDER BY connector_id,tool_name")).rows);
  const prior = (await c.query(`SELECT * FROM runtime_skill_tools WHERE skill_id='creator_discovery'
    AND connector_id='starrykol' AND tool_name='addKolProfile' FOR UPDATE`)).rows[0] || null;
  if (process.env.GRANT_BACKUP_FILE) fs.writeFileSync(process.env.GRANT_BACKUP_FILE, JSON.stringify({ prior }, null, 2) + "\n", { mode: 0o600 });
  let changed = false;
  if (!prior) {
    await c.query(`INSERT INTO runtime_skill_tools(skill_id,connector_id,tool_name,enabled,version,updated_at)
      VALUES('creator_discovery','starrykol','addKolProfile',1,1,$1)`, [new Date().toISOString()]); changed = true;
  } else if (Number(prior.enabled) !== 1) {
    await c.query(`UPDATE runtime_skill_tools SET enabled=1,version=version+1,updated_at=$1
      WHERE skill_id='creator_discovery' AND connector_id='starrykol' AND tool_name='addKolProfile'`, [new Date().toISOString()]); changed = true;
  }
  const after = (await c.query(`SELECT * FROM runtime_skill_tools WHERE skill_id='creator_discovery'
    AND connector_id='starrykol' AND tool_name='addKolProfile'`)).rows[0];
  if (beforeOthers !== JSON.stringify(await otherBindings()) || policiesBefore !== JSON.stringify((await c.query("SELECT * FROM runtime_tool_policies ORDER BY connector_id,tool_name")).rows)) throw new Error("Unexpected unrelated configuration change");
  if (changed) await c.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)", [new Date().toISOString(),
    "user-approved:manus", "runtime.skill_tool.updated", JSON.stringify({ approved_at: "2026-10-09T11:27:03+08:00",
      task_id: "kZmxfrtRBJJgA1EpjGdJVj", skill_id: "creator_discovery", connector_id: "starrykol", tool_name: "addKolProfile",
      before: prior, after, risk: "L3", access: "write", other_permissions_changed: false, automatic_candidate_retry: false })]);
  await c.query("COMMIT");
  console.log(JSON.stringify({ changed, binding: after, policy_unchanged: true, other_bindings_unchanged: true }));
} catch (error) {
  await c.query("ROLLBACK"); throw error;
} finally { await c.end(); }
