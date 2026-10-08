import type { ReviewInstance, ReviewProgress } from "../../../shared/review.js";

/** Derived from recorded tasks and the frozen path, never from UI state or colors. */
export function reviewProgress(i: ReviewInstance): ReviewProgress {
  const node = i.definition.nodes.find(n => n.id === i.currentNode);
  const tasks = i.tasks.filter(t => (t.round || 1) === (i.round || 1));
  const cancelled = i.status === "withdrawn" || i.status === "rejected";
  const handled = tasks.some(t => t.duty === "handler");
  const handling = node?.type === "handler" && ["reviewing", "blocked"].includes(i.status);
  // Approval remains pending if a later approval node can still be reached.
  const seen = new Set<string>();
  const hasReviewAfter = (id?: string): boolean => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    const next = i.definition.nodes.find(n => n.id === id);
    return next?.type === "review" || Boolean(next && (hasReviewAfter(next.next) || hasReviewAfter(next.otherwise)));
  };
  const approval = i.status === "rejected" ? "rejected" : i.status === "withdrawn" ? "withdrawn"
    : i.status === "approved" || (handling && !hasReviewAfter(node?.next) && tasks.some(t => t.duty === "review" && t.status === "approved")) ? "approved" : "pending";
  return {
    approval,
    fulfillment: cancelled ? handled ? "cancelled" : "none" : handling ? "handling" : i.status === "approved" ? handled ? "completed" : "none"
      : i.definition.nodes.some(n => n.type === "handler") ? "pending" : "none",
    currentResponsibility: i.status === "awaiting_amendment" ? "补充申请材料" : node?.type === "handler" ? "办理事项并登记完成证据"
      : node?.type === "consult" ? "核对材料并提交意见" : i.status === "reviewing" ? "核对材料并作出审批决定" : "查看处理结果",
  };
}
