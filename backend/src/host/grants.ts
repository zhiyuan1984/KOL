import { nid } from "../ids.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "./errors.js";
import { SKILL_CATALOG } from "./skills-catalog.js";
import { currentUser } from "./persona.js";

export type GrantScope = "org" | "team" | "user";

export type Directory = {
  orgs: { id: string; name: string }[];
  teams: { id: string; org_id: string; name: string }[];
  users: { id: string; handle: string; name: string; role: string }[];
};

export function directory(): Directory {
  const db = getConn();
  return {
    orgs: db.prepare("SELECT id, name FROM orgs ORDER BY id").all() as Directory["orgs"],
    teams: db.prepare("SELECT id, org_id, name FROM teams ORDER BY id").all() as Directory["teams"],
    users: db.prepare("SELECT id, handle, name, role FROM directory_users ORDER BY name").all() as Directory["users"],
  };
}

export function memberScopeIds(handle: string): { orgs: string[]; teams: string[] } {
  const rows = getConn()
    .prepare("SELECT scope, scope_id FROM memberships WHERE user_handle = ?")
    .all(handle) as { scope: string; scope_id: string }[];
  const orgs = rows.filter((r) => r.scope === "org").map((r) => r.scope_id);
  const teams = rows.filter((r) => r.scope === "team").map((r) => r.scope_id);
  return {
    orgs: orgs.length || teams.length ? orgs : ["org_litime"],
    teams,
  };
}

export function visibleSkillIds(handle?: string): Set<string> {
  const h = handle || currentUser().handle;
  const db = getConn();
  const n = db.prepare("SELECT COUNT(*) AS c FROM skill_grants").get() as { c: number };
  if (!n.c) return new Set(SKILL_CATALOG.map((s) => s.id));
  const mem = memberScopeIds(h);
  const ids = new Set<string>();
  const rows = db.prepare("SELECT skill_id, scope, scope_id FROM skill_grants").all() as {
    skill_id: string;
    scope: string;
    scope_id: string;
  }[];
  for (const r of rows) {
    if (r.scope === "org" && mem.orgs.includes(r.scope_id)) ids.add(r.skill_id);
    if (r.scope === "team" && mem.teams.includes(r.scope_id)) ids.add(r.skill_id);
    if (r.scope === "user" && r.scope_id === h) ids.add(r.skill_id);
  }
  return ids;
}

export function isSkillGranted(skillId: string, handle?: string): boolean {
  if (!SKILL_CATALOG.some((s) => s.id === skillId)) return true;
  const n = getConn().prepare("SELECT COUNT(*) AS c FROM skill_grants").get() as { c: number };
  if (!n.c) return true;
  return visibleSkillIds(handle).has(skillId);
}

export function grantsForSkill(skillId: string): { org: string[]; team: string[]; user: string[] } {
  const rows = getConn()
    .prepare("SELECT scope, scope_id FROM skill_grants WHERE skill_id = ?")
    .all(skillId) as { scope: GrantScope; scope_id: string }[];
  const out = { org: [] as string[], team: [] as string[], user: [] as string[] };
  for (const r of rows) {
    if (r.scope === "org") out.org.push(r.scope_id);
    if (r.scope === "team") out.team.push(r.scope_id);
    if (r.scope === "user") out.user.push(r.scope_id);
  }
  return out;
}

export function setSkillGrants(
  skillId: string,
  patch: { org?: string[]; team?: string[]; user?: string[] },
): { org: string[]; team: string[]; user: string[] } {
  if (!SKILL_CATALOG.some((s) => s.id === skillId)) throw new HttpFail(404, "unknown skill");
  const dir = directory();
  const orgOk = new Set(dir.orgs.map((o) => o.id));
  const teamOk = new Set(dir.teams.map((t) => t.id));
  const userOk = new Set(dir.users.map((u) => u.handle));
  const next = {
    org: [...new Set(patch.org || [])],
    team: [...new Set(patch.team || [])],
    user: [...new Set(patch.user || [])],
  };
  for (const id of next.org) if (!orgOk.has(id)) throw new HttpFail(400, "unknown org");
  for (const id of next.team) if (!teamOk.has(id)) throw new HttpFail(400, "unknown team");
  for (const id of next.user) if (!userOk.has(id)) throw new HttpFail(400, "unknown user");
  const ts = nowIso();
  const actor = currentUser().handle;
  const db = getConn();
  db.prepare("DELETE FROM skill_grants WHERE skill_id = ?").run(skillId);
  const ins = db.prepare(
    "INSERT INTO skill_grants (id, skill_id, scope, scope_id, granted_by, granted_at) VALUES (?,?,?,?,?,?)",
  );
  for (const id of next.org) ins.run(nid("gr"), skillId, "org", id, actor, ts);
  for (const id of next.team) ins.run(nid("gr"), skillId, "team", id, actor, ts);
  for (const id of next.user) ins.run(nid("gr"), skillId, "user", id, actor, ts);
  audit(actor, "skill.grant.save", { skill: skillId, ...next });
  return grantsForSkill(skillId);
}

export function seedDirectory(): void {
  const db = getConn();
  db.prepare("INSERT OR REPLACE INTO orgs (id, name) VALUES (?, ?)").run("org_litime", "LiTime");
  db.prepare("INSERT OR REPLACE INTO teams (id, org_id, name) VALUES (?, ?, ?)").run(
    "team_kol",
    "org_litime",
    "KOL 建联小队",
  );
  db.prepare("INSERT OR REPLACE INTO directory_users (id, handle, name, role) VALUES (?,?,?,?)").run(
    "sriphy",
    "sriphy",
    "鄢棽",
    "product_manager",
  );
  db.prepare("INSERT OR REPLACE INTO directory_users (id, handle, name, role) VALUES (?,?,?,?)").run(
    "usr_lead",
    "lead",
    "陈组长",
    "operator",
  );
  db.prepare("INSERT OR IGNORE INTO memberships (id, user_handle, scope, scope_id) VALUES (?,?,?,?)").run(
    "mem_sriphy_org",
    "sriphy",
    "org",
    "org_litime",
  );
  db.prepare("INSERT OR IGNORE INTO memberships (id, user_handle, scope, scope_id) VALUES (?,?,?,?)").run(
    "mem_sriphy_team",
    "sriphy",
    "team",
    "team_kol",
  );
  db.prepare("INSERT OR IGNORE INTO memberships (id, user_handle, scope, scope_id) VALUES (?,?,?,?)").run(
    "mem_lead_org",
    "lead",
    "org",
    "org_litime",
  );
  db.prepare("INSERT OR REPLACE INTO directory_users (id, handle, name, role) VALUES (?,?,?,?)").run(
    "usr_lingong",
    "lingong",
    "林工",
    "employee",
  );
  db.prepare("INSERT OR IGNORE INTO memberships (id, user_handle, scope, scope_id) VALUES (?,?,?,?)").run(
    "mem_lingong_org",
    "lingong",
    "org",
    "org_litime",
  );
  const ts = nowIso();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO skill_grants (id, skill_id, scope, scope_id, granted_by, granted_at) VALUES (?,?,?,?,?,?)",
  );
  for (const s of SKILL_CATALOG) {
    ins.run(`gr_org_${s.id}`, s.id, "org", "org_litime", "sriphy", ts);
  }
}
