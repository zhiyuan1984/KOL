/** Read-only deployment diagnostics. Never prints connection configuration or credentials. */
import { getConn } from "../src/db.js";
import { closePostgresPool } from "../src/postgres/pool.js";
import { createMediaCrawlerClient } from "../src/crawl/managed-connection.js";
import { getConnectorConfig } from "../src/runtime/store.js";
const client = createMediaCrawlerClient();
try {
  const status = await client.callTool("get_crawl_status", {});
  const tools = await client.listTools();
  console.log(JSON.stringify({
    administrators: getConn().prepare("SELECT id FROM users WHERE active=1 AND roles LIKE '%admin%'").all(),
    connector: getConn().prepare("SELECT id,enabled,status FROM connectors WHERE id='claw'").get(),
    configuration_version: getConnectorConfig("claw")?.version,
    remote: { status: status.status, task_id: status.task_id, has_error: Boolean(status.error_message) },
    task_scoped: ["get_crawl_status","get_crawl_logs","stop_crawl","get_creators"].every(name =>
      Object.hasOwn((tools.find(t => t.name === name)?.inputSchema as { properties?: object })?.properties || {}, "task_id")),
    legacy_active: getConn().prepare("SELECT count(*) AS n FROM crawl_jobs WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')").get(),
  }));
} catch { console.error("Crawler diagnostics failed; no remote details logged"); process.exitCode = 1; }
finally { await client.close(); await closePostgresPool(); getConn().close(); }
