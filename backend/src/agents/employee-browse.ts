import { scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { listPublishedForOps, publicKnowledgeTaxonomy } from "../host/knowledge.js";
import { knowledgeBindingMatchesRow, type BindingSelector } from "../knowledge/binding-selector.js";
import { runtimeKnowledgeManifest } from "../knowledge/scopes.js";
import { postgresQuery } from "../postgres/pool.js";
import { agentForExpert, employeeExperts } from "../runtime/employee-agents.js";
import { hasDocumentTool } from "../runtime/document-knowledge.js";
import type { EmployeeAgentBrowse, EmployeeAgentScope } from "../../../shared/employee-agent.js";

/** Read-only findability projection. Both Agent qualification and knowledge visibility use their existing kernels. */
export async function employeeAgentBrowse(): Promise<EmployeeAgentBrowse> {
  const actor = scopedUser();
  if (!actor?.active) throw new HttpFail(401, { code: "authentication_required", message: "请先登录" });
  const experts = await employeeExperts();
  const skillIds = [...new Set(experts.flatMap(row => Array.isArray(row.skill_ids) ? row.skill_ids.map(String) : []))];
  const bindings = skillIds.length ? await postgresQuery<{ skill_id: string; selector: string | BindingSelector }>(
    "SELECT skill_id,selector FROM knowledge_bindings WHERE enabled=1 AND skill_id=ANY($1::text[])", [skillIds],
  ) : [];
  // The effective published snapshot, current brand scope and employee visibility are already enforced here.
  const published = (await listPublishedForOps());
  const taxonomy = (await publicKnowledgeTaxonomy());
  const domains = taxonomy.domains.map(row => ({ id: String(row.id), name: String(row.name), level: String(row.level), parent_id: row.parent_id ? String(row.parent_id) : null }));
  const bases = taxonomy.bases.map(row => ({ id: String(row.id), name: String(row.name), domain_id: row.domain_id ? String(row.domain_id) : null }));
  const scopeForBase = (baseId: string): Pick<EmployeeAgentScope, "base_id" | "domain_id" | "family_id"> => {
    const base = bases.find(row => row.id === baseId);
    const domain = domains.find(row => row.id === base?.domain_id);
    return { base_id: baseId || null, domain_id: base?.domain_id || null, family_id: domain?.parent_id || null };
  };
  const scopesBySkill = new Map<string, EmployeeAgentScope[]>();
  for (const skillId of skillIds) {
    const selectors = bindings.filter(row => row.skill_id === skillId).map(row => {
      // Stored binding corruption is a real read failure, not an unbounded selector.
      const value = typeof row.selector === "string" ? JSON.parse(row.selector) : row.selector;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("关联知识范围格式无效");
      const keys = ["ids", "base_ids", "kinds", "tags", "stage_codes", "brand", "lang"];
      for (const [key, field] of Object.entries(value)) {
        if (!keys.includes(key) || (key === "brand" || key === "lang" ? typeof field !== "string"
          : !Array.isArray(field) || field.some(item => typeof item !== "string"))) throw new Error("关联知识范围格式无效");
      }
      return value as BindingSelector;
    });
    const scopes: EmployeeAgentScope[] = published.filter(row => selectors.some(selector => knowledgeBindingMatchesRow(selector, row))).map(row => ({
      ...scopeForBase(String(row.base_id || "")), brand: String(row.brand || "*"),
      stage_codes: Array.isArray(row.stage_codes) ? row.stage_codes.map(String) : [],
    }));
    if (hasDocumentTool(skillId)) {
      const manifest = await runtimeKnowledgeManifest(skillId, actor.id);
      // Document scopes do not declare brand/stage applicability. Unknown is not universal.
      for (const base of manifest.bases) scopes.push({ ...scopeForBase(base.id), brand: null, stage_codes: [] });
    }
    scopesBySkill.set(skillId, scopes);
  }
  const agentIds = [...new Set(experts.map(row => agentForExpert(String(row.id))))];
  const releases = agentIds.length ? await postgresQuery<{ id: string; updated_at: string; published_by: string | null }>(`
    SELECT a.id,COALESCE(v.published_at,a.updated_at) AS updated_at,
      COALESCE(u.name,CASE WHEN v.published_by='legacy-release' THEN '组织发布' END) AS published_by
    FROM managed_agents a LEFT JOIN agent_workspace_versions v ON v.agent_id=a.id AND v.version=a.published_revision
    LEFT JOIN users u ON u.id=v.published_by WHERE a.id=ANY($1::text[])`, [agentIds]) : [];
  const current = await employeeExperts();
  const rows = experts.filter(row => current.some(value => value.id === row.id)).map(row => {
    // Revalidate assembly after async reads; do not retain scope from a removed skill.
    const skills = current.find(value => value.id === row.id)?.skill_ids;
    const scopes = (Array.isArray(skills) ? skills : []).flatMap(id => scopesBySkill.get(String(id)) || []);
    const release = releases.find(value => value.id === agentForExpert(String(row.id)));
    return { expert_id: String(row.id), published_by: release?.published_by || null, updated_at: release?.updated_at || null,
      scopes: [...new Map(scopes.map(scope => [JSON.stringify(scope), scope])).values()] };
  });
  return { rows, taxonomy: { domains, bases } };
}
