import { expect, test, type Page } from '@playwright/test';
// HTTP fixtures validate presentation only; real PostgreSQL creation is tested separately.
async function surface(page: Page) {
  const stamp = '2026-10-09T01:00:00.000Z';
  const domains = [
    { id: 'product', code: 'product', name: '产品与解决方案', level: 'family', parent_id: null, status: 'active', updated_at: stamp },
    { id: 'growth', code: 'growth', name: '品牌与用户增长中心', level: 'family', parent_id: null, status: 'active', updated_at: stamp },
    { id: 'empty', code: 'empty', name: '未分类', level: 'family', parent_id: null, status: 'active', updated_at: stamp },
    { id: 'battery', code: 'battery', name: '产品管理', level: 'domain', parent_id: 'product', status: 'active', updated_at: stamp },
    { id: 'content', code: 'content', name: '内容增长', level: 'domain', parent_id: 'growth', status: 'active', updated_at: stamp },
  ];
  const bases = [{ id: 'base', code: 'lifepo4', name: '电池产品资料', domain_id: 'battery', kind: 'structured', status: 'active', version: 1, updated_at: stamp, description: '' }];
  const writes: Array<{ path: string; body: any }> = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const account = { id: 'admin', name: '管理员', roles: ['admin'], available_modes: ['admin', 'employee'] };
    let json: unknown = [];
    if (path === '/api/auth/status') json = { authenticated: true, account };
    else if (path === '/api/me') json = account;
    else if (path === '/api/health') json = { ok: true };
    else if (path === '/api/preferences') json = { theme: 'light' };
    else if (path === '/api/cron/jobs') json = { jobs: [] };
    else if (path === '/api/admin/knowledge/workspace-v1') json = { rows: [], domains, bases, total: 0, page: 1, page_count: 1, facets: {}, stats: { status: {}, pending_review: {}, pending_documents: {}, expiring: {} } };
    else if (path === '/api/admin/knowledge/domains') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push({ path, body });
        const domain = { ...domains[0], ...body, id: `created-${writes.length}`, code: `family_generated_${writes.length}` };
        domains.push(domain); json = { domain };
      } else json = { domains };
    } else if (path === '/api/admin/knowledge/bases') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); writes.push({ path, body });
        const base = { ...bases[0], ...body, id: `created-base-${writes.length}`, code: `base_generated_${writes.length}` };
        bases.push(base); json = { base };
      } else json = { bases };
    }
    await route.fulfill({ json });
  });
  await page.goto('/admin/knowledge?stage=catalog');
  await expect(page.locator('[data-admin-kb-catalog]')).toBeVisible();
  await expect(page.locator('[data-admin-kb-base="base"]')).toBeVisible();
  return { writes, errors };
}
const family = (page: Page) => page.locator('[data-admin-kb-family="product"]');
const toggle = (page: Page) => family(page).locator('xpath=ancestor::*[contains(@class,"ant-collapse-header")]').locator('.ant-collapse-expand-icon');

