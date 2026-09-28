/**
 * 写邮件的发件箱默认规则（BIZ-04、backend/skills/email_compose/SKILL.md）：
 * 未指定发件箱时，默认用当前用户挂载的 Starry 邮箱；没有绑定（或品牌范围核对不过）
 * 再退到合作记录的 mailbox_from，再退到当前品牌唯一授权箱，最后留空让人补。
 * 每一步都过品牌与范围核对，任何一步都不得从多个候选里取第一只。
 */
import type { Persona } from "../config.js";
import { getConn } from "../db.js";
import type { Row } from "../types.js";
import { authorizedSenderBrand, resolveAuthorizedFrom } from "./pep.js";
import { currentUser } from "./persona.js";
import { boundMailboxEmail } from "./starry-bind.js";

export type ComposeSenderSource = "explicit" | "user_binding" | "collaboration" | "brand_unique" | "none";

export type ComposeSender = {
  /** 展示与落库用的发件箱：未指定时就是当前用户挂载的邮箱 */
  from: string;
  /** 通过品牌范围核对、可交给网关外发的地址；无授权时为空 */
  send_from: string;
  brand: string;
  source: ComposeSenderSource;
};

export function collaborationBrand(collaborationId?: string | null): string {
  const id = String(collaborationId || "").trim();
  if (!id) return "";
  const row = getConn().prepare("SELECT brand FROM collaborations WHERE id=?").get(id) as Row | undefined;
  return String(row?.brand || "").trim();
}

export function composeSenderFor(input: {
  collaboration?: Row | null;
  requested?: unknown;
  user?: Persona | null;
}): ComposeSender {
  const user = input.user || currentUser();
  const col = input.collaboration || null;
  const brand = String(col?.brand || "").trim();
  const explicit = String(input.requested || "").trim();
  if (explicit) {
    const owned = authorizedSenderBrand(explicit, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "explicit" };
    const resolved = resolveAuthorizedFrom(explicit, user, brand);
    return resolved.matched
      ? { from: resolved.email, send_from: resolved.email, brand: String(resolved.brand || ""), source: "explicit" }
      : { from: explicit, send_from: "", brand: "", source: "explicit" };
  }
  const bound = boundMailboxEmail();
  if (bound) {
    const owned = authorizedSenderBrand(bound, user, brand);
    if (owned) return { from: owned.email, send_from: owned.email, brand: owned.brand, source: "user_binding" };
  }
  const from = bound || String(col?.mailbox_from || "").trim();
  const resolved = resolveAuthorizedFrom(from, user, brand);
  const brandAllowed = resolved.allowed.filter((row) => row.brand === brand);
  if (resolved.matched) {
    return { from: resolved.email, send_from: resolved.email, brand: String(resolved.brand || ""), source: "collaboration" };
  }
  if (brandAllowed.length === 1) {
    return { from: brandAllowed[0].email, send_from: brandAllowed[0].email, brand: brandAllowed[0].brand, source: "brand_unique" };
  }
  return { from: "", send_from: "", brand: "", source: "none" };
}
