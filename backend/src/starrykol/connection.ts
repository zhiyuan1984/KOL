import type { Row } from "../types.js";
import { postgresDb } from "../postgres/access.js";
import { getConnectorConfig } from "../runtime/store.js";
/** Metadata only; credentials are resolved exclusively by the shared runtime vault. */
export async function starryKolConnectionHealth() {
  try {
    const config = (await getConnectorConfig("starrykol"))?.config;
    const enabled = Boolean(((await postgresDb().one("SELECT enabled FROM connectors WHERE id='starrykol'")) as Row | undefined)?.enabled);
    return { mode: "vault", configured: Boolean(config && enabled),
      user_jwt: Boolean(config?.bearer_secret_ref || config?.credential_account_id ||
        Object.keys(config?.headers_secret_refs || {}).some((key) => key.toLowerCase() === "authorization")),
      url: config?.url ? new URL(config.url).origin : null };
  }
  catch {
    return { mode: "vault", configured: false, user_jwt: false, url: null };
  }
}
export async function starryKolMcpConfigured(): Promise<boolean> { return (await starryKolConnectionHealth()).configured; }
