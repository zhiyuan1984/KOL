import { describe, expect, it } from "vitest";
import { emailMcpResultCard } from "../src/starrykol/service.js";
import {
  analyzeCreatorProfile,
  profileBriefingFromFacts,
  profileFactsForModel,
} from "../src/starrykol/profile-briefing.js";
import { collectStarryKolItems } from "../src/worker/session-items.js";

process.env.CODEX_MODE = "stub";

const QQ_DETAIL = {
  id: 4,
  brandId: 1,
  kolName: "测试网红-qq-01",
  languageKey: "EN_US",
  contactEmailMasked: "1***@qq.com",
  cooperationStageCode: "DELIVERED_TESTING",
  riskTagCode: "CONTENT_RISK",
  followType: "MANUAL",
  crawlerSyncStatus: "PENDING_SUPPLEMENT",
  remark: "待补充",
  updateTime: "2026-09-02 07:52:19",
  kolId: 273,
};

describe("creator profile briefing", () => {
  it("turns Starry codes into operator copy instead of 这项信息", () => {
    const facts = profileFactsForModel(QQ_DETAIL);
    expect(facts).toMatchObject({
      name: "测试网红-qq-01",
      stage: "已签收-测试中",
      risk: "内容风险",
      language: "英语",
      email_masked: "1***@qq.com",
      sync: "待补充",
    });
    const briefing = profileBriefingFromFacts(QQ_DETAIL);
    expect(briefing.briefing).toContain("测试网红-qq-01");
    expect(briefing.briefing).toContain("已签收-测试中");
    expect(briefing.briefing).toContain("1***@qq.com");
    expect(briefing.briefing).toContain("待补充");
    expect(briefing.briefing).not.toMatch(/这项信息|摘要数据|MCP|Codex/);
    expect(briefing.summary).toContain("测试网红-qq-01");
  });

  it("paints 画像说明 and never dumps 摘要数据", () => {
    const card = emailMcpResultCard("creator_profile", QQ_DETAIL);
    const sections = JSON.stringify(card.sections);
    expect(card.title).toBe("达人画像");
    expect(sections).toContain("画像说明");
    expect(sections).toContain("已签收-测试中");
    expect(sections).not.toContain("这项信息");
    expect(sections).not.toContain("摘要数据");
    expect(sections).not.toContain("DELIVERED_TESTING");
    expect(String(card.summary)).toContain("测试网红-qq-01");
    expect(card.recommended_actions).toEqual([
      "写合作邮件 @测试网红-qq-01",
      "更新红人负责人",
    ]);
  });

  it("analyzeCreatorProfile stays on facts copy when Codex is stubbed", async () => {
    const analyzed = await analyzeCreatorProfile(QQ_DETAIL);
    expect(analyzed.briefing_source).toBe("facts");
    expect(analyzed.briefing).toContain("已签收-测试中");
    expect(analyzed.briefing).not.toMatch(/这项信息|摘要数据|DELIVERED_TESTING/);
  });

  it("collectStarryKolItems paints 画像说明 for a stub profile", async () => {
    const { items } = await collectStarryKolItems({
      task: "creator_profile",
      raw: "达人画像 达人 UID KOLTEST001",
      entities: { kolUid: "KOLTEST001" },
    });
    const card = items.find((item) => item.type === "task_result") || {};
    const sections = JSON.stringify(card.sections || []);
    expect(card.title).toBe("达人画像");
    expect(sections).toContain("画像说明");
    expect(sections).toContain("户外电源达人");
    expect(sections).not.toContain("这项信息");
    expect(sections).not.toContain("摘要数据");
  });

  it("looks up 测试网红-qq-01 and writes human stage copy", async () => {
    const { items } = await collectStarryKolItems({
      task: "creator_profile",
      raw: "达人画像 测试网红-qq-01",
      entities: { handle: "测试网红-qq-01" },
    });
    const card = items.find((item) => item.type === "task_result") || {};
    const sections = JSON.stringify(card.sections || []);
    expect(sections).toContain("画像说明");
    expect(sections).toContain("测试网红-qq-01");
    expect(sections).toContain("已签收-测试中");
    expect(sections).toContain("1***@qq.com");
    expect(sections).not.toContain("这项信息");
    expect(sections).not.toContain("摘要数据");
    expect(sections).not.toContain("DELIVERED_TESTING");
    expect(String(card.summary)).toContain("测试网红-qq-01");
  });
});
