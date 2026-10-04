import { HttpFail } from "../host/errors.js";

/**
 * Built-in managed MCP templates shipped with the product. They seed a new
 * organization, but they are not an allowlist: an administrator may add a
 * further organization-managed MCP through the catalog.
 */
export const BUILTIN_CONNECTORS = {
  claw: {
    label: "MediaCrawler MCP",
    purpose: "创作者采集、检索与画像数据",
  },
  starrykol: {
    credential_storage: "vault",
    label: "Starry KOL MCP",
    purpose: "红人库、负责人、品牌邮箱与合作往来事实",
  },
} as const;

export type BuiltinConnectorId = keyof typeof BUILTIN_CONNECTORS;

const CONNECTOR_ID = /^[a-z][a-z0-9_-]{2,63}$/;

export function isBuiltinConnectorId(value: string): value is BuiltinConnectorId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_CONNECTORS, value);
}

/** A managed connector id is validated here; record existence is checked by its owning route/store. */
export function requireManagedConnector(value: string): string {
  if (!CONNECTOR_ID.test(value)) {
    throw new HttpFail(404, { code: "managed_connector_not_found", connector_id: value });
  }
  return value;
}

export function builtinConnectorIds(): BuiltinConnectorId[] {
  return Object.keys(BUILTIN_CONNECTORS) as BuiltinConnectorId[];
}

/** Migration boundary: managed templates can require vault-only connections. */
export function assertConnectorCredentialStorage(id: string, config: { url?: string; url_env?: string; headers_env?: unknown; bearer_env?: string; allow_unauthenticated?: boolean }): void {
  const template = BUILTIN_CONNECTORS[id as BuiltinConnectorId];
  if (template && "credential_storage" in template && template.credential_storage === "vault" &&
      (!config.url || config.url_env || config.bearer_env || Object.keys(config.headers_env || {}).length || config.allow_unauthenticated)) {
    throw new HttpFail(409, { code: "runtime_connector_vault_required" });
  }
}
