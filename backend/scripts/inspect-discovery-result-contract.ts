/** Read-only contract evidence. No start/stop, credential output or candidate contents. */
import { createMediaCrawlerClient } from "../src/crawl/managed-connection.js";
import { postgresPool, closePostgresPool } from "../src/postgres/pool.js";
import { getConn } from "../src/db.js";
import { SkillExecution } from "../src/runtime/execution.js";
import { normalizeMcpContent } from "../src/mcp/remote.js";
import "../src/crawl/runtime-gates.js";

const taskId = process.argv.find(arg => arg.startsWith("--task-id="))?.slice(10);
const client = createMediaCrawlerClient();
let runtime: SkillExecution | undefined;
try {
  const tools = await client.listTools();
  console.log(JSON.stringify({ tools: tools.filter(t => ["start_crawl", "get_creators"].includes(String(t.name)))
    .map(t => ({ name: t.name, inputSchema: t.inputSchema })) }));
  if (taskId) {
    const row = (await postgresPool().query("SELECT context_json,state,args_json FROM runtime_crawl_jobs WHERE remote_task_id=$1", [taskId])).rows;
    if (row.length !== 1) throw new Error("requires_one_persisted_task_receipt");
    runtime = new SkillExecution(row[0].context_json);
    const tool = (await runtime.discover()).tools.find(t => t.connectorId === "claw" && t.remoteName === "get_creators");
    if (!tool) throw new Error("scoped_result_tool_unavailable");
    const platform = row[0].args_json?.platforms?.[0];
    if (typeof platform !== "string" || !platform) throw new Error("persisted_platform_missing");
    const raw = await runtime.invoke(String(tool.exposed.name), { task_id: taskId, platform, offset: 0, limit: 1 });
    if (raw.isError) throw new Error("result_read_failed");
    const result = normalizeMcpContent(raw);
    const rows = Array.isArray(result.creators) ? result.creators : [];
    console.log(JSON.stringify({ receipt_state: row[0].state, task_id_matches: result.task_id === taskId,
      total: result.total, offset: result.offset, limit: result.limit, returned_rows: rows.length,
      field_names: rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [] }));
  }
} catch {
  console.error("Discovery contract inspection failed; no remote data logged"); process.exitCode = 1;
} finally { runtime?.close(); await client.close(); await closePostgresPool(); getConn().close(); }
