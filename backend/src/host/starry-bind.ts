import { DEMO_ADMIN } from "../config.js";
import { audit, getConn, nowIso } from "../db.js";
import type { Json, Row } from "../types.js";
import { authDisabled, scopedUser } from "../auth.js";
import { HttpFail } from "./errors.js";
import { mailboxLocalPart, namesMatch, normalizeEmail } from "./identity.js";
import { currentMemoryEmployee } from "./kol-memory.js";
import { isPlaceholderMailbox } from "../starrykol/mail-fields.js";

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

export function boundStarryBearer(userId?: string | null, mailbox?: string): string {
  if (!userId) return "";
  return String(starryBindingRow(userId, mailbox)?.bearer_token || "").trim();
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
    owner_mailbox?: unknown;
    mailbox_from?: unknown;
    mailboxEmail?: unknown;
    mailbox?: unknown;
  },
  scope: Pick<PublicStarryBinding, "mailbox_email" | "owner_name">,
  extras: Array<string | undefined | null> = [],
): boolean {
  const mailbox = normalizeEmail(scope.mailbox_email);
  const owner = String(scope.owner_name || "").trim();
  const rowOwner = String(kol.owner_name || "").trim();
  const candidates = [
    kol.owner_mailbox,
    kol.mailbox_from,
    kol.mailboxEmail,
    kol.mailbox,
    ...extras,
  ].map((value) => normalizeEmail(String(value || ""))).filter(Boolean);
  for (const rowMailbox of candidates) {
    if (mailbox && (rowMailbox === mailbox || mailboxLocalPart(rowMailbox) === mailboxLocalPart(mailbox))) {
      return true;
    }
    // Brand placeholder (kol.lt@litime.example) must not hide a bound operator mailbox.
    if (mailbox && isPlaceholderMailbox(rowMailbox)) {
      const ownerBox = normalizeEmail(String(kol.owner_mailbox || ""));
      if (!ownerBox || ownerBox === mailbox || (owner && rowOwner && namesMatch(rowOwner, owner))) return true;
    }
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
  const existing = starryBindingRow(userId, mailbox);
  const bearer = String(input.bearer || existing?.bearer_token || "").trim();
  const rowsBefore = starryBindingRows(userId);
  // The first binding of a user becomes the default; adding another mailbox never
  // moves the default off the existing primary mailbox.
  const isDefault = rowsBefore.length === 0 ? 1 : 0;
  const now = nowIso();
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
  audit(userId, "starry.unbind", { mailbox_email: String(target.mailbox_email || "") });
  return publicStarryBinding(starryBindingRow(userId));
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
