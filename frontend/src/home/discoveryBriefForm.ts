export function clampCountInput(raw: string, fallback: number): number {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
