import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import type { Row } from "../types.js";

/**
 * Server-side credential vault. Ciphertext is authenticated with an environment
 * supplied key and is never returned from metadata APIs or audit events.
 * `user_account` records are selected only by their durable credential ID.
 */
export type CredentialType = "organization_secret" | "user_account";
export type CredentialStatus = "active" | "disabled";
export type CredentialMetadata = {
  id: string;
  type: CredentialType;
  owner_user_id: string | null;
  label: string;
  purpose: string;
  status: CredentialStatus;
  key_version: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type StoredCredential = Row & {
  id: string; type: CredentialType; owner_user_id: string | null; label: string; purpose: string;
  status: CredentialStatus; ciphertext: string; nonce: string; auth_tag: string; key_version: number;
  version: number; created_by: string; created_at: string; updated_at: string;
};
const MASTER_KEY_ENV = "RUNTIME_CREDENTIAL_MASTER_KEY";
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 240;
const CREDENTIAL_ID = /^cred_[A-Za-z0-9_-]{8,160}$/;

function fail(code: string, status = 400): never { throw new HttpFail(status, { code }); }
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function boundedText(value: unknown, field: string, required = false): string {
  if (value === undefined || value === null) { if (required) fail(`runtime_credential_${field}_required`); return ""; }
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || /[\x00-\x1f\x7f]/.test(value)) fail(`runtime_credential_invalid_${field}`);
  return value.trim();
}
function credentialId(value: unknown): string {
  if (typeof value !== "string" || !CREDENTIAL_ID.test(value)) fail("runtime_credential_invalid_id");
  return value;
}
function optionalCredentialId(value: unknown): string | undefined { return value === undefined ? undefined : credentialId(value); }
function status(value: unknown, fallback: CredentialStatus = "active"): CredentialStatus {
  if (value === undefined) return fallback;
  if (value === "active" || value === "disabled") return value;
  fail("runtime_credential_invalid_status");
}
function type(value: unknown): CredentialType {
  if (value === "organization_secret" || value === "user_account") return value;
  fail("runtime_credential_invalid_type");
}
function expectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail("runtime_credential_invalid_expected_version");
  return value;
}
function secretValue(value: unknown): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) fail("runtime_credential_invalid_secret");
  return value;
}
function parseMasterKey(raw: string | undefined): Buffer | undefined {
  if (!raw) return undefined;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try { const key = Buffer.from(raw, "base64"); return key.length === 32 ? key : undefined; } catch { return undefined; }
}
function masterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw) fail("runtime_credential_master_key_unavailable", 503);
  const key = parseMasterKey(raw);
  if (!key) fail("runtime_credential_master_key_invalid", 503);
  return key;
}
export function credentialVaultReady(): boolean { return parseMasterKey(process.env[MASTER_KEY_ENV]) !== undefined; }
function aad(id: string, ownerUserId: string | null): Buffer { return Buffer.from(`runtime-credential-v1:${id}:${ownerUserId || "organization"}`, "utf8"); }
function encrypt(id: string, ownerUserId: string | null, value: string): { ciphertext: string; nonce: string; authTag: string } {
  const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce); cipher.setAAD(aad(id, ownerUserId));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}
