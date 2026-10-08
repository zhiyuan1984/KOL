import type { Task } from "./api";

export const AGENT_TASK_STATUSES = [
  "RUNNING",
  "PENDING_APPROVE",
  "MANUAL_INTERVENE",
  "SUCCESS",
  "FAILED",
] as const;

/** 过滤条只列五个主状态；STOPPED / CANCELLED 是终态词，只用于徽章与列表。 */
export type AgentTaskUxStatus = (typeof AGENT_TASK_STATUSES)[number] | "STOPPED" | "CANCELLED";
export type MessageRisk = "L1" | "L2" | "L3";

export const AGENT_TASK_STATUS_LABEL: Record<AgentTaskUxStatus, string> = {
  RUNNING: "进行中",
  PENDING_APPROVE: "待确认",
  MANUAL_INTERVENE: "需介入",
  SUCCESS: "已完成",
  FAILED: "失败",
  STOPPED: "已停止",
  CANCELLED: "已取消",
};

export const MESSAGE_RISK_LABEL: Record<MessageRisk, string> = {
  L1: "只读（L1）",
  L2: "草稿（L2）· 未生效",
  L3: "需要确认（L3）",
};

export function agentTaskUxStatus(task: Task, running = false): AgentTaskUxStatus {
  const status = String(task.status || "").toLowerCase();
  const risk = String(task.risk || task.next_action || "");
  if (status === "completed" || status === "success") return "SUCCESS";
  if (status === "stopped") return "STOPPED";
  if (status === "cancelled") return "CANCELLED";
  if (status === "failed" || status === "error") {
    return /人工|接管|介入|retry|重试/i.test(risk) ? "MANUAL_INTERVENE" : "FAILED";
  }
  if (status === "waiting" || status === "waiting_approval" || status === "pending_approve") {
    return "PENDING_APPROVE";
  }
  if (status === "running" || status === "queued" || status === "starting" || running) return "RUNNING";
  if (status === "pending") return running ? "RUNNING" : "PENDING_APPROVE";
  return "RUNNING";
}

export function taskTriggerLabel(task: Task): string {
  const source = String(task.source || "manual").toLowerCase();
  if (source === "webhook") return "webhook";
  if (source === "ai") return "AI";
  return "手动";
}

export function messageRisk(kind: string, payload: Record<string, unknown> = {}): MessageRisk | null {
  if (kind === "email_card") return "L2";
  if (kind === "confirm_stage_card") return "L3";
  if (kind === "error_card") return "L3";
  if (kind === "supplement_card") {
    const intent = String(payload.intent || "");
    return intent === "confirm_stage" || intent === "business_approval" ? "L3" : "L2";
  }
  if (kind === "task_result_card") {
    if (payload.artifact_type === "review_draft") return "L2";
    return String(payload.title || "") === "邮件草稿" || String(payload.skill || "") === "email_compose"
      ? "L2"
      : "L1";
  }
  if (kind === "inbound_card" || kind === "kol_mail_card") return "L1";
  return null;
}
