import { postgresDb } from "../postgres/access.js";
import { HttpFail } from "../host/errors.js";
import { credentialVaultReady, getCredentialMetadata } from "../runtime/credentials.js";
import { createManagedClient } from "../runtime/managed-client.js";
import { getConnectorConfig } from "../runtime/store.js";
import type { Row } from "../types.js";
/** The asynchronous collector uses organization credentials; never a process or personal fallback. */
export async function mediaCrawlerConfig() {
  const config = (await getConnectorConfig("claw"))?.config;
  const enabled = ((await postgresDb().one("SELECT enabled FROM connectors WHERE id='claw'")) as Row | undefined)?.enabled;
  if (!enabled || !config || !config.url || (config.protocol || "mcp") !== "mcp" || config.transport === "sse") {
    throw new HttpFail(503, { code: "runtime_connector_not_configured" });
  }
  const refs = [...Object.values(config.headers_secret_refs || {}), ...(config.bearer_secret_ref ? [config.bearer_secret_ref] : [])];
  const credentials = await Promise.all(refs.map(async (id) => (await getCredentialMetadata(id))));
  if (!credentialVaultReady() || !refs.length || config.credential_provider || credentials.some((credential) => credential.type !== "organization_secret" || credential.status !== "active"))
    throw new HttpFail(503, { code: "runtime_credential_unavailable" });
  return config;
}
export async function mediaCrawlerConfigured(): Promise<boolean> {
  try {
    (await mediaCrawlerConfig());
    return true;
  }
  catch {
    return false;
  }
}
export async function createMediaCrawlerClient() {
  (await mediaCrawlerConfig());
  return (await createManagedClient("claw", "crawl-worker"));
}
