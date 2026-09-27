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
  // 自定义 HTTP API 的短名由名称自动生成（api-…），按标签回收，避免残留。
  const connectors = await request.get("/api/admin/connectors").catch(() => null);
  if (connectors?.ok()) {
    const rows = (await connectors.json()) as Array<{ id: string; label?: string }>;
    for (const row of rows.filter((item) => String(item.label || "").startsWith("E2E "))) {
      await request.delete(`/api/admin/connectors/${row.id}`).catch(() => undefined);
    }
  }
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

test("connector hub renders, filters, opens the browse modal and the create menu", async ({ page }) => {
  await page.goto("/admin/connectors");
  await expect(page.locator("[data-admin-page='connectors']")).toBeVisible();
  await expect(page.locator("[data-connector-hub-title]")).toHaveText("已添加的连接器");
  // 连接器页不再显示账户卡与返回按钮；标题与治理数字同排（细线在下方）。
  await expect(page.locator(".admin-header")).toHaveCount(0);
  await expect(page.locator("[data-admin-account]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回员工工作台" })).toHaveCount(0);
  await expect(page.locator("[data-admin-health]")).toContainText("受管连接器");

  const head = await page.evaluate(() => {
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    };
    const cells = Array.from(document.querySelectorAll("[data-admin-health] > span"))
      .map((span) => rect(span))
      .filter((box) => box !== null);
    return {
      title: rect(document.querySelector("[data-connector-hub-title]")),
      health: rect(document.querySelector("[data-admin-health]")),
      rows: new Set(cells.map((box) => Math.round(box.top))).size,
    };
  });
  expect(head.title).not.toBeNull();
  expect(head.health).not.toBeNull();
  // 同一行：标题与数字组的竖直区间必须重叠。
  expect(head.title!.top).toBeLessThan(head.health!.bottom);
  expect(head.health!.top).toBeLessThan(head.title!.bottom);
  // 数字组整体在标题右侧。
  expect(head.health!.left).toBeGreaterThan(head.title!.right);
  // 四个治理数字本身也只占一行。
  expect(head.rows).toBe(1);

  await expect(page.locator('[data-admin-connectors-table] [data-connector="claw"]')).toBeVisible();
  await expect(page.locator('[data-admin-connectors-table] [data-connector="starrykol"]')).toBeVisible();

  await page.locator("[data-connector-search]").fill("Starry");
  await expect(page.locator("[data-admin-connectors-table] [data-connector]")).toHaveCount(1);
  await page.locator("[data-connector-search]").fill("");
  await expect(page.locator('[data-admin-connectors-table] [data-connector="claw"]')).toBeVisible();

  // 「浏览连接器」与「创建」等宽。
  const browseBox = await page.locator("[data-connector-browse-toggle]").boundingBox();
  const createBox = await page.locator("[data-connector-create-toggle]").boundingBox();
  expect(browseBox?.width ?? 0).toBeGreaterThan(0);
  expect(Math.abs((browseBox?.width ?? 0) - (createBox?.width ?? 0))).toBeLessThanOrEqual(1);

  await page.locator("[data-connector-create-toggle]").click();
  await expect(page.locator("[data-connector-create-menu]")).toBeVisible();
  await expect(page.locator("[data-connector-create-item]")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-connector-create-menu]")).toHaveCount(0);

  // 浏览连接器 → 弹窗（参考图：搜索 + 分类 Tab（应用 / 自定义 API / 自定义 MCP）+「创建 ⌄」右置 + 卡片网格）。
  await page.locator("[data-connector-browse-toggle]").click();
  await expect(page.locator("[data-connector-panel='browse']")).toBeVisible();
  await expect(page.locator("[data-connector-browse-modal]")).toBeVisible();
  await expect(page.locator("[data-connector-browse-modal] [data-connector-tab]")).toHaveText(["应用", "自定义 API", "自定义 MCP"]);
  // 「创建 ⌄」与页签同排；标题栏只有标题与关闭。
  await expect(page.locator("[data-connector-browse-toolbar] [data-connector-browse-create]")).toBeVisible();
  await expect(page.locator(".connector-panel-head [data-connector-browse-create]")).toHaveCount(0);
  await page.locator("[data-connector-browse-modal] [data-connector-tab='custom_mcp']").click();
  await expect(page.locator("[data-connector-browse-modal] [data-connector-card-new]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-connector-browse-modal]")).toHaveCount(0);
  await expect(page.locator("[data-connector-browse-toggle]")).toBeFocused();
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

