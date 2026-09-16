import { authDisabled, type AppUser } from "../auth.js";
import type { Row } from "../types.js";
import { canDecideCurrent, employeeForUser } from "./inbox.js";

export const APPROVAL_BOXES = ["inbox", "submitted", "done"] as const;
export type ApprovalBox = (typeof APPROVAL_BOXES)[number];

export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  waiting_next: "等待下一位",
  approved_pending_exec: "已批准，待执行",
  executing: "执行中",
  succeeded: "已办结",
  partial: "部分完成",
  failed: "失败",
  rejected: "已驳回",
  withdrawn: "已撤回",
  stale: "已过期",
};

const PATH_STATE_LABEL = {
  done: "已通过",
  current: "当前",
  rejected: "已驳回",
  todo: "待处理",
} as const;

export type PathState = keyof typeof PATH_STATE_LABEL;

export function parseApprovalBox(raw: string | null | undefined): ApprovalBox | undefined {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  if ((APPROVAL_BOXES as readonly string[]).includes(value)) return value as ApprovalBox;
  throw Object.assign(new Error("unknown_box"), { code: "unknown_box" });
}

export function viewerOf(user?: AppUser | null) {
  const person = employeeForUser(user);
  return {
    employee_id: person?.id || "",
    name: person?.name || user?.name || "",
    handle: user?.handle || user?.username || "",
  };
}

function chainOf(approval: Row): string[] {
  return Array.isArray(approval.chain) ? approval.chain as string[] : [];
}

