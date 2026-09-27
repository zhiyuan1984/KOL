import { describe, expect, it } from "vitest";
import { skillFillText } from "./skillFill";

describe("skillFillText", () => {
  it("fills only the starter line, keeping the skill summary out of the ask box", () => {
    expect(skillFillText({
      id: "creator_outreach",
      title: "达人建联话术",
      summary: "生成首轮私信、跟进和加微信话术。",
    })).toBe("达人建联话术 [达人昵称或主页]");
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

  it("prefers a skill template starter over the legacy registry", () => {
    expect(skillFillText({
      id: "creator_library_query",
      title: "达人库查询",
      ui_template: {
        id: "skill-template:creator_library_query",
        kind: "skill_template",
        skill_id: "creator_library_query",
        version: "hash-1",
        title: "达人库查询",
        description: "检索当前授权范围。",
        steps: [],
        inputs: [],
        starter: "达人库查询",
        output: { type: "list", title: "达人列表" },
        constraints: [],
        source: "skill",
        read_only: true,
      },
    })).toBe("达人库查询");
  });
});
