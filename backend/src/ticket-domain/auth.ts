import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, scrypt as scryptCallback, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";

const scrypt = promisify(scryptCallback);
const COOKIE = "kol_ticket_session";
const SESSION_DAYS = 14;
const requestPrincipal = new AsyncLocalStorage<TicketPrincipal>();

type AccountRow = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roles: unknown;
  active: boolean;
};

export type TicketPrincipal = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roles: string[];
  active: boolean;
};

function roles(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function principal(row: AccountRow): TicketPrincipal {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    roles: roles(row.roles),
    active: Boolean(row.active),
  };
}

export function ticketAuthDisabled(): boolean {
  if (process.env.TICKET_AUTH_MODE === "enabled") return false;
  if (process.env.TICKET_AUTH_MODE === "disabled") return true;
  return process.env.NODE_ENV === "test";
}

export function ticketPrincipal(): TicketPrincipal | undefined {
  return requestPrincipal.getStore();
}

export function withTicketPrincipal<T>(actor: TicketPrincipal, action: () => T): T {
  return requestPrincipal.run(actor, action);
}

export function ticketIsAdmin(actor = ticketPrincipal()): boolean {
  return Boolean(actor?.roles.includes("admin"));
}

export function requireTicketPrincipal(): TicketPrincipal {
  const actor = ticketPrincipal();
  if (!actor) throw new HttpFail(401, "ticket authentication required");
  if (!actor.active) throw new HttpFail(403, "ticket account inactive");
  return actor;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(c: Context, key: string): string | null {
  for (const part of (c.req.header("cookie") || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === key) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setSessionCookie(c: Context, token: string, maxAgeSeconds: number): void {
  const secure = process.env.NODE_ENV === "production" || String(process.env.APP_ORIGIN || "").startsWith("https://") ? "; Secure" : "";
  c.header("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}

async function sessionPrincipal(c: Context): Promise<TicketPrincipal | null> {
  const token = cookieValue(c, COOKIE);
  if (!token) return null;
  const result = await postgresPool().query<AccountRow>(
    `SELECT a.id,a.username,a.name,a.email,a.roles,a.active
       FROM ticket_auth_sessions s JOIN ticket_accounts a ON a.id=s.account_id
      WHERE s.token_digest=$1 AND s.expires_at > now() AND a.active=true`,
    [tokenDigest(token)],
  );
  return result.rows[0] ? principal(result.rows[0]) : null;
}

async function configuredDevelopmentPrincipal(): Promise<TicketPrincipal> {
  const accountId = String(process.env.TICKET_DEMO_USER_ID || "").trim();
  if (!accountId) {
    throw new HttpFail(503, { code: "ticket_demo_identity_required", message: "禁用认证时必须配置 TICKET_DEMO_USER_ID，且该账号必须存在于 PostgreSQL" });
  }
  const result = await postgresPool().query<AccountRow>(
    "SELECT id,username,name,email,roles,active FROM ticket_accounts WHERE id=$1 AND active=true",
    [accountId],
  );
  if (!result.rows[0]) throw new HttpFail(503, { code: "ticket_demo_identity_invalid" });
  return principal(result.rows[0]);
}

function isPublicTicketAuthPath(pathname: string): boolean {
  return pathname === "/api/ticket-auth/status" || pathname === "/api/ticket-auth/setup" || pathname === "/api/ticket-auth/login";
}

/** Middleware for formal ticket routes only. It does not import the historical
 * app authentication module, SQLite connection, or sync bridge. */
export const ticketAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  const expectedOrigin = process.env.APP_ORIGIN || process.env.CORS_ORIGIN;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && origin) {
    const requestOrigin = new URL(c.req.url).origin;
    if (origin !== (expectedOrigin || requestOrigin)) throw new HttpFail(403, "cross-origin mutation rejected");
  }
  const pathname = new URL(c.req.url).pathname;
  if (isPublicTicketAuthPath(pathname)) return next();
  const actor = ticketAuthDisabled() ? await configuredDevelopmentPrincipal() : await sessionPrincipal(c);
  if (!actor) throw new HttpFail(401, "ticket authentication required");
  return requestPrincipal.run(actor, next);
};

function normalizedUsername(value: unknown): string {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,100}$/.test(username)) throw new HttpFail(400, "invalid username");
  return username;
}

function passwordHash(password: string): string {
  if (password.length < 9) throw new HttpFail(400, "password must be at least 9 characters");
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt64, key64] = stored.split("$");
  if (scheme !== "scrypt" || !salt64 || !key64) return false;
  const expected = Buffer.from(key64, "base64");
  const actual = await scrypt(password, Buffer.from(salt64, "base64"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function createSession(c: Context, accountId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await postgresPool().query(
    `INSERT INTO ticket_auth_sessions (token_digest,account_id,expires_at,created_at)
     VALUES ($1,$2,$3,now())`,
    [tokenDigest(token), accountId, expires],
  );
  setSessionCookie(c, token, SESSION_DAYS * 86_400);
}

function publicAccount(actor: TicketPrincipal) {
  return {
    id: actor.id,
    username: actor.username,
    name: actor.name,
    email: actor.email || "",
    roles: actor.roles,
    role: actor.roles.includes("admin") ? "admin" : actor.roles[0] || "employee",
    active: actor.active,
  };
}

/** Dedicated PostgreSQL identity endpoints for the formal ticket system. The
 * initial setup creates one explicit administrator; later accounts must be
 * enrolled through governed organization/account management, not auto-seeded. */
export const ticketAuthRouter = new Hono();

ticketAuthRouter.onError((error, c) => {
  if (error instanceof HttpFail) {
    return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 409 | 422 | 500 | 503);
  }
  console.error(error);
  return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
});

ticketAuthRouter.get("/ticket-auth/status", async (c) => {
  const count = await postgresPool().query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ticket_accounts");
  const actor = ticketAuthDisabled() ? null : await sessionPrincipal(c);
  return c.json({
    authentication_domain: "postgresql_ticket_identity.v1",
    setup_required: Number(count.rows[0]?.count || 0) === 0,
    authenticated: Boolean(actor),
    account: actor ? publicAccount(actor) : null,
  });
});

ticketAuthRouter.post("/ticket-auth/setup", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const username = normalizedUsername(body.username || body.email);
  const name = String(body.name || username).trim().slice(0, 200) || username;
  const email = String(body.email || "").trim().toLowerCase() || null;
  const account = await postgresTransaction(async (client) => {
    await client.query("INSERT INTO ticket_identity_setup_lock (lock_key) VALUES ('initial-account') ON CONFLICT DO NOTHING");
    await client.query("SELECT lock_key FROM ticket_identity_setup_lock WHERE lock_key='initial-account' FOR UPDATE");
    const count = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ticket_accounts");
    if (Number(count.rows[0]?.count || 0) !== 0) throw new HttpFail(409, "ticket setup already completed");
    const id = nid("tacct");
    await client.query(
      `INSERT INTO ticket_accounts (id,username,name,password_hash,email,roles,active,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'["employee","admin"]'::jsonb,true,now(),now())`,
      [id, username, name, passwordHash(String(body.password || "")), email],
    );
    return { id, username, name, email, roles: ["employee", "admin"], active: true } satisfies TicketPrincipal;
  }, { isolation: "SERIALIZABLE" });
  await createSession(c, account.id);
  return c.json({ ok: true, account: publicAccount(account) }, 201);
});

ticketAuthRouter.post("/ticket-auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const username = normalizedUsername(body.username || body.email);
  const result = await postgresPool().query<AccountRow & { password_hash: string }>(
    `SELECT id,username,name,email,roles,active,password_hash FROM ticket_accounts
      WHERE lower(username)=lower($1) AND active=true LIMIT 1`,
    [username],
  );
  const account = result.rows[0];
  if (!account || !(await passwordMatches(String(body.password || ""), account.password_hash))) {
    throw new HttpFail(401, "invalid ticket credentials");
  }
  const actor = principal(account);
  await createSession(c, actor.id);
  return c.json({ ok: true, account: publicAccount(actor) });
});

ticketAuthRouter.post("/ticket-auth/logout", async (c) => {
  const token = cookieValue(c, COOKIE);
  if (token) await postgresPool().query("DELETE FROM ticket_auth_sessions WHERE token_digest=$1", [tokenDigest(token)]);
  setSessionCookie(c, "", 0);
  return c.json({ ok: true });
});
