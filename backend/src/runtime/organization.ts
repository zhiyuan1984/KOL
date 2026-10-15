import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export type OrganizationNode = { id: string; parent_id: string | null; name: string; level: 1 | 2 | 3; is_person: boolean; external_id: string; local_user_id: string | null; status: "matched" | "unmatched" };
export type OrganizationScopeSnapshot = { connector_id: string; synced_at: string | null; source: string | null; nodes: OrganizationNode[] };
export type ConnectorScopeMode = "unset" | "all" | "selected";
export type ConnectorScopeBinding = { node_id: string; access: "read" | "write" };
export type ConnectorScopeSnapshot = { connector_id: string; mode: ConnectorScopeMode; updated_by: string | null; updated_at: string | null; bindings: ConnectorScopeBinding[]; coverage: { users: number; read: number; write: number } };

const TOOL_NAME = /^[\s\S]{1,320}$/;
const CONNECTION_SCOPE_TREE = `WITH RECURSIVE tree(node_id, access) AS (
  SELECT node_id, access FROM runtime_connector_scope_bindings WHERE connector_id=$1
  UNION ALL
  SELECT node.id, tree.access FROM runtime_connector_organization_nodes node
  JOIN tree ON node.parent_id=tree.node_id WHERE node.connector_id=$2
)`;

/** Formal PostgreSQL migrations own all runtime organization tables; no runtime DDL is permitted. */
export async function ensureOrganizationScopeSchema(): Promise<void> { /* intentionally migration-owned */ }

function nowIso(): string { return new Date().toISOString(); }
function asString(value: unknown, label: string, max = 320): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw new HttpFail(400, { code: `runtime_organization_invalid_${label}` });
  return value.trim();
}
async function connectorExists(connectorId: string): Promise<void> {
  if (!(await postgresQuery("SELECT 1 FROM connectors WHERE id=$1", [connectorId])).length) throw new HttpFail(404, { code: "connector_not_found", connector_id: connectorId });
}

export async function getOrganizationScopeSnapshot(connectorId: string): Promise<OrganizationScopeSnapshot> {
  await ensureOrganizationScopeSchema(); await connectorExists(connectorId);
  const [sync] = await postgresQuery<Row>("SELECT source,synced_at FROM runtime_connector_organization_sync WHERE connector_id=$1", [connectorId]);
  const rows = await postgresQuery<Row>(`SELECT id,parent_id,name,level,is_person,external_id,local_user_id FROM runtime_connector_organization_nodes
    WHERE connector_id=$1 ORDER BY level,name,id`, [connectorId]);
  const nodes = rows.map((row) => ({ id: String(row.id), parent_id: row.parent_id ? String(row.parent_id) : null, name: String(row.name), level: Number(row.level) as 1|2|3,
    is_person: Number(row.is_person) === 1, external_id: String(row.external_id), local_user_id: row.local_user_id ? String(row.local_user_id) : null,
    status: row.local_user_id ? "matched" as const : "unmatched" as const }));
  return { connector_id: connectorId, synced_at: sync?.synced_at ? String(sync.synced_at) : null, source: sync?.source ? String(sync.source) : null, nodes };
}

