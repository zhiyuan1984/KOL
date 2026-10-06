/**
 * 只读上下文解析入口（POST /api/actions/context.resolve）。
 * 它只回答「现在能拿到哪几片当前世界、凭什么」，不建箱、不启动 Codex turn、不写业务状态；
 * 发送确认、阶段写入、审批、回执仍由各自的动作入口负责。
 */
import type { Operation } from "../runtime/operations.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import { HttpFail } from "./errors.js";
import { requireTaskAccess, sessionRow } from "./api.js";
import { resolveContext } from "./context-resolve.js";

const resolveAction: Operation["handle"] = async (c, input) => {
  const body = input as Json;
  const skillId = String(body.skill_id || "").trim();
  if (!skillId) throw new HttpFail(400, { code: "skill_id_required", message: "需要 skill_id" });
  if (!taskDefinition(skillId)) throw new HttpFail(400, { code: "unknown_task_type", task_type: skillId });
  requireTaskAccess(skillId);
  const sessionId = String(body.session_id || "").trim();
  return c.json(resolveContext({
    skillId,
    body,
    session: sessionId ? sessionRow(sessionId) : null,
    text: String(body.text || ""),
  }));
};

export const contextOperations: Operation[] = [
  { kind: "action", id: "context.resolve", handle: resolveAction },
];
