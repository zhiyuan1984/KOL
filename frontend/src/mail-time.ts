/** Parse ISO, unix seconds/ms, or Date-parseable strings. Conversation ids are ignored. */
export function occurredAtMs(...values: unknown[]): number {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "[object Object]") continue;
    if (/^\d{10,13}$/.test(raw)) {
      const n = Number(raw);
      const ms = raw.length <= 10 ? n * 1000 : n;
      if (Number.isFinite(ms) && ms > 0) return ms;
      continue;
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}
