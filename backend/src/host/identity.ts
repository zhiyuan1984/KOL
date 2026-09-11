import { DEMO_ADMIN } from "../config.js";
import { HttpFail } from "./errors.js";

/** Keep digits; strip +86 / 86 country prefix used in login forms. */
export function normalizePhone(raw: string): string {
  const compact = String(raw || "").trim().replace(/[\s()-]/g, "");
  const digits = compact.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("86") && digits.length === 13) return digits.slice(2);
  return digits;
}

export function looksLikePhone(raw: string): boolean {
  const phone = normalizePhone(raw);
  return phone.length >= 8 && phone.length <= 15 && !String(raw || "").includes("@");
}

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function isDemoAdminIdentifier(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t) return false;
  if (t === DEMO_ADMIN.name) return true;
  if (t.toLowerCase() === DEMO_ADMIN.handle) return true;
  if (DEMO_ADMIN.email && normalizeEmail(t) === normalizeEmail(DEMO_ADMIN.email)) return true;
  if (DEMO_ADMIN.phone && looksLikePhone(t) && normalizePhone(t) === normalizePhone(DEMO_ADMIN.phone)) return true;
  return false;
}

/** Map 鄢棽 / sriphy / sriphy.yan@… / seeded phone to the admin handle; reject leftover test. */
export function normalizeAccount(raw: string): string {
  const t = String(raw || "").trim();
  if (t.toLowerCase() === "test") throw new HttpFail(401, "账号不存在");
  if (isDemoAdminIdentifier(t)) return DEMO_ADMIN.handle;
  if (t.includes("@")) return normalizeEmail(t);
  if (looksLikePhone(t)) return normalizePhone(t);
  return t.toLowerCase();
}

export function mailboxLocalPart(email: string): string {
  return normalizeEmail(email).split("@")[0] || "";
}

export function namesMatch(left: string, right: string): boolean {
  const a = String(left || "").replace(/\s+/g, "").trim();
  const b = String(right || "").replace(/\s+/g, "").trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
