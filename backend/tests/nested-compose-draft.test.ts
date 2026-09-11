import { describe, expect, it } from "vitest";
import { composePayloadFromItem, emailMcpResultCard } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";
import { extractNestedCreateDrafts, extractDraftsFromRawText, parseAgentTexts } from "../src/worker/parse.js";
import { completeTurnItems } from "../src/worker/session-items.js";
import { skillOutputSchema } from "../src/worker/runner.js";
import { requireTaskDefinition } from "../src/tasks/registry.js";

const LARRY = "larry.zhao@amperetime.com";
const QIYOU = "qiyou1984@gmail.com";
const QUOTE_BODY = [
  "Hi,",
  "",
  "Thank you for your interest in collaborating with LiTime. We would like to propose a fee of USD 1000 for this potential collaboration. Please let us know whether this amount works for you. We can then align on the content scope, usage rights, and timeline before confirming the collaboration.",
  "",
  "Best,",
  "Larry",
].join("\n");
const QUOTE_ZH = [
  "你好，",
  "",
  "感谢你有兴趣与 LiTime 合作。对于这次潜在合作，我们希望提出 USD 1000 的费用方案。请告知这一金额是否合适。之后，我们可以在确认合作前进一步对齐内容范围、使用权和时间安排。",
  "",
  "祝好，",
  "Larry",
].join("\n");

const nestedDraft = {
  type: "create_draft",
  skill: "email_compose",
  template_id: "quote_confirm.v1",
  from: LARRY,
  to: QIYOU,
  subject: "Re: KOL合作",
  body: QUOTE_BODY,
  body_zh_internal: QUOTE_ZH,
  amount_usd: 1000,
  currency: "USD",
  keep_stage: true,
  official_stage: "QUOTE_PENDING",
};

const quoteResult: Json = {
  type: "task_result",
  title: "报价邮件草稿",
  summary: "已生成草稿，尚未发送，也未变更阶段。",
  sections: [
    { title: "报价要点", body: "金额：USD 1000。此报价仅为提议，合作范围、授权和档期仍待确认。", items: [] },
    { title: "create_draft", body: JSON.stringify(nestedDraft), items: [] },
  ],
  metrics: [],
  recommended_actions: ["核对草稿后回复「确认发送」；预览不等于发送。"],
};

const concatenatedCodex = [
  JSON.stringify({
    type: "task_result",
    title: "正在生成报价邮件草稿",
    summary: "我会按 email_compose 技能读取该达人的当前合作阶段、历史往来和已授权发件箱，再生成英文预览；此操作不会发送邮件或变更阶段。",
    sections: [],
    metrics: [],
    recommended_actions: [],
  }),
  JSON.stringify({
    type: "task_result",
    title: "合作记录已匹配",
    summary: "当前正式阶段为 QUOTE_PENDING，收件人为 qiyou1984@gmail.com，合作记录关联发件箱为 kol.lt@litime.example。",
    sections: [],
    metrics: [],
    recommended_actions: [],
  }),
  JSON.stringify(quoteResult),
].join("");