test("MCP 配置 dialog matches the reference layout", async ({ page }) => {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='mcp']").click();
  const panel = page.locator("[data-connector-panel='mcp-config']");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h2")).toHaveText("MCP 配置");
  // 无副标题、无取消按钮；关闭只走 X / Esc / 遮罩。
  await expect(panel.locator(".connector-panel-head p")).toHaveCount(0);
  await expect(panel.locator("footer button", { hasText: "取消" })).toHaveCount(0);
  // 第一行两列：服务器名称 + 传输类型；短名不再出现在表单里。
  await expect(panel.locator(".connector-form-grid .field")).toHaveCount(2);
  await expect(panel.locator("[data-connector-field='label']")).toHaveAttribute("placeholder", "e.g., My Custom Server");
  await expect(panel.locator("[data-connector-field='transport'] option")).toHaveCount(2);
  await expect(panel.locator("[data-connector-field='id']")).toHaveCount(0);
  // 图标：虚线占位框 + 「上传 ⌄」分裂按钮，菜单含上传 / 移除。
  await expect(panel.locator("[data-connector-icon-preview]")).toBeVisible();
  await expect(panel.locator(".connector-icon-field")).toHaveClass(/is-bare/);
  await panel.locator("[data-connector-split-toggle='icon']").click();
  const iconMenu = panel.locator("[data-connector-split-menu='icon']");
  await expect(iconMenu.locator(".connector-split-item")).toHaveText(["上传", "移除"]);
  await page.keyboard.press("Escape");
  await expect(iconMenu).toHaveCount(0);
  await expect(panel).toBeVisible();
  // 备注 5 行；底部为「保存 ｜⌄」，下拉里是发布并保存，附保存≠启用说明。
  await expect(panel.locator("textarea")).toHaveAttribute("rows", "5");
  await expect(panel.locator("[data-connector-split-main='save']")).toHaveText("保存");
  await expect(panel.locator(".connector-panel-note")).toContainText("不等于启用");
  await panel.locator("[data-connector-split-toggle='save']").click();
  await expect(panel.locator("[data-connector-split-menu='save'] .connector-split-item")).toHaveText(["发布并保存"]);
  await page.keyboard.press("Escape");
  await expect(panel.locator("[data-connector-split-menu='save']")).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("connector form dialogs keep the measured spec (docs/DESIGN.md)", async ({ page }) => {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='mcp']").click();
  const panel = page.locator("[data-connector-panel='mcp-config']");
  await expect(panel).toBeVisible();

  const spec = await panel.evaluate((root) => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : "");
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : { w: 0, h: 0 };
    };
    const body = root.querySelector(".connector-panel-body");
    return {
      panelW: box(root.querySelector(".connector-panel")).w,
      bodyGap: css(body, "gap"),
      fieldGap: css(root.querySelector(".field"), "gap"),
      gridGap: css(root.querySelector(".connector-form-grid"), "gap"),
      labelFont: css(root.querySelector(".field"), "font-size"),
      inputH: box(root.querySelector("[data-connector-field='label']")).h,
      inputFont: css(root.querySelector("[data-connector-field='label']"), "font-size"),
      inputBg: css(root.querySelector("[data-connector-field='label']"), "background-color"),
      inputRadius: css(root.querySelector("[data-connector-field='label']"), "border-radius"),
      inputBorder: css(root.querySelector("[data-connector-field='label']"), "border-top-color"),
      noteH: box(root.querySelector("textarea")).h,
      iconBox: box(root.querySelector("[data-connector-icon-preview]")),
      hintFont: css(root.querySelector(".connector-icon-actions p"), "font-size"),
      hintColor: css(root.querySelector(".connector-icon-actions p"), "color"),
      saveH: box(root.querySelector("[data-connector-split-main='save']")).h,
      saveBg: css(root.querySelector("[data-connector-split-main='save']"), "background-color"),
      saveFont: css(root.querySelector("[data-connector-split-main='save']"), "font-size"),
      footBorder: css(root.querySelector(".connector-panel-foot"), "border-top-width"),
    };
  });

  // 数值 = docs/DESIGN.md §连接器控制台（参考图实测 × 0.7，基准：标签 14px）。
  expect(spec.panelW).toBe(560);
  expect(spec.bodyGap).toBe("18px");
  expect(spec.fieldGap).toBe("11px");
  expect(spec.gridGap).toBe("18px");
  expect(spec.labelFont).toBe("14px");
  expect(spec.inputH).toBe(34);
  expect(spec.inputFont).toBe("14px");
  expect(spec.inputBg).toBe("rgb(236, 236, 235)");
  expect(spec.inputRadius).toBe("6px");
  expect(spec.inputBorder).toBe("rgba(0, 0, 0, 0)");
  expect(spec.noteH).toBe(95);
  expect(spec.iconBox).toEqual({ w: 56, h: 56 });
  expect(spec.hintFont).toBe("13px");
  expect(spec.hintColor).toBe("rgb(115, 115, 115)");
  expect(spec.saveH).toBe(34);
  expect(spec.saveBg).toBe("rgb(26, 26, 25)");
  expect(spec.saveFont).toBe("14px");
  expect(spec.footBorder).toBe("0px");
});

