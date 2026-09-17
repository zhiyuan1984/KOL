import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  authDisabled,
  hashPassword,
  isAdmin,
  requireAdmin,
  scopedUser,
  tokenDigest,
} from "../auth.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { uploadsDir } from "../host/attachments.js";
import { SKILL_CATALOG } from "../host/skills-catalog.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { boxDir } from "../config.js";

export const enterprise = new Hono();

function parseJson(value: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(value ?? JSON.stringify(fallback)));
  } catch {
    return fallback;
  }
}

function pathBytes(target: string): number {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return fs.readdirSync(target).reduce((total, name) => total + pathBytes(path.join(target, name)), 0);
  } catch {
    return 0;
  }
}

function safeUser(row: Row): Json {
  const { password_hash: _password, ...rest } = row;
  const db = getConn();
  return {
    ...rest,
    email: row.username,
    status: row.active ? "active" : "disabled",
    roles: parseJson(row.roles, []),
    brands: parseJson(row.brands, []),
    active: Boolean(row.active),
    skill_grants: (db.prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(row.id) as Row[])
      .map((grant) => String(grant.skill_id)),
    connector_grants: (db.prepare("SELECT connector_id,access FROM user_connector_grants WHERE user_id=?").all(row.id) as Row[])
      .map((grant) => `${grant.connector_id}:${grant.access}`),
    approval_roles: (db.prepare("SELECT approval_role FROM approval_role_bindings WHERE user_id=?").all(row.id) as Row[])
      .map((grant) => String(grant.approval_role)),
  };
}

