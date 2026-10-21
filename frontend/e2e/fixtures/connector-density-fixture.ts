import { test as base, expect } from "@playwright/test";

// Explicit mock-browser layer: every API stays in this browser context.
// It cannot prove native authentication, MCP connectivity, or real business IO.
const account = { id: "usr_density_fixture", username: "density_fixture", name: "密度测试管理员", available_modes: ["admin", "employee"], current_mode: "admin", roles: ["admin"] };
const connector = { id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据", kind: "app", protocol: "mcp", status: "configured", enabled: 0 };
const tools = [
  { name: "get_creators", description: "读取创作者目录；完整描述在只读 Schema 抽屉中展示。", inputSchema: { type: "object", properties: { limit: { type: "integer" } } }, schema_hash: "fixture_get_creators" },
  { name: "update_creator", description: "更新动作的目录定义，不代表允许执行。", inputSchema: { type: "object", properties: { id: { type: "string" } } }, schema_hash: "fixture_update_creator" },
  { name: "get_creator_profile_with_a_very_long_name_for_layout_checks", description: "用于验证长工具名称和长描述不会把窄容器撑宽。".repeat(4), inputSchema: { type: "object", properties: { id: { type: "string" } } }, schema_hash: "fixture_long_name" },
];
const policies = tools.map((tool, index) => ({ connector_id: "claw", tool_name: tool.name, risk: index === 1 ? "L3" : "L1", enabled: index !== 1, version: 1 }));
const config = { protocol: "mcp", transport: "streamable-http", url: "https://mcp.example.test/mcp", timeout_ms: 30000, allow_unauthenticated: false, headers_secret_refs: { "X-API-Key": "cred_existing_test", Authorization: "cred_second_test" } };
const credentials = [
  { id: "cred_existing_test", label: "采集服务凭据", type: "organization_secret", status: "active", key_version: 1 },
  { id: "cred_second_test", label: "Bearer 凭据", type: "organization_secret", status: "disabled", key_version: 2 },
];
const activity = { probes: [
  { id: 1, config_version: 4, checked_at: "2026-10-19T21:00:00Z", status: "succeeded", probe_kind: "mcp_tools_list", tool_count: 3, duration_ms: 24 },
  { id: 2, config_version: 3, checked_at: "2026-10-19T20:00:00Z", status: "failed", probe_kind: "mcp_tools_list", tool_count: 0, duration_ms: 301, error_code: "fixture_remote_timeout" },
], events: [
  { id: 1, ts: "2026-10-19T20:01:00Z", actor: "density_fixture", event_type: "runtime_connector_config_saved", payload: {} },
  { id: 2, ts: "2026-10-19T20:02:00Z", actor: "density_fixture", event_type: "runtime_connector_probe_completed", payload: {} },
] };

export const test = base.extend<{ apiCalls: string[] }>({
  apiCalls: async ({}, use) => { await use([]); },
  page: async ({ page, apiCalls }, use) => {
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      apiCalls.push(`${method} ${path}`);
      // Tests can register explicit, later mock write handlers when needed.
      if (method !== "GET") return route.fulfill({ status: 405, json: { detail: "UI fixture forbids unregistered writes" } });
      let json: unknown = [];
      if (path === "/api/health") json = { status: "ok", runtime_mode: "ui-fixture" };
      else if (path === "/api/auth/status") json = { authenticated: true, setup_required: false, account };
      else if (path === "/api/me") json = account;
      else if (path === "/api/admin/connectors") json = [connector];
      else if (path.endsWith("/connectors/claw/config")) json = { config, version: 4 };
      else if (path.endsWith("/connectors/claw/activity")) json = activity;
      else if (path.endsWith("/connectors/claw/discovery")) json = { tools, authorization: "fixture-only" };
      else if (path.endsWith("/connectors/claw/policies")) json = policies;
      else if (path === "/api/admin/runtime/credentials") json = credentials;
      else if (path === "/api/cron/jobs") json = { jobs: [], alerts: {} };
      else if (path === "/api/admin/data-policy") json = {};
      await route.fulfill({ json });
    });
    await use(page);
  },
});
export { expect };
