import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { PoolClient } from "pg";
import {
  authDisabled,
  hashPassword,
  isAdmin,
  requireAdmin,
  scopedUser,
  tokenDigest,
} from "../auth.js";
import type { AppUser } from "../auth.js";
import { nowIso } from "../db.js";
import { postgresPool, postgresQuery, postgresTransaction } from "../postgres/pool.js";
import { pgAudit } from "../postgres/auth-pg.js";
import { HttpFail } from "../host/errors.js";
import { uploadsDir } from "../host/attachments.js";
import { SKILL_CATALOG } from "../host/skills-catalog.js";
import { allowedFromMailboxes, authorizedSenderBrand } from "../host/pep.js";
import { departmentHeadAccessForUser } from "../contract-scope.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { boxDir } from "../config.js";
import { isBuiltinConnectorId, requireManagedConnector } from "../connectors/catalog.js";
import { hasBundledIcon } from "./connector-icons.js";
import { ensureRuntimeSchema } from "../runtime/store.js";
import {
  avatarUrlForUser,
  listOrganizationMemberships,
  listOrganizationPeople,
  listOrganizationUnits,
  organizationCompanyName,
} from "../runtime/organization-tree.js";
import { syncUserOrganization } from "../runtime/organization-tree.js";
import { pgCreateOrganizationUser, pgDeactivateOrganizationUser, pgSyncOrganizationMembership, pgUpdateOrganizationUser, pgUserById } from "../postgres/organization-repository.js";
import { pgBindApprovalRole, pgSetApprovalRoles, pgUnbindApprovalRole, pgUpdatePreferences } from "../postgres/account-access-repository.js";
import { pgCreateConnector, pgDeleteConnector, pgUpdateConnectorInTransaction } from "../postgres/connector-authorization-repository.js";

import { pgEnterpriseAccount, pgEnterpriseAccounts, pgEnterpriseEmployeeContext } from "../postgres/enterprise-account-read-repository.js";

export const enterprise = new Hono();

enterprise.use("/sessions/:sid/*",async (c,next) => {
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  await authorizedTaskSession(scopedUser()?.id || "",c.req.param("sid"),c.req.path.endsWith("/unarchive"));
  await next();
});
enterprise.use("/sessions/:sid",async (c,next) => {
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  await authorizedTaskSession(scopedUser()?.id || "",c.req.param("sid"));
  await next();
});

