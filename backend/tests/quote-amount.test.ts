import { describe, expect, it } from "vitest";
import {
  bodyContainsAmount,
  ensureQuoteInBody,
  ensureQuoteInZh,
  formatQuoteRate,
  looksLikeEmailDraft,
  parseQuoteOffer,
  parseQuoteRate,
  quoteZhInternal,
} from "../src/host/quote-amount.js";
import { extractTaskEntities } from "../src/tasks/resolver.js";
import { composeFactsFromContext, composePreviewPrompt } from "../src/host/compose-loop.js";
import { stubReviseFields } from "../src/host/result-revise.js";

const OPERATOR = "报价邮件草稿金额未写明，请在草稿里补上价格5000美金1小时";

describe("parseQuoteRate", () => {
  it("reads 100美金1小时 after 写报价邮件 without treating 报价邮件 as the amount prefix", () => {
    expect(parseQuoteRate("写报价邮件 100美金1小时")).toEqual({
      amount_usd: 100,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(parseQuoteRate("100美金1小时")).toMatchObject({ amount_usd: 100, rate_unit: "hour" });
    expect(parseQuoteRate("/写报价邮件 100美金1小时")).toMatchObject({ amount_usd: 100, rate_unit: "hour" });
    expect(parseQuoteRate("写一份报价邮件 金额 680").amount_usd).toBe(680);
    expect(parseQuoteRate("写报价邮件 金额 680").rate_unit).toBeNull();
  });

  it("reads USD 100 per hour and $100/hr", () => {
    expect(parseQuoteRate("USD 100 per hour")).toEqual({
      amount_usd: 100,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(parseQuoteRate("$100/hr")).toMatchObject({ amount_usd: 100, rate_unit: "hour" });
    expect(parseQuoteRate("美金100")).toMatchObject({ amount_usd: 100 });
  });

  it("formats hourly rates and detects an English draft", () => {
    expect(formatQuoteRate(100, "USD", "hour")).toBe("USD 100 per hour");
    expect(looksLikeEmailDraft("Hi,\n\nPlease find the quote at USD 100 per hour.\n\nBest,\nDesk\n")).toBe(true);
    expect(looksLikeEmailDraft("写报价邮件 @数码老张")).toBe(false);
  });

  it("reads 价格5000美金1小时 from the missing-price follow-up", () => {
    expect(parseQuoteRate(OPERATOR)).toEqual({
      amount_usd: 5000,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(parseQuoteOffer(OPERATOR)).toEqual({
      amount_usd: 5000,
      currency: "USD",
      deliverables: "1 hour",
    });
    expect(parseQuoteOffer("写报价邮件 @数码老张").amount_usd).toBeNull();
    expect(parseQuoteOffer("美金5000").amount_usd).toBe(5000);
  });
});

describe("quote offer flows into entities and compose facts", () => {
  it("keeps the AI box, preview prompt, and facts on the same $5000 / hour", () => {
    expect(extractTaskEntities(OPERATOR)).toMatchObject({
      amount_usd: 5000,
      currency: "USD",
      rate_unit: "hour",
      deliverables: "1 hour",
    });
    const facts = composeFactsFromContext({
      stage: "QUOTE_PENDING",
      raw: OPERATOR,
      amount_usd: 5000,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(facts).toMatchObject({
      kind: "quote",
      amount_usd: 5000,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(facts.items.join(" ")).toMatch(/USD 5000 per hour/);
    expect(facts.items.join(" ")).not.toMatch(/金额未写明/);
    const prompt = composePreviewPrompt(OPERATOR, "", facts);
    expect(prompt).toMatch(/USD 5000 per hour/);
    expect(prompt).toMatch(/禁止改写成没有价格的建联信/);
  });
});

describe("ensure quote lands in body and Chinese internal translation", () => {
  it("injects the rate into a first-touch letter that had no price", () => {
    const outreach = "I hope you’re having a wonderful day! I wanted to reach out about a LiTime collaboration.\n\nBest,\nLiTime Creator Desk\n";
    const offer = parseQuoteOffer(OPERATOR);
    const body = ensureQuoteInBody(outreach, offer);
    expect(body).toMatch(/USD 5000 per hour/);
    expect(body).toMatch(/wonderful day/);
    expect(body).toMatch(/Best,/);
    const zh = ensureQuoteInZh("首封建联内部译稿", offer);
    expect(zh).toMatch(/5000/);
    expect(zh).toMatch(/小时/);
    const internal = quoteZhInternal(body, offer);
    expect(internal).toMatch(/5000/);
    expect(internal).toContain(body.trim());
    expect(bodyContainsAmount(body, 5000)).toBe(true);
  });
});

describe("stub revise patches a priceless draft", () => {
  it("adds USD 5000 per hour into body and zh instead of only amount_usd", () => {
    const fields = stubReviseFields(OPERATOR, {
      skill: "email_compose",
      body: "I hope you’re having a wonderful day! Let’s find a time to connect.\n\nBest,\nLiTime Creator Desk\n",
      body_zh_internal: "建联内部译稿",
      amount_usd: null,
    });
    expect(fields.amount_usd).toBe(5000);
    expect(String(fields.body)).toMatch(/USD 5000 per hour/);
    expect(String(fields.body_zh_internal)).toMatch(/5000/);
  });
});
