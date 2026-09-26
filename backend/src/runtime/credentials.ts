import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { asRow, asRows, getConn, nowIso, onConnReset, txImmediate } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Row } from "../types.js";
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

const initializedConnections = new WeakSet<object>();
const MASTER_KEY_ENV = "RUNTIME_CREDENTIAL_MASTER_KEY";
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 240;
const CREDENTIAL_ID = /^cred_[A-Za-z0-9_-]{8,160}$/;

onConnReset(() => {
  // Tests replace SQLite connections in-process; schema initialization must not
  // leak its old connection identity into the next isolated database.
  // WeakSet cannot be cleared, but each new connection is a new key.
});

function fail(code: string, status = 400): never {
  throw new HttpFail(status, { code });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value: unknown, field: string, required = false): string {
  if (value === undefined || value === null) {
    if (required) fail(`runtime_credential_${field}_required`);
    return "";
  }
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`runtime_credential_invalid_${field}`);
  }
  return value.trim();
}

function credentialId(value: unknown): string {
  if (typeof value !== "string" || !CREDENTIAL_ID.test(value)) fail("runtime_credential_invalid_id");
  return value;
}

function optionalCredentialId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return credentialId(value);
}

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

function masterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw) fail("runtime_credential_master_key_unavailable", 503);

  let key: Buffer | undefined;
  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      key = undefined;
    }
  }
  if (!key || key.length !== 32) fail("runtime_credential_master_key_invalid", 503);
  return key;
}

function aad(id: string, ownerUserId: string | null): Buffer {
  return Buffer.from(`runtime-credential-v1:${id}:${ownerUserId || "organization"}`, "utf8");
}

function encrypt(id: string, ownerUserId: string | null, value: string): { ciphertext: string; nonce: string; authTag: string } {
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
  } catch {
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
    if (!clear.length || clear.length > MAX_SECRET_BYTES) fail("runtime_credential_ciphertext_invalid", 500);
    return clear.toString("utf8");
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    // Authentication failures deliberately do not disclose ciphertext details.
    fail("runtime_credential_decryption_failed", 503);
  }
}

/** Lazily create credential-owned tables; core store schema ownership remains unchanged. */
export function ensureCredentialSchema(): void {
  const db = getConn();
  if (initializedConnections.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_credentials (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('organization_secret', 'user_account')),
      owner_user_id TEXT,
      label TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL CHECK (key_version >= 1),
      version INTEGER NOT NULL CHECK (version >= 1),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((type = 'organization_secret' AND owner_user_id IS NULL)
        OR (type = 'user_account' AND owner_user_id IS NOT NULL)),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS runtime_credentials_owner_idx
      ON runtime_credentials(owner_user_id, status, updated_at);
  `);
  initializedConnections.add(db);
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

function storedById(id: string): StoredCredential | undefined {
  ensureCredentialSchema();
  const row = getConn().prepare("SELECT * FROM runtime_credentials WHERE id=?").get(id);
  return row ? asRow(row) as StoredCredential : undefined;
}

function requireStored(id: string): StoredCredential {
  const row = storedById(credentialId(id));
  if (!row) fail("runtime_credential_not_found", 404);
  return row;
}

function requireActiveOwner(ownerUserId: string): void {
  const row = getConn().prepare("SELECT active FROM users WHERE id=?").get(ownerUserId) as Row | undefined;
  if (!row?.active) fail("runtime_credential_account_unavailable", 403);
}

/** Returns safe metadata only; it never includes ciphertext, nonce, tag, or secret values. */
export function listCredentialMetadata(): CredentialMetadata[] {
  ensureCredentialSchema();
  return asRows(getConn().prepare(
    "SELECT id,type,owner_user_id,label,purpose,status,key_version,version,created_by,created_at,updated_at FROM runtime_credentials ORDER BY created_at,id",
  ).all()).map((row) => metadata(row as StoredCredential));
}

export function getCredentialMetadata(id: string): CredentialMetadata {
  const row = requireStored(id);
  return metadata(row);
}

export function createCredential(input: {
  id?: unknown;
  type: unknown;
  owner_user_id?: unknown;
  label?: unknown;
  purpose?: unknown;
  status?: unknown;
  secret: unknown;
}, actorId: string): CredentialMetadata {
  const credentialType = type(input.type);
  const ownerUserId = input.owner_user_id === undefined || input.owner_user_id === null
    ? null
    : boundedText(input.owner_user_id, "owner_user_id", true);
  if (credentialType === "organization_secret" && ownerUserId !== null) fail("runtime_credential_organization_owner_forbidden");
  if (credentialType === "user_account") {
    if (!ownerUserId) fail("runtime_credential_owner_user_id_required");
    requireActiveOwner(ownerUserId);
  }
  const id = optionalCredentialId(input.id) || nid("cred");
  const clear = secretValue(input.secret);
  const label = boundedText(input.label, "label");
  const purpose = boundedText(input.purpose, "purpose");
  const recordStatus = status(input.status);
  const encrypted = encrypt(id, ownerUserId, clear);
  const now = nowIso();

  ensureCredentialSchema();
  try {
    txImmediate((db) => {
      db.prepare(
        `INSERT INTO runtime_credentials
         (id,type,owner_user_id,label,purpose,status,ciphertext,nonce,auth_tag,key_version,version,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, credentialType, ownerUserId, label, purpose, recordStatus, encrypted.ciphertext, encrypted.nonce,
        encrypted.authTag, 1, 1, actorId, now, now);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/UNIQUE constraint failed/i.test(message)) fail("runtime_credential_already_exists", 409);
    throw error;
  }
  return getCredentialMetadata(id);
}

