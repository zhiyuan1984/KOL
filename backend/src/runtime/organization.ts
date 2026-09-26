import { asRows, getConn, nowIso, txImmediate } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";

export type OrganizationNode = {
  id: string;
  parent_id: string | null;
  name: string;
  level: 1 | 2 | 3;
  external_id: string;
  local_user_id: string | null;
  status: "matched" | "unmatched";
};

export type OrganizationScopeSnapshot = {
  connector_id: string;
  synced_at: string | null;
  source: string | null;
  nodes: OrganizationNode[];
};

export type OrganizationScopeInput = {
  id: string;
  parent_id?: string | null;
  name: string;
  level: 1 | 2 | 3;
  external_id?: string;
  email?: string;
};

const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TOOL_NAME = /^[\s\S]{1,320}$/;

const initializedConnections = new WeakSet<object>();

export function ensureOrganizationScopeSchema(): void {
  const db = getConn();
  if (initializedConnections.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_connector_organization_sync (
      connector_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runtime_connector_organization_nodes (
      connector_id TEXT NOT NULL,
      id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2,3)),
      external_id TEXT NOT NULL,
      local_user_id TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (connector_id,id),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE,
      FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS runtime_connector_org_nodes_parent_idx
      ON runtime_connector_organization_nodes(connector_id,parent_id,level);
    CREATE TABLE IF NOT EXISTS runtime_tool_scope_bindings (
      connector_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      node_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (connector_id,tool_name,node_id),
      FOREIGN KEY (connector_id,node_id) REFERENCES runtime_connector_organization_nodes(connector_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS runtime_tool_scope_bindings_tool_idx
      ON runtime_tool_scope_bindings(connector_id,tool_name);
    CREATE TABLE IF NOT EXISTS runtime_connector_tool_inventory (
      connector_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      schema_hash TEXT NOT NULL,
      input_schema TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      PRIMARY KEY (connector_id,tool_name),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );
  `);
  initializedConnections.add(db);
}

function asString(value: unknown, label: string, max = 320): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new HttpFail(400, { code: `runtime_organization_invalid_${label}` });
  }
  return value.trim();
}

function connectorExists(connectorId: string): void {
  if (!getConn().prepare("SELECT 1 FROM connectors WHERE id=?").get(connectorId)) {
    throw new HttpFail(404, { code: "connector_not_found", connector_id: connectorId });
  }
}

function mappedUserId(input: OrganizationScopeInput): string | null {
  const db = getConn();
  const byExternal = db.prepare("SELECT id FROM users WHERE id=? LIMIT 1").get(input.external_id || input.id) as Row | undefined;
  if (byExternal?.id) return String(byExternal.id);
  const email = String(input.email || "").trim().toLowerCase();
  if (email) {
    const byEmail = db.prepare("SELECT id FROM users WHERE lower(COALESCE(email,username))=? LIMIT 1").get(email) as Row | undefined;
    if (byEmail?.id) return String(byEmail.id);
  }
  const byName = db.prepare("SELECT id FROM users WHERE name=? LIMIT 2").all(input.name) as Row[];
  return byName.length === 1 ? String(byName[0].id) : null;
}

function validateNodes(value: OrganizationScopeInput[]): OrganizationScopeInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 10_000) {
    throw new HttpFail(400, { code: "runtime_organization_tree_empty" });
  }
  const seen = new Set<string>();
  const nodes = value.map((input) => {
    const id = asString(input?.id, "node_id", 160);
    const name = asString(input?.name, "node_name", 240);
    if (!NODE_ID.test(id) || seen.has(id)) throw new HttpFail(400, { code: "runtime_organization_invalid_node_id" });
    seen.add(id);
    const level = Number(input?.level);
    if (![1, 2, 3].includes(level)) throw new HttpFail(400, { code: "runtime_organization_invalid_level" });
    const parentId = input?.parent_id == null || input.parent_id === "" ? null : asString(input.parent_id, "parent_id", 160);
    if ((level === 1 && parentId) || (level > 1 && !parentId)) {
      throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
    }
    return { id, name, level: level as 1 | 2 | 3, parent_id: parentId, external_id: String(input?.external_id || id), email: input?.email };
  });
  const index = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (!node.parent_id) continue;
    const parent = index.get(node.parent_id);
    if (!parent || parent.level !== node.level - 1) {
      throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
    }
  }
  if (!nodes.some((node) => node.level === 1) || !nodes.some((node) => node.level === 3)) {
    throw new HttpFail(400, { code: "runtime_organization_requires_three_levels" });
  }
  return nodes;
}

export function replaceOrganizationScopeSnapshot(
  connectorId: string,
  nodesInput: OrganizationScopeInput[],
  source: string,
): OrganizationScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const nodes = validateNodes(nodesInput);
  const normalizedSource = asString(source, "source", 120);
  const syncedAt = nowIso();
  const localMappings = new Map(nodes.map((node) => [node.id, mappedUserId(node)]));
  txImmediate((db) => {
    db.prepare("DELETE FROM runtime_connector_organization_nodes WHERE connector_id=?").run(connectorId);
    const insert = db.prepare(`INSERT INTO runtime_connector_organization_nodes
      (connector_id,id,parent_id,name,level,external_id,local_user_id,synced_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const node of nodes) {
      insert.run(connectorId, node.id, node.parent_id || null, node.name, node.level, node.external_id, localMappings.get(node.id) || null, syncedAt);
    }
    db.prepare(`INSERT INTO runtime_connector_organization_sync(connector_id,source,synced_at) VALUES (?,?,?)
      ON CONFLICT(connector_id) DO UPDATE SET source=excluded.source,synced_at=excluded.synced_at`).run(connectorId, normalizedSource, syncedAt);
  });
  return getOrganizationScopeSnapshot(connectorId);
}

export function getOrganizationScopeSnapshot(connectorId: string): OrganizationScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const db = getConn();
  const sync = db.prepare("SELECT source,synced_at FROM runtime_connector_organization_sync WHERE connector_id=?").get(connectorId) as Row | undefined;
  const nodes = asRows(db.prepare(`SELECT id,parent_id,name,level,external_id,local_user_id FROM runtime_connector_organization_nodes
    WHERE connector_id=? ORDER BY level,name,id`).all(connectorId)).map((row) => ({
    id: String(row.id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    level: Number(row.level) as 1 | 2 | 3,
    external_id: String(row.external_id),
    local_user_id: row.local_user_id ? String(row.local_user_id) : null,
    status: row.local_user_id ? "matched" as const : "unmatched" as const,
  }));
  return { connector_id: connectorId, synced_at: sync?.synced_at ? String(sync.synced_at) : null, source: sync?.source ? String(sync.source) : null, nodes };
}

/** Direct authorization structure: 一级部门 → 二级部门 → 岗位. */
export function addOrganizationScopeNode(
  connectorId: string,
  input: { name: unknown; level: unknown; parent_id?: unknown },
): OrganizationScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const name = asString(input.name, "node_name", 240);
  const level = Number(input.level);
  if (![1, 2, 3].includes(level)) throw new HttpFail(400, { code: "runtime_organization_invalid_level" });
  const parentId = input.parent_id == null || input.parent_id === "" ? null : asString(input.parent_id, "parent_id", 160);
  if ((level === 1 && parentId) || (level > 1 && !parentId)) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
  if (parentId) {
    const parent = getConn().prepare("SELECT level FROM runtime_connector_organization_nodes WHERE connector_id=? AND id=?")
      .get(connectorId, parentId) as Row | undefined;
    if (!parent || Number(parent.level) !== level - 1) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
  }
  const id = nid("scope");
  const now = nowIso();
  txImmediate((db) => {
    db.prepare(`INSERT INTO runtime_connector_organization_nodes
      (connector_id,id,parent_id,name,level,external_id,local_user_id,synced_at) VALUES (?,?,?,?,?,?,NULL,?)`)
      .run(connectorId, id, parentId, name, level, id, now);
    db.prepare(`INSERT INTO runtime_connector_organization_sync(connector_id,source,synced_at) VALUES (?,?,?)
      ON CONFLICT(connector_id) DO UPDATE SET source=excluded.source,synced_at=excluded.synced_at`)
      .run(connectorId, "manual-department-position", now);
  });
  return getOrganizationScopeSnapshot(connectorId);
}

