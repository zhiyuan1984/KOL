/** Employee-only helpers for the connector use surface. Do not import adminGovernance. */

import type { StarryBinding } from "./api";

const LABELS: Record<string, string> = {
  claw: "MediaCrawler MCP",
  starrykol: "Starry KOL MCP",
};

const MEANING: Record<string, string> = {
  claw: "读取创作者采集、检索与画像数据。",
  starrykol: "查看红人库和负责人；首页「我跟进的红人」按已绑定的跟进邮箱过滤。",
};

export type ConnectorUseStatusKey = "available" | "needs_personal_bind" | "expired";
export type ConnectorUseAccess = "read" | "write";

export function isBindableConnector(id: string): boolean {
  return /starry/i.test(id);
}

export function connectorUseAccess(value: unknown): ConnectorUseAccess {
  return value === "read" ? "read" : "write";
}

export function connectorBindHref(id: string): string {
  const params = new URLSearchParams({
    tab: "starry",
    from: "connectors",
    connector: id,
  });
  return `/settings?${params.toString()}`;
}

export function connectorUseLabel(id: string, fallback?: unknown): string {
  if (LABELS[id]) return LABELS[id];
  const raw = String(fallback || id).trim()
    .replace(/\bMCP\b/gi, "")
    .replace(/\bCodex\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return raw || id;
}

export function connectorUseMeaning(id: string): string {
  return MEANING[id] || "已授权给你使用。具体范围由管理员开通。";
}

export function preferCanonicalConnectors<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.id === "claw" || row.id === "starrykol");
}

export function connectorUseStatus(
  id: string,
  binding: StarryBinding | null,
): { key: ConnectorUseStatusKey; label: string } {
  if (!isBindableConnector(id)) {
    return { key: "available", label: "可用" };
  }
  if (binding?.status === "expired") {
    return { key: "expired", label: "已过期" };
  }
  if (!binding?.bound || binding.status === "unbound") {
    return { key: "needs_personal_bind", label: "需个人绑定" };
  }
  return { key: "available", label: "可用" };
}
