import { expect, test, type Page } from "@playwright/test";

/**
 * 知识库 IA v2 主页契约（P1 骨架，2026-10-02；中栏 chips 改版 2026-10-03）：
 *   管理端 /admin/knowledge → data-admin-kb-v2="home"（中栏七组「标签＋计数」chips / 右栏五条浏览与详情）
 *   员工端 /kb → data-kb-v2="home"（同构：data-kbv-view ＋ data-kbv-record）
 *   旧子视图过渡保留：slim 导航（data-admin-kb-home-link ＋ 5 个 data-admin-kb-tab）
 *   诚实边界：上传在服务接入前灰置并给出说明；新建知识打开弹窗、只写草稿；界面无工程阶段话术。
 * 依赖 data-e2e 种子（kb_mail_kol / kbase_legacy 等跨运行保留）；用例内创建的草稿会自清理。
 */

/** 统计某个根节点内的实底主 CTA（背景 = --primary，与 admin-knowledge.spec 同法）。 */
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

test.describe("知识库 v2 主页（管理端）", () => {
  test("主页骨架：中栏筛选、右栏五条浏览与下方详情", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
    await expect(page.locator("[data-kbv-top]")).toHaveCount(0);
    await expect(page.locator("[data-kbv-filter-pane]")).toBeVisible();
    await expect(page.locator("[data-kbv-count]")).toHaveText(/\d+ 条知识/);

    // 七组筛选均为「标签＋计数」chips；零计数的选项不渲染（DESIGN §8 零数据不渲染）。
    await expect(page.locator("[data-kb-scope-family]").first()).toBeVisible();
    await expect(page.locator("[data-kb-filter='brand']")).toBeVisible();
    await expect(page.locator("[data-kb-filter='brand'] [data-kb-filter-value=''] [data-kb-facet-count]")).toHaveText(/\d+/);
    await expect(page.locator("[data-kb-filter='taxonomy'] [data-kb-scope-base]").first()).toBeVisible();
    await expect(page.locator("[data-kb-filter='brand'] [data-kb-filter-value='']")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-kb-filter='kind'] [data-kb-kind]")).toHaveCount(4);
    await expect(page.locator("[data-kb-kind='question_template']")).toContainText("问题模板");
    await expect(page.locator("[data-kb-kind='glossary']")).toHaveCount(0);
    // 状态＝「全部」＋有计数的状态（种子数据：已发布 / 已停用）。
    await expect(page.locator("[data-kbv-view]")).toHaveCount(3);
    await expect(page.locator("[data-kbv-view='published']")).toBeVisible();
    await expect(page.locator("[data-kbv-view='draft']")).toHaveCount(0);
    await expect(page.locator("[data-kbv-record]")).toHaveCount(5);
    await expect(page.locator("[data-kbv-record]").first()).toBeVisible();

    // 阶段：多选 chips＋「全部」；超过 8 项先折叠，展开后选中仍生效。
    const stageRow = page.locator("[data-kb-filter='stage']");
    await expect(stageRow.locator('[data-kb-stage-toggle="INITIAL_CONTACT"]')).toBeVisible();
    await expect(stageRow.locator('[data-kb-stage-toggle="SETTLING"]')).toHaveCount(0);
    await stageRow.locator("[data-kb-stage-more]").click();
    await expect(stageRow.locator('[data-kb-stage-toggle="SETTLING"]')).toBeVisible();
    await stageRow.locator('[data-kb-stage-toggle="INITIAL_CONTACT"]').click();
    await stageRow.locator('[data-kb-stage-toggle="INTERESTED"]').click();
    await expect(stageRow.locator('[data-kb-stage-toggle="INITIAL_CONTACT"]')).toHaveAttribute("aria-pressed", "true");
    await expect(stageRow.locator('[data-kb-stage-toggle="INTERESTED"]')).toHaveAttribute("aria-pressed", "true");
    await expect(stageRow.locator('[data-kb-stage-toggle=""]')).toHaveAttribute("aria-pressed", "false");
    await stageRow.locator('[data-kb-stage-toggle=""]').click();
    await expect(stageRow.locator('[data-kb-stage-toggle="INITIAL_CONTACT"]')).toHaveAttribute("aria-pressed", "false");
    await expect(stageRow.locator('[data-kb-stage-toggle=""]')).toHaveAttribute("aria-pressed", "true");

    await page.locator("[data-kbv-record]").first().click();
    await expect(page.locator("[data-kbv-detail]")).toContainText("正文");
    await expect(page.locator("[data-kbv-detail]")).toContainText("属性与范围");
    await expect(page.locator("[data-kbv-detail]")).toContainText("来源与版本");

    // 翻页后，原选中项不在当前页时自动选中新页第一条。
    await page.locator("[data-kbv-next]").click();
    await expect(page.locator("[data-kbv-page]")).toHaveText(/第 2 \/ \d+ 页/);
    await expect(page.locator("[data-kbv-record]").first()).toHaveAttribute("aria-current", "true");
  });

  test("诚实边界：上传弹窗三级 tab＋阶段标签、新建开弹窗、页面无工程话术", async ({ page }) => {
    await page.goto("/admin/knowledge");
    const home = page.locator('[data-admin-kb-v2="home"]');
    await expect(home).toBeVisible();
    await expect(home).not.toContainText(/P2 接入|P3 接入|迁移中|旧版/);

    await page.locator("[data-kbv-upload]").click();
    const upload = page.locator("[data-kbv-upload-dialog]");
    await expect(upload).toBeVisible();
    await expect(upload).toContainText("音视频将先转写");
    await expect(upload.locator("[data-kb-scope-picker]")).toBeVisible();
    await expect(upload.locator("[data-kb-stage-tags]")).toBeVisible();
    await expect(upload).not.toContainText("上传服务暂不可用");
    await expect(page.locator("[data-kbv-upload-submit]")).toBeDisabled();
    await expect(upload).not.toContainText(/P2 接入|P3 接入|迁移中|旧版/);
    await page.keyboard.press("Escape");
    await expect(upload).toBeHidden();

    // 新建知识 → 打开新建弹窗（真实写草稿入口；写入流程由下一个用例覆盖）。
    await page.locator("[data-kbv-new]").click();
    const create = page.locator("[data-kbv-create-dialog]");
    await expect(create).toBeVisible();
    await expect(page.locator("[data-kbv-create-submit]")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(create).toBeHidden();
  });

  test("新建知识弹窗：创建草稿、留回执并自清理", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await page.locator("[data-kbv-new]").click();
    const dlg = page.locator("[data-kbv-create-dialog]");
    await expect(dlg).toBeVisible();
    const submit = page.locator("[data-kbv-create-submit]");
    await expect(submit).toBeDisabled();

    const title = `E2E 中栏草稿 ${Date.now()}`;
    await dlg.locator("[data-kbv-create-title]").fill(title);
    await dlg.locator('[data-kb-create-kind="policy"]').click();
    await dlg.locator('[data-kb-create-brand="LT"]').click();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(dlg).toBeHidden();
    await expect(page.locator("[data-admin-receipt]")).toContainText("已创建草稿");
    await expect(page.locator("[data-admin-receipt]")).toContainText(title);

    // 自清理：把本用例创建的草稿从 data-e2e 删掉（硬删仅限草稿）。
    const response = await page.request.get("/api/admin/knowledge?limit=500");
    const rows = (await response.json()) as Array<{ id: string; title: string }>;
    const mine = rows.filter((row) => row.title === title);
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      const deleted = await page.request.delete(`/api/admin/knowledge/${row.id}`);
      expect(deleted.ok(), `草稿清理失败：${deleted.status()}`).toBeTruthy();
    }
  });

  test("子视图直达与回链（无旧版导航痕迹）", async ({ page }) => {
    await page.goto("/admin/knowledge/ingest");
    await expect(page.locator('[data-admin-kb-view="ingest"]')).toBeVisible();
    await expect(page.locator("[data-admin-kb-home-link]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-tab]")).toHaveCount(0);
    await page.locator("[data-admin-kb-home-link]").click();
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
  });

  test("一页一问：主页实底主 CTA 0–1 个", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
    const filled = await filledCtaCount(page, '[data-admin-kb-v2="home"]');
    expect(filled, `新主页实底主 CTA 应为 0–1 个，实测 ${filled} 个`).toBeLessThanOrEqual(1);
  });
});

test.describe("知识库 v2 主页（员工端）", () => {
  test("员工主页：快捷视图、行选中、右栏详情与主 CTA", async ({ page }) => {
    await page.goto("/kb");
    const kb = page.locator('[data-kb-page="mine"]');
    await expect(kb).toBeVisible();
    await expect(kb.locator("[data-kbv-view]")).toHaveCount(3);
    await expect(kb.locator("[data-kbv-view='all']")).toHaveAttribute("aria-pressed", "true");

    await kb.locator("[data-kbv-view='favorites']").click();
    await expect(kb.locator("[data-kbv-view='favorites']")).toHaveAttribute("aria-pressed", "true");
    await kb.locator("[data-kbv-view='all']").click();

    await kb.locator("[data-knowledge]").first().click();
    await expect(page.locator("[data-kb-provenance]")).toBeVisible();
    await expect(page.locator("[data-fill-composer]").first()).toBeVisible();
    const filled = await filledCtaCount(page, '[data-kb-page="mine"]');
    expect(filled, `员工主页实底主 CTA 应为恰好 1 个（用于当前任务），实测 ${filled} 个`).toBe(1);
  });
});
