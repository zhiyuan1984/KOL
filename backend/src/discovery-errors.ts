/**
 * Employee-safe discovery / collector errors (docs/04 + specs/UX-EMPLOYEE copy principle).
 * Never put Streamable HTTP / MCP / Job ID / URL / token in employee message / error / status_label.
 */
import { HttpFail } from "./host/errors.js";

export const COLLECTOR_CONNECT_MESSAGE = "采集服务连接失败";
export const COLLECTOR_NOT_CONFIGURED_MESSAGE = "采集服务未配置";
export const DISCOVERY_FAILED_MESSAGE = "发现未完成，请稍后重试。";
export const CRAWL_ACTIVE_MESSAGE = "已有采集任务在进行，请稍后再试";

const CONNECTION_CLASS =
  /streamable\s*http|streamablehttp|econnrefused|enotfound|etimedout|econnreset|enetunreach|eai_again|ehostunreach|eproto|und_err_connect|und_err_connect_timeout|failed to fetch|fetch failed|networkerror|network request failed|socket hang up|getaddrinfo|connect(?:ion)?(?:\s+\w+)?\s+(?:refused|timed? ?out|reset|failed|aborted)|(?:request |probe )?timed?\s*out|timeout(?:\s+of\s+\d+)?|http\/?s?\s*(?:error[:\s]+)?(?:401|403|404|502|503|504)\b|\(http\s*(?:401|403|404|502|503|504)\)|status(?: code)?[:\s]*(?:401|403|404|502|503|504)|unauthorized|authorization|pos?ting to endpoint|certificate|ssl|tls|self[- ]signed/i;

const ENGINE_LEAK =
  /mediacrawler|remote\s*mcp|mcp\b|codex|streamable|harness|jsonrpc|listtools|initialize|crawl_job|remote_task|job[_ ]?id|authorization|bearer|https?:\/\/|econn|errno|sdk\b/i;

const NOT_CONFIGURED = /未配置|not[_ ]configured|MEDIACRAWLER_MCP_/i;

export function sanitizeSecret(value: unknown): string {
  return String(extractErrorText(value) || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer ***")
    .replace(/(token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=***")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .slice(0, 1000);
}

export function extractErrorText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    if (value instanceof HttpFail) return extractErrorText(value.detail) || value.message;
    return value.message || String(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
    if (typeof obj.error === "string" && obj.error.trim()) return obj.error;
    if (obj.detail != null && obj.detail !== value) return extractErrorText(obj.detail);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function tryParseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value instanceof HttpFail) return tryParseJsonObject(value.detail);
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Error)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function objectCode(value: unknown): string {
  const obj = tryParseJsonObject(value);
  if (!obj) return "";
  return String(obj.code || "").trim();
}

function looksLikeJsonBlob(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(parsed && typeof parsed === "object");
  } catch {
    return /"[^"]*"\s*:/.test(trimmed);
  }
}

export function isConnectionClassError(value: unknown): boolean {
  if (objectCode(value) === "collector_unreachable") return true;
  const text = extractErrorText(value);
  if (!text) return false;
  if (isNotConfiguredError(text)) return false;
  if (text === COLLECTOR_CONNECT_MESSAGE) return true;
  return CONNECTION_CLASS.test(text);
}

export function isNotConfiguredError(value: unknown): boolean {
  return NOT_CONFIGURED.test(extractErrorText(value));
}

function stripEngineTokens(text: string): string {
  return text
    .replace(/MediaCrawler|mediacrawler|RemoteMcpClient|MCP|Codex|Harness|StreamableHTTP|Streamable HTTP/gi, "")
    .replace(/\b(crawl_job_id|remote_task_id|work_item_id|task_id|job[_ ]?id)\b/gi, "")
    .replace(/\b(crawl_[a-z0-9]+|tsk_[a-z0-9]+|drun_[a-z0-9]+)\b/gi, "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function looksLikeEngineCopy(text: string): boolean {
  if (!text) return true;
  if (ENGINE_LEAK.test(text) || CONNECTION_CLASS.test(text)) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, "");
  return letters.length >= 10 && letters.length > cjk.length;
}

function employeeFallback(raw: string): { message: string; detail: string | null } {
  return { message: DISCOVERY_FAILED_MESSAGE, detail: raw || null };
}

export function mapEmployeeError(value: unknown): { message: string; detail: string | null } {
  if (value == null || value === "") return { message: DISCOVERY_FAILED_MESSAGE, detail: null };
  if (objectCode(value) === "crawl_active") {
    const raw = sanitizeSecret(value).trim();
    return { message: CRAWL_ACTIVE_MESSAGE, detail: raw && raw !== CRAWL_ACTIVE_MESSAGE ? raw : null };
  }
  const raw = sanitizeSecret(value).trim();
  if (!raw) return { message: DISCOVERY_FAILED_MESSAGE, detail: null };
  if (isNotConfiguredError(raw)) {
    const cleaned = stripEngineTokens(raw);
    const message = cleaned && !looksLikeEngineCopy(cleaned) && !looksLikeJsonBlob(cleaned)
      ? cleaned
      : COLLECTOR_NOT_CONFIGURED_MESSAGE;
    return { message, detail: raw === message ? null : raw };
  }
  if (isConnectionClassError(raw)) {
    return { message: COLLECTOR_CONNECT_MESSAGE, detail: raw };
  }
  const cleaned = stripEngineTokens(raw);
  if (!cleaned || looksLikeEngineCopy(cleaned) || looksLikeJsonBlob(cleaned) || looksLikeJsonBlob(raw)) {
    const parsed = tryParseJsonObject(value) || tryParseJsonObject(raw);
    const nested = parsed
      ? (typeof parsed.message === "string" && parsed.message.trim())
        || (typeof parsed.error === "string" && parsed.error.trim())
        || ""
      : "";
    if (nested && !looksLikeEngineCopy(nested) && !looksLikeJsonBlob(nested)) {
      return { message: nested, detail: raw === nested ? null : raw };
    }
    return employeeFallback(raw);
  }
  return { message: cleaned, detail: raw === cleaned ? null : raw };
}

/** Employee-facing `error` / `message`. Never engine jargon. */
export function employeeError(value: unknown): string | null {
  if (value == null || value === "") return null;
  return mapEmployeeError(value).message;
}

export function persistableEmployeeError(value: unknown): string {
  return employeeError(value) || DISCOVERY_FAILED_MESSAGE;
}

export function collectorFailureCode(
  value: unknown,
): "collector_not_configured" | "collector_unreachable" | "discovery_failed" | "crawl_active" {
  const code = objectCode(value);
  if (
    code === "collector_not_configured"
    || code === "collector_unreachable"
    || code === "discovery_failed"
    || code === "crawl_active"
  ) {
    return code;
  }
  if (isNotConfiguredError(value)) return "collector_not_configured";
  if (isConnectionClassError(value)) return "collector_unreachable";
  return "discovery_failed";
}