function userById(id: string): Row {
  const row = getConn().prepare("SELECT * FROM users WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "user not found");
  return row;
}

function connectorPublic(row: unknown): Json {
  const value = row as Row;
  return {
    ...value,
    enabled: Boolean(value.enabled),
    credential_reference: value.credential_ref || null,
    credential_status: value.credential_ref ? "已配置" : "未配置",
  };
}

/** Employee use-surface DTO. Never emit credential refs or governance status. */
function projectEmployeeAccess(value: unknown): "read" | "write" {
  return String(value || "") === "read" ? "read" : "write";
}

function connectorEmployee(row: unknown): Json {
  const value = row as Row;
  return {
    id: String(value.id || ""),
    label: String(value.label || value.id || ""),
    access: projectEmployeeAccess(value.access),
  };
}

function roles(value: unknown): string[] {
  const allowed = new Set(["employee", "admin"]);
  const values = Array.isArray(value) ? value.map(String) : [];
  if (!values.length || values.some((role) => !allowed.has(role))) throw new HttpFail(400, "roles must contain employee/admin");
  return [...new Set(values)];
}

enterprise.get("/admin/users", () => {
  requireAdmin();
  return Response.json((getConn().prepare("SELECT * FROM users ORDER BY created_at").all() as Row[]).map(safeUser));
});

enterprise.post("/admin/users", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const username = String(body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,100}$/.test(username)) throw new HttpFail(400, "invalid username");
  const id = nid("usr");
  const now = nowIso();
  getConn().prepare(
    `INSERT INTO users (id,username,name,password_hash,roles,brands,site,manager_user_id,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, username, String(body.name || username), await hashPassword(String(body.password || "")),
    JSON.stringify(roles(body.roles || ["employee"])), JSON.stringify(body.brands || []), String(body.site || ""),
    body.manager_user_id || null, body.active === false ? 0 : 1, now, now);
  audit(admin.id, "admin.user.create", { user_id: id });
  return c.json(safeUser(userById(id)), 201);
});

enterprise.get("/admin/users/:uid", (c) => {
  requireAdmin();
  return c.json(safeUser(userById(c.req.param("uid"))));
});

enterprise.patch("/admin/users/:uid", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  userById(uid);
  const body = (await c.req.json()) as Json;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of ["name", "site", "manager_user_id"] as const) {
    if (body[field] !== undefined) { sets.push(`${field}=?`); values.push(body[field] || null); }
  }
  if (body.roles !== undefined) { sets.push("roles=?"); values.push(JSON.stringify(roles(body.roles))); }
  if (body.brands !== undefined) { sets.push("brands=?"); values.push(JSON.stringify(body.brands)); }
  if (body.active !== undefined) { sets.push("active=?"); values.push(body.active ? 1 : 0); }
  if (body.password !== undefined) { sets.push("password_hash=?"); values.push(await hashPassword(String(body.password))); }
  if (!sets.length) return c.json(safeUser(userById(uid)));
  sets.push("updated_at=?"); values.push(nowIso(), uid);
  getConn().prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).run(...values);
  audit(admin.id, "admin.user.update", { user_id: uid, fields: sets.map((s) => s.split("=")[0]) });
  return c.json(safeUser(userById(uid)));
});

enterprise.delete("/admin/users/:uid", (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  if (uid === admin.id) throw new HttpFail(409, "cannot deactivate current account");
  userById(uid);
  tx((db) => {
    db.prepare("UPDATE users SET active=0,updated_at=? WHERE id=?").run(nowIso(), uid);
    db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(uid);
  });
  audit(admin.id, "admin.user.deactivate", { user_id: uid });
  return c.json({ ok: true, deactivated: true });
});

enterprise.put("/admin/users/:uid/skills/:skill", (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  const skill = c.req.param("skill");
  userById(uid);
  if (!SKILL_CATALOG.some((entry) => entry.id === skill)) throw new HttpFail(404, "skill not found");
  getConn().prepare("INSERT OR IGNORE INTO user_skill_grants (user_id,skill_id,created_at) VALUES (?,?,?)")
    .run(uid, skill, nowIso());
  audit(admin.id, "admin.skill.grant", { user_id: uid, skill_id: skill });
  return c.json({ ok: true, user_id: uid, skill_id: skill });
});

enterprise.delete("/admin/users/:uid/skills/:skill", (c) => {
  const admin = requireAdmin();
  getConn().prepare("DELETE FROM user_skill_grants WHERE user_id=? AND skill_id=?")
    .run(c.req.param("uid"), c.req.param("skill"));
  audit(admin.id, "admin.skill.revoke", { user_id: c.req.param("uid"), skill_id: c.req.param("skill") });
  return c.json({ ok: true });
});

enterprise.put("/admin/users/:uid/skills", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  userById(uid);
  const body = (await c.req.json()) as Json;
  const skills = Array.isArray(body.skills) ? body.skills.map(String) : [];
  if (skills.some((skill) => !SKILL_CATALOG.some((entry) => entry.id === skill))) {
    throw new HttpFail(400, "unknown skill");
  }
  tx((db) => {
    db.prepare("DELETE FROM user_skill_grants WHERE user_id=?").run(uid);
    for (const skill of skills) {
      db.prepare("INSERT INTO user_skill_grants (user_id,skill_id,created_at) VALUES (?,?,?)")
        .run(uid, skill, nowIso());
    }
  });
  audit(admin.id, "admin.skill.replace", { user_id: uid, skills });
  return c.json({ ok: true, user_id: uid, skills });
});

enterprise.get("/admin/connectors", (c) => {
  requireAdmin();
  return c.json(getConn().prepare("SELECT * FROM connectors ORDER BY id").all().map(connectorPublic));
});

enterprise.get("/connectors", (c) => {
  const user = scopedUser();
  if (authDisabled() || (user && isAdmin(user))) {
    return c.json((getConn().prepare(
      "SELECT id,label FROM connectors WHERE enabled=1 ORDER BY id",
    ).all()).map((row) => connectorEmployee({ ...(row as Row), access: "write" })));
  }
  if (!user) throw new HttpFail(401, "authentication required");
  return c.json((getConn().prepare(
    `SELECT c.id,c.label,g.access FROM connectors c
      JOIN user_connector_grants g ON g.connector_id=c.id
     WHERE g.user_id=? AND c.enabled=1 ORDER BY c.id`,
  ).all(user.id)).map(connectorEmployee));
});

enterprise.post("/admin/connectors", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const id = String(body.id || "").trim();
  if (!/^[a-z0-9_-]+$/.test(id)) throw new HttpFail(400, "invalid connector id");
  getConn().prepare(
    "INSERT INTO connectors (id,label,enabled,status,credential_ref,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(id, String(body.label || id), body.enabled === false ? 0 : 1, String(body.status || "configured"),
    body.credential_ref || null, nowIso());
  audit(admin.id, "admin.connector.create", { connector_id: id });
  return c.json(connectorPublic(getConn().prepare("SELECT * FROM connectors WHERE id=?").get(id)), 201);
});

enterprise.patch("/admin/connectors/:id", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  const body = (await c.req.json()) as Json;
  if ("credential" in body || "secret" in body || "password" in body) throw new HttpFail(400, "only credential_ref may be stored");
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of ["label", "status", "credential_ref"] as const) {
    if (body[field] !== undefined) { sets.push(`${field}=?`); values.push(body[field]); }
  }
  if (body.enabled !== undefined) { sets.push("enabled=?"); values.push(body.enabled ? 1 : 0); }
  if (!sets.length) throw new HttpFail(400, "no changes");
  sets.push("updated_at=?"); values.push(nowIso(), id);
  const result = getConn().prepare(`UPDATE connectors SET ${sets.join(",")} WHERE id=?`).run(...values);
  if (!result.changes) throw new HttpFail(404, "connector not found");
  audit(admin.id, "admin.connector.update", { connector_id: id });
  return c.json(connectorPublic(getConn().prepare("SELECT * FROM connectors WHERE id=?").get(id)));
});

enterprise.delete("/admin/connectors/:id", (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  const result = tx((db) => {
    db.prepare("DELETE FROM user_connector_grants WHERE connector_id=?").run(id);
    return db.prepare("DELETE FROM connectors WHERE id=?").run(id);
  });
  if (!result.changes) throw new HttpFail(404, "connector not found");
  audit(admin.id, "admin.connector.delete", { connector_id: id });
  return c.json({ ok: true });
});

enterprise.put("/admin/users/:uid/connectors/:id", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const access = String(body.access || "read");
  if (!["read", "write", "admin"].includes(access)) throw new HttpFail(400, "invalid access");
  userById(c.req.param("uid"));
  if (!getConn().prepare("SELECT 1 FROM connectors WHERE id=?").get(c.req.param("id"))) throw new HttpFail(404, "connector not found");
  getConn().prepare(
    `INSERT INTO user_connector_grants (user_id,connector_id,access,created_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id,connector_id) DO UPDATE SET access=excluded.access`,
  ).run(c.req.param("uid"), c.req.param("id"), access, nowIso());
  audit(admin.id, "admin.connector.grant", { user_id: c.req.param("uid"), connector_id: c.req.param("id"), access });
  return c.json({ ok: true, access });
});

enterprise.delete("/admin/users/:uid/connectors/:id", (c) => {
  const admin = requireAdmin();
  getConn().prepare("DELETE FROM user_connector_grants WHERE user_id=? AND connector_id=?")
    .run(c.req.param("uid"), c.req.param("id"));
  audit(admin.id, "admin.connector.revoke", { user_id: c.req.param("uid"), connector_id: c.req.param("id") });
  return c.json({ ok: true });
});

enterprise.put("/admin/users/:uid/connectors", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  userById(uid);
  const body = (await c.req.json()) as Json;
  const values = Array.isArray(body.connectors) ? body.connectors.map(String) : [];
  tx((db) => {
    db.prepare("DELETE FROM user_connector_grants WHERE user_id=?").run(uid);
    for (const value of values) {
      const [connectorId, requestedAccess] = value.split(":");
      const access = ["read", "write", "admin"].includes(requestedAccess) ? requestedAccess : "read";
      if (!db.prepare("SELECT 1 FROM connectors WHERE id=?").get(connectorId)) {
        throw new HttpFail(400, `unknown connector: ${connectorId}`);
      }
      db.prepare("INSERT INTO user_connector_grants (user_id,connector_id,access,created_at) VALUES (?,?,?,?)")
        .run(uid, connectorId, access, nowIso());
    }
  });
  audit(admin.id, "admin.connector_grants.replace", { user_id: uid, connectors: values });
  return c.json({ ok: true, user_id: uid, connectors: values });
});

enterprise.put("/admin/users/:uid/approval-roles/:role", (c) => {
  const admin = requireAdmin();
  userById(c.req.param("uid"));
  getConn().prepare("INSERT OR IGNORE INTO approval_role_bindings (user_id,approval_role,created_at) VALUES (?,?,?)")
    .run(c.req.param("uid"), c.req.param("role"), nowIso());
  audit(admin.id, "admin.approval_role.bind", { user_id: c.req.param("uid"), role: c.req.param("role") });
  return c.json({ ok: true });
});

enterprise.delete("/admin/users/:uid/approval-roles/:role", (c) => {
  const admin = requireAdmin();
  getConn().prepare("DELETE FROM approval_role_bindings WHERE user_id=? AND approval_role=?")
    .run(c.req.param("uid"), c.req.param("role"));
  audit(admin.id, "admin.approval_role.unbind", { user_id: c.req.param("uid"), role: c.req.param("role") });
  return c.json({ ok: true });
});

enterprise.put("/admin/users/:uid/approval-roles", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  userById(uid);
  const body = (await c.req.json()) as Json;
  const values = Array.isArray(body.roles) ? body.roles.map(String) : [];
  const allowed = new Set(["lead", "manager", "zhang"]);
  if (values.some((role) => !allowed.has(role))) throw new HttpFail(400, "invalid approval role");
  tx((db) => {
    db.prepare("DELETE FROM approval_role_bindings WHERE user_id=?").run(uid);
    for (const role of values) {
      db.prepare("INSERT INTO approval_role_bindings (user_id,approval_role,created_at) VALUES (?,?,?)")
        .run(uid, role, nowIso());
    }
  });
  audit(admin.id, "admin.approval_roles.replace", { user_id: uid, roles: values });
  return c.json({ ok: true, user_id: uid, roles: values });
});

enterprise.get("/preferences", (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const row = getConn().prepare("SELECT * FROM user_preferences WHERE user_id=?").get(user.id) as Row | undefined;
  return c.json({
    analytics_cookies: Boolean(row?.analytics_cookies),
    ...(parseJson(row?.preferences, {}) as Json),
  });
});

enterprise.patch("/preferences", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const current = getConn().prepare("SELECT * FROM user_preferences WHERE user_id=?").get(user.id) as Row | undefined;
  const analytics = body.analytics_cookies === undefined
    ? Number(current?.analytics_cookies || 0)
    : body.analytics_cookies === true ? 1 : 0;
  const existing = parseJson(current?.preferences, {}) as Json;
  const rest = { ...body }; delete rest.analytics_cookies;
  const merged = { ...existing, ...rest };
  getConn().prepare(
    `INSERT INTO user_preferences (user_id,analytics_cookies,preferences,updated_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET analytics_cookies=excluded.analytics_cookies,
       preferences=excluded.preferences,updated_at=excluded.updated_at`,
  ).run(user.id, analytics, JSON.stringify(merged), nowIso());
  audit(user.id, "preference.update", { fields: Object.keys(body) });
  return c.json({ analytics_cookies: Boolean(analytics), ...merged });
});

function memoryRow(id: string): Row {
  const row = getConn().prepare("SELECT * FROM memory_entries WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "memory not found");
  return row;
}

function assertMemoryOwner(row: Row): void {
  const user = scopedUser();
  if (!user || (String(row.owner_user_id) !== user.id && !isAdmin(user))) throw new HttpFail(403, "memory owner required");
}

enterprise.get("/memory", (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const rows = getConn().prepare(
    "SELECT * FROM memory_entries WHERE owner_user_id=? OR scope='team' ORDER BY updated_at DESC",
  ).all(user.id);
  return c.json(rows);
});

enterprise.post("/memory", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const scope = String(body.scope === "workspace" ? "team" : body.scope || "private");
  if (!["private", "team"].includes(scope)) throw new HttpFail(400, "scope must be private/team");
  const id = nid("mem"); const now = nowIso();
  getConn().prepare(
    "INSERT INTO memory_entries (id,owner_user_id,title,body_md,scope,enabled,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(id, user.id, String(body.title || "记忆"), String(body.body_md ?? body.content ?? ""), scope,
    body.enabled === false ? 0 : 1, 1, now, now);
  audit(user.id, "memory.create", { memory_id: id, scope });
  return c.json(memoryRow(id), 201);
});

enterprise.patch("/memory/:id", async (c) => {
  const user = scopedUser()!;
  const row = memoryRow(c.req.param("id")); assertMemoryOwner(row);
  const body = (await c.req.json()) as Json;
  const scope = body.scope === undefined ? row.scope : String(body.scope === "workspace" ? "team" : body.scope);
  if (!["private", "team"].includes(String(scope))) throw new HttpFail(400, "scope must be private/team");
  getConn().prepare(
    "UPDATE memory_entries SET title=?,body_md=?,scope=?,enabled=?,version=version+1,updated_at=? WHERE id=?",
  ).run(body.title === undefined ? row.title : String(body.title),
    body.body_md === undefined && body.content === undefined ? row.body_md : String(body.body_md ?? body.content), scope,
    body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0, nowIso(), row.id);
  audit(user.id, "memory.update", { memory_id: row.id });
  return c.json(memoryRow(String(row.id)));
});

enterprise.delete("/memory/:id", (c) => {
  const user = scopedUser()!;
  const row = memoryRow(c.req.param("id")); assertMemoryOwner(row);
  getConn().prepare("DELETE FROM memory_entries WHERE id=?").run(row.id);
  audit(user.id, "memory.delete", { memory_id: row.id });
  return c.json({ ok: true });
});

export function assertSessionAccess(sessionId: string, includeDeleted = false): Row {
  const row = getConn().prepare("SELECT * FROM sessions WHERE id=?").get(sessionId) as Row | undefined;
  if (!row || (!includeDeleted && row.deleted_at)) throw new HttpFail(404, "session not found");
  if (authDisabled()) return row;
  const user = scopedUser();
  if (!user || (!isAdmin(user) && row.owner_user_id !== user.id)) throw new HttpFail(404, "session not found");
  return row;
}

enterprise.post("/sessions/:sid/archive", (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const archivedAt = nowIso();
  getConn().prepare("UPDATE sessions SET archived_at=?,updated_at=? WHERE id=?").run(archivedAt, archivedAt, row.id);
  audit(user?.id || "demo", "session.archive", { session_id: row.id });
  return c.json({ ok: true, archived_at: archivedAt });
});

enterprise.post("/sessions/:sid/unarchive", (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const updatedAt = nowIso();
  getConn().prepare("UPDATE sessions SET archived_at=NULL,updated_at=? WHERE id=?").run(updatedAt, row.id);
  audit(user?.id || "demo", "session.unarchive", { session_id: row.id });
  return c.json({ ok: true, archived_at: null });
});

function sessionSnapshot(sid: string, includeInternal = true): Json {
  const storedSession = getConn().prepare("SELECT * FROM sessions WHERE id=?").get(sid) as Row;
  const session = includeInternal
    ? storedSession
    : {
        id: storedSession.id,
        title: storedSession.title,
        created_at: storedSession.created_at,
        updated_at: storedSession.updated_at,
      };
  const rows = getConn().prepare("SELECT * FROM messages WHERE session_id=? ORDER BY created_at,id").all(sid) as Row[];
  const messages = rows.flatMap((row) => {
    if (!includeInternal && [
      "steps",
      "process_trace",
      "job_status",
      "confirm_stage_card",
      "inbound_card",
      "supplement_card",
    ].includes(String(row.kind))) return [];
    const payload = parseJson(row.payload, {}) as Json;
    if (!includeInternal) {
      delete payload.body_zh_internal;
      delete payload.path;
      delete payload.approval_id;
      delete payload.chain_id;
      delete payload.fingerprint;
      delete payload.allowed_from_mailboxes;
      delete payload.send_error;
      if (Array.isArray(payload.attachments)) {
        payload.attachments = (payload.attachments as Json[]).map(({ path: _path, ...attachment }) => attachment);
      }
    }
    return [{ ...row, payload }];
  });
  return { session, messages };
}

enterprise.get("/sessions/:sid/export", (c) => {
  const row = assertSessionAccess(c.req.param("sid"));
  const format = c.req.query("format") || "json";
  const snapshot = sessionSnapshot(String(row.id));
  const safeName = String(row.title || row.id).replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 80);
  if (format === "json") {
    c.header("Content-Disposition", `attachment; filename="${safeName}.json"`);
    return c.json(snapshot);
  }
  if (format !== "markdown" && format !== "md") throw new HttpFail(400, "format must be json/markdown");
  const md = [`# ${row.title}`, "", ...(snapshot.messages as Json[]).map((message) => {
    const payload = message.payload as Json;
    return `## ${message.role} · ${message.kind}\n\n${String(payload.text || payload.body || payload.subject || "")}`;
  })].join("\n\n");
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${safeName}.md"`);
  return c.body(md);
});

