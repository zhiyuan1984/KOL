/** 员工端计划显示与编辑使用的唯一默认时区。 */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

const EMPTY_TIME = "—";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type CronJobLike = {
  frequency?: string;
  timezone?: string;
  cron_expr?: string;
  schedule?: Record<string, unknown>;
  condition?: Record<string, unknown>;
};

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function resolvedZone(zone?: string): string {
  return zone?.trim() || DEFAULT_TIME_ZONE;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validCalendarParts(parts: ZonedParts): boolean {
  return Number.isInteger(parts.year)
    && parts.year >= 1
    && parts.year <= 9999
    && parts.month >= 1
    && parts.month <= 12
    && parts.day >= 1
    && parts.day <= daysInMonth(parts.year, parts.month)
    && parts.hour >= 0
    && parts.hour <= 23
    && parts.minute >= 0
    && parts.minute <= 59
    && parts.second >= 0
    && parts.second <= 59;
}

/**
 * Parse only ISO instants with an explicit UTC offset. Bare timestamps are intentionally
 * rejected: interpreting them in the browser's own time zone would silently change a plan.
 */
function parseInstant(value?: string | null): Date | undefined {
  if (typeof value !== "string") return undefined;
  const matched = ISO_INSTANT.exec(value.trim());
  if (!matched) return undefined;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", milliText = "0", offset] = matched;
  const parts: ZonedParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  if (!validCalendarParts(parts)) return undefined;

  const milliseconds = Number(milliText.padEnd(3, "0"));
  let offsetMinutes = 0;
  if (offset.toUpperCase() !== "Z") {
    const sign = offset[0] === "+" ? 1 : -1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutesPart = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutesPart > 59) return undefined;
    offsetMinutes = sign * (offsetHours * 60 + offsetMinutesPart);
  }

  const millisecondsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, milliseconds)
    - offsetMinutes * 60_000;
  const instant = new Date(millisecondsUtc);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}

function formatter(zone: string, withSeconds = false): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  });
}

