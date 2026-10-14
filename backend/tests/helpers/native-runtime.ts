import { postgresDb } from "../../src/postgres/access.js";

/**
 * Create the minimal local runtime catalog row required before a test mounts a
 * policy/tool.  Runtime-store intentionally rejects unknown connector IDs;
 * this helper makes that production invariant explicit in isolated PG tests.
 */
export async function ensureNativeRuntimeConnector(id: string, label = id): Promise<void> {
  await postgresDb().execute(`INSERT INTO connectors (id,label,enabled,status,updated_at)
    VALUES ($1,$2,1,'configured',$3)
    ON CONFLICT (id) DO NOTHING`, id, label, new Date().toISOString());
}
