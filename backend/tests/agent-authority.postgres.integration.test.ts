import { beforeEach, describe, expect, it } from "vitest";
import { pgUsableAgentIdsForUser, pgUserCanUseAgent, pgUserCanUseSkill, pgVisibleSkillIdsForUser } from "../src/postgres/auth-pg.js";
import { postgresQuery } from "../src/postgres/pool.js";
import { ensureOrganizationTree, revokeAgentBinding } from "../src/runtime/organization-tree.js";
import { ensureManagedAgents } from "../src/runtime/managed-agents.js";
import { ensureRuntimeSchema, getAgentSkills } from "../src/runtime/store.js";
import { freshTestDatabase } from "./support/pg.js";

const COMPANY = "company:agent-authority-fixture";
const OTHER_COMPANY = "company:agent-authority-other";
const AGENT_UNIT = "agent:authority-unit";
const AGENT_PERSON = "agent:authority-person";
const SKILL = "authority_fixture_skill";
const now = () => new Date().toISOString();

async function query(text: string, values: unknown[] = []): Promise<void> {
  await postgresQuery(text, values);
}

async function user(id: string, person: string, unit: string, company = COMPANY): Promise<void> {
  const stamp = now();
  await query(`INSERT INTO users(id,username,name,password_hash,roles,brands,site,active,created_at,updated_at)
    VALUES($1,$1,$1,'fixture','["employee"]','[]',$2,1,$3,$3)`, [id, unit, stamp]);
  await query(`INSERT INTO organization_people(person_ref,display_name,user_ref,user_id,status,source,created_at,updated_at)
    VALUES($1,$1,$2,$2,'active','test',$3,$3)`, [person, id, stamp]);
  await query(`INSERT INTO organization_memberships(id,person_ref,company_id,org_unit_id,relation,status,effective_from,effective_to,source,created_at,updated_at)
    VALUES($1,$2,$3,$4,'primary','active',$5,NULL,'test',$5,$5)`, [`member:${person}:${unit}`, person, company, unit, stamp]);
}

async function fixture(): Promise<void> {
  const stamp = now();
  await query("INSERT INTO org_versions(company_id,version,effective_at,note,source,created_at) VALUES($1,1,$2,'fixture','test',$2)", [COMPANY, stamp]);
  await query("INSERT INTO org_versions(company_id,version,effective_at,note,source,created_at) VALUES($1,1,$2,'fixture','test',$2)", [OTHER_COMPANY, stamp]);
  for (const [id, parent, level, head] of [
    ["org:authority-root", null, 1, "person:authority-root-head"],
    ["org:authority-team", "org:authority-root", 2, "person:authority-team-head"],
    ["org:authority-branch", "org:authority-root", 2, "person:authority-branch-head"],
    ["org:authority-other", null, 1, "person:authority-other"],
  ] as Array<[string, string | null, number, string]>) {
    await query(`INSERT INTO organization_units(id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,org_version,source,created_at,updated_at)
      VALUES($1,$2,$1,'team',$3,$4,$5,$5,'active',1,'test',$6,$6)`, [id, id === "org:authority-other" ? OTHER_COMPANY : COMPANY, parent, level, head, stamp]);
  }
  await user("usr_authority_member", "person:authority-member", "org:authority-team");
  await user("usr_authority_team_head", "person:authority-team-head", "org:authority-team");
  await user("usr_authority_root_head", "person:authority-root-head", "org:authority-root");
  await user("usr_authority_branch_head", "person:authority-branch-head", "org:authority-branch");
  await user("usr_authority_other", "person:authority-other", "org:authority-other", OTHER_COMPANY);
  for (const agent of [AGENT_UNIT, AGENT_PERSON]) {
    await query(`INSERT INTO managed_agents(id,name,description,status,version,created_at,updated_at)
      VALUES($1,$1,'fixture','published',1,$2,$2)`, [agent, stamp]);
    await query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES($1,$2,1,1,$3)", [agent, SKILL, stamp]);
  }
  await query(`INSERT INTO agent_bindings(id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,effective_to,source,created_at,updated_at)
    VALUES('binding:authority-unit',$1,'organization_unit','org:authority-team',$2,'active',1,1,NULL,'fixture',$3,NULL,'test',$3,$3)`, [AGENT_UNIT, COMPANY, stamp]);
  await query(`INSERT INTO agent_bindings(id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,effective_to,source,created_at,updated_at)
    VALUES('binding:authority-person',$1,'person','person:authority-member',$2,'active',1,1,NULL,'fixture',$3,NULL,'test',$3,$3)`, [AGENT_PERSON, COMPANY, stamp]);
}