function partsAt(instant: Date, zone: string, withSeconds = true): ZonedParts {
  const values = Object.fromEntries(formatter(zone, withSeconds).formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: withSeconds ? Number(values.second) : 0,
  };
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function dateTimeText(parts: ZonedParts): string {
  return `${parts.year}-${two(parts.month)}-${two(parts.day)} ${two(parts.hour)}:${two(parts.minute)}`;
}

function sameLocalTime(left: ZonedParts, right: ZonedParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function calendarDayDistance(from: ZonedParts, to: ZonedParts): number {
  // Date.UTC is used only as a calendar arithmetic primitive, never to interpret a local input.
  return (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000;
}

/**
 * Format an ISO instant in an explicit zone. Invalid input is returned verbatim so a malformed
 * server value is visible rather than being rendered as a plausible but incorrect date.
 */
export function formatExactTime(value?: string | null, zone?: string): string {
  if (value == null || value.trim() === "") return EMPTY_TIME;
  const instant = parseInstant(value);
  const targetZone = resolvedZone(zone);
  if (!instant || !isTimeZone(targetZone)) return value;
  return dateTimeText(partsAt(instant, targetZone, false));
}

/**
 * Compact next-run label based on the Beijing calendar, not elapsed 24-hour blocks.
 * Stale values deliberately keep a numeric date instead of collapsing to an "overdue" count.
 */
export function formatNextTime(value?: string | null, now: Date = new Date()): string {
  if (value == null || value.trim() === "") return EMPTY_TIME;
  const instant = parseInstant(value);
  if (!instant) return value;

  const comparison = Number.isNaN(now.getTime()) ? new Date() : now;
  const target = partsAt(instant, DEFAULT_TIME_ZONE, false);
  const current = partsAt(comparison, DEFAULT_TIME_ZONE, false);
  const dayDistance = calendarDayDistance(current, target);
  const isFutureOrCurrent = instant.getTime() >= comparison.getTime();
  const time = `${two(target.hour)}:${two(target.minute)}`;

  if (isFutureOrCurrent && dayDistance === 0) return `今天 ${time}`;
  if (isFutureOrCurrent && dayDistance === 1) return `明天 ${time}`;
  if (target.year !== current.year) return `${target.year}-${two(target.month)}-${two(target.day)} ${time}`;
  return `${two(target.month)}-${two(target.day)} ${time}`;
}

/** Convert a UTC/offset ISO instant to a datetime-local value in the selected IANA zone. */
export function toZonedInput(value?: string | null, zone?: string): string {
  if (value == null || value.trim() === "") return "";
  const instant = parseInstant(value);
  const targetZone = resolvedZone(zone);
  if (!instant || !isTimeZone(targetZone)) return "";
  const parts = partsAt(instant, targetZone, false);
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}

function offsetsNearLocalTime(target: ZonedParts, zone: string): number[] {
  const assumedUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const offsets = new Set<number>();

  // UTC offsets may change around a DST boundary. Sampling both sides of a 48-hour window
  // gives the candidate offsets without treating the browser's own zone as an input.
  for (let hours = -24; hours <= 24; hours += 1) {
    const probe = new Date(assumedUtc + hours * 3_600_000);
    const shown = partsAt(probe, zone, true);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    const probeWholeSecond = Math.floor(probe.getTime() / 1_000) * 1_000;
    offsets.add((shownAsUtc - probeWholeSecond) / 60_000);
  }
  return [...offsets];
}

/**
 * Convert an exact datetime-local value in an IANA zone to UTC ISO.
 *
 * This never calls `new Date(value)`: browser-local parsing would make the same form value mean
 * different instants for different employees. Nonexistent DST times and fallback ambiguities are
 * rejected explicitly so editing cannot accidentally move a scheduled job.
 */
export function fromZonedInput(value: string, zone?: string): string | undefined {
  if (value.trim() === "") return undefined;
  const targetZone = resolvedZone(zone);
  if (!isTimeZone(targetZone)) throw new Error(`无效时区：${targetZone}`);

  const matched = LOCAL_DATE_TIME.exec(value);
  if (!matched) throw new Error("无效的本地日期时间，应为 YYYY-MM-DDTHH:mm");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", milliText = "0"] = matched;
  const target: ZonedParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  if (!validCalendarParts(target)) throw new Error("无效的本地日期时间");

  const milliseconds = Number(milliText.padEnd(3, "0"));
  const assumedUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second, milliseconds);
  const candidates = offsetsNearLocalTime(target, targetZone)
    .map((offsetMinutes) => new Date(assumedUtc - offsetMinutes * 60_000))
    .filter((candidate) => sameLocalTime(partsAt(candidate, targetZone, true), target));
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.getTime(), candidate])).values()];

  if (uniqueCandidates.length === 0) {
    throw new Error("该时区不存在此本地时间，可能处于夏令时切换");
  }
  if (uniqueCandidates.length > 1) {
    throw new Error("该时区本地时间存在歧义，可能处于夏令时回拨；请重新选择明确时间");
  }
  return uniqueCandidates[0].toISOString();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function scheduleFor(job: CronJobLike): Record<string, unknown> | undefined {
  const direct = record(job.schedule);
  const nested = record(record(job.condition)?.schedule);
  if (String(direct?.kind || "") === "once" || String(direct?.kind || "") === "interval") return direct;
  if (String(nested?.kind || "") === "once" || String(nested?.kind || "") === "interval") return nested;
  return direct || nested;
}

function timeZoneSuffix(zone: string): string {
  return zone === DEFAULT_TIME_ZONE ? "" : `（${zone}）`;
}

function withTimeZone(text: string, zone: string): string {
  return `${text}${timeZoneSuffix(zone)}`;
}

