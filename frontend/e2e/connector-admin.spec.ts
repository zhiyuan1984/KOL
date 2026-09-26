import { expect, test, type APIRequestContext } from "@playwright/test";

const TEST_ID = "e2e-url-add";
const IMPORT_ID = "e2e-json-import";
// Runtime governance writes refuse anonymous access outside NODE_ENV=test, so the
// save flows only run against an auth-enabled E2E server. The stub suite keeps
// the read/render and import coverage.
const AUTH_ENABLED = process.env.E2E_AUTH_MODE === "enabled";

async function cleanup(request: APIRequestContext) {
  await request.delete(`/api/admin/connectors/${TEST_ID}`).catch(() => undefined);
  await request.delete(`/api/admin/connectors/${IMPORT_ID}`).catch(() => undefined);
  const listed = await request.get("/api/admin/runtime/credentials").catch(() => null);
  if (!listed || !listed.ok()) return;
  const rows = (await listed.json()) as Array<{ id: string; label?: string; version: number }>;
  for (const row of rows.filter((item) => String(item.label || "").startsWith("E2E "))) {
    await request.delete(`/api/admin/runtime/credentials/${row.id}`, { data: { expected_version: row.version } }).catch(() => undefined);
  }
}

test.beforeEach(async ({ request }) => {
  await cleanup(request);
});

test.afterEach(async ({ request }) => {
  await cleanup(request);
});

test("connector hub renders, filters, toggles browse tabs and opens the create menu", async ({ page }) => {
  await page.goto("/admin/connectors");
  await expect(page.locator("[data-admin-page='connectors']")).toBeVisible();
  await expect(page.locator("[data-connector-hub-title]")).toHaveText("已添加的连接器");
  await expect(page.locator('[data-admin-connectors-table] [data-connector="claw"]')).toBeVisible();
  await expect(page.locator('[data-admin-connectors-table] [data-connector="starrykol"]')).toBeVisible();

  await page.locator("[data-connector-search]").fill("Starry");
  await expect(page.locator("[data-admin-connectors-table] [data-connector]")).toHaveCount(1);
  await expect(page.locator('[data-admin-connectors-table] [data-connector="starrykol"]')).toBeVisible();
  await page.locator("[data-connector-search]").fill("");
  await expect(page.locator('[data-admin-connectors-table] [data-connector="claw"]')).toBeVisible();

  await page.locator("[data-connector-create-toggle]").click();
  await expect(page.locator("[data-connector-create-menu]")).toBeVisible();
  await expect(page.locator("[data-connector-create-item]")).toHaveCount(3);
  await expect(page.locator("[data-connector-create-item='mcp']")).toBeVisible();
  await expect(page.locator("[data-connector-create-item='json']")).toBeVisible();
  await expect(page.locator("[data-connector-create-item='url']")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-connector-create-menu]")).toHaveCount(0);

  await page.locator("[data-connector-browse-toggle]").click();
  await expect(page.locator("[data-connector-hub-title]")).toHaveText("连接器");
  await expect(page.locator("[data-connector-tab='app']")).toBeVisible();
  await page.locator("[data-connector-tab='custom_mcp']").click();
  await expect(page.locator("[data-connector-card-new]")).toBeVisible();
});

test("connector detail surfaces the governance cards", async ({ page }) => {
  await page.goto("/admin/connectors/claw");
  await expect(page.locator("[data-admin-page='connector-detail']")).toBeVisible();
  await expect(page.locator("[data-connector-config-card]")).toBeVisible();
  await expect(page.locator("[data-connector-tools]")).toBeVisible();
  await expect(page.locator("[data-connector-scope]")).toBeVisible();
  await expect(page.locator("[data-admin-grants]")).toBeVisible();
  await expect(page.locator("[data-connector-copy-id]")).toBeVisible();
  await expect(page.locator("[data-connector-status-note]")).not.toHaveText("");
});

test("JSON import previews mcpServers before writing and imports on confirm", async ({ page }) => {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='json']").click();
  await expect(page.locator("[data-connector-panel='json-import']")).toBeVisible();

  await page.locator("[data-connector-import-json]").fill(JSON.stringify({
    mcpServers: {
      [IMPORT_ID]: { type: "sse", url: "https://mcp.e2e.example/sse" },
    },
  }));
  await page.locator("[data-connector-import-preview]").click();
  await expect(page.locator("[data-connector-import-preview-result]")).toContainText("1 个可导入");
  await expect(page.locator("[data-connector-import-preview-result]")).toContainText("SSE");

  await page.locator("[data-connector-import-confirm]").click();
  await expect(page.locator("[data-connector-import-result]")).toContainText("已导入 1 个连接器");
  await page.locator("[data-connector-panel='json-import'] button", { hasText: "完成" }).click();
  await expect(page.locator(`[data-connector-card][data-connector="${IMPORT_ID}"]`)).toBeVisible();
  await expect(page.locator(`[data-connector-card][data-connector="${IMPORT_ID}"]`)).toContainText("待验证");
});

