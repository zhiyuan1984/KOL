import { createCredential, credentialReferencedByRuntimeConfig, deleteCredential, getCredentialMetadata } from "../runtime/credentials.js";
import { DEMO_ADMIN } from "../config.js";
import { audit, postgresDb, nowIso } from "../postgres/access.js";
import type { Json, Row } from "../types.js";
import { authDisabled, scopedUser } from "../auth.js";
import { HttpFail } from "./errors.js";
import { normalizeEmail } from "./identity.js";
import { currentMemoryEmployee } from "./kol-memory.js";
import { matchesVerifiedMailbox } from "./starry-mailbox-match.js";

export type StarryBindingStatus = "connected" | "expired" | "unbound";

export type PublicStarryBinding = {
  bound: boolean;
  mailbox_email: string;
  mailbox_id: string;
  owner_name: string;
  owner_open_id?: string;
  owner_verified_at?: string | null;
  status: StarryBindingStatus;
  has_token: boolean;
  updated_at: string | null;
};

export type FollowScope = PublicStarryBinding & {
  required: boolean;
};

const EMPTY_BINDING: PublicStarryBinding = {
  bound: false,
  mailbox_email: "",
  mailbox_id: "",
  owner_name: "",
  status: "unbound",
  has_token: false,
  updated_at: null,
};
export function publicStarryBinding(row?: Row | null): PublicStarryBinding {
  if (!row || !String(row.mailbox_email || "").trim())
    return { ...EMPTY_BINDING };
  return {
    bound: true,
    mailbox_email: String(row.mailbox_email || ""),
    mailbox_id: String(row.mailbox_id || ""),
    owner_name: String(row.owner_name || ""),
    owner_open_id: String(row.owner_open_id || ""),
    owner_verified_at: row.owner_verified_at ? String(row.owner_verified_at) : null,
    status: String(row.status || "connected") === "expired" ? "expired" : "connected",
    has_token: Boolean(String(row.bearer_token || "").trim()),
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}
export async function starryBindingRows(userId: string): Promise<Row[]> {
  if (!userId)
    return [];
  return (await postgresDb().many("SELECT * FROM user_starry_bindings WHERE user_id=$1 ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC", userId)) as Row[];
}
export async function starryBindingRow(userId: string, mailbox?: string): Promise<Row | undefined> {
  if (!userId)
    return undefined;
  const box = String(mailbox || "").trim();
  if (box) {
    return (await postgresDb().one("SELECT * FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", userId, box)) as Row | undefined;
  }
  // No mailbox given: only the explicit default. Never fall back to another mailbox.
  return (await starryBindingRows(userId)).find((row) => Boolean(Number(row.is_default || 0)));
}
export async function safeEmployeeId(): Promise<string> {
  const scoped = scopedUser()?.id;
  if (scoped)
    return scoped;
  try {
    return String((await currentMemoryEmployee()).id || "").trim();
  }
  catch {
    return "";
  }
}
export async function boundMailboxEmail(userId?: string | null): Promise<string> {
  try {
    const id = String(userId || scopedUser()?.id || "").trim();
    if (id) {
      const direct = String((await starryBindingRow(id))?.mailbox_email || "").trim();
      if (direct)
        return direct;
    }
    if (userId)
      return "";
    const employeeId = String((await currentMemoryEmployee()).id || "").trim();
    if (employeeId && employeeId !== id) {
      return String((await starryBindingRow(employeeId))?.mailbox_email || "").trim();
    }
    return "";
  }
  catch {
    return "";
  }
}
export async function boundStarryCredentialId(userId?: string | null, mailbox?: string): Promise<string> {
  if (!userId)
    return "";
  const reference = String((await starryBindingRow(userId, mailbox))?.bearer_token || "").trim();
  if (reference && !/^cred_[A-Za-z0-9_-]{8,160}$/.test(reference)) {
    throw new HttpFail(409, { code: "starry_credential_migration_required" });
  }
  return reference;
}
export async function currentFollowScope(): Promise<FollowScope> {
  if (authDisabled())
    return { required: false, ...EMPTY_BINDING };
  const user = scopedUser();
  if (!user)
    return { required: true, ...EMPTY_BINDING };
  return { required: true, ...publicStarryBinding((await starryBindingRow(user.id))) };
}
export function matchesFollowedMailbox(kol: {
    owner_name?: unknown;
    owner_open_id?: unknown;
    verified_owner_mailbox?: unknown;
    ownership_source_ready?: unknown;
    owner_mailbox?: unknown;
    mailbox_from?: unknown;
    mailboxEmail?: unknown;
    mailbox?: unknown;
}, scope: Pick<PublicStarryBinding, "mailbox_email" | "owner_name" | "owner_open_id" | "owner_verified_at">, extras: Array<string | undefined | null> = []): boolean {
  // Caller context (extras) cannot certify row ownership.
  if (!kol.ownership_source_ready)
    return false;
  const remoteOwner = String(kol.owner_open_id || "").trim();
  if (remoteOwner && scope.owner_open_id && scope.owner_verified_at)
    return remoteOwner === scope.owner_open_id;
  return matchesVerifiedMailbox({ owner_mailbox: kol.verified_owner_mailbox }, scope);
}
async function removeUnusedMailboxCredential(value: unknown): Promise<void> {
  const id = String(value || "");
  if (!/^cred_[A-Za-z0-9_-]{8,160}$/.test(id) || (await credentialReferencedByRuntimeConfig(id)))
    return;
  const credential = (await getCredentialMetadata(id));
  (await deleteCredential(id, credential.version));
}
export async function saveStarryBinding(userId: string, input: {
  mailbox_email: string;
  mailbox_id?: string;
  owner_name?: string;
  owner_open_id?: string;
  bearer?: string;
  status?: StarryBindingStatus;
}): Promise<PublicStarryBinding> {
  const mailbox = normalizeEmail(input.mailbox_email);
  if (!mailbox || !mailbox.includes("@"))
    throw new HttpFail(400, "请选择要绑定的 Starry 发件邮箱");
  const existing = (await starryBindingRow(userId, mailbox));
  // Historical column name retained for compatibility; new values are vault references only.
  const secret = String(input.bearer || "").trim().replace(/^Bearer\s+/i, "");
  const bearer = secret ? (await createCredential({ type: "user_account", owner_user_id: userId,
    label: "Starry mailbox", purpose: "Starry mailbox authentication", secret }, userId)).id
    : (await boundStarryCredentialId(userId, mailbox));
  const rowsBefore = (await starryBindingRows(userId));
  // A save with no default on file becomes the default: the first bind, or an
  // explicit re-selection after the previous default was removed. Adding another
  // mailbox while a default exists never moves it off the primary one.
  const hasDefault = rowsBefore.some((row) => Number(row.is_default || 0) === 1);
  const isDefault = hasDefault ? 0 : 1;
  const now = nowIso();
  try {
    (await postgresDb().execute(`INSERT INTO user_starry_bindings (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(user_id, mailbox_email) DO UPDATE SET
         mailbox_id=excluded.mailbox_id,
         owner_name=excluded.owner_name,
         bearer_token=excluded.bearer_token,
         status=excluded.status,
         updated_at=excluded.updated_at`, userId, mailbox, isDefault, String(input.mailbox_id || existing?.mailbox_id || ""), String(input.owner_name || existing?.owner_name || ""), bearer, input.status || "connected", now));
  }
  catch (error) {
    if (secret)
      (await removeUnusedMailboxCredential(bearer));
    throw error;
  }
  // ON CONFLICT keeps the stored is_default column; promote explicitly when this
  // save is the user's re-selection after no default remained.
  if (isDefault) {
    (await postgresDb().execute("UPDATE user_starry_bindings SET is_default=1 WHERE user_id=$1 AND mailbox_email=$2", userId, mailbox));
  }
  if (input.owner_open_id) {
    (await postgresDb().execute("UPDATE user_starry_bindings SET owner_open_id=$1,owner_verified_at=$2 WHERE user_id=$3 AND mailbox_email=$4", input.owner_open_id, now, userId, mailbox));
  }
  if (existing?.bearer_token !== bearer)
    (await removeUnusedMailboxCredential(existing?.bearer_token));
  (await audit(userId, "starry.bind", {
    mailbox_email: mailbox,
    owner_name: String(input.owner_name || ""),
    admin: userId === DEMO_ADMIN.handle,
  }));
  return publicStarryBinding((await starryBindingRow(userId, mailbox)));
}
export async function clearStarryBinding(userId: string, mailbox?: string): Promise<PublicStarryBinding> {
  const target = (await starryBindingRow(userId, mailbox));
  if (!target) {
    (await audit(userId, "starry.unbind", {}));
    return { ...EMPTY_BINDING };
  }
  const wasDefault = Boolean(Number(target.is_default || 0));
  (await postgresDb().execute("DELETE FROM user_starry_bindings WHERE user_id=$1 AND mailbox_email=$2", userId, String(target.mailbox_email || "")));
  // Removing a default leaves no default; another mailbox requires an explicit selection.
  if (wasDefault)
    (await postgresDb().execute("UPDATE user_starry_bindings SET is_default=0 WHERE user_id=$1", userId));
  (await removeUnusedMailboxCredential(target.bearer_token));
  (await audit(userId, "starry.unbind", { mailbox_email: String(target.mailbox_email || "") }));
  return publicStarryBinding((await starryBindingRow(userId)));
}
export function mailboxFromStarryRow(row: Json): {
  id: string;
  mailbox_email: string;
  owner_name: string;
  owner_open_id: string;
  brand: string;
} {
  const mailbox = normalizeEmail(String(row.mailboxEmail || row.mailbox_email || row.email || ""));
  return {
    id: String(row.id || row.mailboxId || ""),
    mailbox_email: mailbox,
    owner_name: String(row.ownerUserName || row.owner_user_name || row.ownerName || row.owner || ""),
    owner_open_id: String(row.ownerOpenId || row.owner_open_id || row.ownerUserId || row.owner_user_id || ""),
    brand: String(row.brandCode || row.brand_code || row.brandName || row.brand || ""),
  };
}
