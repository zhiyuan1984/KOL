import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";
import type { RuntimeContext } from "./execution.js";

export type RuntimeActionGate = {
  /** Business scope and applicable approvals; invoked again immediately before dispatch. */
  validate: (context: RuntimeContext, args: Json) => void | Promise<void>;
  execute: (context: RuntimeContext, args: Json, actionId: string, dispatch: () => Promise<Json>) => Promise<Json>;
};
const gates = new Map<string, RuntimeActionGate>();
const scopes = new Map<string, (context: RuntimeContext, tool: string, args: Json) => void | Promise<void>>();
export function registerRuntimeToolScope(connector: string, check: (context: RuntimeContext, tool: string, args: Json) => void | Promise<void>): void {
  scopes.set(connector, check);
}
export async function validateRuntimeToolScope(connector: string, context: RuntimeContext, tool: string, args: Json): Promise<void> {
  await scopes.get(connector)?.(context, tool, args);
}
export function registerRuntimeActionGate(connector: string, tool: string, gate: RuntimeActionGate): void {
  const key = JSON.stringify([connector, tool]);
  if (gates.has(key)) throw new Error("runtime_action_gate_duplicate");
  gates.set(key, gate);
}
export function runtimeActionGate(connector: string, tool: string): RuntimeActionGate {
  const gate = gates.get(JSON.stringify([connector, tool]));
  if (!gate) throw new HttpFail(409, { code: "runtime_business_gate_required" });
  return gate;
}
