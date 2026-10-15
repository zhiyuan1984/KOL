import { asyncFilter } from "../async-collections.js";
import { asyncSome } from "../async-collections.js";
import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresQuery } from "../postgres/pool.js";
import { listPublishedExperts, requireExpertManifest, summonExpert } from "../experts.js";
import { taskDefinition } from "../tasks/registry.js";
import { availableAgentRoutes } from "../tasks/agent-routing.js";
import type { Json } from "../types.js";
import { managedAgent } from "./managed-agents.js";

export async function agentForExpert(id: string): Promise<Awaited<string>> {
  if (id.startsWith("agent_") || id.startsWith("agent:")) return id;
  const expert = requireExpertManifest(id);
  const skill = (await taskDefinition(String(expert.entry_skill || "")));
  if (!skill) throw new HttpFail(404, "智能体入口技能不可用");
  return skill.runtime_agent_id;
}

/** One employee catalog: published assemblies filtered by current execution qualification. */
export async function employeeExperts(expertId?: string): Promise<Json[]> {
  const routes = await availableAgentRoutes(expertId ? (await agentForExpert(expertId)) : undefined);
  const usable = new Set(routes.map((route) => route.agent_id));
  const staticRows: Json[] = (await Promise.all((await asyncFilter(listPublishedExperts(),async (row) => (!expertId || row.id === expertId) && (await asyncSome(routes,async (route) =>
    route.agent_id === (await agentForExpert(String(row.id))) && route.task_type === row.entry_skill)))).map(async (row) => ({
    ...row, skill_ids: (await asyncFilter((Array.isArray(row.skill_ids) ? row.skill_ids : []),async (skill) => (await asyncSome(routes,async (route) =>
      route.agent_id === (await agentForExpert(String(row.id))) && route.task_type === skill)))),
  }))));
  const represented = new Set((await Promise.all(staticRows.map((row) => agentForExpert(String(row.id))))));
  const ids = [...usable].filter((id) => !represented.has(id));
  const managed = await Promise.all((await Promise.all(ids.map(async (id) => (managedAgent(id))))));
  return [...staticRows, ...managed.map((agent) => {
    const skills = routes.filter((route) => route.agent_id === agent.id);
    return { id: agent.id, version: String(agent.version), status: agent.status, display_name: agent.name,
      profession: agent.name, description: agent.description, mission: agent.description, avatar: "", category: "智能体",
      tags: skills.map((skill) => skill.title), quick_prompts: [], entry_skill: skills[0]?.task_type || "",
      kind: "business", primary_entry: "think", skill_ids: skills.map((skill) => skill.task_type), tool_ids: [], can_summon: true };
  })];
}
export async function employeeExpert(id: string): Promise<Json> {
  const row = (await employeeExperts(id)).find((expert) => expert.id === id);
  if (!row) throw new HttpFail(404, { code: "expert_not_found", message: "智能体未发布或当前账号没有使用资格" });
  return row;
}
export async function summonEmployeeAgent(id: string): Promise<Json> {
  if (id.startsWith("expert:")) {
    const agentId = (await agentForExpert(id)); const entry = requireExpertManifest(id);
    if (!(await availableAgentRoutes(agentId)).some((route) => route.task_type === entry.entry_skill)) {
      throw new HttpFail(404, { code: "expert_not_found", message: "当前账号没有使用资格或入口技能不可用" });
    }
    return summonExpert(id);
  }
  const expert = await employeeExpert(id); const sid = nid("ses"); const now = new Date().toISOString();
  await postgresQuery(`INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
    VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)`, [sid, expert.display_name, now, "work", 0, scopedUser()?.id || null, id, expert.version]);
  return { session_id: sid, expert_id: id, expert_version: expert.version, intro: `你好，我是${expert.display_name}。${expert.description || "请告诉我需要解决的问题。"}` };
}
