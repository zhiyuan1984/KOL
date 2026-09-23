import { createHash } from "node:crypto";
import type { Json } from "../types.js";

export type HostActionRisk = "L1" | "L2" | "L3";
export type HostActionState = "ready" | "blocked" | "awaiting_selection" | "awaiting_approval" | "completed";

/** Server-produced action snapshot shared by all workspace modes. It is presentation data;
 * every invocation must still re-run the owning Host route's authorization and business gates. */
export type HostRegisteredActionView = {
  action_id: string;
  label: string;
  risk_level: HostActionRisk;
  state: HostActionState;
  allowed: boolean;
  enabled: boolean;
  disabled_reason?: string;
  selection_required: boolean;
  selection_ready: boolean;
  confirmation_required: boolean;
  confirmation_version: string | null;
  approval_state: "not_required" | "required" | "pending" | "approved" | "rejected";
  receipt_id: string | null;
};

export type HostRegisteredActionInput = {
  actionId: string;
  label: string;
  riskLevel: HostActionRisk;
  allowed: boolean;
  enabled: boolean;
  disabledReason?: string;
  selectionRequired?: boolean;
  selectionReady?: boolean;
  approvalState?: HostRegisteredActionView["approval_state"];
  receiptId?: string | null;
  /** Host-owned current action arguments/scope; never accept this snapshot as authorization. */
  confirmationPayload?: Json;
};

export function hostRegisteredActionView(input: HostRegisteredActionInput): HostRegisteredActionView {
  const selectionRequired = Boolean(input.selectionRequired);
  const selectionReady = !selectionRequired || input.selectionReady === true;
  const approvalState = input.approvalState || "not_required";
  const receiptId = input.receiptId || null;
  const blockedByApproval = approvalState === "required" || approvalState === "pending" || approvalState === "rejected";
  const state: HostActionState = receiptId ? "completed"
    : !selectionReady ? "awaiting_selection"
      : blockedByApproval ? "awaiting_approval"
        : input.allowed && input.enabled ? "ready" : "blocked";
  const confirmationRequired = input.riskLevel === "L3";
  const confirmationVersion = confirmationRequired && input.allowed && input.enabled && selectionReady && !blockedByApproval && !receiptId
    ? createHash("sha256").update(JSON.stringify({ action: input.actionId, payload: input.confirmationPayload ?? null }), "utf8").digest("hex")
    : null;
  return {
    action_id: input.actionId,
    label: input.label,
    risk_level: input.riskLevel,
    state,
    allowed: input.allowed,
    enabled: input.allowed && input.enabled && selectionReady && !blockedByApproval && !receiptId,
    ...(input.disabledReason ? { disabled_reason: input.disabledReason } : {}),
    selection_required: selectionRequired,
    selection_ready: selectionReady,
    confirmation_required: confirmationRequired,
    confirmation_version: confirmationVersion,
    approval_state: approvalState,
    receipt_id: receiptId,
  };
}

/** Compare a client confirmation to a freshly recomputed Host snapshot, then invoke the
 * existing owning route. This intentionally does not provide an authorization bypass. */
export function assertHostActionSnapshotCurrent(expected: string | null | undefined, current: HostRegisteredActionView): void {
  if (current.risk_level === "L3" && (!expected || expected !== current.confirmation_version || current.state !== "ready")) {
    throw new Error("action_confirmation_snapshot_stale");
  }
}
