import { getConn } from "../../src/db.js";
import { createCredential } from "../../src/runtime/credentials.js";
import { getConnectorConfig, setConnectorConfig } from "../../src/runtime/store.js";

export function configureCrawlerFixture(url = "http://127.0.0.1:9/mcp", secret = "test-secret") {
  process.env.RUNTIME_CREDENTIAL_MASTER_KEY ||= "7a".repeat(32);
  getConn().prepare("INSERT INTO connectors(id,label,enabled,status,updated_at) VALUES('claw','MediaCrawler',1,'verified','now') ON CONFLICT(id) DO UPDATE SET enabled=1").run();
  const credential = createCredential({ type: "organization_secret", label: "Crawler fixture", secret }, "admin");
  setConnectorConfig("claw", { url, bearer_secret_ref: credential.id }, getConnectorConfig("claw")?.version || 0);
  return credential;
}
