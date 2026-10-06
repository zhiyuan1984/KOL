import { expect, test, type Page } from "@playwright/test";

/**
 * 知识治理管理端（IA v2，2026-10-02；中栏 chips 改版 2026-10-03）的 e2e 契约。
 *
 * 断言只依赖页面自己的 DOM 契约与既有对话框钩子：
 *   新主页（默认路由）→ data-admin-kb-v2="home"：中栏七组「标签＋计数」chips / 右栏五条浏览 / 下方详情
 *   旧子视图过渡保留：子视图直达 ＋ data-admin-kb-home-link 回链（无旧导航痕迹）
 *   一页一问 → 每个视口最多 1 个实底主 CTA（--primary 实底）。
 *
 * stub 环境用 data-e2e 的种子知识（kb_mail_kol =「首封建联」，已发布、sriphy 已启用），
 * 以及迁移生成的默认分类：族「未分类」→ 域「未分类」→ 库「历史知识」（kbase_legacy，结构化）。
 * 该数据库跨运行保留，故：引用视图会在用例末尾删掉自建绑定。
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
  test("新主页默认可达；子视图直达且可回链", async ({ page }) => {
    await page.goto("/admin/knowledge");
    const home = page.locator('[data-admin-kb-v2="home"]');
    await expect(home).toBeVisible();
    await expect(page.locator("[data-admin-knowledge]")).toBeVisible();
    await expect(page.locator("[data-kbv-view]")).toHaveCount(3);
    await expect(page.locator("[data-kbv-record]").first()).toBeVisible();
    await expect(page.locator("[data-admin-kb-tab]")).toHaveCount(0);
    // 三级分类联动 chips（业务族 → 业务域 → 知识库）与筛选标签。
    await expect(page.locator("[data-kb-scope-family]").first()).toBeVisible();
    await expect(page.locator("[data-kb-scope-domain]").first()).toBeVisible();
    await expect(page.locator("[data-kb-scope-base]").first()).toBeVisible();
    await expect(page.locator("[data-kb-filter='brand']")).toBeVisible();
    // 分类 chips 点选可用：选「历史知识」→ 列表仍在；点「全部」→ 恢复。
    // （弹窗内也渲染分类 tab，断言限定在中栏内，避开 strict mode。）
    const pane = page.locator("[data-kbv-filter-pane]");
    await pane.locator("[data-kb-scope-base='kbase_legacy']").click();
    await expect(pane.locator("[data-kb-scope-base='kbase_legacy']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-kbv-record]").first()).toBeVisible();
    await pane.locator("[data-kb-scope-base='']").click();
    await expect(pane.locator("[data-kb-scope-base='']")).toHaveAttribute("aria-pressed", "true");

    // 子视图直达可达：仅保留返回回链（旧版导航已撤）。
    await openView(page, "/admin/knowledge/catalog", "catalog");
    await expect(page.locator("[data-admin-kb-home-link]")).toBeVisible();
    await openView(page, "/admin/knowledge/bases", "base");
    await expect(page.locator("[data-admin-kb-context-hint]")).toBeVisible();
    await openView(page, "/admin/knowledge/bases/kbase_legacy", "base");
    await openView(page, "/admin/knowledge/entries/kb_mail_kol", "entry");
    await page.locator("[data-admin-kb-home-link]").click();
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
  });

  test("治理驾驶舱：状态分布条与待处置队列，下钻走带筛选的列表", async ({ page }) => {
    await page.goto("/admin/knowledge");
    const dashboard = page.locator("[data-admin-kb-dashboard]");
    await expect(dashboard).toBeVisible();
    // 生命周期状态是一条分布条（4 段），不是 6 张并列 KPI 卡（DESIGN §9.2）。
    await expect(dashboard.locator("[data-admin-kb-status] [data-kb-status]")).toHaveCount(4);
    // 跨对象待办用队列行（4 行）。
    await expect(dashboard.locator("[data-admin-kb-queue] [data-kb-queue]")).toHaveCount(4);
    // 有筛选轴的下钻是链接语义（可复制、可后退）；没有筛选轴的在页内展开。
    await expect(dashboard.locator("[data-kb-status='draft']")).toHaveAttribute("href", "/admin/knowledge?view=draft");
    await expect(dashboard.locator("[data-kb-status='published']")).toHaveAttribute("href", "/admin/knowledge?view=published");
    await expect(dashboard.locator("[data-kb-queue='expiry']")).toHaveAttribute("href", "/admin/knowledge?expiring=1");
    await expect(dashboard.locator("[data-kb-queue='documents']")).toHaveAttribute("href", "/admin/knowledge?view=pending&asset=document");
    await expect(dashboard.locator("[data-kb-queue='feedback']")).toHaveAttribute("aria-expanded", "false");
    expect(await dashboard.locator("[data-kb-queue='feedback']").getAttribute("href")).toBeNull();

    // 点状态段 → 落到带筛选的列表：条件在 URL 上并可一键清除。
    await dashboard.locator("[data-kb-status='draft']").click();
    await expect(page).toHaveURL(/view=draft/);
    await expect(page.locator("[data-kbv-filter-note]")).toContainText("草稿");
    await page.locator("[data-kbv-filter-note-clear]").click();
    await expect(page.locator("[data-kbv-filter-note]")).toHaveCount(0);
    expect(page.url()).not.toContain("view=draft");

    // 没有筛选轴的两行：页内展开自身列表，不假装跳转。
    await dashboard.locator("[data-kb-queue='feedback']").click();
    await expect(page.locator("[data-admin-kb-feedback]")).toBeVisible();
    await expect(dashboard.locator("[data-kb-queue='feedback']")).toHaveAttribute("aria-expanded", "true");
    await dashboard.locator("[data-kb-queue='feedback']").click();
    await expect(page.locator("[data-admin-kb-feedback]")).toHaveCount(0);
  });

  test("新主页骨架：中栏筛选、右栏详情与阶段标注", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
    await expect(page.locator("[data-kbv-top]")).toHaveCount(0);
    await expect(page.locator("[data-kbv-filter-pane]")).toBeVisible();
    await expect(page.locator("[data-kbv-count]")).toHaveText(/\d+ 条知识/);
    await expect(page.locator("[data-kbv-record]")).toHaveCount(5);

    await page.locator("[data-kbv-record]").first().click();
    await expect(page.locator("[data-kbv-detail]")).toContainText("正文");
    await expect(page.locator("[data-kbv-detail]")).toContainText("属性与范围");
    await expect(page.locator("[data-kbv-detail]")).toContainText("来源与版本");

    // PDF 草稿入口：缺少文件或非结构化目标时禁用。
    await page.locator("[data-kbv-upload]").click();
    const upload = page.locator("[data-kbv-upload-dialog]");
    await expect(upload).toBeVisible();
    await expect(upload).toContainText("支持 PDF");
    await expect(upload.locator("[data-kb-scope-picker]")).toBeVisible();
    await expect(upload).not.toContainText("上传服务暂不可用");
    await expect(page.locator("[data-kbv-upload-submit]")).toBeDisabled();
    await expect(upload).not.toContainText(/P2 接入|P3 接入|迁移中|旧版/);
    await page.keyboard.press("Escape");
    await expect(upload).toBeHidden();

    // 新建知识 → 打开新建弹窗（真实写草稿入口）。
    await page.locator("[data-kbv-new]").click();
    await expect(page.locator("[data-kbv-create-dialog]")).toBeVisible();
    await expect(page.locator("[data-kbv-create-submit]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-kbv-create-dialog]")).toBeHidden();
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

  test("入库视图：stub 引擎健康时上传入口可用，资料区可见（不再灰置）", async ({ page }) => {
    await openView(page, "/admin/knowledge/ingest", "ingest");
    await expect(page.locator("[data-admin-kb-doc-upload]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-engine-health]")).toContainText("PageIndex");
    await expect(page.locator("[data-admin-kb-doc-upload-submit]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-documents]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-upload-disabled]")).toHaveCount(0);
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

  test("一页一问：每个视口最多 1 个实底主 CTA", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
    const homeFilled = await filledCtaCount(page, '[data-admin-kb-v2="home"]');
    expect(homeFilled, `新主页实底主 CTA 应为 0–1 个，实测 ${homeFilled} 个`).toBeLessThanOrEqual(1);

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

  // 员工反馈处置的 UI 随旧「待处置」视图一并退役（P2 接回新主页的详情/待办）；数据与 API 不变。
  test.skip("待处置视图：员工反馈行可展开处置并忽略留档", async ({ page }) => {
    await page.request.delete("/api/knowledge/kb_mail_kol/deprecate");
    const posted = await page.request.post("/api/knowledge/kb_mail_kol/deprecate", { data: { reason: "过时" } });
    expect(posted.ok(), `写入隐藏记录失败：${posted.status()}`).toBeTruthy();

    await page.goto("/admin/knowledge");
    const row = page.locator("[data-admin-kb-feedback-row*='kb_mail_kol']").first();
    await expect(row).toBeVisible();
  });
});
