import { describe, expect, it } from "vitest";
import { groupSkills, isWriteSkill, matchesSkillQuery, skillGroupOf } from "./catalog";

describe("composer skill catalog", () => {
  it("marks write skills as needing confirmation", () => {
    expect(isWriteSkill({ id: "email_compose", title: "写合作邮件" })).toBe(true);
    expect(isWriteSkill({ id: "creator_contact_decrypt", title: "解密达人联系方式" })).toBe(true);
    expect(isWriteSkill({ id: "confirm_stage", title: "提出阶段变更" })).toBe(true);
    expect(isWriteSkill({ id: "creator_library_sync", title: "达人同步入库" })).toBe(true);
    expect(isWriteSkill({ id: "creator_owner_update", title: "更新红人负责人" })).toBe(true);
    expect(isWriteSkill({ id: "creator_profile", title: "达人画像" })).toBe(false);
  });

  it("groups skills into the locked IA buckets", () => {
    const groups = groupSkills([
      { id: "creator_discovery", title: "达人发现" },
      { id: "creator_profile", title: "达人画像" },
      { id: "stage_sop", title: "阶段 SOP" },
      { id: "email_compose", title: "写合作邮件" },
      { id: "misc_note", title: "备忘" },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["discover", "profile", "follow", "mail", "other"]);
    expect(skillGroupOf({ id: "reply_analysis", title: "回复分析" })).toBe("mail");
  });

  it("filters the searchable skill list", () => {
    const skill = { id: "email_compose", title: "写合作邮件", aliases: ["coop"] };
    expect(matchesSkillQuery(skill, "合作")).toBe(true);
    expect(matchesSkillQuery(skill, "coop")).toBe(true);
    expect(matchesSkillQuery(skill, "画像")).toBe(false);
  });
});
