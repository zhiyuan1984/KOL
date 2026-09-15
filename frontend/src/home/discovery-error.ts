/**
 * Employee-facing discovery error presenter. Raw JSON / engine dumps never become the message.
 */
export const DISCOVERY_BANNED_JARGON = [
  "MCP",
  "Codex",
  "MediaCrawler",
  "Harness",
  "crawl_plan",
  "Thread",
  "Streamable",
] as const;

export type DiscoveryErrorKind = "connection" | "generic";

export type DiscoveryErrorView = {
  kind: DiscoveryErrorKind;
  title: string;
  message: string;
  detail: string | null;
  retryDisabled: boolean;
  checkConnection: boolean;
};

export const DISCOVERY_CONNECTION_TITLE = "采集服务连接失败";
export const DISCOVERY_CONNECTION_MESSAGE = "暂时连不上采集服务。请确认服务可用后再检索。";
export const DISCOVERY_GENERIC_TITLE = "检索没有完成";
export const DISCOVERY_GENERIC_FALLBACK = "可调整条件后重试。";
export const DISCOVERY_CRAWL_ACTIVE_MESSAGE = "已有采集任务在进行，请稍后再试";

const CONNECTION_SIGNAL =
  /streamable|econnrefused|enotfound|econnreset|etimedout|eai_again|failed to fetch|fetch failed|network ?error|connection refused|connection reset|err_connection|err_name_not_resolved|err_internet_disconnected|socket hang up|error posting to endpoint|posting to endpoint|远程采集服务未配置|采集服务未配置|发现服务暂未就绪|discovery_not_ready/i;

const ENGINE_DUMP =
  /streamable|http error|status code|econn|enotfound|stack trace|posix|errno|posting to endpoint/i;

function errorText(raw: unknown): string {
  if (raw instanceof Error) return raw.message.trim();
  if (typeof raw === "string") return raw.trim();
  return "";
}

function errorStatus(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || !("status" in raw)) return undefined;
  const status = Number((raw as { status?: unknown }).status);
  return Number.isFinite(status) && status > 0 ? status : undefined;
}

function looksLikeJsonText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function looksLikeEngineDump(text: string): boolean {
  if (!text) return false;
  if (DISCOVERY_BANNED_JARGON.some((word) => text.toLowerCase().includes(word.toLowerCase()))) {
    return true;
  }
  if (ENGINE_DUMP.test(text)) return true;
  const compact = text.replace(/\s/g, "");
  const ascii = compact.replace(/[^\x00-\x7F]/g, "");
  return ascii.length >= 12
    && ascii.length / Math.max(compact.length, 1) > 0.7
    && /error|failed|exception|timeout|refused/i.test(text);
}

function crawlActiveCopy(text: string): string | null {
  if (!text) return null;
  if (text === DISCOVERY_CRAWL_ACTIVE_MESSAGE || text.includes("已有采集任务在进行")) {
    return DISCOVERY_CRAWL_ACTIVE_MESSAGE;
  }
  try {
    const parsed = looksLikeJsonText(text) ? JSON.parse(text) as { code?: unknown } : null;
    if (parsed && String(parsed.code || "") === "crawl_active") return DISCOVERY_CRAWL_ACTIVE_MESSAGE;
  } catch {
    // keep scanning the raw string
  }
  if (/\bcrawl_active\b/.test(text)) return DISCOVERY_CRAWL_ACTIVE_MESSAGE;
  return null;
}

export function isDiscoveryConnectionFailure(raw: unknown): boolean {
  const text = errorText(raw);
  const status = errorStatus(raw);
  if (CONNECTION_SIGNAL.test(text)) return true;
  if ((status === 404 || /\b404\b/.test(text)) && /http|streamable|endpoint|status/i.test(text)) {
    return true;
  }
  if (status === 502 || status === 503 || status === 504) return true;
  return false;
}

/** Map engine / HTTP dumps to employee-facing copy. Raw text stays in `detail` only. */
export function presentDiscoveryError(
  raw: unknown,
  fallback = DISCOVERY_GENERIC_FALLBACK,
): DiscoveryErrorView {
  const text = errorText(raw);
  const status = errorStatus(raw);
  const detail = text || (status ? `HTTP ${status}` : "");
  if (isDiscoveryConnectionFailure(raw) || isDiscoveryConnectionFailure(text)) {
    return {
      kind: "connection",
      title: DISCOVERY_CONNECTION_TITLE,
      message: DISCOVERY_CONNECTION_MESSAGE,
      detail: detail || null,
      retryDisabled: true,
      checkConnection: true,
    };
  }
  const crawlActive = crawlActiveCopy(text);
  if (crawlActive) {
    return {
      kind: "generic",
      title: DISCOVERY_GENERIC_TITLE,
      message: crawlActive,
      detail: looksLikeEngineDump(detail) ? detail : null,
      retryDisabled: false,
      checkConnection: false,
    };
  }
  if (looksLikeJsonText(text)) {
    return {
      kind: "generic",
      title: DISCOVERY_GENERIC_TITLE,
      message: fallback,
      detail: looksLikeEngineDump(detail) ? detail : null,
      retryDisabled: false,
      checkConnection: false,
    };
  }
  const human = text && !looksLikeEngineDump(text) ? text : fallback;
  return {
    kind: "generic",
    title: DISCOVERY_GENERIC_TITLE,
    message: human,
    detail: detail && (looksLikeEngineDump(detail) || detail !== human) ? detail : null,
    retryDisabled: false,
    checkConnection: false,
  };
}