test("connector browse modal keeps the measured spec (docs/DESIGN.md)", async ({ page }) => {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-browse-toggle]").click();
  const panel = page.locator("[data-connector-panel='browse']");
  await expect(panel).toBeVisible();
  // 等目录数据到位（加载态只有占位行）；「✓」是参考图量取的版式对象，也约束了数据前置。
  await expect(page.locator("[data-connector-browse-modal] .connector-added").first()).toBeVisible();

  const spec = await panel.evaluate((root) => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : "");
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : { w: 0, h: 0 };
    };
    const q = (sel: string) => root.querySelector(sel);
    return {
      panelW: box(q(".connector-panel")).w,
      searchH: box(q(".connector-search")).h,
      searchBg: css(q(".connector-search"), "background-color"),
      searchRadius: css(q(".connector-search"), "border-radius"),
      searchBorder: css(q(".connector-search"), "border-top-color"),
      chipH: box(q(".hub-chip")).h,
      chipBg: css(q(".hub-chip"), "background-color"),
      createH: box(q("[data-connector-browse-create]")).h,
      createW: box(q("[data-connector-browse-create]")).w,
      createBorder: css(q("[data-connector-browse-create]"), "border-top-color"),
      cardMinH: css(q(".connector-card"), "min-height"),
      cardH: box(q(".connector-card")).h,
      cardRadius: css(q(".connector-card"), "border-radius"),
      cardPad: css(q(".connector-card"), "padding"),
      cardBorder: css(q(".connector-card"), "border-top-color"),
      mark: box(q(".connector-mark")),
      titleFont: css(q(".connector-card-title strong"), "font-size"),
      descFont: css(q(".connector-card-purpose"), "font-size"),
      descLh: css(q(".connector-card-purpose"), "line-height"),
      descColor: css(q(".connector-card-purpose"), "color"),
      checkBox: box(q(".connector-added svg")),
      checkColor: css(q(".connector-added"), "color"),
    };
  });

  // 数值 = docs/DESIGN.md §连接器控制台「浏览弹窗」（参考图 1034×888 实测 × 0.7）。
  expect(spec.panelW).toBe(736);
  expect(spec.searchH).toBe(34);
  expect(spec.searchBg).toBe("rgb(240, 240, 239)");
  expect(spec.searchRadius).toBe("6px");
  expect(spec.searchBorder).toBe("rgba(0, 0, 0, 0)");
  expect(spec.chipH).toBe(30);
  expect(spec.chipBg).toBe("rgb(233, 233, 232)");
  expect(spec.createH).toBe(30);
  expect(spec.createW).toBe(60);
  expect(spec.createBorder).toBe("rgb(218, 218, 217)");
  expect(spec.cardMinH).toBe("71px");
  expect(spec.cardH).toBe(71);
  expect(spec.cardRadius).toBe("8px");
  expect(spec.cardPad).toBe("16px 12px");
  expect(spec.cardBorder).toBe("rgb(233, 233, 232)");
  expect(spec.mark).toEqual({ w: 37, h: 37 });
  expect(spec.titleFont).toBe("14px");
  expect(spec.descFont).toBe("11px");
  expect(spec.descLh).toBe("15px");
  expect(spec.descColor).toBe("rgb(115, 115, 115)");
  expect(spec.checkBox).toEqual({ w: 19, h: 19 });
  expect(spec.checkColor).toBe("rgb(115, 115, 115)");

  // stub 里两个内置连接器都在目录（无「＋」卡片）；用同域探针量取「＋」的规则。
  const plus = await panel.evaluate((root) => {
    const host = root.querySelector("[data-connector-browse-grid]");
    if (!host) return null;
    const probe = document.createElement("button");
    probe.type = "button";
    probe.className = "connector-plus";
    probe.style.justifySelf = "start";
    host.appendChild(probe);
    const style = getComputedStyle(probe);
    const rect = probe.getBoundingClientRect();
    const spec = {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      radius: style.borderRadius,
      border: style.borderTopColor,
    };
    probe.remove();
    return spec;
  });
  expect(plus).toEqual({ w: 26, h: 26, radius: "7px", border: "rgb(233, 233, 232)" });
});

