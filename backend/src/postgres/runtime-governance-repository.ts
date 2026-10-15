import type { PoolClient } from "pg";
import { postgresQuery, postgresTransaction } from "./pool.js";
import type { Row } from "../types.js";

export type RuntimeVersionedTable =
  | "runtime_agent_skills"
  | "runtime_skill_connectors"
  | "runtime_skill_tools"
  | "runtime_connector_config"
  | "runtime_tool_policies";

export class RuntimeVersionConflict extends Error {
  constructor() { super("runtime governance version conflict"); }
}

const tableColumns: Record<RuntimeVersionedTable, readonly string[]> = {
  runtime_agent_skills: ["agent_id", "skill_id"],
  runtime_skill_connectors: ["skill_id", "connector_id"],
  runtime_skill_tools: ["skill_id", "connector_id", "tool_name"],
  runtime_connector_config: ["connector_id"],
  runtime_tool_policies: ["connector_id", "tool_name"],
};

async function query<T extends Row = Row>(client: PoolClient | undefined, text: string, values: readonly unknown[] = []): Promise<T[]> {
  if (client) return (await client.query<T>(text, [...values])).rows;
  return postgresQuery<T>(text, values);
}

export async function pgRuntimeConnectorExists(connectorId: string, client?: PoolClient): Promise<boolean> {
  return (await query(client, "SELECT 1 FROM connectors WHERE id=$1", [connectorId])).length > 0;
}

export async function pgRuntimeGetAgentSkills(agentId: string): Promise<Row[]> {
  return query(undefined, "SELECT * FROM runtime_agent_skills WHERE agent_id=$1 ORDER BY skill_id", [agentId]);
}

export async function pgRuntimeGetSkillConnectors(skillId: string): Promise<Row[]> {
  return query(undefined, "SELECT * FROM runtime_skill_connectors WHERE skill_id=$1 ORDER BY connector_id", [skillId]);
}

export async function pgRuntimeGetSkillTools(skillId: string, connectorId?: string): Promise<Row[]> {
  return connectorId === undefined
    ? (await query(undefined, "SELECT * FROM runtime_skill_tools WHERE skill_id=$1 ORDER BY connector_id,tool_name", [skillId]))
    : (await query(undefined, "SELECT * FROM runtime_skill_tools WHERE skill_id=$1 AND connector_id=$2 ORDER BY tool_name", [skillId, connectorId]));
}

export async function pgRuntimeGetSkillTool(skillId: string, connectorId: string, toolName: string): Promise<Row | undefined> {
  return (await query(undefined, "SELECT * FROM runtime_skill_tools WHERE skill_id=$1 AND connector_id=$2 AND tool_name=$3", [skillId, connectorId, toolName]))[0];
}

export async function pgRuntimeListSkillConnectorBindings(): Promise<Row[]> {
  return query(undefined, "SELECT * FROM runtime_skill_connectors ORDER BY skill_id,connector_id");
}

export async function pgRuntimeListSkillToolBindings(): Promise<Row[]> {
  return query(undefined, "SELECT * FROM runtime_skill_tools ORDER BY skill_id,connector_id,tool_name");
}

export async function pgRuntimeConnectorInUseBySkill(connectorId: string): Promise<boolean> {
  return (await query(undefined, `SELECT 1 FROM runtime_skill_tools t
    JOIN runtime_skill_connectors c ON c.skill_id=t.skill_id AND c.connector_id=t.connector_id
    WHERE t.connector_id=$1 AND t.enabled=1 AND c.enabled=1 LIMIT 1`, [connectorId])).length > 0;
}

export async function pgRuntimeGetConnectorConfig(connectorId: string): Promise<Row | undefined> {
  return (await query(undefined, "SELECT config_json,version FROM runtime_connector_config WHERE connector_id=$1", [connectorId]))[0];
}

export async function pgRuntimeGetToolPolicy(connectorId: string, toolName: string): Promise<Row | undefined> {
  return (await query(undefined, "SELECT * FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2", [connectorId, toolName]))[0];
}

export async function pgRuntimeGetConnectorPolicies(connectorId: string): Promise<Row[]> {
  return query(undefined, "SELECT * FROM runtime_tool_policies WHERE connector_id=$1 ORDER BY tool_name", [connectorId]);
}

