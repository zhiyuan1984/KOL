import { Hono } from "hono";
import { scopedUser, requireAdmin, authDisabled } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { taskDefinition } from "../tasks/registry.js";
import { getAgentSkills, getSkillConnectors } from "../runtime/store.js";
import { assertRuntimeSkill, authorizeConnector, inspectConnectorTools, runtimeErrorCode } from "../runtime/execution.js";
import "../runtime/providers.js";

export const runtimeDiscoveryRouter = new Hono();

runtimeDiscoveryRouter.get("/admin/runtime/connectors/:connectorId/discovery", async (c) => {
  if (authDisabled() && process.env.NODE_ENV !== "test") throw new HttpFail(403, { code: "runtime_auth_required" });
  const admin = requireAdmin();
  const tools = await inspectConnectorTools({ agentId: "governance", skillId: "", userId: admin.id, runId: "discovery" }, c.req.param("connectorId"));
  return c.json({ tools, authorization: "Discovery is not a grant. Approve each metadata/schema hash before execution." });
});

runtimeDiscoveryRouter.get("/agents/:agentId/capabilities", (c) => {
  const user = scopedUser();
  if (!user) throw new HttpFail(401, { code: "runtime_identity_unavailable" });
  const agentId = c.req.param("agentId");
  const capabilities = getAgentSkills(agentId).flatMap((row) => {
    if (!row.enabled) return [];
    const skillId = String(row.skill_id);
    const context = { agentId, skillId, userId: user.id, runId: "capabilities" };
    try { assertRuntimeSkill(context); } catch { return []; }
    const skill = taskDefinition(skillId)!;
    const resources = getSkillConnectors(skillId).map((binding) => {
      try {
        authorizeConnector(context, String(binding.connector_id));
        return { available: true };
      } catch (error) { return { available: false, reason: runtimeErrorCode(error) }; }
    });
    return [{ skill_id: skillId, title: skill.title, description: skill.employee_summary || skill.description,
      binding_version: row.version, configured_resources: resources.filter((resource) => resource.available).length,
      unavailable_resources: resources.filter((resource) => !resource.available).length,
      availability: resources.some((resource) => !resource.available) ? "resources_unavailable" : "configured",
      // Configuration is not a live tool/network probe.
      live_verified: false }];
  });
  return c.json({ agent_id: agentId, capabilities });
});
