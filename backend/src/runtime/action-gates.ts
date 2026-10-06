import type { Json } from "../types.js";
import { authorizeConnector, type RuntimeContext } from "./execution.js";

export type RuntimeActionGate = {
  /** Business scope and applicable approvals; invoked again immediately before dispatch. */
  validate: (context: RuntimeContext, args: Json) => void | Promise<void>;
  execute: (context: RuntimeContext, args: Json, actionId: string, dispatch: () => Promise<Json>) => Promise<Json>;
};
const gates = new Map<string, RuntimeActionGate>();
const scopes = new Map<string, (context: RuntimeContext, tool: string, args: Json) => void | Promise<void>>();
const presentations = new Map<string, (tool: Json) => Json | null>();
/** Domains may narrow the model-visible contract; the reviewed remote schema and execution gate still apply. */
export function registerRuntimeToolPresentation(connector: string, project: (tool: Json) => Json | null): void {
  presentations.set(connector, project);
}
export function runtimeToolPresentation(connector: string, tool: Json): Json | null {
  const project = presentations.get(connector);
  return project ? project(tool) : tool;
}
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
/**
 * 没有专用业务门禁的受控写入走通用门禁：谁能用由 Agent 使用资格与技能→连接器→工具绑定决定，
 * 每个动作仍须员工确认后才提交，提交前重新核对授权，确认快照、单次提交与回执由动作存储统一承担。
 * 有业务口径的写入（如采集需要实例锁）注册专用门禁，覆盖这里的通用行为。
 */
function genericActionGate(connector: string): RuntimeActionGate {
  return {
    validate(context) {
      authorizeConnector(context, connector);
    },
    async execute(context, _args, _actionId, dispatch) {
      authorizeConnector(context, connector);
      return dispatch();
    },
  };
}
export function runtimeActionGate(connector: string, tool: string): RuntimeActionGate {
  return gates.get(JSON.stringify([connector, tool])) ?? genericActionGate(connector);
}
