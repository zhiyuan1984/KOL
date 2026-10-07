/**
 * 写邮件的发件箱默认规则（BIZ-04、backend/skills/email_compose/SKILL.md）：
 * 1. 明确指定（requested）
 * 2. 通讯页选中的邮箱（selectedMailbox；必须是本人挂载，并过品牌范围核对）
 * 3. 本人挂载的默认邮箱（is_default=1 的那只）
 * 4. 合作记录的 mailbox_from
 * 5. 当前品牌唯一授权箱
 * 都没有就留空让人补。
 *
 * 每一步都过品牌与范围核对；任何一步都不得从多个候选里取第一只（BIZ-04）：
 * 挂了多只又没有默认时，from 留空并返回全部候选，让人选。
 */
import type { Persona } from "../config.js";
import { getConn } from "../db.js";
import type { Row } from "../types.js";
import { normalizeEmail } from "./identity.js";
import { authorizedSenderBrand, resolveAuthorizedFrom } from "./pep.js";
import { currentUser } from "./persona.js";
import { boundMailboxEmail, starryBindingRows } from "./starry-bind.js";

export type ComposeSenderSource =
  | "explicit"
  | "selected"
  | "user_binding"
  | "collaboration"
  | "brand_unique"
  | "none";

export type ComposeSenderCandidate = { email: string; label: string };

export type ComposeSender = {
  /** 展示与落库用的发件箱 */
  from: string;
  /** 通过品牌范围核对、可交给网关外发的地址；无授权时为空 */
  send_from: string;
  brand: string;
  source: ComposeSenderSource;
  /** 挂了多只又没有默认时带回全部候选，让人选 */
  candidates: ComposeSenderCandidate[];
};

export function collaborationBrand(collaborationId?: string | null): string {
  const id = String(collaborationId || "").trim();
  if (!id) return "";
  const row = getConn().prepare("SELECT brand FROM collaborations WHERE id=?").get(id) as Row | undefined;
  return String(row?.brand || "").trim();
}

/** 本人挂载的默认邮箱：is_default=1 的那只；没有默认返回空（不取第一只）。 */
function defaultBoundMailbox(user: Persona): string {
  try {
    const rows = starryBindingRows(user.id);
    const def = rows.find((row) => Number(row.is_default || 0) === 1);
    return normalizeEmail(String(def?.mailbox_email || ""));
  } catch {
    return "";
  }
}

/** 本人挂载的全部邮箱（小写归一），给「通讯页选中」做归属校验。 */
function mountedMailboxSet(user: Persona): Set<string> {
  const set = new Set<string>();
  try {
    for (const row of starryBindingRows(user.id)) {
      const email = normalizeEmail(String(row.mailbox_email || ""));
      if (email) set.add(email);
    }
  } catch {
    // 读绑定失败时不扩大范围。
  }
  return set;
}

const emptySender = (): ComposeSender => ({ from: "", send_from: "", brand: "", source: "none", candidates: [] });

export function composeSenderFor(input: {
  collaboration?: Row | null;
  requested?: unknown;
  /** 通讯页选中的邮箱（第 2 档）；不是本人挂载时返回 source=none 且 from 为空 */
  selectedMailbox?: unknown;
  user?: Persona | null;
}): ComposeSender {
  const user = input.user || currentUser();
  const col = input.collaboration || null;
  const brand = String(col?.brand || "").trim();

  // 第 1 档：明确指定。
  const explicit = normalizeEmail(String(input.requested || ""));
  if (explicit) {
    const owned = authorizedSenderBrand(explicit, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "explicit", candidates: [] };
    const resolved = resolveAuthorizedFrom(explicit, user, brand);
    return resolved.matched
      ? { from: resolved.email, send_from: resolved.email, brand: String(resolved.brand || ""), source: "explicit", candidates: [] }
      : { from: explicit, send_from: "", brand: "", source: "explicit", candidates: [] };
  }

  // 第 2 档：通讯页选中的邮箱——必须是本人挂载。
  const selected = normalizeEmail(String(input.selectedMailbox || ""));
  if (selected) {
    if (!mountedMailboxSet(user).has(selected)) return emptySender();
    const owned = authorizedSenderBrand(selected, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "selected", candidates: [] };
    return { from: selected, send_from: "", brand: "", source: "selected", candidates: [] };
  }

  // 第 3 档：本人挂载的默认邮箱。
  const def = defaultBoundMailbox(user);
  if (def) {
    const owned = authorizedSenderBrand(def, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "user_binding", candidates: [] };
  }

  // 挂了多只又没有默认：不取第一只，返回候选让人选。
  const mounted = [...mountedMailboxSet(user)];
  if (mounted.length > 1) {
    return {
      ...emptySender(),
      candidates: mounted.sort().map((email) => ({ email, label: email })),
    };
  }
  // 只挂了一只但上面没过品牌核对（或品牌为空）：沿用它走后面的兜底，而不是静默丢弃。
  const fallbackBound = mounted.length === 1 ? mounted[0] : normalizeEmail(boundMailboxEmail() || "");

  // 第 4 档：合作记录的 mailbox_from。
  const from = fallbackBound || String(col?.mailbox_from || "").trim();
  const resolved = resolveAuthorizedFrom(from, user, brand);
  const brandAllowed = resolved.allowed.filter((row) => row.brand === brand);
  if (resolved.matched) {
    return { from: resolved.email, send_from: resolved.email, brand: String(resolved.brand || ""), source: "collaboration", candidates: [] };
  }
  // 第 5 档：品牌唯一授权箱。
  if (brandAllowed.length === 1) {
    return { from: brandAllowed[0].email, send_from: brandAllowed[0].email, brand: brandAllowed[0].brand, source: "brand_unique", candidates: [] };
  }
  return emptySender();
}
