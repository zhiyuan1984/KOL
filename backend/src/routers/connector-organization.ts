import { Hono } from "hono";
import { authDisabled, requireAdmin } from "../auth.js";
import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { requireManagedConnector } from "../connectors/catalog.js";
import { createConfiguredClient, inspectConnectorTools, runtimeErrorCode } from "../runtime/execution.js";
import { getConnectorConfig, getToolPolicy } from "../runtime/store.js";
import {
  addOrganizationScopeNode,
  getOrganizationScopeSnapshot,
  replaceOrganizationScopeSnapshot,
  replaceToolScope,
  toolScopeNodeIds,
  type OrganizationScopeInput,
} from "../runtime/organization.js";
import type { Json } from "../types.js";

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

function toolText(result: Json): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const direct = result as Record<string, unknown>;
    if (direct.data && typeof direct.data === "object") return direct.data;
    const content = direct.content;
    if (Array.isArray(content)) {
      const text = content.find((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
      if (typeof text?.text === "string") {
        try { return JSON.parse(text.text); } catch { return text.text; }
      }
    }
  }
  return result;
}

/** Accepts only a full three-level tree returned by a remote organization tool. */
function parseRemoteTree(result: Json): OrganizationScopeInput[] {
  const value = toolText(result);
  const candidates = value && typeof value === "object" && !Array.isArray(value)
    ? [(value as Record<string, unknown>).nodes, (value as Record<string, unknown>).list, (value as Record<string, unknown>).tree]
    : [value];
  const raw = candidates.find(Array.isArray);
  if (!Array.isArray(raw)) throw new HttpFail(422, { code: "starry_organization_tree_invalid" });
  return raw.map((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new HttpFail(422, { code: "starry_organization_tree_invalid" });
    const row = node as Record<string, unknown>;
    const parent = row.parentId ?? row.parent_id ?? null;
    return {
      id: String(row.id || row.nodeId || row.departmentId || row.userId || ""),
      parent_id: parent == null || parent === "" ? null : String(parent),
      name: String(row.name || row.displayName || row.departmentName || row.userName || ""),
      level: Number(row.level || row.depth || row.nodeLevel) as 1 | 2 | 3,
      external_id: String(row.externalId || row.external_id || row.id || row.nodeId || row.departmentId || row.userId || ""),
      ...(typeof row.email === "string" ? { email: row.email } : {}),
    };
  });
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
  if (Object.keys(input).some((key) => !["name", "level", "parent_id"].includes(key))) {
    throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  }
  const snapshot = addOrganizationScopeNode(connectorId, { name: input.name, level: input.level, parent_id: input.parent_id });
  audit(admin.id, "runtime.organization_scope.node_added", { connector_id: connectorId, level: input.level, name: input.name });
  return c.json(snapshot, 201);
});

connectorOrganizationRouter.put("/admin/runtime/connectors/:connectorId/tools/:toolName/scope", async (c) => {
  const admin = runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const toolName = c.req.param("toolName");
  if (!getToolPolicy(connectorId, toolName)) throw new HttpFail(409, { code: "runtime_tool_requires_discovery" });
  const input = await body(c);
  if (Object.keys(input).some((key) => key !== "node_ids")) throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  const nodeIds = replaceToolScope(connectorId, toolName, input.node_ids, admin.id);
  audit(admin.id, "runtime.tool_scope.updated", { connector_id: connectorId, tool_name: toolName, node_ids: nodeIds });
  return c.json({ connector_id: connectorId, tool_name: toolName, node_ids: nodeIds });
});

connectorOrganizationRouter.post("/admin/runtime/connectors/:connectorId/organization-scope/sync", async (c) => {
  const admin = runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  if (Object.keys(await body(c)).length) throw new HttpFail(400, { code: "runtime_organization_invalid_request" });
  const config = getConnectorConfig(connectorId);
  if (!config) throw new HttpFail(409, { code: "runtime_connector_not_configured" });

  const context = { agentId: "governance", skillId: "", userId: admin.id, runId: "organization-sync" };
  const known = await inspectConnectorTools(context, connectorId);
  const candidates = ["getOrganizationTree", "listOrganizationTree", "pageOrganizationTree", "listDepartments"];
  const tool = known.find((item) => candidates.includes(String(item.name)));
  if (!tool) {
    throw new HttpFail(422, {
      code: "starry_organization_tree_tool_unavailable",
      required_tools: candidates,
      available_tool_count: known.length,
    });
  }
  const client = createConfiguredClient(context, config.config);
  try {
    const result = await client.callToolRaw(String(tool.name), {});
    const snapshot = replaceOrganizationScopeSnapshot(connectorId, parseRemoteTree(result), `starry-mcp:${tool.name}`);
    audit(admin.id, "runtime.organization_scope.synced", {
      connector_id: connectorId,
      source: snapshot.source,
      node_count: snapshot.nodes.length,
    });
    return c.json(snapshot);
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    throw new HttpFail(502, { code: runtimeErrorCode(error) });
  } finally {
    await client.close().catch(() => undefined);
  }
});

connectorOrganizationRouter.get("/admin/runtime/connectors/:connectorId/tools/:toolName/scope", (c) => {
  runtimeAdmin();
  const connectorId = requireManagedConnector(c.req.param("connectorId"));
  const toolName = c.req.param("toolName");
  return c.json({ connector_id: connectorId, tool_name: toolName, node_ids: toolScopeNodeIds(connectorId, toolName) });
});