async function assertConnectorEnableBasis(client: PoolClient, id: string): Promise<void> {
  const connector = (await client.query<Row>("SELECT id,status,enabled FROM connectors WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!connector) throw new HttpFail(404, "connector not found");
  if (String(connector.status) !== "verified") {
    throw new HttpFail(409, { code: "connector_verification_required", connector_id: id });
  }
  const config = (await client.query<Row>("SELECT version FROM runtime_connector_config WHERE connector_id=$1 FOR SHARE", [id])).rows[0];
  if (!config) throw new HttpFail(409, { code: "connector_verification_required", connector_id: id });
  const probe = (await client.query<Row>(`SELECT status,probe_kind,config_version FROM runtime_connector_probes
    WHERE connector_id=$1 ORDER BY id DESC LIMIT 1 FOR SHARE`, [id])).rows[0];
  if (probe?.status !== "succeeded" || !["mcp_tools_list", "http_definition"].includes(String(probe.probe_kind))
    || Number(probe.config_version) !== Number(config.version)) {
    throw new HttpFail(409, { code: "connector_verification_required", connector_id: id });
  }
  const mounted = (await client.query<Row>(`SELECT t.skill_id FROM runtime_skill_tools t
    JOIN runtime_skill_connectors c ON c.skill_id=t.skill_id AND c.connector_id=t.connector_id
    WHERE t.connector_id=$1 AND t.enabled=1 AND c.enabled=1
    FOR SHARE OF t,c`, [id])).rows[0];
  if (!mounted) throw new HttpFail(409, { code: "connector_skill_binding_required", connector_id: id });
}

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

async function safeUser(row: Row): Promise<Json> { return pgEnterpriseAccount(String(row.id)); }
async function userById(id: string): Promise<Row> {
  const row = await pgUserById(id);
  if (!row) throw new HttpFail(404, "user not found");
  return row;
}
function projectEmployeeTools(granted: Set<string>): Json {
  return {
    tools: SKILL_CATALOG
      .filter((skill) => skill.employee_visible || granted.has(skill.id))
      .map((skill) => ({
        id: skill.id,
        label: skill.label,
        summary: skill.summary,
        category: skill.category,
        published: Boolean(skill.in_market),
        granted: granted.has(skill.id),
        assignable: Boolean(skill.in_market),
      })),
  };
}

/** Catalog card metadata; an unreadable runtime table degrades to the MCP defaults. */
async function connectorRuntimeFacts(connectorId: string): Promise<{ protocol: "mcp" | "http"; approved_tool_count: number }> {
  try {
    (await ensureRuntimeSchema());
    const stored = (await postgresPool().query<Row>("SELECT config_json FROM runtime_connector_config WHERE connector_id=$1", [connectorId])).rows[0] as Row | undefined;
    const declared = ((await postgresPool().query<Row>("SELECT declared_protocol FROM connectors WHERE id=$1", [connectorId])).rows[0] as Row | undefined)?.declared_protocol;
    let protocol: "mcp" | "http" = "mcp";
    try {
      const config = stored ? JSON.parse(String(stored.config_json)) as Row | null : null;
      if (config && typeof config === "object") protocol = config.protocol === "http" ? "http" : "mcp";
      else if (declared === "http") protocol = "http";
    } catch {
      protocol = "mcp";
    }
    const approved = (await postgresPool().query<Row>("SELECT COUNT(*) AS n FROM runtime_tool_policies WHERE connector_id=$1 AND enabled=1", [connectorId])).rows[0] as Row | undefined;
    return { protocol, approved_tool_count: Number(approved?.n || 0) };
  } catch {
    return { protocol: "mcp", approved_tool_count: 0 };
  }
}

async function connectorPublic(row: unknown): Promise<Json> {
  const value = row as Row;
  const id = String(value.id || "");
  const facts = (await connectorRuntimeFacts(id));
  return {
    ...value,
    enabled: Boolean(value.enabled),
    credential_reference: value.credential_ref || null,
    credential_status: value.credential_ref ? "已配置" : "未配置",
    kind: isBuiltinConnectorId(id) ? "app" : facts.protocol === "http" ? "custom_api" : "custom_mcp",
    protocol: facts.protocol,
    icon_url: value.icon_ref || hasBundledIcon(id) ? `/api/admin/connectors/${encodeURIComponent(id)}/icon` : null,
    approved_tool_count: facts.approved_tool_count,
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

type SettingsBrandDefinition = { id: string; code: string; label: string; status: string };
type SettingsMailbox = { id: string; email: string; brand: string; status: string; is_default: boolean };
type SettingsOrganization = {
  managed: boolean;
  person?: { person_ref: string; display_name: string; email: string | null; employee_no: string | null };
  membership?: { company_id: string; org_unit_id: string; position: string | null };
  membership_unit_ids: string[];
};

const SETTINGS_PREFERENCE_KEYS = new Set([
  "analytics_cookies",
  "theme",
  "locale",
  "model_tier",
  "notifications",
  "left_sidebar_collapsed",
  "right_workbench_collapsed",
  "default_brand",
  "default_mailbox",
]);
const SETTINGS_BOOLEAN_PREFERENCES = new Set([
  "analytics_cookies",
  "notifications",
  "left_sidebar_collapsed",
  "right_workbench_collapsed",
]);
const SETTINGS_ENUM_PREFERENCES: Record<string, readonly string[]> = {
  theme: ["system", "light", "dark"],
  locale: ["zh-CN", "en"],
  model_tier: ["fast", "balanced", "quality"],
};
const BRAND_REGISTRY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config/brand-registry.yaml");

/** Registry labels are presentation metadata; authorization remains the live PEP/organization check below. */
function settingsBrandDefinitions(): SettingsBrandDefinition[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(BRAND_REGISTRY_PATH, "utf8")) as {
      brands?: Array<{ id?: unknown; code?: unknown; display_name?: unknown; status?: unknown }>;
    };
    return (parsed.brands || [])
      .map((brand) => ({
        id: String(brand.id || ""),
        code: String(brand.code || "").trim().toUpperCase(),
        label: String(brand.display_name || brand.code || "").trim(),
        status: String(brand.status || "active"),
      }))
      .filter((brand) => brand.id && brand.code && brand.label && brand.status === "active");
  } catch {
    // A registry read failure must fail closed: this endpoint must not invent selectable brands.
    return [];
  }
}

function settingsBrandCode(value: unknown, definitions = settingsBrandDefinitions()): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const found = definitions.find((brand) => brand.id === raw || brand.code === raw.toUpperCase());
  return found?.code || null;
}

/** Current, active authority facts only; historical/ended memberships never authorize settings choices. */
async function settingsOrganization(user: AppUser): Promise<SettingsOrganization> {
  // Ensures the organization tables exist before direct, bounded lookup queries.
  (await listOrganizationUnits());
  const db = postgresPool();
  const person = (await db.query<Row>("SELECT person_ref,display_name,email,employee_no,status FROM organization_people WHERE user_id=$1 AND status='active'", [user.id])).rows[0] as { person_ref: string; display_name: string; email: string | null; employee_no: string | null } | undefined;
  if (!person) return { managed: false, membership_unit_ids: [] };
  const now = nowIso();
  const memberships = (await db.query<Row>(`SELECT company_id,org_unit_id,position,relation FROM organization_memberships
      WHERE person_ref=$1 AND status='active'
        AND (effective_from IS NULL OR effective_from<=$2)
        AND (effective_to IS NULL OR effective_to>$3)
      ORDER BY CASE relation WHEN 'primary' THEN 0 ELSE 1 END, org_unit_id`, [person.person_ref, now, now])).rows as Array<{ company_id: string; org_unit_id: string; position: string | null; relation: string }>;
  const primary = memberships.find((membership) => membership.relation === "primary") || memberships[0];
  return {
    managed: true,
    person,
    membership: primary ? {
      company_id: String(primary.company_id),
      org_unit_id: String(primary.org_unit_id),
      position: primary.position ? String(primary.position) : null,
    } : undefined,
    membership_unit_ids: memberships.map((membership) => String(membership.org_unit_id)),
  };
}

async function settingsAuthorizedBrands(user: AppUser, organization: SettingsOrganization, definitions = settingsBrandDefinitions()): Promise<string[]> {
  // Reuse the existing sender PEP first; organization scope can only narrow it, never broaden it.
  const senderAllowed = new Set(allowedFromMailboxes(user, null).map((row) => row.brand));
  if (!organization.managed || !organization.person) return definitions
    .map((brand) => brand.code)
    .filter((code) => senderAllowed.has(code));

  const departmentHead = departmentHeadAccessForUser(user);
  if (departmentHead?.company_wide && departmentHead.brand_scope === "all") return definitions
    .map((brand) => brand.code)
    .filter((code) => senderAllowed.has(code));

  const db = postgresPool();
  const now = nowIso();
  const unitIds = organization.membership_unit_ids;
  const rows = await postgresQuery<{ brand_id: string | null }>(
    `SELECT brand_id FROM scope_memberships WHERE status='active' AND brand_id IS NOT NULL
      AND (effective_from IS NULL OR effective_from<=$1) AND (effective_to IS NULL OR effective_to>$1)
      AND ((subject_type='person' AND subject_id=$2) OR (subject_type='organization_unit' AND subject_id=ANY($3::text[])))`,
    [now, organization.person.person_ref, unitIds],
  );
  const scoped = new Set(rows.map((row) => settingsBrandCode(row.brand_id, definitions)).filter((code): code is string => Boolean(code)));
  return definitions.map((brand) => brand.code).filter((code) => senderAllowed.has(code) && scoped.has(code));
}

async function settingsMailboxes(user: AppUser, definitions = settingsBrandDefinitions()): Promise<SettingsMailbox[]> {
  const rows = (await postgresPool().query<Row>(`SELECT b.mailbox_email,b.mailbox_id,b.status,b.is_default,o.brand AS owner_brand,o.status AS owner_status
       FROM user_starry_bindings b
       LEFT JOIN mailbox_owners o ON lower(o.email)=lower(b.mailbox_email)
      WHERE b.user_id=$1
      ORDER BY b.is_default DESC,b.updated_at ASC,lower(b.mailbox_email)`, [user.id])).rows as Array<Row>;
  return rows.map((row) => {
    const email = String(row.mailbox_email || "").trim().toLowerCase();
    const brand = settingsBrandCode(row.owner_brand, definitions) || "";
    const rawStatus = String(row.status || "connected");
    const ownerActive = !row.owner_brand || String(row.owner_status || "active") === "active";
    // Public status is a closed enum; unknown/revoked states never become usable.
    const status = rawStatus === "expired" ? "expired"
      : rawStatus === "connected" && brand && ownerActive ? "connected" : "unverified";
    return {
      id: String(row.mailbox_id || email),
      email,
      brand,
      status,
      is_default: Boolean(Number(row.is_default || 0)),
    };
  }).filter((mailbox) => Boolean(mailbox.email));
}

function selectableSettingsMailbox(user: AppUser, mailbox: SettingsMailbox | undefined, brand: string): boolean {
  if (!mailbox || mailbox.status !== "connected" || !mailbox.brand || mailbox.brand !== brand) return false;
  return authorizedSenderBrand(mailbox.email, user, brand)?.brand === brand;
}

/** Never return unknown historical preference JSON; selected brand/mailbox remains valid only under current authority. */
function settingsPreferences(
  user: AppUser,
  row: Row | undefined,
  brands: string[],
  mailboxes: SettingsMailbox[],
): Json {
  const parsed = parseJson(row?.preferences, {});
  const stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  const preferences: Json = { analytics_cookies: Boolean(row?.analytics_cookies) };
  for (const [key, allowed] of Object.entries(SETTINGS_ENUM_PREFERENCES)) {
    if (allowed.includes(String((stored as Json)[key] || ""))) preferences[key] = String((stored as Json)[key]);
  }
  for (const key of SETTINGS_BOOLEAN_PREFERENCES) {
    if (key !== "analytics_cookies" && typeof (stored as Json)[key] === "boolean") preferences[key] = (stored as Json)[key];
  }
  const defaultBrand = String((stored as Json).default_brand || "");
  preferences.default_brand = brands.includes(defaultBrand) ? defaultBrand : "";
  const defaultMailbox = String((stored as Json).default_mailbox || "").trim().toLowerCase();
  const mailbox = mailboxes.find((candidate) => candidate.email === defaultMailbox && candidate.is_default);
  preferences.default_mailbox = brands.includes(defaultBrand) && selectableSettingsMailbox(user, mailbox, defaultBrand) ? defaultMailbox : "";
  return preferences;
}

async function settingsProfile(user: AppUser, organization: SettingsOrganization): Promise<Json> {
  const membership = organization.membership;
  const units = membership ? (await listOrganizationUnits(membership.company_id)) : [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const path: string[] = [];
  const seen = new Set<string>();
  let unit = membership ? byId.get(membership.org_unit_id) : undefined;
  while (unit && !seen.has(unit.id)) {
    seen.add(unit.id);
    path.unshift(unit.display_name);
    unit = unit.parent_id ? byId.get(unit.parent_id) : undefined;
  }
  // Department heads establish organization authority but are not necessarily a direct manager.
  const manager = (await postgresPool().query<Row>("SELECT name FROM users WHERE id=(SELECT manager_user_id FROM users WHERE id=$1)", [user.id])).rows[0] as { name?: string } | undefined;
  return {
    name: organization.managed ? organization.person?.display_name || "" : user.name,
    email: organization.managed ? organization.person?.email || "" : user.email || "",
    phone: user.phone || "",
    employee_no: organization.person?.employee_no || "",
    position: membership?.position || "",
    company_name: membership ? organizationCompanyName(membership.company_id) : "",
    organization_path: path,
    manager_name: String(manager?.name || ""),
    managed: organization.managed,
  };
}

async function settingsContext(user: AppUser): Promise<Json> {
  const definitions = settingsBrandDefinitions();
  const organization = (await settingsOrganization(user));
  const authorizedBrands = (await settingsAuthorizedBrands(user, organization, definitions));
  const mailboxes = (await settingsMailboxes(user, definitions));
  const preferenceRow = (await postgresPool().query<Row>("SELECT * FROM user_preferences WHERE user_id=$1", [user.id])).rows[0] as Row | undefined;
  return {
    profile: (await settingsProfile(user, organization)),
    brands: definitions.filter((brand) => authorizedBrands.includes(brand.code)).map((brand) => ({ id: brand.code, label: brand.label })),
    mailboxes,
    preferences: settingsPreferences(user, preferenceRow, authorizedBrands, mailboxes),
    editable_fields: organization.managed ? [] : ["name", "email", "phone"],
  };
}

enterprise.get("/admin/organization-people", async (c) => {
  requireAdmin();
  const memberships = new Map(
    (await listOrganizationMemberships())
      .filter((row) => row.relation === "primary" && row.status === "active")
      .map((row) => [row.person_ref, row]),
  );
  const people = (await listOrganizationPeople())
    .map((person) => {
      const membership = memberships.get(person.person_ref);
      return {
        person_ref: person.person_ref,
        display_name: person.display_name,
        avatar_url: person.avatar_url,
        title: membership?.position || null,
        org_unit_id: membership?.org_unit_id || null,
        user_id: person.user_id,
      };
    })
    .sort((a, b) => (a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0));
  return c.json({ people });
});

enterprise.get("/admin/users", async () => {
  requireAdmin();
  return Response.json(await pgEnterpriseAccounts());

});

enterprise.post("/admin/users", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const username = String(body.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,100}$/.test(username)) throw new HttpFail(400, "invalid username");
  const unitId = String(body.site || "").trim();
  if (unitId && !(await listOrganizationUnits()).some((unit) => unit.id === unitId && unit.status === "active")) {
    throw new HttpFail(400, "请选择有效组织单元");
  }
  const id = nid("usr");
  const now = nowIso();
  const passwordHash = await hashPassword(String(body.password || ""));
  const created = await pgCreateOrganizationUser({ id, username, name: String(body.name || username), passwordHash, roles: roles(body.roles || ["employee"]), brands: Array.isArray(body.brands) ? body.brands.map(String) : [], site: unitId, position: String(body.position || ""), managerUserId: body.manager_user_id ? String(body.manager_user_id) : null, active: body.active !== false, email: String(body.email || ""), phone: String(body.phone || ""), now });
  if (unitId) await pgSyncOrganizationMembership(id, unitId, now);
await pgAudit(admin.id, "admin.user.create", { user_id: id }, nowIso());
return c.json({ ...created, password_hash: undefined }, 201);

});

