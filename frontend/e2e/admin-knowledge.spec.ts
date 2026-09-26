import { expect, test, type Page } from "@playwright/test";

/**
 * 知识治理管理端六子视图（阶段 2）的 e2e 契约。
 *
 * 断言只依赖页面自己的 DOM 契约（data-admin-kb-*）与既有对话框钩子：
 *   路由 → data-admin-kb-view="todo|assets|detail|ingest|bindings|feedback"
 *   子导航 → data-admin-kb-tab="todo|assets|ingest|bindings|feedback"
 *   一页一问 → 每个视口最多 1 个实底主 CTA（--primary 实底），待办与未选中行时为 0。
 *
 * stub 环境用 data-e2e 的种子知识（kb_mail_kol =「首封建联」，已发布、sriphy 已启用）。
 * 该数据库跨运行保留，故：引用视图会在用例末尾删掉自建绑定；反馈用例先清掉上一次的隐藏记录。
 */

/** 统计某个视图根节点内的实底主 CTA（背景 = --primary，与 skills-catalog.spec 同法）。 */
async function filledCtaCount(page: Page, scope: string): Promise<number> {
  return page.evaluate((selector) => {
    const host = document.querySelector<HTMLElement>(selector);
    if (!host) return -1;
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return [...host.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.backgroundColor === rgb && cs.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
    }).length;
  }, scope);
}

async function openView(page: Page, path: string, view: string) {
  await page.goto(path);
  const host = page.locator(`[data-admin-kb-view='${view}']`);
  await expect(host).toBeVisible();
  return host;
}

