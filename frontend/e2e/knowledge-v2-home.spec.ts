import { expect, test, type Page } from "@playwright/test";

/**
 * 知识库 IA v2 主页契约（P1 骨架，2026-10-02）：
 *   管理端 /admin/knowledge → data-admin-kb-v2="home"（顶栏 / 快捷视图 / 中栏列表 / 右栏三 tab）
 *   员工端 /kb → data-kb-v2="home"（同构：data-kbv-view ＋ data-kbv-record）
 *   旧子视图过渡保留：slim 导航（data-admin-kb-home-link ＋ 5 个 data-admin-kb-tab）
 *   诚实边界：上传在服务接入前灰置并给出说明；新建知识进入目录（真实入口）；界面无工程阶段话术。
 * 依赖 data-e2e 种子（kb_mail_kol / kbase_legacy 等跨运行保留）。
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
  test("主页骨架：顶栏、快捷视图、真实列表、右栏三 tab", async ({ page }) => {
    await page.goto("/admin/knowledge");
    await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
    await expect(page.locator("[data-kbv-top]")).toBeVisible();
    await expect(page.locator("[data-kbv-view]")).toHaveCount(5);
    await expect(page.locator("[data-kb-scope-family]").first()).toBeVisible();
    await expect(page.locator("[data-kb-filter='brand']")).toBeVisible();
    await expect(page.locator("[data-kbv-record]").first()).toBeVisible();

    // 适用阶段标签行：＋增加、×移除，无「全部」标签（select 选项文本不计入芯片）。
    const stageRow = page.locator("[data-kb-filter='stage']");
    await expect(stageRow).not.toContainText("全部");
    await stageRow.locator("[data-kb-stage-add]").selectOption("INITIAL_CONTACT");
    await expect(stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]')).toBeVisible();
    await stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]').click();
    await expect(stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]')).toHaveCount(0);

    await page.locator("[data-kbv-record]").first().click();
    await expect(page.locator("[data-kbv-detail-tab]")).toHaveCount(3);
    await page.locator('[data-kbv-detail-tab="props"]').click();
    await expect(page.locator("[data-kbv-detail]")).toContainText("知识标识");
    await page.locator('[data-kbv-detail-tab="versions"]').click();
    await expect(page.locator("[data-kbv-detail]")).toContainText("版本");
  });

  test("诚实边界：上传弹窗三级 tab＋阶段标签、新建跳转目录、页面无工程话术", async ({ page }) => {
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

    await page.locator("[data-kbv-new]").click();
    await expect(page.locator('[data-admin-kb-view="catalog"]')).toBeVisible();
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
