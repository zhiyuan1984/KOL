/** Display-only label; never use this text as an API or Intl timeZone value. */
export function timezoneLabel(zone?: string | null, empty = "—"): string {
  const value = zone?.trim();
  if (!value) return empty;
  return value === "Asia/Shanghai" ? "北京时间（UTC+8）" : value;
}
