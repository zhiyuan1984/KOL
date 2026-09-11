import type { Json } from "../types.js";

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/** Vendor receipt only. Never treat a missing `sent` flag as success. */
export function mailSendReceipt(result: Json): {
  sent: boolean;
  receipt_status: string;
  remote_id: string;
} {
  const nested = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as Json
    : {};
  const remoteId = firstString(
    result.messageId,
    result.message_id,
    result.mailId,
    result.remote_id,
    nested.messageId,
    nested.message_id,
    nested.id,
  );
  const status = firstString(
    result.receipt_status,
    result.sendStatus,
    result.status,
    result.state,
    result.operation,
    nested.receipt_status,
    nested.status,
    nested.state,
    nested.operation,
  ).toUpperCase();
  const code = Number(result.code ?? nested.code);
  const accepted = result.sent === true
    || result.ok === true
    || result.success === true
    || nested.sent === true
    || nested.ok === true
    || status === "SENT"
    || status === "SYNC_SENT"
    || status === "SUCCESS"
    || status === "ACCEPTED"
    || code === 0
    || code === 200;
  return {
    sent: accepted,
    receipt_status: accepted ? (status || "accepted") : (status || "unknown"),
    remote_id: remoteId,
  };
}