enterprise.get("/admin/users/:uid", async (c) => {
  requireAdmin();
  return c.json(await pgEnterpriseAccount(c.req.param("uid")));

});

enterprise.get("/admin/users/:uid/context", async (c) => {
  requireAdmin();
  return c.json(await pgEnterpriseEmployeeContext(c.req.param("uid")));

});

enterprise.get("/admin/users/:uid/tools", async (c) => {
  requireAdmin();
  const row = await pgEnterpriseAccount(c.req.param("uid"));
const granted = new Set(Array.isArray(row.skill_grants) ? row.skill_grants.map(String) : []);
return c.json(projectEmployeeTools(granted));

});

enterprise.patch("/admin/users/:uid", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  const before = (await userById(uid));
  const body = (await c.req.json()) as Json;
  // 只有组织真的变了才校验并同步权威成员关系；原样回传的旧 site（如「深圳站」）不得清空现有组织归属。
  const siteChanged = body.site !== undefined && String(body.site || "") !== String(before.site || "");
  if (siteChanged && String(body.site || "") &&
      !(await listOrganizationUnits()).some((unit) => unit.id === String(body.site) && unit.status === "active")) {
    throw new HttpFail(400, "请选择有效组织单元");
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.email !== undefined) {
    const email = String(body.email || "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpFail(400, "invalid email");
    const owner = email ? (await postgresPool().query<Row>("SELECT id FROM users WHERE lower(email)=$1 OR lower(username)=$2", [email, email])).rows[0] as { id: string } | undefined : undefined;
    if (owner && owner.id !== uid) throw new HttpFail(409, "email already used");
    sets.push("email=?"); values.push(email);
  }
  for (const field of ["name", "site", "position", "manager_user_id"] as const) {
    if (body[field] !== undefined) { sets.push(`${field}=?`); values.push(body[field] || null); }
  }
  if (body.roles !== undefined) { sets.push("roles=?"); values.push(JSON.stringify(roles(body.roles))); }
  if (body.brands !== undefined) { sets.push("brands=?"); values.push(JSON.stringify(body.brands)); }
  if (body.active !== undefined) { sets.push("active=?"); values.push(body.active ? 1 : 0); }
  if (body.password !== undefined) { sets.push("password_hash=?"); values.push(await hashPassword(String(body.password))); }
  if (!sets.length) return c.json((await safeUser((await userById(uid)))));
  sets.push("updated_at=?"); values.push(nowIso(), uid);
  const changes: Record<string, unknown> = {};
for (const [field, value] of Object.entries(body)) { if (["email","name","site","position","manager_user_id","roles","brands","active","password"].includes(field)) changes[field === "password" ? "password_hash" : field] = field === "roles" || field === "brands" ? JSON.stringify(Array.isArray(value) ? value.map(String) : []) : field === "password" ? await hashPassword(String(value)) : value === "active" ? (value ? 1 : 0) : value || null; }
await pgUpdateOrganizationUser(uid, changes);
if (body.password !== undefined) { const { pgRevokeUserSessions } = await import("../postgres/organization-repository.js"); await pgRevokeUserSessions(uid); }
  if (siteChanged || body.name !== undefined || body.email !== undefined) {
    const site = String((await userById(uid)).site || "");
    const validUnit = Boolean(site) && (await listOrganizationUnits()).some((unit) => unit.id === site);
    if (validUnit || (siteChanged && !site)) await pgSyncOrganizationMembership(uid, site || null, nowIso());
  }
  await pgAudit(admin.id, "admin.user.update", { user_id: uid, fields: sets.map((s) => s.split("=")[0]) }, nowIso());
  return c.json({ ...(await pgUserById(uid)), password_hash: undefined });
});

