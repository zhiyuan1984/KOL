/** Versioned, business-neutral review contract. IDs are stable across layout edits. */
export type ReviewField = {
  id: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "decimal"
    | "money"
    | "date"
    | "select"
    | "multiselect"
    | "attachment";
  required: boolean;
  options?: string[];
  numeric?: { precision: number; scale: number; min?: string; max?: string };
  currencies?: string[];
  currencySource?: string;
};
export type ReviewMoney = { amount: string; currency: string };
export type ReviewPredicate = {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains";
  value: string | number | ReviewMoney;
};
export type ReviewCondition =
  | ReviewPredicate
  | { op: "all"; conditions: ReviewCondition[] }
  | { op: "any"; conditions: ReviewCondition[] }
  | { op: "not"; condition: ReviewCondition };
export type ReviewAssignee =
  | { kind: "named"; userIds: string[] }
  | { kind: "manager" }
  | { kind: "role"; role: string };
export type ReviewOperations = {
  transfer?: { candidates: ReviewAssignee; deadline: "preserve" | "reset" };
  countersign?: { candidates: ReviewAssignee };
  amendment?: { fields: string[]; restart: "start" };
  timeout?:
    | { action: "remind" }
    | { action: "transfer"; candidates: ReviewAssignee; deadline: "reset" };
};
export type ReviewNode = {
  id: string;
  name: string;
  type: "start" | "review" | "condition" | "end" | "cc" | "consult" | "handler";
  next?: string;
  otherwise?: string;
  condition?: ReviewCondition;
  assignee?: ReviewAssignee;
  operations?: ReviewOperations;
  mode?: "single" | "all" | "any" | "sequential";
  reject?: "any_reject" | "all_reject";
  timeoutHours?: number;
  x?: number;
  y?: number;
};
export type ReviewDefinition = {
  schema: "review.definition.v1";
  name: string;
  description: string;
  fields: ReviewField[];
  nodes: ReviewNode[];
};
export type ReviewTask = {
  id?: string;
  round?: number;
  assignmentSource?: "default" | "transfer" | "countersign" | "timeout";
  duty?: "review" | "cc" | "consult" | "handler";
  replacedTaskId?: string;
  nodeId: string;
  userId: string;
  status:
    | "waiting"
    | "pending"
    | "approved"
    | "rejected"
    | "cancelled"
    | "transferred"
    | "suspended"
    | "superseded"
    | "completed";
  reason?: string;
  decidedAt?: string;
  dueAt?: string;
};
export type ReviewInstance = {
  id: string;
  templateId: string;
  templateVersion: number;
  version: number;
  requester: string;
  title: string;
  definition: ReviewDefinition;
  values: Record<string, unknown>;
  currentNode: string;
  status:
    | "reviewing"
    | "approved"
    | "rejected"
    | "withdrawn"
    | "blocked"
    | "awaiting_amendment";
  round?: number;
  amendment?: { fields: string[]; reason: string; requestedBy: string };
  blockedReason?: string;
  tasks: ReviewTask[];
  createdAt: string;
  updatedAt: string;
};
export type ReviewTemplate = {
  enabled?: boolean;
  lifecycleVersion?: number;
  id: string;
  version: number;
  publishedVersion: number | null;
  definition: ReviewDefinition;
  updatedAt: string;
};
export type ReviewDraft = {
  id: string;
  version: number;
  templateId: string;
  templateVersion: number;
  title: string;
  values: Record<string, unknown>;
  updatedAt: string;
};
export type ReviewCommand =
  | {
      action: "submit";
      templateId: string;
      templateVersion: number;
      title: string;
      values: Record<string, unknown>;
      draft?: { id: string; version: number };
    }
  | {
      action:
        | "approve"
        | "reject"
        | "withdraw"
        | "retry"
        | "request_amendment"
        | "complete";
      instanceId: string;
      expectedVersion: number;
      reason: string;
    }
  | {
      action: "transfer" | "countersign";
      instanceId: string;
      expectedVersion: number;
      reason: string;
      targetUserId: string;
    }
  | {
      action: "resubmit";
      instanceId: string;
      expectedVersion: number;
      reason: string;
      values: Record<string, unknown>;
    }
  | {
      action: "enable";
      templateId: string;
      expectedVersion: number;
      expectedLifecycleVersion: number;
    }
  | {
      action: "disable";
      templateId: string;
      expectedVersion: number;
      expectedLifecycleVersion: number;
    }
  | { action: "publish"; templateId: string; expectedVersion: number };
export type ReviewIssue = { path: string; message: string };
export function emptyReviewDefinition(): ReviewDefinition {
  return {
    schema: "review.definition.v1",
    name: "新评审流程",
    description: "",
    fields: [],
    nodes: [
      { id: "start", name: "发起", type: "start", next: "review", x: 0, y: 0 },
      {
        id: "review",
        name: "负责人评审",
        type: "review",
        assignee: { kind: "manager" },
        mode: "single",
        reject: "any_reject",
        next: "end",
        x: 0,
        y: 1,
      },
      { id: "end", name: "结束", type: "end", x: 0, y: 2 },
    ],
  };
}