test("URL add flow creates a pending connector with governance cards", async ({ page }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='url']").click();
  await expect(page.locator("[data-connector-panel='url-add']")).toBeVisible();

  await page.locator("[data-connector-field='label']").fill("E2E URL MCP");
  await page.locator("[data-connector-field='url']").fill("https://mcp.e2e.example/mcp");
  await page.locator("[data-connector-panel='url-add'] .connector-advanced summary").click();
  await page.locator("[data-connector-panel='url-add'] .connector-advanced input").first().fill(TEST_ID);
  await page.locator("[data-connector-panel='url-add'] .connector-advanced input[type='checkbox']").check();
  await page.locator("[data-connector-panel-save]").click();

  await expect(page.locator("[data-connector-notice]")).toContainText("加入连接器目录");
  await expect(page.locator(`[data-connector-card][data-connector="${TEST_ID}"]`)).toBeVisible();

  await page.locator(`[data-connector-card][data-connector="${TEST_ID}"]`).locator("a").first().click();
  await expect(page.locator("[data-admin-page='connector-detail']")).toBeVisible();
  await expect(page.locator("[data-connector-config-card]")).toBeVisible();
  await expect(page.locator("[data-connector-tools]")).toBeVisible();
  await expect(page.locator("[data-connector-scope]")).toBeVisible();
  await expect(page.locator("[data-admin-grants]")).toBeVisible();
  await expect(page.locator("[data-connector-status-note]")).toContainText("配置已保存");

  // Connector-level organization scope round-trips through the API.
  await page.locator("[data-connector-scope-mode]").selectOption("all");
  await page.locator("[data-connector-scope-save]").click();
  await expect(page.locator("[data-connector-scope] .runtime-notice")).toContainText("连接器级范围已保存");
  await expect(page.locator("[data-connector-scope-coverage]")).toContainText("预计覆盖");
});

test("config form validates icons and keeps submitted secrets write-only", async ({ page, request }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await request.post("/api/admin/connectors", {
    data: { id: TEST_ID, label: "E2E Icon MCP", purpose: "图标与密钥校验" },
  });
  await page.goto(`/admin/connectors/${TEST_ID}`);
  await expect(page.locator("[data-connector-config-card]")).toBeVisible();

  await page.locator("[data-connector-icon-input]").first().setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator(".connector-icon-field .error")).toContainText("仅支持 PNG 或 JPG");

  await page.locator("[data-connector-config-card] input.connector-header-name").fill("X-API-Key");
  await page.locator("[data-connector-config-card] input.connector-header-value").fill("e2e-secret-value");
  await page.locator("[data-connector-config-card] input[data-connector-field='url']").fill("https://mcp.e2e.example/mcp");
  await page.locator("[data-connector-config-save]").click();
  await expect(page.locator("[data-connector-config-card] .runtime-notice")).toContainText("配置草稿已保存");
  await expect(page.locator("[data-connector-config-card] input.connector-header-value")).toHaveValue("");
  await expect(page.locator("[data-connector-config-card] input.connector-header-value")).toHaveAttribute("placeholder", /已保存引用/);
});

