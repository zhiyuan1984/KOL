import { mapUser, type AppUser } from "../../src/auth.js";
import { getConn } from "../../src/db.js";
import { pgApprovalRoles, pgConnectorPermissions, pgVisibleSkillIdsForUser } from "../../src/postgres/auth-pg.js";
import { syncUserOrganization, createAgentBinding } from "../../src/runtime/organization-tree.js";
import { ensureRuntimeSchema } from "../../src/runtime/store.js";

/**
 * Real native employee principal for API tests. Bootstrap establishes the
 * published Agent→Skill manifest and managed connector catalog; this helper
 * only adds the employee's person→Agent eligibility. It deliberately does not
 * enable a connector, create a credential, or grant a connector capability.
 */
export async function agentTestUser(): Promise<AppUser> {
  const id = "usr_agent_test";
  const now = new Date().toISOString();
  await ensureRuntimeSchema();
  (await getConn().query("INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",[id,id,"智能体测试员工","fixture",'["employee"]','["LT","RO","PQ"]',"org:lt_team",1,now,now]));
  const person = (await syncUserOrganization(id, "org:lt_team"));
  (await createAgentBinding({ agent_id: "agent:kol", target_type: "person", target_id: person, company_id: "company:amperetime", source: "test" }));
  const row = (await getConn().query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
  if (!row) throw new Error("agent test user was not created");
  const user = await mapUser(row);
  const snapshotAt = new Date().toISOString();
  return {
    ...user,
    authority_skills: await pgVisibleSkillIdsForUser(id, snapshotAt),
    authority_connectors: await pgConnectorPermissions(id),
    authority_approval_roles: await pgApprovalRoles(id, snapshotAt),
  };
}
