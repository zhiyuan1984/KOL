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

export class HttpFail extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }
}
