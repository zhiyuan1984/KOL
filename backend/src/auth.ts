import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { audit, getConn, nowIso, tx } from "./db.js";
import { examPassed, examTodoCount } from "./exam.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import type { Json, Row } from "./types.js";
import { DEMO_ADMIN, DEMO_USER, PERSONAS } from "./config.js";
import { getPersonaKey, personaAccess } from "./host/persona-key.js";
import { isDemoAdminIdentifier, looksLikePhone, normalizeAccount, normalizeEmail, normalizePhone } from "./host/identity.js";

export { normalizeAccount } from "./host/identity.js";

const scrypt = promisify(scryptCallback);
const COOKIE = "lingong_session";
const SESSION_DAYS = 14;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export type AppUser = {
  id: string;
  username: string;
  name: string;
  handle: string;
  email?: string;
  phone?: string;
  roles: string[];
  role: string;
  brands: string[];
  site: string;
  manager_user_id: string | null;
  active: boolean;
  exam_passed: boolean;
  exam_todo_count: number;
  exam_module: string;
};

const requestUser = new AsyncLocalStorage<AppUser>();

export function authDisabled(): boolean {
  if (process.env.AUTH_MODE === "enabled") return false;
  if ((process.env.CODEX_MODE || "").toLowerCase() === "stub") return true;
  if (process.env.AUTH_MODE === "disabled") return true;
  return process.env.NODE_ENV === "test";
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function mapUser(row: Row): AppUser {
  const roles = jsonArray(row.roles);
  const username = String(row.username);
  const email = String(row.email || (username.includes("@") ? username : "") || "");
  const todo = examTodoCount(String(row.id));
  return {
    id: String(row.id),
    username,
    name: String(row.name),
    handle: username,
    email,
    phone: String(row.phone || ""),
    roles,
    role: roles.includes("admin") ? "admin" : roles[0] || "employee",
    brands: jsonArray(row.brands),
    site: String(row.site || ""),
    manager_user_id: row.manager_user_id ? String(row.manager_user_id) : null,
    active: Boolean(row.active),
    exam_passed: examPassed(String(row.id)),
    exam_todo_count: todo,
    exam_module: "数据安全与最小权限",
  };
}

export function scopedUser(): AppUser | undefined {
  return requestUser.getStore();
}

export function isAdmin(user = scopedUser()): boolean {
  return Boolean(user?.roles.includes("admin"));
}

export function requireAdmin(): AppUser {
  if (authDisabled()) {
    return {
      id: DEMO_USER.id,
      username: DEMO_USER.handle,
      name: DEMO_USER.name,
      handle: DEMO_USER.handle,
      email: DEMO_ADMIN.email,
      phone: DEMO_ADMIN.phone,
      roles: ["employee", "admin"],
      role: "admin",
      brands: [...DEMO_USER.brands],
      site: DEMO_USER.site,
      manager_user_id: null,
      active: true,
      exam_passed: examPassed(DEMO_USER.id),
      exam_todo_count: examTodoCount(DEMO_USER.id),
      exam_module: DEMO_USER.exam_module,
    };
  }
  const user = scopedUser();
  if (!user || !isAdmin(user)) throw new HttpFail(403, "admin required");
  return user;
}

function hashPasswordSync(password: string): string {
  if (password.length < 9) throw new HttpFail(400, "password must be at least 9 characters");
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function hashPassword(password: string): Promise<string> {
  return hashPasswordSync(password);
}

export function findUserForLogin(raw: string): Row | undefined {
  const ident = String(raw || "").trim();
  if (!ident) return undefined;
  normalizeAccount(ident);
  const db = getConn();
  const email = ident.includes("@") ? normalizeEmail(ident) : "";
  if (isDemoAdminIdentifier(ident)) {
    const admin = db.prepare(
      `SELECT * FROM users WHERE active = 1 AND (
         username = ? OR lower(coalesce(email,'')) = ? OR name = ?
       ) ORDER BY CASE username WHEN ? THEN 0 ELSE 1 END LIMIT 1`,
    ).get(DEMO_ADMIN.handle, normalizeEmail(DEMO_ADMIN.email), DEMO_ADMIN.name, DEMO_ADMIN.handle) as Row | undefined;
    if (admin) return admin;
  }
  const lowered = email || ident.toLowerCase();
  const byUsername = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(lowered) as Row | undefined;
  if (byUsername) return byUsername;
  if (email) {
    const byEmail = db.prepare("SELECT * FROM users WHERE lower(coalesce(email,'')) = ? AND active = 1").get(email) as Row | undefined;
    if (byEmail) return byEmail;
  }
  if (looksLikePhone(ident)) {
    const phone = normalizePhone(ident);
    const rows = db.prepare("SELECT * FROM users WHERE phone IS NOT NULL AND trim(phone) != '' AND active = 1").all() as Row[];
    return rows.find((row) => normalizePhone(String(row.phone || "")) === phone);
  }
  return undefined;
}

function seedDemoAdminContact(db: ReturnType<typeof getConn>, userId: string): void {
  const now = nowIso();
  db.prepare("UPDATE users SET email=?, updated_at=? WHERE id=?").run(DEMO_ADMIN.email, now, userId);
  if (DEMO_ADMIN.phone) {
    db.prepare("UPDATE users SET phone=?, updated_at=? WHERE id=?").run(DEMO_ADMIN.phone, now, userId);
  }
}

/** Server deploy: turn leftover `test` into 鄢棽 / 123456789. Skip in automated tests. */
export function ensureDemoAdmin(): void {
  if (process.env.NODE_ENV === "test") return;
  if ((process.env.CODEX_MODE || "").toLowerCase() === "stub" && process.env.AUTH_MODE !== "enabled") return;
  const db = getConn();
  const hash = hashPasswordSync(DEMO_ADMIN.password);
  const now = nowIso();
  const test = db.prepare("SELECT id FROM users WHERE username = ?").get("test") as { id: string } | undefined;
  if (test) {
    db.prepare("UPDATE users SET username=?, name=?, password_hash=?, roles=?, updated_at=? WHERE username=?")
      .run(DEMO_ADMIN.handle, DEMO_ADMIN.name, hash, JSON.stringify(["employee", "admin"]), now, "test");
  }
  const emailUser = db.prepare(
    "SELECT * FROM users WHERE lower(coalesce(email,'')) = ? OR username = ?",
  ).get(normalizeEmail(DEMO_ADMIN.email), DEMO_ADMIN.email) as Row | undefined;
  if (emailUser && String(emailUser.username) !== DEMO_ADMIN.handle) {
    db.prepare("UPDATE users SET username=?, name=?, updated_at=? WHERE id=?")
      .run(DEMO_ADMIN.handle, DEMO_ADMIN.name, now, String(emailUser.id));
  }
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(DEMO_ADMIN.handle) as Row | undefined;
  if (existing) {
    db.prepare("UPDATE users SET name=?, password_hash=?, roles=?, active=1, updated_at=? WHERE username=?")
      .run(DEMO_ADMIN.name, hash, JSON.stringify(["employee", "admin"]), now, DEMO_ADMIN.handle);
    seedDemoAdminContact(db, String(existing.id));
    return;
  }
  db.prepare(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    DEMO_USER.id,
    DEMO_ADMIN.handle,
    DEMO_ADMIN.name,
    hash,
    JSON.stringify(["employee", "admin"]),
    JSON.stringify(DEMO_USER.brands),
    DEMO_USER.site,
    1,
    now,
    now,
  );
  seedDemoAdminContact(db, DEMO_USER.id);
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt64, key64] = stored.split("$");
  if (scheme !== "scrypt" || !salt64 || !key64) return false;
  const expected = Buffer.from(key64, "base64");
  const actual = (await scrypt(password, Buffer.from(salt64, "base64"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookies(c: Context): Record<string, string> {
  return Object.fromEntries(
    (c.req.header("cookie") || "").split(";").flatMap((part) => {
      const at = part.indexOf("=");
      return at < 0 ? [] : [[part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim())]];
    }),
  );
}

function setSessionCookie(c: Context, token: string, maxAge: number): void {
  const secure = process.env.NODE_ENV === "production" || String(process.env.APP_ORIGIN || "").startsWith("https://")
    ? "; Secure"
    : "";
  c.header(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function sessionUser(c: Context): AppUser | undefined {
  const token = cookies(c)[COOKIE];
  if (!token) return undefined;
  const row = getConn().prepare(
    `SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ? AND u.active = 1`,
  ).get(hashToken(token), nowIso()) as Row | undefined;
  return row ? mapUser(row) : undefined;
}

function publicPath(path: string): boolean {
  return path === "/api/health" ||
    path === "/api/auth/status" ||
    path === "/api/auth/setup" ||
    path === "/api/auth/login" ||
    path === "/api/login" ||
    path === "/api/logout" ||
    path === "/api/privacy/cookies" ||
    path === "/api/integrations/mediacrawler/creators" ||
    path === "/api/cron/internal/tick" ||
    path.startsWith("/api/shared/");
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (authDisabled()) return next();
  if (c.req.method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  const expectedOrigin = process.env.APP_ORIGIN || process.env.CORS_ORIGIN;
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && origin) {
    const requestOrigin = new URL(c.req.url).origin;
    if (origin !== (expectedOrigin || requestOrigin)) throw new HttpFail(403, "cross-origin mutation rejected");
  }
  const user = sessionUser(c);
  if (!user && !publicPath(new URL(c.req.url).pathname)) throw new HttpFail(401, "authentication required");
  return user ? requestUser.run(user, next) : next();
};

function userPublic(user: AppUser): Json {
  const bind = getConn().prepare("SELECT mailbox_email,mailbox_id,owner_name,status,bearer_token,updated_at FROM user_starry_bindings WHERE user_id=?").get(user.id) as Row | undefined;
  return {
    ...user,
    email: user.email || (user.username.includes("@") ? user.username : ""),
    phone: user.phone || "",
    available_modes: ["employee", ...(isAdmin(user) ? ["admin"] : [])],
    starry_binding: bind && String(bind.mailbox_email || "").trim()
      ? {
        bound: true,
        mailbox_email: String(bind.mailbox_email || ""),
        mailbox_id: String(bind.mailbox_id || ""),
        owner_name: String(bind.owner_name || ""),
        status: String(bind.status || "connected"),
        has_token: Boolean(String(bind.bearer_token || "").trim()),
        updated_at: bind.updated_at ? String(bind.updated_at) : null,
      }
      : { bound: false, mailbox_email: "", mailbox_id: "", owner_name: "", status: "unbound", has_token: false, updated_at: null },
  };
}

function permissions(user: AppUser): Json {
  const db = getConn();
  if (isAdmin(user)) return { admin: true, skills: ["*"], connectors: { "*": "admin" }, approval_roles: ["*"] };
  const skills = (db.prepare("SELECT skill_id FROM user_skill_grants WHERE user_id = ?").all(user.id) as Row[])
    .map((r) => String(r.skill_id));
  const connectors = Object.fromEntries(
    (db.prepare("SELECT connector_id, access FROM user_connector_grants WHERE user_id = ?").all(user.id) as Row[])
      .map((r) => [String(r.connector_id), String(r.access)]),
  );
  const approvalRoles = (
    db.prepare("SELECT approval_role FROM approval_role_bindings WHERE user_id = ?").all(user.id) as Row[]
  ).map((r) => String(r.approval_role));
  return { admin: false, skills, connectors, approval_roles: approvalRoles };
}

function createSession(c: Context, userId: string): void {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  getConn().prepare("INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(hashToken(token), userId, expires, nowIso());
  setSessionCookie(c, token, SESSION_DAYS * 86400);
}

export const authRouter = new Hono();

authRouter.get("/auth/status", (c) => {
  if (authDisabled()) {
    const access = personaAccess();
    const persona = PERSONAS[getPersonaKey()] || PERSONAS.sriphy;
    const demo = {
      ...persona,
      username: persona.handle,
      email: persona.handle === "lingong" ? "" : DEMO_ADMIN.email,
      phone: persona.handle === "lingong" ? "" : DEMO_ADMIN.phone,
      exam_todo_count: examTodoCount(persona.id),
      ...access,
    };
    return c.json({
      setup_required: false,
      authenticated: true,
      user: demo,
      account: demo,
      available_modes: access.available_modes,
      permissions: { demo: true },
    });
  }
  const count = getConn().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  const user = sessionUser(c);
  return c.json({
    setup_required: Number(count.n) === 0,
    authenticated: Boolean(user),
    user: user ? userPublic(user) : null,
    account: user ? userPublic(user) : null,
    available_modes: user ? ["employee", ...(isAdmin(user) ? ["admin"] : [])] : [],
    permissions: user ? permissions(user) : {},
  });
});

authRouter.post("/auth/setup", async (c) => {
  if (authDisabled()) throw new HttpFail(404, "setup unavailable");
  const count = getConn().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (Number(count.n) !== 0) throw new HttpFail(409, "setup already completed");
  const body = (await c.req.json()) as Json;
  const rawIdent = String(body.username || body.email || "");
  const username = normalizeAccount(rawIdent);
  const name = String(body.name || (username === DEMO_ADMIN.handle ? DEMO_ADMIN.name : username)).trim();
  if (!/^[a-z0-9._@-]{3,100}$/.test(username)) throw new HttpFail(400, "invalid username");
  const id = nid("usr");
  const now = nowIso();
  const passwordHash = await hashPassword(String(body.password || ""));
  const email = String(body.email || "").includes("@")
    ? normalizeEmail(String(body.email))
    : rawIdent.includes("@")
      ? normalizeEmail(rawIdent)
      : (username === DEMO_ADMIN.handle ? DEMO_ADMIN.email : "");
  const phone = looksLikePhone(String(body.phone || rawIdent)) ? normalizePhone(String(body.phone || rawIdent)) : "";
  getConn().prepare(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, username, name, passwordHash, JSON.stringify(["employee", "admin"]), JSON.stringify(body.brands || ["LT", "RO", "PQ"]),
    String(body.site || ""), 1, now, now);
  getConn().prepare("UPDATE users SET email=?, phone=?, updated_at=? WHERE id=?").run(email, phone, now, id);
  createSession(c, id);
  audit(id, "admin.setup", { user_id: id });
  const created = userPublic(mapUser(getConn().prepare("SELECT * FROM users WHERE id=?").get(id) as Row));
  return c.json({ ok: true, user: created, account: created }, 201);
});

authRouter.post("/auth/login", async (c) => {
  if (authDisabled()) throw new HttpFail(404, "login unavailable");
  const body = (await c.req.json()) as Json;
  const ident = String(body.username || body.email || body.phone || "");
  const username = normalizeAccount(ident);
  const attemptKey = `${c.req.header("x-forwarded-for") || "local"}:${username}`;
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
    throw new HttpFail(429, "too many login attempts; try again later");
  }
  const row = findUserForLogin(ident);
  if (!row || !(await verifyPassword(String(body.password || ""), String(row.password_hash)))) {
    loginAttempts.set(attemptKey, {
      count: attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1,
      resetAt: Date.now() + 15 * 60_000,
    });
    throw new HttpFail(401, "账号或密码不对");
  }
  loginAttempts.delete(attemptKey);
  createSession(c, String(row.id));
  audit(String(row.id), "auth.login", {});
  const { startFollowedMailSync } = await import("./starrykol/mail-sync.js");
  void startFollowedMailSync(true).catch(() => undefined);
  const loggedIn = userPublic(mapUser(row));
  return c.json({ ok: true, user: loggedIn, account: loggedIn });
});

authRouter.post("/auth/logout", (c) => {
  const token = cookies(c)[COOKIE];
  if (token) getConn().prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(hashToken(token));
  setSessionCookie(c, "", 0);
  return c.json({ ok: true });
});

authRouter.post("/auth/password", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const row = getConn().prepare("SELECT password_hash FROM users WHERE id=?").get(user.id) as Row;
  if (!(await verifyPassword(String(body.current_password || ""), String(row.password_hash)))) {
    throw new HttpFail(403, "current password is incorrect");
  }
  const passwordHash = await hashPassword(String(body.new_password || ""));
  tx((db) => {
    db.prepare("UPDATE users SET password_hash=?, updated_at=? WHERE id=?").run(passwordHash, nowIso(), user.id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(user.id);
  });
  setSessionCookie(c, "", 0);
  audit(user.id, "auth.password_changed", {});
  return c.json({ ok: true, reauthenticate: true });
});

export function requireSkill(skillId: string): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  if (isAdmin(user)) return;
  const grant = getConn().prepare("SELECT 1 FROM user_skill_grants WHERE user_id=? AND skill_id=?")
    .get(user.id, skillId);
  if (!grant) throw new HttpFail(403, { code: "skill_not_granted", skill_id: skillId });
}

export function requireConnector(connectorId: string, access: "read" | "write" | "admin"): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  if (isAdmin(user)) return;
  const connector = getConn().prepare("SELECT enabled FROM connectors WHERE id=?").get(connectorId) as Row | undefined;
  if (!connector || !connector.enabled) throw new HttpFail(403, { code: "connector_disabled", connector_id: connectorId });
  const grant = getConn().prepare("SELECT access FROM user_connector_grants WHERE user_id=? AND connector_id=?")
    .get(user.id, connectorId) as { access: string } | undefined;
  const levels = { read: 1, write: 2, admin: 3 };
  if (!grant || levels[grant.access as keyof typeof levels] < levels[access]) {
    throw new HttpFail(403, { code: "connector_not_granted", connector_id: connectorId, access });
  }
}

/** Official stage write: production grants live on starrykol; legacy `starry` still counts. */
export function requireStageWrite(): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  if (isAdmin(user)) return;
  const levels = { read: 1, write: 2, admin: 3 };
  const granted = (id: string) => {
    const connector = getConn().prepare("SELECT enabled FROM connectors WHERE id=?").get(id) as Row | undefined;
    if (!connector || !connector.enabled) return false;
    const grant = getConn().prepare("SELECT access FROM user_connector_grants WHERE user_id=? AND connector_id=?")
      .get(user.id, id) as { access: string } | undefined;
    return Boolean(grant && levels[grant.access as keyof typeof levels] >= levels.write);
  };
  if (granted("starrykol") || granted("starry")) return;
  throw new HttpFail(403, { code: "connector_not_granted", connector_id: "starrykol", access: "write" });
}

export function approvalRoles(): string[] {
  if (authDisabled()) return [];
  const user = scopedUser();
  if (!user) return [];
  if (isAdmin(user)) return ["*"];
  return (getConn().prepare("SELECT approval_role FROM approval_role_bindings WHERE user_id=?").all(user.id) as Row[])
    .map((r) => String(r.approval_role));
}

export function tokenDigest(token: string): string {
  return hashToken(token);
}
