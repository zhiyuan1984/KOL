import { createHash } from "node:crypto";
import type { Json, Row } from "../types.js";

export function fingerprint(
  fromAddr: string,
  toAddr: string,
  cc: string,
  subject: string,
  body: string,
  amount: unknown,
): string {
  const raw = `${fromAddr}|${toAddr}|${cc || ""}|${subject}|${body}|${amount}`;
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function currentFingerprint(draft: Row): string {
  let extra: Json = {};
  if (typeof draft.extra === "string") {
    try {
      extra = JSON.parse(draft.extra) as Json;
    } catch {
      extra = {};
    }
  } else if (draft.extra && typeof draft.extra === "object") {
    extra = draft.extra as Json;
  }
  return fingerprint(
    String(draft.from_addr),
    String(draft.to_addr),
    String(draft.cc || ""),
    String(draft.subject),
    String(draft.body_en),
    draft.amount_usd != null ? draft.amount_usd : extra.amount_usd,
  );
}
