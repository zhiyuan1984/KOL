import type { Row } from '../types.js';
import { getConn } from '../db.js';
import { getConnectorConfig } from '../runtime/store.js';

/** Metadata only; credentials are resolved exclusively by the shared runtime vault. */
export function starryKolConnectionHealth() {
  const row = getConn().prepare("SELECT enabled,status,last_error,last_verified_at FROM connectors WHERE id='starrykol'").get() as Row | undefined;
  const saved = row ? getConnectorConfig('starrykol') : undefined;
  const config = saved?.config;
  const enabled = Boolean(row?.enabled);
  let origin: string | null = null;
  try { origin = config?.url ? new URL(config.url).origin : null; } catch { /* Invalid URL is not proof of missing configuration. */ }
  return {
    mode: 'vault',
    // Compatibility: old consumers used configured as ready. New consumers can distinguish the facts.
    configured: Boolean(config && enabled),
    ready: Boolean(config && enabled),
    config_present: Boolean(config),
    enabled,
    verification_status: String(row?.status || 'unknown'),
    config_version: saved?.version ?? null,
    last_error: row?.last_error ? String(row.last_error) : null,
    last_verified_at: row?.last_verified_at ? String(row.last_verified_at) : null,
    user_jwt: Boolean(config?.bearer_secret_ref || config?.credential_account_id ||
      Object.keys(config?.headers_secret_refs || {}).some(key => key.toLowerCase() === 'authorization')),
    url: origin,
  };
}

export function starryKolMcpConfigured(): boolean { return starryKolConnectionHealth().ready; }
