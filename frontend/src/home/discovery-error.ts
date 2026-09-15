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

export type DiscoveryErrorKind = "connection" | "timeout" | "cancelled" | "generic";
export type DiscoveryRecoverAction = "plan" | "confirm" | "wait";

export type DiscoveryErrorView = {
  kind: DiscoveryErrorKind;
  title: string;
  message: string;
  detail: string | null;
  retryDisabled: boolean;
  checkConnection: boolean;
  recover: DiscoveryRecoverAction;
  retryLabel: string;
};

export const DISCOVERY_CONNECTION_TITLE = "采集服务连接失败";
export const DISCOVERY_CONNECTION_MESSAGE = "暂时连不上采集服务。请确认服务可用后再检索。";
export const DISCOVERY_GENERIC_TITLE = "检索没有完成";
export const DISCOVERY_GENERIC_FALLBACK = "可调整条件后重试。";
export const DISCOVERY_CRAWL_ACTIVE_MESSAGE = "已有采集任务在进行，请稍后再试";
export const DISCOVERY_TIMEOUT_TITLE = "检索尚未完成";
export const DISCOVERY_TIMEOUT_MESSAGE = "仍在按计划检索红人线索，没有得到完整结果。可继续等待或取消。";
export const DISCOVERY_CANCELLED_TITLE = "已停止等待";
export const DISCOVERY_CANCELLED_MESSAGE = "已停止等待检索结果。检索可能仍在进行。可继续等待或返回修改计划。";

export class DiscoveryWaitTimeoutError extends Error {
  readonly timedOut = true;
  readonly results: unknown;
  constructor(results?: unknown, message = DISCOVERY_TIMEOUT_MESSAGE) {
    super(message);
    this.name = "DiscoveryWaitTimeoutError";
    this.timedOut = true;
    this.results = results;
  }
}

export class DiscoveryWaitCancelledError extends Error {
  readonly cancelled = true;
  constructor(message = DISCOVERY_CANCELLED_MESSAGE) {
    super(message);
    this.name = "DiscoveryWaitCancelledError";
    this.cancelled = true;
  }
}

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

function errorName(raw: unknown): string {
  return raw && typeof raw === "object" && "name" in raw ? String((raw as { name?: unknown }).name || "") : "";
}

function isTimeoutError(raw: unknown): boolean {
  return raw instanceof DiscoveryWaitTimeoutError
    || errorName(raw) === "DiscoveryWaitTimeoutError"
    || errorText(raw) === DISCOVERY_TIMEOUT_MESSAGE
    || Boolean(raw && typeof raw === "object" && (raw as { timedOut?: unknown }).timedOut === true);
}

function isCancelledWait(raw: unknown): boolean {
  return raw instanceof DiscoveryWaitCancelledError
    || errorName(raw) === "DiscoveryWaitCancelledError"
    || errorText(raw) === DISCOVERY_CANCELLED_MESSAGE
    || Boolean(raw && typeof raw === "object" && (raw as { cancelled?: unknown }).cancelled === true);
}

function withRecover(
  view: Omit<DiscoveryErrorView, "recover" | "retryLabel">,
  recover: DiscoveryRecoverAction = "plan",
): DiscoveryErrorView {
  return {
    ...view,
    recover,
    retryLabel: recover === "wait" ? "继续等待" : "重试",
  };
}

/** Map engine / HTTP dumps to employee-facing copy. Raw text stays in `detail` only. */
export function presentDiscoveryError(
  raw: unknown,
  fallback = DISCOVERY_GENERIC_FALLBACK,
  recover: DiscoveryRecoverAction = "plan",
): DiscoveryErrorView {
  const text = errorText(raw);
  const status = errorStatus(raw);
  const detail = text || (status ? `HTTP ${status}` : "");
  if (isTimeoutError(raw)) {
    return withRecover({
      kind: "timeout",
      title: DISCOVERY_TIMEOUT_TITLE,
      message: DISCOVERY_TIMEOUT_MESSAGE,
      detail: null,
      retryDisabled: false,
      checkConnection: false,
    }, "wait");
  }
  if (isCancelledWait(raw)) {
    return withRecover({
      kind: "cancelled",
      title: DISCOVERY_CANCELLED_TITLE,
      message: DISCOVERY_CANCELLED_MESSAGE,
      detail: null,
      retryDisabled: false,
      checkConnection: false,
    }, "wait");
  }
  if (isDiscoveryConnectionFailure(raw) || isDiscoveryConnectionFailure(text)) {
    return withRecover({
      kind: "connection",
      title: DISCOVERY_CONNECTION_TITLE,
      message: DISCOVERY_CONNECTION_MESSAGE,
      detail: detail || null,
      retryDisabled: true,
      checkConnection: true,
    }, recover);
  }
  const crawlActive = crawlActiveCopy(text);
  if (crawlActive) {
    return withRecover({
      kind: "generic",
      title: DISCOVERY_GENERIC_TITLE,
      message: crawlActive,
      detail: looksLikeEngineDump(detail) ? detail : null,
      retryDisabled: false,
      checkConnection: false,
    }, recover);
  }
  if (looksLikeJsonText(text)) {
    return withRecover({
      kind: "generic",
      title: DISCOVERY_GENERIC_TITLE,
      message: fallback,
      detail: looksLikeEngineDump(detail) ? detail : null,
      retryDisabled: false,
      checkConnection: false,
    }, recover);
  }
  const human = text && !looksLikeEngineDump(text) ? text : fallback;
  return withRecover({
    kind: "generic",
    title: DISCOVERY_GENERIC_TITLE,
    message: human,
    detail: detail && (looksLikeEngineDump(detail) || detail !== human) ? detail : null,
    retryDisabled: false,
    checkConnection: false,
  }, recover);
}
