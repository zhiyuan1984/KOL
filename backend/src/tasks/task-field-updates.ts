/**
 * Deterministic field-edit parser used when the LLM channel is unavailable.
 * Chinese keywords only; returns canonical codes, never invents fields.
 */
import type { TaskFieldUpdates } from "./openai-intent.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(now: Date, days: number): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return localDateStr(date);
}

const WEEKDAYS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
};

export function parseDateExpression(expr: string, now = new Date()): string | null {
  const text = expr.trim();
  const iso = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(text);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${iso[1]}-${pad(month)}-${pad(day)}`;
  }
  const md = /^(\d{1,2})月(\d{1,2})[日号]?$/.exec(text) || /^(\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${now.getFullYear()}-${pad(month)}-${pad(day)}`;
  }
  const offsets: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
  if (text in offsets) return addDays(now, offsets[text]);
  const week = /^(下)?(?:周|星期)([一二三四五六日天])$/.exec(text);
  if (week) {
    const target = WEEKDAYS[week[2]];
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (week[1]) diff += 7;
    return addDays(now, diff);
  }
  return null;
}

const DATE_EXPR = String.raw`(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?|\d{1,2}月\d{1,2}[日号]?|\d{1,2}[-/]\d{1,2}|大后天|后天|明天|今天|下周[一二三四五六日天]|周[一二三四五六日天]|星期[一二三四五六日天])`;

const DUE_RE = new RegExp(`(?:延期到|推迟到|改到|截止到|截至|截止|到期日?|结束日期|结束于|定于)\\s*[:：]?\\s*(${DATE_EXPR})`);
const START_RE = new RegExp(`(?:开始日期|开始时间|开始于|从|自)\\s*[:：]?\\s*(${DATE_EXPR})`);

function quotedValue(text: string, keys: string): string | null {
  const match = new RegExp(`(?:${keys})\\s*(?:改为|改成|设为|设置为|补充为|为|成)?\\s*[:：]?\\s*[「"“']([^」"”'\\n，。；]{1,500})[」"”']?`).exec(text);
  return match ? match[1].trim() : null;
}

export function parseTaskFieldUpdatesFallback(text: string, now = new Date()): TaskFieldUpdates {
  const updates: TaskFieldUpdates = {};
  const input = String(text || "").trim();
  if (!input) return updates;

  if (/重要紧急/.test(input)) updates.priority = "important_urgent";
  else if (/不重要|低优先级|优先级.{0,6}低/.test(input)) updates.priority = "low";
  else if (/中优先级|优先级.{0,6}中/.test(input)) updates.priority = "normal";
  else if (/紧急/.test(input)) updates.priority = "urgent";
  else if (/重要/.test(input)) updates.priority = "important";

  if (/无风险|风险.{0,6}(无|清除|取消)/.test(input)) updates.risk_level = "none";
  else if (/高风险|风险.{0,6}高/.test(input)) updates.risk_level = "high";
  else if (/中风险|风险.{0,6}中/.test(input)) updates.risk_level = "medium";
  else if (/低风险|风险.{0,6}低/.test(input)) updates.risk_level = "low";

  if (/(?:标记|标为|设为|设置|改成|改为|状态|已经|已).{0,6}完成|完成了|已完成|做完了/.test(input)) {
    updates.status = "completed";
  } else if (/(?:标记|标为|设为|设置|改成|改为|状态).{0,6}取消|已取消|取消(?:这个|该|此)?任务|任务.{0,4}取消|作废/.test(input)) {
    updates.status = "cancelled";
  } else if (/(?:标记|标为|设为|设置|改成|改为|状态).{0,6}失败|已失败|失败了/.test(input)) {
    updates.status = "failed";
  } else if (/进行中|正在做|开始做了|开始执行/.test(input)) {
    updates.status = "in_progress";
  } else if (/(?:标记|标为|设为|设置|改成|改为|状态).{0,6}未开始|还没开始|尚未开始/.test(input)) {
    updates.status = "pending";
  }

  const due = DUE_RE.exec(input);
  if (due) {
    const date = parseDateExpression(due[1], now);
    if (date) updates.due_at = date;
  }
  const start = START_RE.exec(input);
  if (start) {
    const date = parseDateExpression(start[1], now);
    if (date) updates.start_date = date;
  }

  const title = quotedValue(input, "标题|名称|改名");
  if (title) updates.title = title.slice(0, 200);
  const content = quotedValue(input, "内容|备注|描述");
  if (content) updates.content = content.slice(0, 2000);
  return updates;
}
