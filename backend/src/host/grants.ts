import { nid } from "../ids.js";
import { audit, getConn, nowIso } from "../db.js";
import { HttpFail } from "./errors.js";
import { scopedUser, authDisabled, isAdmin } from "../auth.js";
import { canUseSkill, visibleSkillIdsForUser } from "../runtime/organization-tree.js";
import { skillCatalog } from "./skills-catalog.js";
import { currentUser } from "./persona.js";

export type GrantScope = "org" | "team" | "user";

export type Directory = {
  orgs: { id: string; name: string }[];
  teams: { id: string; org_id: string; name: string }[];
  users: { id: string; handle: string; name: string; role: string }[];
};

export async function directory(): Promise<Awaited<Directory>> {
  const db = getConn();
  return {
    orgs: (await db.query("SELECT id, name FROM orgs ORDER BY id",[])).rows as Directory["orgs"],
    teams: (await db.query("SELECT id, org_id, name FROM teams ORDER BY id",[])).rows as Directory["teams"],
    users: (await db.query("SELECT id, handle, name, role FROM directory_users ORDER BY name",[])).rows as Directory["users"],
  };
}

export async function memberScopeIds(handle: string): Promise<Awaited<{ orgs: string[]; teams: string[] }>> {
  const rows = (await getConn().query("SELECT scope, scope_id FROM memberships WHERE user_handle = $1",[handle])).rows as { scope: string; scope_id: string }[];
  const orgs = rows.filter((r) => r.scope === "org").map((r) => r.scope_id);
  const teams = rows.filter((r) => r.scope === "team").map((r) => r.scope_id);
  return {
    orgs: orgs.length || teams.length ? orgs : ["org_litime"],
    teams,
  };
}

/** 关闭鉴权的开发/测试态沿用既有放行口径；管理员保持与 requireSkill 一致的直通；其余按 Agent 使用资格派生。 */
export async function visibleSkillIds(userId?: string): Promise<Set<string>> {
  if (authDisabled() || isAdmin()) return new Set((await skillCatalog()).map((s) => s.id));
  return new Set((await visibleSkillIdsForUser(userId || scopedUser()?.id || null)));
}

export async function isSkillGranted(skillId: string, userId?: string): Promise<boolean> {
  if (authDisabled() || isAdmin()) return true;
  return (canUseSkill(userId || scopedUser()?.id || null, skillId));
}

export async function grantsForSkill(skillId: string): Promise<Awaited<{ org: string[]; team: string[]; user: string[] }>> {
  const rows = (await getConn().query("SELECT scope, scope_id FROM skill_grants WHERE skill_id = $1",[skillId])).rows as { scope: GrantScope; scope_id: string }[];
  const out = { org: [] as string[], team: [] as string[], user: [] as string[] };
  for (const r of rows) {
    if (r.scope === "org") out.org.push(r.scope_id);
    if (r.scope === "team") out.team.push(r.scope_id);
    if (r.scope === "user") out.user.push(r.scope_id);
  }
  return out;
}

export async function setSkillGrants(
  skillId: string,
  patch: { org?: string[]; team?: string[]; user?: string[] },
): Promise<Awaited<{ org: string[]; team: string[]; user: string[] }>> {
  if (!(await skillCatalog()).some((s) => s.id === skillId)) throw new HttpFail(404, "unknown skill");
  const dir = (await directory());
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
  const actor = (await currentUser()).handle;
  const db = getConn();
  (await db.query("DELETE FROM skill_grants WHERE skill_id = $1",[skillId]));
  const ins = "INSERT INTO skill_grants (id, skill_id, scope, scope_id, granted_by, granted_at) VALUES ($1,$2,$3,$4,$5,$6)";
  for (const id of next.org) (await db.query(ins,[nid("gr"),skillId,"org",id,actor,ts]));
  for (const id of next.team) (await db.query(ins,[nid("gr"),skillId,"team",id,actor,ts]));
  for (const id of next.user) (await db.query(ins,[nid("gr"),skillId,"user",id,actor,ts]));
  (await audit(actor, "skill.grant.save", { skill: skillId, ...next }));
  return grantsForSkill(skillId);
}

export { seedDirectory } from "../postgres/bootstrap-seed.js";
