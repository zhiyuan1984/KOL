import { createCredential, credentialReferencedByRuntimeConfig, deleteCredential, getCredentialMetadata } from "../runtime/credentials.js";
import { DEMO_ADMIN } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
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
  if (!row || !String(row.mailbox_email || "").trim()) return { ...EMPTY_BINDING };
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

export function starryBindingRows(userId: string): Row[] {
  if (!userId) return [];
  return getConn().prepare(
    "SELECT * FROM user_starry_bindings WHERE user_id=? ORDER BY is_default DESC, updated_at ASC, mailbox_email ASC",
  ).all(userId) as Row[];
}

export function starryBindingRow(userId: string, mailbox?: string): Row | undefined {
  if (!userId) return undefined;
  const box = String(mailbox || "").trim();
  if (box) {
    return getConn().prepare(
      "SELECT * FROM user_starry_bindings WHERE user_id=? AND mailbox_email=?",
    ).get(userId, box) as Row | undefined;
  }
  // No mailbox given: the default binding, else the oldest one.
  return starryBindingRows(userId)[0];
}

export function safeEmployeeId(): string {
  const scoped = scopedUser()?.id;
  if (scoped) return scoped;
  try {
    return String(currentMemoryEmployee().id || "").trim();
  } catch {
    return "";
  }
}

export function boundMailboxEmail(userId?: string | null): string {
  try {
    const id = String(userId || scopedUser()?.id || "").trim();
    if (id) {
      const direct = String(starryBindingRow(id)?.mailbox_email || "").trim();
      if (direct) return direct;
    }
    if (userId) return "";
    const employeeId = String(currentMemoryEmployee().id || "").trim();
    if (employeeId && employeeId !== id) {
      return String(starryBindingRow(employeeId)?.mailbox_email || "").trim();
    }
    return "";
  } catch {
    return "";
  }
}

export function boundStarryCredentialId(userId?: string | null, mailbox?: string): string {
  if (!userId) return "";
  const reference = String(starryBindingRow(userId, mailbox)?.bearer_token || "").trim();
  if (reference && !/^cred_[A-Za-z0-9_-]{8,160}$/.test(reference)) {
    throw new HttpFail(409, { code: "starry_credential_migration_required" });
  }
  return reference;
}

export function currentFollowScope(): FollowScope {
  if (authDisabled()) return { required: false, ...EMPTY_BINDING };
  const user = scopedUser();
  if (!user) return { required: true, ...EMPTY_BINDING };
  return { required: true, ...publicStarryBinding(starryBindingRow(user.id)) };
}

export function matchesFollowedMailbox(
  kol: {
    owner_name?: unknown;
    owner_open_id?: unknown;
    verified_owner_mailbox?: unknown;
    ownership_source_ready?: unknown;
    owner_mailbox?: unknown;
    mailbox_from?: unknown;
    mailboxEmail?: unknown;
    mailbox?: unknown;
  },
  scope: Pick<PublicStarryBinding, "mailbox_email" | "owner_name" | "owner_open_id" | "owner_verified_at">,
  extras: Array<string | undefined | null> = [],
): boolean {
  // Caller context (extras) cannot certify row ownership.
  if (!kol.ownership_source_ready) return false;
  const remoteOwner=String(kol.owner_open_id||"").trim();
  if (remoteOwner && scope.owner_open_id && scope.owner_verified_at) return remoteOwner===scope.owner_open_id;
  return matchesVerifiedMailbox({owner_mailbox:kol.verified_owner_mailbox}, scope);
}

function removeUnusedMailboxCredential(value: unknown): void {
  const id = String(value || "");
  if (!/^cred_[A-Za-z0-9_-]{8,160}$/.test(id) || credentialReferencedByRuntimeConfig(id)) return;
  const credential = getCredentialMetadata(id);
  deleteCredential(id, credential.version);
}

export function saveStarryBinding(userId: string, input: {
  mailbox_email: string;
  mailbox_id?: string;
  owner_name?: string;
  owner_open_id?: string;
  bearer?: string;
  status?: StarryBindingStatus;
}): PublicStarryBinding {
  const mailbox = normalizeEmail(input.mailbox_email);
  if (!mailbox || !mailbox.includes("@")) throw new HttpFail(400, "请选择要绑定的 Starry 发件邮箱");
  const existing = starryBindingRow(userId, mailbox);
  // Historical column name retained for compatibility; new values are vault references only.
  const secret = String(input.bearer || "").trim().replace(/^Bearer\s+/i, "");
  const bearer = secret ? createCredential({ type: "user_account", owner_user_id: userId,
    label: "Starry mailbox", purpose: "Starry mailbox authentication", secret }, userId).id
    : boundStarryCredentialId(userId, mailbox);
  const rowsBefore = starryBindingRows(userId);
  // The first binding of a user becomes the default; adding another mailbox never
  // moves the default off the existing primary mailbox.
  const isDefault = rowsBefore.length === 0 ? 1 : 0;
  const now = nowIso();
  try {
    getConn().prepare(
      `INSERT INTO user_starry_bindings (user_id,mailbox_email,is_default,mailbox_id,owner_name,bearer_token,status,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, mailbox_email) DO UPDATE SET
         mailbox_id=excluded.mailbox_id,
         owner_name=excluded.owner_name,
         bearer_token=excluded.bearer_token,
         status=excluded.status,
         updated_at=excluded.updated_at`,
    ).run(
      userId,
      mailbox,
      isDefault,
      String(input.mailbox_id || existing?.mailbox_id || ""),
      String(input.owner_name || existing?.owner_name || ""),
      bearer,
      input.status || "connected",
      now,
    );
  } catch (error) {
    if (secret) removeUnusedMailboxCredential(bearer);
    throw error;
  }
  if (input.owner_open_id) {
    getConn().prepare("UPDATE user_starry_bindings SET owner_open_id=?,owner_verified_at=? WHERE user_id=? AND mailbox_email=?")
      .run(input.owner_open_id, now, userId, mailbox);
  }
  if (existing?.bearer_token !== bearer) removeUnusedMailboxCredential(existing?.bearer_token);
  audit(userId, "starry.bind", {
    mailbox_email: mailbox,
    owner_name: String(input.owner_name || ""),
    admin: userId === DEMO_ADMIN.handle,
  });
  return publicStarryBinding(starryBindingRow(userId, mailbox));
}

export function clearStarryBinding(userId: string, mailbox?: string): PublicStarryBinding {
  const target = starryBindingRow(userId, mailbox);
  if (!target) {
    audit(userId, "starry.unbind", {});
    return { ...EMPTY_BINDING };
  }
  const wasDefault = Boolean(Number(target.is_default || 0));
  getConn().prepare("DELETE FROM user_starry_bindings WHERE user_id=? AND mailbox_email=?")
    .run(userId, String(target.mailbox_email || ""));
  // Removing the default mailbox promotes the oldest remaining one so a default always exists.
  if (wasDefault) {
    const rows = starryBindingRows(userId);
    if (rows.length) {
      getConn().prepare("UPDATE user_starry_bindings SET is_default=1 WHERE user_id=? AND mailbox_email=?")
        .run(userId, String(rows[0].mailbox_email || ""));
    }
  }
  removeUnusedMailboxCredential(target.bearer_token);
  audit(userId, "starry.unbind", { mailbox_email: String(target.mailbox_email || "") });
  return publicStarryBinding(starryBindingRow(userId));
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
