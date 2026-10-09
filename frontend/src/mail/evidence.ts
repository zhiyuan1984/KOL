export type MailEvidenceQuote = { source: string; snippet: string };
export type MailEvidenceFocus = { source: string; snippet: string; request: number };

/** Presentation only: exact source excerpts, never a new stage judgment. */
export function evidenceQuotes(value: unknown): MailEvidenceQuote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const { source, snippet } = item as Record<string, unknown>;
    return typeof source === "string" && typeof snippet === "string" && snippet.trim()
      ? [{ source, snippet: snippet.trim() }] : [];
  });
}

export function quotePosition(text: string, quote: string): number {
  return quote ? text.indexOf(quote) : -1;
}

export function mailExcerpt(body: string | null, preview: string, quotes: MailEvidenceQuote[]): { text: string; quote: string; label: string } {
  const quote = quotes.find(item => item.source === "body" && body && quotePosition(body, item.snippet) >= 0)?.snippet || "";
  if (body && quote) {
    const at = quotePosition(body, quote);
    const start = Math.max(body.lastIndexOf("\n", at), body.lastIndexOf(". ", at)) + 1;
    const end = body.indexOf("\n", at + quote.length);
    return { text: body.slice(start, end < 0 ? body.length : end).trim(), quote, label: "原文摘录" };
  }
  return { text: (body === null ? preview : body).trim(), quote: "", label: body === null ? "已同步预览" : "正文预览" };
}

/** Fold only explicit boundaries. Concatenating the parts retains every character. */
export function splitMailBody(body: string): { main: string; signature: string; history: string } {
  const historyAt = body.search(/^(?:On .{1,200}wrote:|在.{1,200}写道[：:]|[- ]{2,}(?:Original Message|Forwarded message)[- ]*|>{1,}\s)/mi);
  const current = historyAt < 0 ? body : body.slice(0, historyAt);
  const signatureAt = current.search(/^(?:-- ?\r?$|(?:Best regards|Kind regards|Regards|Sincerely|Cheers)[,!]?\s*\r?$)/mi);
  return {
    main: signatureAt < 0 ? current : current.slice(0, signatureAt),
    signature: signatureAt < 0 ? "" : current.slice(signatureAt),
    history: historyAt < 0 ? "" : body.slice(historyAt),
  };
}
