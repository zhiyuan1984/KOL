import { beforeEach, describe, expect, it, vi } from "vitest";

const { recognize, definition } = vi.hoisted(() => ({ recognize: vi.fn(), definition: vi.fn() }));
vi.mock("../src/tasks/recognize.js", () => ({ recognizeTaskIntent: recognize }));
vi.mock("../src/tasks/registry.js", async (original) => ({
  ...await original<typeof import("../src/tasks/registry.js")>(), taskDefinition: definition,
}));
import { tasks } from "../src/routers/tasks.js";

beforeEach(() => {
  vi.clearAllMocks();
  definition.mockResolvedValue({ id: "creator_library_query", title: "达人库查询" });
  recognize.mockResolvedValue({
    task_type: null, confidence: 0, entities: {}, missing_fields: [], alternatives: [],
    needs_clarification: true, clarification_kind: "direction", source: "locked",
    next_action: "当前入口没有可用的对应技能，请选择有使用资格的智能体或补充问题归属。",
  });
});

async function post(path: string, taskType?: string) {
  const response = await tasks.request(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "达人库查询", task_type: taskType }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

describe("task intake clarification HTTP contract", () => {
  it("preserves the selected skill and routing recovery instead of asking for intent again", async () => {
    const result = await post("/tasks/from-text", "creator_library_query");
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ task_type: "creator_library_query" }));
    expect(result).toMatchObject({ task: null, tasks: [], needs_clarification: true,
      requested_task_type: "creator_library_query", clarification: expect.stringContaining("没有可用的对应技能") });
    expect(result.clarification).not.toContain("请选择最符合");
  });

  it("keeps unselected text distinct from an explicit skill", async () => {
    const result = await post("/tasks/from-text");
    expect(result.requested_task_type).toBeUndefined();
    expect(result.clarification).toContain("有使用资格的智能体");
  });

  it("does not discard an explicit unpublished skill before recognition", async () => {
    definition.mockResolvedValue(undefined);
    const result = await post("/tasks/from-text", "withdrawn-query");
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ task_type: "withdrawn-query" }));
    expect(result.requested_task_type).toBe("withdrawn-query");
    expect(result.task).toBeNull();
  });

  it("treats the composer free sentinel as unselected text", async () => {
    const result = await post("/tasks/from-text", "free");
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ task_type: undefined }));
    expect(result.requested_task_type).toBeUndefined();
  });

  it("also exposes recovery through the recognize endpoint", async () => {
    expect(await post("/tasks/recognize", "creator_library_query")).toMatchObject({
      needs_clarification: true, message: expect.stringContaining("没有可用的对应技能"),
    });
  });

  it("retains the actual service error when one is present", async () => {
    const resolution = await recognize();
    recognize.mockResolvedValue({ ...resolution, error: "识别服务暂不可用" });
    const result = await post("/tasks/from-text");
    expect(result).toMatchObject({ task: null, clarification: expect.stringContaining("识别服务暂不可用") });
    expect(result.clarification).toContain("有使用资格的智能体");
  });
});
