import { AsyncLocalStorage } from "node:async_hooks";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";

const requestPrincipal = new AsyncLocalStorage<TicketPrincipal>();

export type TicketPrincipal = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  roles: string[];
  active: boolean;
};

export type WorkbenchSessionUser = {
  id: string;
  username: string;
  name: string;
  email?: string;
  roles: string[];
  active: boolean;
};

function normalizedRoles(value: unknown): string[] {
  return Array.from(new Set(Array.isArray(value)
    ? value.map(String).map((role) => role.trim()).filter(Boolean)
    : []));
}

/** Converts a server-verified workbench session claim to the formal-ticket
 * principal shape. It never reads browser-controlled identity fields. */
export function ticketPrincipalFromWorkbenchUser(user: WorkbenchSessionUser): TicketPrincipal {
  return {
    id: String(user.id),
    username: String(user.username),
    name: String(user.name),
    email: user.email ? String(user.email) : null,
    roles: normalizedRoles(user.roles),
    active: Boolean(user.active),
  };
}

/**
 * Mirrors the authenticated workbench principal into PostgreSQL as an auditable
 * reference used by formal-ticket foreign keys. This is not a login, password,
 * cookie, or second account domain: the existing workbench session remains the
 * only credential and authority for the request.
 */
export async function syncWorkbenchTicketPrincipal(user: WorkbenchSessionUser): Promise<TicketPrincipal> {
  const actor = ticketPrincipalFromWorkbenchUser(user);
  if (!actor.id || !actor.username || !actor.name) {
    throw new HttpFail(401, { code: "workbench_identity_incomplete", message: "工作台会话缺少可用主体信息" });
  }
  const now = new Date().toISOString();
  await postgresTransaction(async (client) => {
    const existing = await client.query<{ id: string; identity_provider: string }>(
      "SELECT id,identity_provider FROM ticket_accounts WHERE id=$1 FOR UPDATE",
      [actor.id],
    );
    if (existing.rows[0] && existing.rows[0].identity_provider !== "workbench_session") {
      throw new HttpFail(409, { code: "workbench_principal_collision", message: "工作台主体与已退休的工单账号标识冲突，请由管理员处理" });
    }
    const usernameOwner = await client.query<{ id: string }>(
      "SELECT id FROM ticket_accounts WHERE lower(username)=lower($1) AND id<>$2 FOR UPDATE",
      [actor.username, actor.id],
    );
    if (usernameOwner.rows[0]) {
      throw new HttpFail(409, { code: "workbench_username_collision", message: "工作台账号与现有工单主体名称冲突，请由管理员处理" });
    }

    await client.query(
      `INSERT INTO ticket_accounts
       (id,username,name,password_hash,email,roles,active,identity_provider,created_at,updated_at)
       VALUES ($1,$2,$3,'workbench-session-only',$4,$5,$6,'workbench_session',$7,$7)
       ON CONFLICT (id) DO UPDATE SET
         username=EXCLUDED.username,name=EXCLUDED.name,email=EXCLUDED.email,roles=EXCLUDED.roles,
         active=EXCLUDED.active,identity_provider='workbench_session',updated_at=EXCLUDED.updated_at`,
      [actor.id, actor.username, actor.name, actor.email, JSON.stringify(actor.roles), actor.active, now],
    );

    const prior = await client.query<{
      username_snapshot: string; name_snapshot: string; email_snapshot: string | null; roles_snapshot: unknown; active: boolean;
    }>(
      `SELECT username_snapshot,name_snapshot,email_snapshot,roles_snapshot,active
         FROM workbench_principal_bindings WHERE workbench_user_id=$1 FOR UPDATE`,
      [actor.id],
    );
    const previous = prior.rows[0];
    const claims = { username: actor.username, name: actor.name, email: actor.email, roles: actor.roles, active: actor.active };
    await client.query(
      `INSERT INTO workbench_principal_bindings
       (workbench_user_id,principal_id,username_snapshot,name_snapshot,email_snapshot,roles_snapshot,active,source,first_seen_at,last_seen_at,updated_at)
       VALUES ($1,$1,$2,$3,$4,$5,$6,'workbench_session',$7,$7,$7)
       ON CONFLICT (workbench_user_id) DO UPDATE SET
         principal_id=EXCLUDED.principal_id,username_snapshot=EXCLUDED.username_snapshot,name_snapshot=EXCLUDED.name_snapshot,
         email_snapshot=EXCLUDED.email_snapshot,roles_snapshot=EXCLUDED.roles_snapshot,active=EXCLUDED.active,
         last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at`,
      [actor.id, actor.username, actor.name, actor.email, JSON.stringify(actor.roles), actor.active, now],
    );
    const changed = !previous || previous.username_snapshot !== actor.username || previous.name_snapshot !== actor.name
      || previous.email_snapshot !== actor.email || previous.active !== actor.active
      || JSON.stringify(normalizedRoles(previous.roles_snapshot)) !== JSON.stringify(actor.roles);
    if (changed) {
      await client.query(
        `INSERT INTO workbench_principal_binding_events
         (id,workbench_user_id,principal_id,event_type,claims_json,occurred_at)
         VALUES ($1,$2,$2,$3,$4,$5)`,
        [nid("wpbe"), actor.id, previous ? (actor.active ? "claims_refreshed" : "deactivated") : "bound", JSON.stringify(claims), now],
      );
    }
  }, { isolation: "SERIALIZABLE" });
  return actor;
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
  if (!actor) throw new HttpFail(401, { code: "workbench_authentication_required", message: "请先登录工作台" });
  if (!actor.active) throw new HttpFail(403, { code: "workbench_account_inactive", message: "工作台账号已停用" });
  return actor;
}
