/** Read-only against the deployment: rehearse mailbox migration in an in-memory copy, then query MCP. */
import { getConn, resetConn } from "../src/db.js";
import { mapUser, withScopedUser } from "../src/auth.js";
import { ensureCredentialSchema } from "../src/runtime/credentials.js";
import { ensureRuntimeSchema } from "../src/runtime/store.js";
import { canUseAgent } from "../src/runtime/organization-tree.js";
import { saveStarryBinding } from "../src/host/starry-bind.js";
import { callStarryKolTool } from "../src/starrykol/service.js";
import { runtimeErrorCode } from "../src/runtime/execution.js";
import type { Json, Row } from "../src/types.js";

const userId = process.argv.find((arg) => arg.startsWith("--user="))?.slice(7);
if (!userId) throw new Error("--user is required");
let phase = "read_source";
try {
  const source = getConn();
  const user = source.prepare("SELECT * FROM users WHERE id=? AND active=1").get(userId) as Row | undefined;
  if (!user || !canUseAgent(userId, "agent:kol")) throw new Error("active authorized Agent account required");
  const configurations = source.prepare("SELECT * FROM runtime_connector_config WHERE connector_id='starrykol'").all() as Row[];
  const bindings = source.prepare("SELECT * FROM user_starry_bindings WHERE user_id=?").all(userId) as Row[];
  const config = JSON.parse(String(configurations[0]?.config_json || "{}"));
  const credentialIds = [...new Set([
    ...Object.values(config.headers_secret_refs || {}), config.bearer_secret_ref, config.credential_account_id,
    ...bindings.map((row) => row.bearer_token),
  ].filter((value): value is string => typeof value === "string" && /^cred_[A-Za-z0-9_-]{8,160}$/.test(value)))];
  const snapshots: Array<[string, Row[]]> = [
    ["users", [user]],
    ["connectors", source.prepare("SELECT * FROM connectors WHERE id='starrykol'").all() as Row[]],
    ["runtime_connector_config", configurations],
    ["runtime_credentials", credentialIds.length ? source.prepare(`SELECT * FROM runtime_credentials WHERE id IN (${credentialIds.map(() => "?").join(",")})`).all(...credentialIds) as Row[] : []],
    ["user_starry_bindings", bindings],
  ];
  // Close the authority connection before any writes. No data or secrets are written to a copy on disk.
  delete process.env.DATABASE_URL;
  process.env.LINGONG_DB = ":memory:";
  const copy = resetConn();
  ensureRuntimeSchema(); ensureCredentialSchema();
  for (const [table, rows] of snapshots) {
    const columns = new Set((copy.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => row.name));
    for (const row of rows) {
      const entries = Object.entries(row).filter(([key]) => columns.has(key));
      copy.prepare(`INSERT OR REPLACE INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
        .run(...entries.map(([, value]) => value));
    }
  }
  phase = "migrate_memory_copy";
  let migrated = 0;
  for (const row of snapshots.find(([table]) => table === "user_starry_bindings")![1]) {
    const token = String(row.bearer_token || "");
    if (!token || /^cred_[A-Za-z0-9_-]{8,160}$/.test(token)) continue;
    saveStarryBinding(userId, { mailbox_email: String(row.mailbox_email), bearer: token });
    migrated++;
  }
  for (const key of Object.keys(process.env)) if (/^(STARRY_|EMAIL_MCP_)/.test(key)) delete process.env[key];
  process.env.CODEX_MODE = "real";
  phase = "business_query_after_migration";
  const result = await withScopedUser(mapUser(user), () => callStarryKolTool("listAllKolProfiles", {}));
  const data = (result.data || result) as Json;
  if (!Array.isArray(data.list) || !data.list.length) throw new Error("empty query result");
  console.log(JSON.stringify({ phase, source_store_unchanged: true, copy: "in-memory", migrated,
    total: data.total, rows: data.list.length }));
} catch (error) {
  console.error(JSON.stringify({ phase, code: runtimeErrorCode(error) })); process.exitCode = 1;
} finally { getConn().close(); }
