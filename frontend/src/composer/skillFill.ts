import { starterPrompt } from "../taskStarters";
import type { SkillTemplate } from "../api";

export type FillableSkill = {
  id: string;
  title: string;
  label?: string;
  summary?: string;
  ui_template?: SkillTemplate | null;
};

/**
 * 技能卡「填入输入框」的正文。
 *
 * 只复用任务模板同源的起始行（优先 SKILL.md `ui_template.starter`）。
 * 技能说明留在交互上下文中，不复制进员工正在编辑的请求正文。
 */
export function skillFillText(skill: FillableSkill): string {
  const label = String(skill.label || skill.title || "").trim();
  return starterPrompt({ id: skill.id, prompt: label, title: label, ui_template: skill.ui_template });
}
