import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { postgresQuery } from "../postgres/pool.js";
import { agentForExpert, employeeExpert, employeeExperts } from "../runtime/employee-agents.js";
import { availableAgentRoutes } from "../tasks/agent-routing.js";
import { hasDocumentTool } from "../runtime/document-knowledge.js";
import { runtimeKnowledgeManifest } from "../knowledge/scopes.js";
import { taskDefinition } from "../tasks/registry.js";
import type { EmployeeAgentPreference, EmployeeAgentWorkspace } from "../../../shared/employee-agent.js";

function actorId(): string {
  const user = scopedUser();
  if (!user?.active) throw new HttpFail(401, { code: "authentication_required", message: "请先登录" });
  return user.id;
}

export async function employeeAgentPreferences(): Promise<EmployeeAgentPreference[]> {
  const userId = actorId();
  const visibleIds = (await employeeExperts()).map(row => String(row.id));
  if (!visibleIds.length) return [];
  const rows = await postgresQuery<EmployeeAgentPreference>(
    "SELECT expert_id,favorite,viewed_at FROM employee_agent_preferences WHERE user_id=$1 AND expert_id=ANY($2::text[])",
    [userId, visibleIds],
  );
  const stillVisible = new Set((await employeeExperts()).map(row => String(row.id)));
  return rows.filter(row => stillVisible.has(row.expert_id));
}

export async function updateEmployeeAgentPreference(id: string, body: unknown): Promise<EmployeeAgentPreference> {
  const userId = actorId();
  await employeeExpert(id);
  const value = body as { favorite?: unknown; viewed?: unknown } | null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => key !== "favorite" && key !== "viewed")
    || (value.favorite === undefined && value.viewed === undefined)
    || (value.favorite !== undefined && typeof value.favorite !== "boolean")
    || (value.viewed !== undefined && value.viewed !== true)) {
    throw new HttpFail(422, { code: "agent_preference_invalid", message: "收藏和查看参数无效" });
  }
  const rows = await postgresQuery<EmployeeAgentPreference>(`
    INSERT INTO employee_agent_preferences(user_id,expert_id,favorite,viewed_at)
    VALUES($1,$2,COALESCE($3::boolean,FALSE),$4)
    ON CONFLICT(user_id,expert_id) DO UPDATE SET
      favorite=COALESCE($3::boolean,employee_agent_preferences.favorite),
      viewed_at=COALESCE($4,employee_agent_preferences.viewed_at)
    RETURNING expert_id,favorite,viewed_at`,
    [userId, id, value.favorite ?? null, value.viewed ? new Date().toISOString() : null],
  );
  return rows[0];
}

/** Only the owner's active session for this exact entry can be continued. */
export async function resumeEmployeeAgentSession(id: string, sessionId: string) {
  const userId = actorId();
  const expert = await employeeExpert(id);
  if (expert.primary_entry !== "think" || expert.kind === "collector" || expert.kind === "governance") {
    throw new HttpFail(409, { code: "agent_entry_not_conversation", message: "请使用该 Agent 的作业或审批入口" });
  }
  const rows = await postgresQuery<{ id: string; title: string; updated_at: string; expert_version: string }>(
    "SELECT id,title,updated_at,expert_version FROM sessions WHERE id=$1 AND owner_user_id=$2 AND expert_id=$3 AND COALESCE(disabled,0)=0 AND archived_at IS NULL",
    [sessionId, userId, id],
  );
  if (!rows[0]) throw new HttpFail(404, { code: "agent_session_unavailable", message: "原会话不可用，请重新选择工作" });
  await employeeExpert(id);
  return { session_id: rows[0].id, expert_id: id, expert_version: rows[0].expert_version || String(expert.version || ""), intro: "" };
}

export async function employeeAgentWorkspace(id: string, sourceSession?: string): Promise<EmployeeAgentWorkspace> {
  const userId = actorId();
  const expert = await employeeExpert(id);
  const agentId = agentForExpert(id);
  const routes = await availableAgentRoutes(agentId);
  const skills = routes.map(route => {
    const definition = taskDefinition(route.task_type);
    return { id: route.task_type, name: route.title, summary: definition?.employee_summary || definition?.description || "" };
  });
  const knowledge: EmployeeAgentWorkspace["knowledge"] = [];
  for (const skill of skills) {
    if (!hasDocumentTool(skill.id)) continue;
    const manifest = await runtimeKnowledgeManifest(skill.id, userId);
    knowledge.push({ skill_id: skill.id, skill_name: skill.name, bases: manifest.bases.map(base => ({
      id: base.id, name: base.name, document_count: base.documents.length,
      summaries: [...new Set(base.documents.flatMap(doc => doc.scope?.summary ? [doc.scope.summary] : []))],
    })) });
  }
  const canContinue = expert.primary_entry === "think" && expert.kind !== "collector" && expert.kind !== "governance";
  const sessions = canContinue ? await postgresQuery<{ id: string; title: string; updated_at: string }>(
    "SELECT id,title,updated_at FROM sessions WHERE owner_user_id=$1 AND expert_id=$2 AND COALESCE(disabled,0)=0 AND archived_at IS NULL ORDER BY CASE WHEN id=$3 THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT 1",
    [userId, id, sourceSession || null],
  ) : [];
  // A read that waited for manifests must recheck current qualification before returning.
  (await employeeExpert(id));
  return { skills, knowledge, recent_session: sessions[0] || null };
}
