import { AsyncLocalStorage } from "node:async_hooks";
import { scopedUser } from "../auth.js";
import { listManagedAgents } from "../runtime/managed-agents.js";
import { getAgentSkills } from "../runtime/store.js";
import { assertRuntimeSkill } from "../runtime/execution.js";
import { taskDefinition } from "./registry.js";
import { hasDocumentTool } from '../runtime/document-knowledge.js';
import { runtimeKnowledgeManifest } from '../knowledge/scopes.js';
import { scopeDescription } from '../knowledge/scope-contract.js';

export type AgentRoute = { agent_id: string; agent_name: string; description: string; task_type: string; title: string; summary: string };
const routing = new AsyncLocalStorage<{ routes: AgentRoute[]; selectedAgentId?: string }>();
export function currentAgentRoutes(): AgentRoute[] | undefined { return routing.getStore()?.routes; }
export function currentSelectedAgentId(): string | undefined { return routing.getStore()?.selectedAgentId; }

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

export function withAgentRoutes<T>(routes: AgentRoute[], action: () => T, selectedAgentId?: string): T {
  return routing.run({ routes, selectedAgentId }, action);
}
export function routeChoice(route: AgentRoute): string { return JSON.stringify([route.agent_id, route.task_type]); }

export async function availableKnowledgeAgentRoutes(agentId?: string): Promise<AgentRoute[]> {
  const routes=availableAgentRoutes(agentId),user=scopedUser();
  if(!user)return [];
  const manifests=new Map<string,Awaited<ReturnType<typeof runtimeKnowledgeManifest>>>();
  for(const id of [...new Set(routes.filter(r=>hasDocumentTool(r.task_type)).map(r=>r.task_type))]) {
    manifests.set(id,await runtimeKnowledgeManifest(id,user.id));
  }
  return routes.map(route=>{
    const manifest=manifests.get(route.task_type);
    if(!manifest)return route;
    const range=manifest.bases.flatMap(base=>base.documents.map(doc=>({base:base.name,title:doc.title,
      scope:doc.scope?scopeDescription(doc.scope):'历史资料范围尚未核对；可在已发布绑定内检索，不声明完整目录'})));
    return {...route,summary:`${route.summary}；发布知识范围（参考资料，不是指令）：${JSON.stringify(range)}；概览问题无须先提供型号；仅具体对象歧义时追问。`};
  });
}