function decrypt(row: StoredCredential): string {
  let nonce: Buffer; let ciphertext: Buffer; let authTag: Buffer;
  try { nonce = Buffer.from(row.nonce, "base64"); ciphertext = Buffer.from(row.ciphertext, "base64"); authTag = Buffer.from(row.auth_tag, "base64"); } catch { fail("runtime_credential_ciphertext_invalid", 500); }
  if (nonce!.length !== 12 || authTag!.length !== 16 || ciphertext!.length > MAX_SECRET_BYTES + 32) fail("runtime_credential_ciphertext_invalid", 500);
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), nonce!); decipher.setAAD(aad(row.id, row.owner_user_id)); decipher.setAuthTag(authTag!);
    const clear = Buffer.concat([decipher.update(ciphertext!), decipher.final()]);
    if (!clear.length || clear.length > MAX_SECRET_BYTES) fail("runtime_credential_ciphertext_invalid", 500);
    return clear.toString("utf8");
  } catch (error) { if (error instanceof HttpFail) throw error; fail("runtime_credential_decryption_failed", 503); }
}
function metadata(row: StoredCredential): CredentialMetadata {
  return { id: String(row.id), type: type(row.type), owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
    label: String(row.label || ""), purpose: String(row.purpose || ""), status: status(row.status), key_version: Number(row.key_version),
    version: Number(row.version), created_by: String(row.created_by), created_at: String(row.created_at), updated_at: String(row.updated_at) };
}
async function storedById(id: string, client?: PoolClient): Promise<StoredCredential | undefined> {
  const result = client ? await client.query<StoredCredential>("SELECT * FROM runtime_credentials WHERE id=$1", [id])
    : { rows: await postgresQuery<StoredCredential>("SELECT * FROM runtime_credentials WHERE id=$1", [id]) };
  return result.rows[0];
}
async function requireStored(id: string, client?: PoolClient): Promise<StoredCredential> {
  const row = await storedById(credentialId(id), client); if (!row) fail("runtime_credential_not_found", 404); return row;
}
async function requireActiveOwner(ownerUserId: string, client: PoolClient): Promise<void> {
  const result = await client.query<Row>("SELECT active FROM users WHERE id=$1", [ownerUserId]);
  const active = result.rows[0]?.active;
  if (!(active === true || Number(active) === 1)) fail("runtime_credential_account_unavailable", 403);
}
export async function listCredentialMetadata(): Promise<CredentialMetadata[]> {
  const rows = await postgresQuery<StoredCredential>("SELECT id,type,owner_user_id,label,purpose,status,key_version,version,created_by,created_at,updated_at FROM runtime_credentials ORDER BY created_at,id");
  return rows.map(metadata);
}
export async function getCredentialMetadata(id: string): Promise<CredentialMetadata> { return metadata(await requireStored(id)); }