/** Metadata-only update. Secret, owner, type, and cryptographic material are immutable here. */
export function updateCredentialMetadata(id: string, input: {
  label?: unknown;
  purpose?: unknown;
  status?: unknown;
  expected_version: unknown;
}): CredentialMetadata {
  const credentialIdValue = credentialId(id);
  const expected = expectedVersion(input.expected_version);
  const changes: Array<{ column: "label" | "purpose" | "status"; value: string }> = [];
  if (input.label !== undefined) changes.push({ column: "label", value: boundedText(input.label, "label") });
  if (input.purpose !== undefined) changes.push({ column: "purpose", value: boundedText(input.purpose, "purpose") });
  if (input.status !== undefined) changes.push({ column: "status", value: status(input.status) });
  if (!changes.length) fail("runtime_credential_no_metadata_changes");

  ensureCredentialSchema();
  txImmediate((db) => {
    const existing = db.prepare("SELECT version FROM runtime_credentials WHERE id=?").get(credentialIdValue) as Row | undefined;
    if (!existing) fail("runtime_credential_not_found", 404);
    const actual = Number(existing.version);
    if (actual !== expected) fail("runtime_credential_version_conflict", 409);
    const result = db.prepare(
      `UPDATE runtime_credentials SET ${changes.map((entry) => `${entry.column}=?`).join(",")},version=?,updated_at=?
       WHERE id=? AND version=?`,
    ).run(...changes.map((entry) => entry.value), actual + 1, nowIso(), credentialIdValue, actual);
    if (!result.changes) fail("runtime_credential_version_conflict", 409);
  });
  return getCredentialMetadata(credentialIdValue);
}

function configReferencesCredential(config: unknown, id: string): boolean {
  if (!isPlainObject(config)) return false;
  if (config.bearer_secret_ref === id || config.credential_account_id === id) return true;
  const headers = config.headers_secret_refs;
  return isPlainObject(headers) && Object.values(headers).some((reference) => reference === id);
}

/**
 * No changes to core store schema: scan only explicit credential-reference fields
 * in persisted Runtime configs. A malformed config is ignored here because it
 * cannot be a valid binding; the Runtime config reader itself fails closed.
 */
export function credentialReferencedByRuntimeConfig(id: string): boolean {
  const credentialIdValue = credentialId(id);
  ensureRuntimeSchema();
  const rows = getConn().prepare("SELECT config_json FROM runtime_connector_config").all() as Row[];
  for (const row of rows) {
    try {
      if (configReferencesCredential(JSON.parse(String(row.config_json)), credentialIdValue)) return true;
    } catch {
      // The owning runtime config validation reports invalid persisted configs.
    }
  }
  return false;
}

export function deleteCredential(id: string, expectedVersionValue: unknown): void {
  const credentialIdValue = credentialId(id);
  const expected = expectedVersion(expectedVersionValue);
  ensureCredentialSchema();
  txImmediate((db) => {
    const existing = db.prepare("SELECT version FROM runtime_credentials WHERE id=?").get(credentialIdValue) as Row | undefined;
    if (!existing) fail("runtime_credential_not_found", 404);
    if (Number(existing.version) !== expected) fail("runtime_credential_version_conflict", 409);
    if (credentialReferencedByRuntimeConfig(credentialIdValue)) fail("runtime_credential_referenced", 409);
    const result = db.prepare("DELETE FROM runtime_credentials WHERE id=? AND version=?").run(credentialIdValue, expected);
    if (!result.changes) fail("runtime_credential_version_conflict", 409);
  });
}

/**
 * Resolve a reference at execution time. Organization secrets may be resolved
 * without a user; user-account secrets require the exact owning user and an
 * active account. There is intentionally no default-account fallback.
 */
export function resolveSecretReference(id: string, userId?: string): string {
  const row = requireStored(id);
  if (row.status !== "active") fail("runtime_credential_unavailable", 403);
  if (row.type === "user_account") {
    if (!userId || userId !== row.owner_user_id) fail("runtime_credential_access_denied", 403);
    requireActiveOwner(userId);
  }
  return decrypt(row);
}

/**
 * Adapter for Core's `credential_provider='user-account'` integration.
 * `accountId` is exactly the durable credential ID from
 * `credential_account_id`; Core must pass it from the already-authorized
 * Runtime config. This function deliberately cannot select a default account.
 */
export function resolveAccountHeaders(accountId: string, userId: string): Record<string, string> {
  const exactAccountId = credentialId(accountId);
  if (!userId || typeof userId !== "string") fail("runtime_credential_account_required", 403);
  const row = requireStored(exactAccountId);
  if (row.type !== "user_account") fail("runtime_credential_account_type_invalid", 409);
  const token = resolveSecretReference(exactAccountId, userId).trim().replace(/^Bearer\s+/i, "");
  if (!token) fail("runtime_credential_unavailable", 403);
  return { Authorization: `Bearer ${token}` };
}

export const credentialMasterKeyEnvironment = MASTER_KEY_ENV;
