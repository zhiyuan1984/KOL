import { describe, expect, it } from "vitest";
import {
  applyProgress,
  emptyHarnessMemory,
  finishProcessItems,
  mcpCallDisplay,
  preferHostOperations,
  progressFromHarness,
  reasoningSummariesOf,
  upsertOperationItem,
} from "../src/worker/progress.js";

describe("Codex harness process traces", () => {
  it("turns reasoning notifications into process items and hides raw reasoning_text", () => {
    const memory = emptyHarnessMemory();
    const started = progressFromHarness(
      "item/started",
      { item: { id: "rsn_1", type: "reasoning", summary: [] } },
      memory,
    );
    expect(started?.trace).toMatchObject({
      id: "reasoning:rsn_1",
      label: "正在分析…",
      status: "running",
      kind: "reasoning",
      streaming: true,
    });

    const delta = progressFromHarness(
      "item/reasoning/summaryTextDelta",
      { itemId: "rsn_1", delta: "已根据平台" },
      memory,
    );
    expect(delta?.trace?.label).toBe("已根据平台");
    expect(JSON.stringify(delta)).not.toContain("raw hidden");

    const completed = progressFromHarness(
      "item/completed",
      {
        item: {
          id: "rsn_1",
          type: "reasoning",
          summary: [{ type: "summary_text", text: "已根据平台和关键词整理采集范围。" }],
          content: [{ type: "reasoning_text", text: "raw hidden reasoning must not be shown" }],
        },
      },
      memory,
    );
    expect(completed?.summary).toBe("已根据平台和关键词整理采集范围。");
    expect(completed?.trace).toMatchObject({
      id: "reasoning:rsn_1",
      label: "已根据平台和关键词整理采集范围。",
      status: "done",
      kind: "reasoning",
      streaming: false,
    });
    expect(JSON.stringify(completed)).not.toContain("raw hidden reasoning");
  });

  it("applies item/delta summary_text and ignores raw reasoning_text deltas", () => {
    const memory = emptyHarnessMemory();
    progressFromHarness(
      "item/started",
      { item: { id: "rsn_2", type: "reasoning", summary: [] } },
      memory,
    );
    const streamed = progressFromHarness(
      "item/delta",
      { itemId: "rsn_2", delta: { summary_text: "Narrow the crawl to YouTube camping creators." } },
      memory,
    );
    expect(streamed?.trace).toMatchObject({
      id: "reasoning:rsn_2",
      label: "Narrow the crawl to YouTube camping creators.",
      kind: "reasoning",
      streaming: true,
    });

    const leaked = progressFromHarness(
      "item/reasoning/textDelta",
      { itemId: "rsn_2", delta: "raw hidden reasoning must not be shown" },
      memory,
    );
    expect(leaked?.trace?.label).toBe("Narrow the crawl to YouTube camping creators.");
    expect(JSON.stringify(leaked)).not.toContain("raw hidden");
  });

  it("keeps reasoning summary rows when a later host step fails", () => {
    const failed = finishProcessItems(
      [
        { id: "host:preparing", label: "准备任务", status: "done", kind: "host" },
        { id: "reasoning:rsn_1", label: "Narrow the crawl to YouTube camping creators.", status: "done", kind: "reasoning" },
        { id: "host:validating", label: "校验输出", status: "running", kind: "result" },
      ],
      true,
    );
    expect(failed.find((item) => item.kind === "reasoning")).toMatchObject({
      id: "reasoning:rsn_1",
      label: "Narrow the crawl to YouTube camping creators.",
      status: "done",
      streaming: false,
    });
    expect(failed.find((item) => item.id === "host:validating")).toMatchObject({
      label: "校验输出",
      status: "failed",
    });
    expect(reasoningSummariesOf(failed)).toEqual(["Narrow the crawl to YouTube camping creators."]);
  });

  it("grows process items from real events instead of a fixed five-step template", () => {
    let items = applyProgress([], { phase: "preparing", trace: { id: "host:preparing", label: "准备任务", status: "running", kind: "host" } });
    items = applyProgress(items, { phase: "skill_ready", trace: { id: "host:skill_ready", label: "加载任务规则", status: "done", kind: "host" } });
    items = applyProgress(items, { phase: "generating", trace: { id: "host:generating", label: "正在分析…", status: "running", kind: "host" } });
    items = applyProgress(items, {
      phase: "generating",
      summary: "已根据平台和关键词整理采集范围。",
      trace: {
        id: "reasoning:rsn_1",
        label: "已根据平台和关键词整理采集范围。",
        status: "done",
        kind: "reasoning",
      },
    });
    items = applyProgress(items, { phase: "generating", trace: { id: "host:generating", label: "正在分析…", status: "running", kind: "host" } });
    expect(items.map((item) => item.label)).toEqual([
      "准备任务",
      "加载任务规则",
      "已根据平台和关键词整理采集范围。",
    ]);
    expect(items.some((item) => item.label === "正在分析…")).toBe(false);
    expect(reasoningSummariesOf(items)).toEqual(["已根据平台和关键词整理采集范围。"]);
    expect(finishProcessItems(items, false).every((item) => item.status === "done")).toBe(true);
  });

  it("marks the last live step failed without inventing skipped unread steps", () => {
    const failed = finishProcessItems(
      [{ id: "host:preparing", label: "准备任务", status: "running", kind: "host" }],
      true,
    );
    expect(failed).toEqual([
      { id: "host:preparing", label: "准备任务", status: "failed", kind: "host", streaming: false },
    ]);
    expect(failed.map((item) => item.label)).not.toContain("校验安全边界与格式");
  });

  it("streams MCP tool calls with qualified names", () => {
    const memory = emptyHarnessMemory();
    const started = progressFromHarness(
      "item/started",
      { item: { id: "mcp_1", type: "mcpToolCall", server: "starrykol", tool: "pageRiskConversations" } },
      memory,
    );
    expect(started?.operation).toMatchObject({
      id: "mcp_1",
      name: "starrykol.pageRiskConversations",
      label: "pageRiskConversations",
      status: "running",
    });
    const done = progressFromHarness(
      "item/completed",
      { item: { id: "mcp_1", type: "mcpToolCall", server: "starrykol", tool: "pageRiskConversations", status: "completed" } },
      memory,
    );
    expect(done?.operation?.status).toBe("completed");
    const rows = upsertOperationItem([], started!.operation!);
    expect(mcpCallDisplay({ ...rows[0], label: "查询风险会话" })).toBe("查询风险会话 · starrykol.pageRiskConversations");
  });

  it("replaces Codex approval-never failures with Host-backed read ops", () => {
    const merged = preferHostOperations(
      [{ id: "mcp_1", name: "starrykol.pageKolProfiles", label: "pageKolProfiles", status: "failed" }],
      [{ name: "starrykol.pageKolProfiles", label: "分页查询达人画像", status: "done" }],
    );
    expect(merged).toEqual([
      expect.objectContaining({
        name: "starrykol.pageKolProfiles",
        status: "done",
        label: "分页查询达人画像",
      }),
    ]);
  });
});