test.describe("知识治理管理端（/admin/knowledge）", () => {
  test("六个子视图深链可达，默认进待办，子导航是链接式 tab", async ({ page }) => {
    await openView(page, "/admin/knowledge", "todo");
    await expect(page.locator("[data-admin-knowledge]")).toBeVisible();
    await expect(page.locator(".kb-step-n, .kb-hero-admin")).toHaveCount(0);
    await expect(page.locator("[data-admin-knowledge-review]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-expiry]")).toBeVisible();

    const tabs = page.locator("[data-admin-kb-tab]");
    await expect(tabs).toHaveCount(5);
    await expect(page.locator("[data-admin-kb-tab='todo']")).toHaveAttribute("aria-current", "page");

    for (const [tab, view] of [
      ["assets", "assets"],
      ["ingest", "ingest"],
      ["bindings", "bindings"],
      ["feedback", "feedback"],
      ["todo", "todo"],
    ] as const) {
      await page.locator(`[data-admin-kb-tab='${tab}']`).click();
      await expect(page.locator(`[data-admin-kb-view='${view}']`)).toBeVisible();
    }

    // 第六条路由：详情是 assets/:id，深链直达，且子导航高亮「资产」。
    await openView(page, "/admin/knowledge/assets", "assets");
    await openView(page, "/admin/knowledge/assets/kb_mail_kol", "detail");
    await expect(page.locator("[data-admin-kb-tab='assets']")).toHaveAttribute("aria-current", "page");
  });

  test("资产视图列出种子模板，打开详情后版本时间线可见", async ({ page }) => {
    await openView(page, "/admin/knowledge/assets", "assets");
    await expect(page.locator("[data-admin-knowledge-assets]")).toBeVisible();
    const table = page.locator("[data-admin-kb-assets-table]");
    await expect(table).toBeVisible();
    await expect(table).toContainText("首封建联");
    await expect(page.locator("[data-admin-kb-status='published']").first()).toBeVisible();

    // 归档是 L3：确认框展示对象/范围/后果，取消不写入。
    await page.locator("[data-kb-archive]").first().click();
    const archiveDialog = page.locator("[data-admin-confirm='knowledge-archive']");
    await expect(archiveDialog).toBeVisible();
    await expect(archiveDialog.locator("[data-admin-confirm-scope]")).toContainText("归档");
    await page.locator("[data-admin-confirm-cancel]").click();
    await expect(archiveDialog).toHaveCount(0);

    await page.locator("[data-admin-kb-assets-table] a", { hasText: "首封建联" }).click();
    await expect(page.locator("[data-admin-kb-view='detail']")).toBeVisible();
    await expect(page.locator("[data-admin-kb-detail-meta]")).toContainText("首封建联");

    const versions = page.locator("[data-admin-kb-version]");
    await expect(versions.first()).toBeVisible();
    expect(await versions.count()).toBeGreaterThan(0);
    await page.locator("[data-admin-kb-version-open='1']").click();
    await expect(page.locator("[data-admin-kb-version-body='1']")).toContainText("LiTime Mini 12V");
  });

  test("引用视图：新建绑定后进入表格，试算同时渲染命中与跳过两栏", async ({ page }) => {
    await openView(page, "/admin/knowledge/bindings", "bindings");

    await page.locator("[data-admin-kb-binding-toggle]").click();
    const form = page.locator("[data-admin-kb-binding-form]");
    await expect(form).toBeVisible();
    await form.locator("[data-admin-kb-binding-skill]").selectOption("email_compose");
    await form.locator("[data-admin-kb-binding-field='ids']").fill("kb_mail_kol");
    await form.locator("[data-admin-kb-binding-submit]").click();

    await expect(page.locator("[data-admin-receipt]")).toContainText("下次运行生效");
    const row = page.locator("[data-admin-kb-bindings-table] tr", { hasText: "kb_mail_kol" }).first();
    await expect(row).toBeVisible();
    await expect(row.locator("[data-admin-kb-binding-selector]")).toContainText("显式 id：kb_mail_kol");

    await page.locator("[data-admin-kb-preview-skill]").selectOption("email_compose");
    await page.locator("[data-admin-kb-preview-stage]").selectOption("INITIAL_CONTACT");
    await page.locator("[data-admin-kb-preview-run]").click();

    const resolvedCol = page.locator("[data-admin-kb-preview-resolved]");
    const skippedCol = page.locator("[data-admin-kb-preview-skipped]");
    await expect(resolvedCol).toBeVisible();
    await expect(skippedCol).toBeVisible();
    const hits = await page.locator("[data-admin-kb-resolved='kb_mail_kol'], [data-admin-kb-skipped='kb_mail_kol']").count();
    expect(hits, "命中或跳过至少一栏要出现 kb_mail_kol").toBeGreaterThan(0);
    expect(
      await page.locator("[data-admin-kb-resolved='kb_mail_kol'], [data-admin-kb-skipped='kb_mail_kol']").first().textContent(),
    ).toContain("kb_mail_kol");

    // 用例自清理：删掉刚建的绑定，避免影响其它套件的解析行为。
    await row.locator("[data-admin-kb-binding-delete]").click();
    const dialog = page.locator("[data-admin-confirm='knowledge-binding-delete']");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("不再解析到这些知识");
    await page.locator("[data-admin-confirm-ok]").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-admin-receipt]")).toContainText("绑定已删除");
  });

  test("一页一问：每个视口最多 1 个实底主 CTA，待办与未选中反馈为 0", async ({ page }) => {
    await openView(page, "/admin/knowledge", "todo");
    expect(await filledCtaCount(page, "[data-admin-kb-view='todo']"), "待办不应有实底主 CTA").toBe(0);

    for (const [path, view] of [
      ["/admin/knowledge/assets", "assets"],
      ["/admin/knowledge/assets/kb_mail_kol", "detail"],
      ["/admin/knowledge/ingest", "ingest"],
      ["/admin/knowledge/bindings", "bindings"],
    ] as const) {
      await openView(page, path, view);
      const filled = await filledCtaCount(page, `[data-admin-kb-view='${view}']`);
      expect(filled, `${view} 实底主 CTA 应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);
    }

    await openView(page, "/admin/knowledge/feedback", "feedback");
    expect(await filledCtaCount(page, "[data-admin-kb-view='feedback']"), "未选中反馈行时不应有实底主 CTA").toBe(0);
  });

  test("反馈视图：选中一条隐藏记录后忽略并留档", async ({ page }) => {
    await page.request.delete("/api/knowledge/kb_mail_kol/deprecate");
    const posted = await page.request.post("/api/knowledge/kb_mail_kol/deprecate", { data: { reason: "过时" } });
    expect(posted.ok(), `写入隐藏记录失败：${posted.status()}`).toBeTruthy();

    await openView(page, "/admin/knowledge/feedback", "feedback");
    const row = page.locator("[data-admin-kb-feedback-row*='kb_mail_kol']").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("首封建联");
    await expect(page.locator("[data-admin-kb-reason='outdated']")).toContainText("内容过时");

    await row.locator("[data-admin-kb-feedback-pick]").check();
    await expect(page.locator("[data-admin-kb-feedback-actionbar]")).toContainText("选中");
    await expect(page.locator("[data-admin-kb-feedback-revision]")).toBeEnabled();
    await expect(page.locator("[data-admin-kb-feedback-revision]")).toHaveClass(/btn work/);

    await page.locator("[data-admin-kb-feedback-note]").fill("E2E：过时已登记，先忽略");
    await page.locator("[data-admin-kb-feedback-ignore]").click();

    const handled = page.locator("[data-admin-kb-handled*='kb_mail_kol']").first();
    await expect(page.locator("[data-admin-receipt]")).toContainText("已忽略");
    await expect(handled).toBeVisible();
    await expect(handled).toContainText("已忽略");
    await expect(page.locator("[data-admin-kb-feedback-row*='kb_mail_kol']").first())
      .toHaveAttribute("data-admin-kb-feedback-handled", "1");
    await expect(page.locator("[data-admin-kb-feedback-ignore]")).toBeDisabled();
  });
});