enterprise.delete("/admin/users/:uid", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  if (uid === admin.id) throw new HttpFail(409, "cannot deactivate current account");
  (await userById(uid));
  await pgDeactivateOrganizationUser(uid, nowIso());
  await pgAudit(admin.id, "admin.user.deactivate", { user_id: uid }, nowIso());
  return c.json({ ok: true, deactivated: true });
});

enterprise.put("/admin/users/:uid/skills/:skill", (c) => {
  requireAdmin();
  throw new HttpFail(410, "逐人技能授权已退役；请在 Agent 页绑定人员并装配技能");
});


enterprise.delete("/admin/users/:uid/skills/:skill", (c) => {
  requireAdmin();
  throw new HttpFail(410, "逐人技能授权已退役；请在 Agent 页管理绑定");
});
enterprise.put("/admin/users/:uid/skills", (c) => {
  requireAdmin();
  throw new HttpFail(410, "逐人技能授权已退役；请在 Agent 页管理绑定");
});

enterprise.get("/admin/connectors", async (c) => {
  requireAdmin();
  return c.json((await postgresPool().query<Row>("SELECT * FROM connectors ORDER BY lower(label), id", [])).rows.map(connectorPublic));
});

enterprise.get("/connectors", async (c) => {
  const user = scopedUser();
  if (authDisabled()) {
    return c.json(((await postgresPool().query<Row>("SELECT id,label FROM connectors WHERE enabled=1 ORDER BY lower(label), id", [])).rows).map((row) => connectorEmployee({ ...(row as Row), access: "write" })));
  }
  if (!user) throw new HttpFail(401, "authentication required");
  return c.json(((await postgresPool().query<Row>(`SELECT c.id,c.label,g.access FROM connectors c
      JOIN user_connector_grants g ON g.connector_id=c.id
     WHERE g.user_id=$1 AND c.enabled=1 ORDER BY lower(c.label), c.id`, [user.id])).rows).map(connectorEmployee));
});