test("发布并保存 saves the draft and reports the publish gate honestly", async ({ page }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='mcp']").click();
  const panel = page.locator("[data-connector-panel='mcp-config']");
  await page.locator("[data-connector-field='label']").fill("E2E Publish MCP");
  await page.locator("[data-connector-field='url']").fill("https://mcp.e2e.example/mcp");
  await panel.locator("input[type='checkbox']").check();
  await panel.locator("[data-connector-split-toggle='save']").click();
  await panel.locator("[data-connector-split-menu='save'] .connector-split-item").click();

  // 未完成测试的连接器会被闸门拦下：草稿成立，发布不谎报成功。
  await expect(panel).toHaveCount(0);
  await expect(page.locator("[data-connector-notice]")).toContainText("未能发布");
  await expect(page.locator("[data-connector-notice]")).toContainText("先完成一次通过的测试");
  await expect(page.locator("[data-connector-notice][data-connector-notice-tone='warn']")).toHaveCount(1);
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

  // 点卡片不再跳详情，而是进「待配置」弹窗；详情走弹窗右上角入口。
  await page.locator(`[data-connector-card][data-connector="${TEST_ID}"]`).click();
  const configModal = page.locator("[data-connector-panel='connector-config']");
  await expect(configModal).toBeVisible();
  await expect(configModal.locator("h2")).toContainText("E2E URL MCP");
  await configModal.locator(".connector-panel-detail-link").click();
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

test("HTTP API flow creates a draft and saves explicit actions without an MCP adapter", async ({ page }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='api']").click();
  const panel = page.locator("[data-connector-panel='api-config']");
  await expect(panel).toBeVisible();
  // 创建弹窗只收名称 / 图标 / 备注 / 密钥；短名自动生成（api-…）。
  await panel.locator("[data-connector-field='label']").fill("E2E HTTP API");
  await panel.locator(".connector-secret-name").fill("X-API-Key");
  await panel.locator(".connector-secret-value").fill("e2e-secret-value");
  await panel.locator("[data-connector-panel-save]").click();
  await expect(page.locator("[data-connector-notice]")).toContainText("HTTP API 草稿");
  const card = page.locator("[data-connector-card]", { hasText: "E2E HTTP API" });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-connector-kind", "custom_api");
  const id = await card.getAttribute("data-connector");

  await page.goto(`/admin/connectors/${id}`);
  const config = page.locator("[data-connector-config-card]");
  // 协议在创建入口决定：草稿按 HTTP 字段集打开，端点与动作在详情补齐。
  await expect(config.locator("[data-connector-http-definition]")).toBeVisible();
  // 创建时写入的密钥只以引用回显，原值不回显。
  await expect(config.locator("input.connector-header-name")).toHaveValue("X-API-Key");
  await config.locator("input[data-connector-field='url']").fill("https://api.e2e.example");
  await config.locator("[data-connector-http-tools]").fill(JSON.stringify([{
    name: "list_orders",
    description: "Read orders",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    method: "GET",
    path: "/orders",
  }]));
  await config.locator("[data-connector-split-main='config-save']").click();
  await expect(config.locator(".runtime-notice")).toContainText("配置草稿已保存");
  await expect(page.locator(".connector-detail-hero")).toContainText("HTTP");
});

