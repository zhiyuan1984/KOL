import { starterPrompt } from "../taskStarters";

export type FillableSkill = {
  id: string;
  title: string;
  label?: string;
  summary?: string;
};

/**
 * 技能卡「填入输入框」的正文。
 *
 * 第一行复用任务模板同源的起始行（`taskStarters.STARTERS`），带 `[待补参数]` 占位，
 * 员工补完即可发送；第二行是这项技能自己的说明（技能目录里本来就展示的那一句）。
 * 两者都取自仓库既有文案——不为填满输入框编造技能内容。
 */
export function skillFillText(skill: FillableSkill): string {
  const label = String(skill.label || skill.title || "").trim();
  const head = starterPrompt({ id: skill.id, prompt: label, title: label });
  const detail = String(skill.summary || "").trim();
  if (!detail || head.includes(detail)) return head;
  return `${head}\n${detail}`;
}
