/** 5-field cron (min hour dom month dow). Used only to persist next_run_at — not as a process timer. */

const FIELD_BOUNDS: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

function parseField(raw: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  const token = raw.trim();
  if (token === "*") {
    for (let i = min; i <= max; i++) out.add(i);
    return out;
  }
  for (const part of token.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${part}`);
    if (range === "*") {
      for (let i = min; i <= max; i += step) out.add(i);
      continue;
    }
    const [startRaw, endRaw] = range.split("-");
    const start = Number(startRaw);
    const end = endRaw == null ? start : Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`invalid cron field: ${part}`);
    }
    for (let i = start; i <= end; i += step) out.add(i);
  }
  return out;
}

export function parseCronExpr(expr: string): Array<Set<number>> {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron_expr must have 5 fields");
  return parts.map((part, i) => parseField(part, FIELD_BOUNDS[i][0], FIELD_BOUNDS[i][1]));
}

function weekdaySundayZero(date: Date): number {
  return date.getUTCDay();
}

function inZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[String(parts.weekday)] ?? weekdaySundayZero(date),
  };
}

function zonedUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const shown = inZone(new Date(guess), timeZone);
  const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, 0);
  return new Date(guess - (shownUtc - guess));
}

export function nextRunAt(expr: string, timeZone: string, from = new Date()): Date {
  const [minutes, hours, doms, months, dows] = parseCronExpr(expr);
  const start = new Date(from.getTime() + 60_000);
  start.setUTCSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const cursor = new Date(start.getTime() + i * 60_000);
    const z = inZone(cursor, timeZone || "Asia/Shanghai");
    if (!months.has(z.month) || !doms.has(z.day) || !hours.has(z.hour) || !minutes.has(z.minute) || !dows.has(z.weekday)) {
      continue;
    }
    return zonedUtc(timeZone || "Asia/Shanghai", z.year, z.month, z.day, z.hour, z.minute);
  }
  throw new Error("could not compute next_run_at");
}

export function humanFrequency(expr: string, timeZone: string): string {
  try {
    const parts = String(expr || "").trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const tz = timeZone || "Asia/Shanghai";
    const tzLabel = tz === "Asia/Shanghai" ? "上海时间" : tz;
    if (parts[0] !== "*" && parts[1] !== "*" && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
      const minute = parts[0].padStart(2, "0");
      const hour = parts[1].padStart(2, "0");
      return `每天 ${hour}:${minute}（${tzLabel}）`;
    }
    if (parts[2] === "*" && parts[3] === "*" && parts[4] !== "*") {
      const days = ["日", "一", "二", "三", "四", "五", "六"];
      const dow = Number(parts[4]);
      const label = Number.isInteger(dow) && days[dow] ? `每周${days[dow]}` : `每周 ${parts[4]}`;
      return `${label} ${parts[1].padStart(2, "0")}:${parts[0].padStart(2, "0")}（${tzLabel}）`;
    }
    return `${expr}（${tzLabel}）`;
  } catch {
    return expr;
  }
}
