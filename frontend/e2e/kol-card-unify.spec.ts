import { expect, test, type Page } from "@playwright/test";

const fixturePath = "/e2e/kol-card-fixture.html";
const standardKinds = ["followed", "pool", "discovery"] as const;
type StandardKind = typeof standardKinds[number];
type ApiCall = { method: string; path: string };

function fixtureUrl(params: Record<string, string | number> = {}) {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  return `${fixturePath}?${query}`;
}

async function interceptAllApi(page: Page) {
  const calls: ApiCall[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({ method: request.method(), path });
    // The fixture itself makes no reads. Explicit candidate commands receive a
    // narrow fake receipt only so the real component can finish its UI state.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, starry_imported: true }) });
  });
  return calls;
}

function card(page: Page, kind: StandardKind) {
  return page.locator(`[data-fixture-card="${kind}"] .kol-card-row`);
}

async function openFixture(page: Page, params: Record<string, string | number>) {
  await page.goto(fixtureUrl(params));
  // Fresh Vite dependency optimization can exceed Playwright's default 5s on
  // the first request. This is a local-render readiness gate, not a retry.
  await expect(card(page, "discovery")).toBeVisible({ timeout: 15_000 });
}

test.describe("KOL card unification · isolated real-component fixture", () => {
  test("same factual sample uses shared visual atoms and aligned full-width content", async ({ page }, info) => {
    const calls = await interceptAllApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, { container: 360, theme: "light" });
    await expect(page.locator("[data-fixture-card-grid]")).toBeVisible();

    const geometry = await page.locator("[data-fixture-card] .kol-card-row").evaluateAll(nodes => nodes.map(node => {
      const card = node as HTMLElement;
      const missing: string[] = [];
      const pick = <T extends Element>(selector: string) => {
        const found = card.querySelector<T>(selector);
        if (!found) missing.push(selector);
        return found;
      };
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right };
      };
      const avatar = pick<HTMLElement>(".kol-card-avatar");
      const image = avatar?.querySelector<HTMLImageElement>("img");
      if (!image) missing.push(".kol-card-avatar img");
      // Ant Design 6 draws the visual box on .ant-checkbox (its tick is a
      // pseudo-element); there is no .ant-checkbox-inner in this version.
      const checkbox = pick<HTMLElement>(".kol-card-selection .ant-checkbox");
      const icon = pick<HTMLElement>(".kol-card-icon");
      const name = pick<HTMLElement>("[data-kol-name]");
      const action = pick<HTMLElement>(".kol-card-action");
      const identity = pick<HTMLElement>("[data-kol-layout=identity]");
      const meta = pick<HTMLElement>("[data-kol-layout=meta]");
      const style = getComputedStyle(card);
      const nameStyle = getComputedStyle(name || card);
      const actionStyle = getComputedStyle(action || card);
      const imageStyle = image ? getComputedStyle(image) : null;
      const metaStyle = getComputedStyle(meta || card);
      return {
        missing, card: rect(card), avatar: rect(avatar || card), image: image ? rect(image) : null,
        checkbox: rect(checkbox || card), icon: rect(icon || card), name: rect(name || card), action: rect(action || card),
        identity: rect(identity || card), meta: rect(meta || card), paddingLeft: style.paddingLeft, rowGap: style.rowGap,
        nameFont: nameStyle.fontSize, nameWeight: nameStyle.fontWeight,
        actionFont: actionStyle.fontSize, actionHeight: actionStyle.height,
        metaFont: metaStyle.fontSize, metaLineHeight: metaStyle.lineHeight,
        imageFit: imageStyle?.objectFit, imagePosition: imageStyle?.objectPosition,
      };
    }));

    expect(geometry).toHaveLength(3);
    for (const sample of geometry) {
      expect(sample.missing).toEqual([]);
      expect(sample.avatar.width).toBeCloseTo(24, 0);
      expect(sample.avatar.height).toBeCloseTo(24, 0);
      expect(sample.image?.width).toBeCloseTo(24, 0);
      expect(sample.image?.height).toBeCloseTo(24, 0);
      expect(sample.checkbox.width).toBeCloseTo(14, 0);
      expect(sample.checkbox.height).toBeCloseTo(14, 0);
      expect(sample.icon.width).toBeCloseTo(14, 0);
      expect(sample.icon.height).toBeCloseTo(14, 0);
      expect(sample.nameFont).toBe("13px");
      expect(Number(sample.nameWeight)).toBe(500);
      expect(sample.actionHeight).toBe("24px");
      expect(sample.actionFont).toBe("13px");
      expect(sample.metaFont).toBe("12px");
      expect(sample.paddingLeft).toBe("8px");
      expect(sample.rowGap).toBe("4px");
      expect(sample.imageFit).toBe("cover");
      expect(["50% 50%", "center center"]).toContain(sample.imagePosition);
      // Meta must use the same full row as identity, rather than reserve a
      // persistent avatar/action column below the identity anchor.
      expect(Math.abs(sample.meta.x - sample.identity.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.meta.right - sample.identity.right)).toBeLessThanOrEqual(1);
    }
    const baseline = geometry[0];
    for (const sample of geometry.slice(1)) {
      for (const key of ["avatar", "checkbox", "name"] as const) {
        const relativeX = sample[key].x - sample.card.x;
        const baselineRelativeX = baseline[key].x - baseline.card.x;
        expect(Math.abs(relativeX - baselineRelativeX), `${key} horizontal identity anchor`).toBeLessThanOrEqual(1);
        const relativeY = sample[key].y - sample.card.y;
        const baselineRelativeY = baseline[key].y - baseline.card.y;
        expect(Math.abs(relativeY - baselineRelativeY), `${key} vertical identity anchor`).toBeLessThanOrEqual(1);
      }
    }
    expect(calls).toEqual([]);
    await page.screenshot({ path: info.outputPath("kol-card-light-360.png"), fullPage: true });
  });

  for (const theme of ["light", "dark"]) {
    test(`container breakpoints and themed screenshot remain usable: ${theme}`, async ({ page }, info) => {
      const calls = await interceptAllApi(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const width of [360, 479, 480, 719, 720, 820]) {
        await openFixture(page, { container: width, theme });
        for (const kind of standardKinds) {
          const item = card(page, kind);
          await expect(item).toBeVisible();
          const usable = await item.evaluate((element, fixtureWidth) => ({
            clientWidth: (element as HTMLElement).clientWidth,
            scrollWidth: (element as HTMLElement).scrollWidth,
            expected: Math.min(fixtureWidth, document.querySelector("[data-fixture-root]")!.getBoundingClientRect().width),
          }), width);
          expect(usable.scrollWidth).toBeLessThanOrEqual(usable.clientWidth + 1);
          expect(usable.clientWidth).toBeGreaterThanOrEqual(Math.min(usable.expected, width) - 1);
        }
      }
      await openFixture(page, { container: 820, theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({ path: info.outputPath(`kol-card-${theme}-820.png`), fullPage: true });
      expect(calls).toEqual([]);
    });
  }

  test("specified real viewports and 200% zoom use a genuinely shrinking fixture container", async ({ page }) => {
    const calls = await interceptAllApi(page);
    for (const width of [375, 768, 1100, 1101, 1440, 1920]) {
      await page.setViewportSize({ width, height: 600 });
      await openFixture(page, { container: 820, theme: "light" });
      for (const kind of standardKinds) {
        const item = card(page, kind);
        await expect(item).toBeVisible();
        expect(await item.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 600 });
    await openFixture(page, { container: 820, theme: "dark", zoom: 2 });
    const zoomed = await card(page, "discovery").evaluate(element => {
      const root = document.querySelector<HTMLElement>("[data-fixture-root]")!;
      const action = element.querySelector<HTMLElement>(".kol-card-action")!;
      return {
        rootWidth: root.getBoundingClientRect().width,
        cardClientWidth: (element as HTMLElement).clientWidth,
        cardScrollWidth: (element as HTMLElement).scrollWidth,
        transition: getComputedStyle(action).transitionDuration,
        documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    // zoom=2 halves the layout width: this proves the card actually reflows
    // into a narrower container instead of merely passing a fixed-width page check.
    expect(zoomed.rootWidth).toBeLessThanOrEqual(376);
    expect(zoomed.cardClientWidth).toBeLessThanOrEqual(375);
    expect(zoomed.cardScrollWidth).toBeLessThanOrEqual(zoomed.cardClientWidth + 1);
    expect(zoomed.documentOverflow).toBe(false);
    // Chromium may serialize CSS `transition: none` as 1e-05s at zoom=2.
    expect(Number.parseFloat(zoomed.transition)).toBeLessThanOrEqual(0.001);
    expect(calls).toEqual([]);
  });

  test("long summaries, evidence, image fallbacks, selections, and followed busy callback keep their real semantics", async ({ page }) => {
    const calls = await interceptAllApi(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await openFixture(page, { container: 360, theme: "light" });

    const followed = card(page, "followed");
    const summary = followed.locator(".kol-card-summary-text");
    await expect(summary).not.toHaveAttribute("data-expanded");
    // The long fixture summary must offer keyboard expansion, then expose all text.
    // A ResizeObserver can settle after layout; wait for the actual affordance.
    const expand = followed.getByRole("button", { name: "展开全文" });
    await expect(expand).toBeVisible();
    await expand.focus();
    await page.keyboard.press("Enter");
    await expect(followed.getByRole("button", { name: "收起全文" })).toBeVisible();
    await expect(summary).toHaveAttribute("data-expanded", "true");
    await expect(followed).toContainText("这是一段刻意超过两行的互动摘要");

    const evidence = followed.locator("details");
    await evidence.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(evidence).toHaveAttribute("open", "");

    await card(page, "pool").getByRole("checkbox").check();
    await expect(card(page, "pool").getByRole("checkbox")).toBeChecked();
    await card(page, "discovery").getByRole("checkbox").check();
    await expect(card(page, "discovery").getByRole("checkbox")).toBeChecked();
    expect(calls).toEqual([]);

    const primary = followed.locator("[data-confirm-enter-stage]");
    await primary.click();
    await expect(page.locator("[data-fixture-followed-primary]")).toHaveText("1");
    await expect(primary).toBeDisabled();
    await expect(primary).toHaveText("正在打开…");
    expect(calls).toEqual([]);

    await expect(page.locator("[data-fixture-edge=missing-avatar] [data-kol-avatar=fallback]")).toBeVisible();
    await expect.poll(async () => page.locator("[data-fixture-edge=failed-avatar] [data-kol-avatar=fallback]").count()).toBe(1);
  });

  test.describe("coarse pointer", () => {
    test.use({ hasTouch: true });
    test("44px interactive hit targets do not overlap while avatars remain visually 24px", async ({ page }) => {
      const calls = await interceptAllApi(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await openFixture(page, { container: 360, theme: "light" });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBeTruthy();
      for (const kind of standardKinds) {
        const item = card(page, kind);
        const avatar = await item.locator(".kol-card-avatar").boundingBox();
        expect(avatar?.width).toBeCloseTo(24, 0);
        expect(avatar?.height).toBeCloseTo(24, 0);
        const targets = await item.locator(".kol-card-selection, .kol-card-action, summary, .kol-card-link").evaluateAll(nodes => nodes.map((node, index) => {
          const box = node.getBoundingClientRect();
          return { index, width: box.width, height: box.height, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }));
        for (const target of targets) {
          expect(target.width).toBeGreaterThanOrEqual(44);
          expect(target.height).toBeGreaterThanOrEqual(44);
        }
        for (let index = 0; index < targets.length; index += 1) {
          for (let next = index + 1; next < targets.length; next += 1) {
            const a = targets[index];
            const b = targets[next];
            const intersects = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            expect(intersects, `${kind} target ${a.index} must not overlap target ${b.index}`).toBe(false);
          }
        }
      }
      expect(calls).toEqual([]);
    });
  });

  test("candidate API actions are intercepted: import cancel is zero-write; confirmed import, follow and ignore are once-only", async ({ page }) => {
    const calls = await interceptAllApi(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await openFixture(page, { container: 360, theme: "light" });
    const candidateCard = card(page, "discovery");

    await candidateCard.getByRole("button", { name: "加入公海", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(calls).toEqual([]);

    await candidateCard.getByRole("button", { name: "加入公海", exact: true }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "确认入库公海", exact: true });
    await confirm.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    await expect.poll(() => calls.filter(call => call.path.endsWith("/ingest")).length).toBe(1);
    expect(calls.filter(call => call.path.endsWith("/ingest"))).toHaveLength(1);

    await openFixture(page, { container: 360, theme: "light" });
    calls.length = 0;
    await card(page, "discovery").getByRole("button", { name: "跟进", exact: true }).evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/home/discovery/runtime/fixture-action/candidates/fixture-kol/follow" });

    await openFixture(page, { container: 360, theme: "light" });
    calls.length = 0;
    await card(page, "discovery").getByRole("button", { name: "忽略", exact: true }).evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/home/discovery/runtime/fixture-action/candidates/fixture-kol/ignore" });
  });

  test("pool claim remains a local callback fixture: cancel writes nothing and confirm callback is once-only", async ({ page }) => {
    const calls = await interceptAllApi(page);
    await openFixture(page, { container: 360, theme: "light" });
    const pool = card(page, "pool");
    await pool.getByRole("button", { name: "领取跟进", exact: true }).click();
    await expect(pool.locator("[data-claim-follow-confirm]")).toBeVisible();
    await pool.getByRole("button", { name: "取消", exact: true }).click();
    await expect(pool.locator("[data-claim-follow-confirm]")).toHaveCount(0);
    expect(calls).toEqual([]);

    await pool.getByRole("button", { name: "领取跟进", exact: true }).click();
    const confirm = pool.getByRole("button", { name: "确认领取 " + "@北美露营与离网电源超长创作者名称用于换行与截断核验" });
    await confirm.click();
    await expect(page.locator("[data-fixture-pool-confirm]")).toHaveText("1");
    await expect(confirm).toBeDisabled();
    expect(calls).toEqual([]);
  });

  test("standard candidate and pool remain below the 120px compact baseline at a wide actual container", async ({ page }) => {
    const calls = await interceptAllApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFixture(page, { container: 820, theme: "light" });
    for (const kind of ["pool", "discovery"] as const) {
      const box = await card(page, kind).boundingBox();
      expect(box?.height, `${kind} standard sample must stay compact`).toBeLessThan(120);
    }
    expect(calls).toEqual([]);
  });
});

// Intentional reuse: discovery-results-density.spec.ts already covers the
// production /s/:id result-pane screenshots, live refresh and batch-import
// confirmation. This fixture suite supplements it with three-entry geometry.

test('insufficient suggestion uses explicit text roles without resizing the leading warning icon', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.goto('/e2e/kol-card-fixture.html?container=820&insufficient=1');
  const suggestion = page.locator('[data-fixture-card="followed"] .kol-card-suggestion');
  await expect(suggestion).toBeVisible();
  await expect(page.locator('[data-fixture-card="followed"] [data-recommended-action]')).toHaveAttribute('data-recommended-action', 'insufficient');
  await expect(suggestion.locator('.kol-card-icon')).toHaveCSS('font-size', '14px');
  await expect(suggestion.locator('.kol-card-suggestion-title')).toHaveCSS('font-size', '13px');
  await expect(suggestion.locator('.kol-card-why')).toHaveCSS('font-size', '12px');
  for (const icon of await page.locator('[data-fixture-card] .kol-card-icon').all()) await expect(icon).toHaveCSS('font-size', '14px');
});
