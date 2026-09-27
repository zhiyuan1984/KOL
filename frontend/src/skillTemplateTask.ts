import { api, type PendingAsk, type SkillTemplate, type Task } from "./api";
import { missingFieldsMessage } from "./labels";

const unwrap = (value: Task | { task: Task }): Task => (value as { task?: Task }).task || value as Task;

/** An explicit template submission must not bypass task schema/version checks.
 * Ordinary follow-up conversation stays on the existing message path. */
export async function bindTemplateSessionTask(
  sessionId: string,
  payload: PendingAsk,
  template: SkillTemplate,
  client: Pick<typeof api, "createTask" | "runTask"> = api,
): Promise<{ task: Task; pending: PendingAsk }> {
  const created = unwrap(await client.createTask({
    ...payload,
    task_type: template.skill_id,
    intent: template.skill_id,
    title: template.title,
    text: payload.text,
    prompt: payload.text,
    session_id: sessionId,
    source: "manual",
    input: { ...payload.entities, skill_template_version: template.version },
    skill_template_version: template.version,
  }));
  if (created.status === "needs_clarification") {
    const resolution = created.resolution as { missing_fields?: string[]; invalid_fields?: Record<string, string> } | undefined;
    const fields = resolution?.missing_fields || [];
    const errors = Object.values(resolution?.invalid_fields || {});
    throw new Error(fields.length ? missingFieldsMessage(fields) : errors.join("；") || "请补充任务所需信息后再执行。");
  }
  const run = await client.runTask(created.id, { text: payload.text });
  const pending = (run.pending_message || run.pending || {}) as Partial<PendingAsk>;
  if (!pending.run_id && !run.run_id) throw new Error("任务尚未准备好执行，请检查参数后重试。");
  return {
    task: unwrap(run.task || created),
    pending: {
      ...payload,
      ...pending,
      intent: template.skill_id,
      work_item_id: pending.work_item_id || run.work_item_id || created.id,
      task_type: template.skill_id,
      run_id: pending.run_id || run.run_id,
      skill_template_version: template.version,
    },
  };
}
