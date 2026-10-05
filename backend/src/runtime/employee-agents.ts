import { scopedUser } from "../auth.js";
import { getConn, nowIso } from "../db.js";
import { listPublishedExperts, requireExpertManifest, summonExpert } from "../experts.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { taskDefinition } from "../tasks/registry.js";
import { availableAgentRoutes } from "../tasks/agent-routing.js";
import type { Json } from "../types.js";
import { managedAgent } from "./managed-agents.js";

export function agentForExpert(id: string): string {
  if (id.startsWith("agent_") || id.startsWith("agent:")) return id;
  const expert = requireExpertManifest(id);
  const skill = taskDefinition(String(expert.entry_skill || ""));
  if (!skill) throw new HttpFail(404, "智能体入口技能不可用");
  return skill.runtime_agent_id;
}

/** One employee catalog: published assemblies filtered by current execution qualification. */
export function employeeExperts(expertId?: string): Json[] {
  const routes = availableAgentRoutes(expertId ? agentForExpert(expertId) : undefined);
  const usable = new Set(routes.map(route => route.agent_id));
  const staticRows: Json[] = listPublishedExperts().filter(row => (!expertId || row.id === expertId) && routes.some(route =>
    route.agent_id === agentForExpert(String(row.id)) && route.task_type === row.entry_skill)).map(row => ({
      ...row, skill_ids: (Array.isArray(row.skill_ids) ? row.skill_ids : []).filter(skill => routes.some(route =>
        route.agent_id === agentForExpert(String(row.id)) && route.task_type === skill)),
    }));
  const represented = new Set(staticRows.map(row => agentForExpert(String(row.id))));
  const ids = [...usable].filter(id => !represented.has(id));
  return [...staticRows, ...ids.map(id => {
    const agent = managedAgent(id);
    const skills = routes.filter(route => route.agent_id === id);
    return { id, version: String(agent.version), status: agent.status, display_name: agent.name,
      profession: agent.name, description: agent.description, mission: agent.description, avatar: "", category: "智能体",
      tags: skills.map(skill => skill.title), quick_prompts: [], entry_skill: skills[0]?.task_type || "",
      kind: "business", primary_entry: "think", skill_ids: skills.map(skill => skill.task_type), tool_ids: [], can_summon: true };
  })];
}

export function employeeExpert(id: string): Json {
  const row = employeeExperts(id).find(expert => expert.id === id);
  if (!row) throw new HttpFail(404, { code: "expert_not_found", message: "智能体未发布或当前账号没有使用资格" });
  return row;
}

export function summonEmployeeAgent(id: string): Json {
  if (id.startsWith("expert:")) {
    const agentId = agentForExpert(id);
    const entry = requireExpertManifest(id);
    if (!availableAgentRoutes(agentId).some(route => route.task_type === entry.entry_skill)) throw new HttpFail(404, { code: "expert_not_found", message: "当前账号没有使用资格或入口技能不可用" });
    return summonExpert(id);
  }
  const expert = employeeExpert(id);
  const sid = nid("ses");
  const now = nowIso();
  // expert_id is the existing persisted entry binding; managed entries use their canonical Agent ID.
  getConn().prepare("INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(sid, expert.display_name, now, now, "work", 0, scopedUser()?.id || null, id, expert.version);
  return { session_id: sid, expert_id: id, expert_version: expert.version, intro: `你好，我是${expert.display_name}。${expert.description || "请告诉我需要解决的问题。"}` };
}
