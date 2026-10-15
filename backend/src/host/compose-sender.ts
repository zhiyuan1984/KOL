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
import { remoteWriteDecision, sameBrand } from "../brand-binding-policy.js";

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

export async function collaborationBrand(collaborationId?: string | null): Promise<Awaited<string>> {
  const id = String(collaborationId || "").trim();
  if (!id) return "";
  const row = (await getConn().query("SELECT brand FROM collaborations WHERE id=$1",[id])).rows[0] as Row | undefined;
  return String(row?.brand || "").trim();
}

/** 本人挂载的默认邮箱：is_default=1 的那只；没有默认返回空（不取第一只）。 */
async function defaultBoundMailbox(user: Persona): Promise<string> {
  try {
    const rows = (await starryBindingRows(user.id));
    const def = rows.find((row) => Number(row.is_default || 0) === 1);
    return normalizeEmail(String(def?.mailbox_email || ""));
  } catch {
    return "";
  }
}

/** 本人挂载的全部邮箱（小写归一），给「通讯页选中」做归属校验。 */
async function mountedMailboxSet(user: Persona): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    for (const row of (await starryBindingRows(user.id))) {
      const email = normalizeEmail(String(row.mailbox_email || ""));
      if (email) set.add(email);
    }
  } catch {
    // 读绑定失败时不扩大范围。
  }
  return set;
}

const emptySender = (): ComposeSender => ({ from: "", send_from: "", brand: "", source: "none", candidates: [] });

/**
 * A connected mailbox binding is the identity fact for a personal mailbox. This
 * fallback applies only when no collaboration supplies a server-side brand: an
 * absent mailbox_owners row means the mailbox is unbranded, never that its
 * domain or address can be used to infer a brand.
 */
async function verifiedUnbrandedPersonalBinding(email: string, user: Persona): Promise<{ email: string; brand: string; source: "user_binding" } | null> {
  const normalized = normalizeEmail(email);
  if (!normalized || !user.id) return null;
  try {
    const binding = (await starryBindingRows(user.id)).find((row) => {
      return normalizeEmail(String(row.mailbox_email || "")) === normalized
        && String(row.status || "").trim() === "connected";
    });
    if (!binding) return null;
    const owner = (await getConn().query("SELECT email FROM mailbox_owners WHERE lower(email)=lower($1)", [normalized])).rows[0] as Row | undefined;
    if (owner) return null;
    return { email: normalizeEmail(String(binding.mailbox_email || "")), brand: "", source: "user_binding" };
  } catch {
    // A failed binding/owner read cannot create a sender authorization.
    return null;
  }
}

/** Compose is only an early hint; PEP repeats this at the Gateway write boundary. */
async function usableSender(email: string, user: Persona, collaborationBrand: string) {
  const policy = remoteWriteDecision(collaborationBrand);
  if (!policy.write_allowed) return null;
  const owned = await authorizedSenderBrand(email, user, collaborationBrand);
  if (owned) {
    if (collaborationBrand && !sameBrand(owned.brand, collaborationBrand)) return null;
    return owned;
  }
  // With a collaboration, authorizedSenderBrand already checked the authoritative
  // brand and the user's scope. Never fall back from it to an unbranded mailbox.
  if (collaborationBrand) return null;
  return verifiedUnbrandedPersonalBinding(email, user);
}

export async function composeSenderFor(input: {
  collaboration?: Row | null;
  requested?: unknown;
  /** 通讯页选中的邮箱（第 2 档）；不是本人挂载时返回 source=none 且 from 为空 */
  selectedMailbox?: unknown;
  user?: Persona | null;
}): Promise<ComposeSender> {
  const user = input.user || (await currentUser());
  const col = input.collaboration || null;
  const brand = String(col?.brand || "").trim();

  // 第 1 档：明确指定。
  const explicit = normalizeEmail(String(input.requested || ""));
  if (explicit) {
    const owned = (await usableSender(explicit, user, brand));
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "explicit", candidates: [] };
    const resolved = (await resolveAuthorizedFrom(explicit, user, brand));
    const resolvedOwned = resolved.matched ? (await usableSender(resolved.email, user, brand)) : null;
    return resolvedOwned
      ? { from: resolvedOwned.email, send_from: resolvedOwned.email, brand: resolvedOwned.brand, source: "explicit", candidates: [] }
      : { from: explicit, send_from: "", brand: "", source: "explicit", candidates: [] };
  }

  // 第 2 档：通讯页选中的邮箱——必须是本人挂载。
  const selected = normalizeEmail(String(input.selectedMailbox || ""));
  if (selected) {
    if (!(await mountedMailboxSet(user)).has(selected)) return emptySender();
    const owned = (await usableSender(selected, user, brand));
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "selected", candidates: [] };
    return { from: selected, send_from: "", brand: "", source: "selected", candidates: [] };
  }

  // 第 3 档：本人挂载的默认邮箱。绑定仍需匹配当前合作品牌；不能把唯一的
  // LT/RO/PQ 邮箱静默预填给另一品牌合作。最终写入仍由 Gateway 重新检查。
  const def = (await defaultBoundMailbox(user));
  if (def) {
    const owned = await usableSender(def, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "user_binding", candidates: [] };
  }

  // 挂了多只又没有默认：不取第一只，返回候选让人选。
  const mounted = [...(await mountedMailboxSet(user))];
  if (mounted.length > 1) {
    return {
      ...emptySender(),
      candidates: mounted.sort().map((email) => ({ email, label: email })),
    };
  }
  // 只挂了一只也不因“唯一”推断跨品牌发送授权。
  if (mounted.length === 1) {
    const owned = await usableSender(mounted[0], user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "user_binding", candidates: [] };
  }
  // 兜底：legacy 单绑定。
  const legacy = normalizeEmail((await boundMailboxEmail()) || "");
  if (legacy) {
    const owned = await usableSender(legacy, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "user_binding", candidates: [] };
  }

  // 第 4 档：合作记录的 mailbox_from。
  const from = String(col?.mailbox_from || "").trim();
  const resolved = (await resolveAuthorizedFrom(from, user, brand));
  const brandAllowed = resolved.allowed.filter((row) => row.brand === brand);
  if (resolved.matched) {
    const owned = await usableSender(resolved.email, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "collaboration", candidates: [] };
  }
  // 第 5 档：品牌唯一授权箱。
  if (brandAllowed.length === 1) {
    const owned = await usableSender(brandAllowed[0].email, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "brand_unique", candidates: [] };
  }
  return emptySender();
}