enterprise.delete("/sessions/:sid", (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const messages = getConn().prepare("SELECT payload FROM messages WHERE session_id=?").all(row.id) as Row[];
  const attributable = new Set<string>();
  for (const message of messages) {
    const payload = parseJson(message.payload, {}) as Json;
    for (const attachment of (Array.isArray(payload.attachments) ? payload.attachments : []) as Json[]) {
      const file = path.resolve(String(attachment.path || ""));
      const root = path.resolve(uploadsDir()) + path.sep;
      if (file.startsWith(root)) attributable.add(file);
    }
  }
  const boxes = (getConn().prepare("SELECT box_path FROM workers WHERE session_id=?").all(row.id) as Row[])
    .map((worker) => String(worker.box_path || "")).filter(Boolean);
  tx((db) => {
    db.prepare("DELETE FROM session_shares WHERE session_id=?").run(row.id);
    db.prepare("DELETE FROM messages WHERE session_id=?").run(row.id);
    db.prepare("DELETE FROM drafts WHERE session_id=?").run(row.id);
    db.prepare("DELETE FROM workers WHERE session_id=?").run(row.id);
    db.prepare("UPDATE sessions SET deleted_at=?,archived_at=COALESCE(archived_at,?),thread_ref=NULL,updated_at=? WHERE id=?")
      .run(nowIso(), nowIso(), nowIso(), row.id);
  });
  const boxesRoot = path.resolve(boxDir()) + path.sep;
  for (const box of boxes) {
    const resolved = path.resolve(box);
    if (resolved.startsWith(boxesRoot)) fs.rmSync(resolved, { recursive: true, force: true });
  }
  for (const file of attributable) {
    const other = getConn().prepare("SELECT 1 FROM messages WHERE payload LIKE ? LIMIT 1").get(`%${file}%`);
    if (!other) fs.rmSync(file, { force: true });
  }
  audit(user?.id || "demo", "session.delete", { session_id: row.id, stage_transitions: "retained_immutable" });
  return c.json({
    ok: true,
    soft_deleted: true,
    cleaned: ["messages", "drafts", "workers", "boxes", "attributable_uploads"],
    immutable_data: { stage_transitions: "retained; immutable compliance records are not deleted with a conversation" },
  });
});