enterprise.post("/admin/connectors", async (c) => {
  const admin = requireAdmin();
  const body = (await c.req.json()) as Json;
  const id = requireManagedConnector(String(body.id || "").trim());
  if (isBuiltinConnectorId(id)) throw new HttpFail(409, { code: "managed_connector_already_in_catalog", connector_id: id });
  const label = String(body.label || "").trim();
  const purpose = String(body.purpose || "").trim();
  if (!label || label.length > 120 || !purpose || purpose.length > 280) {
    throw new HttpFail(400, { code: "managed_connector_label_and_purpose_required" });
  }
  // 接入类型由创建入口决定（DESIGN.md §7.2 连接器设置向导）；无运行时配置的草稿也保持自己的分类。
  const declaredProtocol = body.protocol === undefined ? null : String(body.protocol);
  if (declaredProtocol !== null && declaredProtocol !== "mcp" && declaredProtocol !== "http") {
    throw new HttpFail(400, { code: "managed_connector_protocol_invalid" });
  }
  const now = nowIso();
  try {
    await pgCreateConnector({ id, label, purpose, protocol: declaredProtocol, now });
  } catch {
    throw new HttpFail(409, { code: "managed_connector_already_exists", connector_id: id });
  }
  await pgAudit(admin.id, "admin.connector.create", { connector_id: id, label, purpose, ...(declaredProtocol ? { protocol: declaredProtocol } : {}) }, nowIso());
  return c.json((await connectorPublic(await (async()=>{ const { pgConnectorById } = await import("../postgres/connector-authorization-repository.js"); return pgConnectorById(id); })())), 201);
});

enterprise.patch("/admin/connectors/:id", async (c) => {
  const admin = requireAdmin();
  const id = c.req.param("id");
  requireManagedConnector(id);
  const body = (await c.req.json()) as Json;
  if ("credential" in body || "secret" in body || "password" in body) throw new HttpFail(400, "only credential_ref may be stored");
  const changes: Record<string, unknown> = {};
  for (const field of ["label", "purpose", "status", "credential_ref"] as const) {
    if (body[field] !== undefined) changes[field] = body[field];
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new HttpFail(400, { code: "connector_enabled_must_be_boolean" });
    changes.enabled = body.enabled ? 1 : 0;
  }
  if (!Object.keys(changes).length) throw new HttpFail(400, "no changes");
  const updated = await postgresTransaction(async (client) => {
    // Enabling is a single basis transaction: locks prevent config/probe/mount changes
    // between verification and the persistent enabled flag.
    if (changes.enabled === 1) await assertConnectorEnableBasis(client, id);
    const row = await pgUpdateConnectorInTransaction(client, id, changes, nowIso());
    if (!row) throw new HttpFail(404, "connector not found");
    return row;
  }, { isolation: "SERIALIZABLE" });
  await pgAudit(admin.id, "admin.connector.update", { connector_id: id }, nowIso());
  return c.json((await connectorPublic(updated)));
});
enterprise.delete("/admin/connectors/:id", async (c) => {
  const admin = requireAdmin();
  const connectorId = requireManagedConnector(c.req.param("id"));
  if (isBuiltinConnectorId(connectorId)) throw new HttpFail(405, { code: "builtin_managed_connector_cannot_delete" });
  if (!(await pgDeleteConnector(connectorId))) throw new HttpFail(404, "connector not found");
  await pgAudit(admin.id, "admin.connector.delete", { connector_id: connectorId }, nowIso());
  return c.json({ ok: true });
});

/** 已确认决策①：审批角色分职位角色/指定自然人，数据模型区分、界面统一展示。 */
export const APPROVAL_ROLE_KINDS: Record<string, "position" | "named"> = {
  lead: "position",
  manager: "position",
  zhang: "named",
};

enterprise.put("/admin/users/:uid/approval-roles/:role", async (c) => {
  const admin = requireAdmin();
  (await userById(c.req.param("uid")));
  const role = c.req.param("role");
  const kind = APPROVAL_ROLE_KINDS[role] || "position";
  await pgBindApprovalRole(c.req.param("uid"), role, kind, nowIso());
  await pgAudit(admin.id, "admin.approval_role.bind", { user_id: c.req.param("uid"), role, role_kind: kind }, nowIso());
  return c.json({ ok: true });
});

enterprise.delete("/admin/users/:uid/approval-roles/:role", async (c) => {
  const admin = requireAdmin();
  await pgUnbindApprovalRole(c.req.param("uid"), c.req.param("role"));
  await pgAudit(admin.id, "admin.approval_role.unbind", { user_id: c.req.param("uid"), role: c.req.param("role") }, nowIso());
  return c.json({ ok: true });
});

enterprise.put("/admin/users/:uid/approval-roles", async (c) => {
  const admin = requireAdmin();
  const uid = c.req.param("uid");
  (await userById(uid));
  const body = (await c.req.json()) as Json;
  const values = Array.isArray(body.roles) ? body.roles.map(String) : [];
  const allowed = new Set(["lead", "manager", "zhang"]);
  if (values.some((role) => !allowed.has(role))) throw new HttpFail(400, "invalid approval role");
  const grants: Array<{ role: string; valid_from?: string; valid_to?: string }> = Array.isArray(body.grants)
    ? (body.grants as Array<{ role?: unknown; valid_from?: unknown; valid_to?: unknown }>)
        .map((g) => ({
          role: String(g.role || ""),
          ...(g.valid_from ? { valid_from: String(g.valid_from) } : {}),
          ...(g.valid_to ? { valid_to: String(g.valid_to) } : {}),
        }))
    : values.map((role) => ({ role }));
  for (const g of grants) {
    if (!allowed.has(g.role)) throw new HttpFail(400, "invalid approval role");
  }
  await pgSetApprovalRoles(uid, grants.map(g=>({role:g.role,kind:APPROVAL_ROLE_KINDS[g.role]||"position",validFrom:g.valid_from||null,validTo:g.valid_to||null})), nowIso());
  await pgAudit(admin.id, "admin.approval_roles.replace", { user_id: uid, roles: values }, nowIso());
  return c.json({ ok: true, user_id: uid, roles: values });
});

