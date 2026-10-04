/** Explicit cutover only. Runtime never reads these legacy environment credentials. */
import { pathToFileURL } from "node:url";
import { audit, getConn, nowIso, txImmediate } from "../src/db.js";
import { createCredential, deleteCredential, resolveSecretReference } from "../src/runtime/credentials.js";
import { ensureRuntimeSchema, validateConnectorConfig } from "../src/runtime/store.js";
import { assertConnectorCredentialStorage } from "../src/connectors/catalog.js";
import type { Row } from "../src/types.js";

export function migrateCrawlerVault(input: { url: string; token: string; apply: boolean }) {
  ensureRuntimeSchema();
  const db = getConn();
  const row = db.prepare("SELECT config_json,version FROM runtime_connector_config WHERE connector_id='claw'").get() as Row | undefined;
  const old = row ? JSON.parse(String(row.config_json)) : {};
  const url = input.url.trim();
  const token = input.token.trim().replace(/^Bearer\s+/i, "");
  if (!url || !token) throw new Error("crawler migration source unavailable");
  if (old.url === url && old.bearer_secret_ref && resolveSecretReference(old.bearer_secret_ref) === token) {
    return { pending: false, migrated: false, version: Number(row!.version), credential_ref: String(old.bearer_secret_ref) };
  }
  // Validate the endpoint before creating any secret. No secret enters config or audit.
  validateConnectorConfig({ url, bearer_secret_ref: "cred_migrationplaceholder" });
  if (!input.apply) return { pending: true, migrated: false, version: Number(row?.version || 0) };
  const credential = createCredential({ type: "organization_secret", label: "MediaCrawler",
    purpose: "Migrated collector authentication", secret: token }, "deployment");
  try {
    const config = validateConnectorConfig({ protocol: "mcp", transport: "streamable-http", url,
      bearer_secret_ref: credential.id, timeout_ms: 30000 });
    assertConnectorCredentialStorage("claw", config);
    txImmediate((transaction) => {
      const current = transaction.prepare("SELECT version FROM runtime_connector_config WHERE connector_id='claw'").get() as Row | undefined;
      if (Number(current?.version || 0) !== Number(row?.version || 0)) throw new Error("crawler configuration changed during migration");
      const exists = transaction.prepare("SELECT id FROM connectors WHERE id='claw'").get();
      if (!exists) throw new Error("crawler connector missing");
      transaction.prepare(`INSERT INTO runtime_connector_config(connector_id,config_json,version,updated_at)
        VALUES('claw',?,?,?) ON CONFLICT(connector_id) DO UPDATE SET config_json=excluded.config_json,
        version=excluded.version,updated_at=excluded.updated_at`)
        .run(JSON.stringify(config), Number(row?.version || 0) + 1, nowIso());
      transaction.prepare("UPDATE connectors SET enabled=0,status='pending_verification',last_error=NULL,updated_at=? WHERE id='claw'").run(nowIso());
    });
  } catch (error) { deleteCredential(credential.id, credential.version); throw error; }
  audit("deployment", "runtime.crawler.vault_migrated", { connector_id: "claw", version: Number(row?.version || 0) + 1 });
  return { pending: false, migrated: true, version: Number(row?.version || 0) + 1, credential_ref: credential.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(migrateCrawlerVault({ url: process.env.MEDIACRAWLER_MCP_URL || "",
      token: process.env.MEDIACRAWLER_MCP_TOKEN || "", apply: process.argv.includes("--apply") })));
  } catch {
    console.error("Crawler vault migration failed; no secrets logged. Check source configuration and vault readiness.");
    process.exitCode = 1;
  } finally { getConn().close(); }
}