export async function addOrganizationScopeNode(connectorId: string, input: { name?: unknown; level: unknown; parent_id?: unknown; user_id?: unknown; external_id?: unknown }): Promise<OrganizationScopeSnapshot> {
  await ensureOrganizationScopeSchema(); await connectorExists(connectorId);
  const level = Number(input.level); if (![1,2,3].includes(level)) throw new HttpFail(400, { code: "runtime_organization_invalid_level" });
  const userId = input.user_id == null || input.user_id === "" ? null : asString(input.user_id, "user_id", 160);
  if (userId && level !== 3) throw new HttpFail(400, { code: "runtime_organization_person_must_be_level_three" });
  const user = userId ? (await postgresQuery<Row>("SELECT id,name FROM users WHERE id=$1 AND active=1", [userId]))[0] : undefined;
  if (userId && !user) throw new HttpFail(400, { code: "runtime_organization_user_not_active" });
  const name = user ? asString(user.name, "node_name", 240) : asString(input.name, "node_name", 240);
  const parentId = input.parent_id == null || input.parent_id === "" ? null : asString(input.parent_id, "parent_id", 160);
  if ((level === 1 && parentId) || (level > 1 && !parentId)) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" });
  const id = nid("scope"); const externalId = user ? userId! : input.external_id == null || input.external_id === "" ? id : asString(input.external_id, "external_id", 255);
  const now = nowIso();
  await postgresTransaction(async (client) => {
    if (parentId) { const parent = (await client.query<Row>("SELECT level FROM runtime_connector_organization_nodes WHERE connector_id=$1 AND id=$2 FOR SHARE", [connectorId,parentId])).rows[0]; if (!parent || Number(parent.level) !== level - 1) throw new HttpFail(400, { code: "runtime_organization_invalid_hierarchy" }); }
    await client.query(`INSERT INTO runtime_connector_organization_nodes(connector_id,id,parent_id,name,level,is_person,external_id,local_user_id,synced_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [connectorId,id,parentId,name,level,userId?1:0,externalId,userId,now]);
    await client.query(`INSERT INTO runtime_connector_organization_sync(connector_id,source,synced_at) VALUES($1,$2,$3)
      ON CONFLICT(connector_id) DO UPDATE SET source=EXCLUDED.source,synced_at=EXCLUDED.synced_at`, [connectorId,"manual-department-position",now]);
  }, { isolation: "SERIALIZABLE" });
  return (getOrganizationScopeSnapshot(connectorId));
}

export async function toolScopeNodeIds(connectorId: string, toolName: string): Promise<string[]> {
  await ensureOrganizationScopeSchema(); return (await postgresQuery<Row>("SELECT node_id FROM runtime_tool_scope_bindings WHERE connector_id=$1 AND tool_name=$2 ORDER BY node_id", [connectorId,toolName])).map((row) => String(row.node_id));
}
export async function toolHasGlobalScope(connectorId: string, toolName: string): Promise<boolean> {
  await ensureOrganizationScopeSchema(); return (await postgresQuery("SELECT 1 FROM runtime_tool_global_scopes WHERE connector_id=$1 AND tool_name=$2 LIMIT 1", [connectorId,toolName])).length > 0;
}

export async function replaceToolScope(connectorId: string, toolNameInput: string, nodeIdsInput: unknown, actorId: string, allInput = false): Promise<{ node_ids: string[]; all: boolean }> {
  await ensureOrganizationScopeSchema(); await connectorExists(connectorId);
  const toolName = asString(toolNameInput, "tool_name", 320); if (!TOOL_NAME.test(toolName)) throw new HttpFail(400, { code: "runtime_organization_invalid_tool_name" });
  if (typeof allInput !== "boolean") throw new HttpFail(400, { code: "runtime_organization_scope_invalid_all" }); if (!Array.isArray(nodeIdsInput)) throw new HttpFail(400, { code: "runtime_organization_scope_nodes_required" });
  const nodeIds = [...new Set(nodeIdsInput.map((value) => asString(value, "node_id", 160)))]; if (allInput && nodeIds.length) throw new HttpFail(400, { code: "runtime_organization_scope_invalid_all" });
  const now = nowIso();
  await postgresTransaction(async (client) => {
    const available = new Set((await client.query<Row>("SELECT id FROM runtime_connector_organization_nodes WHERE connector_id=$1 FOR SHARE", [connectorId])).rows.map((row) => String(row.id)));
    if (nodeIds.some((id) => !available.has(id))) throw new HttpFail(400, { code: "runtime_organization_scope_node_unknown" });
    await client.query("INSERT INTO runtime_connector_scope_modes(connector_id,created_by,created_at) VALUES($1,$2,$3) ON CONFLICT(connector_id) DO NOTHING", [connectorId,actorId,now]);
    await client.query("DELETE FROM runtime_tool_scope_bindings WHERE connector_id=$1 AND tool_name=$2", [connectorId,toolName]); await client.query("DELETE FROM runtime_tool_global_scopes WHERE connector_id=$1 AND tool_name=$2", [connectorId,toolName]);
    if (allInput) await client.query("INSERT INTO runtime_tool_global_scopes(connector_id,tool_name,created_by,created_at) VALUES($1,$2,$3,$4)", [connectorId,toolName,actorId,now]);
    for (const nodeId of nodeIds) await client.query("INSERT INTO runtime_tool_scope_bindings(connector_id,tool_name,node_id,created_by,created_at) VALUES($1,$2,$3,$4,$5)", [connectorId,toolName,nodeId,actorId,now]);
  }, { isolation: "SERIALIZABLE" });
  return { node_ids: await toolScopeNodeIds(connectorId,toolName), all: await toolHasGlobalScope(connectorId,toolName) };
}

export async function userHasToolScope(connectorId: string, toolName: string, userId: string): Promise<boolean> {
  await ensureOrganizationScopeSchema();
  const [user] = await postgresQuery<Row>("SELECT 1 FROM users WHERE id=$1 AND active=1", [userId]); if (!user) return false;
  if (await toolHasGlobalScope(connectorId,toolName)) return true;
  return (await postgresQuery(`WITH RECURSIVE descendants(id) AS (
    SELECT node_id FROM runtime_tool_scope_bindings WHERE connector_id=$1 AND tool_name=$2 UNION ALL
    SELECT node.id FROM runtime_connector_organization_nodes node JOIN descendants parent ON node.parent_id=parent.id WHERE node.connector_id=$3
  ) SELECT 1 FROM runtime_connector_organization_nodes node JOIN users usr ON usr.id=$4 AND usr.active=1
  WHERE node.connector_id=$5 AND node.id IN (SELECT id FROM descendants)
    AND (node.local_user_id=$6 OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(usr.position,''))) LIMIT 1`, [connectorId,toolName,connectorId,userId,connectorId,userId])).length > 0;
}

export async function connectorHasScopedTools(connectorId: string): Promise<boolean> {
  await ensureOrganizationScopeSchema(); return (await postgresQuery(`SELECT 1 FROM runtime_tool_policies policy WHERE policy.connector_id=$1 AND policy.enabled=1 AND (
    EXISTS (SELECT 1 FROM runtime_tool_scope_bindings scope WHERE scope.connector_id=policy.connector_id AND scope.tool_name=policy.tool_name) OR
    EXISTS (SELECT 1 FROM runtime_tool_global_scopes scope WHERE scope.connector_id=policy.connector_id AND scope.tool_name=policy.tool_name)) LIMIT 1`, [connectorId])).length > 0;
}
export async function connectorHasOrganizationScopes(connectorId: string): Promise<boolean> {
  await ensureOrganizationScopeSchema(); return (await postgresQuery(`SELECT 1 WHERE EXISTS (SELECT 1 FROM runtime_connector_organization_sync WHERE connector_id=$1)
    OR EXISTS (SELECT 1 FROM runtime_connector_scope_modes WHERE connector_id=$1) OR EXISTS (SELECT 1 FROM runtime_tool_scope_bindings WHERE connector_id=$1)
    OR EXISTS (SELECT 1 FROM runtime_tool_global_scopes WHERE connector_id=$1)`, [connectorId])).length > 0;
}
export async function connectorScopeConfigured(connectorId: string): Promise<boolean> { await ensureOrganizationScopeSchema(); return (await postgresQuery("SELECT 1 FROM runtime_connector_scope_policies WHERE connector_id=$1", [connectorId])).length > 0; }
export async function connectorHasAnyScope(connectorId: string): Promise<boolean> { return ((await connectorScopeConfigured(connectorId))) || (await connectorHasScopedTools(connectorId)); }

async function connectorScopeBindings(connectorId: string): Promise<ConnectorScopeBinding[]> { return (await postgresQuery<Row>("SELECT node_id,access FROM runtime_connector_scope_bindings WHERE connector_id=$1 ORDER BY node_id", [connectorId])).map((row) => ({node_id:String(row.node_id),access:String(row.access)==="write"?"write" as const:"read" as const})); }
async function connectorScopeCoverage(connectorId: string, mode: ConnectorScopeMode): Promise<{users:number;read:number;write:number}> {
  if (mode === "all") { const [row] = await postgresQuery<Row>("SELECT COUNT(*) AS n FROM users WHERE active=1"); const users=Number(row?.n||0); return {users,read:users,write:0}; }
  if (mode !== "selected") return {users:0,read:0,write:0};
  const rows = await postgresQuery<Row>(`${CONNECTION_SCOPE_TREE} SELECT user_row.id AS user_id,MAX(CASE tree.access WHEN 'write' THEN 2 ELSE 1 END) AS level
    FROM tree JOIN runtime_connector_organization_nodes node ON node.id=tree.node_id AND node.connector_id=$3 JOIN users user_row ON user_row.active=1
    WHERE node.local_user_id=user_row.id OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(user_row.position,'')) GROUP BY user_row.id`, [connectorId,connectorId,connectorId]);
  return { users:rows.length, read:rows.filter((row)=>Number(row.level)===1).length, write:rows.filter((row)=>Number(row.level)>=2).length };
}
export async function getConnectorScopeSnapshot(connectorId: string): Promise<ConnectorScopeSnapshot> {
  await ensureOrganizationScopeSchema(); await connectorExists(connectorId); const [policy]=await postgresQuery<Row>("SELECT mode,updated_by,updated_at FROM runtime_connector_scope_policies WHERE connector_id=$1",[connectorId]);
  const mode: ConnectorScopeMode=policy?.mode==="all"||policy?.mode==="selected"?policy.mode:"unset";
  return {connector_id:connectorId,mode,updated_by:policy?.updated_by?String(policy.updated_by):null,updated_at:policy?.updated_at?String(policy.updated_at):null,bindings:mode==="unset"?[]:await connectorScopeBindings(connectorId),coverage:await connectorScopeCoverage(connectorId,mode)};
}
function parseConnectorScopeBindings(bindingsInput: unknown): ConnectorScopeBinding[] { if(!Array.isArray(bindingsInput)) throw new HttpFail(400,{code:"runtime_connector_scope_invalid_bindings"}); const seen=new Set<string>(); const output:ConnectorScopeBinding[]=[]; for(const entry of bindingsInput){if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new HttpFail(400,{code:"runtime_connector_scope_invalid_bindings"});const value=entry as Record<string,unknown>;const nodeId=asString(value.node_id,"node_id",160);if(seen.has(nodeId))continue;const access=value.access===undefined?"read":value.access;if(access!=="read"&&access!=="write")throw new HttpFail(400,{code:"runtime_connector_scope_invalid_access"});seen.add(nodeId);output.push({node_id:nodeId,access});}return output; }
export async function replaceConnectorScope(connectorId:string,modeInput:unknown,bindingsInput:unknown,actorId:string):Promise<ConnectorScopeSnapshot>{
  await ensureOrganizationScopeSchema();await connectorExists(connectorId);if(modeInput!=="unset"&&modeInput!=="all"&&modeInput!=="selected")throw new HttpFail(400,{code:"runtime_connector_scope_invalid_mode"});const bindings=parseConnectorScopeBindings(bindingsInput);if(modeInput==="selected"&&!bindings.length)throw new HttpFail(400,{code:"runtime_connector_scope_bindings_required"});const now=nowIso();
  await postgresTransaction(async(client)=>{const available=new Set((await client.query<Row>("SELECT id FROM runtime_connector_organization_nodes WHERE connector_id=$1 FOR SHARE",[connectorId])).rows.map((row)=>String(row.id)));if(bindings.some((binding)=>!available.has(binding.node_id)))throw new HttpFail(400,{code:"runtime_connector_scope_node_unknown"});if(modeInput==="unset"){await client.query("DELETE FROM runtime_connector_scope_bindings WHERE connector_id=$1",[connectorId]);await client.query("DELETE FROM runtime_connector_scope_policies WHERE connector_id=$1",[connectorId]);return;}await client.query(`INSERT INTO runtime_connector_scope_policies(connector_id,mode,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(connector_id) DO UPDATE SET mode=EXCLUDED.mode,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,[connectorId,modeInput,actorId,now]);await client.query("DELETE FROM runtime_connector_scope_bindings WHERE connector_id=$1",[connectorId]);if(modeInput==="all")return;for(const binding of bindings)await client.query("INSERT INTO runtime_connector_scope_bindings(connector_id,node_id,access,created_by,created_at) VALUES($1,$2,$3,$4,$5)",[connectorId,binding.node_id,binding.access,actorId,now]);},{isolation:"SERIALIZABLE"});return (getConnectorScopeSnapshot(connectorId));
}
export async function userConnectorScopeAccess(connectorId:string,userId:string):Promise<"read"|"write"|null>{await ensureOrganizationScopeSchema();const [policy]=await postgresQuery<Row>("SELECT mode FROM runtime_connector_scope_policies WHERE connector_id=$1",[connectorId]);if(!policy)return null;const [user]=await postgresQuery<Row>("SELECT 1 FROM users WHERE id=$1 AND active=1",[userId]);if(!user)return null;if(policy.mode==="all")return "read";if(policy.mode!=="selected")return null;const [row]=await postgresQuery<Row>(`${CONNECTION_SCOPE_TREE} SELECT MAX(CASE tree.access WHEN 'write' THEN 2 ELSE 1 END) AS level FROM tree JOIN runtime_connector_organization_nodes node ON node.id=tree.node_id AND node.connector_id=$3 JOIN users usr ON usr.id=$4 AND usr.active=1 WHERE node.local_user_id=usr.id OR (node.is_person=0 AND node.level=3 AND node.name=COALESCE(usr.position,''))`,[connectorId,connectorId,connectorId,userId]);const level=Number(row?.level||0);return level>=2?"write":level>=1?"read":null;}
export async function recordToolInventory(connectorId:string,tools:Json[]):Promise<void>{await ensureOrganizationScopeSchema();const now=nowIso();await postgresTransaction(async(client)=>{for(const tool of tools){if(!tool||typeof tool!=="object")continue;const row=tool as Record<string,unknown>;if(typeof row.name!=="string"||typeof row.schema_hash!=="string"||!row.inputSchema||typeof row.inputSchema!=="object")continue;await client.query(`INSERT INTO runtime_connector_tool_inventory(connector_id,tool_name,description,schema_hash,input_schema,discovered_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connector_id,tool_name) DO UPDATE SET description=EXCLUDED.description,schema_hash=EXCLUDED.schema_hash,input_schema=EXCLUDED.input_schema,discovered_at=EXCLUDED.discovered_at`,[connectorId,row.name,typeof row.description==="string"?row.description:"",row.schema_hash,JSON.stringify(row.inputSchema),now]);}},{isolation:"SERIALIZABLE"});}
