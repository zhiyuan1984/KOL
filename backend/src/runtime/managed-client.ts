import { getConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import type { Json, Row } from "../types.js";
import { createConfiguredClient } from "./execution.js";
import { getConnectorConfig } from "./store.js";

/** Shared transport for existing business gateways. Callers retain their authorization and effect gates. */
export function createManagedClient(connectorId: string, userId: string, credentialAccountId?: string) {
  const saved = getConnectorConfig(connectorId);
  if (!saved) throw new HttpFail(503, { code: "runtime_connector_not_configured" });
  const connector = getConn().prepare("SELECT enabled FROM connectors WHERE id=?").get(connectorId) as Row | undefined;
  if (!connector?.enabled) throw new HttpFail(403, { code: "runtime_connector_disabled" });
  const config = structuredClone(saved.config);
  if (credentialAccountId) {
    // An explicit personal binding replaces Authorization only, never the organization API key.
    for (const header of Object.keys(config.headers_secret_refs || {})) {
      if (header.toLowerCase() === "authorization") delete config.headers_secret_refs![header];
    }
    delete config.bearer_secret_ref;
    config.credential_provider = "user-account";
    config.credential_account_id = credentialAccountId;
  }
  const client = createConfiguredClient({ userId, agentId: "", skillId: "", runId: "business-gateway" }, config);
  return {
    listTools: () => client.listTools(),
    async callTool(name: string, args: Json = {}): Promise<Json> {
      const result = await client.callToolRaw(name, args);
      const normalized = normalizeMcpContent(result);
      if (result.isError) throw new Error(String(normalized.text || "remote MCP tool failed"));
      return normalized;
    },
    close: () => client.close(),
  };
}
