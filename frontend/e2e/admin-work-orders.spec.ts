import { test, expect, type Page } from "@playwright/test";

// Contract-shaped fixtures verify presentation and commands, not live PG integration.
async function fixture(page: Page, failed: string[] = []) {
  const errors: string[] = [], writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failures = new Set(failed);
  const stamp = "2026-10-08T02:33:00Z";
  const account = { id: "admin", name: "管理员", available_modes: ["admin", "employee"] };
  const common = { version: 3, automation_level: "A1", description: "依据已核验事件生成标准跟进工单", acceptance_criteria: ["下一步动作已记录"], trigger_event_types: ["mail.reply_verified"], routing_policy_code: "task_owner" };
  const templates = [{ ...common, id: "draft", template_code: "quote_followup", title: "报价跟进", status: "draft" }, { ...common, id: "live", template_code: "sample_followup", title: "寄样跟进", status: "published" }, { ...common, id: "off", template_code: "old_followup", title: "历史跟进", status: "disabled" }];
  const releases: Array<Record<string, unknown>> = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      const body = JSON.parse(route.request().postData() || "{}") as Record<string, unknown>;
      writes.push({ path, body });
      if (path.endsWith("/drafts")) templates.push({ ...common, id: "new", template_code: String(body.template_code), title: String(body.title), status: "draft" });
      if (path.endsWith("/publish")) templates.find(template => path.includes(`/${template.id}/`))!.status = "published";
      if (path.endsWith("/automation-release")) releases.push({ template_id: "live", status: body.action, automation_level: "A1" });
      return route.fulfill({ json: { changed: true, username: "员工", person_ref: "person", template: templates[0], release: releases[0] || {} } });
    }
    if (failures.has(path)) return route.fulfill({ status: 503, json: { detail: "could not serialize access due to read/write dependencies among transactions" } });
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path.endsWith("/data-quality")) json = { active_unit_count: 12, active_person_count: 38, issue_count: 1, registry_revision: "org-v3", seeded_at: stamp, as_of: stamp, issues: [{ type: "person_without_account", subject_ref: "person", display_name: "员工", org_unit_id: "org", message: "尚未绑定工作台账号" }] };
    else if (path.endsWith("/account-bindings/options")) json = { accounts: [{ id: "employee", name: "员工", username: "employee", bound_person_ref: null }], people: [{ person_ref: "person", display_name: "员工", org_unit_id: "org", user_id: null }] };
    else if (path === "/api/tickets/reports/organization") json = { as_of: stamp, timezone: "Asia/Shanghai", total_authorized: 8, by_status: { pending: 3, accepted: 2, completed: 3 }, authorization: { mode: "company_admin", root_units: [] }, by_assignee_unit: [{ org_unit_id: "one", display_name: "推广部", type: "部门", total: 5, by_status: { pending: 3, completed: 2 } }, { org_unit_id: "two", display_name: "数智中心", type: "中心", total: 3, by_status: { accepted: 2, completed: 1 } }] };
    else if (path.endsWith("/organization/stages")) json = { as_of: stamp, total_authorized: 8, by_business_category: [{ business_category: "合作跟进", total: 8 }], by_stage: [{ business_category: "合作跟进", stage_group: "寄样测试", stage_code: "SHIPPED", total: 8, by_status: { pending: 3, accepted: 2, completed: 3 } }] };
    else if (path === "/api/admin/work-orders/templates") json = { templates };
    else if (path === "/api/admin/work-orders/automation-releases") json = { releases };
    else if (path === "/api/task-work-orders") json = { items: [{ task: { task_id: "task", title: "寄样确认", goal: "完成寄样事实核验", status: "in_progress" }, counts: { open: 3, total: 4, blocked: 1, waiting_review: 0 }, current_blocking_work_order: { title: "核对收件信息" } }] };
    await route.fulfill({ json });
  });
  await page.goto("/admin/work-orders");
  await expect(page.getByRole("tab", { name: "治理概览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  return { errors, writes, recover: () => { failures = new Set(); } };
}

test("接口失败局部呈现，不误报零数据；重试恢复实际存量", async ({ page }) => {
  const f = await fixture(page, ["/api/tickets/reports/organization", "/api/task-work-orders"]);
  const report = page.locator("[data-organization-ticket-report]");
  const tasks = page.locator("[data-ai-work-order-work-report]");
  await expect(report).toContainText("组织工单存量读取失败");
  await expect(tasks).toContainText("任务工作战报读取失败");
  await expect(tasks).not.toContainText("任务根 0");
  await expect(tasks).not.toContainText("没有返回");
  await expect(page.locator("[data-work-order-metrics]")).toContainText("38");
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  await expect(page.locator("[data-template-table]")).toContainText("报价跟进");
  await page.getByRole("tab", { name: "治理概览" }).click();
  f.recover();
  await report.getByRole("button", { name: "重试", exact: true }).click();
  await expect(report.getByRole("button", { name: "全部 8", exact: true })).toBeVisible();
  await expect(tasks).toContainText("寄样确认");
  expect(f.errors).toEqual([]);
  expect(f.writes).toEqual([]);
});

test("业务导航可键盘切换，状态筛选与搜索保留，无隐式写入", async ({ page }) => {
  const f = await fixture(page);
  const report = page.locator("[data-organization-ticket-report]");
  await report.getByRole("button", { name: "待受理 3", exact: true }).click();
  await expect(report).toContainText("推广部");
  await expect(report).not.toContainText("数智中心");
  const overview = page.getByRole("tab", { name: "治理概览" });
  await overview.focus(); await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /AI 工单模板/ })).toBeFocused();
  await page.getByRole("group", { name: "模板生命周期筛选" }).getByRole("button", { name: "已发布 1" }).click();
  await page.getByRole("searchbox", { name: "搜索模板" }).fill("寄样");
  await expect(page.locator("[data-template-table]")).toContainText("寄样跟进");
  await expect(page.locator("[data-template-table]")).not.toContainText("报价跟进");
  await page.getByRole("tab", { name: "治理概览" }).click();
  await expect(report.getByRole("button", { name: "待受理 3" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  await expect(page.getByRole("searchbox", { name: "搜索模板" })).toHaveValue("寄样");
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("A3 按等级展示，隐藏配置不进入 A1 草稿，编辑跨视图保留", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  await page.getByRole("button", { name: "新建模板草稿" }).click();
  const editor = page.locator("[data-template-editor]");
  await expect(editor.getByRole("group", { name: "A3 阶段与证据配置" })).not.toBeVisible();
  await editor.getByRole("combobox", { name: "自动化等级", exact: true }).selectOption("A3");
  await editor.getByRole("textbox", { name: /^目标阶段（每行一个）/ }).fill("SHIPPED");
  const checkbox = editor.getByRole("checkbox", { name: "允许跨阶段" });
  const box = await checkbox.boundingBox(); expect(box!.width).toBeLessThanOrEqual(20); expect(box!.height).toBeLessThanOrEqual(20);
  await editor.getByLabel("模板名称", { exact: true }).fill("新的跟进规则");
  await page.getByRole("tab", { name: /人员绑定/ }).click();
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  await expect(editor.getByLabel("模板名称", { exact: true })).toHaveValue("新的跟进规则");
  await editor.getByRole("combobox", { name: "自动化等级", exact: true }).selectOption("A1");
  await editor.getByLabel("模板编码", { exact: true }).fill("new_followup");
  await editor.getByLabel("验收条件", { exact: true }).fill("事实核验完成");
  await editor.getByRole("button", { name: "创建模板草稿", exact: true }).click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("模板草稿已创建");
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].body.stage_policy).toEqual({}); expect(f.writes[0].body.automation_level).toBe("A1");
  expect(f.errors).toEqual([]);
});

test("发布和启用执行独立确认，取消不写入；发布携带版本", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  const row = page.locator("[data-work-order-template='quote_followup']");
  await row.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("自动执行仍由独立开关控制");
  await page.locator("[data-admin-confirm-cancel]").click();
  expect(f.writes).toEqual([]);
  await row.getByRole("button", { name: "发布", exact: true }).click();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(row).toContainText("已发布");
  await expect(row).toContainText("未启用");
  expect(f.writes[0].body.expected_version).toBe(3);
  const live = page.locator("[data-work-order-template='sample_followup']");
  await live.getByRole("button", { name: "启用自动执行" }).click();
  await page.locator("[data-admin-confirm-reason]").fill("已核对路由和证据约束");
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(live.getByRole("button", { name: "停止自动执行" })).toBeVisible();
  expect(f.writes).toHaveLength(2); expect(f.writes[1].body.reason).toBe("已核对路由和证据约束");
  expect(f.errors).toEqual([]);
});

test("人员绑定确认与回执保留；桌面和窄屏无横向溢出", async ({ page }, testInfo) => {
  const f = await fixture(page);
  await page.screenshot({ path: testInfo.outputPath("overview-desktop.png"), fullPage: true });
  await page.getByRole("tab", { name: /人员绑定/ }).click();
  await page.getByRole("combobox", { name: "工作台账号", exact: true }).selectOption("employee");
  await page.getByRole("combobox", { name: "组织人员", exact: true }).selectOption("person");
  await page.getByLabel("绑定原因", { exact: true }).fill("员工身份已核验");
  await page.getByRole("button", { name: "确认绑定并记录审计" }).click();
  await page.locator("[data-admin-confirm-cancel]").click();
  await expect(page.getByLabel("绑定原因", { exact: true })).toHaveValue("员工身份已核验");
  expect(f.writes).toEqual([]);
  await page.getByRole("button", { name: "确认绑定并记录审计" }).click();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("人员绑定已保存");
  await page.getByRole("tab", { name: /AI 工单模板/ }).click();
  await page.screenshot({ path: testInfo.outputPath("templates-desktop.png"), fullPage: true });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
});
