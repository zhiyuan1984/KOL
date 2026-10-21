import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { nowIso } from "./db.js";
import { pgApprovalRoles, pgAudit, pgAvatarUrlForUser, pgConnectorAccess, pgConnectorPermissions, pgCreateSession, pgCreateUser, pgDefaultBinding, pgDeleteSession, pgFindUserForLogin, pgUserCanUseSkill, pgUserCount, pgVisibleSkillIdsForUser } from "./postgres/auth-pg.js";
import { pgUpdatePasswordAndRevokeSessions } from "./postgres/organization-repository.js";
import { postgresQuery } from "./postgres/pool.js";
import { examPassed, examTodoCount } from "./exam.js";
import { HttpFail } from "./host/errors.js";
import { ensureOrganizationTree } from "./runtime/organization-tree.js";
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
  /** Request-scoped native authority snapshot. Never serialize these fields. */
  authority_skills?: string[];
  authority_connectors?: Record<string, string>;
  authority_approval_roles?: string[];
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

export async function mapUser(row: Row): Promise<AppUser> {
  const roles = jsonArray(row.roles);
  const username = String(row.username);
  const email = String(row.email || (username.includes("@") ? username : "") || "");
  const todo = await examTodoCount(String(row.id));
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
    exam_passed: await examPassed(String(row.id)),
    exam_todo_count: todo,
    exam_module: "数据安全与最小权限",
  };
}

export function scopedUser(): AppUser | undefined {
  return requestUser.getStore();
}

/** Run an already authorized background job under its current, active owner. */
export function withScopedUser<T>(user: AppUser, action: () => T): T {
  return requestUser.run(user, action);
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
      exam_passed: scopedUser()?.exam_passed ?? DEMO_USER.exam_passed,
      exam_todo_count: scopedUser()?.exam_todo_count ?? DEMO_USER.exam_todo_count ?? 0,
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

/** Native login lookup; no SQLite or synchronous fallback. */
export async function findUserForLogin(raw: string): Promise<Row | undefined> {
  return pgFindUserForLogin(raw);
}

/** Demo-account rewriting was already disabled on PostgreSQL. Kept as a no-op
 * for historical callers; account bootstrap remains explicit /auth/setup. */
export function ensureDemoAdmin(): void {}

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

async function hydrateNativeAuthority(user: AppUser): Promise<AppUser> {
  // Authority snapshots are derived only after the migrated organization facts exist.
  await ensureOrganizationTree();
  const now = nowIso();
  const [authority_skills, authority_connectors, authority_approval_roles] = await Promise.all([
    (await pgVisibleSkillIdsForUser(user.id, now)),
    (await pgConnectorPermissions(user.id)),
    (await pgApprovalRoles(user.id, now)),
  ]);
  return { ...user, authority_skills, authority_connectors, authority_approval_roles };
}

async function sessionUser(c: Context): Promise<AppUser | undefined> {
  const token = cookies(c)[COOKIE];
  if (!token) return undefined;
  const [row] = await postgresQuery<Row>(
    `SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > $2 AND u.active = 1`,
    [hashToken(token), nowIso()],
  );
  return row ? (hydrateNativeAuthority((await mapUser(row)))) : undefined;
}

/**
 * Authenticates the same current PostgreSQL workbench session without invoking
 * authority hydration.  It is for explicitly read-only request paths whose
 * browser visit must not bootstrap organization/runtime state or persist an
 * auxiliary ticket-principal mirror.
 */
async function readOnlySessionUser(c: Context): Promise<AppUser | undefined> {
  const token = cookies(c)[COOKIE];
  if (!token) return undefined;
  const [row] = await postgresQuery<Row>(
    `SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = $1 AND s.expires_at > $2 AND u.active = 1`,
    [hashToken(token), nowIso()],
  );
  return row ? mapUser(row) : undefined;
}

function publicPath(path: string): boolean {
  return path === "/api/health" ||
    path === "/api/version" ||
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
  const user = await sessionUser(c);
  if (!user && !publicPath(new URL(c.req.url).pathname)) throw new HttpFail(401, "authentication required");
  return user ? (requestUser.run(user, next)) : (next());
};

/** Same cookie/session rules as authMiddleware, intentionally without writes or bootstrap work. */
export const readOnlyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (authDisabled()) return next();
  if (c.req.method === "OPTIONS") return next();
  const user = await readOnlySessionUser(c);
  if (!user && !publicPath(new URL(c.req.url).pathname)) throw new HttpFail(401, "authentication required");
  return user ? requestUser.run(user, next) : next();
};

