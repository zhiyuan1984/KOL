/**
 * 写合作邮件的占位符替换（纯函数）。
 *
 * 规则只替换占位符，不动人已经写的内容：
 * - `[发件邮箱]` → 发件箱地址；`[收件邮箱]` → 收件人地址（为空时不替换，留给人补）
 * - `mergeSubjectIntoText`：没套模板的首封提交前，把主题栏合并进口令文本——
 *   先替换 `[邮件主题]` / `[主题]`，没有就追加一行 `主题：xxx`
 */

const FROM_PLACEHOLDER = "[发件邮箱]";
const TO_PLACEHOLDER = "[收件邮箱]";
const SUBJECT_PLACEHOLDERS = ["[邮件主题]", "[主题]"];

/** 只替换收发件占位符；value 为空时保留占位符原文。 */
export function applyAddressesToText(text: string, from: string, to: string): string {
  let next = String(text || "");
  if (from) next = next.split(FROM_PLACEHOLDER).join(from);
  if (to) next = next.split(TO_PLACEHOLDER).join(to);
  return next;
}

/** 首封提交前把主题并进口令文本；返回合并后的文本。 */
export function mergeSubjectIntoText(text: string, subject: string): string {
  const body = String(text || "");
  const trimmedSubject = String(subject || "").trim();
  if (!trimmedSubject) return body;
  for (const placeholder of SUBJECT_PLACEHOLDERS) {
    if (body.includes(placeholder)) return body.split(placeholder).join(trimmedSubject);
  }
  const suffix = `主题：${trimmedSubject}`;
  return body.endsWith("\n") ? `${body}${suffix}` : body ? `${body}\n${suffix}` : suffix;
}

/** 输入框是否还留着没被替换的收发件占位符（验收用）。 */
export function hasAddressPlaceholders(text: string): boolean {
  const body = String(text || "");
  return body.includes(FROM_PLACEHOLDER) || body.includes(TO_PLACEHOLDER);
}