export function toolScopeNodeIds(connectorId: string, toolName: string): string[] {
  ensureOrganizationScopeSchema();
  return asRows(getConn().prepare(`SELECT node_id FROM runtime_tool_scope_bindings
    WHERE connector_id=? AND tool_name=? ORDER BY node_id`).all(connectorId, toolName)).map((row) => String(row.node_id));
}

export function replaceToolScope(
  connectorId: string,
  toolNameInput: string,
  nodeIdsInput: unknown,
  actorId: string,
): string[] {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const toolName = asString(toolNameInput, "tool_name", 320);
  if (!TOOL_NAME.test(toolName)) throw new HttpFail(400, { code: "runtime_organization_invalid_tool_name" });
  if (!Array.isArray(nodeIdsInput)) throw new HttpFail(400, { code: "runtime_organization_scope_nodes_required" });
  const nodeIds = [...new Set(nodeIdsInput.map((value) => asString(value, "node_id", 160)))];
  if (!nodeIds.length) throw new HttpFail(400, { code: "runtime_organization_scope_nodes_required" });
  const db = getConn();
  const available = new Set(asRows(db.prepare("SELECT id FROM runtime_connector_organization_nodes WHERE connector_id=?").all(connectorId)).map((row) => String(row.id)));
  if (nodeIds.some((id) => !available.has(id))) throw new HttpFail(400, { code: "runtime_organization_scope_node_unknown" });
  const now = nowIso();
  txImmediate((tx) => {
    tx.prepare("DELETE FROM runtime_tool_scope_bindings WHERE connector_id=? AND tool_name=?").run(connectorId, toolName);
    const insert = tx.prepare("INSERT INTO runtime_tool_scope_bindings(connector_id,tool_name,node_id,created_by,created_at) VALUES (?,?,?,?,?)");
    for (const nodeId of nodeIds) insert.run(connectorId, toolName, nodeId, actorId, now);
  });
  return toolScopeNodeIds(connectorId, toolName);
}

