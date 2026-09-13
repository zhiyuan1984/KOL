/** Home-card mail preview. Frontend-only: never dump a bilingual body on the card. */

export const MAIL_PREVIEW_MAX = 88;

const GREETING_LEAD = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))\b[\s,!.:-]*/i;
const SIGN_OFF = /\b(best regards|kind regards|sincerely|cheers|thanks(?:\s+again)?|此致敬礼|谢谢)\b[\s\S]*$/i;

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

/**
 * Chinese clause that may embed Latin brand tokens (litime / LiTime).
 * Do not use `[^A-Za-z]` here — that splits 贵品牌litime合作 into a trailing 合作….
 */
const ZH_CLAUSE_WITH_LATIN =
  /[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9&+\-'"’\s,，、；:：]{4,200}[\u4e00-\u9fff。！？]?/g;

/** Prefer a short Chinese clause when the snippet is a bilingual dump. */
export function pickMailPreviewSource(text: string): string {
  const cleaned = stripMailChrome(text);
  if (!cleaned) return "";
  // Sentence punctuation only — never split on ASCII letters inside Chinese.
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

export function summarizeMailSnippet(raw: string, max = MAIL_PREVIEW_MAX): string {
  const source = pickMailPreviewSource(raw);
  if (!source) return "";
  if (source.length <= max) return source;
  const clipped = source.slice(0, max);
  const atWord = clipped.replace(/\s+\S*$/, "").trim();
  return `${(atWord.length >= 24 ? atWord : clipped).trim()}…`;
}

export function latestMailThread<T extends { last_at?: string | null }>(threads: T[] | undefined): T | undefined {
  if (!threads?.length) return undefined;
  return [...threads].sort((a, b) => {
    const aTime = a.last_at ? Date.parse(String(a.last_at)) : 0;
    const bTime = b.last_at ? Date.parse(String(b.last_at)) : 0;
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  })[0];
}
