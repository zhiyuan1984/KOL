/**
 * 实时上下文 P1：改写器纯函数单测（解析 + Host 校验 + 上下文清洗）。
 * 不碰 Luna、不碰 DB：rewriteQuestion 的网络失败路径由调用方降级覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  parseRewriteOutput,
  RewriteUnavailable,
  sanitizeSessionContext,
  validateRewrite,
  type RewriteInput,
} from "../src/knowledge/rewriter.js";

function baseInput(overrides: Partial<RewriteInput> = {}): RewriteInput {
  return {
    query: "介绍下它的规格参数",
    last_turn: {
      query: "有哪些产品型号",
      answer: "LiTime 12V 100Ah 和 LiTime 12V 200Ah 两个型号。",
      entities: ["LiTime 产品手册"],
      citations: [{ document: "LiTime 产品手册", title: "LiTime 产品手册" }],
    },
    history_summary: "",
    ...overrides,
  };
}

describe("parseRewriteOutput", () => {
  it("解析正常改写", () => {
    const out = parseRewriteOutput(
      JSON.stringify({
        rewritten: "介绍下 LiTime 12V 100Ah 的规格参数",
        resolved_entities: ["LiTime 12V 100Ah"],
        rewrote: true,
        reason: "「它」指代上轮的 100Ah 型号",
      }),
      "介绍下它的规格参数",
    );
    expect(out.rewrote).toBe(true);
    expect(out.rewritten).toContain("LiTime 12V 100Ah");
    expect(out.resolved_entities).toEqual(["LiTime 12V 100Ah"]);
  });

  it("rewrote=false 时原样回退 query", () => {
    const out = parseRewriteOutput(
      JSON.stringify({ rewritten: "whatever", resolved_entities: [], rewrote: false, reason: "" }),
      "退货政策是什么",
    );
    expect(out.rewrote).toBe(false);
    expect(out.rewritten).toBe("退货政策是什么");
    expect(out.resolved_entities).toEqual([]);
  });

  it("非 JSON 抛 RewriteUnavailable（调用方回退原问题）", () => {
    expect(() => parseRewriteOutput("not json", "q")).toThrow(RewriteUnavailable);
  });
});

describe("validateRewrite（Host 校验 §4.4）", () => {
  it("无指代（rewrote=false）直接通过", () => {
    const input = baseInput();
    expect(
      validateRewrite({ rewritten: input.query, resolved_entities: [], rewrote: false, reason: "" }, input).ok,
    ).toBe(true);
  });

  it("实体在改写后问题中出现、且在上轮回答里有出处 → 通过", () => {
    const input = baseInput();
    const verdict = validateRewrite(
      {
        rewritten: "介绍下 LiTime 12V 100Ah 的规格参数",
        resolved_entities: ["LiTime 12V 100Ah"],
        rewrote: true,
        reason: "",
      },
      input,
    );
    expect(verdict.ok).toBe(true);
  });

  it("改写后问题没包含实体词 → 拒绝", () => {
    const input = baseInput();
    const verdict = validateRewrite(
      {
        rewritten: "介绍下规格参数",
        resolved_entities: ["LiTime 12V 100Ah"],
        rewrote: true,
        reason: "",
      },
      input,
    );
    expect(verdict.ok).toBe(false);
  });

  it("实体在上文无出处（编造）→ 拒绝", () => {
    const input = baseInput();
    const verdict = validateRewrite(
      {
        rewritten: "介绍下 LiTime 51.2V 100Ah 的规格参数",
        resolved_entities: ["LiTime 51.2V 100Ah"],
        rewrote: true,
        reason: "",
      },
      input,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("无出处");
  });

  it("实体来自引用文档名 → 通过", () => {
    const input = baseInput({
      last_turn: {
        query: "保修多久",
        answer: "见手册。",
        entities: [],
        citations: [{ document: "LiTime 12V 100Ah 手册", title: "LiTime 12V 100Ah 手册" }],
      },
    });
    const verdict = validateRewrite(
      {
        rewritten: "LiTime 12V 100Ah 手册里的保修是多久",
        resolved_entities: ["LiTime 12V 100Ah"],
        rewrote: true,
        reason: "",
      },
      input,
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("sanitizeSessionContext", () => {
  it("无上文返回 null（调用方跳过改写）", () => {
    expect(sanitizeSessionContext({}).last_turn).toBeNull();
    expect(sanitizeSessionContext({ last_turn: { query: "  " } }).last_turn).toBeNull();
  });

  it("截断超长回答与摘要", () => {
    const { last_turn, history_summary } = sanitizeSessionContext({
      last_turn: { query: "q", answer: "a".repeat(5000), entities: ["e"], citations: [] },
      history_summary: "s".repeat(5000),
    });
    expect(last_turn?.answer).toHaveLength(2000);
    expect(history_summary).toHaveLength(1500);
  });

  it("清洗 entities 与 citations", () => {
    const { last_turn } = sanitizeSessionContext({
      last_turn: {
        query: "q",
        answer: "a",
        entities: [" e1 ", "", "e2"],
        citations: [{ document: "d", title: "t" }, { document: "", title: "" }],
      },
    });
    expect(last_turn?.entities).toEqual(["e1", "e2"]);
    expect(last_turn?.citations).toHaveLength(1);
  });
});
