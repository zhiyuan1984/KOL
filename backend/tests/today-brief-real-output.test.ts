/**
 * Real Codex today_plan output must survive the worker parse + validation chain.
 * Server evidence 2026-09-18: turn completed with a today_brief JSON in
 * last_message, but item_types=[] — the brief was dropped before validation.
 */
import { describe, expect, it } from "vitest";
import { parseAgentTexts } from "../src/worker/parse.js";
import { requiredSkillOutputMissing, skillOutputSchema } from "../src/worker/runner.js";
import { requireTaskDefinition } from "../src/tasks/registry.js";
import { validateTodayBrief } from "../src/host/today-brief.js";

const REAL_CODEX_TODAY_BRIEF = JSON.stringify({
  type: "today_brief",
  lead: "今天先恢复失败采集并排查风险，再推进明确对象的外联任务。",
  stats: { unfinished: 37, discovery_anomalies: 13, failed_runs: 2 },
  primary: {
    verb: "retry_crawl",
    label: "重试美妆达人采集",
    object_id: "tsk_c29224c0b37d",
    object_type: "task",
    person_id: null,
  },
  sections: [
    {
      title: "采集与风险",
      body: "最新采集任务执行失败，先恢复采集链路。",
      items: ["重试最新的 YouTube 美妆达人采集"],
    },
  ],
  display_tasks: [
    {
      work_item_id: "tsk_c29224c0b37d",
      rank: 1,
      title: "重试北美户外达人的 YouTube 采集",
      why: "上轮采集失败，今天先把批次拉起来",
      verb: "retry_crawl",
      label: "重试采集",
      icon: "🔎",
      group: "重要紧急",
    },
  ],
  analysis_hints: [],
  source_cursor: { cursor_from: null, cursor_to: "src:x", added: ["task:tsk_c29224c0b37d"], removed: [], unchanged: [] },
  increment_summary: "首次规划：纳入 37 项未了结正式任务。",
});

describe("today_brief real codex output", () => {
  it("parseAgentTexts keeps the today_brief item", () => {
    const items = parseAgentTexts([REAL_CODEX_TODAY_BRIEF]);
    expect(items.some((item) => item.type === "today_brief")).toBe(true);
  });

  it("requiredSkillOutputMissing accepts the parsed today_brief", () => {
    const definition = requireTaskDefinition("today_plan");
    const items = parseAgentTexts([REAL_CODEX_TODAY_BRIEF]);
    expect(requiredSkillOutputMissing("today_plan", definition, items)).toBeNull();
  });

  it("output schema lets the model write display_tasks", () => {
    const definition = requireTaskDefinition("today_plan");
    const schema = skillOutputSchema("today_plan", definition) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties?.display_tasks).toBeTruthy();
    expect(schema.required || []).toContain("display_tasks");
  });

  it("parsed brief passes validateTodayBrief", () => {
    const items = parseAgentTexts([REAL_CODEX_TODAY_BRIEF]);
    const brief = items.find((item) => item.type === "today_brief");
    expect(brief).toBeTruthy();
    const { type: _type, ...rest } = brief as Record<string, unknown>;
    const checked = validateTodayBrief(rest);
    expect(checked.ok).toBe(true);
  });
});