export async function pgRuntimeVersionedUpsert(input: {
  table: RuntimeVersionedTable;
  keys: readonly unknown[];
  createColumns: readonly string[];
  createValues: readonly unknown[];
  updateColumns: readonly string[];
  expectedVersion: number;
  check?: (client: PoolClient) => Promise<void>;
}): Promise<Row> {
  const keyColumns = tableColumns[input.table];
  return postgresTransaction(async (client) => {
    if (input.check) await input.check(client);
    const where = keyColumns.map((column, index) => `${column}=$${index + 1}`).join(" AND ");
    const existing = (await client.query<Row>(`SELECT version FROM ${input.table} WHERE ${where} FOR UPDATE`, [...input.keys])).rows[0];
    if (!existing) {
      if (input.expectedVersion !== 0) throw new RuntimeVersionConflict();
      const insertColumns = input.createColumns.join(",");
      const placeholders = input.createColumns.map((_, index) => `$${index + 1}`).join(",");
      return (await client.query<Row>(`INSERT INTO ${input.table} (${insertColumns}) VALUES (${placeholders}) RETURNING *`, [...input.createValues])).rows[0];
    }
    const actual = Number(existing.version);
    if (actual !== input.expectedVersion) throw new RuntimeVersionConflict();
    const updateValues = input.updateColumns.map((column) => input.createValues[input.createColumns.indexOf(column)]);
    const assignments = input.updateColumns.map((column, index) => `${column}=$${index + 1}`);
    assignments.push(`version=$${updateValues.length + 1}`, `updated_at=$${updateValues.length + 2}`);
    const nextVersion = actual + 1;
    const values = [...updateValues, nextVersion, String(input.createValues[input.createColumns.indexOf("updated_at")]), ...input.keys, actual];
    const keyOffset = updateValues.length + 3;
    const updateWhere = keyColumns.map((column, index) => `${column}=$${keyOffset + index}`).join(" AND ");
    const condition = `${updateWhere} AND version=$${keyOffset + input.keys.length}`;
    const updated = (await client.query<Row>(`UPDATE ${input.table} SET ${assignments.join(",")} WHERE ${condition} RETURNING *`, values)).rows[0];
    if (!updated) throw new RuntimeVersionConflict();
    return updated;
  }, { isolation: "SERIALIZABLE" });
}

export async function pgRuntimeSetAgentSkills(input: {
  agentId: string;
  selections: ReadonlyArray<{ skill: string; enabled: number; expectedVersion: number }>;
  now: string;
}): Promise<Row[]> {
  return postgresTransaction(async (client) => {
    const managed = (await client.query<Row>("SELECT workspace_managed FROM managed_agents WHERE id=$1 FOR UPDATE", [input.agentId])).rows[0];
    if (managed?.workspace_managed) throw new Error("runtime_agent_workspace_managed");
    for (const selection of input.selections) {
      const existing = (await client.query<Row>("SELECT version FROM runtime_agent_skills WHERE agent_id=$1 AND skill_id=$2 FOR UPDATE", [input.agentId, selection.skill])).rows[0];
      if (Number(existing?.version || 0) !== selection.expectedVersion) throw new RuntimeVersionConflict();
    }
    for (const selection of input.selections) {
      if (selection.expectedVersion === 0) {
        await client.query("INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at) VALUES($1,$2,$3,1,$4)", [input.agentId, selection.skill, selection.enabled, input.now]);
      } else {
        const updated = await client.query(`UPDATE runtime_agent_skills SET enabled=$1,version=version+1,updated_at=$2
          WHERE agent_id=$3 AND skill_id=$4 AND version=$5`, [selection.enabled, input.now, input.agentId, selection.skill, selection.expectedVersion]);
        if (!updated.rowCount) throw new RuntimeVersionConflict();
      }
    }
    return (await client.query<Row>("SELECT * FROM runtime_agent_skills WHERE agent_id=$1 ORDER BY skill_id", [input.agentId])).rows;
  }, { isolation: "SERIALIZABLE" });
}

export async function pgRuntimeBootstrap(input: {
  migration: string;
  agentId: string;
  skills: readonly string[];
  publishSkills?: readonly string[];
  auditType: string;
  auditPayload: string;
}): Promise<void> {
  await postgresTransaction(async (client) => {
    const claimed = await client.query("INSERT INTO runtime_bootstrap_migrations(id,applied_at) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id", [input.migration, new Date().toISOString()]);
    if (!claimed.rowCount) return;
    const now = new Date().toISOString();
    for (const skillId of input.skills) {
      await client.query(`INSERT INTO runtime_agent_skills(agent_id,skill_id,enabled,version,updated_at)
        VALUES($1,$2,1,1,$3) ON CONFLICT(agent_id,skill_id) DO NOTHING`, [input.agentId, skillId, now]);
      if (input.publishSkills?.includes(skillId)) {
        await client.query(`INSERT INTO skill_lifecycle(skill_id,stage,updated_at) VALUES($1,'published',$2)
          ON CONFLICT(skill_id) DO UPDATE SET stage=CASE WHEN skill_lifecycle.stage='draft' THEN 'published' ELSE skill_lifecycle.stage END,
          updated_at=CASE WHEN skill_lifecycle.stage='draft' THEN EXCLUDED.updated_at ELSE skill_lifecycle.updated_at END`, [skillId, now]);
      }
    }
    await client.query("INSERT INTO audit_events(ts,actor,event_type,payload) VALUES($1,$2,$3,$4)", [now, "system:runtime-bootstrap", input.auditType, input.auditPayload]);
  }, { isolation: "SERIALIZABLE" });
}
