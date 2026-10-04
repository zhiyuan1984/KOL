import { HttpFail } from "./host/errors.js";
import type { Row } from "./types.js";

export type TicketLifecycleAction = "accept" | "complete" | "cancel" | "reopen";

export type TicketTransitionInput = {
  ticketId: string;
  action: TicketLifecycleAction;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  acceptanceEvidence?: unknown;
  reason?: unknown;
};

export type TicketTransitionReceipt = {
  ticket_id: string;
  action: TicketLifecycleAction;
  status: "pending" | "accepted" | "completed" | "cancelled";
  version: number;
  event_id: string;
  replayed: boolean;
};

export function parseTicketLifecycleReceipt(value: unknown): TicketTransitionReceipt {
  try {
    if (value && typeof value === "object") return value as TicketTransitionReceipt;
    return JSON.parse(String(value || "{}")) as TicketTransitionReceipt;
  } catch {
    throw new HttpFail(500, { code: "ticket_command_receipt_corrupt", message: "工单命令回执已损坏，请联系管理员。" });
  }
}

export function ticketAllowedLifecycleActions(row: Row): TicketLifecycleAction[] {
  const status = String(row.status || "");
  if (status === "completed") return ["reopen"];
  if (["failed", "cancelled"].includes(status)) return [];
  const actions: TicketLifecycleAction[] = [];
  if (["pending", "queued", "waiting", "needs_clarification"].includes(status)) actions.push("cancel");
  if (status === "pending") actions.push("accept");
  if (["accepted", "waiting", "waiting_approval", "in_progress"].includes(status)) actions.push("complete");
  return actions;
}

export function validateTicketLifecycleCommand(input: TicketTransitionInput): void {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new HttpFail(400, "expected_version is required");
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
    throw new HttpFail(400, "Idempotency-Key is required");
  }
  if (input.action === "complete" && (!input.acceptanceEvidence || typeof input.acceptanceEvidence !== "object" || Array.isArray(input.acceptanceEvidence))) {
    throw new HttpFail(422, { code: "acceptance_evidence_required", missing_fields: ["acceptance_evidence"] });
  }
  if (input.action === "reopen" && !String(input.reason || "").trim()) {
    throw new HttpFail(422, { code: "reopen_reason_required", missing_fields: ["reason"] });
  }
}
