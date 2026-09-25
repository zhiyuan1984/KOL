import { confirmAndSendDraft } from "./helpers/confirmed-mail.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import {
  composeFactsFromContext,
  composeGapHint,
  composeLoopSections,
  composePreviewPrompt,
  composeRouteFacts,
  isQuoteCompose,
  pickComposeTemplate,
  previewComposeForCollaboration,
  stageMailAction,
  stageMailSpec,
} from "../src/host/compose-loop.js";
import { ingestKolMail, journeyPayload, recommendedCollabActions, resetKolMailSync, syncKolSessionMail } from "../src/host/kol-journey.js";
import { mailHistoryRows, readThreadDigest } from "../src/host/mail-summary.js";
import { setIntentLlmFetch } from "../src/tasks/openai-intent.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import { setStarryKolClientFactory } from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";

let tmp: string;
let app: Hono;

async function request(method: string, url: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) as Json : {}, text };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-compose-loop-"));
  process.env.LINGONG_DB = path.join(tmp, "t.db");
  process.env.LINGONG_DATA = tmp;
  process.env.CODEX_MODE = "stub";
  resetConn();
  resetKolMailSync();
  seedAll();
  const { createApp } = await import("../src/app.js");
  app = createApp();
  seedWorkbenchFixtures();
});

