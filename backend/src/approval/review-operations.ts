import { randomUUID } from "node:crypto";
import type {
  ReviewInstance,
  ReviewTask,
  ReviewNode,
  ReviewCommand,
} from "../../../shared/review.js";
import { advanceReview, type ResolveReviewers } from "./review-engine.js";

export const REVIEW_ACTIONS = [
  "submit",
  "publish",
  "enable",
  "disable",
  "approve",
  "reject",
  "withdraw",
  "retry",
  "transfer",
  "countersign",
  "request_amendment",
  "resubmit",
  "complete",
];
export function currentTasks(i: ReviewInstance) {
  return i.tasks.filter(
    (t) => t.nodeId === i.currentNode && (t.round || 1) === (i.round || 1),
  );
}
export function normalizeTasks(i: ReviewInstance): ReviewInstance {
  i.round ||= 1;
  i.tasks.forEach((t, index) => {
    t.id ||= `${i.id}:task:${index}`;
    t.round ||= 1;
    t.assignmentSource ||= "default";
  });
  return i;
}
export function taskPolicy(node: ReviewNode, task?: ReviewTask) {
  const source = task?.assignmentSource;
  return source === "transfer"
    ? node.operations?.transfer?.candidates
    : source === "countersign"
      ? node.operations?.countersign?.candidates
      : source === "timeout" && node.operations?.timeout?.action === "transfer"
        ? node.operations.timeout.candidates
        : node.assignee;
}
export function reassignTask(
  i: ReviewInstance,
  task: ReviewTask,
  target: string,
  source: "transfer" | "timeout",
  now: string,
) {
  const node = i.definition.nodes.find((n) => n.id === i.currentNode)!;
  const deadline =
    source === "timeout" ? "reset" : node.operations?.transfer?.deadline;
  const replacement: ReviewTask = {
    id: randomUUID(),
    round: i.round || 1,
    nodeId: task.nodeId,
    userId: target,
    status: "pending",
    assignmentSource: source,
    replacedTaskId: task.id,
    ...(task.dueAt
      ? {
          dueAt:
            deadline === "reset" && node.timeoutHours
              ? new Date(
                  Date.parse(now) + node.timeoutHours * 3600000,
                ).toISOString()
              : task.dueAt,
        }
      : {}),
  };
  task.status = "transferred";
  task.decidedAt = now;
  i.tasks.splice(i.tasks.indexOf(task) + 1, 0, replacement);
}
export function applyReviewOperation(
  i: ReviewInstance,
  command: Extract<ReviewCommand, { instanceId: string }>,
  actor: string,
  resolve: ResolveReviewers,
  now: string,
) {
  normalizeTasks(i);
  const task = currentTasks(i).find(
    (t) => t.userId === actor && t.status === "pending",
  );
  const node = i.definition.nodes.find((n) => n.id === i.currentNode)!;
  if (command.action === "complete") {
    task!.status = "completed";
    task!.reason = command.reason;
    task!.decidedAt = now;
    const tasks = currentTasks(i).filter(
      (t) => !["transferred", "superseded", "cancelled"].includes(t.status),
    );
    if (node.mode === "any" || tasks.every((t) => t.status === "completed")) {
      tasks.forEach((t) => {
        if (["pending", "waiting"].includes(t.status)) t.status = "cancelled";
      });
      advanceReview(i, node.next!, resolve, now);
    } else if (node.mode === "sequential") {
      const next = tasks.find((t) => t.status === "waiting");
      if (next) {
        next.status = "pending";
        if (node.timeoutHours)
          next.dueAt = new Date(
            Date.parse(now) + node.timeoutHours * 3600000,
          ).toISOString();
      }
    }
  } else if (command.action === "transfer") {
    reassignTask(i, task!, command.targetUserId, "transfer", now);
    task!.reason = command.reason;
  } else if (command.action === "countersign") {
    const extra: ReviewTask = {
      id: randomUUID(),
      round: i.round,
      nodeId: i.currentNode,
      userId: command.targetUserId,
      status: node.mode === "sequential" ? "waiting" : "pending",
      assignmentSource: "countersign",
      ...(node.mode !== "sequential" && task?.dueAt
        ? { dueAt: task.dueAt }
        : {}),
    };
    i.tasks.splice(i.tasks.indexOf(task!) + 1, 0, extra);
  } else if (command.action === "request_amendment") {
    i.status = "awaiting_amendment";
    i.amendment = {
      fields: [...node.operations!.amendment!.fields],
      reason: command.reason,
      requestedBy: actor,
    };
    currentTasks(i).forEach((t) => {
      if (["pending", "waiting"].includes(t.status)) t.status = "suspended";
    });
  } else if (command.action === "resubmit") {
    i.tasks.forEach((t) => {
      if (["pending", "waiting", "suspended"].includes(t.status))
        t.status = "superseded";
    });
    i.round!++;
    i.values = structuredClone(command.values);
    delete i.amendment;
    delete i.blockedReason;
    advanceReview(
      i,
      i.definition.nodes.find((n) => n.type === "start")!.id,
      resolve,
      now,
    );
  }
}
