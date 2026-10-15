import { postgresConnection } from "../postgres/pool.js";
import { DEMO_ADMIN } from "../config.js";
import { authDisabled, findUserForLogin, isAdmin } from "../auth.js";
import { audit } from "../db.js";
import { postgresPool } from "../postgres/pool.js";
import { HttpFail } from "./errors.js";
import { isDemoAdminIdentifier } from "./identity.js";

const AUTH_KEY = "auth_handle";

export async function login(username: string, password: string): Promise<{
  ok: true;
  name: string;
  handle: string;
  role: "product_manager";
}> {
  const u = String(username || "").trim();
  const p = String(password || "");
  if (u.toLowerCase() === "test") throw new HttpFail(401, "账号不存在");
  const nameOk = isDemoAdminIdentifier(u) || (await findUserForLogin(u))?.username === DEMO_ADMIN.handle;
  if (!nameOk || p !== DEMO_ADMIN.password) throw new HttpFail(401, "账号或密码不对");
  await postgresConnection().query(
    "INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [AUTH_KEY, DEMO_ADMIN.handle],
  );
  (await audit(DEMO_ADMIN.handle, "auth.login", { name: DEMO_ADMIN.name }));
  return { ok: true, name: DEMO_ADMIN.name, handle: DEMO_ADMIN.handle, role: DEMO_ADMIN.role };
}

export async function logout(): Promise<{ ok: true }> {
  await postgresConnection().query("DELETE FROM app_state WHERE key = $1", [AUTH_KEY]);
  return { ok: true };
}

export async function authHandle(): Promise<string | null> {
  const { rows } = await postgresConnection().query<{ value: string }>("SELECT value FROM app_state WHERE key = $1", [AUTH_KEY]);
  return rows[0]?.value || null;
}

export async function isProductManager(): Promise<boolean> {
  if ((await authHandle()) === DEMO_ADMIN.handle) return true;
  if (!authDisabled() && isAdmin()) return true;
  return false;
}

export async function requirePm(): Promise<void> {
  if (!(await isProductManager())) throw new HttpFail(403, "需要产品经理登录");
}