afterEach(() => {
  setIntentLlmFetch();
  delete process.env.INTENT_LLM_MODE;
  delete process.env.OPENAI_API_KEY;
  setStarryKolClientFactory();
  resetKolMailSync();
  resetConn();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("KOL stage-mail communication", () => {
  it("locks From/To from the bound mailbox and current KOL, not from nested JSON", () => {
    const route = composeRouteFacts({
      col: { email: "qiyou1984@gmail.com", mailbox_from: "kol.lt@litime.example" },
      boundMailbox: "larry.zhao@amperetime.com",
    });
    expect(route).toEqual({
      mailboxEmail: "larry.zhao@amperetime.com",
      from: "larry.zhao@amperetime.com",
      to: "qiyou1984@gmail.com",
    });
  });

  it("picks this official stage's letter, not a quote-shaped loop", () => {
    expect(stageMailSpec("INITIAL_CONTACT").chip).toBe("写合作邮件");
    expect(stageMailSpec("QUOTE_PENDING").chip).toBe("写报价邮件");
    expect(stageMailSpec("SAMPLE_PENDING").chip).toBe("核对地址");
    expect(stageMailSpec("SHIPPED").chip).toBe("发货通知");
    expect(stageMailAction("数码老张", "QUOTE_PENDING").prompt).toBe("写报价邮件 @数码老张");
    expect(stageMailAction("小美妆日记", "INITIAL_CONTACT").prompt).toBe("写合作邮件 @小美妆日记");
    expect(isQuoteCompose("QUOTE_PENDING")).toBe(true);
    expect(isQuoteCompose("INITIAL_CONTACT")).toBe(false);
    const quote = composeFactsFromContext({
      stage: "QUOTE_PENDING",
      raw: "写报价邮件 金额 680",
      amount_usd: 680,
      digest: "来信请品牌补充报价。",
    });
    expect(quote.title).toBe("报价要点");
    expect(quote.kind).toBe("quote");
    expect(quote.items.join(" ")).toMatch(/USD 680/);
    expect(quote.items.join(" ")).not.toMatch(/往来依据/);
    expect(composeLoopSections(quote).some((row) => String(row.title) === "往来依据")).toBe(false);
    const hourly = composeFactsFromContext({
      stage: "QUOTE_PENDING",
      raw: "写报价邮件 100美金1小时",
      amount_usd: 100,
      currency: "USD",
      rate_unit: "hour",
    });
    expect(hourly.amount_usd).toBe(100);
    expect(hourly.rate_unit).toBe("hour");
    expect(hourly.items.join(" ")).toMatch(/USD 100 per hour/);
    expect(composePreviewPrompt("写报价邮件 100美金1小时", "", hourly)).toContain("USD 100 per hour");
    expect(composePreviewPrompt("写报价邮件 100美金1小时", "", hourly)).not.toMatch(/one video \+ two shorts|套餐总价约束/i);
    const firstTouch = composeFactsFromContext({ stage: "INITIAL_CONTACT", raw: "写合作邮件", amount_usd: 680 });
    expect(firstTouch.title).toBe("建联要点");
    expect(firstTouch.kind).toBe("first_touch");
    expect(firstTouch.quote).toBe(false);
    const sample = composeFactsFromContext({
      stage: "SAMPLE_PENDING",
      raw: "核对地址",
      name: "张伟",
      sku: "LT-MINI-12",
    });
    expect(sample.title).toBe("寄样资料");
    expect(sample.items.join(" ")).toMatch(/张伟|LT-MINI-12|未齐/);
    const prompt = composePreviewPrompt("写报价邮件 金额 680", "来信请品牌补充报价。", quote);
    expect(prompt).toContain("历史往来摘要");
    expect(prompt).toContain("来信请品牌补充报价");
    expect(prompt).toContain("680");
    expect(pickComposeTemplate("email_compose", "QUOTE_PENDING", "写报价邮件", 680).id).toBe("quote_confirm.v1");
    expect(pickComposeTemplate("email_compose", "SAMPLE_PENDING", "核对地址", null).id).toBe("addr_check.collect");
    expect(pickComposeTemplate("email_compose", "SHIPPED", "发货通知", null).id).toBe("ship_notice.v1");
    expect(pickComposeTemplate("email_compose", "INITIAL_CONTACT", "写合作邮件", null).id).toBe("kol.first_touch");
    expect(pickComposeTemplate("email_compose", "INITIAL_CONTACT", "写跟进邮件 @小美妆日记", null).id).toBe("stage_mail.followup");
    expect(pickComposeTemplate("email_compose", "INTERESTED", "写跟进邮件 @小美妆日记", null).id).toBe("stage_mail.interested");
    expect(composeGapHint({ kind: "quote", amount_usd: null }).result_action).toMatch(/补上金额/);
    expect(composeGapHint({ kind: "quote", amount_usd: 100 }).field).toBeNull();
  });

  it("session chips name this stage's letter", () => {
    const quoteCol = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_laozhang") as { handle: string; stage_code: string };
    const quoteChip = recommendedCollabActions(quoteCol).find((row) => row.intent === "email_compose");
    expect(quoteChip?.label).toBe("写报价邮件");
    expect(String(quoteChip?.prompt)).toBe("写报价邮件 @数码老张");
    const firstCol = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_xiaomei") as { handle: string; stage_code: string };
    const firstChip = recommendedCollabActions(firstCol).find((row) => row.intent === "email_compose");
    expect(firstChip?.label).toBe("写合作邮件");
    expect(String(firstChip?.prompt)).toBe("写合作邮件 @小美妆日记");
    const briefCol = getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_mum") as { handle: string; stage_code: string };
    const briefChip = recommendedCollabActions(briefCol).find((row) => row.intent === "email_compose");
    expect(briefChip?.label).toBe("发brief");
    expect(String(briefChip?.prompt)).toBe("发brief @母婴小课");
    expect(journeyPayload("col_laozhang")?.composer_placeholder).toBe("写报价邮件 @数码老张 金额 [USD]");
  });

  async function composeOn(colId: string, text: string) {
    ingestKolMail(colId, {
      subject: "LiTime 合作沟通",
      body: "Thanks, I am interested. Please send the next letter.",
      from: "creator.desk@gmail.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: `in-${colId}-${Buffer.from(text).toString("hex").slice(0, 24)}`,
    });
    const opened = await request("POST", `/api/collaborations/${colId}/session`, {});
    expect(opened.status).toBe(200);
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text,
      content: text,
      act: "ask",
      collaboration_id: colId,
    });
    expect(posted.status, posted.text).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    return {
      sid,
      result: messages.find((row) => row.kind === "task_result_card"),
      draft: messages.find((row) => row.kind === "email_card"),
    };
  }

  it("写跟进 stacks follow-up facts and a draft", async () => {
    getConn().prepare("UPDATE collaborations SET stage_code='INTERESTED' WHERE id=?").run("col_xiaomei");
    const follow = await composeOn("col_xiaomei", "写跟进邮件 @小美妆日记");
    expect(follow.result?.payload.compose_loop).toMatchObject({ kind: "followup", quote: false });
    expect(JSON.stringify(follow.result?.payload || "")).toMatch(/跟进要点/);
    expect(follow.draft?.payload.body).toBeTruthy();
  });

  it("写跟进 at first contact stays on the sendable followup template", async () => {
    const follow = await composeOn("col_xiaomei", "写跟进邮件 @小美妆日记");
    const draftId = String(follow.draft?.payload.draft_id || "");
    const stored = getConn().prepare("SELECT template_id, official_stage FROM drafts WHERE id=?").get(draftId) as
      | { template_id?: string; official_stage?: string }
      | undefined;
    expect(stored?.template_id).toBe("stage_mail.followup");
    expect(stored?.official_stage).toBe("INITIAL_CONTACT");
    expect(String(follow.draft?.payload.body || "")).not.toMatch(/Thanks for the interest/i);
    const sent = await confirmAndSendDraft(request, `/api/drafts/${draftId}/send`, { from_addr: "kol.lt@litime.example" });
    expect(sent.status, sent.text).toBe(200);
    const pipe = await request("GET", "/api/pipeline");
    const xiaomei = Object.values(pipe.body.groups as Record<string, { handle: string; stage_code: string }[]>)
      .flat()
      .find((row) => row.handle === "小美妆日记");
    expect(xiaomei?.stage_code).toBe("INITIAL_CONTACT");
  });

  it("核对地址 stacks sample facts, not a quote", async () => {
    getConn().prepare("UPDATE collaborations SET stage_code='SAMPLE_PENDING' WHERE id=?").run("col_laozhang");
    const address = await composeOn("col_laozhang", "核对地址 @数码老张");
    expect(address.result?.payload.compose_loop).toMatchObject({ kind: "address", quote: false });
    expect(JSON.stringify(address.result?.payload || "")).toMatch(/寄样资料|张伟|LT-100AH/);
    expect(JSON.stringify(address.result?.payload || "")).not.toMatch(/USD 680/);
    expect(JSON.stringify(address.result?.payload || "")).toMatch(/可以进入人工确认后的出库流程/);
    expect(address.draft).toBeUndefined();
  });

  it("核对地址 uses address facts even when the official stage is still 报价待确认", async () => {
    const address = await composeOn("col_laozhang", "核对地址 @数码老张");
    expect(address.result?.payload.compose_loop).toMatchObject({ kind: "address", quote: false });
    expect(JSON.stringify(address.result?.payload || "")).toMatch(/寄样资料|张伟|LT-100AH/);
    expect(JSON.stringify(address.result?.payload || "")).toMatch(/可以进入人工确认后的出库流程/);
    expect(JSON.stringify(address.result?.payload || "")).not.toMatch(/USD 680/);
    expect(address.draft).toBeUndefined();
  });

  it("催大纲 on 初步接触 stays as a persistent stage-gate error", async () => {
    const opened = await request("POST", "/api/collaborations/col_xiaomei/session", {});
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "催大纲 @小美妆日记",
      content: "催大纲 @小美妆日记",
      act: "ask",
      collaboration_id: "col_xiaomei",
    });
    expect(posted.status, posted.text).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    const error = messages.find((row) => row.kind === "error_card");
    expect(error?.payload.code).toBe("nudge_stage_gate");
    expect(JSON.stringify(error?.payload || "")).toMatch(/已签收-测试中/);
    expect(messages.find((row) => row.kind === "email_card")).toBeUndefined();
  });

  it("催大纲 without a creator stays on a supplement card", async () => {
    const opened = await request("POST", "/api/sessions", { title: "催大纲" });
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "催大纲 [红人或合作]",
      content: "催大纲 [红人或合作]",
      act: "ask",
    });
    expect(posted.status, posted.text).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    const supplement = messages.find((row) => row.kind === "supplement_card");
    expect(JSON.stringify(supplement?.payload || "")).toMatch(/红人或合作/);
    expect(messages.find((row) => row.kind === "email_card")).toBeUndefined();
  });

  it("发货通知 stacks tracking facts and a draft", async () => {
    getConn().prepare("UPDATE collaborations SET stage_code='SHIPPED' WHERE id=?").run("col_laozhang");
    const ship = await composeOn("col_laozhang", "发货通知 @数码老张 运单号 UPS123456 承运商 UPS");
    expect(ship.result?.payload.compose_loop).toMatchObject({ kind: "ship", quote: false });
    expect(JSON.stringify(ship.result?.payload || "")).toMatch(/发货要点|UPS123456/);
    expect(ship.draft?.payload.body).toBeTruthy();
  });

  it("发brief stacks content facts and a draft", async () => {
    const brief = await composeOn("col_mum", "发brief @母婴小课");
    expect(brief.result?.payload.compose_loop).toMatchObject({ kind: "brief", quote: false });
    expect(JSON.stringify(brief.result?.payload || "")).toMatch(/内容要点/);
    expect(brief.draft?.payload.body).toBeTruthy();
  });

  it("催大纲 stacks testing facts on the content-planning thread", async () => {
    getConn().prepare("UPDATE collaborations SET stage_code='TESTING' WHERE id=?").run("col_mum");
    const outline = await composeOn("col_mum", "催大纲 @母婴小课");
    expect(outline.result?.payload.compose_loop).toMatchObject({ kind: "testing", quote: false });
    expect(JSON.stringify(outline.result?.payload || "")).toMatch(/测试要点/);
    expect(outline.draft?.payload.body).toBeTruthy();
  });

  it("injects the thread digest and shows a priced letter plus draft", async () => {
    ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Please share the collaboration quote and deliverables.",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-quote-1",
    });
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    expect(opened.status).toBe(200);
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写一份报价邮件 金额 680",
      content: "写一份报价邮件 金额 680",
      act: "ask",
      collaboration_id: "col_laozhang",
    });
    expect(posted.status, posted.text).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    const result = messages.find((row) => row.kind === "task_result_card");
    const draft = messages.find((row) => row.kind === "email_card");
    expect(result).toBeTruthy();
    expect(draft).toBeTruthy();
    const blob = JSON.stringify(result?.payload || {});
    expect(blob).toMatch(/报价要点|USD 680|680/);
    expect(blob).not.toMatch(/往来依据/);
    expect(blob).not.toMatch(/one video \+ two shorts/i);
    expect(draft?.payload.amount_usd === 680 || String(draft?.payload.body || "").includes("680")).toBe(true);
    const loop = result?.payload.compose_loop as Json | undefined;
    expect(loop?.quote).toBe(true);
  });

  it("puts 100美金1小时 into the English draft as USD 100 per hour", async () => {
    const hourly = await composeOn("col_laozhang", "写报价邮件 100美金1小时");
    expect(hourly.result?.payload.compose_loop).toMatchObject({ quote: true, amount_usd: 100, rate_unit: "hour" });
    expect(JSON.stringify(hourly.result?.payload || "")).toMatch(/USD 100 per hour/);
    expect(String(hourly.draft?.payload.body || "")).toContain("USD 100 per hour");
    expect(String(hourly.draft?.payload.body || "")).not.toMatch(/one video \+ two shorts/i);
    expect(JSON.stringify(hourly.result?.payload || "")).not.toMatch(/往来依据/);
  });

  it("quote without amount asks to fill price instead of confirm send", async () => {
    const quote = await composeOn("col_laozhang", "写报价邮件 @数码老张");
    const loop = quote.result?.payload.compose_loop as Json | undefined;
    expect(loop?.gap).toMatchObject({
      field: "amount",
      prompt: "把金额改成 [USD]",
      placeholder: "写报价邮件 @数码老张 金额 [USD]",
    });
    expect(JSON.stringify(quote.result?.payload.recommended_actions || [])).toMatch(/补上金额后再确认发送/);
    expect(JSON.stringify(quote.result?.payload.recommended_actions || [])).not.toMatch(/核对预览后回复「确认发送」/);
    expect(JSON.stringify(quote.result?.payload || "")).toMatch(/金额未写明/);
  });

  it("compose-preview fills a quote draft without posting a session message", async () => {
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    const sid = String(opened.body.id);
    const previewed = await request("POST", `/api/sessions/${sid}/compose-preview`, {
      text: "写报价邮件 100美金1小时",
    });
    expect(previewed.status, previewed.text).toBe(200);
    expect(previewed.body.body).toContain("USD 100 per hour");
    expect(previewed.body.rate_unit).toBe("hour");
    const session = await request("GET", `/api/sessions/${sid}`);
    const kinds = (session.body.messages as { kind: string }[]).map((row) => row.kind);
    expect(kinds).not.toContain("me");
    expect(previewComposeForCollaboration(
      getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_laozhang") as never,
      "写报价邮件 100美金1小时",
    ).body).toContain("USD 100 per hour");
    const firstTouch = previewComposeForCollaboration(
      getConn().prepare("SELECT * FROM collaborations WHERE id=?").get("col_xiaomei") as never,
      "写合作邮件",
    );
    expect(firstTouch.body).toMatch(/explore a product collaboration|check interest/i);
    expect(firstTouch.body).not.toMatch(/USD ___ per hour|one video/i);
  });

  it("submitting the preview English draft keeps USD 100 per hour", async () => {
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    const sid = String(opened.body.id);
    const previewed = await request("POST", `/api/sessions/${sid}/compose-preview`, {
      text: "写报价邮件 100美金1小时",
    });
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: previewed.body.body,
      content: previewed.body.body,
      act: "ask",
      intent: "email_compose",
      collaboration_id: "col_laozhang",
      entities: { body: previewed.body.body },
    });
    expect(posted.status, posted.text).toBe(200);
    const messages = posted.body.messages as { kind: string; payload: Json }[];
    const draft = messages.find((row) => row.kind === "email_card");
    expect(String(draft?.payload.body || "")).toContain("USD 100 per hour");
    expect(String(draft?.payload.body || "")).not.toMatch(/one video \+ two shorts/i);
  });

  it("revises only named fields on an unsent result and does not re-preview", async () => {
    const quote = await composeOn("col_laozhang", "写一份报价邮件 金额 680");
    expect(quote.draft?.payload.draft_id).toBeTruthy();
    const from = String(quote.draft?.payload.from || "");
    const to = String(quote.draft?.payload.to || "");
    const subject = String(quote.draft?.payload.subject || "");
    const calls: string[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        return { data: {} };
      },
      async close() { /* noop */ },
    }));
    const revised = await request("POST", `/api/sessions/${quote.sid}/messages`, {
      text: "把金额改成 720",
      content: "把金额改成 720",
      act: "ask",
      collaboration_id: "col_laozhang",
    });
    expect(revised.status, revised.text).toBe(200);
    expect(calls.filter((name) => name === "previewEmailDraft")).toHaveLength(0);
    const messages = revised.body.messages as { kind: string; payload: Json }[];
    const draft = [...messages].reverse().find((row) => row.kind === "email_card")?.payload;
    const result = [...messages].reverse().find((row) => row.kind === "task_result_card")?.payload;
    expect(Number(draft?.amount_usd)).toBe(720);
    expect(String(draft?.from || "")).toBe(from);
    expect(String(draft?.to || "")).toBe(to);
    expect(String(draft?.subject || "")).toBe(subject);
    expect(JSON.stringify(result || {})).toMatch(/720/);
    expect(String(result?.summary || "")).toMatch(/已按你的说明改了/);
  });

  it("puts 价格5000美金1小时 into preview, draft, and Chinese translation together", async () => {
    const priced = await composeOn(
      "col_laozhang",
      "报价邮件草稿金额未写明，请在草稿里补上价格5000美金1小时",
    );
    expect(priced.result?.payload.compose_loop).toMatchObject({ kind: "quote", quote: true, amount_usd: 5000 });
    expect(JSON.stringify(priced.result?.payload || "")).toMatch(/USD 5000|5000/);
    expect(JSON.stringify(priced.result?.payload || "")).not.toMatch(/金额未写明/);
    const preview = (priced.result?.payload.sections as { title?: string; body?: string }[] | undefined)
      ?.find((row) => row.title === "预览正文");
    expect(String(preview?.body || "")).toMatch(/5000/);
    expect(String(preview?.body || "")).toMatch(/1 hour|hour/);
    expect(Number(priced.draft?.payload.amount_usd)).toBe(5000);
    expect(String(priced.draft?.payload.body || "")).toMatch(/5000/);
    expect(String(priced.draft?.payload.body_zh_internal || "")).toMatch(/5000/);
  });

  it("revises a priceless quote draft from the AI box without starting a new letter", async () => {
    const first = await composeOn("col_laozhang", "写报价邮件 @数码老张");
    expect(first.draft?.payload.draft_id).toBeTruthy();
    const revised = await request("POST", `/api/sessions/${first.sid}/messages`, {
      text: "报价邮件草稿金额未写明，请在草稿里补上价格5000美金1小时",
      content: "报价邮件草稿金额未写明，请在草稿里补上价格5000美金1小时",
      act: "ask",
      collaboration_id: "col_laozhang",
    });
    expect(revised.status, revised.text).toBe(200);
    const messages = revised.body.messages as { kind: string; payload: Json }[];
    const draft = [...messages].reverse().find((row) => row.kind === "email_card")?.payload;
    const result = [...messages].reverse().find((row) => row.kind === "task_result_card")?.payload;
    expect(String(result?.summary || "")).toMatch(/已按你的说明改了/);
    expect(Number(draft?.amount_usd)).toBe(5000);
    expect(String(draft?.body || "")).toMatch(/5000/);
    expect(String(draft?.body_zh_internal || "")).toMatch(/5000/);
    const preview = (result?.sections as { title?: string; body?: string }[] | undefined)
      ?.find((row) => row.title === "预览正文");
    expect(String(preview?.body || "")).toMatch(/5000/);
  });

  it("starts a new letter when the follow-up is a stage command", async () => {
    const quote = await composeOn("col_laozhang", "写一份报价邮件 金额 680");
    const follow = await request("POST", `/api/sessions/${quote.sid}/messages`, {
      text: "写跟进 @数码老张",
      content: "写跟进 @数码老张",
      act: "ask",
      collaboration_id: "col_laozhang",
    });
    expect(follow.status, follow.text).toBe(200);
    const result = [...((follow.body.messages as { kind: string; payload: Json }[]) || [])]
      .reverse()
      .find((row) => row.kind === "task_result_card")?.payload;
    expect(result?.compose_loop).toBeTruthy();
    expect(String(result?.summary || "")).not.toMatch(/已按你的说明改了/);
  });

  it("updates the left thread and digest after a confirmed send", async () => {
    ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Could you share your rate card?",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-quote-2",
    });
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    const sid = String(opened.body.id);
    const posted = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写报价邮件 @数码老张 金额 680",
      intent: "email_compose",
      collaboration_id: "col_laozhang",
    });
    expect(posted.status, posted.text).toBe(200);
    const draft = (posted.body.messages as { kind: string; payload: Json }[])
      .find((row) => row.kind === "email_card")?.payload;
    expect(draft?.draft_id).toBeTruthy();
    const before = mailHistoryRows("col_laozhang").length;
    const sent = await confirmAndSendDraft(request, `/api/drafts/${draft?.draft_id}/send`, {});
    expect([200, 400, 403]).toContain(sent.status);
    if (sent.status === 200) {
      const after = mailHistoryRows("col_laozhang");
      expect(after.length).toBeGreaterThan(before);
      expect(after.some((row) => String(row.direction) === "outbound")).toBe(true);
      const digest = readThreadDigest("col_laozhang");
      expect(String(digest?.text || after[0]?.summary || "")).toMatch(/报价|680|quote|往来/i);
    }
  });

  function starryMailCalls() {
    const calls: string[] = [];
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        calls.push(name);
        if (name === "pageEmailConversations") {
          return { data: { list: [{ id: 8801, conversationId: 8801, subject: "Quote", recipientEmail: "zhang.digital@example.com" }] } };
        }
        if (name === "getEmailConversation") {
          return {
            data: {
              id: 8801,
              messages: [{ id: "m8801", direction: "inbound", body: "Please quote.", unread: true }],
            },
          };
        }
        if (name === "pageKolProfiles" || name === "listAllKolProfiles") return { data: { total: 0, list: [] } };
        return { data: {} };
      },
      async close() { /* noop */ },
    }));
    return calls;
  }

  it("pulls conversation mail once when opening a session twice quickly", async () => {
    const calls = starryMailCalls();
    const first = await request("POST", "/api/collaborations/col_laozhang/session", {});
    expect(first.status).toBe(200);
    await expect.poll(() => calls.filter((name) => name === "pageEmailConversations").length).toBe(1);
    calls.length = 0;
    const second = await request("POST", "/api/collaborations/col_laozhang/session", {});
    expect(second.status).toBe(200);
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);
    const sid = String(first.body.id);
    await syncKolSessionMail(sid, "col_laozhang");
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);
    await syncKolSessionMail(sid, "col_laozhang", { force: true });
    expect(calls.filter((name) => name === "pageEmailConversations").length).toBeGreaterThan(0);
  });

  it("refreshes the thread digest after inbound ingest, the reverse of send", async () => {
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-inbound-digest";
    setIntentLlmFetch(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        digest: "来信请品牌补充报价和下一步。",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Please share the collaboration quote and deliverables.",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-digest-reverse",
    });
    await expect.poll(() => readThreadDigest("col_laozhang")?.text).toBe("来信请品牌补充报价和下一步。");
    const again = ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Please share the collaboration quote and deliverables.",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-digest-reverse",
    });
    expect(again.duplicate).toBe(true);
  });

  it("does not pull Starry mail on compose, confirm-stage, send, or a plain session GET", async () => {
    const calls = starryMailCalls();
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    expect(opened.status).toBe(200);
    const sid = String(opened.body.id);
    await expect.poll(() => calls.filter((name) => name === "pageEmailConversations").length).toBe(1);
    calls.length = 0;

    const composed = await request("POST", `/api/sessions/${sid}/messages`, {
      text: "写报价邮件 @数码老张 金额 680",
      intent: "email_compose",
      collaboration_id: "col_laozhang",
    });
    expect(composed.status, composed.text).toBe(200);
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);

    const version = getConn().prepare("SELECT stage_version FROM collaborations WHERE id=?").get("col_laozhang") as { stage_version: number };
    const confirmed = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "QUOTE_PENDING",
      collaboration_id: "col_laozhang",
      expected_version: version.stage_version,
      reason: "仍停在报价待确认",
    });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);

    const loaded = await request("GET", `/api/sessions/${sid}`);
    expect(loaded.status).toBe(200);
    expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);

    const draft = (composed.body.messages as { kind: string; payload: Json }[])
      .find((row) => row.kind === "email_card")?.payload;
    if (draft?.draft_id) {
      const sent = await confirmAndSendDraft(request, `/api/drafts/${draft.draft_id}/send`, {});
      expect([200, 400, 403]).toContain(sent.status);
      expect(calls.filter((name) => name === "pageEmailConversations")).toHaveLength(0);
    }
  });

  it("does not refresh digest on confirm-stage or duplicate inbound", async () => {
    process.env.INTENT_LLM_MODE = "real";
    process.env.OPENAI_API_KEY = "sk-test-digest-reverse-skip";
    let llmCalls = 0;
    setIntentLlmFetch(async () => {
      llmCalls += 1;
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ digest: "来信请品牌补充报价。" }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const ingested = ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Please share the collaboration quote.",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-digest-skip",
    });
    await expect.poll(() => readThreadDigest("col_laozhang")?.text).toBe("来信请品牌补充报价。");
    const afterIngest = llmCalls;
    expect(afterIngest).toBeGreaterThan(0);

    const sid = String(ingested.session_id);
    const version = getConn().prepare("SELECT stage_version FROM collaborations WHERE id=?").get("col_laozhang") as { stage_version: number };
    const confirmed = await request("POST", `/api/sessions/${sid}/confirm-stage`, {
      stage_code: "QUOTE_PENDING",
      collaboration_id: "col_laozhang",
      expected_version: version.stage_version,
      reason: "仍停在报价待确认",
    });
    expect(confirmed.status, confirmed.text).toBe(200);
    ingestKolMail("col_laozhang", {
      subject: "Re: rates",
      body: "Please share the collaboration quote.",
      from: "zhang.digital@example.com",
      to: "larry.zhao@amperetime.com",
      mailbox: "larry.zhao@amperetime.com",
      direction: "inbound",
      provider_message_id: "in-digest-skip",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(llmCalls).toBe(afterIngest);
    expect(readThreadDigest("col_laozhang")?.text).toBe("来信请品牌补充报价。");
  });

  it("opens a session without waiting for Starry and streams mail into the journey", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setStarryKolClientFactory(() => ({
      async callTool(name: string) {
        if (name === "pageEmailConversations") {
          await gate;
          return { data: { list: [{ id: 9901, conversationId: 9901, subject: "Sync later", recipientEmail: "zhang.digital@example.com" }] } };
        }
        if (name === "getEmailConversation") {
          return {
            data: {
              id: 9901,
              messages: [{ id: "m9901", direction: "inbound", body: "Please quote when ready.", unread: true }],
            },
          };
        }
        return { data: {} };
      },
      async close() { /* noop */ },
    }));
    const opened = await request("POST", "/api/collaborations/col_laozhang/session", {});
    expect(opened.status).toBe(200);
    expect((opened.body.journey as Json)?.mail_sync_pending).toBe(true);
    const sid = String(opened.body.id);
    const waiting = await request("GET", `/api/sessions/${sid}`);
    expect((waiting.body.journey as Json)?.mail_sync_pending).toBe(true);
    release();
    await expect.poll(async () => {
      const row = await request("GET", `/api/sessions/${sid}`);
      return (row.body.journey as Json)?.mail_sync_pending;
    }).toBe(false);
    const done = await request("GET", `/api/sessions/${sid}`);
    const history = ((done.body.journey as Json)?.mail_history || []) as Json[];
    expect(history.length).toBeGreaterThan(0);
    expect(history.some((row) => String(row.subject || "").includes("Sync later") || String(row.snippet || "").includes("quote"))).toBe(true);
  });
});
