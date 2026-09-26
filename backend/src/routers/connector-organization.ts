import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { requireManagedConnector } from "../connectors/catalog.js";
import { getToolPolicy } from "../runtime/store.js";
import {
  addOrganizationScopeNode,
  connectorHasOrganizationScopes,
  getOrganizationScopeSnapshot,
  replaceToolScope,
  toolHasGlobalScope,
  toolScopeNodeIds,
} from "../runtime/organization.js";

export const connectorOrganizationRouter = new Hono();

function runtimeAdmin() {
  if (authDisabled() && process.env.NODE_ENV !== "test") throw new HttpFail(403, { code: "runtime_auth_required" });
  return requireAdmin();
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  }
}

connectorOrganizationRouter.get("/admin/runtime/connectors/:connectorId/organization-scope", (c) => {
  runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  return c.json(getOrganizationScopeSnapshot(connectorId));
});

connectorOrganizationRouter.post("/admin/runtime/connectors/:connectorId/organization-scope/nodes", async (c) => {
  const admin = runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const input = await body(c);
  if (Object.keys(input).some((key) => !["name", "level", "parent_id", "user_id"].includes(key))) {
    throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  }
  const snapshot = addOrganizationScopeNode(connectorId, { name: input.name, level: input.level, parent_id: input.parent_id, user_id: input.user_id });
  audit(admin.id, "runtime.organization_scope.node_added", { connector_id: connectorId, level: input.level, name: input.name, user_id: input.user_id });
  return c.json(snapshot, 201);
});

connectorOrganizationRouter.put("/admin/runtime/connectors/:connectorId/tools/:toolName/scope", async (c) => {
  const admin = runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const toolName = c.req.param("toolName");
  if (!getToolPolicy(connectorId, toolName)) throw new HttpFail(409, { code: "runtime_tool_requires_discovery" });
  const input = await body(c);
  if (Object.keys(input).some((key) => !["node_ids", "all"].includes(key))) throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  if (input.all !== undefined && typeof input.all !== "boolean") throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  const scope = replaceToolScope(connectorId, toolName, input.node_ids, admin.id, input.all === true);
  audit(admin.id, "runtime.tool_scope.updated", { connector_id: connectorId, tool_name: toolName, ...scope });
  return c.json({ connector_id: connectorId, tool_name: toolName, ...scope });
});

connectorOrganizationRouter.get("/admin/runtime/connectors/:connectorId/tools/:toolName/scope", (c) => {
  runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const toolName = c.req.param("toolName");
  return c.json({
    connector_id: connectorId,
    tool_name: toolName,
    node_ids: toolScopeNodeIds(connectorId, toolName),
    all: toolHasGlobalScope(connectorId, toolName),
    scope_configured: connectorHasOrganizationScopes(connectorId),
  });
});
