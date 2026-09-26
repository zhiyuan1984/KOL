import { governanceStatus, publicConnectorView, type AdminRow, type PublicConnector } from "../../adminGovernance";

export type ConnectorKind = "app" | "custom_mcp" | "custom_api";

export type ConnectorCardView = PublicConnector & {
  kind: ConnectorKind;
  protocol: "mcp" | "http";
  iconUrl: string | null;
  approvedToolCount: number;
};

const KIND_LABEL: Record<ConnectorKind, string> = {
  app: "应用",
  custom_mcp: "自定义 MCP",
  custom_api: "自定义 API",
};

export function kindLabel(kind: ConnectorKind): string {
  return KIND_LABEL[kind];
}

export function connectorKind(row: AdminRow): ConnectorKind {
  const kind = String(row.kind || "");
  if (kind === "app" || kind === "custom_mcp" || kind === "custom_api") return kind;
  return "custom_mcp";
}

export function connectorCardView(row: AdminRow): ConnectorCardView {
  const base = publicConnectorView(row);
  return {
    ...base,
    kind: connectorKind(row),
    protocol: String(row.protocol || "mcp") === "http" ? "http" : "mcp",
    iconUrl: row.icon_url ? String(row.icon_url) : null,
    approvedToolCount: Number(row.approved_tool_count || 0) || 0,
  };
}

export function connectorHref(id: string): string {
  return `/admin/connectors/${encodeURIComponent(id)}`;
}

/** Next step for the hub card, aligned with the governance status machine. */
export function connectorActionLabel(connector: PublicConnector): string {
  switch (governanceStatus(connector).key) {
    case "draft":
      return "开始接入";
    case "pending":
    case "error":
      return "继续配置";
    case "verified":
      return "审阅接口并启用";
    default:
      return "查看治理";
  }
}

export function connectorStatusNote(connector: PublicConnector): string {
  switch (governanceStatus(connector).key) {
    case "enabled":
      return "已启用；接口仍受逐项范围约束。";
    case "verified":
      return "连接已验证；完成接口治理与范围后可启用。";
    case "pending":
      return "配置已保存；下一步测试工具目录。";
    case "error":
      return "最近测试未通过；修正后重试。";
    case "disabled":
      return "已停用；重新验证后可再次启用。";
    default:
      return "尚未接入；先保存连接信息并测试。";
  }
}

export function slugFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const prefixed = /^[a-z]/.test(slug) ? slug : `mcp-${slug}`;
  return prefixed.slice(0, 63);
}

export function isConnectorIdValid(id: string): boolean {
  return /^[a-z][a-z0-9_-]{2,63}$/.test(id);
}

export function friendlyScopeFailure(code: string): string {
  if (code === "runtime_connector_scope_bindings_required") return "「指定范围」至少需要选择一个部门、组、岗位或个人。";
  if (code === "runtime_connector_scope_node_unknown") return "所选范围节点已不存在；请刷新后重试。";
  return "";
}
