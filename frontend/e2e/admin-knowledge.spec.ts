import { expect, test, type Page } from "@playwright/test";

/**
 * 知识治理管理端六子视图（阶段 2/3）的 e2e 契约。
 *
 * 断言只依赖页面自己的 DOM 契约（data-admin-kb-*）与既有对话框钩子：
 *   路由 → data-admin-kb-view="review|catalog|base|entry|ingest|bindings"（规格 §5.2）
 *   子导航 → data-admin-kb-tab 同枚举，共 6 个
 *   一页一问 → 每个视口最多 1 个实底主 CTA（--primary 实底），待处置为 0。
 *
 * stub 环境用 data-e2e 的种子知识（kb_mail_kol =「首封建联」，已发布、sriphy 已启用），
 * 以及迁移生成的默认分类：族「未分类」→ 域「未分类」→ 库「历史知识」（kbase_legacy，结构化）。
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
  test("六个子视图深链可达，默认进待处置，子导航是链接式 tab", async ({ page }) => {
    await openView(page, "/admin/knowledge", "review");
    await expect(page.locator("[data-admin-knowledge]")).toBeVisible();
    await expect(page.locator(".kb-step-n, .kb-hero-admin")).toHaveCount(0);
    await expect(page.locator("[data-admin-knowledge-review]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-expiry]")).toBeVisible();

    const tabs = page.locator("[data-admin-kb-tab]");
    await expect(tabs).toHaveCount(6);
    await expect(page.locator("[data-admin-kb-tab='review']")).toHaveAttribute("aria-current", "page");

    for (const [tab, view] of [
      ["catalog", "catalog"],
      ["base", "base"],
      ["entry", "entry"],
      ["ingest", "ingest"],
      ["bindings", "bindings"],
      ["review", "review"],
    ] as const) {
      await page.locator(`[data-admin-kb-tab='${tab}']`).click();
      await expect(page.locator(`[data-admin-kb-view='${view}']`)).toBeVisible();
    }

    // 上下文视图深链直达：base = bases/:id，entry = entries/:id，子导航高亮对应 tab。
    await openView(page, "/admin/knowledge/bases/kbase_legacy", "base");
    await expect(page.locator("[data-admin-kb-tab='base']")).toHaveAttribute("aria-current", "page");
    await openView(page, "/admin/knowledge/entries/kb_mail_kol", "entry");
    await expect(page.locator("[data-admin-kb-tab='entry']")).toHaveAttribute("aria-current", "page");
  });

  test("目录列出族 / 域 / 库，库详情列出条目，条目详情可展开版本全文", async ({ page }) => {
    await openView(page, "/admin/knowledge/catalog", "catalog");
    const tree = page.locator("[data-admin-kb-catalog-tree]");
    await expect(tree).toBeVisible();
    await expect(tree).toContainText("未分类");
    const baseNode = page.locator("[data-admin-kb-base='kbase_legacy']");
    await expect(baseNode).toBeVisible();
    await expect(baseNode).toContainText("历史知识");
    await expect(baseNode.locator("[data-admin-kb-base-kind]")).toContainText("结构化");

    await openView(page, "/admin/knowledge/bases/kbase_legacy", "base");
    const table = page.locator("[data-admin-kb-entries-table]");
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

    await page.locator("[data-admin-knowledge-id='kb_mail_kol'] a").first().click();
    await expect(page.locator("[data-admin-kb-view='entry']")).toBeVisible();
    await expect(page.locator("[data-admin-kb-entry-meta]")).toContainText("首封建联");
    await expect(page.locator("[data-admin-kb-entry-meta]")).toContainText("历史知识");

    const versions = page.locator("[data-admin-kb-version]");
    await expect(versions.first()).toBeVisible();
    expect(await versions.count()).toBeGreaterThan(0);
    await page.locator("[data-admin-kb-version-open='1']").click();
    await expect(page.locator("[data-admin-kb-version-body='1']")).toContainText("LiTime Mini 12V");
  });

  test("入库视图：上传入口灰置并显式标注未实现", async ({ page }) => {
    await openView(page, "/admin/knowledge/ingest", "ingest");
    const upload = page.locator("[data-admin-kb-upload-disabled]");
    await expect(upload).toBeVisible();
    await expect(upload).toBeDisabled();
    await expect(page.locator("[data-admin-kb-ingest-unimplemented]")).toContainText("未实现");
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

  test("一页一问：每个视口最多 1 个实底主 CTA，待处置为 0", async ({ page }) => {
    await openView(page, "/admin/knowledge", "review");
    expect(await filledCtaCount(page, "[data-admin-kb-view='review']"), "待处置不应有实底主 CTA").toBe(0);

    for (const [path, view] of [
      ["/admin/knowledge/catalog", "catalog"],
      ["/admin/knowledge/bases/kbase_legacy", "base"],
      ["/admin/knowledge/entries/kb_mail_kol", "entry"],
      ["/admin/knowledge/ingest", "ingest"],
      ["/admin/knowledge/bindings", "bindings"],
    ] as const) {
      await openView(page, path, view);
      const filled = await filledCtaCount(page, `[data-admin-kb-view='${view}']`);
      expect(filled, `${view} 实底主 CTA 应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);
    }
  });

  test("待处置视图：员工反馈行可展开处置并忽略留档", async ({ page }) => {
    await page.request.delete("/api/knowledge/kb_mail_kol/deprecate");
    const posted = await page.request.post("/api/knowledge/kb_mail_kol/deprecate", { data: { reason: "过时" } });
    expect(posted.ok(), `写入隐藏记录失败：${posted.status()}`).toBeTruthy();

    await openView(page, "/admin/knowledge", "review");
    const row = page.locator("[data-admin-kb-feedback-row*='kb_mail_kol']").first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("首封建联");
    await expect(page.locator("[data-admin-kb-reason='outdated']")).toContainText("内容过时");

    await page.locator("[data-admin-kb-feedback-form*='kb_mail_kol'] summary").click();
    await page.locator("[data-admin-kb-feedback-note*='kb_mail_kol']").fill("E2E：过时已登记，先忽略");
    await page.locator("[data-admin-kb-feedback-ignore*='kb_mail_kol']").click();

    await expect(page.locator("[data-admin-receipt]")).toContainText("已忽略");
    const handled = page.locator("[data-admin-kb-handled*='kb_mail_kol']").first();
    await expect(handled).toBeVisible();
    await expect(handled).toContainText("已忽略");
    await expect(page.locator("[data-admin-kb-feedback-row*='kb_mail_kol']").first())
      .toHaveAttribute("data-admin-kb-feedback-handled", "1");
  });
});