describe("nested Codex create_draft inside task_result", () => {
  it("lifts create_draft from concatenated task_result JSON", () => {
    const items = parseAgentTexts([concatenatedCodex]);
    expect(items[0]).toMatchObject({
      type: "create_draft",
      from: LARRY,
      to: QIYOU,
      subject: "Re: KOL合作",
      amount_usd: 1000,
      template_id: "quote_confirm.v1",
    });
    expect(String(items[0].body)).toContain("USD 1000");
    expect(String(items[0].body)).not.toContain("family camping");
    expect(items.filter((item) => item.type === "task_result").map((item) => item.title)).toEqual([
      "正在生成报价邮件草稿",
      "合作记录已匹配",
      "报价邮件草稿",
    ]);
  });

  it("reads nested JSON even when the sibling create_draft was not lifted", () => {
    const payload = composePayloadFromItem(quoteResult, []);
    expect(payload).toMatchObject({
      from: LARRY,
      mailboxEmail: LARRY,
      subject: "Re: KOL合作",
    });
    expect(payload.to).toEqual(expect.arrayContaining([QIYOU]));
    expect(String(payload.body)).toContain("USD 1000");
    const card = emailMcpResultCard("email_compose", payload);
    expect(String(card.summary)).not.toContain("还需要补充");
    expect(JSON.stringify(card.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(card.sections)).toContain("Re: KOL合作");
    expect(JSON.stringify(card.sections)).not.toContain("待补充字段");
    expect(JSON.stringify(card.sections)).not.toContain("family camping");
  });

  it("rebuilds the quote card and keeps progress notes from becoming empty compose cards", async () => {
    const existing = parseAgentTexts([concatenatedCodex]).filter((item) => item.type === "task_result");
    expect(existing.some((item) => item.type === "create_draft")).toBe(false);
    expect(extractNestedCreateDrafts(quoteResult)[0]).toMatchObject({ from: LARRY, to: QIYOU });

    const items = await completeTurnItems("email_compose", {
      raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000",
      amount_usd: 1000,
    }, existing, []);

    const draft = items.find((item) => item.type === "create_draft");
    expect(draft).toMatchObject({
      from: LARRY,
      to: QIYOU,
      subject: "Re: KOL合作",
      amount_usd: 1000,
    });
    expect(String(draft?.body)).toContain("USD 1000");
    expect(String(draft?.body)).not.toContain("family camping");
    expect(String(draft?.body)).not.toContain("Outline check-in");

    const titles = items.filter((item) => item.type === "task_result").map((item) => item.title);
    expect(titles).toContain("正在生成报价邮件草稿");
    expect(titles).toContain("合作记录已匹配");
    const card = items.find((item) => item.type === "task_result" && item.title === "邮件草稿")
      || items.find((item) => item.type === "task_result" && String(item.title).includes("草稿"));
    expect(card).toBeTruthy();
    expect(String(card?.summary)).not.toContain("还需要补充");
    expect(JSON.stringify(card?.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card?.sections)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(card?.sections)).not.toContain("family camping");
    expect(JSON.stringify(items)).not.toContain("Renogy Creator Desk");
  });

  it("keeps a lifted sibling draft instead of inventing a 催大纲 letter", async () => {
    const existing = parseAgentTexts([concatenatedCodex]);
    expect(itemsHaveDraft(existing)).toBe(true);
    const items = await completeTurnItems("email_compose", {
      raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000",
      amount_usd: 1000,
    }, existing, []);
    const draft = items.find((item) => item.type === "create_draft");
    expect(String(draft?.from)).toBe(LARRY);
    expect(String(draft?.to)).toBe(QIYOU);
    expect(String(draft?.subject)).toBe("Re: KOL合作");
    expect(String(draft?.body)).toContain("USD 1000");
    expect(String(draft?.body_zh_internal)).toContain("USD 1000");
    expect(JSON.stringify(items)).not.toContain("Outline check-in");
    const card = items.find((item) => item.type === "task_result" && item.title === "邮件草稿");
    expect(String(card?.summary)).not.toContain("还需要补充");
    expect(JSON.stringify(card?.sections)).toContain(`发件邮箱：${LARRY}`);
  });

  it("recovers a quote draft when Codex nests create_draft with raw newlines and unescaped quotes", async () => {
    const raw = [
      `{"type":"task_result","title":"正在生成报价邮件草稿","summary":"我会按 email_compose 读取当前合作记录、CONTEXT 发件箱和历史往来，并生成预览；不会发送邮件或变更阶段。","sections":[],"metrics":[],"recommended_actions":[]}`,
      `{"type":"task_result","title":"合作记录已匹配","summary":"当前 stage_code 为 QUOTE_PENDING，收件人为 qiyou1984@gmail.com；将使用 CONTEXT 指定的 larry.zhao@amperetime.com 生成 USD 1000 报价预览。","sections":[],"metrics":[],"recommended_actions":[]}`,
      `{"type":"task_result","title":"报价邮件草稿","summary":"已生成 USD 1000 报价草稿；尚未发送，也未变更阶段。","sections":[{"title":"报价要点","body":"金额：USD 1000。合作范围、授权和档期仍待双方确认。","items":[]},{"title":"create_draft","body":"{"type":"create_draft","skill":"email_compose","template_id":"quote_confirm.v1","from":"${LARRY}","to":"${QIYOU}","subject":"Re: KOL合作","body":"Hi,`,
      "",
      "Thank you for your interest in collaborating with LiTime. We appreciate your work in the home-office and energy-storage space.",
      "",
      "For this potential collaboration, we would like to propose USD 1000. Please let us know whether this amount is acceptable. We can then align on the content scope, usage rights, and timeline before confirming any arrangement.",
      "",
      `Best,`,
      `Larry","body_zh_internal":"你好，`,
      "",
      "感谢你有兴趣与 LiTime 合作。我们很欣赏你在居家办公和储能领域的内容。",
      "",
      "对于此次潜在合作，我们希望提出 USD 1000 的报价。请告知这一金额是否可以接受。之后，我们可以在确认任何合作安排前进一步对齐内容范围、使用权和时间计划。",
      "",
      `祝好，`,
      `Larry","amount_usd":1000,"currency":"USD","keep_stage":true,"official_stage":"QUOTE_PENDING"}","items":[]}],"metrics":[],"recommended_actions":["核对草稿后回复「确认发送」。"]}`,
    ].join("\n");

    expect(extractDraftsFromRawText(raw)[0]).toMatchObject({
      from: LARRY,
      to: QIYOU,
      subject: "Re: KOL合作",
      amount_usd: 1000,
    });
    const items = parseAgentTexts([raw]);
    const draft = items.find((item) => item.type === "create_draft");
    expect(draft).toMatchObject({ from: LARRY, to: QIYOU, subject: "Re: KOL合作" });
    expect(String(draft?.body)).toContain("USD 1000");
    expect(String(draft?.body)).toContain("home-office");
    expect(String(draft?.body_zh_internal)).toContain("储能");

    const rebuilt = await completeTurnItems("email_compose", {
      raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000",
      amount_usd: 1000,
      entities: { mailboxEmail: LARRY, to: QIYOU },
    }, parseAgentTexts([raw]), []);
    const card = rebuilt.find((item) => item.type === "task_result" && item.title === "邮件草稿")
      || rebuilt.find((item) => item.type === "task_result" && String(item.summary || "").includes("确认发送"));
    expect(String(card?.summary || "")).not.toContain("还需要补充");
    expect(JSON.stringify(card?.sections || rebuilt)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card?.sections || rebuilt)).toContain(`收件邮箱：${QIYOU}`);
    expect(JSON.stringify(rebuilt)).not.toContain("family camping");
  });

  it("lifts a quote draft from first-class task_result fields", () => {
    const items = parseAgentTexts([JSON.stringify({
      type: "task_result",
      title: "报价邮件草稿",
      summary: "已生成 USD 1000 报价草稿；尚未发送，也未变更阶段。",
      sections: [{ title: "报价要点", body: "金额：USD 1000", items: [] }],
      metrics: [],
      recommended_actions: ["核对草稿后回复「确认发送」。"],
      from: LARRY,
      to: QIYOU,
      subject: "Re: KOL合作",
      body: QUOTE_BODY,
      amount_usd: 1000,
    })]);
    expect(items[0]).toMatchObject({
      type: "create_draft",
      from: LARRY,
      to: QIYOU,
      subject: "Re: KOL合作",
    });
    expect(String(items[0].body)).toContain("USD 1000");
  });

  it("fills From/To from Host collaboration context when Codex omits addresses", async () => {
    const items = await completeTurnItems("email_compose", {
      raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000",
      amount_usd: 1000,
      entities: { mailboxEmail: LARRY, to: QIYOU },
    }, [{
      type: "task_result",
      title: "报价邮件草稿",
      summary: "已生成 USD 1000 报价草稿；尚未发送，也未变更阶段。",
      sections: [{ title: "报价要点", body: "金额：USD 1000。合作范围、授权和档期仍待双方确认。", items: [] }],
      recommended_actions: ["核对草稿后回复「确认发送」。"],
      subject: "Re: KOL合作",
      body: QUOTE_BODY,
    }], []);
    const draft = items.find((item) => item.type === "create_draft");
    expect(draft).toMatchObject({ from: LARRY, to: QIYOU, subject: "Re: KOL合作" });
    const card = items.find((item) => item.type === "task_result" && item.title === "邮件草稿");
    expect(String(card?.summary)).not.toContain("还需要补充");
    expect(JSON.stringify(card?.sections)).toContain(`发件邮箱：${LARRY}`);
    expect(JSON.stringify(card?.sections)).toContain(`收件邮箱：${QIYOU}`);
  });

  it("fills From/To when Codex emits null routing fields", async () => {
    const items = await completeTurnItems("email_compose", {
      raw: "写报价邮件 @灵工连通测试-qiyou1984 金额 USD 1000",
      amount_usd: 1000,
      entities: { mailboxEmail: LARRY, to: QIYOU },
    }, [{
      type: "task_result",
      title: "报价邮件草稿",
      summary: "已生成 USD 1000 报价草稿；尚未发送，也未变更阶段。",
      sections: [{ title: "报价要点", body: "金额：USD 1000。合作范围、授权和档期仍待双方确认。", items: [] }],
      recommended_actions: ["核对草稿后回复「确认发送」。"],
      from: null,
      mailboxEmail: null,
      to: null,
      subject: "Re: KOL合作",
      body: QUOTE_BODY,
      body_zh_internal: QUOTE_ZH,
      amount_usd: 1000,
      currency: "USD",
      keep_stage: true,
      official_stage: null,
      template_id: "quote_confirm.v1",
    }], []);
    const draft = items.find((item) => item.type === "create_draft");
    expect(draft).toMatchObject({ from: LARRY, to: QIYOU, subject: "Re: KOL合作" });
    expect(String(items.find((item) => item.type === "task_result" && item.title === "邮件草稿")?.summary))
      .not.toContain("还需要补充");
  });

  it("uses a Codex-strict compose object schema with first-class mail fields", () => {
    const schema = skillOutputSchema("email_compose", requireTaskDefinition("email_compose"));
    expectCodexStrictSchema(schema);
    expect((schema.properties as Json).type).toEqual({ type: "string", enum: ["task_result"] });
    expect((schema.properties as Json).subject).toEqual({ type: "string" });
    expect((schema.properties as Json).body).toEqual({ type: "string" });
    expect((schema.properties as Json).from).toEqual({ type: ["string", "null"] });
    expect((schema.properties as Json).to).toEqual({ type: ["string", "null"] });
    expect((schema.properties as Json).body_zh_internal).toEqual({ type: "string" });
  });
});

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

function itemsHaveDraft(items: Json[]): boolean {
  return items.some((item) => item.type === "create_draft");
}
