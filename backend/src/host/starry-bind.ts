import type { PoolClient } from "pg";
import { authDisabled, scopedUser } from "../auth.js";
import { DEMO_ADMIN } from "../config.js";
import { createCredentialInTransaction, credentialReferencedByRuntimeConfig, deleteCredentialInTransaction, getCredentialMetadata, writeCredentialAudit } from "../runtime/credentials.js";
import { postgresTransaction } from "../postgres/pool.js";
import { pgDeleteMailboxBindingInTransaction, pgLockMailboxAccount, pgMailboxRow, pgMailboxRows, pgUpsertMailboxBindingInTransaction } from "../postgres/credential-binding-repository.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { normalizeEmail } from "./identity.js";
import { currentMemoryEmployee } from "./kol-memory.js";
import { matchesVerifiedMailbox } from "./starry-mailbox-match.js";

export type StarryBindingStatus = "connected" | "expired" | "unbound";
export type PublicStarryBinding = { bound: boolean; mailbox_email: string; mailbox_id: string; owner_name: string; owner_open_id?: string; owner_verified_at?: string | null; status: StarryBindingStatus; has_token: boolean; updated_at: string | null; };
export type FollowScope = PublicStarryBinding & { required: boolean };
const EMPTY_BINDING: PublicStarryBinding = { bound: false, mailbox_email: "", mailbox_id: "", owner_name: "", status: "unbound", has_token: false, updated_at: null };
const CREDENTIAL_ID = /^cred_[A-Za-z0-9_-]{8,160}$/;
export function publicStarryBinding(row?: Row | null): PublicStarryBinding {
  if (!row || !String(row.mailbox_email || "").trim()) return { ...EMPTY_BINDING };
  return { bound: true, mailbox_email: String(row.mailbox_email || ""), mailbox_id: String(row.mailbox_id || ""), owner_name: String(row.owner_name || ""),
    owner_open_id: String(row.owner_open_id || ""), owner_verified_at: row.owner_verified_at ? String(row.owner_verified_at) : null,
    status: String(row.status || "connected") === "expired" ? "expired" : "connected", has_token: Boolean(String(row.bearer_token || "").trim()), updated_at: row.updated_at ? String(row.updated_at) : null };
}
export async function starryBindingRows(userId: string): Promise<Row[]> { return userId ? (pgMailboxRows(userId)) : []; }
export async function starryBindingRow(userId: string, mailbox?: string): Promise<Row | undefined> { return userId ? (pgMailboxRow(userId, String(mailbox || "").trim() || undefined)) : undefined; }
export async function safeEmployeeId(): Promise<Awaited<string>> {
  const scoped = scopedUser()?.id; if (scoped) return scoped;
  try { return String((await currentMemoryEmployee()).id || "").trim(); } catch { return ""; }
}
export async function boundMailboxEmail(userId?: string | null): Promise<string> {
  try {
    const id = String(userId || scopedUser()?.id || "").trim();
    if (id) { const direct = String((await starryBindingRow(id))?.mailbox_email || "").trim(); if (direct) return direct; }
    if (userId) return "";
    const employeeId = String((await currentMemoryEmployee()).id || "").trim();
    return employeeId && employeeId !== id ? String((await starryBindingRow(employeeId))?.mailbox_email || "").trim() : "";
  } catch { return ""; }
}
export async function boundStarryCredentialId(userId?: string | null, mailbox?: string): Promise<string> {
  if (!userId) return "";
  const reference = String((await starryBindingRow(userId, mailbox))?.bearer_token || "").trim();
  if (reference && !CREDENTIAL_ID.test(reference)) throw new HttpFail(409, { code: "starry_credential_migration_required" });
  return reference;
}
export async function currentFollowScope(): Promise<FollowScope> {
  if (authDisabled()) return { required: false, ...EMPTY_BINDING };
  const user = scopedUser(); if (!user) return { required: true, ...EMPTY_BINDING };
  return { required: true, ...publicStarryBinding(await starryBindingRow(user.id)) };
}
export function matchesFollowedMailbox(kol: { owner_name?: unknown; owner_open_id?: unknown; verified_owner_mailbox?: unknown; ownership_source_ready?: unknown; owner_mailbox?: unknown; mailbox_from?: unknown; mailboxEmail?: unknown; mailbox?: unknown }, scope: Pick<PublicStarryBinding, "mailbox_email" | "owner_name" | "owner_open_id" | "owner_verified_at">, extras: Array<string | undefined | null> = []): boolean {
  if (!kol.ownership_source_ready) return false;
  const remoteOwner = String(kol.owner_open_id || "").trim();
  if (remoteOwner && scope.owner_open_id && scope.owner_verified_at) return remoteOwner === scope.owner_open_id;
  return matchesVerifiedMailbox({ owner_mailbox: kol.verified_owner_mailbox }, scope);
}
async function removeUnusedMailboxCredential(value: unknown, client: PoolClient): Promise<void> {
  const id = String(value || ""); if (!CREDENTIAL_ID.test(id) || await credentialReferencedByRuntimeConfig(id, client)) return;
  const credential = await getCredentialMetadataInTransaction(id, client);
  if (credential) await deleteCredentialInTransaction(id, credential.version, client);
}
async function getCredentialMetadataInTransaction(id: string, client: PoolClient): Promise<{ version: number } | undefined> {
  const result = await client.query<{ version: number }>("SELECT version FROM runtime_credentials WHERE id=$1 FOR UPDATE", [id]);
  return result.rows[0] ? { version: Number(result.rows[0].version) } : undefined;
}
export async function saveStarryBinding(userId: string, input: { mailbox_email: string; mailbox_id?: string; owner_name?: string; owner_open_id?: string; bearer?: string; status?: StarryBindingStatus }): Promise<PublicStarryBinding> {
  const mailbox = normalizeEmail(input.mailbox_email); if (!mailbox || !mailbox.includes("@")) throw new HttpFail(400, "请选择要绑定的 Starry 发件邮箱");
  const secret = String(input.bearer || "").trim().replace(/^Bearer\s+/i, ""); const now = new Date().toISOString();
  const row = await postgresTransaction(async (client) => {
    await pgLockMailboxAccount(client, userId);
    const existing = await pgMailboxRow(userId, mailbox, client, true);
    const bearer = secret ? (await createCredentialInTransaction({ type: "user_account", owner_user_id: userId, label: "Starry mailbox", purpose: "Starry mailbox authentication", secret }, userId, client)).id
      : String(existing?.bearer_token || "");
    const saved = await pgUpsertMailboxBindingInTransaction(client, { userId, email: mailbox, mailboxId: String(input.mailbox_id || existing?.mailbox_id || ""), ownerName: String(input.owner_name || existing?.owner_name || ""), credentialRef: bearer, status: input.status || "connected", now, ownerOpenId: input.owner_open_id });
    if (existing?.bearer_token && existing.bearer_token !== bearer) await removeUnusedMailboxCredential(existing.bearer_token, client);
    return saved;
  });
  await writeCredentialAudit(userId, "starry.bind", { mailbox_email: mailbox, owner_name: String(input.owner_name || ""), admin: userId === DEMO_ADMIN.handle });
  return publicStarryBinding(row);
}
export async function clearStarryBinding(userId: string, mailbox?: string): Promise<PublicStarryBinding> {
  const result = await postgresTransaction(async (client) => {
    await pgLockMailboxAccount(client, userId);
    const target = await pgMailboxRow(userId, mailbox, client, true);
    if (!target) return { target: undefined, default: undefined as Row | undefined };
    await pgDeleteMailboxBindingInTransaction(client, userId, String(target.mailbox_email));
    if (Number(target.is_default || 0) === 1) await client.query("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1", [userId]);
    await removeUnusedMailboxCredential(target.bearer_token, client);
    return { target, default: await pgMailboxRow(userId, undefined, client) };
  });
  await writeCredentialAudit(userId, "starry.unbind", result.target ? { mailbox_email: String(result.target.mailbox_email || "") } : {});
  return publicStarryBinding(result.default);
}
export function mailboxFromStarryRow(row: Json): { id: string; mailbox_email: string; owner_name: string; owner_open_id: string; brand: string } {
  const mailbox = normalizeEmail(String(row.mailboxEmail || row.mailbox_email || row.email || ""));
  return { id: String(row.id || row.mailboxId || ""), mailbox_email: mailbox, owner_name: String(row.ownerUserName || row.owner_user_name || row.ownerName || row.owner || ""), owner_open_id: String(row.ownerOpenId || row.owner_open_id || row.ownerUserId || row.owner_user_id || ""), brand: String(row.brandCode || row.brand_code || row.brandName || row.brand || "") };
}
