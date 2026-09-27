import { describe, expect, it, vi } from "vitest";
import { type SkillTemplate, type Task, type TaskRunResult } from "./api";
import { bindTemplateSessionTask } from "./skillTemplateTask";

const template: SkillTemplate = {
  id: "skill-template:creator_library_query", kind: "skill_template", skill_id: "creator_library_query",
  version: "version-1", title: "达人库查询", description: "查询授权达人", steps: [], inputs: [],
  starter: "达人库查询", output: { type: "task_result", title: "达人列表" }, constraints: [], source: "skill", read_only: true,
};
const task = { id: "task-1", title: "达人库查询", status: "pending", task_type: template.skill_id, skill_template: template } as Task;
const run = { task, session_id: "session-1", work_item_id: task.id, run_id: "run-1", pending_message: {
  text: "达人库查询", task_type: template.skill_id, work_item_id: task.id, run_id: "run-1",
  entities: { keyword: "露营", pageNo: 1, pageSize: 20 },
} } as TaskRunResult;
const client = () => ({ createTask: vi.fn().mockResolvedValue(task), runTask: vi.fn().mockResolvedValue(run) });

describe("explicit template submissions inside a session", () => {
  it("persists the template version and edited entities before posting a bound run", async () => {
    const api = client();
    const result = await bindTemplateSessionTask("session-1", { text: "达人库查询 关键词：露营", entities: { keyword: "露营" } }, template, api);
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      task_type: template.skill_id, session_id: "session-1", text: "达人库查询 关键词：露营",
      input: { keyword: "露营", skill_template_version: "version-1" }, skill_template_version: "version-1",
    }));
    expect(result.task.skill_template).toEqual(template);
    expect(result.pending).toMatchObject({ work_item_id: "task-1", run_id: "run-1", task_type: template.skill_id,
      skill_template_version: "version-1", entities: { keyword: "露营", pageNo: 1, pageSize: 20 } });
  });

  it("does not fall back to an unbound session message on stale template errors", async () => {
    const api = client();
    api.createTask.mockRejectedValue(new Error("技能模板已更新"));
    await expect(bindTemplateSessionTask("session-1", { text: "达人库查询" }, template, api)).rejects.toThrow("技能模板已更新");
    expect(api.runTask).not.toHaveBeenCalled();
  });

  it("stops on missing or invalid parameters instead of starting the Worker", async () => {
    const api = client();
    api.createTask.mockResolvedValue({ ...task, status: "needs_clarification", resolution: { missing_fields: [], invalid_fields: { page_size: "请输入整数" } } });
    await expect(bindTemplateSessionTask("session-1", { text: "达人库查询" }, template, api)).rejects.toThrow("请输入整数");
    expect(api.runTask).not.toHaveBeenCalled();
  });

  it("requires a run binding rather than silently executing a draft", async () => {
    const api = client();
    api.runTask.mockResolvedValue({ task, needs_clarification: true });
    await expect(bindTemplateSessionTask("session-1", { text: "达人库查询" }, template, api)).rejects.toThrow("任务尚未准备好执行");
  });
});
