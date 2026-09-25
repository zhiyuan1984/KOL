/** Admin-only helpers for docs/org-permissions.md governance IA. Do not use on employee surfaces. */

export type AdminRow = Record<string, unknown>;

export type PublicConnector = {
  id: string;
  label: string;
  enabled: boolean;
  status: string;
  credentialRegistered: boolean;
  updatedAt: string;
  lastVerifiedAt: string;
  lastError: string;
};

export type GovernanceStatus = "draft" | "pending" | "verified" | "enabled" | "disabled" | "error";

export const GOVERNANCE_STATUS_LABEL: Record<GovernanceStatus, string> = {
  draft: "待配置",
  pending: "待验证",
  verified: "已验证待启用",
  enabled: "已启用",
  disabled: "已停用",
  error: "验证失败",
};

/** Fixed product catalog; never infer purpose from a legacy connector alias. */
export const CONNECTOR_PURPOSE: Record<string, string> = {
  claw: "创作者采集、检索与画像数据",
  starrykol: "红人库、负责人与合作往来事实",
};

export function sanitizeAdminText(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [已脱敏]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT 已脱敏]")
    .replace(/\b(?:sk-|api[_-]?key[=:\s]*)[A-Za-z0-9_-]{8,}/gi, "[密钥已脱敏]");
}

export function rowTitle(row: AdminRow): string {
  return String(row.name || row.title || row.label || row.email || row.id || "未命名");
}

export function publicConnectorView(row: AdminRow): PublicConnector {
  const credentialRegistered = Boolean(row.credential_reference || row.credential_ref || row.reference);
  return {
    id: String(row.id || ""),
    label: String(row.label || row.name || row.id || "未命名"),
    enabled: row.enabled !== false && row.enabled !== 0,
    status: String(row.status || ""),
    credentialRegistered,
    updatedAt: row.updated_at ? String(row.updated_at) : "",
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : "",
    lastError: sanitizeAdminText(row.last_error || row.lastError || row.error || ""),
  };
}

export function governanceStatus(connector: PublicConnector): { key: GovernanceStatus; label: string } {
  const raw = connector.status.toLowerCase();
  if (raw === "error" || raw === "failed" || raw === "verification_failed" || raw === "异常") {
    return { key: "error", label: GOVERNANCE_STATUS_LABEL.error };
  }
  if (connector.enabled) return { key: "enabled", label: GOVERNANCE_STATUS_LABEL.enabled };
  if (raw === "verified") return { key: "verified", label: GOVERNANCE_STATUS_LABEL.verified };
  if (raw === "pending_verification" || raw === "configured" || raw === "ready") {
    return { key: "pending", label: GOVERNANCE_STATUS_LABEL.pending };
  }
  if (raw === "disabled") return { key: "disabled", label: GOVERNANCE_STATUS_LABEL.disabled };
  return { key: "draft", label: GOVERNANCE_STATUS_LABEL.draft };
}

export function connectorPurpose(id: string): string {
  return CONNECTOR_PURPOSE[id] || "";
}

export function isStarryConnector(id: string): boolean {
  return /starry/i.test(id);
}

export function parseConnectorGrant(value: unknown): { connectorId: string; access: string } | null {
  const raw = String(value || "");
  const [connectorId, access] = raw.split(":");
  if (!connectorId) return null;
  return { connectorId, access: access || "read" };
}

export function connectorGrantsOf(user: AdminRow): { connectorId: string; access: string }[] {
  const raw = Array.isArray(user.connector_grants) ? user.connector_grants : [];
  return raw.map(parseConnectorGrant).filter((row): row is { connectorId: string; access: string } => Boolean(row));
}

export function grantCountFor(connectorId: string, users: AdminRow[]): number {
  return users.filter((user) => connectorGrantsOf(user).some((grant) => grant.connectorId === connectorId)).length;
}

export function accessFor(user: AdminRow, connectorId: string): string | null {
  return connectorGrantsOf(user).find((grant) => grant.connectorId === connectorId)?.access ?? null;
}

export function publishStatusLabel(manifest: {
  status?: string;
  publish_gate?: { state?: string; employee_submission?: boolean };
} | null): { key: string; label: string; canSubmit: boolean | null } {
  if (!manifest) return { key: "unknown", label: "未读取到发布包", canSubmit: null };
  const state = String(manifest.publish_gate?.state || "").trim();
  const status = String(manifest.status || "").trim();
  const canSubmit = typeof manifest.publish_gate?.employee_submission === "boolean"
    ? manifest.publish_gate.employee_submission
    : null;
  if (state === "unpublished" || status === "unpublished") {
    return { key: "unpublished", label: "unpublished", canSubmit };
  }
  if (state === "pilot-not-production" || status === "pilot" || status === "pilot-not-production") {
    return { key: "pilot-not-production", label: "pilot-not-production", canSubmit };
  }
  if (state === "published" || status === "production" || status === "published") {
    return { key: "published", label: "已发布", canSubmit };
  }
  return { key: state || status || "unknown", label: state || status || "未知", canSubmit };
}

export function isConnectorAudit(eventType: string): boolean {
  return /connector/.test(eventType);
}

export function isGrantAudit(eventType: string): boolean {
  return /grant|approval_role/.test(eventType);
}

export function isBindAudit(eventType: string): boolean {
  return /bind|starry/.test(eventType);
}

export function auditTouchesConnector(row: AdminRow, connectorId: string): boolean {
  const eventType = String(row.event_type || "");
  if (!isConnectorAudit(eventType)) return false;
  const payload = row.payload && typeof row.payload === "object" ? row.payload as AdminRow : {};
  const hit = String(payload.connector_id || payload.id || "");
  return !hit || hit === connectorId;
}
