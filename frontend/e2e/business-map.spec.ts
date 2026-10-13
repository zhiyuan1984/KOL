import { expect, test, type Page } from '@playwright/test';

/** 业务地图（/leads + /cooperations 两 tab）抽查：
 *  横向滚动、深链 stage 参数、双路由高亮、激活 tab 重复点击、键盘 ←→ 焦点回归。
 *  只读夹具：任何非 GET 一律 409，证明本页抽查不触发业务写入。 */

const lead = {
  id: 'lead-bm', display_name: '业务地图抽查线索', platform: 'YouTube', lead_stage: 'contacting',
  lead_source: 'manual', data_version: 1, brand: 'LT', region: '全球英', follower_count: 12000,
  updated_at: '2026-10-13T01:00:00Z', created_at: '2026-10-12T01:00:00Z', is_archived: false,
};
const coop = {
  id: 'coop-bm', title: '业务地图抽查合作', coop_stage: 'INITIAL_CONTACT', coop_type: 'paid',
  currency: 'USD', brand: 'LT', lead_display_name: '业务地图抽查线索', lead_platform: 'YouTube',
  updated_at: '2026-10-13T01:00:00Z', data_version: 1,
};

async function fixture(page: Page) {
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const account = { id: 'bm-tester', name: '业务地图抽查', roles: ['admin'], available_modes: ['employee', 'admin'] };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') { writes.push(path); return route.fulfill({ status: 409, json: { error: 'test_read_only' } }); }
    let json: unknown = [];
    if (path === '/api/auth/status') json = { authenticated: true, account, user: account };
    else if (path === '/api/me') json = account;
    else if (path === '/api/preferences') json = { theme: 'light' };
    else if (path === '/api/kol/leads') json = { leads: [lead], total: 1 };
    else if (path === '/api/kol/leads/automation-status') json = { enabled: false };
    else if (path === '/api/kol/leads/lead-bm') json = { lead, work_orders: [], cooperations: [], allowed_actions: [] };
    else if (path === '/api/kol/cooperations') json = { cooperations: [coop], total: 1 };
    else if (path === '/api/kol/cooperations/coop-bm') json = { cooperation: coop, lead, work_orders: [], events: [], allowed_actions: [] };
    else if (path.endsWith('/events')) json = { events: [] };
    await route.fulfill({ json });
  });
  return { writes, errors };
}

for (const width of [360, 420, 820, 1024, 1100, 1440]) {
  test(`业务地图两 tab 在 ${width}px 宽无横向滚动`, async ({ page }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    for (const [url, marker] of [['/leads', 'leads'], ['/cooperations', 'cooperations']] as const) {
      await page.goto(url);
      await expect(page.locator(`[data-kol-business-map="${marker}"]`)).toBeVisible();
      const heading = marker === 'leads' ? '线索管理' : '合作项目';
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} @ ${width}px 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
      if ([1440, 820, 360].includes(width)) await page.screenshot({ path: `test-results/business-map/${marker}-${width}.png`, fullPage: true });
    }
    expect(state.errors).toEqual([]);
    expect(state.writes).toEqual([]);
  });
}

test('业务地图深链 stage 参数直达并保持选中', async ({ page }) => {
  await fixture(page);
  await page.goto('/leads?stage=contacting');
  await expect(page.locator('.kol-chip-row[aria-label="阶段筛选"] .kol-chip', { hasText: '建联中' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/cooperations?stage=INITIAL_CONTACT');
  await expect(page.locator('.kol-chip[title="初步接触"]')).toHaveAttribute('aria-pressed', 'true');
});

test('激活 tab 重复点击不丢深链参数', async ({ page }) => {
  await fixture(page);
  await page.goto('/leads?stage=contacting');
  await expect(page.locator("[data-section-tab='leads']")).toHaveAttribute('aria-selected', 'true');
  await page.locator("[data-section-tab='leads']").click();
  await expect(page).toHaveURL(/\/leads\?stage=contacting$/);
});

test('键盘 ←→ 切换 tab 后焦点与选中态保持一致', async ({ page }) => {
  await fixture(page);
  await page.goto('/leads');
  const leadsTab = page.locator("[data-section-tab='leads']");
  const coopTab = page.locator("[data-section-tab='cooperations']");
  await leadsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/\/cooperations$/);
  await expect(coopTab).toHaveAttribute('aria-selected', 'true');
  await expect(coopTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/\/leads$/);
  await expect(leadsTab).toBeFocused();
});

test('业务地图条目在两个地址下均高亮', async ({ page }) => {
  await fixture(page);
  await page.goto('/leads');
  await expect(page.locator("[data-nav='business-map']")).toHaveClass(/active/);
  await page.goto('/cooperations');
  await expect(page.locator("[data-nav='business-map']")).toHaveClass(/active/);
});
