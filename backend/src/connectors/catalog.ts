import { HttpFail } from "../host/errors.js";

/**
 * The only organization-managed MCPs. This allowlist is a server-side boundary,
 * not merely a navigation/UI preference.
 */
export const MANAGED_CONNECTORS = {
  claw: {
    label: "MediaCrawler MCP",
    purpose: "创作者采集、检索与画像数据",
  },
  starrykol: {
    label: "Starry KOL MCP",
    purpose: "红人库、负责人与合作往来事实",
  },
} as const;

export type ManagedConnectorId = keyof typeof MANAGED_CONNECTORS;

export function isManagedConnectorId(value: string): value is ManagedConnectorId {
  return Object.prototype.hasOwnProperty.call(MANAGED_CONNECTORS, value);
}

export function requireManagedConnector(value: string): ManagedConnectorId {
  if (!isManagedConnectorId(value)) {
    throw new HttpFail(404, { code: "managed_connector_not_found", connector_id: value });
  }
  return value;
}

export function managedConnectorIds(): ManagedConnectorId[] {
  return Object.keys(MANAGED_CONNECTORS) as ManagedConnectorId[];
}
