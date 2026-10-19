import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", async original => ({
  ...await original<typeof import("../src/db.js")>(), audit: vi.fn(async () => undefined),
}));

// No creator handle is supplied. Handle lookup itself has separate PG coverage.
vi.mock("../src/host/intent.js", async original => ({
  ...await original<typeof import("../src/host/intent.js")>(), extractHandle: vi.fn(async () => null),
}));

vi.mock("../src/tasks/registry.js", async original => ({
  ...await original<typeof import("../src/tasks/registry.js")>(),
  taskDefinitions: vi.fn(async () => []),
  taskDefinition: vi.fn(async (id: string) => id === "creator_library_query" ? {
    id, title: "达人库查询", required_inputs: [], aliases: [],
    input_schema: [{ key: "page_no", kind: "number", default: 1, min: 1, integer: true }],
  } : undefined),
}));
import { recognizeTaskIntent, setTaskClassifier } from "../src/tasks/recognize.js";
import { withAgentRoutes } from "../src/tasks/agent-routing.js";

afterEach(() => setTaskClassifier());

describe("explicit query recognition", () => {
  it("queries without optional filters and never reclassifies a selected skill", async () => {
    const classifier = vi.fn(async () => ({ task_type: null, confidence: 0 }));
    setTaskClassifier(classifier);
    const result = await withAgentRoutes([{ agent_id: "query-agent", agent_name: "达人助理", description: "读取授权达人库",
      task_type: "creator_library_query", title: "达人库查询", summary: "查询授权达人" }], () =>
      recognizeTaskIntent({ task_type: "creator_library_query", text: "达人库查询" }));
    expect(result).toMatchObject({ task_type: "creator_library_query", source: "locked", agent_id: "query-agent",
      confidence: 1, needs_clarification: false, clarification_kind: "none", missing_fields: [] });
    expect(classifier).not.toHaveBeenCalled();
  });

  it("still blocks execution when no authorized route exists and explains recovery", async () => {
    const result = await withAgentRoutes([], () =>
      recognizeTaskIntent({ task_type: "creator_library_query", text: "达人库查询" }));
    expect(result).toMatchObject({ task_type: null, needs_clarification: true,
      next_action: expect.stringContaining("没有可用的对应技能") });
  });

  it("never reclassifies an explicit skill that is no longer in the published catalog", async () => {
    const classifier = vi.fn(async () => ({ task_type: "creator_daily_tasks", confidence: 1 }));
    setTaskClassifier(classifier);
    const result = await withAgentRoutes([], () =>
      recognizeTaskIntent({ task_type: "withdrawn-query", text: "达人库查询" }));
    expect(result).toMatchObject({ task_type: null, source: "locked", needs_clarification: true,
      error: "所选技能当前不可用。", next_action: expect.stringContaining("重新读取技能目录") });
    expect(classifier).not.toHaveBeenCalled();
  });

  it("continues to classify free composer requests", async () => {
    const classifier = vi.fn(async () => ({ task_type: "creator_library_query", confidence: 1 }));
    setTaskClassifier(classifier);
    await withAgentRoutes([], () => recognizeTaskIntent({ task_type: "free", text: "达人库查询" }));
    expect(classifier).toHaveBeenCalledOnce();
  });
});
