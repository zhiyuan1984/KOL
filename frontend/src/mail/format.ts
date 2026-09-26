import { occurredAtMs } from "../mail-time";

/** Relative label for a mail timestamp; empty string when there is no parseable time. */
export function formatMailTime(value?: string | null): string {
  const ms = occurredAtMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))} 小时前`;
  if (diff < 2 * 86_400_000) return "昨天";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function initialsOf(name: string): string {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}

export function avatarTone(seed: string): number {
  const text = String(seed || "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 6;
}

/** Absolute `9/16 15:06` stamp for the left-column mail rows. */
export function formatMailStamp(value?: string | null): string {
  const ms = occurredAtMs(value);
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
