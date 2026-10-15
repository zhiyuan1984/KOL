import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { postgresPool, postgresTransaction, closePostgresPool } from "../src/postgres/pool.js";
import { assertConnectorEnableBasis } from "../src/routers/enterprise.js";
import { pgUpdateConnectorInTransaction } from "../src/postgres/connector-authorization-repository.js";
import type { PoolClient } from "pg";

const ID = "starrykol";
const OPERATION = "starry-enable-eoouUIToH5RDLTOFEXhUsN-20261015";
const ACTOR = "manus:user-approved-production-operator";
const APPROVED_AT = "2026-10-15T12:45:14Z";
const PROTECTED = ["users", "organization_people", "organization_units", "organization_memberships", "scope_memberships", "user_connector_grants", "user_approval_roles", "user_starry_bindings", "mailbox_owners", "runtime_credentials", "runtime_connector_config", "runtime_agent_skills", "runtime_skill_connectors", "runtime_skill_tools", "runtime_tool_policies", "managed_agents", "managed_agent_bindings", "managed_agent_revisions"];

type Basis = { enabled: number; status: string; config_version: number; config_hash: string; references: number; organization_credentials: number };
async function basis(client: PoolClient): Promise<Basis> {
  const row = (await client.query(`SELECT c.enabled,c.status,r.version,r.config_json,md5(r.config_json) AS config_hash
    FROM connectors c JOIN runtime_connector_config r ON r.connector_id=c.id WHERE c.id=$1`, [ID])).rows[0];
  if (!row) throw new Error("starry_existing_config_required");
  const config = JSON.parse(String(row.config_json));
  if (config.credential_provider || config.credential_account_id) throw new Error("starry_organization_credentials_required");
  const refs = [...Object.values(config.headers_secret_refs || {}), ...(config.bearer_secret_ref ? [config.bearer_secret_ref] : [])];
  const credentials = (await client.query("SELECT type,status,owner_user_id FROM runtime_credentials WHERE id=ANY($1::text[])", [refs])).rows;
  if (refs.length !== 2 || credentials.length !== refs.length || credentials.some(r => r.type !== "organization_secret" || r.status !== "active" || r.owner_user_id !== null)) throw new Error("starry_organization_credentials_required");
  return { enabled: Number(row.enabled), status: String(row.status), config_version: Number(row.version), config_hash: String(row.config_hash), references: refs.length, organization_credentials: credentials.length };
}
async function protectedFacts(client: PoolClient): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  result.connector_non_toggle_fields = (await client.query("SELECT md5((to_jsonb(c)-'enabled'-'updated_at')::text) AS hash FROM connectors c WHERE id=$1", [ID])).rows[0];
  for (const name of PROTECTED) {
    const present = (await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [name])).rows[0]?.present;
    if (!present) { result[name] = { present: false }; continue; }
    // Trusted fixed identifiers only. Hashes, not credential or account values, leave PostgreSQL.
    result[name] = (await client.query(`SELECT count(*)::text AS rows,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash FROM "${name}" t`)).rows[0];
  }
  return result;
}
export async function readonlyStarryEnablePreflight(): Promise<Basis> {
  const client = await postgresPool().connect();
  try { await client.query("BEGIN READ ONLY"); const value = await basis(client); await client.query("ROLLBACK"); return value; }
  finally { client.release(); }
}
export async function applyApprovedStarryEnable(expected: { version: number; hash: string }) {
  if (!Number.isInteger(expected.version) || !/^[a-f0-9]{32}$/.test(expected.hash)) throw new Error("approved_config_basis_required");
  return postgresTransaction(async client => {
    await assertConnectorEnableBasis(client, ID);
    const before = await basis(client);
    if (before.config_version !== expected.version || before.config_hash !== expected.hash) throw new Error("starry_config_changed_since_approval_basis");
    const previous = (await client.query(`SELECT id,payload FROM audit_events WHERE event_type=$1 AND payload::jsonb->>'operation_id'=$2 ORDER BY id DESC LIMIT 1`, ["admin.connector.update", OPERATION])).rows[0];
    if (before.enabled === 1 && previous) return { changed: false, already_applied: true, enabled: true, config_version: before.config_version, audit_id: String(previous.id) };
    if (before.enabled !== 0) throw new Error("starry_enable_baseline_changed");
    const facts = await protectedFacts(client);
    const now = new Date().toISOString();
    await pgUpdateConnectorInTransaction(client, ID, { enabled: 1 }, now);
    const after = await basis(client);
    if (after.enabled !== 1 || after.status !== before.status || after.config_hash !== before.config_hash || after.config_version !== before.config_version) throw new Error("starry_enable_changed_unapproved_config");
    if (JSON.stringify(facts) !== JSON.stringify(await protectedFacts(client))) throw new Error("starry_enable_changed_protected_facts");
    const payload = { operation_id: OPERATION, connector_id: ID, approved_at: APPROVED_AT, approval_source: "explicit_user_message", before_enabled: false, after_enabled: true, config_version: before.config_version, config_hash: before.config_hash, credentials_unchanged: true, permissions_unchanged: true, protected_tables: Object.keys(facts), changed_fields: ["enabled", "updated_at"] };
    const audit = (await client.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4) RETURNING id", [now, ACTOR, "admin.connector.update", JSON.stringify(payload)])).rows[0];
    return { changed: true, enabled: true, config_version: before.config_version, audit_id: String(audit.id), credentials_unchanged: true, permissions_unchanged: true };
  }, { isolation: "SERIALIZABLE" });
}

async function main() {
  if (process.cwd() !== "/home/ecs-user/kol/backend" && process.cwd() !== "/home/ecs-user/kol-native-finish-eoou/integrated/backend") throw new Error("approved_working_directory_required");
  process.loadEnvFile("/home/ecs-user/kol/.env");
  const apply = process.argv.includes("--apply");
  const value = (key: string) => { const index = process.argv.indexOf(key); return index >= 0 ? process.argv[index + 1] : undefined; };
  if (!apply) { console.log(JSON.stringify(await readonlyStarryEnablePreflight())); return; }
  if (process.cwd() !== "/home/ecs-user/kol/backend") throw new Error("production_release_only");
  const backup = value("--backup-directory");
  if (!backup || !fs.existsSync(`${backup}/authority-before.dump`) || !fs.existsSync(`${backup}/.env.before`)) throw new Error("private_production_backup_required");
  if ((fs.statSync(backup).mode & 0o077) !== 0) throw new Error("backup_permissions_must_be_private");
  if (!fs.readFileSync("/home/ecs-user/kol/.env").equals(fs.readFileSync(`${backup}/.env.before`))) throw new Error("production_credentials_changed_since_backup");
  console.log(JSON.stringify(await applyApprovedStarryEnable({ version: Number(value("--expected-version")), hash: String(value("--expected-hash")) })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error ? error.message : "approved_starry_enable_failed" })); process.exitCode = 1; }).finally(() => closePostgresPool());
}
