import { describe, expect, it } from "vitest";
import {
  isResultRevision,
  lastUnsentResult,
  mergeReviseFields,
  snapshotFromCards,
  stubReviseFields,
  type LastUnsentResult,
} from "../src/host/result-revise.js";

function last(skill = "email_compose"): LastUnsentResult {
  return {
    skill,
    snapshot: {
      skill,
      handle: "数码老张",
      collaboration_id: "col_laozhang",
      from: "larry.zhao@amperetime.com",
      to: "zhang.digital@example.com",
      subject: "Quote",
      body: "The collaboration quote is 680 USD.",
      amount_usd: 680,
    },
    card: { skill, title: "邮件草稿" },
    handle: "数码老张",
    collaboration_id: "col_laozhang",
    draft_id: "dft_1",
    sent: false,
  };
}

describe("result revise classification", () => {
  it("treats a field tweak as a supplement of the unsent result", () => {
    expect(isResultRevision("把金额改成 720", last())).toBe(true);
    expect(isResultRevision("主题：Updated quote", last())).toBe(true);
    expect(isResultRevision("语气更正式一点", last())).toBe(true);
  });

  it("treats chips, another letter, send, and skill aliases as a new task", () => {
    const row = last();
    expect(isResultRevision("把金额改成 720", row, { lockedIntent: "email_compose" })).toBe(false);
    expect(isResultRevision("再写一封", row)).toBe(false);
    expect(isResultRevision("确认发送", row)).toBe(false);
    expect(isResultRevision("写跟进 @数码老张", row)).toBe(false);
    expect(isResultRevision("记状态 @数码老张", row)).toBe(false);
    expect(isResultRevision("重写一封", row)).toBe(false);
    expect(isResultRevision("把金额改成 720", row, { boundTask: true })).toBe(false);
    expect(isResultRevision("把金额改成 720 @小美妆日记", row)).toBe(false);
    expect(isResultRevision("把金额改成 720", null)).toBe(false);
  });
});

describe("result revise merge", () => {
  it("only overwrites named fields and can patch the amount in the body", () => {
    const snap = last().snapshot;
    const fields = stubReviseFields("把金额改成 720", snap);
    expect(fields.amount_usd).toBe(720);
    const { next, changed } = mergeReviseFields(snap, fields);
    expect(changed).toContain("amount_usd");
    expect(next.amount_usd).toBe(720);
    expect(next.from).toBe("larry.zhao@amperetime.com");
    expect(next.to).toBe("zhang.digital@example.com");
    expect(next.subject).toBe("Quote");
    expect(String(next.body)).toContain("720");
    expect(String(next.body)).not.toContain("680");
  });

  it("inserts a missing price into an outreach draft instead of leaving the body unchanged", () => {
    const fields = stubReviseFields("报价邮件草稿金额未写明，请在草稿里补上价格5000美金1小时", {
      skill: "email_compose",
      handle: "数码老张",
      body: "I hope you’re having a wonderful day! I wanted to reach out about our partnership.\n\nBest,\nLiTime Creator Desk\n",
      body_zh_internal: "建联热情问候。",
      amount_usd: null,
    });
    expect(fields.amount_usd).toBe(5000);
    expect(String(fields.body)).toMatch(/USD 5000/);
    expect(String(fields.body)).toMatch(/USD 5000 per hour/);
    expect(String(fields.body_zh_internal)).toMatch(/5000/);
  });

  it("reads the last unsent result card", () => {
    const rows = [
      { kind: "me", payload: { text: "写报价邮件" } },
      {
        kind: "task_result_card",
        payload: {
          skill: "email_compose",
          title: "邮件草稿",
          starrykol_data: { from: "a@brand.com", to: "b@x.com", subject: "Hi", body: "Hello 680", amount_usd: 680 },
          compose_loop: { amount_usd: 680 },
        },
      },
      { kind: "email_card", payload: { draft_id: "dft_x", from: "a@brand.com", to: "b@x.com", subject: "Hi", body: "Hello 680", amount_usd: 680 } },
    ];
    const found = lastUnsentResult(rows);
    expect(found?.skill).toBe("email_compose");
    expect(found?.snapshot.amount_usd).toBe(680);
    expect(snapshotFromCards(rows[1].payload, rows[2].payload).from).toBe("a@brand.com");
  });
});
