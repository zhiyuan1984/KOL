import type { Json } from "../types.js";

/** Keep business text while excluding credentials from audit and employee copy. */
function redactCredentials(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/("(?:access[_-]?token|refresh[_-]?token|token|authorization|api[_-]?key|password|secret)"\s*:\s*")[^"\n]*(")/gi, "$1***$2")
    .replace(/\b(token|authorization|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;}"']+/gi, "$1=***");
}

/** Parsed Starry business response, bounded to 2000 characters including marker. */
export function starryResponseDigest(data: Json): string {
  let text: string;
  try { text = JSON.stringify(data) ?? String(data); } catch { text = String(data); }
  text = redactCredentials(text);
  const marker = "…(truncated)";
  return text.length > 2000 ? `${text.slice(0, 2000 - marker.length)}${marker}` : text;
}

function object(value: unknown): Json | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function messageOf(row: Json): string {
  for (const value of [row.message, row.msg, row.error, row.errMessage, row.errMsg]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** A failure marker outranks a returned/known UID; success messages alone are not errors. */
export function starryBodyFailure(data: Json): { failed: boolean; message: string } {
  const queue: Array<{ row: Json; depth: number; message: string }> = [{ row: data, depth: 0, message: "" }];
  const seen = new Set<Json>();
  while (queue.length) {
    const entry = queue.shift()!;
    if (seen.has(entry.row)) continue;
    seen.add(entry.row);
    const row = entry.row;
    const message = messageOf(row) || entry.message;
    const code = row.code ?? row.errCode ?? row.status;
    const normalized = String(code ?? "").trim().toLowerCase();
    const badCode = (typeof code === "number" || typeof code === "string") &&
      Boolean(normalized) && !["0", "200", "success", "ok"].includes(normalized);
    if (row.success === false || row.ok === false || badCode) {
      const nestedMessage = messageOf(object(row.data) || {}) || messageOf(object(row.result) || {});
      return { failed: true, message: redactCredentials(message || nestedMessage) };
    }
    if (entry.depth >= 6) continue;
    for (const value of [row.data, row.result, row.text]) {
      const nested = object(value);
      if (nested) queue.push({ row: nested, depth: entry.depth + 1, message });
    }
  }
  return { failed: false, message: "" };
}
