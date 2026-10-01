import { randomUUID } from "node:crypto";
import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import type { ConnectorConfig } from "./store.js";
import { createConfiguredClient, type RuntimeContext } from "./execution.js";
import { isMediaCrawlerHostConfig } from "./mediacrawler-config.js";

/**
 * The administration probe uses the same tools/call(start_crawl) as AI discovery.
 * It immediately stops the returned task, never adds it to the application's
 * crawl_jobs table, and never treats a successful call as a verified tool catalog.
 * If the server loses the response before returning task_id we cannot know what
 * to stop; surface failure instead of claiming that cleanup succeeded.
 */
export async function probeMediaCrawlerStart(context: RuntimeContext, config: ConnectorConfig): Promise<void> {
  if (!isMediaCrawlerHostConfig(config)) throw new HttpFail(409, { code: "runtime_probe_mode_invalid" });
  const client = createConfiguredClient(context, config);
  let taskId = "";
  try {
    const started = await client.callToolRaw("start_crawl", {
      platforms: ["youtube"], crawler_type: "search", keywords: `kol-mcp-connection-probe-${randomUUID()}`,
    });
    if (started.isError) throw new HttpFail(502, { code: "runtime_probe_start_rejected" });
    const result = normalizeMcpContent(started);
    const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : {};
    taskId = String(result.task_id || result.id || data.task_id || "").trim();
    if (!taskId) throw new HttpFail(502, { code: "runtime_probe_task_id_missing" });
    const stopped = await client.callToolRaw("stop_crawl", { task_id: taskId });
    if (stopped.isError) throw new HttpFail(502, { code: "runtime_probe_stop_failed" });
  } finally {
    await client.close().catch(() => undefined);
  }
}
