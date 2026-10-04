import { getConnectorConfig, type ConnectorConfig } from "./store.js";

/** Match only the MCP endpoint already used by this Host's AI discovery. */
export function isMediaCrawlerHostConfig(config: ConnectorConfig, connectorId?: string): boolean {
  if (connectorId === "claw") return true;
  let configuredUrl: string | undefined;
  try { configuredUrl = getConnectorConfig("claw")?.config.url; } catch { return false; }
  return Boolean(configuredUrl && config.url === configuredUrl
    && (config.protocol || "mcp") === "mcp" && config.transport !== "sse");
}
