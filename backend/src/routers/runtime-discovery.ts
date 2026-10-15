import { Hono } from "hono";
import { scopedUser, requireAdmin, authDisabled } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinition } from "../tasks/registry.js";
import { getAgentSkills, getSkillConnectors, getSkillTools, getToolPolicy, getConnectorConfig } from "../runtime/store.js";
import { assertRuntimeSkill, authorizeConnector, inspectConnectorTools, runtimeErrorCode } from "../runtime/execution.js";
import { requireManagedConnector } from "../connectors/catalog.js";

export const runtimeDiscoveryRouter = new Hono();

runtimeDiscoveryRouter.get("/admin/runtime/connectors/:connectorId/discovery", async (c) => {
  if (authDisabled() && process.env.NODE_ENV !== "test") throw new HttpFail(403, { code: "runtime_auth_required" });
  const admin = requireAdmin();
  const connectorId = c.req.param("connectorId");
  if (process.env.NODE_ENV !== "test") requireManagedConnector(connectorId);
  const tools = await inspectConnectorTools({ agentId: "governance", skillId: "", userId: admin.id, runId: "discovery" }, connectorId);
  return c.json({ tools, authorization: "Discovery permits mounting, not execution. Controlled writes require current business gates and user confirmation." });
});

runtimeDiscoveryRouter.get("/agents/:agentId/capabilities", async (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  const agentId = c.req.param("agentId");
  const capabilities = (await Promise.all((await getAgentSkills(agentId)).map(async (row) => {
    if (!row.enabled) return [];
    const skillId = String(row.skill_id);
    const context = { agentId, skillId, userId: user.id, runId: "capabilities" };
    try { (await assertRuntimeSkill(context)); } catch { return []; }
    const skill = (await taskDefinition(skillId))!;
    const resources = (await Promise.all((await getSkillConnectors(skillId)).map(async (binding) => {
      try {
        if (!binding.enabled) return { available: false, tool_count: 0, reason: "runtime_connector_unbound" };
        let toolCount = 0;
        for (const mount of (await getSkillTools(skillId, String(binding.connector_id)))) {
          if (!mount.enabled) continue;
          const policy = (await getToolPolicy(String(binding.connector_id), String(mount.tool_name)));
          if (!policy?.enabled || !["L1", "L2", "L3"].includes(String(policy.risk))) continue;
          try { (await authorizeConnector(context, String(binding.connector_id))); toolCount += 1; }
          catch { /* a single tool grant does not make the resource usable */ }
        }
        return toolCount ? { available: true, tool_count: toolCount } : { available: false, tool_count: 0, reason: "runtime_no_authorized_tools" };
      } catch (error) { return { available: false, tool_count: 0, reason: runtimeErrorCode(error) }; }
    })));
    return [{ skill_id: skillId, title: skill.title, description: skill.employee_summary || skill.description,
      binding_version: row.version, configured_resources: resources.filter((resource) => resource.available).length,
      unavailable_resources: resources.filter((resource) => !resource.available).length,
      authorized_tool_count: resources.reduce((total, resource) => total + (resource.tool_count || 0), 0),
      availability: resources.some((resource) => !resource.available) ? "resources_unavailable" : "configured",
      // Configuration is not a live tool/network probe.
      live_verified: false }];
  }))).flat();
  return c.json({ agent_id: agentId, capabilities });
});
