import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../artifacts/review/unified-agent-workspace");

test("capture pool and lifecycle workspace evidence", async ({ page }) => {
  test.skip(process.env.E2E_EVIDENCE !== "1", "按需证据截屏（E2E_EVIDENCE=1 时运行）");
  fs.mkdirSync(OUT, { recursive: true });
  for (const mode of ["pool", "lifecycle"] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1000, height: 900 },
      { width: 1440, height: 520 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/?tab=${mode}`);
      await expect(
        page.locator(`[data-home-pane="${mode}"] [data-scope-task-rail]`),
      ).toBeVisible({ timeout: 30000 });
      await page.screenshot({
        path: path.join(OUT, `${mode}-${viewport.width}x${viewport.height}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?tab=${mode}`);
    const toggle = page.locator(`[data-home-pane="${mode}"] .scope-task-rail-toggle`);
    await expect(toggle).toBeVisible({ timeout: 30000 });
    await toggle.click();
    await page.screenshot({ path: path.join(OUT, `${mode}-collapsed.png`) });
  }
});
