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
export type ReviewAssigneeRule =
  | { kind: "named"; userIds: string[] }
  | { kind: "manager" }
  | { kind: "role"; role: string };
export type ReviewAssignee = ReviewAssigneeRule
  | { kind: "requester_choice"; candidates: ReviewAssigneeRule };
export type ReviewChoices = Record<string, string[]>;
export type ReviewSource = { type: "collaboration"; id: string; version: string; label: string; snapshot: { handle: string; brand: string; stage: string; notes: string } };
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
  /** Authoring ownership only; never grants access or changes reviewer resolution. */
  organizationUnitId?: string;
  subjectType?: "knowledge_publication";
  name: string;
  description: string;
  fields: ReviewField[];
  nodes: ReviewNode[];
};
export type ReviewOrganizationContext = {
  units: { id: string; name: string; parentId: string | null }[];
  defaultUnitId?: string;
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
  source?: ReviewSource;
  id: string;
  templateId: string;
  templateVersion: number;
  version: number;
  requester: string;
  title: string;
  definition: ReviewDefinition;
  values: Record<string, unknown>;
  selectedApprovers?: ReviewChoices;
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
  choiceCandidates?: ReviewChoices;
  /** Content comparison, independent of draft version increments. */
  hasUnpublishedChanges?: boolean;
  enabled?: boolean;
  lifecycleVersion?: number;
  id: string;
  version: number;
  publishedVersion: number | null;
  definition: ReviewDefinition;
  updatedAt: string;
};
export type ReviewDraft = {
  source?: ReviewSource;
  id: string;
  version: number;
  templateId: string;
  templateVersion: number;
  title: string;
  values: Record<string, unknown>;
  selectedApprovers?: ReviewChoices;
  updatedAt: string;
};
export type ReviewCommand =
  | {
      action: "submit";
      source?: ReviewSource;
      templateId: string;
      templateVersion: number;
      title: string;
      values: Record<string, unknown>;
      selectedApprovers?: ReviewChoices;
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
export type ReviewIssue = { path: string; message: string; target?: { step: "basic" | "form" | "flow"; id?: string; property?: string } };
export type ReviewTraceStep = {
  nodeId: string;
  type: ReviewNode["type"];
  userIds?: string[];
  branch?: "matched" | "otherwise";
  condition?: ReviewCondition;
  inputs?: Record<string, unknown>;
  next?: string;
  blockedReason?: string;
};
export type ReviewSimulation = {
  status: string;
  issues: ReviewIssue[];
  blockedReason?: string;
  path?: string[];
  tasks: ReviewTask[];
  trace: ReviewTraceStep[];
};
export type ReviewStarter = { id: string; name: string; description: string; definition: ReviewDefinition };
export type ReviewPreview = {
  summary: { name: string; version: number; consequence: string; reviewers?: string[] };
  trace: ReviewTraceStep[];
  blockedReason?: string;
};
export type ReviewProgress = {
  approval: "pending" | "approved" | "rejected" | "withdrawn";
  fulfillment: "none" | "pending" | "handling" | "completed" | "cancelled";
  currentResponsibility: string;
};
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

export function knowledgeReviewDefinition(): ReviewDefinition {
  return { ...emptyReviewDefinition(), name: "知识发布审批", subjectType: "knowledge_publication",
    description: "审核指定资料版本；批准后自动发布。审核人员须按实际职责配置。",
    fields: [
      { id: "knowledge_request", label: "资料版本引用（系统生成）", type: "text", required: true },
      { id: "publication_note", label: "发布说明", type: "textarea", required: true },
    ] };
}
