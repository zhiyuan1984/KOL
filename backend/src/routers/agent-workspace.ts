import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { agentWorkspace, agentWorkspaceDetail, saveAgentDraft, prepareAgentRelease, publishAgentRelease, changeAgentAvailability } from "../agents/workspace.js";
import { prepareAgentOrganization, changeAgentOrganization } from '../agents/organization.js';
export const agentWorkspaceRouter = new Hono();
agentWorkspaceRouter.get("/admin/agents/workspace-v1", async (c) => { (await requireAdmin()); return c.json(await agentWorkspace(c.req.query())); });
agentWorkspaceRouter.get("/admin/agents/:id/workspace-v1", async (c) => { (await requireAdmin()); return c.json(await agentWorkspaceDetail(c.req.param("id"))); });
agentWorkspaceRouter.post('/admin/agents/:id/organization-preview-v1', async (c) => { const actor = (await requireAdmin()); return c.json(await prepareAgentOrganization(actor.id, c.req.param('id'), await c.req.json())); });
agentWorkspaceRouter.post('/admin/agents/:id/organization-v1', async (c) => { const actor = (await requireAdmin()); return c.json(await changeAgentOrganization(actor.id, c.req.param('id'), await c.req.json())); });
agentWorkspaceRouter.post("/admin/agents/draft-v1", async (c) => {
  const actor = (await requireAdmin());
  return c.json(await saveAgentDraft(actor.id, null, await c.req.json()), 201);
});
agentWorkspaceRouter.put("/admin/agents/:id/draft-v1", async (c) => {
  const actor = (await requireAdmin());
  return c.json(await saveAgentDraft(actor.id, c.req.param("id"), await c.req.json()));
});
agentWorkspaceRouter.post("/admin/agents/:id/prepare-release-v1", async (c) => {
  const actor = (await requireAdmin());
  return c.json(await prepareAgentRelease(actor.id, c.req.param("id")));
});
agentWorkspaceRouter.post("/admin/agents/:id/release-v1", async (c) => {
  const actor = (await requireAdmin());
  return c.json(await publishAgentRelease(actor.id, c.req.param("id"), await c.req.json()));
});
agentWorkspaceRouter.post("/admin/agents/:id/availability-v1", async (c) => {
  const actor = (await requireAdmin());
  return c.json(await changeAgentAvailability(actor.id, c.req.param("id"), await c.req.json()));
});
