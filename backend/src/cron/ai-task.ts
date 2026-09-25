import { authDisabled, mapUser, withScopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { getConn } from "../db.js";
import { host } from "../host/api.js";
import { tasks } from "../routers/tasks.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Json, Row } from "../types.js";
import type { CronHandler, CronHandlerResult } from "./handlers.js";

function composerOf(job: Row): Json {
  const condition = JSON.parse(String(job.condition_json || "{}")) as Json;
  return condition.composer && typeof condition.composer === "object" ? condition.composer as Json : {};
}

async function post(app: typeof tasks | typeof host, path: string, body: Json): Promise<Json> {
  const response = await app.request(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(String(payload.message || payload.error || `${path}: ${response.status}`));
  return payload;
}

/** Use the same from-text → task run → session message chain as Home. */
export const runAiTask: CronHandler = async ({ job }): Promise<CronHandlerResult> => {
  const row = getConn().prepare("SELECT * FROM users WHERE id=? AND active=1").get(job.owner_account_id) as Row | undefined;
  if (!row && !authDisabled()) throw new Error("任务所有者已停用或不存在");
  const composer = composerOf(job);
  const text = String(composer.text || "").trim();
  if (!text) throw new Error("定时任务提示词为空");
  const scope = composer.scope && typeof composer.scope === "object" ? composer.scope as Json : {};
  const taskType = String(composer.intent || (Array.isArray(scope.skills) ? scope.skills[0] || "" : ""));
  const definition = taskType ? taskDefinition(taskType) : undefined;
  if (definition && definition.side_effects === "write") {
    throw new Error("此技能不可无人在场自动执行");
  }
  const execute = async () => {
    const created = await post(tasks, "/tasks/from-text", {
      text, task_type: taskType || undefined, source: "schedule",
      attachments: composer.attachments, model_tier: composer.model_tier,
      collaboration_id: composer.collaboration_id, knowledge_id: composer.knowledge_id,
      scope, object_refs: composer.object_refs, client_entry: composer.client_entry,
    });
    if (!created.task || created.needs_clarification) throw new Error(String(created.clarification || "任务需要补充信息"));
    const task = created.task as Json;
    const resolved = taskDefinition(String(task.task_type || ""));
    if (!resolved || resolved.side_effects === "write") throw new Error("此技能不可无人在场自动执行");
    const run = await post(tasks, `/tasks/${encodeURIComponent(String(task.id))}/run`, {});
    const pending = (run.pending_message || run.pending || {}) as Json;
    const sessionId = String(run.session_id || "");
    if (!sessionId) throw new Error("今日任务没有返回会话入口");
    await post(host, `/sessions/${encodeURIComponent(sessionId)}/messages`, pending);
    return { sessionId, taskId: String(task.id), taskRunId: String(run.run_id || "") };
  };
  const result = row ? await withScopedUser(mapUser(row), execute) : await execute();
  return {
    status: "succeeded", session_id: result.sessionId,
    receipt: { handler_key: "ai-task", submitted: true, task_id: result.taskId, task_run_id: result.taskRunId,
      session_id: result.sessionId, title: "已提交到今日任务执行系统" },
  };
};
