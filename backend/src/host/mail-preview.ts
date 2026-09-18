/** Mail card preview. Rule-only: never call a model. Mirrors frontend/src/mailPreview.ts. */

export const MAIL_PREVIEW_MAX = 88;

const GREETING_LEAD = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))\b[\s,!.:-]*/i;
const SIGN_OFF = /\b(best regards|kind regards|sincerely|cheers|thanks(?:\s+again)?|此致敬礼|谢谢)\b[\s\S]*$/i;
const EMAIL_ADDR = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const HEADER_FIELD = /^(from|to|reply-to|cc|bcc|subject|date|sent|sender|return-path)\s*:/im;
const HEADER_DUMP = /原始(?:发件人|邮件)|(?:发件人|收件人|回复地址|主题|日期)\s*[:：]|reply-to\s*:|return-path|mime-version/i;
const ZH_CLAUSE_WITH_LATIN =
  /[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9&+\-'"’\s,，、；:：]{4,200}[\u4e00-\u9fff。！？]?/g;

export function isMailHeaderDump(raw: string): boolean {
  const text = stripMailChrome(raw);
  if (!text) return true;
  if (HEADER_DUMP.test(text) || HEADER_FIELD.test(text)) return true;
  const withoutEmails = text
    .replace(new RegExp(EMAIL_ADDR.source, "gi"), "")
    .replace(/[<>&;=\s,]/g, "");
  return EMAIL_ADDR.test(text) && withoutEmails.length < 8;
}

export function stripMailChrome(raw: string): string {
  return String(raw || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cjkCount(value: string): number {
  return (value.match(/[\u4e00-\u9fff]/g) || []).length;
}

export function pickMailPreviewSource(text: string): string {
  if (isMailHeaderDump(text)) return "";
  const cleaned = stripMailChrome(text);
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[。！？\n])|(?<=\.\s)/).map((part) => part.trim()).filter(Boolean);
  const zhSentence = sentences
    .filter((sentence) => cjkCount(sentence) >= 6)
    .sort((a, b) => cjkCount(b) - cjkCount(a) || b.length - a.length)[0];
  if (zhSentence) return zhSentence.replace(SIGN_OFF, "").trim();
  const clauses = cleaned.match(ZH_CLAUSE_WITH_LATIN) || [];
  const bestClause = [...clauses].sort((a, b) => cjkCount(b) - cjkCount(a) || b.length - a.length)[0];
  if (bestClause && cjkCount(bestClause) >= 6) return bestClause.replace(SIGN_OFF, "").trim();
  const withoutGreeting = cleaned.replace(GREETING_LEAD, "").replace(SIGN_OFF, "").trim();
  return withoutGreeting || cleaned;
}

/** Sync-time preview: strip headers, prefer Chinese, 88 chars. Never calls a model. */
export function mailPreview(raw: string, max = MAIL_PREVIEW_MAX): string {
  const source = pickMailPreviewSource(raw);
  if (!source) return "";
  if (source.length <= max) return source;
  const clipped = source.slice(0, max);
  const atWord = clipped.replace(/\s+\S*$/, "").trim();
  return `${(atWord.length >= 24 ? atWord : clipped).trim()}…`;
}

export function summarizeMailSnippet(raw: string, max = MAIL_PREVIEW_MAX): string {
  return mailPreview(raw, max);
}
