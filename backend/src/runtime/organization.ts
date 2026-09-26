import { asRows, getConn, nowIso, txImmediate } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";

export type OrganizationNode = {
  id: string;
  parent_id: string | null;
  name: string;
  level: 1 | 2 | 3;
  is_person: boolean;
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
      is_person INTEGER NOT NULL DEFAULT 0 CHECK (is_person IN (0,1)),
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
    CREATE TABLE IF NOT EXISTS runtime_tool_global_scopes (
      connector_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (connector_id,tool_name),
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runtime_connector_scope_modes (
      connector_id TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );
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
    CREATE TABLE IF NOT EXISTS runtime_connector_scope_policies (
      connector_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('all','selected')),
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runtime_connector_scope_bindings (
      connector_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      access TEXT NOT NULL CHECK (access IN ('read','write')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (connector_id,node_id),
      FOREIGN KEY (connector_id,node_id) REFERENCES runtime_connector_organization_nodes(connector_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS runtime_connector_scope_bindings_idx ON runtime_connector_scope_bindings(connector_id);
  `);
  const nodeColumns = db.prepare("PRAGMA table_info(runtime_connector_organization_nodes)").all() as { name: string }[];
  if (!nodeColumns.some((column) => column.name === "is_person")) {
    db.exec("ALTER TABLE runtime_connector_organization_nodes ADD COLUMN is_person INTEGER NOT NULL DEFAULT 0 CHECK (is_person IN (0,1))");
    db.exec("UPDATE runtime_connector_organization_nodes SET is_person=1 WHERE local_user_id IS NOT NULL");
  }
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

export function getOrganizationScopeSnapshot(connectorId: string): OrganizationScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const db = getConn();
  const sync = db.prepare("SELECT source,synced_at FROM runtime_connector_organization_sync WHERE connector_id=?").get(connectorId) as Row | undefined;
  const nodes = asRows(db.prepare(`SELECT id,parent_id,name,level,is_person,external_id,local_user_id FROM runtime_connector_organization_nodes
    WHERE connector_id=? ORDER BY level,name,id`).all(connectorId)).map((row) => ({
    id: String(row.id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    name: String(row.name),
    level: Number(row.level) as 1 | 2 | 3,
    is_person: Boolean(row.is_person),
    external_id: String(row.external_id),
    local_user_id: row.local_user_id ? String(row.local_user_id) : null,
    status: row.local_user_id ? "matched" as const : "unmatched" as const,
  }));
  return { connector_id: connectorId, synced_at: sync?.synced_at ? String(sync.synced_at) : null, source: sync?.source ? String(sync.source) : null, nodes };
}

/** Direct authorization structure: 一级部门 → 二级部门 → 岗位. */
export function addOrganizationScopeNode(
  connectorId: string,
  input: { name?: unknown; level: unknown; parent_id?: unknown; user_id?: unknown; external_id?: unknown },
): OrganizationScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const level = Number(input.level);
  if (![1, 2, 3].includes(level)) throw new HttpFail(400, { code: "runtime_organization_invalid_level" });
  const userId = input.user_id == null || input.user_id === "" ? null : asString(input.user_id, "user_id", 160);
  if (userId && level !== 3) throw new HttpFail(400, { code: "runtime_organization_person_must_be_level_three" });
  const user = userId
    ? getConn().prepare("SELECT id,name FROM users WHERE id=? AND active=1").get(userId) as Row | undefined
    : undefined;
  if (userId && !user) throw new HttpFail(400, { code: "runtime_organization_user_not_active" });
  const name = user ? asString(user.name, "node_name", 240) : asString(input.name, "node_name", 240);
  const parentId = input.parent_id == null || input.parent_id === "" ? null : asString(input.parent_id, "parent_id", 160);
  if ((level === 1 && parentId) || (level > 1 && !parentId)) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
  if (parentId) {
    const parent = getConn().prepare("SELECT level FROM runtime_connector_organization_nodes WHERE connector_id=? AND id=?")
      .get(connectorId, parentId) as Row | undefined;
    if (!parent || Number(parent.level) !== level - 1) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
  }
  const id = nid("scope");
  // Registry-backed units keep their canonical id; manual nodes fall back to the local id.
  const externalId = user
    ? userId
    : input.external_id == null || input.external_id === ""
      ? id
      : asString(input.external_id, "external_id", 255);
  const now = nowIso();
  txImmediate((db) => {
    db.prepare(`INSERT INTO runtime_connector_organization_nodes
      (connector_id,id,parent_id,name,level,is_person,external_id,local_user_id,synced_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(connectorId, id, parentId, name, level, userId ? 1 : 0, externalId, userId, now);
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
  allInput = false,
): { node_ids: string[]; all: boolean } {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const toolName = asString(toolNameInput, "tool_name", 320);
  if (!TOOL_NAME.test(toolName)) throw new HttpFail(400, { code: "runtime_organization_invalid_tool_name" });
  if (typeof allInput !== "boolean") throw new HttpFail(400, { code: "runtime_organization_scope_invalid_all" });
  if (!Array.isArray(nodeIdsInput)) throw new HttpFail(400, { code: "runtime_organization_scope_nodes_required" });
  const nodeIds = [...new Set(nodeIdsInput.map((value) => asString(value, "node_id", 160)))];
  if (allInput && nodeIds.length) throw new HttpFail(400, { code: "runtime_organization_scope_invalid_all" });
  const db = getConn();
  const available = new Set(asRows(db.prepare("SELECT id FROM runtime_connector_organization_nodes WHERE connector_id=?").all(connectorId)).map((row) => String(row.id)));
  if (nodeIds.some((id) => !available.has(id))) throw new HttpFail(400, { code: "runtime_organization_scope_node_unknown" });
  const now = nowIso();
  txImmediate((tx) => {
    tx.prepare("INSERT OR IGNORE INTO runtime_connector_scope_modes(connector_id,created_by,created_at) VALUES (?,?,?)")
      .run(connectorId, actorId, now);
    tx.prepare("DELETE FROM runtime_tool_scope_bindings WHERE connector_id=? AND tool_name=?").run(connectorId, toolName);
    tx.prepare("DELETE FROM runtime_tool_global_scopes WHERE connector_id=? AND tool_name=?").run(connectorId, toolName);
    if (allInput) {
      tx.prepare("INSERT INTO runtime_tool_global_scopes(connector_id,tool_name,created_by,created_at) VALUES (?,?,?,?)")
        .run(connectorId, toolName, actorId, now);
    }
    const insert = tx.prepare("INSERT INTO runtime_tool_scope_bindings(connector_id,tool_name,node_id,created_by,created_at) VALUES (?,?,?,?,?)");
    for (const nodeId of nodeIds) insert.run(connectorId, toolName, nodeId, actorId, now);
  });
  return { node_ids: toolScopeNodeIds(connectorId, toolName), all: toolHasGlobalScope(connectorId, toolName) };
}

export function toolHasGlobalScope(connectorId: string, toolName: string): boolean {
  ensureOrganizationScopeSchema();
  return Boolean(getConn().prepare(
    "SELECT 1 FROM runtime_tool_global_scopes WHERE connector_id=? AND tool_name=? LIMIT 1",
  ).get(connectorId, toolName));
}

/** Returns true when a selected node covers the user's explicit position. */
export function userHasToolScope(connectorId: string, toolName: string, userId: string): boolean {
  ensureOrganizationScopeSchema();
  const db = getConn();
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(userId)) return false;
  if (toolHasGlobalScope(connectorId, toolName)) return true;
  const row = db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT node_id FROM runtime_tool_scope_bindings WHERE connector_id=? AND tool_name=?
      UNION ALL
      SELECT node.id FROM runtime_connector_organization_nodes node
      JOIN descendants parent ON node.parent_id=parent.id
      WHERE node.connector_id=?
    )
    SELECT 1 FROM runtime_connector_organization_nodes node
    JOIN users user ON user.id=? AND user.active=1
    WHERE node.connector_id=? AND node.id IN descendants
      AND (node.local_user_id=? OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(user.position,'')))
    LIMIT 1`).get(connectorId, toolName, connectorId, userId, connectorId, userId);
  return Boolean(row);
}

export function connectorHasScopedTools(connectorId: string): boolean {
  ensureOrganizationScopeSchema();
  const row = getConn().prepare(`SELECT 1 FROM runtime_tool_policies policy
    WHERE policy.connector_id=? AND policy.enabled=1 AND (
      EXISTS (SELECT 1 FROM runtime_tool_scope_bindings scope WHERE scope.connector_id=policy.connector_id AND scope.tool_name=policy.tool_name)
      OR EXISTS (SELECT 1 FROM runtime_tool_global_scopes scope WHERE scope.connector_id=policy.connector_id AND scope.tool_name=policy.tool_name)
    ) LIMIT 1`).get(connectorId);
  return Boolean(row);
}

/** Existing direct grants remain usable until an administrator starts configuring a scope tree. */
export function connectorHasOrganizationScopes(connectorId: string): boolean {
  ensureOrganizationScopeSchema();
  return Boolean(getConn().prepare(`SELECT 1 WHERE
    EXISTS (SELECT 1 FROM runtime_connector_organization_sync WHERE connector_id=?)
    OR EXISTS (SELECT 1 FROM runtime_connector_scope_modes WHERE connector_id=?)
    OR EXISTS (SELECT 1 FROM runtime_tool_scope_bindings WHERE connector_id=?)
    OR EXISTS (SELECT 1 FROM runtime_tool_global_scopes WHERE connector_id=?)`).get(connectorId, connectorId, connectorId, connectorId));
}

/**
 * Connector-level reach expansion: a matching bound node grants read/write on
 * top of the per-person grants. It never narrows access, and tool-level scopes
 * stay an independent additional restriction. No marker is written to
 * `runtime_connector_scope_modes`, which belongs to tool-level governance.
 */
export type ConnectorScopeMode = "unset" | "all" | "selected";
export type ConnectorScopeBinding = { node_id: string; access: "read" | "write" };
export type ConnectorScopeSnapshot = {
  connector_id: string;
  mode: ConnectorScopeMode;
  updated_by: string | null;
  updated_at: string | null;
  bindings: ConnectorScopeBinding[];
  coverage: { users: number; read: number; write: number };
};

const CONNECTOR_SCOPE_TREE = `WITH RECURSIVE tree(node_id, access) AS (
    SELECT node_id, access FROM runtime_connector_scope_bindings WHERE connector_id=?
    UNION ALL
    SELECT node.id, tree.access FROM runtime_connector_organization_nodes node
    JOIN tree ON node.parent_id=tree.node_id WHERE node.connector_id=?
  )`;

const CONNECTOR_SCOPE_USER_SQL = `${CONNECTOR_SCOPE_TREE}
  SELECT MAX(CASE tree.access WHEN 'write' THEN 2 ELSE 1 END) AS level
  FROM tree
  JOIN runtime_connector_organization_nodes node ON node.id=tree.node_id AND node.connector_id=?
  JOIN users user ON user.id=? AND user.active=1
  WHERE node.local_user_id=user.id OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(user.position,''))`;

const CONNECTOR_SCOPE_COVERAGE_SQL = `${CONNECTOR_SCOPE_TREE}
  SELECT user.id AS user_id, MAX(CASE tree.access WHEN 'write' THEN 2 ELSE 1 END) AS level
  FROM tree
  JOIN runtime_connector_organization_nodes node ON node.id=tree.node_id AND node.connector_id=?
  JOIN users user ON user.active=1
  WHERE node.local_user_id=user.id OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(user.position,''))
  GROUP BY user.id`;

/** A stored connector-level policy row (either mode) marks the scope as configured. */
export function connectorScopeConfigured(connectorId: string): boolean {
  ensureOrganizationScopeSchema();
  return Boolean(getConn().prepare("SELECT 1 FROM runtime_connector_scope_policies WHERE connector_id=?").get(connectorId));
}

/** The enable gate accepts either a connector-level or a tool-level scope. */
export function connectorHasAnyScope(connectorId: string): boolean {
  return connectorScopeConfigured(connectorId) || connectorHasScopedTools(connectorId);
}

function connectorScopeBindings(connectorId: string): ConnectorScopeBinding[] {
  return asRows(getConn().prepare(
    "SELECT node_id,access FROM runtime_connector_scope_bindings WHERE connector_id=? ORDER BY node_id",
  ).all(connectorId)).map((row) => ({
    node_id: String(row.node_id),
    access: String(row.access) === "write" ? "write" as const : "read" as const,
  }));
}

function connectorScopeCoverage(connectorId: string, mode: ConnectorScopeMode): { users: number; read: number; write: number } {
  if (mode === "all") {
    const row = getConn().prepare("SELECT COUNT(*) AS n FROM users WHERE active=1").get() as Row | undefined;
    const users = Number(row?.n || 0);
    return { users, read: users, write: 0 };
  }
  if (mode !== "selected") return { users: 0, read: 0, write: 0 };
  const rows = asRows(getConn().prepare(CONNECTOR_SCOPE_COVERAGE_SQL).all(connectorId, connectorId, connectorId));
  const levelOf = (row: Row): number => Number(row.level || 0);
  return {
    users: rows.length,
    read: rows.filter((row) => levelOf(row) === 1).length,
    write: rows.filter((row) => levelOf(row) >= 2).length,
  };
}

export function getConnectorScopeSnapshot(connectorId: string): ConnectorScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  const policy = getConn().prepare(
    "SELECT mode,updated_by,updated_at FROM runtime_connector_scope_policies WHERE connector_id=?",
  ).get(connectorId) as Row | undefined;
  const mode: ConnectorScopeMode = policy?.mode === "all" || policy?.mode === "selected" ? policy.mode : "unset";
  return {
    connector_id: connectorId,
    mode,
    updated_by: policy?.updated_by ? String(policy.updated_by) : null,
    updated_at: policy?.updated_at ? String(policy.updated_at) : null,
    bindings: mode === "unset" ? [] : connectorScopeBindings(connectorId),
    coverage: connectorScopeCoverage(connectorId, mode),
  };
}

function parseConnectorScopeBindings(bindingsInput: unknown): ConnectorScopeBinding[] {
  if (!Array.isArray(bindingsInput)) throw new HttpFail(400, { code: "runtime_connector_scope_invalid_bindings" });
  const seen = new Set<string>();
  const bindings: ConnectorScopeBinding[] = [];
  for (const entry of bindingsInput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpFail(400, { code: "runtime_connector_scope_invalid_bindings" });
    }
    const value = entry as Record<string, unknown>;
    const nodeId = asString(value.node_id, "node_id", 160);
    if (seen.has(nodeId)) continue;
    const accessInput = value.access === undefined ? "read" : value.access;
    if (accessInput !== "read" && accessInput !== "write") {
      throw new HttpFail(400, { code: "runtime_connector_scope_invalid_access" });
    }
    seen.add(nodeId);
    bindings.push({ node_id: nodeId, access: accessInput });
  }
  return bindings;
}

export function replaceConnectorScope(
  connectorId: string,
  modeInput: unknown,
  bindingsInput: unknown,
  actorId: string,
): ConnectorScopeSnapshot {
  ensureOrganizationScopeSchema();
  connectorExists(connectorId);
  if (modeInput !== "unset" && modeInput !== "all" && modeInput !== "selected") {
    throw new HttpFail(400, { code: "runtime_connector_scope_invalid_mode" });
  }
  const bindings = parseConnectorScopeBindings(bindingsInput);
  if (bindings.length) {
    const available = new Set(asRows(getConn().prepare(
      "SELECT id FROM runtime_connector_organization_nodes WHERE connector_id=?",
    ).all(connectorId)).map((row) => String(row.id)));
    if (bindings.some((binding) => !available.has(binding.node_id))) {
      throw new HttpFail(400, { code: "runtime_connector_scope_node_unknown" });
    }
  }
  if (modeInput === "selected" && !bindings.length) {
    throw new HttpFail(400, { code: "runtime_connector_scope_bindings_required" });
  }
  const now = nowIso();
  txImmediate((tx) => {
    if (modeInput === "unset") {
      tx.prepare("DELETE FROM runtime_connector_scope_bindings WHERE connector_id=?").run(connectorId);
      tx.prepare("DELETE FROM runtime_connector_scope_policies WHERE connector_id=?").run(connectorId);
      return;
    }
    tx.prepare(`INSERT INTO runtime_connector_scope_policies(connector_id,mode,updated_by,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(connector_id) DO UPDATE SET mode=excluded.mode,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(connectorId, modeInput, actorId, now);
    tx.prepare("DELETE FROM runtime_connector_scope_bindings WHERE connector_id=?").run(connectorId);
    if (modeInput === "all") return;
    const insert = tx.prepare(
      "INSERT INTO runtime_connector_scope_bindings(connector_id,node_id,access,created_by,created_at) VALUES (?,?,?,?,?)",
    );
    for (const binding of bindings) insert.run(connectorId, binding.node_id, binding.access, actorId, now);
  });
  return getConnectorScopeSnapshot(connectorId);
}

/** Connector-level reach for one active user; `null` means the scope grants nothing. */
export function userConnectorScopeAccess(connectorId: string, userId: string): "read" | "write" | null {
  ensureOrganizationScopeSchema();
  const db = getConn();
  const policy = db.prepare("SELECT mode FROM runtime_connector_scope_policies WHERE connector_id=?").get(connectorId) as Row | undefined;
  if (!policy) return null;
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(userId)) return null;
  if (policy.mode === "all") return "read";
  if (policy.mode !== "selected") return null;
  const row = db.prepare(CONNECTOR_SCOPE_USER_SQL).get(connectorId, connectorId, connectorId, userId) as Row | undefined;
  if (row?.level === null || row?.level === undefined) return null;
  const level = Number(row.level);
  if (!Number.isFinite(level) || level < 1) return null;
  return level >= 2 ? "write" : "read";
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