function payloadOf(approval: Row): Record<string, unknown> {
  const payload = approval.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

export function isCurrentDecider(approval: Row, user?: AppUser | null): boolean {
  if (String(approval.status) !== "pending") return false;
  return canDecideCurrent(user || undefined, chainOf(approval), Number(approval.current_index));
}

export function isSubmitter(approval: Row, user?: AppUser | null): boolean {
  const viewer = viewerOf(user);
  const submittedBy = String(approval.submitted_by || "").trim();
  if (viewer.handle && submittedBy && submittedBy === viewer.handle) return true;
  if (user?.username && submittedBy && submittedBy === user.username) return true;
  return false;
}

export function chainIndexForViewer(approval: Row, user?: AppUser | null): number {
  const viewer = viewerOf(user);
  const chain = chainOf(approval);
  if (viewer.employee_id) {
    const byId = chain.indexOf(viewer.employee_id);
    if (byId >= 0) return byId;
  }
  const detail = Array.isArray(approval.chain_detail) ? approval.chain_detail as { name?: string }[] : [];
  if (viewer.name) {
    const byName = detail.findIndex((step) => step.name === viewer.name);
    if (byName >= 0) return byName;
  }
  return -1;
}

export function hasProcessed(approval: Row, user?: AppUser | null): boolean {
  const index = chainIndexForViewer(approval, user);
  if (index < 0) return false;
  const status = String(approval.status);
  const current = Number(approval.current_index);
  if (status === "rejected") return index <= current;
  if (status !== "pending") return true;
  return index < current;
}

export function isVisibleToViewer(approval: Row, user?: AppUser | null): boolean {
  if (authDisabled()) return true;
  return isCurrentDecider(approval, user)
    || isSubmitter(approval, user)
    || chainIndexForViewer(approval, user) >= 0;
}

export function inApprovalBox(approval: Row, box: ApprovalBox, user?: AppUser | null): boolean {
  if (box === "inbox") return isCurrentDecider(approval, user);
  if (box === "submitted") return isSubmitter(approval, user);
  return hasProcessed(approval, user)
    || (String(approval.status) !== "pending" && (isSubmitter(approval, user) || chainIndexForViewer(approval, user) >= 0));
}

export function businessStatusOf(approval: Row): string {
  const raw = String(approval.business_status || "").trim();
  if (raw) return raw;
  const status = String(approval.status || "");
  const index = Number(approval.current_index);
  if (status === "rejected") return "rejected";
  if (status === "withdrawn" || status === "cancelled") return "withdrawn";
  if (status === "stale") return "stale";
  if (status === "pending") return index > 0 ? "waiting_next" : "pending";
  if (status === "consumed" || status === "sent" || status === "approved") return "succeeded";
  return status || "pending";
}

export function pathStateAt(approval: Row, index: number): PathState {
  const status = String(approval.status);
  const current = Number(approval.current_index);
  if (status === "consumed" || status === "sent" || status === "approved") return "done";
  if (status === "rejected") {
    if (index < current) return "done";
    if (index === current) return "rejected";
    return "todo";
  }
  if (index < current) return "done";
  if (index === current) return "current";
  return "todo";
}

export function waitingDurationLabel(fromIso?: string | null): string {
  const start = Date.parse(String(fromIso || ""));
  if (!Number.isFinite(start)) return "刚提交";
  const ms = Date.now() - start;
  if (ms < 60_000) return "刚提交";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `已等待 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `已等待 ${hours} 小时`;
  return `已等待 ${Math.floor(hours / 24)} 天`;
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n.toLocaleString("zh-CN");
}

export function objectLabelOf(approval: Row): string {
  const payload = payloadOf(approval);
  const kind = String(approval.kind || "expense");
  if (kind !== "expense") {
    return String(approval.title || payload.reason || "确认阶段");
  }
  const requester = payload.requester_name ? `${payload.requester_name}申请` : "费用申请";
  const currency = String(payload.currency || "CNY");
  const amount = payload.amount;
  const base = payload.amount_base ?? approval.amount_usd;
  if (currency !== "CNY" && amount != null && amount !== "") {
    return `${requester} ${currency} ${formatAmount(amount)}，折合人民币 ${formatAmount(base)}`;
  }
  return `${requester} 人民币 ${formatAmount(base)}`;
}

export function consequenceLabelOf(approval: Row): string {
  const payload = payloadOf(approval);
  const kind = String(approval.kind || "expense");
  const versionCode = versionCodeOf(approval);
  if (kind !== "expense") {
    const current = String(payload.stage_label || payload.current_stage || "当前阶段");
    const target = String(payload.target_label || payload.stage_code || "目标阶段");
    return versionCode ? `进入 ${target}（自 ${current}） · ${versionCode}` : `进入 ${target}（自 ${current}）`;
  }
  const currency = String(payload.currency || "CNY");
  const amount = payload.amount ?? approval.amount_usd;
  const base = payload.amount_base ?? approval.amount_usd;
  const money = currency !== "CNY" && amount != null
    ? `${currency} ${formatAmount(amount)} · 人民币 ${formatAmount(base)}`
    : `人民币 ${formatAmount(base)}`;
  return versionCode ? `${money} · ${versionCode}` : money;
}

export function versionCodeOf(approval: Row): string {
  const payload = payloadOf(approval);
  return String(payload.rule_id || payload.policy_id || approval.kind_label || approval.kind || "").trim();
}

export function currentNodeOf(approval: Row): string {
  const detail = Array.isArray(approval.chain_detail) ? approval.chain_detail as { name?: string }[] : [];
  return String(detail[Number(approval.current_index)]?.name || "下一位审批人");
}

function receiptProjection(approval: Row) {
  const status = String(approval.status);
  const sent = Boolean((approval as { sent?: boolean }).sent);
  const discarded = Boolean((approval as { discarded?: boolean }).discarded) || status === "rejected";
  const decided = status === "rejected" ? "rejected" : (status === "consumed" || status === "sent" || status === "approved") ? "approved" : "none";
  const gateway = decided === "none" ? "none" : "accepted";
  let external: "succeeded" | "failed" | "pending_check" | "none" = "none";
  if (decided !== "none") {
    if (discarded) external = "none";
    else if (sent === true) external = "succeeded";
    else external = "pending_check";
  }
  const externalLabel = {
    succeeded: "外部回执成功",
    failed: "外部回执失败",
    pending_check: "待核对",
    none: "无外部回执",
  } as const;
  return {
    decision: decided,
    decision_label: decided === "approved" ? "已批准" : decided === "rejected" ? "已驳回" : "尚未决定",
    gateway: gateway,
    gateway_label: gateway === "accepted" ? "网关已接受" : "网关未接受",
    external,
    external_label: externalLabel[external],
  };
}

export function projectApproval(approval: Row, user?: AppUser | null): Row {
  const payload = payloadOf(approval);
  const canDecide = isCurrentDecider(approval, user);
  const businessStatus = businessStatusOf(approval);
  const detail = Array.isArray(approval.chain_detail) ? approval.chain_detail as { name?: string; role?: string }[] : [];
  const path = detail.map((step, index) => {
    const state = pathStateAt(approval, index);
    return {
      name: step.name || "",
      role: step.role || "",
      state,
      state_label: PATH_STATE_LABEL[state],
    };
  });
  const waitingFrom = Number(approval.current_index) > 0
    ? String(approval.updated_at || approval.created_at || "")
    : String(approval.created_at || "");
  const receipts = receiptProjection(approval);
  const version = Number(approval.version || 0);
  const expectedRole = chainOf(approval)[Number(approval.current_index)] || null;
  const viewer = viewerOf(user);
  return {
    ...approval,
    version,
    expected_role: expectedRole,
    can_decide: canDecide,
    allowed_actions: canDecide ? ["approve", "reject"] : [],
    viewer_name: viewer.name || null,
    business_status: businessStatus,
    business_status_label: BUSINESS_STATUS_LABEL[businessStatus] || businessStatus,
    object_label: objectLabelOf(approval),
    action_id: String(approval.kind || "expense"),
    consequence_label: consequenceLabelOf(approval),
    requester_name: String(payload.requester_name || approval.submitted_by || ""),
    waiting_duration_label: String(approval.status) === "pending" ? waitingDurationLabel(waitingFrom) : "",
    current_node: currentNodeOf(approval),
    version_code: versionCodeOf(approval),
    path,
    receipts,
    evidence: {
      object: objectLabelOf(approval),
      scope: String(approval.kind || "expense") !== "expense" ? "按审批规则" : "按费用规则",
      change: consequenceLabelOf(approval),
      consequence: String(approval.status) === "pending"
        ? (canDecide ? "轮到你确认。" : `当前等待 ${currentNodeOf(approval)}。`)
        : String(BUSINESS_STATUS_LABEL[businessStatus] || businessStatus),
      approval_state: BUSINESS_STATUS_LABEL[businessStatus] || businessStatus,
      rule_version: versionCodeOf(approval),
    },
  };
}

export function idempotencyKeyOf(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) {
    const error = new Error("idempotency_key_required") as Error & { code: string };
    error.code = "idempotency_key_required";
    throw error;
  }
  return key;
}
