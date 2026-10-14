import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { asRow, asRows, postgresDb, nowIso, onDatabaseReset, pgSerialTransaction } from "../postgres/access.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Row } from "../types.js";
import { requireRuntimeIdentityTables } from "./schema.js";
import { ensureRuntimeSchema } from "./store.js";
/**
 * Server-side credential vault. Ciphertext is authenticated with an environment
 * supplied key and is never returned from metadata APIs or audit events.
 *
 * `user_account` records are deliberately selected by their credential ID. There
 * is no "first account" / default account lookup in this module.
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
  id: string;
  type: CredentialType;
  owner_user_id: string | null;
  label: string;
  purpose: string;
  status: CredentialStatus;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  key_version: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
let credentialSchemaReady = false;
let credentialSchemaInitialization: Promise<void> | undefined;
const MASTER_KEY_ENV = "RUNTIME_CREDENTIAL_MASTER_KEY";
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 240;
const CREDENTIAL_ID = /^cred_[A-Za-z0-9_-]{8,160}$/;
onDatabaseReset(() => {
  credentialSchemaReady = false;
  credentialSchemaInitialization = undefined;
});
function fail(code: string, status = 400): never {
  throw new HttpFail(status, { code });
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function boundedText(value: unknown, field: string, required = false): string {
  if (value === undefined || value === null) {
    if (required)
      fail(`runtime_credential_${field}_required`);
    return "";
  }
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`runtime_credential_invalid_${field}`);
  }
  return value.trim();
}
function credentialId(value: unknown): string {
  if (typeof value !== "string" || !CREDENTIAL_ID.test(value))
    fail("runtime_credential_invalid_id");
  return value;
}
function optionalCredentialId(value: unknown): string | undefined {
  if (value === undefined)
    return undefined;
  return credentialId(value);
}
function status(value: unknown, fallback: CredentialStatus = "active"): CredentialStatus {
  if (value === undefined)
    return fallback;
  if (value === "active" || value === "disabled")
    return value;
  fail("runtime_credential_invalid_status");
}
function type(value: unknown): CredentialType {
  if (value === "organization_secret" || value === "user_account")
    return value;
  fail("runtime_credential_invalid_type");
}
function expectedVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail("runtime_credential_invalid_expected_version");
  }
  return value;
}

function secretValue(value: unknown): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
    fail("runtime_credential_invalid_secret");
  }
  return value;
}
function parseMasterKey(raw: string | undefined): Buffer | undefined {
  if (!raw)
    return undefined;
  if (/^[a-fA-F0-9]{64}$/.test(raw))
    return Buffer.from(raw, "hex");
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : undefined;
  }
  catch {
    return undefined;
  }
}
function masterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw)
    fail("runtime_credential_master_key_unavailable", 503);
  const key = parseMasterKey(raw);
  if (!key)
    fail("runtime_credential_master_key_invalid", 503);
  return key;
}
/** True when a usable master key is configured; the vault answers 503 for every write and read otherwise. */
export function credentialVaultReady(): boolean {
  return parseMasterKey(process.env[MASTER_KEY_ENV]) !== undefined;
}

