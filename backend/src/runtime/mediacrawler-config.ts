import type { ConnectorConfig } from "./store.js";

/** Match only the MCP endpoint already used by this Host's AI discovery. */
export function isMediaCrawlerHostConfig(config: ConnectorConfig): boolean {
  const configuredUrl = String(process.env.MEDIACRAWLER_MCP_URL || "").trim();
  const url = config.url || (config.url_env ? process.env[config.url_env] : "");
  return Boolean(configuredUrl && url?.trim() === configuredUrl
    && (config.protocol || "mcp") === "mcp" && config.transport !== "sse");
}
