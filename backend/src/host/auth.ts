import { DEMO_ADMIN } from "../config.js";
import { authDisabled, findUserForLogin, isAdmin } from "../auth.js";
import { audit, getConn } from "../db.js";
import { HttpFail } from "./errors.js";
import { isDemoAdminIdentifier } from "./identity.js";

const AUTH_KEY = "auth_handle";

export function login(username: string, password: string): {
  ok: true;
  name: string;
  handle: string;
  role: "product_manager";
} {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (u.toLowerCase() === "test") throw new HttpFail(401, "账号不存在");
  const nameOk = isDemoAdminIdentifier(u) || findUserForLogin(u)?.username === DEMO_ADMIN.handle;
  if (!nameOk || p !== DEMO_ADMIN.password) throw new HttpFail(401, "账号或密码不对");
  getConn().prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(AUTH_KEY, DEMO_ADMIN.handle);
  audit(DEMO_ADMIN.handle, "auth.login", { name: DEMO_ADMIN.name });
  return { ok: true, name: DEMO_ADMIN.name, handle: DEMO_ADMIN.handle, role: DEMO_ADMIN.role };
}

export function logout(): { ok: true } {
  getConn().prepare("DELETE FROM app_state WHERE key = ?").run(AUTH_KEY);
  return { ok: true };
}

export function authHandle(): string | null {
  const row = getConn().prepare("SELECT value FROM app_state WHERE key = ?").get(AUTH_KEY) as { value: string } | undefined;
  return row?.value || null;
}

export function isProductManager(): boolean {
  if (authHandle() === DEMO_ADMIN.handle) return true;
  if (!authDisabled() && isAdmin()) return true;
  return false;
}

export function requirePm(): void {
  if (!isProductManager()) throw new HttpFail(403, "需要产品经理登录");
}
