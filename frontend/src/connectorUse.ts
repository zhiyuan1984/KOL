/** Employee-only helpers for the connector use surface. Do not import adminGovernance. */

import type { StarryBinding } from "./api";

const LABELS: Record<string, string> = {
  enterprise_mail: "品牌邮箱",
  wecom: "企业微信审批",
  starry: "红人库与跟进邮箱",
  starrykol: "红人库与跟进邮箱",
  emailmcp: "历史邮箱连接",
  claw: "达人评分与建联",
  kolclaw: "达人评分与建联",
  crawl: "达人采集",
  mediacrawl: "达人采集",
};

const MEANING: Record<string, string> = {
  enterprise_mail: "用品牌邮箱发信和查看往来。",
  wecom: "费用审批卡片会发到企业微信。",
  starry: "查看红人库和负责人；首页「我跟进的红人」按已绑定的跟进邮箱过滤。",
  starrykol: "查看红人库和负责人；首页「我跟进的红人」按已绑定的跟进邮箱过滤。",
  emailmcp: "历史邮箱连接，已不再作为主路径。",
  claw: "达人评分、建联话术和每日任务。",
  kolclaw: "达人评分、建联话术和每日任务。",
  crawl: "达人采集任务。",
  mediacrawl: "达人采集任务。",
};

export type ConnectorUseStatusKey = "available" | "needs_personal_bind";

export function isBindableConnector(id: string): boolean {
  return /starry/i.test(id);
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

export function connectorUseStatus(
  id: string,
  binding: StarryBinding | null,
): { key: ConnectorUseStatusKey; label: string } {
  if (isBindableConnector(id) && (!binding?.bound || binding.status === "expired" || binding.status === "unbound")) {
    return { key: "needs_personal_bind", label: "需个人绑定" };
  }
  return { key: "available", label: "可用" };
}
