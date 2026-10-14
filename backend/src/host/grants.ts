import { nid } from "../ids.js";
import { audit, postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { HttpFail } from "./errors.js";
import { scopedUser, authDisabled, isAdmin } from "../auth.js";
import { canUseSkill, visibleSkillIdsForUser } from "../runtime/organization-tree.js";
import { SKILL_CATALOG } from "./skills-catalog.js";
import { currentUser } from "./persona.js";
export type GrantScope = "org" | "team" | "user";
export type Directory = {
  orgs: {
    id: string;
    name: string;
  }[];
  teams: {
    id: string;
    org_id: string;
    name: string;
  }[];
  users: {
    id: string;
    handle: string;
    name: string;
    role: string;
  }[];
};
export async function directory(): Promise<Directory> {
  const db = postgresDb();
  return {
    orgs: (await db.many("SELECT id, name FROM orgs ORDER BY id")) as Directory["orgs"],
    teams: (await db.many("SELECT id, org_id, name FROM teams ORDER BY id")) as Directory["teams"],
    users: (await db.many("SELECT id, handle, name, role FROM directory_users ORDER BY name")) as Directory["users"],
  };
}
export async function memberScopeIds(handle: string): Promise<{
  orgs: string[];
  teams: string[];
}> {
  const rows = (await postgresDb().many("SELECT scope, scope_id FROM memberships WHERE user_handle = $1", handle)) as {
    scope: string;
    scope_id: string;
  }[];
  const orgs = rows.filter((r) => r.scope === "org").map((r) => r.scope_id);
  const teams = rows.filter((r) => r.scope === "team").map((r) => r.scope_id);
  return {
    orgs: orgs.length || teams.length ? orgs : ["org_litime"],
    teams,
  };
}
/** 关闭鉴权的开发/测试态沿用既有放行口径；管理员保持与 requireSkill 一致的直通；其余按 Agent 使用资格派生。 */
export async function visibleSkillIds(userId?: string): Promise<Set<string>> {
  if (authDisabled() || isAdmin())
    return new Set(SKILL_CATALOG.map((s) => s.id));
  return new Set((await visibleSkillIdsForUser(userId || scopedUser()?.id || null)));
}
export async function isSkillGranted(skillId: string, userId?: string): Promise<boolean> {
  if (authDisabled() || isAdmin())
    return true;
  return (await canUseSkill(userId || scopedUser()?.id || null, skillId));
}
export async function grantsForSkill(skillId: string): Promise<{
  org: string[];
  team: string[];
  user: string[];
}> {
  const rows = (await postgresDb().many("SELECT scope, scope_id FROM skill_grants WHERE skill_id = $1", skillId)) as {
    scope: GrantScope;
    scope_id: string;
  }[];
  const out = { org: [] as string[], team: [] as string[], user: [] as string[] };
  for (const r of rows) {
    if (r.scope === "org")
      out.org.push(r.scope_id);
    if (r.scope === "team")
      out.team.push(r.scope_id);
    if (r.scope === "user")
      out.user.push(r.scope_id);
  }
  return out;
}
export async function setSkillGrants(skillId: string, patch: {
  org?: string[];
  team?: string[];
  user?: string[];
}): Promise<{
  org: string[];
  team: string[];
  user: string[];
}> {
  if (!SKILL_CATALOG.some((s) => s.id === skillId))
    throw new HttpFail(404, "unknown skill");
  const dir = (await directory());
  const orgOk = new Set(dir.orgs.map((o) => o.id));
  const teamOk = new Set(dir.teams.map((t) => t.id));
  const userOk = new Set(dir.users.map((u) => u.handle));
  const next = {
    org: [...new Set(patch.org || [])],
    team: [...new Set(patch.team || [])],
    user: [...new Set(patch.user || [])],
  };
  for (const id of next.org)
    if (!orgOk.has(id))
      throw new HttpFail(400, "unknown org");
  for (const id of next.team)
    if (!teamOk.has(id))
      throw new HttpFail(400, "unknown team");
  for (const id of next.user)
    if (!userOk.has(id))
      throw new HttpFail(400, "unknown user");
  const ts = nowIso();
  const actor = (await currentUser()).handle;
  await pgTransaction(async (db) => {
    await db.execute("DELETE FROM skill_grants WHERE skill_id = $1", skillId);
    for (const id of next.org)
      await db.execute("INSERT INTO skill_grants (id,skill_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("gr"), skillId, "org", id, actor, ts);
    for (const id of next.team)
      await db.execute("INSERT INTO skill_grants (id,skill_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("gr"), skillId, "team", id, actor, ts);
    for (const id of next.user)
      await db.execute("INSERT INTO skill_grants (id,skill_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6)", nid("gr"), skillId, "user", id, actor, ts);
  });
  (await audit(actor, "skill.grant.save", { skill: skillId, ...next }));
  return (await grantsForSkill(skillId));
}
export async function seedDirectory(): Promise<void> {
  const db = postgresDb();
  (await db.execute("INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name", "org_litime", "LiTime"));
  (await db.execute("INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id,name=EXCLUDED.name", "team_kol", "org_litime", "KOL 建联小队"));
  (await db.execute("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,role=EXCLUDED.role", "sriphy", "sriphy", "鄢棽", "product_manager"));
  (await db.execute("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,role=EXCLUDED.role", "usr_lead", "lead", "陈组长", "operator"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_sriphy_org", "sriphy", "org", "org_litime"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_sriphy_team", "sriphy", "team", "team_kol"));
  // 2026-10-05 登录账户切换为黄启友：目录与范围行与「演示管理员」保持一致
  // （memberScopeIds 按 handle 取知识/技能范围；鄢棽原有行保留不动）。
  (await db.execute("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,role=EXCLUDED.role", "jeffrey", "jeffrey", "黄启友", "product_manager"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_jeffrey_org", "jeffrey", "org", "org_litime"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_jeffrey_team", "jeffrey", "team", "team_kol"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_lead_org", "lead", "org", "org_litime"));
  (await db.execute("INSERT INTO directory_users (id, handle, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET handle=EXCLUDED.handle,name=EXCLUDED.name,role=EXCLUDED.role", "usr_lingong", "lingong", "林工", "employee"));
  (await db.execute("INSERT INTO memberships (id, user_handle, scope, scope_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", "mem_lingong_org", "lingong", "org", "org_litime"));
  const ts = nowIso();
  for (const skill of SKILL_CATALOG) {
    await db.execute("INSERT INTO skill_grants (id,skill_id,scope,scope_id,granted_by,granted_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", `gr_org_${skill.id}`, skill.id, "org", "org_litime", "sriphy", ts);
  }
}