beforeEach(async () => {
  await freshTestDatabase();
  await ensureOrganizationTree();
  await ensureManagedAgents();
  await fixture();
});

describe("Agent资格的唯一PostgreSQL权威计算", () => {
  it("组织绑定只覆盖目标及子成员与真实上级负责人，拒绝旁支和跨公司", async () => {
    const stamp = now();
    await expect(pgUsableAgentIdsForUser("usr_authority_member", stamp)).resolves.toEqual(expect.arrayContaining([AGENT_UNIT, AGENT_PERSON]));
    await expect(pgUserCanUseAgent("usr_authority_team_head", AGENT_UNIT, stamp)).resolves.toBe(true);
    await expect(pgUserCanUseAgent("usr_authority_root_head", AGENT_UNIT, stamp)).resolves.toBe(true);
    await expect(pgUserCanUseAgent("usr_authority_branch_head", AGENT_UNIT, stamp)).resolves.toBe(false);
    // 管理角色不构成Agent资格；未绑定的旁支管理员仍必须被拒绝。
    await query("UPDATE users SET roles='[\"employee\",\"admin\"]' WHERE id='usr_authority_branch_head'");
    await expect(pgUserCanUseAgent("usr_authority_branch_head", AGENT_UNIT, stamp)).resolves.toBe(false);
    await expect(pgUserCanUseAgent("usr_authority_other", AGENT_UNIT, stamp)).resolves.toBe(false);
    await expect(pgUserCanUseAgent("usr_authority_team_head", AGENT_PERSON, stamp)).resolves.toBe(true);
    await expect(pgUserCanUseAgent("usr_authority_root_head", AGENT_PERSON, stamp)).resolves.toBe(true);
    await expect(pgUserCanUseAgent("usr_authority_branch_head", AGENT_PERSON, stamp)).resolves.toBe(false);
    await expect(pgUserCanUseSkill("usr_authority_member", SKILL, stamp)).resolves.toBe(true);
    await expect(pgVisibleSkillIdsForUser("usr_authority_member", stamp)).resolves.toContain(SKILL);
  });

  it("资格随撤销和有效期立即失效，且workspace planner保留其正式技能装配", async () => {
    const stamp = now();
    await expect(pgUserCanUseAgent("usr_authority_member", AGENT_UNIT, stamp)).resolves.toBe(true);
    await expect(revokeAgentBinding("binding:authority-unit", { reason: "test revoke" })).resolves.toBe(true);
    await expect(pgUserCanUseAgent("usr_authority_member", AGENT_UNIT, now())).resolves.toBe(false);
    await query("UPDATE agent_bindings SET effective_to=$1 WHERE id='binding:authority-person'", ["2000-01-01T00:00:00.000Z"]);
    await expect(pgUserCanUseAgent("usr_authority_member", AGENT_PERSON, now())).resolves.toBe(false);
    await ensureRuntimeSchema();
    const plannerSkills = await getAgentSkills("agent:workspace-planner");
    expect(plannerSkills.filter((row) => Number(row.enabled) === 1).map((row) => String(row.skill_id)).sort())
      .toEqual(["today_analyze", "today_plan", "todo_plan"]);
  });
});