enterprise.post("/sessions/:sid/share", async (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const expiresIn = Math.min(Math.max(Number(body.expires_in_seconds || 86400), 60), 30 * 86400);
  const token = randomBytes(32).toString("base64url");
  const id = nid("shr");
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  getConn().prepare(
    "INSERT INTO session_shares (id,session_id,token_hash,expires_at,include_internal,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(id, row.id, tokenDigest(token), expiresAt, body.include_internal === true ? 1 : 0, user?.id || "demo", nowIso());
  audit(user?.id || "demo", "session.share.create", { share_id: id, session_id: row.id, expires_at: expiresAt });
  return c.json({ id, token, expires_at: expiresAt, read_only: true, include_internal: body.include_internal === true }, 201);
});

enterprise.delete("/sessions/:sid/share/:shareId", (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const result = getConn().prepare("UPDATE session_shares SET revoked_at=? WHERE id=? AND session_id=?")
    .run(nowIso(), c.req.param("shareId"), row.id);
  if (!result.changes) throw new HttpFail(404, "share not found");
  audit(user?.id || "demo", "session.share.revoke", { share_id: c.req.param("shareId"), session_id: row.id });
  return c.json({ ok: true, revoked: true });
});

enterprise.delete("/sessions/:sid/share", (c) => {
  const user = scopedUser();
  const row = assertSessionAccess(c.req.param("sid"));
  const revokedAt = nowIso();
  const result = getConn().prepare(
    "UPDATE session_shares SET revoked_at=? WHERE session_id=? AND revoked_at IS NULL",
  ).run(revokedAt, row.id);
  audit(user?.id || "demo", "session.share.revoke_all", { session_id: row.id, count: result.changes });
  return c.json({ ok: true, revoked: result.changes });
});

enterprise.get("/shared/:token", (c) => {
  const row = getConn().prepare(
    `SELECT * FROM session_shares WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`,
  ).get(tokenDigest(c.req.param("token")), nowIso()) as Row | undefined;
  if (!row) throw new HttpFail(404, "share unavailable");
  return c.json({ ...sessionSnapshot(String(row.session_id), Boolean(row.include_internal)), read_only: true, expires_at: row.expires_at });
});

enterprise.get("/me/data-summary", (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const db = getConn();
  const count = (sql: string): number => Number((db.prepare(sql).get(user.id) as { n: number }).n);
  return c.json({
    sessions: count("SELECT COUNT(*) AS n FROM sessions WHERE owner_user_id=? AND deleted_at IS NULL"),
    archived_sessions: count("SELECT COUNT(*) AS n FROM sessions WHERE owner_user_id=? AND archived_at IS NOT NULL AND deleted_at IS NULL"),
    memories: count("SELECT COUNT(*) AS n FROM memory_entries WHERE owner_user_id=?"),
    exam_attempts: count("SELECT COUNT(*) AS n FROM exam_attempts WHERE user_id=?"),
    database_bytes: pathBytes(String(process.env.LINGONG_DB || path.join(process.env.LINGONG_DATA || path.dirname(uploadsDir()), "lingong.db"))),
    uploads_bytes: pathBytes(uploadsDir()),
    worker_boxes_bytes: pathBytes(boxDir()),
    retention_policy: db.prepare("SELECT session_days,audit_days FROM retention_policy WHERE id=1").get(),
    stage_transitions: "retained as immutable compliance records when conversation data is deleted",
  });
});

enterprise.get("/admin/retention-policy", (c) => {
  requireAdmin();
  return c.json(getConn().prepare("SELECT * FROM retention_policy WHERE id=1").get());
});

enterprise.patch("/admin/retention-policy", async (c) => {
  const admin = requireAdmin();
  const current = getConn().prepare("SELECT * FROM retention_policy WHERE id=1").get() as Row;
  const body = (await c.req.json()) as Json;
  const sessionDays = Number(body.session_days ?? current.session_days);
  const auditDays = Number(body.audit_days ?? current.audit_days);
  if (sessionDays < 1 || auditDays < 1) throw new HttpFail(400, "retention days must be positive");
  getConn().prepare("UPDATE retention_policy SET session_days=?,audit_days=?,updated_at=? WHERE id=1")
    .run(sessionDays, auditDays, nowIso());
  audit(admin.id, "admin.retention.update", { session_days: sessionDays, audit_days: auditDays });
  return c.json(getConn().prepare("SELECT * FROM retention_policy WHERE id=1").get());
});

enterprise.get("/privacy/cookies", (c) => {
  const user = scopedUser();
  let analytics = false;
  if (user) {
    const row = getConn().prepare("SELECT analytics_cookies FROM user_preferences WHERE user_id=?").get(user.id) as Row | undefined;
    analytics = Boolean(row?.analytics_cookies);
  }
  return c.json({
    essential: [{ name: "lingong_session", purpose: "authentication", http_only: true, same_site: "Lax" }],
    analytics_cookies: analytics,
    nonessential_cookies_set: false,
  });
});
