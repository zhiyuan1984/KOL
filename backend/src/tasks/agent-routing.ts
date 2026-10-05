import { AsyncLocalStorage } from "node:async_hooks";
import { scopedUser } from "../auth.js";
import { listManagedAgents } from "../runtime/managed-agents.js";
import { getAgentSkills } from "../runtime/store.js";
import { assertRuntimeSkill } from "../runtime/execution.js";
import { taskDefinition } from "./registry.js";

export type AgentRoute = { agent_id: string; agent_name: string; description: string; task_type: string; title: string; summary: string };
const routing = new AsyncLocalStorage<AgentRoute[]>();
export function currentAgentRoutes(): AgentRoute[] | undefined { return routing.getStore(); }

/** Filter before giving the catalog to a model. Execution revalidates the chosen pair. */
export function availableAgentRoutes(agentId?: string): AgentRoute[] {
  const user = scopedUser();
  if (!user) return [];
  return listManagedAgents().filter(agent => agent.status === "published" && (!agentId || agent.id === agentId)).flatMap(agent =>
    getAgentSkills(agent.id).flatMap(binding => {
      if (!binding.enabled) return [];
      const skill = taskDefinition(String(binding.skill_id));
      if (!skill) return [];
      try { assertRuntimeSkill({ agentId: agent.id, skillId: skill.id, userId: user.id, runId: "agent-routing" }); }
      catch { return []; }
      return [{ agent_id: agent.id, agent_name: agent.name, description: agent.description,
        task_type: skill.id, title: skill.title,
        summary: `${skill.employee_summary || skill.description}${skill.aliases.length ? `；常见说法：${skill.aliases.join("、")}` : ""}${skill.input_schema?.length ? `；输入：${skill.input_schema.map(field => `${field.key}:${field.kind}${field.required ? "!" : ""}`).join(",")}` : ""}` }];
    }));
}

export function withAgentRoutes<T>(routes: AgentRoute[], action: () => T): T { return routing.run(routes, action); }
export function routeChoice(route: AgentRoute): string { return JSON.stringify([route.agent_id, route.task_type]); }
