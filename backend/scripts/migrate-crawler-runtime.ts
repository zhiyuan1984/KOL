/** Explicit release migration. Discovery is read-only; no crawler is started. */
import { audit, getConn, nowIso } from "../src/db.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { inspectConnectorTools } from "../src/runtime/execution.js";
import { getConnectorConfig, getSkillConnectors, getSkillTools, getToolPolicy, setSkillConnector, setSkillTool, setToolPolicy } from "../src/runtime/store.js";
import { registerDiscoveredToolPolicies } from "../src/runtime/tool-catalog.js";
import type { Json, Row } from "../src/types.js";

const names = ["start_crawl", "get_crawl_status", "get_crawl_logs", "get_creators", "stop_crawl"];
async function migrate() {
  const actor = process.argv.find((arg) => arg.startsWith("--actor="))?.slice(8);
  if (!actor) throw new Error("An explicit --actor is required");
  const user = (await getConn().query("SELECT active,roles FROM users WHERE id=$1",[actor])).rows[0] as Row | undefined;
  if (!user?.active || !JSON.parse(String(user.roles)).includes("admin")) throw new Error("Migration actor must be an active administrator");
  const configuration = (await getConnectorConfig("claw"));
  if (!configuration) throw new Error("Vaulted claw configuration is required");
  const tools = await inspectConnectorTools({ agentId: "governance", skillId: "", userId: actor, runId: "crawler-runtime-migration" }, "claw");
  for (const name of names) {
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error("Required crawler capability missing");
    const properties = (tool.inputSchema as Json)?.properties;
    if (name !== "start_crawl" && (!properties || typeof properties !== "object" || !Object.hasOwn(properties, "task_id"))) {
      throw new Error("MediaCrawler task scope patch must be installed first");
    }
  }
  if (!process.argv.includes("--apply")) return { ready: true, tools: tools.length, config_version: configuration.version, applied: false };
  if ((await getConn().query("SELECT 1 FROM crawl_jobs WHERE status IN\n    ('queued','crawling','uploading','analyzing','starting','running','stopping') LIMIT 1",[])).rows[0]) throw new Error("Active legacy crawl must settle before cutover");
  // Individual governance mutations own their versioned transactions. Keep the
  // connector disabled until every mount and the final version check succeeds.
  (await getConn().query("UPDATE connectors SET enabled=0,status='pending_verification' WHERE id='claw'",[]));
  {
    if ((await getConnectorConfig("claw"))?.version !== configuration.version) throw new Error("Configuration changed during migration");
    (await registerDiscoveredToolPolicies("claw", tools));
    const binding = (await getSkillConnectors("crawler_collect")).find((row) => row.connector_id === "claw");
    if (!binding) (await setSkillConnector("crawler_collect", "claw", true, 0));
    else if (!binding.enabled) throw new Error("Existing disabled Skill binding requires an explicit governance decision");
    for (const name of names) {
      const policy = (await getToolPolicy("claw", name))!;
      const controlled = name === "start_crawl" || name === "stop_crawl";
      if (!policy.enabled || policy.risk !== (controlled ? "L3" : "L1")) {
        (await setToolPolicy("claw", name, { enabled: true, risk: controlled ? "L3" : "L1", access: controlled ? "write" : "read", schema_hash: String(policy.schema_hash) }, Number(policy.version)));
      }
      const mount = (await getSkillTools("crawler_collect", "claw")).find((row) => row.tool_name === name);
      if (!mount) (await setSkillTool("crawler_collect", "claw", name, true, 0));
      else if (!mount.enabled) throw new Error("Existing disabled tool mount requires an explicit governance decision");
    }
    if ((await getConnectorConfig("claw"))?.version !== configuration.version) throw new Error("Configuration changed during migration");
    (await getConn().query("INSERT INTO runtime_connector_probes\n      (connector_id,config_version,actor_id,checked_at,status,probe_kind,tool_count,duration_ms,error_code)\n      VALUES('claw',$1,$2,$3,'succeeded','mcp_tools_list',$4,0,NULL)",[configuration.version,actor,nowIso(),tools.length]));
    (await getConn().query("UPDATE connectors SET status='verified',enabled=1,last_error=NULL,last_verified_at=$1,updated_at=$2 WHERE id='claw'",[nowIso(),nowIso()]));
    (await getConn().query("INSERT INTO runtime_bootstrap_migrations(id,applied_at) VALUES('runtime.crawler-skill.v1',$1) ON CONFLICT(id) DO NOTHING",[nowIso()]));
  }
  (await audit(actor, "runtime.crawler.skill_migrated", { config_version: configuration.version, skill_id: "crawler_collect", tools: names }));
  return { ready: true, tools: tools.length, config_version: configuration.version, applied: true };
}
try { console.log(JSON.stringify(await migrate())); }
catch { console.error("Crawler runtime migration failed. Check actor, current bindings, task-scoped MCP schemas and active jobs; no credentials logged."); process.exitCode = 1; }
finally { await closePostgresPool(); (await closePostgresPool()); }
