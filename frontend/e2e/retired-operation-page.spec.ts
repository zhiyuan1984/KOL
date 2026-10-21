import { expect, test } from '@playwright/test';

test('retired operation catalog returns to connectors without loading or modifying capabilities', async ({ page }) => {
  const writes: string[] = [], capabilityReads: string[] = [], errors: string[] = [];
  const account = { id: 'admin-test', name: '管理员', roles: ['admin'], available_modes: ['employee', 'admin'] };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    if (path.includes('capability-operations')) capabilityReads.push(path);
    let json: unknown = [];
    if (path === '/api/health') json = { ok: true };
    else if (path === '/api/auth/status') json = { authenticated: true, account };
    else if (path === '/api/me') json = account;
    else if (path === '/api/preferences' || path.includes('data-policy')) json = {};
    await route.fulfill({ json });
  });
  await page.goto('/admin/connectors/-/operations');
  await expect(page).toHaveURL(/\/admin\/connectors$/);
  await expect(page.locator('[data-connector-hub-title]')).toHaveText('已添加的连接器');
  await expect(page.getByRole('link', { name: '可执行能力' })).toHaveCount(0);
  await expect(page.locator('[data-operation-governance]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-connector-hub-title]')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/connectors$/);
  expect(capabilityReads).toEqual([]);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '../.tmp/remove-executable-capability/connectors.png', fullPage: true });
});