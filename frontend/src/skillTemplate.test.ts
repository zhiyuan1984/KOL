import { describe, expect, it } from "vitest";
import type { SkillTemplate } from "./api";
import {
  NO_REQUIRED_INPUTS_COPY,
  defaultTemplateValues,
  nonEmptyTemplateEntities,
  templateForSkill,
  templateQuestionDraft,
  templateStarter,
} from "./skillTemplate";

const template: SkillTemplate = {
  id: "skill-template:creator_library_query",
  kind: "skill_template",
  skill_id: "creator_library_query",
  version: "hash-1",
  title: "达人库查询",
  description: "检索当前授权可见的达人资料。",
  steps: [],
  inputs: [
    { key: "keyword", label: "关键词", kind: "text", required: false },
    { key: "page_no", label: "页码", kind: "number", default: 1 },
    { key: "page_size", label: "每页数量", kind: "number", default: 20 },
  ],
  starter: "达人库查询",
  output: { type: "list", title: "匹配的达人列表" },
  constraints: [],
  source: "skill",
  read_only: true,
};

describe("skill interaction template", () => {
  it("uses the skill template starter and keeps a zero-required request concise", () => {
    expect(templateStarter(template)).toBe("达人库查询");
    expect(template.inputs.some((field) => field.required)).toBe(false);
    expect(NO_REQUIRED_INPUTS_COPY).toContain("无需必填参数");
  });

  it("derives only required fields without defaults when a legacy template has no starter", () => {
    expect(templateStarter({
      ...template,
      starter: "",
      inputs: [
        { key: "brand", label: "品牌", kind: "text", required: true },
        { key: "page_size", label: "每页数量", kind: "number", required: true, default: 20 },
        { key: "risk", label: "风险标签", kind: "text" },
      ],
    })).toBe("达人库查询\n品牌：[品牌]");
  });

  it("uses an inline authorized projection before the template list and never submits blank values", () => {
    expect(templateForSkill({ id: template.skill_id, ui_template: template }, [{ ...template, version: "old" }])).toBe(template);
    expect(defaultTemplateValues(template.inputs)).toEqual({ page_no: 1, page_size: 20 });
    expect(nonEmptyTemplateEntities(template.inputs, {
      keyword: "",
      page_no: 0,
      page_size: 20,
    })).toEqual({ page_no: 0, page_size: 20 });
  });

  it("does not send untouched defaults ahead of natural-language parameters", () => {
    const values = { ...defaultTemplateValues(template.inputs), keyword: "露营" };
    expect(nonEmptyTemplateEntities(template.inputs, values, new Set(["keyword"]))).toEqual({ keyword: "露营" });
    expect(nonEmptyTemplateEntities(template.inputs, values, new Set())).toEqual({});
  });

  it("keeps an explicitly edited default value, so the employee can override extraction", () => {
    expect(nonEmptyTemplateEntities(template.inputs, { page_size: 20 }, new Set(["page_size"]))).toEqual({ page_size: 20 });
  });

  it("never borrows the template of a different skill", () => {
    expect(templateForSkill({ id: "creator_profile", ui_template: template }, [template])).toBeNull();
  });

  it("opens a KB template as a draft, not as an executable or mail knowledge reference", () => {
    const draft = templateQuestionDraft(template);
    expect(draft.text).toBe("达人库查询");
    expect(draft.skill_template).toEqual(template);
    expect(draft.chips).toEqual([{ kind: "skill", id: "creator_library_query", label: "达人库查询" }]);
    expect(draft).not.toHaveProperty("knowledge_id");
    expect(draft).not.toHaveProperty("pending_message");
    expect(draft.text).not.toContain(template.description);
  });
});