enterprise.get("/me/settings-context", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  return c.json((await settingsContext(user)));
});

enterprise.get("/preferences", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  return c.json(((await settingsContext(user)) as Record<string, Json>).preferences);
});

enterprise.patch("/preferences", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Record<string, unknown>;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpFail(400, "preferences must be an object");
  const fields = Object.keys(body);
  if (fields.some((key) => !SETTINGS_PREFERENCE_KEYS.has(key))) throw new HttpFail(400, "unknown preference field");
  const current = (await postgresPool().query<Row>("SELECT * FROM user_preferences WHERE user_id=$1", [user.id])).rows[0] as Row | undefined;
  const definitions = settingsBrandDefinitions();
  const brands = (await settingsAuthorizedBrands(user, (await settingsOrganization(user)), definitions));
  const mailboxes = (await settingsMailboxes(user, definitions));
  const stored = settingsPreferences(user, current, brands, mailboxes) as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const next: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(SETTINGS_ENUM_PREFERENCES)) {
    const value = has(key) ? body[key] : stored[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !allowed.includes(value)) throw new HttpFail(400, `invalid ${key}`);
    next[key] = value;
  }
  for (const key of SETTINGS_BOOLEAN_PREFERENCES) {
    if (key === "analytics_cookies") continue;
    const value = has(key) ? body[key] : stored[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") throw new HttpFail(400, `invalid ${key}`);
    next[key] = value;
  }
  const analytics = has("analytics_cookies") ? body.analytics_cookies : Boolean(current?.analytics_cookies);
  if (typeof analytics !== "boolean") throw new HttpFail(400, "invalid analytics_cookies");
  const requestedBrand = has("default_brand") ? body.default_brand : stored.default_brand;
  if (requestedBrand != null && typeof requestedBrand !== "string") throw new HttpFail(400, "invalid default_brand");
  const defaultBrand = requestedBrand == null || requestedBrand === "" ? "" : settingsBrandCode(requestedBrand, definitions);
  if (requestedBrand != null && requestedBrand !== "" && (!defaultBrand || !brands.includes(defaultBrand))) {
    throw new HttpFail(400, "invalid default_brand");
  }
  next.default_brand = defaultBrand || "";
  let defaultMailbox = String(stored.default_mailbox || "").trim().toLowerCase();
  let selected: SettingsMailbox | undefined;
  if (has("default_mailbox")) {
    const requested = body.default_mailbox;
    if (requested == null || requested === "") defaultMailbox = "";
    else if (typeof requested !== "string") throw new HttpFail(400, "invalid default_mailbox");
    else {
      selected = mailboxes.find((mailbox) => mailbox.email === requested.trim().toLowerCase() || mailbox.id === requested.trim());
      if (!selected || !defaultBrand || selected.brand !== defaultBrand || !brands.includes(defaultBrand) ||
        !selectableSettingsMailbox(user, selected, defaultBrand)) {
        throw new HttpFail(400, "default_mailbox must be a current authorized connected mailbox for default_brand");
      }
      defaultMailbox = selected.email;
    }
  }
  // Brand changes require a compatible explicit/current selection; never choose a fallback mailbox.
  if (defaultMailbox) {
    const mailbox = selected || mailboxes.find((candidate) => candidate.email === defaultMailbox);
    if (!defaultBrand || !mailbox || mailbox.brand !== defaultBrand || !brands.includes(defaultBrand) ||
      !selectableSettingsMailbox(user, mailbox, defaultBrand)) {
      throw new HttpFail(400, "select a current authorized mailbox matching default_brand");
    }
    next.default_mailbox = defaultMailbox;
  }
  next.default_mailbox = defaultMailbox;
  const updated = await pgUpdatePreferences(user.id, Boolean(analytics), next, nowIso(), has("default_mailbox") ? defaultMailbox : undefined);
await pgAudit(user.id, "preference.update", { fields }, nowIso());
return c.json(settingsPreferences(user, updated, brands, (await settingsMailboxes(user, definitions))));

});

enterprise.get("/me/settings-sessions", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const rows = (await postgresPool().query<Row>("SELECT id,title,archived_at FROM sessions WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id", [user.id])).rows as Row[];
  return c.json(rows.map((row) => ({ id: String(row.id), title: String(row.title || ""), archived_at: row.archived_at ? String(row.archived_at) : null })));
});

async function memoryRow(id: string): Promise<Row> {
  const row = (await postgresPool().query<Row>("SELECT * FROM memory_entries WHERE id=$1", [id])).rows[0] as Row | undefined;
  if (!row) throw new HttpFail(404, "memory not found");
  return row;
}
function settingsMemory(row: Row): Json {
  return { id: String(row.id), title: String(row.title || ""), body_md: String(row.body_md || ""),
    scope: String(row.scope || "private"), enabled: Boolean(Number(row.enabled)), version: Number(row.version || 1), editable: true };
}

function assertMemoryOwner(row: Row): void {
  const user = scopedUser();
  if (!user || (String(row.owner_user_id) !== user.id && !isAdmin(user))) throw new HttpFail(403, "memory owner required");
}

enterprise.get("/memory", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const rows = (await postgresPool().query<Row>("SELECT * FROM memory_entries WHERE owner_user_id=$1 ORDER BY updated_at DESC", [user.id])).rows as Row[];
  return c.json(rows.map(settingsMemory));
});