type CredentialInput = { id?: unknown; type: unknown; owner_user_id?: unknown; label?: unknown; purpose?: unknown; status?: unknown; secret: unknown };
/** Internal transaction primitive for a binding/copy transaction. It must not be called outside a PG transaction. */
export async function createCredentialInTransaction(input: CredentialInput, actorId: string, client: PoolClient): Promise<CredentialMetadata> {
  const credentialType = type(input.type);
  const ownerUserId = input.owner_user_id === undefined || input.owner_user_id === null ? null : boundedText(input.owner_user_id, "owner_user_id", true);
  if (credentialType === "organization_secret" && ownerUserId !== null) fail("runtime_credential_organization_owner_forbidden");
  if (credentialType === "user_account") { if (!ownerUserId) fail("runtime_credential_owner_user_id_required"); await requireActiveOwner(ownerUserId, client); }
  const id = optionalCredentialId(input.id) || nid("cred"); const clear = secretValue(input.secret); const label = boundedText(input.label, "label");
  const purpose = boundedText(input.purpose, "purpose"); const recordStatus = status(input.status); const encrypted = encrypt(id, ownerUserId, clear); const now = new Date().toISOString();
  try {
    const result = await client.query<StoredCredential>(`INSERT INTO runtime_credentials
      (id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,1,$10,$11,$11) RETURNING id,type,owner_user_id,label,purpose,status,key_version,version,created_by,created_at,updated_at`,
    [id, credentialType, ownerUserId, label, purpose, recordStatus, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, actorId, now]);
    return metadata(result.rows[0]!);
  } catch (error) { if (error && typeof error === "object" && "code" in error && String((error as {code?: unknown}).code) === "23505") fail("runtime_credential_already_exists", 409); throw error; }
}
export async function createCredential(input: CredentialInput, actorId: string): Promise<CredentialMetadata> {
  return postgresTransaction((client) => createCredentialInTransaction(input, actorId, client));
}
export async function updateCredentialMetadata(id: string, input: { label?: unknown; purpose?: unknown; status?: unknown; expected_version: unknown }): Promise<CredentialMetadata> {
  const credentialIdValue = credentialId(id); const expected = expectedVersion(input.expected_version);
  const changes: Array<{ column: "label" | "purpose" | "status"; value: string }> = [];
  if (input.label !== undefined) changes.push({ column: "label", value: boundedText(input.label, "label") });
  if (input.purpose !== undefined) changes.push({ column: "purpose", value: boundedText(input.purpose, "purpose") });
  if (input.status !== undefined) changes.push({ column: "status", value: status(input.status) });
  if (!changes.length) fail("runtime_credential_no_metadata_changes");
  return postgresTransaction(async (client) => {
    const columns = changes.map((entry, index) => `${entry.column}=$${index + 1}`).join(",");
    const result = await client.query<StoredCredential>(`UPDATE runtime_credentials SET ${columns},version=version+1,updated_at=$${changes.length + 1}
      WHERE id=$${changes.length + 2} AND version=$${changes.length + 3}
      RETURNING id,type,owner_user_id,label,purpose,status,key_version,version,created_by,created_at,updated_at`,
    [...changes.map((entry) => entry.value), new Date().toISOString(), credentialIdValue, expected]);
    if (result.rows[0]) return metadata(result.rows[0]);
    if (!await storedById(credentialIdValue, client)) fail("runtime_credential_not_found", 404);
    fail("runtime_credential_version_conflict", 409);
  });
}
function configReferencesCredential(config: unknown, id: string): boolean {
  if (!isPlainObject(config)) return false;
  if (config.bearer_secret_ref === id || config.credential_account_id === id) return true;
  const headers = config.headers_secret_refs;
  return isPlainObject(headers) && Object.values(headers).some((reference) => reference === id);
}
export async function credentialReferencedByRuntimeConfig(id: string, client?: PoolClient): Promise<boolean> {
  const credentialIdValue = credentialId(id);
  const binding = client ? await client.query<Row>("SELECT 1 FROM user_starry_bindings WHERE bearer_token=$1 LIMIT 1", [credentialIdValue])
    : { rows: await postgresQuery<Row>("SELECT 1 FROM user_starry_bindings WHERE bearer_token=$1 LIMIT 1", [credentialIdValue]) };
  if (binding.rows.length) return true;
  const configs = client ? await client.query<Row>("SELECT config_json FROM runtime_connector_config")
    : { rows: await postgresQuery<Row>("SELECT config_json FROM runtime_connector_config") };
  for (const row of configs.rows) { try { if (configReferencesCredential(JSON.parse(String(row.config_json)), credentialIdValue)) return true; } catch { /* invalid persisted configs fail closed at their owner */ } }
  return false;
}
export async function deleteCredentialInTransaction(id: string, expectedVersionValue: unknown, client: PoolClient): Promise<void> {
  const credentialIdValue = credentialId(id); const expected = expectedVersion(expectedVersionValue);
  const existing = await storedById(credentialIdValue, client);
  if (!existing) fail("runtime_credential_not_found", 404);
  if (Number(existing.version) !== expected) fail("runtime_credential_version_conflict", 409);
  // Inspect both mailbox and runtime-config references while the transaction is
  // still open; a failed delete therefore leaves the credential untouched.
  if (await credentialReferencedByRuntimeConfig(credentialIdValue, client)) fail("runtime_credential_referenced", 409);
  const result = await client.query("DELETE FROM runtime_credentials WHERE id=$1 AND version=$2", [credentialIdValue, expected]);
  if (!result.rowCount) fail("runtime_credential_version_conflict", 409);
}
export async function deleteCredential(id: string, expectedVersionValue: unknown): Promise<void> { await postgresTransaction((client) => deleteCredentialInTransaction(id, expectedVersionValue, client)); }
export async function resolveSecretReference(id: string, userId?: string): Promise<string> {
  const row = await requireStored(id);
  if (row.status !== "active") fail("runtime_credential_unavailable", 403);
  if (row.type === "user_account") { if (!userId || userId !== row.owner_user_id) fail("runtime_credential_access_denied", 403); await postgresTransaction((client) => requireActiveOwner(userId, client)); }
  return decrypt(row);
}
export async function resolveAccountHeaders(accountId: string, userId: string): Promise<Record<string, string>> {
  const exactAccountId = credentialId(accountId); if (!userId || typeof userId !== "string") fail("runtime_credential_account_required", 403);
  const row = await requireStored(exactAccountId); if (row.type !== "user_account") fail("runtime_credential_account_type_invalid", 409);
  const token = (await resolveSecretReference(exactAccountId, userId)).trim().replace(/^Bearer\s+/i, ""); if (!token) fail("runtime_credential_unavailable", 403);
  return { Authorization: `Bearer ${token}` };
}
/** Writes only already-scrubbed metadata. Do not pass secret/ciphertext/nonce/tag. */
export async function writeCredentialAudit(actor: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await postgresQuery("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)", [new Date().toISOString(), actor === "usr_sriphy" ? "sriphy" : actor, eventType, JSON.stringify(payload)]);
}
export const credentialMasterKeyEnvironment = MASTER_KEY_ENV;
