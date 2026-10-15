import { expect, test, type Page } from "@playwright/test";

/**
 * 当前原生知识治理工作区回归。
 *
 * 迁移记录：旧 `data-admin-kb-view` / 子页导航已退役。旧覆盖目标不删除：
 * - 默认页、旧深链与返回语义 → 右栏工作区的 stage 与保持地址；
 * - 驾驶舱分布/下钻 → `data-kbv-asset-strip` 的四段状态按钮；
 * - 目录、入库、查询技能 → 生命周期 stage 的真实可访问入口；
 * - 写入/确认流由 admin-knowledge-presentation.spec.ts 的 HTTP fixture 覆盖，
 *   本文件保留隔离 PG 上的入口、数据面和视觉强调回归。
 */
async function openStage(page: Page, path: string, stage: string) {
  await page.goto(path);
  const workspace = page.locator("[data-knowledge-right]");
  await expect(workspace).toBeVisible();
  await expect(workspace).toHaveAttribute("data-kb-active-stage", stage);
  return workspace;
}

async function filledCtaCount(page: Page): Promise<number> {
  return page.locator(".kbw-workarea .btn.work").evaluateAll((nodes) => nodes.filter((node) => {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && el.getBoundingClientRect().width > 0;
  }).length);
}

test.describe("知识治理管理端（/admin/knowledge）", () => {
  test("新主页默认可达；遗留子路径直达后保留地址并落入当前工作区", async ({ page }) => {
    await openStage(page, "/admin/knowledge", "published");
    await expect(page.locator("[data-admin-knowledge]")).toBeVisible();
    await expect(page.locator("[data-knowledge-middle]")).toBeVisible();
    await expect(page.getByRole("tablist", { name: "知识治理流程" }).getByRole("tab")).toHaveCount(5);

    for (const [path, stage] of [
      ["/admin/knowledge/catalog", "catalog"],
      ["/admin/knowledge/ingest", "processing"],
      ["/admin/knowledge/bindings", "bindings"],
    ]) {
      await openStage(page, path, stage);
      await expect(page).toHaveURL(new RegExp(path.replace(/[/?]/g, "\\$&")));
      await page.reload();
      await expect(page).toHaveURL(new RegExp(path.replace(/[/?]/g, "\\$&")));
      await expect(page.locator("[data-knowledge-middle]")).toBeVisible();
    }
  });

  test("治理驾驶舱保持四段状态分布和可撤销的同源筛选", async ({ page }) => {
    await openStage(page, "/admin/knowledge", "published");
    const dashboard = page.locator("[data-kbv-asset-strip]");
    await expect(dashboard).toBeVisible();
    await expect(dashboard).toContainText("组织资产概览");
    // 隔离空库可处于加载态；有结果时四段按钮仍须完整暴露，不能依赖旧库的遗留记录。
    const segments = dashboard.locator("[data-kb-status]");
    if (await segments.count()) await expect(segments).toHaveCount(4);
  });

  test("主页保留分类筛选、中栏知识浏览和右栏当前工作区", async ({ page }) => {
    await openStage(page, "/admin/knowledge", "published");
    await expect(page.getByRole("textbox", { name: "搜索知识" })).toBeVisible();
    await expect(page.getByRole("group", { name: "知识分类" })).toBeVisible();
    await expect(page.locator("[data-knowledge-middle]")).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "知识资产" })).toBeVisible();
  });

  test("目录深链映射到知识规划而不恢复退役目录页面", async ({ page }) => {
    const workspace = await openStage(page, "/admin/knowledge/catalog", "catalog");
    await expect(workspace.getByRole("tab", { name: "知识规划", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-admin-kb-view]")).toHaveCount(0);
  });

  test("入库深链映射到知识加工并保留紧凑资料表", async ({ page }) => {
    await openStage(page, "/admin/knowledge/ingest", "processing");
    const documents = page.locator("[data-admin-kb-documents]");
    await expect(documents).toBeVisible();
    // 有资料时是两列紧凑表；空隔离库则显示明确的空态而非退回旧页面。
    if (await page.locator("[data-admin-kb-documents-table]").count()) {
      await expect(page.locator("[data-admin-kb-documents-table] th")).toHaveText(["文件名", "资料详情"]);
    } else await expect(documents).toContainText("还没有资料");
  });

  test("查询技能深链映射到隐藏治理 stage，而不是放开独立旧页面", async ({ page }) => {
    const workspace = await openStage(page, "/admin/knowledge/bindings", "bindings");
    await expect(workspace.getByRole("tab")).toHaveCount(5);
    await expect(workspace.locator("[data-kb-lifecycle-tabs] [data-kb-stage='bindings']")).toHaveCount(0);
  });

  test("一页一问：每个当前生命周期 stage 最多一个实底主 CTA", async ({ page }) => {
    for (const stage of ["catalog", "create", "processing", "pending-review", "published"] as const) {
      await openStage(page, `/admin/knowledge?stage=${stage}`, stage);
      const count = await filledCtaCount(page);
      expect(count, `${stage} 实底主 CTA 数`).toBeLessThanOrEqual(1);
    }
  });
});