test("hub card opens the tools drawer with an honest state and returns focus", async ({ page }) => {
  await page.goto("/admin/connectors");
  const entry = page.locator('[data-connector-card][data-connector="claw"]').locator("[data-connector-tools-entry]");
  await entry.click();
  await expect(page.locator("[data-connector-tools-drawer]")).toBeVisible();
  await expect(page.locator("[data-connector-tools-drawer] h2")).toContainText("MediaCrawler MCP · 工具");
  await expect(page.locator("[data-connector-drawer-counts]")).toBeVisible();
  await expect(page.locator("[data-connector-drawer-default-scope]")).toBeVisible();
  // stub 模式命中运行时闸门（403）、auth 模式未配置（409）：都必须给诚实错误态，而不是假清单。
  await expect(page.locator("[data-connector-drawer-error]")).toBeVisible();
  await expect(page.locator("[data-connector-drawer-error]")).toContainText("工具目录不可用");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-connector-tools-drawer]")).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test("tools drawer lists every tool and grants scope by department or person", async ({ page }) => {
  const scopeWrites: Array<{ tool: string; body: Record<string, unknown> }> = [];
  const tool = (name: string, hash: string, description: string) => ({
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    schema_hash: hash.repeat(64),
  });
  await page.route("**/api/admin/runtime/connectors/claw/discovery", (route) => route.fulfill({
    json: {
      tools: [
        tool("list_records", "a", "只读列出记录"),
        tool("get_record", "b", "只读读取单条记录"),
        tool("create_record", "c", "写入新记录（未审阅）"),
      ],
      authorization: "Discovery is not a grant.",
    },
  }));
  await page.route("**/api/admin/runtime/connectors/claw/policies", (route) => route.fulfill({
    json: [{ connector_id: "claw", tool_name: "list_records", enabled: true, risk: "L1", access: "read", schema_hash: "a".repeat(64), version: 1 }],
  }));
  await page.route("**/api/admin/runtime/connectors/claw/connector-scope", (route) => route.fulfill({
    json: { connector_id: "claw", mode: "unset", updated_by: null, updated_at: null, bindings: [], coverage: { users: 0, read: 0, write: 0 } },
  }));
  await page.route("**/api/admin/runtime/connectors/claw/organization-scope", (route) => route.fulfill({
    json: {
      connector_id: "claw",
      synced_at: null,
      source: "e2e",
      nodes: [
        { id: "n1", parent_id: null, name: "推广部", level: 1, is_person: false, external_id: "org:promotion_department", local_user_id: null, status: "unmatched" },
        { id: "n2", parent_id: "n1", name: "LT组", level: 2, is_person: false, external_id: "e2e", local_user_id: null, status: "unmatched" },
        { id: "n3", parent_id: "n2", name: "张三", level: 3, is_person: true, external_id: "u1", local_user_id: "u1", status: "matched" },
      ],
    },
  }));
  await page.route("**/api/admin/runtime/connectors/claw/tools/*/scope", (route) => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split("/tools/")[1].split("/")[0]);
    if (route.request().method() === "PUT") {
      scopeWrites.push({ tool: name, body: JSON.parse(route.request().postData() || "{}") as Record<string, unknown> });
    }
    return route.fulfill({ json: { connector_id: "claw", tool_name: name, node_ids: [], all: false, scope_configured: true } });
  });

  await page.goto("/admin/connectors");
  await page.locator('[data-connector-card][data-connector="claw"] [data-connector-tools-entry]').click();
  await expect(page.locator("[data-connector-drawer-counts]")).toContainText("共 3 个工具（已审阅 1 · 未审阅 2）");
  await expect(page.locator("[data-connector-drawer-tool]")).toHaveCount(3);
  await expect(page.locator('[data-connector-drawer-tool="create_record"]')).toContainText("未审阅 · 默认拒绝");

  await page.locator("[data-connector-drawer-search]").fill("create");
  await expect(page.locator("[data-connector-drawer-tool]")).toHaveCount(1);
  await page.locator("[data-connector-drawer-search]").fill("");

  await page.locator('[data-connector-drawer-pick="get_record"]').check();
  await page.locator('[data-connector-drawer-pick="create_record"]').check();
  await page.locator("[data-connector-batch-open]").click();
  await page.locator("[data-connector-batch-mode]").selectOption("selected");
  await page.locator("[data-connector-batch-node='n1']").check();
  await page.locator("[data-connector-batch-apply]").click();
  await expect(page.locator("[data-connector-drawer-notice]")).toContainText("已为 2 个工具保存范围授权");
  expect(scopeWrites.map((write) => write.tool).sort()).toEqual(["create_record", "get_record"]);
  expect(scopeWrites.find((write) => write.tool === "get_record")?.body).toMatchObject({ node_ids: ["n1"], all: false });
  await expect(page.locator('[data-connector-drawer-tool="create_record"]')).toContainText("未审阅 · 默认拒绝");

  const rowScope = page.locator('[data-connector-drawer-tool="list_records"] details.runtime-tool-scope');
  await page.locator('[data-connector-drawer-tool="list_records"] details summary', { hasText: "使用范围" }).click();
  await rowScope.locator("select").first().selectOption("selected");
  await rowScope.locator("li.runtime-scope-node", { hasText: "张三" }).last().locator("input").check();
  await rowScope.locator("button", { hasText: "保存范围授权" }).click();
  await expect(rowScope.locator(".runtime-notice")).toContainText("工具范围授权已保存");
  expect(scopeWrites.find((write) => write.tool === "list_records")?.body).toMatchObject({ node_ids: ["n3"], all: false });
});
