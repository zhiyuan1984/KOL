/**
 * 结果卡片的声明式展示：标题与下一步动作来自技能 md（result_title / next_actions），
 * 不再按技能 ID 在代码里写死。没声明时返回 null，由调用方保留原有兜底。
 */
import { taskDefinition } from "./registry.js";

export function declaredResultTitle(skillId: string): string | undefined {
  const definition = taskDefinition(skillId);
  return definition?.result_title || definition?.title;
}

/** 按结果是否有数据筛出员工可见的下一步动作文案；技能没声明 next_actions 时返回 null。 */
export function declaredNextActionLabels(skillId: string, context: { hasResults: boolean; hasSelection?: boolean }): string[] | null {
  const actions = taskDefinition(skillId)?.next_actions;
  if (!actions?.length) return null;
  const labels = actions
    .filter((action) => action.when === "always"
      || (action.when === "has_results" && context.hasResults)
      || (action.when === "no_results" && !context.hasResults)
      || (action.when === "has_selection" && Boolean(context.hasSelection)))
    .map((action) => {
      if (action.note) return action.note;
      const target = action.action_id.startsWith("skill:") ? taskDefinition(action.action_id.slice(6)) : undefined;
      return target?.title || action.action_id;
    })
    .filter(Boolean);
  return [...new Set(labels)];
}
