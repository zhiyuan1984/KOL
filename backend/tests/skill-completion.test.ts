import { afterEach, describe, expect, it } from "vitest";
import type { Json } from "../src/types.js";
import { requireTaskDefinition } from "../src/tasks/registry.js";
import { CodexUnavailable } from "../src/worker/errors.js";
import { completeTurnItems } from "../src/worker/session-items.js";
import { requiredSkillOutputMissing, skillOutputSchema } from "../src/worker/runner.js";

const READ_SKILLS = ["reply_analysis", "creator_profile", "risk_scan"] as const;

function analysisItem(skill: string): Json {
  return {
    type: "task_result",
    skill,
    title: skill === "creator_profile" ? "达人画像" : skill === "risk_scan" ? "超时/风险扫描" : "回复分析",
    summary: "MCP 已读完，结论如下。",
    sections: [{ title: "分析结果", body: "来信支持继续跟进，不需要邮件草稿。", items: ["只读"] }],
    metrics: [{ label: "来源", value: "pageEmailConversations", detail: "ok" }],
    recommended_actions: ["记状态"],
  };
}

function expectCodexStrictSchema(schema: Json, path = "$"): void {
  expect(schema.oneOf, `${path} oneOf`).toBeUndefined();
  expect(schema.anyOf, `${path} anyOf`).toBeUndefined();
  expect(schema.allOf, `${path} allOf`).toBeUndefined();
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.includes("object") || schema.properties) {
    expect(schema.additionalProperties, path).toBe(false);
    const keys = Object.keys((schema.properties || {}) as object);
    expect(new Set(schema.required as string[]), `${path} required`).toEqual(new Set(keys));
    for (const [key, value] of Object.entries((schema.properties || {}) as Record<string, Json>)) {
      expectCodexStrictSchema(value, `${path}.${key}`);
    }
  }
  if (types.includes("array") && schema.items && typeof schema.items === "object") {
    expectCodexStrictSchema(schema.items as Json, `${path}[]`);
  }
}

describe("read skill completion (real Codex, no mail draft)", () => {
  const prev = process.env.CODEX_MODE;
  afterEach(() => {
    process.env.CODEX_MODE = prev;
  });

  it.each(READ_SKILLS)("%s surfaces a task_result without requiring a create_draft", async (skill) => {
    process.env.CODEX_MODE = "real";
    const existing = [analysisItem(skill)];
    const items = await completeTurnItems(skill, { raw: `${skill} @灵工连通测试` }, existing, []);
    expect(items.some((item) => item.type === "create_draft")).toBe(false);
    const card = items.find((item) => item.type === "task_result");
    expect(card).toMatchObject({
      type: "task_result",
      summary: "MCP 已读完，结论如下。",
    });
    expect(requiredSkillOutputMissing(skill, requireTaskDefinition(skill), items)).toBeNull();
  });

  it("wraps analysis text as task_result so reply_analysis can complete", async () => {
    process.env.CODEX_MODE = "real";
    const items = await completeTurnItems("reply_analysis", { raw: "分析回复" }, [{
      type: "text",
      text: "来信确认档期，建议推进到商务谈判。未改阶段。",
    }], []);
    const card = items.find((item) => item.type === "task_result");
    expect(card?.title).toBe("回复分析");
    expect(String(card?.summary)).toContain("来信确认档期");
    expect(items.some((item) => item.type === "create_draft")).toBe(false);
    expect(requiredSkillOutputMissing("reply_analysis", requireTaskDefinition("reply_analysis"), items)).toBeNull();
  });

  it("does not use the mail-draft generation_unavailable message for read skills", async () => {
    process.env.CODEX_MODE = "real";
    await expect(completeTurnItems("creator_profile", { raw: "达人画像" }, [], [])).rejects.toBeInstanceOf(CodexUnavailable);
    try {
      await completeTurnItems("risk_scan", { raw: "风险扫描" }, [], []);
      throw new Error("expected CodexUnavailable");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexUnavailable);
      const dict = (error as CodexUnavailable).asDict();
      expect(dict.code).toBe("generation_unavailable");
      expect(String(dict.message)).not.toContain("邮件草稿");
      expect(String(dict.message)).toContain("任务结果");
    }
  });

  it("still fails closed when email_compose has no mappable draft", async () => {
    process.env.CODEX_MODE = "real";
    try {
      await completeTurnItems("email_compose", { raw: "写合作邮件" }, [], []);
      throw new Error("expected CodexUnavailable");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexUnavailable);
      expect((error as CodexUnavailable).asDict().message).toBe("生成已结束，但没有产出可映射的邮件草稿。Host 没有代填。");
    }
  });
});

describe("business_approval create_approval schema", () => {
  it("is Codex-strict so proposal output is not rejected as invalid_json_schema", () => {
    const schema = skillOutputSchema("business_approval", requireTaskDefinition("business_approval"));
    expectCodexStrictSchema(schema);
    expect((schema.properties as Json).type).toEqual({ type: "string", enum: ["create_approval"] });
    expect((schema.properties as Json).amount).toEqual({ type: ["number", "null"] });
    expect((schema.properties as Json).needs).toEqual({ type: "array", items: { type: "string" } });
    expect((schema.properties as Json).fx).toMatchObject({ type: "object", additionalProperties: false });
    expect((schema.properties as Json).policy).toMatchObject({ type: "object", additionalProperties: false });
    expect(((schema.properties as Json).chain as Json).items).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  it("accepts a create_approval proposal or a needs-clarification payload as the Turn output", () => {
    const definition = requireTaskDefinition("business_approval");
    expect(requiredSkillOutputMissing("business_approval", definition, [{
      type: "create_approval",
      amount: 50000,
      currency: "USD",
      requester_name: "黎玉燕",
      needs: [],
      fx: { pair: "USD/CNY", rate: 7.13, as_of: "2026-09-13", source_url: "https://www.pbc.gov.cn/x", quote: "中间价" },
      policy: { id: "档", title: "费用档", as_of: "2026-01-01", source_url: "https://intranet.example/p", quote: "须至总经理" },
      chain: [{ name: "林桐", role: "PQ品牌组负责人", source: "汇报线" }],
    }])).toBeNull();
    expect(requiredSkillOutputMissing("business_approval", definition, [{
      type: "create_approval",
      amount: null,
      currency: null,
      requester_name: "黎玉燕",
      needs: ["amount", "currency"],
      fx: { pair: null, rate: null, as_of: null, source_title: null, source_url: null, quote: null },
      policy: { id: null, title: null, as_of: null, source_url: null, quote: null },
      chain: [],
    }])).toBeNull();
    const missing = requiredSkillOutputMissing("business_approval", definition, []);
    expect(missing?.message).toBe("生成服务已结束，但没有产出结构化任务结果。");
  });
});