enterprise.post("/memory", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const body = (await c.req.json()) as Json;
  const scope = String(body.scope === "workspace" ? "team" : body.scope || "private");
  if (scope === "team") throw new HttpFail(409, "team memory publishing is temporarily unavailable");
  if (scope !== "private") throw new HttpFail(400, "scope must be private");
  const id = nid("mem"); const now = nowIso();
  (await postgresPool().query<Row>("INSERT INTO memory_entries (id,owner_user_id,title,body_md,scope,enabled,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, user.id, String(body.title || "记忆"), String(body.body_md ?? body.content ?? ""), scope, body.enabled === false ? 0 : 1, 1, now, now]));
  await pgAudit(user.id, "memory.create", { memory_id: id, scope }, nowIso());
  return c.json(settingsMemory((await memoryRow(id))), 201);
});

enterprise.patch("/memory/:id", async (c) => {
  const user = scopedUser()!;
  const row = (await memoryRow(c.req.param("id"))); assertMemoryOwner(row);
  const body = (await c.req.json()) as Json;
  const scope = body.scope === undefined ? row.scope : String(body.scope === "workspace" ? "team" : body.scope);
  if (!["private", "team"].includes(String(scope))) throw new HttpFail(400, "scope must be private/team");
  if (scope === "team" && String(row.scope) !== "team") throw new HttpFail(409, "team memory publishing is temporarily unavailable");
  (await postgresPool().query<Row>("UPDATE memory_entries SET title=$1,body_md=$2,scope=$3,enabled=$4,version=version+1,updated_at=$5 WHERE id=$6", [body.title === undefined ? row.title : String(body.title), body.body_md === undefined && body.content === undefined ? row.body_md : String(body.body_md ?? body.content), scope, body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0, nowIso(), row.id]));
  await pgAudit(user.id, "memory.update", { memory_id: row.id }, nowIso());
  return c.json(settingsMemory((await memoryRow(String(row.id)))));
});

enterprise.delete("/memory/:id", async (c) => {
  const user = scopedUser()!;
  const row = (await memoryRow(c.req.param("id"))); assertMemoryOwner(row);
  (await postgresPool().query<Row>("DELETE FROM memory_entries WHERE id=$1", [row.id]));
  await pgAudit(user.id, "memory.delete", { memory_id: row.id }, nowIso());
  return c.json({ ok: true });
});

export async function assertSessionAccess(sessionId: string, includeDeleted = false): Promise<Row> {
  const row = (await postgresPool().query<Row>("SELECT * FROM sessions WHERE id=$1", [sessionId])).rows[0] as Row | undefined;
  if (!row || (!includeDeleted && row.deleted_at)) throw new HttpFail(404, "session not found");
  if (authDisabled()) return row;
  const user = scopedUser();
  if (!user || (!isAdmin(user) && row.owner_user_id !== user.id)) throw new HttpFail(404, "session not found");
  return row;
}

enterprise.post("/sessions/:sid/archive", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const archivedAt = nowIso();
  (await postgresPool().query<Row>("UPDATE sessions SET archived_at=$1,updated_at=$2 WHERE id=$3", [archivedAt, archivedAt, row.id]));
  await pgAudit(user?.id || "demo", "session.archive", { session_id: row.id }, nowIso());
  return c.json({ ok: true, archived_at: archivedAt });
});

enterprise.post("/sessions/:sid/unarchive", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const updatedAt = nowIso();
  (await postgresPool().query<Row>("UPDATE sessions SET archived_at=NULL,updated_at=$1 WHERE id=$2", [updatedAt, row.id]));
  await pgAudit(user?.id || "demo", "session.unarchive", { session_id: row.id }, nowIso());
  return c.json({ ok: true, archived_at: null });
});

