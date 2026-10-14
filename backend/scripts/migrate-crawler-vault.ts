/** Explicit cutover only. Runtime never reads these legacy environment credentials. */
import { pathToFileURL } from "node:url";
import { audit, postgresDb, nowIso, pgSerialTransaction } from "../src/postgres/access.js";
import { createCredential, deleteCredential, resolveSecretReference } from "../src/runtime/credentials.js";
import { ensureRuntimeSchema, validateConnectorConfig } from "../src/runtime/store.js";
import { assertConnectorCredentialStorage } from "../src/connectors/catalog.js";
import type { Row } from "../src/types.js";
export async function migrateCrawlerVault(input: {
  url: string;
  token: string;
  apply: boolean;
}) {
  (await ensureRuntimeSchema());
  const db = postgresDb();
  const row = (await db.one("SELECT config_json,version FROM runtime_connector_config WHERE connector_id='claw'")) as Row | undefined;
  const old = row ? JSON.parse(String(row.config_json)) : {};
  const url = input.url.trim();
  const token = input.token.trim().replace(/^Bearer\s+/i, "");
  if (!url || !token)
    throw new Error("crawler migration source unavailable");
  if (old.url === url && old.bearer_secret_ref && (await resolveSecretReference(old.bearer_secret_ref)) === token) {
    return { pending: false, migrated: false, version: Number(row!.version), credential_ref: String(old.bearer_secret_ref) };
  }
  // Validate the endpoint before creating any secret. No secret enters config or audit.
  await validateConnectorConfig({ url, bearer_secret_ref: "cred_migrationplaceholder" });
  if (!input.apply)
    return { pending: true, migrated: false, version: Number(row?.version || 0) };
  const credential = (await createCredential({ type: "organization_secret", label: "MediaCrawler",
    purpose: "Migrated collector authentication", secret: token }, "deployment"));
  try {
    const config = await validateConnectorConfig({ protocol: "mcp", transport: "streamable-http", url,
      bearer_secret_ref: credential.id, timeout_ms: 30000 });
    assertConnectorCredentialStorage("claw", config);
    (await pgSerialTransaction(async (transaction) => {
      const current = (await transaction.one("SELECT version FROM runtime_connector_config WHERE connector_id='claw'")) as Row | undefined;
      if (Number(current?.version || 0) !== Number(row?.version || 0))
        throw new Error("crawler configuration changed during migration");
      const exists = (await transaction.one("SELECT id FROM connectors WHERE id='claw'"));
      if (!exists)
        throw new Error("crawler connector missing");
      (await transaction.execute(`INSERT INTO runtime_connector_config(connector_id,config_json,version,updated_at)
        VALUES('claw',$1,$2,$3) ON CONFLICT(connector_id) DO UPDATE SET config_json=excluded.config_json,
        version=excluded.version,updated_at=excluded.updated_at`, JSON.stringify(config), Number(row?.version || 0) + 1, nowIso()));
      (await transaction.execute("UPDATE connectors SET enabled=0,status='pending_verification',last_error=NULL,updated_at=$1 WHERE id='claw'", nowIso()));
    }));
  }
  catch (error) {
    (await deleteCredential(credential.id, credential.version));
    throw error;
  }
  (await audit("deployment", "runtime.crawler.vault_migrated", { connector_id: "claw", version: Number(row?.version || 0) + 1 }));
  return { pending: false, migrated: true, version: Number(row?.version || 0) + 1, credential_ref: credential.id };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify((await migrateCrawlerVault({ url: process.env.MEDIACRAWLER_MCP_URL || "",
      token: process.env.MEDIACRAWLER_MCP_TOKEN || "", apply: process.argv.includes("--apply") }))));
  }
  catch {
    console.error("Crawler vault migration failed; no secrets logged. Check source configuration and vault readiness.");
    process.exitCode = 1;
  }
  finally {
    (await postgresDb().close());
  }
}
