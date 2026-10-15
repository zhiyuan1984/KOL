import { postgresConnection } from "../postgres/pool.js";
import { randomUUID } from "node:crypto";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";
import type { RuntimeContext } from "./execution.js";

export type RuntimeAction = {
  id: string; actor_id: string; session_id: string | null; context_json: RuntimeContext;
  connector_id: string; tool_name: string; args_json: Json; snapshot: string;
  state: string; receipt_json: Json | null; error_code: string | null;
  created_at?: Date | string; updated_at?: Date | string;
};

/** Versions captured by the guarded runtime check and rechecked while the action row is locked. */
export type RuntimeActionClaimBasis = {
  agentId: string; skillId: string; connectorId: string; toolName: string;
  agentSkillVersion: number; connectorConfigVersion: number; skillConnectorVersion: number;
  skillToolVersion: number; toolPolicyVersion: number;
};

export type RuntimeActionClaim = { claimed: boolean; action: RuntimeAction };

export async function proposeRuntimeAction(input: {
  context: RuntimeContext; connectorId: string; tool: string; args: Json; snapshot: string; proposalKey: string;
}): Promise<RuntimeAction> {
  const { rows } = await postgresConnection().query<RuntimeAction>(`INSERT INTO runtime_actions
    (id,actor_id,session_id,context_json,connector_id,tool_name,args_json,snapshot,proposal_key,state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
    ON CONFLICT(proposal_key) DO UPDATE SET proposal_key=EXCLUDED.proposal_key RETURNING *`,
    [`action_${randomUUID()}`, input.context.userId, input.context.sessionId || null,
      JSON.stringify(input.context), input.connectorId, input.tool, JSON.stringify(input.args), input.snapshot, input.proposalKey]);
  return rows[0];
}

export async function runtimeAction(id: string, actor: string): Promise<RuntimeAction> {
  const { rows } = await postgresConnection().query<RuntimeAction>("SELECT * FROM runtime_actions WHERE id=$1 AND actor_id=$2", [id, actor]);
  if (!rows[0]) throw new HttpFail(404, { code: "runtime_action_not_found" });
  return rows[0];
}

function bindingChanged(): never { throw new HttpFail(409, { code: "runtime_binding_changed" }); }

/**
 * Atomically claim an action only while the complete execution assembly still matches the
 * discovery stamp.  The remote request is deliberately outside this transaction; a committed
 * dispatching claim is durable so an unknown remote write is never retried blindly.
 */
export async function claimRuntimeAction(
  id: string,
  actor: string,
  snapshot: string,
  basis: RuntimeActionClaimBasis,
): Promise<RuntimeActionClaim> {
  return postgresTransaction(async (client) => {
    const action = (await client.query<RuntimeAction>(
      "SELECT * FROM runtime_actions WHERE id=$1 AND actor_id=$2 FOR UPDATE", [id, actor],
    )).rows[0];
    if (!action) throw new HttpFail(404, { code: "runtime_action_not_found" });
    if (action.snapshot !== snapshot || action.connector_id !== basis.connectorId || action.tool_name !== basis.toolName) {
      bindingChanged();
    }
    if (action.state !== "pending") return { claimed: false, action };

    const connector = (await client.query<{ enabled: number }>(
      "SELECT enabled FROM connectors WHERE id=$1 FOR SHARE", [basis.connectorId],
    )).rows[0];
    if (!connector || Number(connector.enabled) !== 1) throw new HttpFail(403, { code: "runtime_connector_disabled" });

    const config = (await client.query<{ version: number }>(
      "SELECT version FROM runtime_connector_config WHERE connector_id=$1 FOR SHARE", [basis.connectorId],
    )).rows[0];
    const agentSkill = (await client.query<{ enabled: number; version: number }>(
      "SELECT enabled,version FROM runtime_agent_skills WHERE agent_id=$1 AND skill_id=$2 FOR SHARE", [basis.agentId, basis.skillId],
    )).rows[0];
    const skillConnector = (await client.query<{ enabled: number; version: number }>(
      "SELECT enabled,version FROM runtime_skill_connectors WHERE skill_id=$1 AND connector_id=$2 FOR SHARE", [basis.skillId, basis.connectorId],
    )).rows[0];
    const skillTool = (await client.query<{ enabled: number; version: number }>(
      "SELECT enabled,version FROM runtime_skill_tools WHERE skill_id=$1 AND connector_id=$2 AND tool_name=$3 FOR SHARE", [basis.skillId, basis.connectorId, basis.toolName],
    )).rows[0];
    const policy = (await client.query<{ enabled: number; version: number }>(
      "SELECT enabled,version FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2 FOR SHARE", [basis.connectorId, basis.toolName],
    )).rows[0];
    if (!config || Number(config.version) !== basis.connectorConfigVersion
      || !agentSkill || Number(agentSkill.enabled) !== 1 || Number(agentSkill.version) !== basis.agentSkillVersion
      || !skillConnector || Number(skillConnector.enabled) !== 1 || Number(skillConnector.version) !== basis.skillConnectorVersion
      || !skillTool || Number(skillTool.enabled) !== 1 || Number(skillTool.version) !== basis.skillToolVersion
      || !policy || Number(policy.enabled) !== 1 || Number(policy.version) !== basis.toolPolicyVersion) {
      bindingChanged();
    }

    const claimed = (await client.query<RuntimeAction>(`UPDATE runtime_actions SET state='dispatching',updated_at=now()
      WHERE id=$1 AND actor_id=$2 AND snapshot=$3 AND state='pending' RETURNING *`, [id, actor, snapshot])).rows[0];
    if (!claimed) {
      const latest = (await client.query<RuntimeAction>("SELECT * FROM runtime_actions WHERE id=$1 AND actor_id=$2", [id, actor])).rows[0];
      if (!latest) throw new HttpFail(404, { code: "runtime_action_not_found" });
      return { claimed: false, action: latest };
    }
    return { claimed: true, action: claimed };
  }, { isolation: "SERIALIZABLE" });
}

/** Wait for an in-flight identical confirmation rather than turning it into a second remote submission. */
export async function waitForRuntimeActionTerminal(id: string, actor: string, timeoutMs = 2_000): Promise<RuntimeAction> {
  const deadline = Date.now() + timeoutMs;
  let action = await runtimeAction(id, actor);
  while (["pending", "dispatching"].includes(action.state) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    action = await runtimeAction(id, actor);
  }
  return action;
}

/** A locally verified pre-claim rejection must not overwrite another executor's claim. */
export async function rejectPendingRuntimeAction(id: string, actor: string, snapshot: string, code: string): Promise<boolean> {
  const result = await postgresConnection().query(`UPDATE runtime_actions SET state='rejected',error_code=$4,updated_at=now()
    WHERE id=$1 AND actor_id=$2 AND snapshot=$3 AND state='pending' RETURNING id`, [id, actor, snapshot, code]);
  return result.rowCount === 1;
}

export async function finishRuntimeAction(id: string, state: "succeeded" | "rejected" | "uncertain", receipt: Json | null, code?: string): Promise<boolean> {
  const result = await postgresConnection().query(`UPDATE runtime_actions SET state=$2,receipt_json=$3,error_code=$4,updated_at=now()
    WHERE id=$1 AND state='dispatching'`, [id, state, receipt ? JSON.stringify(receipt) : null, code || null]);
  return result.rowCount === 1;
}
