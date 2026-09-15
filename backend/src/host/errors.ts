import type { Json } from "../types.js";

export class HostReject extends Error {
  statusCode: number;
  payload: Json;

  constructor(statusCode: number, payload: Json) {
    super(String((payload.error as Json | undefined)?.message || statusCode));
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function httpFailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export class HttpFail extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(httpFailMessage(detail));
    this.status = status;
    this.detail = detail;
  }
}
