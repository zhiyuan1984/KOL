import { describe, expect, it } from "vitest";
import { skillFillText } from "./skillFill";

describe("skillFillText", () => {
  it("fills the starter line and the skill's own summary", () => {
    expect(skillFillText({
      id: "creator_outreach",
      title: "达人建联话术",
      summary: "生成首轮私信、跟进和加微信话术。",
    })).toBe("达人建联话术 [达人昵称或主页]\n生成首轮私信、跟进和加微信话术。");
  });

  it("prefers the skill label over the title", () => {
    expect(skillFillText({
      id: "creator_profile",
      title: "达人画像技能",
      label: "达人画像",
    })).toBe("达人画像 [达人昵称或主页]");
  });

  it("falls back to the label for a skill without a registered starter", () => {
    expect(skillFillText({ id: "sop_published", title: "已发布阶段 SOP" })).toBe("已发布阶段 SOP");
  });

  it("does not repeat a summary the starter line already carries", () => {
    expect(skillFillText({
      id: "not_a_registered_skill",
      title: "未登记技能",
      summary: "未登记技能",
    })).toBe("未登记技能");
  });
});