async function userPublic(user: AppUser): Promise<Json> {
  const [bind, avatar_url] = await Promise.all([(await pgDefaultBinding(user.id)), (await pgAvatarUrlForUser(user.id))]);
  const { authority_skills: _skills, authority_connectors: _connectors, authority_approval_roles: _approvalRoles, ...publicUser } = user;
  return {
    ...publicUser,
    avatar_url,
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

async function permissions(user: AppUser): Promise<Json> {
  const admin = isAdmin(user);
  const now = nowIso();
  const [skills, connectors, approvalRoles] = await Promise.all([
    user.authority_skills ? (await Promise.resolve(user.authority_skills)) : (await pgVisibleSkillIdsForUser(user.id, now)),
    user.authority_connectors ? (await Promise.resolve(user.authority_connectors)) : (await pgConnectorPermissions(user.id)),
    user.authority_approval_roles ? (await Promise.resolve(user.authority_approval_roles)) : (await pgApprovalRoles(user.id, now)),
  ]);
  return { admin, skills, connectors, approval_roles: admin ? ["*"] : approvalRoles };
}

async function createSession(c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await pgCreateSession(hashToken(token), userId, expires, nowIso());
  setSessionCookie(c, token, SESSION_DAYS * 86400);
}

export const authRouter = new Hono();

authRouter.get("/auth/status", async (c) => {
  if (authDisabled()) {
    const access = (await personaAccess());
    const persona = PERSONAS[(await getPersonaKey())] || PERSONAS.sriphy;
    const demo = {
      ...persona,
      username: persona.handle,
      email: persona.handle === "lingong" ? "" : DEMO_ADMIN.email,
      phone: persona.handle === "lingong" ? "" : DEMO_ADMIN.phone,
      exam_todo_count: await examTodoCount(persona.id),
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
  const count = await pgUserCount();
  const user = await sessionUser(c);
  return c.json({
    setup_required: Number(count) === 0,
    authenticated: Boolean(user),
    user: user ? await userPublic(user) : null,
    account: user ? await userPublic(user) : null,
    available_modes: user ? ["employee", ...(isAdmin(user) ? ["admin"] : [])] : [],
    permissions: user ? await permissions(user) : {},
  });
});

authRouter.post("/auth/setup", async (c) => {
  if (authDisabled()) throw new HttpFail(404, "setup unavailable");
  const count = await pgUserCount();
  if (Number(count) !== 0) throw new HttpFail(409, "setup already completed");
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
  const createdRow = await pgCreateUser({ id, username, name, passwordHash, brands: (body.brands || ["LT", "RO", "PQ"]) as Json, site: String(body.site || ""), email, phone, now });
  await createSession(c, id);
  await pgAudit(id, "admin.setup", { user_id: id }, now);
  const created = await userPublic(await hydrateNativeAuthority((await mapUser(createdRow))));
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
  const row = await findUserForLogin(ident);
  if (!row || !(await verifyPassword(String(body.password || ""), String(row.password_hash)))) {
    loginAttempts.set(attemptKey, {
      count: attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1,
      resetAt: Date.now() + 15 * 60_000,
    });
    throw new HttpFail(401, "账号或密码不对");
  }
  loginAttempts.delete(attemptKey);
  await createSession(c, String(row.id));
  await pgAudit(String(row.id), "auth.login", {}, nowIso());
  const { startFollowedMailSync } = await import("./starrykol/mail-sync.js");
  void startFollowedMailSync(true).catch(() => undefined);
  const loggedIn = await userPublic(await hydrateNativeAuthority((await mapUser(row))));
  return c.json({ ok: true, user: loggedIn, account: loggedIn });
});

authRouter.post("/auth/logout", async (c) => {
  const token = cookies(c)[COOKIE];
  if (token) {
    await pgDeleteSession(hashToken(token));
  }
  setSessionCookie(c, "", 0);
  return c.json({ ok: true });
});

authRouter.post("/auth/password", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const [row] = await postgresQuery<Row>("SELECT password_hash FROM users WHERE id=$1", [user.id]);
  if (!row || !(await verifyPassword(String(body.current_password || ""), String(row.password_hash)))) {
    throw new HttpFail(403, "current password is incorrect");
  }
  const passwordHash = await hashPassword(String(body.new_password || ""));
  await pgUpdatePasswordAndRevokeSessions(user.id, passwordHash, nowIso());
  setSessionCookie(c, "", 0);
  await pgAudit(user.id, "auth.password_changed", {}, nowIso());
  return c.json({ ok: true, reauthenticate: true });
});

export function requireSkill(skillId: string): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  // Middleware loads this directly from PostgreSQL for each request. A missing
  // snapshot (e.g. a background invocation) is deliberately denied, never
  // recovered through retired user_skill_grants or the synchronous bridge.
  if (!user.authority_skills?.includes(skillId)) throw new HttpFail(403, { code: "agent_not_usable", skill_id: skillId });
}

export function requireConnector(connectorId: string, access: "read" | "write" | "admin"): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const grant = user.authority_connectors?.[connectorId];
  const levels = { read: 1, write: 2, admin: 3 };
  if (!grant) throw new HttpFail(403, { code: "connector_not_granted", connector_id: connectorId, access });
  if (levels[grant as keyof typeof levels] < levels[access]) {
    throw new HttpFail(403, { code: "connector_not_granted", connector_id: connectorId, access });
  }
}

/** Official stage write: production grants live on starrykol; legacy `starry` still counts. */
export function requireStageWrite(): void {
  if (authDisabled()) return;
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const levels = { read: 1, write: 2, admin: 3 };
  const grants = user.authority_connectors || {};
  if ((["starrykol", "starry"] as const).some((id) => levels[(grants[id] || "") as keyof typeof levels] >= levels.write)) return;
  throw new HttpFail(403, { code: "connector_not_granted", connector_id: "starrykol", access: "write" });
}

export function approvalRoles(): string[] {
  if (authDisabled()) return [];
  const user = scopedUser();
  if (!user) return [];
  if (isAdmin(user)) return ["*"];
  return user.authority_approval_roles || [];
}

export function tokenDigest(token: string): string {
  return hashToken(token);
}
