import type { BusinessMapCatalog, BusinessMapRecordQuery, BusinessMapRecords } from "./types";

export class BusinessMapRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "BusinessMapRequestError";
  }
}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) return "当前范围不可查看";
  if (status === 404) return "资料暂时无法读取，请重试";
  return "资料暂时无法读取，请重试";
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BusinessMapRequestError(0, "资料暂时无法读取，请重试");
  }
  if (!response.ok) throw new BusinessMapRequestError(response.status, messageForStatus(response.status));
  try {
    return await response.json() as T;
  } catch {
    throw new BusinessMapRequestError(response.status, "资料暂时无法读取，请重试");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isCatalog(value: unknown): value is BusinessMapCatalog {
  if (!isObject(value) || !isObject(value.context) || typeof value.context.companyId !== "string" || !Array.isArray(value.context.companies) || !Array.isArray(value.groups)) return false;
  return value.groups.every((group) => isObject(group) && typeof group.id === "string" && Array.isArray(group.path) && group.path.length === 4 && group.path.every((part) => typeof part === "string") && Array.isArray(group.entities));
}

function isRecordsFor(value: unknown, query: BusinessMapRecordQuery): value is BusinessMapRecords {
  if (!isObject(value) || !Array.isArray(value.records)) return false;
  return value.companyId === query.companyId
    && value.entityCode === query.entityCode
    && value.source === query.source
    && value.page === query.page
    && value.pageSize === query.pageSize;
}

export function catalogUrl(companyId?: string): string {
  const query = new URLSearchParams();
  if (companyId) query.set("companyId", companyId);
  return `/api/business-map/catalog${query.size ? `?${query.toString()}` : ""}`;
}

export function recordsUrl(query: BusinessMapRecordQuery): string {
  const search = new URLSearchParams({
    companyId: query.companyId,
    entityCode: query.entityCode,
    source: query.source,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.q) search.set("q", query.q);
  if (query.unit) search.set("unit", query.unit);
  return `/api/business-map/records?${search.toString()}`;
}

export function getBusinessMapCatalog(companyId?: string, signal?: AbortSignal): Promise<BusinessMapCatalog> {
  return getJson<unknown>(catalogUrl(companyId), signal).then((response) => {
    if (!isCatalog(response) || (companyId && response.context.companyId !== companyId)) {
      throw new BusinessMapRequestError(502, "资料暂时无法读取，请重试");
    }
    return response;
  });
}

export function getBusinessMapRecords(query: BusinessMapRecordQuery, signal?: AbortSignal): Promise<BusinessMapRecords> {
  return getJson<unknown>(recordsUrl(query), signal).then((response) => {
    if (!isRecordsFor(response, query)) throw new BusinessMapRequestError(502, "资料暂时无法读取，请重试");
    return response;
  });
}
