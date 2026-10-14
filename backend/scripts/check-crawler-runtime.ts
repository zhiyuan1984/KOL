/** Read-only deployment diagnostics. Never prints connection configuration or credentials. */
import { postgresDb } from "../src/postgres/access.js";
import { closePostgresPool, postgresPool } from "../src/postgres/pool.js";
import { createMediaCrawlerClient } from "../src/crawl/managed-connection.js";
import { getConnectorConfig } from "../src/runtime/store.js";
const client = createMediaCrawlerClient();
try {
  const status = await client.callTool("get_crawl_status", {});
  const tools = await client.listTools();
  const runtimeJobs = await postgresPool().query("SELECT job_type,status FROM execution_jobs WHERE job_type IN ('runtime.confirm','crawler.monitor') ORDER BY created_at DESC LIMIT 6");
  console.log(JSON.stringify({
    administrators: (await postgresDb().many("SELECT id FROM users WHERE active=1 AND roles LIKE '%admin%'")),
    connector: (await postgresDb().one("SELECT id,enabled,status FROM connectors WHERE id='claw'")),
    configuration_version: (await getConnectorConfig("claw"))?.version,
    execution_jobs: runtimeJobs.rows,
    remote: { status: status.status, task_id: status.task_id, has_error: Boolean(status.error_message) },
    task_scoped: ["get_crawl_status", "get_crawl_logs", "stop_crawl", "get_creators"].every(name => Object.hasOwn((tools.find(t => t.name === name)?.inputSchema as {
      properties?: object;
    })?.properties || {}, "task_id")),
    legacy_active: (await postgresDb().one("SELECT count(*) AS n FROM crawl_jobs WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping')")),
  }));
}
catch {
  console.error("Crawler diagnostics failed; no remote details logged");
  process.exitCode = 1;
}
finally {
  await client.close();
  await closePostgresPool();
}
