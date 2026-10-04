import { expect, test } from "@playwright/test";
import { stubHomePool } from "./kol-surface-stub";

const items = Array.from({ length: 101 }, (_, index) => ({
  id: `page_${index}`, kol_uid: `page_${index}`, company_id: "company:amperetime",
  handle: `分页红人${index}`, platform: "youtube", homepage_url: `https://youtube.com/@page${index}`,
  pool_status: "open", public_stage: "INITIAL_CONTACT", followers: "12000",
}));

test("pool pages preserve global counts and selected analysis scope, and search the entire pool", async ({ page }) => {
  await stubHomePool(page);
  const offsets: number[] = [];
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get("query") || "";
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 50);
    offsets.push(offset);
    const filtered = items.filter((row) => !query || row.handle.includes(query));
    await route.fulfill({ json: {
      items: filtered.slice(offset, offset + limit), library: { count: 101 },
      page: { offset, limit, total: 101, matched: filtered.length, new_count: 101,
        next_offset: offset + limit < filtered.length ? offset + limit : null },
    } });
  });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]")).toHaveCount(50);
  await expect(page.locator("[data-pool-total]")).toHaveText("101");
  await page.locator("[data-pool-select='page_0']").check();
  await page.locator("[data-pool-next]").click();
  await expect(page.locator("[data-pool-kol='page_50']")).toBeVisible();
  await expect(page.locator("[data-pool-select]:checked")).toHaveCount(0);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/分页红人0/);
  await page.locator("[data-pool-next]").click();
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await expect(page.locator("[data-pool-next]")).toBeDisabled();
  await page.locator("[data-pool-search]").fill("分页红人100");
  await expect(page.locator("[data-pool-kol='page_100']")).toBeVisible();
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await expect(page.locator("[data-pool-total]")).toHaveText("101");
  await expect.poll(() => offsets).toEqual([0, 50, 100, 0]);
});

test("a late search response cannot replace the current search", async ({ page }) => {
  await stubHomePool(page);
  let releaseSlow: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { releaseSlow = resolve; });
  let sawSlow: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { sawSlow = resolve; });
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query") || "";
    if (query === "慢") { sawSlow?.(); await pending; }
    await route.fulfill({ json: {
      items: [{ ...items[0], handle: query || "初始", display_name: query || "初始" }],
      library: { count: 101 }, page: { offset: 0, limit: 50, total: 101, matched: 1, new_count: 101, next_offset: null },
    } });
  });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await page.locator("[data-pool-search]").fill("慢");
  await started;
  await page.locator("[data-pool-search]").fill("快");
  await expect(page.locator("[data-pool-card]")).toContainText("@快");
  const slowResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get("query") === "慢");
  releaseSlow?.();
  await (await slowResponse).finished();
  await expect(page.locator("[data-pool-card]")).toContainText("@快");
});
