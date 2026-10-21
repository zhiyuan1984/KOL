import type { BusinessMapCatalog, BusinessMapCompany, BusinessMapEntity, BusinessMapGroup, BusinessMapRecord, BusinessMapRecordField, BusinessMapRecords, BusinessMapSource } from "./types";

export const BUSINESS_MAP_PAGE_SIZE = 20;

export type CatalogMatch = {
  group: BusinessMapGroup;
  entities: BusinessMapEntity[];
  entityMatched: boolean;
};

export function textValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}

export function formatSourceTime(value: string): string {
  if (typeof value !== "string") return "时间未提供";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}（北京时间）$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return "时间未提供";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Shanghai", hourCycle: "h23",
  }).format(date).replace(/\//g, "-") + "（北京时间）";
}

export function companyOptions(catalog: BusinessMapCatalog | null): BusinessMapCompany[] {
  if (!catalog) return [];
  return catalog.context.companies.map((company, index) => {
    const entry = typeof company === "string" ? { id: company, name: "" } : company;
    const name = entry.name && entry.name !== entry.id ? entry.name : `公司 ${index + 1}`;
    return { id: entry.id, name };
  }).filter((company) => company.id && company.name);
}

export function selectedEntity(catalog: BusinessMapCatalog | null, code: string): { group: BusinessMapGroup; entity: BusinessMapEntity } | null {
  if (!catalog || !code) return null;
  for (const group of catalog.groups) {
    const entity = group.entities.find((item) => item.code === code);
    if (entity) return { group, entity };
  }
  return null;
}

export function selectedSource(entity: BusinessMapEntity | undefined, source: string): BusinessMapSource | null {
  return entity?.sources.find((item) => item.id === source) ?? null;
}

export function filterCatalog(groups: BusinessMapGroup[], domains: string[], search: string): CatalogMatch[] {
  const needle = search.trim().toLocaleLowerCase();
  return groups.flatMap((group) => {
    if (domains.length && !domains.includes(group.path[1])) return [];
    const groupText = [group.name, ...group.path].join(" ").toLocaleLowerCase();
    const groupMatched = !needle || groupText.includes(needle);
    const matches = group.entities.filter((entity) => entity.name.toLocaleLowerCase().includes(needle));
    if (!groupMatched && !matches.length) return [];
    return [{ group, entities: groupMatched ? group.entities : matches, entityMatched: matches.length > 0 }];
  });
}

export function sourceStatus(status: BusinessMapRecords["status"] | "unknown" | "forbidden"): { label: string; detail: string } {
  if (status === "not_connected") return { label: "尚未接入", detail: "该实体的数据尚未接入" };
  if (status === "not_read") return { label: "尚未读取", detail: "尚未读取资料" };
  if (status === "forbidden") return { label: "不可查看", detail: "当前范围不可查看" };
  if (status === "unknown") return { label: "来源未知", detail: "当前实体未提供可读数据来源" };
  return { label: "可读取", detail: "当前来源资料可读取" };
}

export function detailFields(record: BusinessMapRecord, summaryKeys: Set<string>): BusinessMapRecordField[] {
  return record.fields.filter((field) => !summaryKeys.has(field.key));
}

export function recordScopeKey(companyId: string, entityCode: string, source: string, q: string, unit: string, page: number): string {
  return [companyId, entityCode, source, q, unit, String(page)].join("|");
}

export function parseIndexList(value: string | null): Set<number> {
  return new Set((value || "").split(",").filter(Boolean).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0));
}

export function serializeIndexList(values: Set<number>): string {
  return [...values].sort((a, b) => a - b).join(",");
}