/** Returns true when a selected node covers the user's explicit position. */
export function userHasToolScope(connectorId: string, toolName: string, userId: string): boolean {
  ensureOrganizationScopeSchema();
  const row = getConn().prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT node_id FROM runtime_tool_scope_bindings WHERE connector_id=? AND tool_name=?
      UNION ALL
      SELECT node.id FROM runtime_connector_organization_nodes node
      JOIN descendants parent ON node.parent_id=parent.id
      WHERE node.connector_id=?
    )
    SELECT 1 FROM runtime_connector_organization_nodes node
    JOIN users user ON user.id=? AND user.active=1
    WHERE node.connector_id=? AND node.id IN descendants
      AND (node.local_user_id=? OR (node.level=3 AND node.name=COALESCE(user.position,'')))
    LIMIT 1`).get(connectorId, toolName, connectorId, userId, connectorId, userId);
  return Boolean(row);
}

export function connectorHasScopedTools(connectorId: string): boolean {
  ensureOrganizationScopeSchema();
  const row = getConn().prepare(`SELECT 1 FROM runtime_tool_policies policy
    JOIN runtime_tool_scope_bindings scope ON scope.connector_id=policy.connector_id AND scope.tool_name=policy.tool_name
    WHERE policy.connector_id=? AND policy.enabled=1 LIMIT 1`).get(connectorId);
  return Boolean(row);
}

/** Existing direct grants remain usable until an administrator starts configuring a scope tree. */
export function connectorHasOrganizationScopes(connectorId: string): boolean {
  ensureOrganizationScopeSchema();
  return Boolean(getConn().prepare(
    "SELECT 1 FROM runtime_tool_scope_bindings WHERE connector_id=? LIMIT 1",
  ).get(connectorId));
}

export function recordToolInventory(connectorId: string, tools: Json[]): void {
  ensureOrganizationScopeSchema();
  const now = nowIso();
  txImmediate((db) => {
    const insert = db.prepare(`INSERT INTO runtime_connector_tool_inventory(connector_id,tool_name,description,schema_hash,input_schema,discovered_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(connector_id,tool_name) DO UPDATE SET description=excluded.description,schema_hash=excluded.schema_hash,input_schema=excluded.input_schema,discovered_at=excluded.discovered_at`);
    for (const tool of tools) {
      if (!tool || typeof tool !== "object") continue;
      const row = tool as Record<string, unknown>;
      if (typeof row.name !== "string" || typeof row.schema_hash !== "string" || !row.inputSchema || typeof row.inputSchema !== "object") continue;
      insert.run(connectorId, row.name, typeof row.description === "string" ? row.description : "", row.schema_hash, JSON.stringify(row.inputSchema), now);
    }
  });
}