async function sessionSnapshot(sid: string, includeInternal = true): Promise<Json> {
  const storedSession = (await postgresPool().query<Row>("SELECT * FROM sessions WHERE id=$1", [sid])).rows[0] as Row;
  const session = includeInternal
    ? storedSession
    : {
        id: storedSession.id,
        title: storedSession.title,
        created_at: storedSession.created_at,
        updated_at: storedSession.updated_at,
      };
  const rows = (await postgresPool().query<Row>("SELECT * FROM messages WHERE session_id=$1 ORDER BY created_at,id", [sid])).rows as Row[];
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

enterprise.get("/sessions/:sid/export", async (c) => {
  const row = (await assertSessionAccess(c.req.param("sid")));
  const format = c.req.query("format") || "json";
  const snapshot = (await sessionSnapshot(String(row.id)));
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

enterprise.delete("/sessions/:sid", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const messages = (await postgresPool().query<Row>("SELECT payload FROM messages WHERE session_id=$1", [row.id])).rows as Row[];
  const attributable = new Set<string>();
  for (const message of messages) {
    const payload = parseJson(message.payload, {}) as Json;
    for (const attachment of (Array.isArray(payload.attachments) ? payload.attachments : []) as Json[]) {
      const file = path.resolve(String(attachment.path || ""));
      const root = path.resolve(uploadsDir()) + path.sep;
      if (file.startsWith(root)) attributable.add(file);
    }
  }
  const boxes = ((await postgresPool().query<Row>("SELECT box_path FROM workers WHERE session_id=$1", [row.id])).rows as Row[])
    .map((worker) => String(worker.box_path || "")).filter(Boolean);
  await postgresTransaction(async (db) => {
    (await db.query<Row>("DELETE FROM session_shares WHERE session_id=$1", [row.id]));
    (await db.query<Row>("DELETE FROM messages WHERE session_id=$1", [row.id]));
    (await db.query<Row>("DELETE FROM drafts WHERE session_id=$1", [row.id]));
    (await db.query<Row>("DELETE FROM workers WHERE session_id=$1", [row.id]));
    (await db.query<Row>("UPDATE sessions SET deleted_at=$1,archived_at=COALESCE(archived_at,$2),thread_ref=NULL,updated_at=$3 WHERE id=$4", [nowIso(), nowIso(), nowIso(), row.id]));
  });
  const boxesRoot = path.resolve(boxDir()) + path.sep;
  for (const box of boxes) {
    const resolved = path.resolve(box);
    if (resolved.startsWith(boxesRoot)) fs.rmSync(resolved, { recursive: true, force: true });
  }
  for (const file of attributable) {
    const other = (await postgresPool().query<Row>("SELECT 1 FROM messages WHERE payload LIKE $1 LIMIT 1", [`%${file}%`])).rows[0];
    if (!other) fs.rmSync(file, { force: true });
  }
  await pgAudit(user?.id || "demo", "session.delete", { session_id: row.id, stage_transitions: "retained_immutable" }, nowIso());
  return c.json({
    ok: true,
    soft_deleted: true,
    cleaned: ["messages", "drafts", "workers", "boxes", "attributable_uploads"],
    immutable_data: { stage_transitions: "retained; immutable compliance records are not deleted with a conversation" },
  });
});

enterprise.post("/sessions/:sid/share", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const body = (await c.req.json().catch(() => ({}))) as Json;
  const expiresIn = Math.min(Math.max(Number(body.expires_in_seconds || 86400), 60), 30 * 86400);
  const token = randomBytes(32).toString("base64url");
  const id = nid("shr");
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  (await postgresPool().query<Row>("INSERT INTO session_shares (id,session_id,token_hash,expires_at,include_internal,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, row.id, tokenDigest(token), expiresAt, body.include_internal === true ? 1 : 0, user?.id || "demo", nowIso()]));
  await pgAudit(user?.id || "demo", "session.share.create", { share_id: id, session_id: row.id, expires_at: expiresAt }, nowIso());
  return c.json({ id, token, expires_at: expiresAt, read_only: true, include_internal: body.include_internal === true }, 201);
});

enterprise.delete("/sessions/:sid/share/:shareId", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const result = (await postgresPool().query<Row>("UPDATE session_shares SET revoked_at=$1 WHERE id=$2 AND session_id=$3", [nowIso(), c.req.param("shareId"), row.id]));
  if (!result.rowCount) throw new HttpFail(404, "share not found");
  await pgAudit(user?.id || "demo", "session.share.revoke", { share_id: c.req.param("shareId"), session_id: row.id }, nowIso());
  return c.json({ ok: true, revoked: true });
});

enterprise.delete("/sessions/:sid/share", async (c) => {
  const user = scopedUser();
  const row = (await assertSessionAccess(c.req.param("sid")));
  const revokedAt = nowIso();
  const result = (await postgresPool().query<Row>("UPDATE session_shares SET revoked_at=$1 WHERE session_id=$2 AND revoked_at IS NULL", [revokedAt, row.id]));
  await pgAudit(user?.id || "demo", "session.share.revoke_all", { session_id: row.id, count: result.rowCount }, nowIso());
  return c.json({ ok: true, revoked: result.rowCount });
});

enterprise.get("/shared/:token", async (c) => {
  const row = (await postgresPool().query<Row>(`SELECT * FROM session_shares WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>$2`, [tokenDigest(c.req.param("token")), nowIso()])).rows[0] as Row | undefined;
  if (!row) throw new HttpFail(404, "share unavailable");
  const { authorizedTaskSession } = await import("../ticket-domain/task-collaboration-session.js");
  await authorizedTaskSession(scopedUser()?.id || "",String(row.session_id));
  return c.json({ ...(await sessionSnapshot(String(row.session_id), Boolean(row.include_internal))), read_only: true, expires_at: row.expires_at });
});

enterprise.get("/me/data-summary", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, "authentication required");
  const db = postgresPool();
  const count = async (sql: string): Promise<number> => Number(((await db.query<Row>(sql, [user.id])).rows[0] as { n: number }).n);
  return c.json({
    sessions: (await count("SELECT COUNT(*) AS n FROM sessions WHERE owner_user_id=$1 AND deleted_at IS NULL")),
    archived_sessions: (await count("SELECT COUNT(*) AS n FROM sessions WHERE owner_user_id=$1 AND archived_at IS NOT NULL AND deleted_at IS NULL")),
    memories: (await count("SELECT COUNT(*) AS n FROM memory_entries WHERE owner_user_id=$1")),
    exam_attempts: (await count("SELECT COUNT(*) AS n FROM exam_attempts WHERE user_id=$1")),
    database_bytes: true
      ? Number(((await db.query<Row>("SELECT pg_database_size(current_database()) AS bytes", [])).rows[0] as { bytes: number }).bytes)
      : pathBytes(String(process.env.LINGONG_DB || path.join(process.env.LINGONG_DATA || path.dirname(uploadsDir()), "lingong.db"))),
    uploads_bytes: pathBytes(uploadsDir()),
    worker_boxes_bytes: pathBytes(boxDir()),
    retention_policy: (await db.query<Row>("SELECT session_days,audit_days FROM retention_policy WHERE id=1", [])).rows[0],
    stage_transitions: "retained as immutable compliance records when conversation data is deleted",
  });
});

enterprise.get("/admin/retention-policy", async (c) => {
  requireAdmin();
  return c.json((await postgresPool().query<Row>("SELECT * FROM retention_policy WHERE id=1", [])).rows[0]);
});

enterprise.patch("/admin/retention-policy", async (c) => {
  const admin = requireAdmin();
  const current = (await postgresPool().query<Row>("SELECT * FROM retention_policy WHERE id=1", [])).rows[0] as Row;
  const body = (await c.req.json()) as Json;
  const sessionDays = Number(body.session_days ?? current.session_days);
  const auditDays = Number(body.audit_days ?? current.audit_days);
  if (sessionDays < 1 || auditDays < 1) throw new HttpFail(400, "retention days must be positive");
  (await postgresPool().query<Row>("UPDATE retention_policy SET session_days=$1,audit_days=$2,updated_at=$3 WHERE id=1", [sessionDays, auditDays, nowIso()]));
  await pgAudit(admin.id, "admin.retention.update", { session_days: sessionDays, audit_days: auditDays }, nowIso());
  return c.json((await postgresPool().query<Row>("SELECT * FROM retention_policy WHERE id=1", [])).rows[0]);
});

enterprise.get("/privacy/cookies", async (c) => {
  const user = scopedUser();
  let analytics = false;
  if (user) {
    const row = (await postgresPool().query<Row>("SELECT analytics_cookies FROM user_preferences WHERE user_id=$1", [user.id])).rows[0] as Row | undefined;
    analytics = Boolean(row?.analytics_cookies);
  }
  return c.json({
    essential: [{ name: "lingong_session", purpose: "authentication", http_only: true, same_site: "Lax" }],
    analytics_cookies: analytics,
    nonessential_cookies_set: false,
  });
});
