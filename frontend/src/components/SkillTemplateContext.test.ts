import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SkillTemplate } from "../api";
import SkillTemplateContext from "./SkillTemplateContext";

const template: SkillTemplate = {
  id: "skill-template:creator_library_query", kind: "skill_template", skill_id: "creator_library_query", version: "version-1",
  title: "达人库查询", description: "按授权范围查询达人", steps: ["确认筛选条件", "读取达人档案", "呈现真实结果"],
  inputs: [{ key: "keyword", label: "关键词", kind: "text", required: false }], starter: "达人库查询",
  output: { type: "task_result", title: "达人列表" }, constraints: ["只读，不发信"], source: "skill", read_only: true,
};

describe("middle-column skill template context", () => {
  it("shows the snapshot's purpose, planned steps and output separately from live progress", () => {
    const html = renderToStaticMarkup(createElement(SkillTemplateContext, { template }));
    expect(html).toContain('data-skill-template-version="version-1"');
    for (const copy of ["功能", "按授权范围查询达人", "预计执行步骤", ...template.steps, "输出说明", "达人列表", "只读，不发信"]) expect(html).toContain(copy);
    expect(html).not.toContain("正在查询");
    expect(html).not.toContain("已完成");
  });

  it("does not invent execution steps for a legacy template", () => {
    const html = renderToStaticMarkup(createElement(SkillTemplateContext, { template: { ...template, steps: [] } }));
    expect(html).toContain("步骤未登记");
    expect(html).toContain("无需必填参数");
    expect(html).not.toContain("确认筛选条件");
  });

  it("hides duplicated optional-field summaries when a parameter editor is present", () => {
    const html = renderToStaticMarkup(createElement(SkillTemplateContext, { template, showOptionalInputs: false }));
    expect(html).not.toContain("data-skill-template-optional");
    expect(html).toContain("无需必填参数");
  });
});
