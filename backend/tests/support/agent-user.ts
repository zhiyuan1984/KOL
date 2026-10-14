import { type AppUser } from "../../src/auth.js";
import { postgresDb } from "../../src/postgres/access.js";
import { syncUserOrganization, createAgentBinding } from "../../src/runtime/organization-tree.js";
/** Real persisted account and person→Agent binding for employee API tests. */
export async function agentTestUser(): Promise<AppUser> {
  const id = "usr_agent_test";
  const now = new Date().toISOString();
  (await postgresDb().execute("INSERT INTO users (id,username,name,password_hash,roles,brands,site,active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", id, id, "智能体测试员工", "fixture", '["employee"]', '["LT","RO","PQ"]', "org:lt_team", 1, now, now));
  const person = (await syncUserOrganization(id, "org:lt_team"));
  (await createAgentBinding({ agent_id: "agent:kol", target_type: "person", target_id: person, company_id: "company:amperetime", source: "test" }));
  return { id, username: id, name: "智能体测试员工", handle: id, roles: ["employee"], role: "employee", brands: ["LT", "RO", "PQ"],
    site: "org:lt_team", manager_user_id: null, active: true, exam_passed: true, exam_todo_count: 0, exam_module: "" };
}
