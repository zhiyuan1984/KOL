import type { ReviewNode, ReviewTask } from "../../../shared/review.js";
import type { ReviewContext } from "./review-service.js";
import { taskPolicy } from "./review-operations.js";

/** One authority policy for both generic and knowledge publication reviews. */
export function reviewResolver(ctx: ReviewContext) {
  return (node: ReviewNode, requester: string, task?: ReviewTask): string[] => {
    const assignee = taskPolicy(node, task);
    if (!assignee) return [];
    const ids =
      assignee.kind === "named"
        ? assignee.userIds
        : assignee.kind === "role"
          ? ctx.people
              .filter((p) => p.roles?.includes(assignee.role))
              .map((p) => p.id)
          : ctx.people.find((p) => p.id === requester)?.managerIds || [];
    if (ids.some((id) => !ctx.people.some((p) => p.id === id))) return [];
    return ids;
  };
}
