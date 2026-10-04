import { randomUUID } from "node:crypto";
import { postgresPool } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";
import type { RuntimeContext } from "./execution.js";

export type RuntimeAction = {
  id: string; actor_id: string; session_id: string | null; context_json: RuntimeContext;
  connector_id: string; tool_name: string; args_json: Json; snapshot: string;
  state: string; receipt_json: Json | null; error_code: string | null;
};

export async function proposeRuntimeAction(input: {
  context: RuntimeContext; connectorId: string; tool: string; args: Json; snapshot: string; proposalKey: string;
}): Promise<RuntimeAction> {
  const { rows } = await postgresPool().query<RuntimeAction>(`INSERT INTO runtime_actions
    (id,actor_id,session_id,context_json,connector_id,tool_name,args_json,snapshot,proposal_key,state)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
    ON CONFLICT(proposal_key) DO UPDATE SET proposal_key=EXCLUDED.proposal_key RETURNING *`,
    [`action_${randomUUID()}`, input.context.userId, input.context.sessionId || null,
      JSON.stringify(input.context), input.connectorId, input.tool, JSON.stringify(input.args), input.snapshot, input.proposalKey]);
  return rows[0];
}

export async function runtimeAction(id: string, actor: string): Promise<RuntimeAction> {
  const { rows } = await postgresPool().query<RuntimeAction>("SELECT * FROM runtime_actions WHERE id=$1 AND actor_id=$2", [id, actor]);
  if (!rows[0]) throw new HttpFail(404, { code: "runtime_action_not_found" });
  return rows[0];
}

/** The claim is committed BEFORE dispatch. A crash retains an uncertain attempt, never a retryable write. */
export async function claimRuntimeAction(id: string, actor: string, snapshot: string): Promise<boolean> {
  const result = await postgresPool().query(`UPDATE runtime_actions SET state='dispatching',updated_at=now()
    WHERE id=$1 AND actor_id=$2 AND snapshot=$3 AND state='pending' RETURNING id`, [id, actor, snapshot]);
  return result.rowCount === 1;
}

export async function finishRuntimeAction(id: string, state: "succeeded" | "rejected" | "uncertain", receipt: Json | null, code?: string): Promise<boolean> {
  const result = await postgresPool().query(`UPDATE runtime_actions SET state=$2,receipt_json=$3,error_code=$4,updated_at=now()
    WHERE id=$1 AND state='dispatching'`, [id, state, receipt ? JSON.stringify(receipt) : null, code || null]);
  return result.rowCount === 1;
}