test("自定义 HTTP API dialog matches the reference layout", async ({ page }) => {
  await page.goto("/admin/connectors");
  await page.locator("[data-connector-create-toggle]").click();
  await page.locator("[data-connector-create-item='api']").click();
  const panel = page.locator("[data-connector-panel='api-config']");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h2")).toHaveText("添加自定义 API");
  await expect(panel.locator(".connector-panel-head p")).toHaveText("使用自定义 API 连接器集成任何支持密钥或令牌授权的外部服务。");
  // 字段集照参考图：名称 / 图标 / 备注（可选）/ 密钥（环境变量）；短名、Base URL 与无鉴权不在本弹窗。
  await expect(panel.locator("[data-connector-field='label']")).toHaveAttribute("placeholder", "我的自定义 API");
  await expect(panel.locator("[data-connector-field='id']")).toHaveCount(0);
  await expect(panel.locator("[data-connector-field='url']")).toHaveCount(0);
  await expect(panel.locator("input[type='checkbox']")).toHaveCount(0);
  await expect(panel.locator("[data-connector-icon-preview]")).toBeVisible();
  await expect(panel.locator(".connector-icon-field")).toHaveClass(/is-bare/);
  await expect(panel.locator("textarea").first()).toHaveAttribute("placeholder", /以告知平台/);
  const secret = panel.locator("[data-connector-secret-row]");
  await expect(secret).toHaveCount(1);
  await expect(secret.locator(".connector-secret-name")).toHaveAttribute("placeholder", "SOME_UNIQUE_KEY_NAME");
  await expect(secret.locator(".connector-secret-value")).toHaveAttribute("placeholder", "Value of the secret, such as sk-example-1234");
  // 添加密钥 → 第二张卡；多卡时每卡有移除入口。
  await panel.locator("[data-connector-secret-add]").click();
  await expect(panel.locator("[data-connector-secret-row]")).toHaveCount(2);
  await expect(panel.locator(".connector-secret-remove")).toHaveCount(2);
  await panel.locator(".connector-secret-remove").first().click();
  await expect(panel.locator("[data-connector-secret-row]")).toHaveCount(1);
  // 页脚：取消 + 保存；名称未填时保存为禁用灰态（参考图初始态）。
  await expect(panel.locator("footer button")).toHaveText(["取消", "保存"]);
  const save = panel.locator("[data-connector-panel-save]");
  await expect(save).toBeDisabled();
  expect(await save.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(236, 236, 235)");

  // 数值 = docs/DESIGN.md §连接器控制台「添加自定义 API 创建弹窗」（参考图实测 × 0.7）。
  const spec = await panel.evaluate((root) => {
    const css = (el: Element | null, prop: string) => (el ? getComputedStyle(el).getPropertyValue(prop).trim() : "");
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : { w: 0, h: 0 };
    };
    return {
      panelW: box(root.querySelector(".connector-panel")).w,
      subtitleFont: css(root.querySelector(".connector-panel-head p"), "font-size"),
      helpIcon: box(root.querySelector(".connector-help")),
      secretCardPad: css(root.querySelector(".connector-secret-card"), "padding-left"),
      secretValueH: box(root.querySelector(".connector-secret-value")).h,
    };
  });
  expect(spec.panelW).toBe(560);
  expect(spec.subtitleFont).toBe("13px");
  expect(spec.helpIcon).toEqual({ w: 14, h: 14 });
  expect(spec.secretCardPad).toBe("16px");
  expect(spec.secretValueH).toBe(74);
  // 整个弹窗在 900 高视口内不出现滚动：页脚与「＋ 添加密钥」都完整可见。
  const body = panel.locator(".connector-panel-body");
  expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  await expect(panel.locator("[data-connector-secret-add]")).toBeInViewport();

  await panel.locator("[data-connector-field='label']").fill("E2E API");
  await expect(save).toBeEnabled();
  expect(await save.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(26, 26, 25)");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("config form validates icons and keeps submitted secrets write-only", async ({ page, request }) => {
  test.skip(!AUTH_ENABLED, "runtime governance writes require E2E_AUTH_MODE=enabled");
  await request.post("/api/admin/connectors", {
    data: { id: TEST_ID, label: "E2E Icon MCP", purpose: "图标与密钥校验" },
  });
  await page.goto(`/admin/connectors/${TEST_ID}`);
  await expect(page.locator("[data-connector-config-card]")).toBeVisible();

  // 与创建弹窗同一套版式：HTTP / SSE 两项、图标分裂按钮、备注（可选、5 行）、保存分裂按钮。
  const form = page.locator("[data-connector-config-card]");
  await expect(form.locator("[data-connector-field='transport'] option")).toHaveText(["HTTP", "SSE"]);
  await expect(form.locator(".connector-icon-field")).toHaveClass(/is-bare/);
  await expect(form.locator("textarea")).toHaveAttribute("rows", "5");
  await expect(form.locator("[data-connector-split-main='config-save']")).toHaveText("保存");
  await form.locator("[data-connector-split-toggle='config-save']").click();
  await expect(form.locator("[data-connector-split-menu='config-save'] .connector-split-item")).toHaveText(["发布并保存"]);
  await page.keyboard.press("Escape");
  await expect(form.locator("[data-connector-split-menu='config-save']")).toHaveCount(0);

  await page.locator("[data-connector-icon-input]").first().setInputFiles({
    name: "not-an-image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator(".connector-icon-field .error")).toContainText("仅支持 PNG 或 JPG");

  await page.locator("[data-connector-config-card] input.connector-header-name").fill("X-API-Key");
  await page.locator("[data-connector-config-card] input.connector-header-value").fill("e2e-secret-value");
  await page.locator("[data-connector-config-card] input[data-connector-field='url']").fill("https://mcp.e2e.example/mcp");
  await page.locator("[data-connector-split-main='config-save']").click();
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

test("card status opens the connector configuration modal", async ({ page }) => {
  await page.goto("/admin/connectors");
  const card = page.locator('[data-connector-card][data-connector="claw"]');
  await expect(card.locator("[data-connector-status-entry]")).toHaveText("待配置");
  await card.locator("[data-connector-status-entry]").click();
  const modal = page.locator("[data-connector-panel='connector-config']");
  await expect(modal).toBeVisible();
  await expect(modal.locator("h2")).toContainText("MediaCrawler MCP");
  await expect(modal.locator("[data-connector-config-card]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(card.locator("[data-connector-status-entry]")).toBeFocused();
});
