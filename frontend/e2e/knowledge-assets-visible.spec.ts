import { expect, test, type Page } from '@playwright/test';
import { assertFullRowLayout } from './fixtures/knowledge-fullrow-layout';

async function fixture(page: Page) {
  const account = { id: 'asset-visible-admin', name: '管理员', available_modes: ['admin', 'employee'] };
  const families = [
    { id: 'empty-family', level: 'family', name: '1234' },
    { id: 'product', level: 'family', name: '产品与解决方案' },
    { id: 'growth', level: 'family', name: '品牌与用户增长中心' },
  ];
  const domains = [...families, { id: 'battery-domain', level: 'domain', name: '产品管理', parent_id: 'product' },
    { id: 'promotion', level: 'domain', name: '推广', parent_id: 'growth' }, { id: 'empty-domain', level: 'domain', name: '4567', parent_id: 'empty-family' }];
  const bases = [{ id: 'battery', name: '电池', family_id: 'product', domain_id: 'battery-domain', kind: 'unstructured' },
    { id: 'kol', name: 'KOL合作', family_id: 'growth', domain_id: 'promotion', kind: 'structured' },
    { id: 'empty-base', name: '9999', family_id: 'empty-family', domain_id: 'empty-domain', kind: 'structured' }];
  const longTitle = 'media-generation-tk-3-0-2f62595e-7dd3-4b9b-a013-715f5af3569e-采访资料-来源版本A';
  const rows = Array.from({ length: 13 }, (_, i) => ({
    id: `row-${i}`, title: i < 2 ? longTitle : i < 8 ? `NETC 储能型产品规格书 ${i}` : `合作知识 ${i}`,
    asset_type: i < 8 ? 'document' : 'entry', kind: i < 8 ? 'document' : 'pattern', body: '',
    status: i < 2 ? 'draft' : i < 8 ? 'pending_review' : 'published',
    family_id: i < 8 ? 'product' : 'growth', domain_id: i < 8 ? 'battery-domain' : 'promotion',
    base_id: i < 8 ? 'battery' : 'kol', current_version: 1, updated_at: '2026-10-09T01:00:00Z', stage_codes: [], brand: '*',
  }));
  const requests: string[] = [], writes: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/api/auth/status') return route.fulfill({ json: { authenticated: true, account } });
    if (path === '/api/me') return route.fulfill({ json: account });
    if (path === '/api/preferences') return route.fulfill({ json: { theme: 'light' } });
    if (path === '/api/cron/jobs') return route.fulfill({ json: { jobs: [] } });
    if (path === '/api/admin/knowledge/workspace-v1') {
      requests.push(url.search);
      const p = url.searchParams;
      const filtered = rows.filter(r => (!p.get('kind') || r.kind === p.get('kind')) && (!p.get('family_id') || r.family_id === p.get('family_id'))
        && (!p.get('base_id') || r.base_id === p.get('base_id')) && (!p.get('view') || p.get('view') === 'all' || r.status === ({ pending: 'pending_review', draft: 'draft', published: 'published', disabled: 'archived' } as Record<string, string>)[p.get('view')!])
        && (!p.get('q') || r.title.includes(p.get('q')!)));
      const all = rows.length;
      return route.fulfill({ json: { tenant: 'company', bases, domains, rows: filtered, total: filtered.length, page: 1, page_size: 20, page_count: 1,
        facets: { view: { all, values: { draft: 2, pending_review: 6, published: 5 } }, kind: { all, values: { document: 8, pattern: 5 } },
          family: { all, values: { product: 8, growth: 5 } }, domain: { all, values: { 'battery-domain': 8, promotion: 5 } }, base: { all, values: { battery: 8, kol: 5 } },
          brand: { all, values: {}, unbranded: all }, stage: { all, values: {}, empty: all } },
        stats: { status: { draft: 2, pending_review: 6, published: 5, archived: 0 }, pending_review: { count: 1, max_wait_days: 12 },
          pending_documents: { count: 5, max_wait_days: 5 }, expiring: { count: 0, nearest: null } } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin/knowledge?stage=published&reviewCompany=company');
  await expect(page.locator('[data-kbv-record]')).toHaveCount(13);
  await expect(page.locator('[data-knowledge-assets]')).toBeVisible();
  return { requests, writes, errors, longTitle };
}

test('both screenshot regions hide zero taxonomy by default and keep an explicit reversible entry', async ({ page }) => {
  const s = await fixture(page);
  const middle = page.locator('[data-knowledge-middle]'), right = page.locator('[data-knowledge-assets]');
  await expect(middle.locator('[data-kb-scope-family="empty-family"]')).toHaveCount(0);
  await expect(right.locator('[data-kb-dist="family:empty-family"]')).toHaveCount(0);
  await middle.locator('[data-kbv-empty-taxonomy]').click();
  await expect(middle.locator('[data-kb-scope-family="empty-family"]')).toBeVisible();
  await middle.locator('[data-kb-scope-family="empty-family"]').click();
  await expect(page.locator('[data-kbv-empty]')).toBeVisible();
  await middle.locator('[data-kbv-empty-taxonomy]').click();
  await expect(middle.locator('[data-kb-scope-family="empty-family"]')).toHaveAttribute('aria-pressed', 'true');
  await middle.locator('[data-kbv-filter-reset]').click();
  await expect(page.locator('[data-kbv-record]')).toHaveCount(13);
  expect(s.writes).toEqual([]); expect(s.errors).toEqual([]);
});

test('document type filtering preserves global summary and clearing restores all entries', async ({ page }) => {
  const s = await fixture(page);
  await expect(page.locator('[data-kbv-count-scope]')).toContainText('随其他筛选条件变化');
  await expect(page.locator('[data-kbv-asset-strip]')).toContainText('全局主状态');
  await page.locator('[data-kb-kind="document"]').click();
  await expect(page.locator('[data-kbv-count]')).toHaveText('8 条知识');
  await expect(page.locator('[data-kbv-record]')).toHaveCount(8);
  await expect(page.locator('[data-knowledge-assets]')).toContainText('全局共 13 条');
  await expect(page.locator('[data-kb-status="pending"] .kbv-asset-seg-num')).toHaveText('6');
  await page.locator('[data-kbv-filter-reset]').click();
  await expect(page.locator('[data-kbv-record]')).toHaveCount(13);
  expect(s.requests.some(search => new URLSearchParams(search).get('kind') === 'document')).toBe(true);
  expect(s.writes).toEqual([]); expect(s.errors).toEqual([]);
});

test('compact long-name rows keep the full name and differentiating tail with no invented PDF label', async ({ page }) => {
  const s = await fixture(page);
  await expect(page.locator('[data-kbv-list-columns]')).toContainText('知识名称');
  const row = page.locator('[data-kbv-record="row-0"]');
  await expect(row.locator('.knowledge-row-title')).toHaveText(s.longTitle);
  await expect(row.locator('.knowledge-row-title')).toHaveAttribute('title', s.longTitle);
  await expect(row.locator('.knowledge-title-tail')).toContainText('来源版本A');
  await expect(row.locator('.knowledge-row-kind')).toHaveText('文档资料');
  const wrap = page.locator('[data-kbv-record-wrap="row-0"]');
  expect((await wrap.boundingBox())!.height).toBe(36);
  await expect(page.locator('[data-kbv-record="row-1"]')).toHaveCount(1);
  for (const width of [1920, 1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(row.locator('.knowledge-title-tail')).toBeVisible();
    const fits = await row.locator('.knowledge-title-tail').evaluate(node => {
      const box = node.getBoundingClientRect(), parent = node.parentElement!.getBoundingClientRect();
      return box.x >= parent.x && box.right <= parent.right + 1 && node.scrollWidth <= node.clientWidth + 1;
    });
    expect(fits, `${width}px filename tail is fully readable`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/knowledge-assets-visible-1440.png', fullPage: true });
  expect(s.errors).toEqual([]);
});

test('right-hand distribution keeps same-level count denominators and direct scope drilldown', async ({ page }) => {
  const s = await fixture(page), right = page.locator('[data-knowledge-assets]');
  const product = right.locator('[data-kb-dist="family:product"]');
  await expect(product).toContainText('8');
  await expect(product.locator('.ksr-ratio')).toHaveText('61.5%');
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await product.evaluate(node => [...node.children].map(child => {
      const box = child.getBoundingClientRect(); return { middle: box.y + box.height / 2, x: box.x, right: box.right };
    }));
    expect(Math.max(...boxes.map(box => box.middle)) - Math.min(...boxes.map(box => box.middle)), `${width}px distribution is a single row`).toBeLessThan(2);
    expect((await product.boundingBox())!.height).toBe(32);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/knowledge-assets-visible-final-1440.png', fullPage: true });
  await product.click();
  await expect(page.locator('[data-kbv-record]')).toHaveCount(8);
  await expect(page.locator('[data-kb-scope-family="product"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(right).toContainText('全局共 13 条');
  expect(s.writes).toEqual([]); expect(s.errors).toEqual([]);
});

test('admin shared filters show real counts, aligned 13px rows and a compact global lifecycle strip', async ({ page }) => {
  const s = await fixture(page), filters = page.locator('.knowledge-filter-bar');
  await expect(page.locator('.kbv-filter-status-label')).toHaveText('生命周期');
  await expect(page.locator('[data-kbv-view="all"]')).toHaveText('全部13');
  await expect(filters.locator('[data-kb-filter="brand"] [data-kb-filter-value=""] small')).toHaveText('13');
  await expect(filters.locator('[data-kb-filter="stage"] [data-kb-filter-value="INITIAL_CONTACT"] small')).toHaveText('13');
  const fonts = await filters.locator('.kbv-scope-name, .knowledge-filter-label, .knowledge-filter-count').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize));
  expect(fonts.every(font => font === '13px')).toBe(true);
  expect((await filters.locator('.workspace-search-input').boundingBox())!.height).toBe(32);
  expect((await assertFullRowLayout(filters)).continuationLines).toBeGreaterThan(0);
  await expect(page.locator('[data-kb-status="archived"]')).toContainText('已下架');
  const strip = page.locator('.kbv-asset-strip-segments');
  expect((await strip.boundingBox())!.height).toBeLessThan(100);
  await page.locator('[data-kbv-view="pending"]').click();
  await expect(page.locator('[data-kbv-record]')).toHaveCount(6);
  await expect(page.locator('[data-kbv-filter-note-clear]')).toHaveText('清除此条件');
  await expect(page.locator('[data-kb-status="published"] .kbv-asset-seg-num')).toHaveText('5');
  await page.locator('[data-kbv-filter-note-clear]').click();
  await expect(page.locator('[data-kbv-record]')).toHaveCount(13);
  await page.screenshot({ path: 'test-results/knowledge-filter-admin-final-1440.png', fullPage: true });
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await assertFullRowLayout(filters)).continuationLines).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(s.writes).toEqual([]); expect(s.errors).toEqual([]);
});
