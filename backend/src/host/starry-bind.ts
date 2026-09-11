import { DEMO_ADMIN } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import type { Json, Row } from "../types.js";
import { authDisabled, scopedUser } from "../auth.js";
import { HttpFail } from "./errors.js";
import { mailboxLocalPart, namesMatch, normalizeEmail } from "./identity.js";

export type StarryBindingStatus = "connected" | "expired" | "unbound";

export type PublicStarryBinding = {
  bound: boolean;
  mailbox_email: string;
  mailbox_id: string;
  owner_name: string;
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
    status: String(row.status || "connected") === "expired" ? "expired" : "connected",
    has_token: Boolean(String(row.bearer_token || "").trim()),
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export function starryBindingRow(userId: string): Row | undefined {
  if (!userId) return undefined;
  return getConn().prepare("SELECT * FROM user_starry_bindings WHERE user_id=?").get(userId) as Row | undefined;
}

export function boundMailboxEmail(userId?: string | null): string {
  try {
    const id = String(userId || scopedUser()?.id || "").trim();
    if (!id) return "";
    return String(starryBindingRow(id)?.mailbox_email || "").trim();
  } catch {
    return "";
  }
}

export function boundStarryBearer(userId?: string | null): string {
  if (!userId) return "";
  return String(starryBindingRow(userId)?.bearer_token || "").trim();
}

export function currentFollowScope(): FollowScope {
  if (authDisabled()) return { required: false, ...EMPTY_BINDING };
  const user = scopedUser();
  if (!user) return { required: true, ...EMPTY_BINDING };
  return { required: true, ...publicStarryBinding(starryBindingRow(user.id)) };
}

export function matchesFollowedMailbox(
  kol: { owner_name?: unknown; owner_mailbox?: unknown; mailbox_from?: unknown; mailboxEmail?: unknown },
  scope: Pick<PublicStarryBinding, "mailbox_email" | "owner_name">,
): boolean {
  const mailbox = normalizeEmail(scope.mailbox_email);
  const owner = String(scope.owner_name || "").trim();
  const rowMailbox = normalizeEmail(String(kol.owner_mailbox || kol.mailbox_from || kol.mailboxEmail || ""));
  const rowOwner = String(kol.owner_name || "").trim();
  if (mailbox && rowMailbox && (rowMailbox === mailbox || mailboxLocalPart(rowMailbox) === mailboxLocalPart(mailbox))) {
    return true;
  }
  if (owner && rowOwner && namesMatch(rowOwner, owner)) return true;
  return false;
}

export function saveStarryBinding(userId: string, input: {
  mailbox_email: string;
  mailbox_id?: string;
  owner_name?: string;
  bearer?: string;
  status?: StarryBindingStatus;
}): PublicStarryBinding {
  const mailbox = normalizeEmail(input.mailbox_email);
  if (!mailbox || !mailbox.includes("@")) throw new HttpFail(400, "请选择要绑定的 Starry 发件邮箱");
  const existing = starryBindingRow(userId);
  const bearer = String(input.bearer || existing?.bearer_token || "").trim();
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO user_starry_bindings (user_id,mailbox_email,mailbox_id,owner_name,bearer_token,status,updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       mailbox_email=excluded.mailbox_email,
       mailbox_id=excluded.mailbox_id,
       owner_name=excluded.owner_name,
       bearer_token=excluded.bearer_token,
       status=excluded.status,
       updated_at=excluded.updated_at`,
  ).run(
    userId,
    mailbox,
    String(input.mailbox_id || existing?.mailbox_id || ""),
    String(input.owner_name || existing?.owner_name || ""),
    bearer,
    input.status || "connected",
    now,
  );
  audit(userId, "starry.bind", {
    mailbox_email: mailbox,
    owner_name: String(input.owner_name || ""),
    admin: userId === DEMO_ADMIN.handle || userId === "usr_sriphy",
  });
  return publicStarryBinding(starryBindingRow(userId));
}

export function clearStarryBinding(userId: string): PublicStarryBinding {
  getConn().prepare("DELETE FROM user_starry_bindings WHERE user_id=?").run(userId);
  audit(userId, "starry.unbind", {});
  return { ...EMPTY_BINDING };
}

export function mailboxFromStarryRow(row: Json): {
  id: string;
  mailbox_email: string;
  owner_name: string;
  brand: string;
} {
  const mailbox = normalizeEmail(String(row.mailboxEmail || row.mailbox_email || row.email || ""));
  return {
    id: String(row.id || row.mailboxId || ""),
    mailbox_email: mailbox,
    owner_name: String(row.ownerUserName || row.owner_user_name || row.ownerName || row.owner || ""),
    brand: String(row.brandCode || row.brand_code || row.brandName || row.brand || ""),
  };
}