function aad(id: string, ownerUserId: string | null): Buffer {
  return Buffer.from(`runtime-credential-v1:${id}:${ownerUserId || "organization"}`, "utf8");
}
function encrypt(id: string, ownerUserId: string | null, value: string): {
  ciphertext: string;
  nonce: string;
  authTag: string;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce);
  cipher.setAAD(aad(id, ownerUserId));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decrypt(row: StoredCredential): string {
  let nonce: Buffer;
  let ciphertext: Buffer;
  let authTag: Buffer;
  try {
    nonce = Buffer.from(row.nonce, "base64");
    ciphertext = Buffer.from(row.ciphertext, "base64");
    authTag = Buffer.from(row.auth_tag, "base64");
  }
  catch {
    fail("runtime_credential_ciphertext_invalid", 500);
  }
  if (nonce!.length !== 12 || authTag!.length !== 16 || ciphertext!.length > MAX_SECRET_BYTES + 32) {
    fail("runtime_credential_ciphertext_invalid", 500);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), nonce!);
    decipher.setAAD(aad(row.id, row.owner_user_id));
    decipher.setAuthTag(authTag!);
    const clear = Buffer.concat([decipher.update(ciphertext!), decipher.final()]);
    if (!clear.length || clear.length > MAX_SECRET_BYTES)
      fail("runtime_credential_ciphertext_invalid", 500);
    return clear.toString("utf8");
  }
  catch (error) {
    if (error instanceof HttpFail)
      throw error;
    // Authentication failures deliberately do not disclose ciphertext details.
    fail("runtime_credential_decryption_failed", 503);
  }
}
/** Verify credential tables introduced by the native PostgreSQL migration. */
export async function ensureCredentialSchema(): Promise<void> {
  if (credentialSchemaReady)
    return;
  if (!credentialSchemaInitialization) {
    credentialSchemaInitialization = (async () => {
      await requireRuntimeIdentityTables("runtime credentials", ["runtime_credentials"]);
      credentialSchemaReady = true;
    })();
  }
  try {
    await credentialSchemaInitialization;
  }
  catch (error) {
    credentialSchemaInitialization = undefined;
    throw error;
  }
}
function metadata(row: StoredCredential): CredentialMetadata {
  return {
    id: String(row.id),
    type: type(row.type),
    owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
    label: String(row.label || ""),
    purpose: String(row.purpose || ""),
    status: status(row.status),
    key_version: Number(row.key_version),
    version: Number(row.version),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
async function storedById(id: string): Promise<StoredCredential | undefined> {
  (await ensureCredentialSchema());
  const row = (await postgresDb().one("SELECT * FROM runtime_credentials WHERE id=$1", id));
  return row ? asRow(row) as StoredCredential : undefined;
}
async function requireStored(id: string): Promise<StoredCredential> {
  const row = (await storedById(credentialId(id)));
  if (!row)
    fail("runtime_credential_not_found", 404);
  return row;
}
async function requireActiveOwner(ownerUserId: string): Promise<void> {
  const row = (await postgresDb().one("SELECT active FROM users WHERE id=$1", ownerUserId)) as Row | undefined;
  if (!row?.active)
    fail("runtime_credential_account_unavailable", 403);
}
/** Returns safe metadata only; it never includes ciphertext, nonce, tag, or secret values. */
export async function listCredentialMetadata(): Promise<CredentialMetadata[]> {
  (await ensureCredentialSchema());
  return asRows((await postgresDb().many("SELECT id,type,owner_user_id,label,purpose,status,key_version,version,created_by,created_at,updated_at FROM runtime_credentials ORDER BY created_at,id"))).map((row) => metadata(row as StoredCredential));
}
export async function getCredentialMetadata(id: string): Promise<CredentialMetadata> {
  const row = (await requireStored(id));
  return metadata(row);
}
export async function createCredential(input: {
  id?: unknown;
  type: unknown;
  owner_user_id?: unknown;
  label?: unknown;
  purpose?: unknown;
  status?: unknown;
  secret: unknown;
}, actorId: string): Promise<CredentialMetadata> {
  const credentialType = type(input.type);
  const ownerUserId = input.owner_user_id === undefined || input.owner_user_id === null
    ? null
    : boundedText(input.owner_user_id, "owner_user_id", true);
  if (credentialType === "organization_secret" && ownerUserId !== null)
    fail("runtime_credential_organization_owner_forbidden");
  if (credentialType === "user_account") {
    if (!ownerUserId)
      fail("runtime_credential_owner_user_id_required");
    (await requireActiveOwner(ownerUserId));
  }
  const id = optionalCredentialId(input.id) || nid("cred");
  const clear = secretValue(input.secret);
  const label = boundedText(input.label, "label");
  const purpose = boundedText(input.purpose, "purpose");
  const recordStatus = status(input.status);
  const encrypted = encrypt(id, ownerUserId, clear);
  const now = nowIso();
  (await ensureCredentialSchema());
  try {
    (await pgSerialTransaction(async (db) => {
      (await db.execute(`INSERT INTO runtime_credentials
         (id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, id, credentialType, ownerUserId, label, purpose, recordStatus, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, 1, 1, actorId, now, now));
    }));
  }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = error && typeof error === "object" && "code" in error
      ? String((error as {
        code?: unknown;
      }).code || "")
      : "";
    if (code === "23505" || /UNIQUE constraint failed/i.test(message))
      fail("runtime_credential_already_exists", 409);
    throw error;
  }
  return (await getCredentialMetadata(id));
}
/** Metadata-only update. Secret, owner, type, and cryptographic material are immutable here. */
export async function updateCredentialMetadata(id: string, input: {
  label?: unknown;
  purpose?: unknown;
  status?: unknown;
  expected_version: unknown;
}): Promise<CredentialMetadata> {
  const credentialIdValue = credentialId(id);
  const expected = expectedVersion(input.expected_version);
  const changes: Array<{
    column: "label" | "purpose" | "status";
    value: string;
  }> = [];
  if (input.label !== undefined)
    changes.push({ column: "label", value: boundedText(input.label, "label") });
  if (input.purpose !== undefined)
    changes.push({ column: "purpose", value: boundedText(input.purpose, "purpose") });
  if (input.status !== undefined)
    changes.push({ column: "status", value: status(input.status) });
  if (!changes.length)
    fail("runtime_credential_no_metadata_changes");
  (await ensureCredentialSchema());
  (await pgSerialTransaction(async (db) => {
    const existing = (await db.one("SELECT version FROM runtime_credentials WHERE id=$1", credentialIdValue)) as Row | undefined;
    if (!existing)
      fail("runtime_credential_not_found", 404);
    const actual = Number(existing.version);
    if (actual !== expected)
      fail("runtime_credential_version_conflict", 409);
    const assignments = changes.map((entry, index) => `${entry.column}=$${index + 1}`).join(",");
    const versionIndex = changes.length + 1;
    const updatedAtIndex = versionIndex + 1;
    const idIndex = updatedAtIndex + 1;
    const result = (await db.execute(`UPDATE runtime_credentials SET ${assignments},version=$${versionIndex},updated_at=$${updatedAtIndex}
       WHERE id=$${idIndex} AND version=$${idIndex + 1}`, ...changes.map((entry) => entry.value), actual + 1, nowIso(), credentialIdValue, actual));
    if (!result.changes)
      fail("runtime_credential_version_conflict", 409);
  }));
  return (await getCredentialMetadata(credentialIdValue));
}
function configReferencesCredential(config: unknown, id: string): boolean {
  if (!isPlainObject(config))
    return false;
  if (config.bearer_secret_ref === id || config.credential_account_id === id)
    return true;
  const headers = config.headers_secret_refs;
  return isPlainObject(headers) && Object.values(headers).some((reference) => reference === id);
}

/**
 * No changes to core store schema: scan only explicit credential-reference fields
 * in persisted Runtime configs. A malformed config is ignored here because it
 * cannot be a valid binding; the Runtime config reader itself fails closed.
 */
export async function credentialReferencedByRuntimeConfig(id: string): Promise<boolean> {
  const credentialIdValue = credentialId(id);
  (await ensureRuntimeSchema());
  if ((await postgresDb().one("SELECT 1 FROM user_starry_bindings WHERE bearer_token=$1 LIMIT 1", credentialIdValue)))
    return true;
  const rows = (await postgresDb().many("SELECT config_json FROM runtime_connector_config")) as Row[];
  for (const row of rows) {
    try {
      if (configReferencesCredential(JSON.parse(String(row.config_json)), credentialIdValue))
        return true;
    }
    catch {
      // The owning runtime config validation reports invalid persisted configs.
    }
  }
  return false;
}
export async function deleteCredential(id: string, expectedVersionValue: unknown): Promise<void> {
  const credentialIdValue = credentialId(id);
  const expected = expectedVersion(expectedVersionValue);
  (await ensureCredentialSchema());
  (await pgSerialTransaction(async (db) => {
    const existing = (await db.one("SELECT version FROM runtime_credentials WHERE id=$1", credentialIdValue)) as Row | undefined;
    if (!existing)
      fail("runtime_credential_not_found", 404);
    if (Number(existing.version) !== expected)
      fail("runtime_credential_version_conflict", 409);
    if ((await credentialReferencedByRuntimeConfig(credentialIdValue)))
      fail("runtime_credential_referenced", 409);
    const result = (await db.execute("DELETE FROM runtime_credentials WHERE id=$1 AND version=$2", credentialIdValue, expected));
    if (!result.changes)
      fail("runtime_credential_version_conflict", 409);
  }));
}
/**
 * Resolve a reference at execution time. Organization secrets may be resolved
 * without a user; user-account secrets require the exact owning user and an
 * active account. There is intentionally no default-account fallback.
 */
export async function resolveSecretReference(id: string, userId?: string): Promise<string> {
  const row = (await requireStored(id));
  if (row.status !== "active")
    fail("runtime_credential_unavailable", 403);
  if (row.type === "user_account") {
    if (!userId || userId !== row.owner_user_id)
      fail("runtime_credential_access_denied", 403);
    (await requireActiveOwner(userId));
  }
  return decrypt(row);
}

/**
 * Adapter for Core's `credential_provider='user-account'` integration.
 * `accountId` is exactly the durable credential ID from
 * `credential_account_id`; Core must pass it from the already-authorized
 * Runtime config. This function deliberately cannot select a default account.
 */
export async function resolveAccountHeaders(accountId: string, userId: string): Promise<Record<string, string>> {
  const exactAccountId = credentialId(accountId);
  if (!userId || typeof userId !== "string")
    fail("runtime_credential_account_required", 403);
  const row = (await requireStored(exactAccountId));
  if (row.type !== "user_account")
    fail("runtime_credential_account_type_invalid", 409);
  const token = (await resolveSecretReference(exactAccountId, userId)).trim().replace(/^Bearer\s+/i, "");
  if (!token)
    fail("runtime_credential_unavailable", 403);
  return { Authorization: `Bearer ${token}` };
}
export const credentialMasterKeyEnvironment = MASTER_KEY_ENV;
