import type { ReviewNode, ReviewTask, ReviewChoices, ReviewAssigneeRule } from "../../../shared/review.js";
import type { ReviewContext } from "./review-service.js";
import { taskPolicy } from "./review-operations.js";

/** One authority policy for both generic and knowledge publication reviews. */
export function reviewCandidates(ctx: ReviewContext, rule: ReviewAssigneeRule, requester: string): string[] {
  const ids = rule.kind === "named" ? rule.userIds : rule.kind === "role"
    ? ctx.people.filter(p => p.roles?.includes(rule.role)).map(p => p.id)
    : ctx.people.find(p => p.id === requester)?.managerIds || [];
  return ids.every(id => ctx.people.some(p => p.id === id)) ? ids : [];
}
export function reviewResolver(ctx: ReviewContext, choices: ReviewChoices = {}) {
  return (node: ReviewNode, requester: string, task?: ReviewTask): string[] => {
    const assignee = taskPolicy(node, task);
    if (!assignee) return [];
    if (assignee.kind !== "requester_choice") return reviewCandidates(ctx, assignee, requester);
    const pool = reviewCandidates(ctx, assignee.candidates, requester).filter(id => id !== requester);
    const selected = choices[node.id] || [];
    return selected.length && selected.every(id => pool.includes(id)) ? selected : [];
  };
}