function normaliseFrequencyText(frequency: string, zone: string): string {
  const text = frequency.trim();
  if (!text) return "";
  if (zone === DEFAULT_TIME_ZONE) {
    return text.replace(/\s*[（(]\s*(?:上海时间|北京时间|Asia\/Shanghai)\s*[）)]\s*$/i, "");
  }

  const trailingZone = /\s*[（(]\s*([^）)]+)\s*[）)]\s*$/.exec(text);
  if (trailingZone && (trailingZone[1].includes("/") || /(?:时间|UTC|GMT)/i.test(trailingZone[1]))) {
    return `${text.slice(0, trailingZone.index).trim()}${timeZoneSuffix(zone)}`;
  }
  return `${text}${timeZoneSuffix(zone)}`;
}

function integer(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function minuteHour(minute: number, hour: number): string {
  return `${two(hour)}:${two(minute)}`;
}

function humanCron(cronExpression: string): string | undefined {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return undefined;
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields;
  const minute = integer(minuteField);
  const hour = integer(hourField);

  if (/^\*\/\d+$/.test(minuteField) && hourField === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const every = integer(minuteField.slice(2));
    if (every && every >= 1 && every <= 59) return every === 1 ? "每分钟" : `每${every}分钟`;
  }
  if (minute != null && minute >= 0 && minute <= 59 && hourField === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return minute === 0 ? "每小时" : `每小时 ${two(minute)}分`;
  }
  if (minute != null && minute >= 0 && minute <= 59 && hour != null && hour >= 0 && hour <= 23 && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `每天 ${minuteHour(minute, hour)}`;
  }
  if (minute != null && minute >= 0 && minute <= 59 && hour != null && hour >= 0 && hour <= 23 && dayOfMonth === "*" && month === "*") {
    const weekday = integer(dayOfWeek);
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    if (weekday != null && weekday >= 0 && weekday <= 6) return `每周${weekdays[weekday]} ${minuteHour(minute, hour)}`;
  }
  if (minute != null && minute >= 0 && minute <= 59 && hour != null && hour >= 0 && hour <= 23 && month === "*" && dayOfWeek === "*") {
    const date = integer(dayOfMonth);
    if (date != null && date >= 1 && date <= 31) return `每月${date}日 ${minuteHour(minute, hour)}`;
  }
  return undefined;
}

/**
 * Short, display-only schedule text. It prefers once/interval windows over cron and leaves any
 * unrecognised cron expression intact, so historical schedules are never silently reinterpreted.
 */
export function compactFrequency(job: CronJobLike): string {
  const zone = resolvedZone(job.timezone);
  const schedule = scheduleFor(job);
  const kind = String(schedule?.kind || "");

  if (kind === "once") {
    const onceAt = typeof schedule?.once_at === "string" ? schedule.once_at : "";
    const date = onceAt ? formatExactTime(onceAt, zone) : "";
    return withTimeZone(date ? `单次 ${date}` : "单次", zone);
  }
  if (kind === "interval") {
    const minutes = typeof schedule?.interval_minutes === "number"
      ? schedule.interval_minutes
      : Number(schedule?.interval_minutes);
    return withTimeZone(Number.isInteger(minutes) && minutes > 0 ? `每隔 ${minutes} 分钟` : "间隔执行", zone);
  }

  const cronExpression = typeof job.cron_expr === "string" ? job.cron_expr.trim() : "";
  if (cronExpression) return withTimeZone(humanCron(cronExpression) || cronExpression, zone);

  if (typeof job.frequency === "string" && job.frequency.trim()) {
    // The employee summary intentionally omits cron_expr; older server labels
    // can contain the raw expression followed by a timezone suffix.
    const expression = job.frequency.trim().replace(/\s*[（(][^）)]*[）)]\s*$/, "");
    const readable = humanCron(expression);
    return readable ? withTimeZone(readable, zone) : normaliseFrequencyText(job.frequency, zone);
  }
  return withTimeZone("未设置频率", zone);
}
