/**
 * Host 只抽金额与小时单价，不靠它锁 Skill。
 * 「写报价邮件」里的「报价」不能当成金额前缀。
 * 「价格5000美金1小时」必须和 「金额 680」一样进入 amount_usd，
 * 并写进英文正文与内部中文译稿，不能只改元数据。
 */
export type QuoteRate = {
  amount_usd: number | null;
  currency: string | null;
  rate_unit: "hour" | null;
};

export type QuoteOffer = {
  amount_usd: number | null;
  currency: string | null;
  deliverables: string | null;
};

const SKILL_NOISE = /\/?(?:写一份报价邮件|写一封报价邮件|写报价邮件|写报价信|写报价|报价确认邮件|报价邮件)/g;
const HOUR_RE = /(?:[/／每]\s*)?(?:per\s+)?(?:1\s*)?(?:小时|(?:hrs?|hours?)\b)/i;

function aroundHour(text: string, index: number, length: number): boolean {
  const slice = text.slice(Math.max(0, index - 12), index + length + 18);
  return HOUR_RE.test(slice);
}

export function parseQuoteRate(text: string): QuoteRate {
  const raw = String(text || "");
  const cleaned = raw.replace(SKILL_NOISE, " ").replace(/\s+/g, " ").trim();
  const haystacks = [cleaned, raw];
  const patterns = [
    /([0-9]+(?:\.[0-9]+)?)\s*(?:美金|美元|USD|usd|\$)/i,
    /(?<![0-9.])(?:金额|价格|USD|usd|美金|美元|\$)\s*(?:改成|换成|是|为)?\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:美金|美元|USD|usd|\$)?/i,
    /(?:报价|rate|CPM|cpm)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const hay of haystacks) {
    for (const pattern of patterns) {
      const match = pattern.exec(hay);
      if (!match) continue;
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      return {
        amount_usd: amount,
        currency: "USD",
        rate_unit: aroundHour(hay, match.index, match[0].length) || HOUR_RE.test(hay) ? "hour" : null,
      };
    }
  }
  return { amount_usd: null, currency: null, rate_unit: null };
}

export function formatQuoteRate(amount: number, currency = "USD", rateUnit?: string | null): string {
  const code = currency || "USD";
  return rateUnit === "hour" ? `${code} ${amount} per hour` : `${code} ${amount}`;
}

export function looksLikeEmailDraft(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^(hi|hello|dear)\b/i.test(t)) return true;
  return /\nbest[,，]/i.test(t) && t.length > 40;
}

export function parseQuoteOffer(text: string): QuoteOffer {
  const rate = parseQuoteRate(text);
  return {
    amount_usd: rate.amount_usd,
    currency: rate.currency,
    deliverables: rate.rate_unit === "hour" ? "1 hour" : null,
  };
}

export function bodyContainsAmount(body: string, amount: number): boolean {
  const compact = String(amount).replace(/\.0+$/, "");
  const escaped = compact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:USD|US\\$|\\$)?\\s*${escaped}(?:\\.0+)?\\b`, "i").test(body);
}

function rateUnitOf(offer: QuoteOffer): "hour" | null {
  return offer.deliverables && /hour|小时/i.test(offer.deliverables) ? "hour" : null;
}

function rateLineEn(offer: QuoteOffer): string {
  const amount = offer.amount_usd;
  if (amount == null) return "";
  const formatted = formatQuoteRate(amount, offer.currency || "USD", rateUnitOf(offer));
  return `The collaboration quote is ${formatted}. This is a quote, not a confirmed deal.`;
}

function rateLineZh(offer: QuoteOffer): string {
  const amount = offer.amount_usd;
  if (amount == null) return "";
  const currency = offer.currency || "USD";
  const unit = rateUnitOf(offer) ? "，按小时计" : "";
  return `报价金额 ${currency} ${amount}${unit}。询问或确认报价不等于已经成交。`;
}

function injectBeforeSignoff(body: string, line: string): string {
  const text = String(body || "").trim();
  if (!line) return text;
  if (!text) return `${line}\n`;
  const sign = /\n(?:Best|Thanks|Thank you|Regards|Cheers),?\s*\n/i.exec(text);
  if (sign && sign.index != null) {
    return `${text.slice(0, sign.index).trimEnd()}\n\n${line}\n${text.slice(sign.index)}`;
  }
  return `${text}\n\n${line}\n`;
}

export function ensureQuoteInBody(body: string, offer: QuoteOffer): string {
  if (offer.amount_usd == null) return String(body || "");
  const current = String(body || "");
  if (bodyContainsAmount(current, offer.amount_usd)) {
    if (rateUnitOf(offer) && !/hour|小时|per hour/i.test(current)) {
      return injectBeforeSignoff(current, `The quoted rate is ${formatQuoteRate(offer.amount_usd, offer.currency || "USD", "hour")}.`);
    }
    return current;
  }
  return injectBeforeSignoff(current, rateLineEn(offer));
}

export function ensureQuoteInZh(zh: string, offer: QuoteOffer): string {
  if (offer.amount_usd == null) return String(zh || "");
  const current = String(zh || "").trim();
  const fact = rateLineZh(offer);
  if (bodyContainsAmount(current, offer.amount_usd)) {
    if (rateUnitOf(offer) && !/小时|hour/i.test(current)) {
      return current ? `${current}\n${fact}` : fact;
    }
    return current;
  }
  const prefix = current.includes("内部译稿") ? "" : "内部译稿（不进 SMTP）。";
  return `${prefix}${fact}${current ? `\n${current}` : ""}`.trim();
}

export function quoteZhInternal(body: string, offer: QuoteOffer): string {
  const withPrice = ensureQuoteInZh("", offer);
  const english = String(body || "").trim();
  if (!withPrice && !english) return "";
  if (!english) return withPrice;
  if (!withPrice) return `内部译稿（不进 SMTP）。\n${english}`;
  return `${withPrice}\n\n${english}`;
}