test('planning uses mature multi-branch collapse with independent selection and search', async ({ page }) => {
  const state = await surface(page);
  const catalog = page.locator('[data-admin-kb-catalog]');
  await expect(catalog.getByRole('heading', { name: '知识规划', exact: true })).toHaveCount(0);
  await expect(catalog).not.toContainText('分类只做业务归类');
  await expect(catalog.getByRole('button', { name: '展开全部', exact: true })).toHaveCount(0);
  await expect(catalog.getByRole('button', { name: '收起全部', exact: true })).toHaveCount(0);
  await family(page).click();
  await toggle(page).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-admin-kb-domain="battery"]')).toBeHidden();
  await expect(page.locator('[data-admin-kb-domain="content"]')).toBeVisible();
  await expect(page.locator('[data-admin-kb-selected="family:product"]')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-admin-kb-base="base"]')).toBeVisible();
  await page.locator('[data-admin-kb-catalog-search]').fill('LIFEPO4');
  await expect(family(page)).toBeVisible();
  await expect(page.locator('[data-admin-kb-domain="battery"]')).toBeVisible();
  await expect(page.locator('[data-admin-kb-family="growth"]')).toHaveCount(0);
  await page.locator('[data-admin-kb-catalog-search]').fill('不存在');
  await expect(catalog).toContainText('没有匹配的节点');
  await catalog.getByRole('button', { name: '清空搜索' }).click();
  await expect(page.locator('[data-admin-kb-domain="content"]')).toBeVisible();
  await expect(catalog.locator('.kbplanning-footer [data-admin-kb-create-family]')).toBeVisible();
  const gap = await catalog.locator('.kbplanning-search').evaluate(node => {
    const icon = node.querySelector('.anticon')!.getBoundingClientRect(), input = node.querySelector('input')!.getBoundingClientRect();
    return input.left - icon.right;
  });
  expect(gap).toBeGreaterThanOrEqual(8); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
  await page.screenshot({ path: 'test-results/planning-desktop.png', fullPage: true });
});

test('all three dialogs share compact controls, readonly codes and cancellation without writes', async ({ page }) => {
  const state = await surface(page), heights: number[] = [];
  for (const level of ['family', 'domain', 'base']) {
    if (level === 'domain') await family(page).click();
    if (level === 'base') await page.locator('[data-admin-kb-domain="battery"]').click();
    await page.locator(`[data-admin-kb-create-${level}]`).click();
    const dialog = page.getByRole('dialog'), form = dialog.locator(`[data-admin-kb-${level}-form]`);
    await expect(form.locator('[name="name"]')).toBeFocused();
    await expect(form.locator('[name="code"]')).toHaveAttribute('readonly', '');
    await expect(form.locator('[name="code"]')).not.toHaveAttribute('required');
    await expect(form.locator('[name="code"]')).toHaveAttribute('placeholder', '保存时自动生成');
    heights.push((await form.locator('[name="name"]').boundingBox())!.height);
    expect((await form.locator('textarea').boundingBox())!.height).toBe(64);
    expect((await dialog.locator(`[data-admin-kb-${level}-submit]`).boundingBox())!.height).toBe(24);
    if (level === 'domain') await expect(form.locator('select[name="parent_id"]')).toHaveValue('product');
    if (level === 'base') await expect(form.locator('select[name="domain_id"]')).toHaveValue('battery');
    await page.screenshot({ path: `test-results/planning-create-${level}.png`, fullPage: true });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  }
  expect(heights).toEqual([32, 32, 32]); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test('creation omits code, refreshes final code and success toast disappears', async ({ page }) => {
  const state = await surface(page);
  await page.locator('[data-admin-kb-create-family]').click();
  await page.locator('[data-admin-kb-family-form] [name="name"]').fill('新业务族');
  await page.locator('[data-admin-kb-family-submit]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-admin-kb-selected="family:created-1"]')).toContainText('family_generated_1');
  await expect(page.locator('[data-admin-receipt]')).toContainText('业务族已创建');
  await expect(page.locator('.kbplanning-receipt')).toHaveCount(0);
  await expect(page.locator('[data-admin-receipt]')).toHaveCount(0, { timeout: 5000 });
  expect(state.writes).toHaveLength(1); expect(state.writes[0].body).not.toHaveProperty('code'); expect(state.errors).toEqual([]);
});

test('planning and dialogs remain usable across compact viewports', async ({ page }) => {
  const state = await surface(page);
  for (const width of [1440, 1024, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('[data-admin-kb-catalog-search]')).toBeVisible();
    await expect(page.locator('[data-admin-kb-create-family]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/planning-${width}.png`, fullPage: true });
    await page.locator('[data-admin-kb-create-family]').click();
    const box = (await page.getByRole('dialog').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect(page.locator('[data-admin-kb-family-submit]')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});
