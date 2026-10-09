import { expect, test, type Page } from "@playwright/test";

const connector = { id: "claw", label: "MediaCrawler MCP", purpose: "创作者采集、检索与画像数据", kind: "app", protocol: "mcp", status: "configured", enabled: 0 };
const initialConfig = { protocol: "mcp", transport: "streamable-http", url: "https://mcp.example.test/mcp", timeout_ms: 30000, allow_unauthenticated: false, headers_secret_refs: { "X-API-Key": "cred_existing_test" } };

// Explicit network fixtures keep writes and MCP probes isolated from production.
async function fixture(page: Page, purpose = connector.purpose) {
  await page.route("**/api/admin/connectors", route => route.fulfill({ json: [{ ...connector, purpose }] }));
  await page.route("**/api/admin/runtime/connectors/claw/config", route => route.fulfill({ json: { config: initialConfig, version: 4 } }));
  await page.route("**/api/admin/runtime/connectors/claw/activity*", route => route.fulfill({ json: { probes: [], events: [] } }));
}
async function openConfig(page: Page) {
  await page.goto("/admin/connectors");
  await page.locator('[data-admin-connectors-table] [data-connector="claw"] [data-connector-config-entry]').click();
  const modal = page.locator('[data-connector-panel="connector-config"]');
  await expect(modal.locator('[data-connector-field="label"]')).toHaveValue(connector.label);
  await expect(modal.locator('.connector-panel-foot [data-connector-panel-save]')).toBeVisible();
  return modal;
}

for (const [width, height] of [[1440, 900], [1280, 720], [1280, 520]]) {
  test(`configuration has aligned 32px fields, inline icon and fixed two-line save footer at ${width}x${height}`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height });
    const modal = await openConfig(page);
    await expect(modal.locator('[data-connector-panel-save]')).toHaveCount(1);
    await expect(modal.locator('.connector-card-actions')).toHaveCount(0);
    await expect(modal.locator('[data-connector-config-save-note] > span')).toHaveCount(2);
    const form = modal.locator('[data-connector-config-card]');
    await expect(form.locator('[data-connector-field="purpose"]')).toHaveAttribute('rows', '2');
    await expect(form.locator('[data-connector-field="purpose"]')).toHaveValue(connector.purpose);
    await expect(form.locator('[data-connector-field="purpose"]')).toHaveAttribute('placeholder', '备注（可选）');
    const spec = await modal.evaluate(root => {
      const rect = (selector: string) => {
        const r = root.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, h: r.height, w: r.width, center: r.y + r.height / 2 };
      };
      return { name: rect('[data-connector-field="label"]'), nameLabel: rect('.connector-form-grid .connector-config-label'), transport: rect('[data-connector-field="transport"]'), icon: rect('[data-connector-icon-preview]'), upload: rect('[data-connector-split-main="icon"]'), hint: rect('[data-connector-icon-hint]'), purpose: rect('[data-connector-field="purpose"]'), footer: rect('.connector-panel-foot'), note: rect('[data-connector-config-save-note]'), overflow: root.querySelector('.connector-panel')!.scrollWidth - root.querySelector('.connector-panel')!.clientWidth };
    });
    expect(spec.name.h).toBe(32);
    expect(spec.transport.h).toBe(32);
    expect(spec.name.x).toBe(spec.transport.x);
    expect(Math.abs(spec.name.center - spec.nameLabel.center)).toBeLessThanOrEqual(1);
    expect(spec.icon.w).toBe(32);
    expect(spec.icon.h).toBe(32);
    expect(spec.icon.x).toBe(spec.name.x);
    expect(Math.abs(spec.icon.center - spec.upload.center)).toBeLessThanOrEqual(1);
    expect(Math.abs(spec.icon.center - spec.hint.center)).toBeLessThanOrEqual(1);
    expect(spec.purpose.h).toBeLessThanOrEqual(60);
    expect(spec.note.h).toBe(40);
    expect(spec.overflow).toBeLessThanOrEqual(1);
    const body = modal.locator('.connector-panel-body');
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(modal.locator('[data-connector-panel-save]')).toBeInViewport();
    const footerAfter = await modal.locator('.connector-panel-foot').boundingBox();
    expect(footerAfter?.y).toBe(spec.footer.y);
    await body.evaluate(el => { el.scrollTop = 0; });
    await modal.locator('.connector-panel').screenshot({ path: test.info().outputPath(`config-${width}x${height}.png`) });
  });
}

test('configuration keeps empty notes as placeholder, validates icon upload and restores keyboard focus', async ({ page }) => {
  await fixture(page, '');
  const modal = await openConfig(page);
  const note = modal.locator('[data-connector-field="purpose"]');
  await expect(note).toHaveValue('');
  await expect(note).toHaveAccessibleName('备注（可选）');
  await modal.locator('[data-connector-icon-input]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(modal.locator('.connector-icon-field .error')).toContainText('仅支持 PNG 或 JPG');
  await modal.locator('[data-connector-icon-input]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(modal.locator('.connector-icon-field .error')).toContainText('不能超过 1 MB');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ0sAAAAASUVORK5CYII=', 'base64');
  await modal.locator('[data-connector-icon-input]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await expect(modal.locator('[data-connector-icon-preview] img')).toBeVisible();
  await modal.locator('[data-connector-split-toggle="icon"]').click();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await modal.locator('[data-connector-split-toggle="icon"]').click();
  await modal.getByRole('menuitem', { name: '移除' }).click();
  await expect(modal.locator('[data-connector-icon-preview] img')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page.locator('[data-connector="claw"] [data-connector-config-entry]')).toBeFocused();
});

test('configuration uses one original save handler, preserves reference-only secrets and moves to test', async ({ page }) => {
  await fixture(page);
  let config = { ...initialConfig };
  let version = 4;
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/admin/runtime/connectors/claw/config', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { config, version } });
    writes.push(route.request().postDataJSON());
    await new Promise(resolve => setTimeout(resolve, 200));
    config = { ...config, ...route.request().postDataJSON() };
    version += 1;
    await route.fulfill({ json: { ok: true, version } });
  });
  const modal = await openConfig(page);
  await modal.locator('[data-connector-field="transport"]').selectOption('sse');
  const save = modal.locator('[data-connector-panel-save]');
  await save.click();
  await expect(save).toBeDisabled();
  await expect(modal.locator('[data-connector-wizard-step="test"]')).toBeVisible();
  await expect(modal.locator('[data-connector-wizard-receipt]')).toContainText('配置已更新（版本 5）');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ expected_version: 4, transport: 'sse', headers_secret_refs: { 'X-API-Key': 'cred_existing_test' } });
  expect(JSON.stringify(writes[0])).not.toContain('备注（可选）');
  await modal.locator('[data-connector-wizard-tab="save"]').click();
  await expect(modal.locator('[data-connector-field="transport"]')).toHaveValue('sse');
  await expect(modal.locator('input.connector-header-value')).toHaveValue('');
  await expect(modal.locator('input.connector-header-value')).toHaveAttribute('placeholder', /不回显/);
  await expect(modal.locator('[data-connector-panel-save]')).toHaveCount(1);
});

test('configuration keeps validation and failed saves in place with the footer visible', async ({ page }) => {
  await fixture(page);
  let writes = 0;
  await page.route('**/api/admin/runtime/connectors/claw/config', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { config: initialConfig, version: 4 } });
    writes += 1;
    return route.fulfill({ status: 503, json: { detail: '服务暂不可用' } });
  });
  const modal = await openConfig(page);
  await modal.locator('[data-connector-field="url"]').fill('invalid');
  await modal.locator('[data-connector-panel-save]').click();
  await expect(modal.locator('[data-connector-config-error]')).toContainText('http:// 或 https://');
  expect(writes).toBe(0);
  await modal.locator('[data-connector-field="url"]').fill(initialConfig.url);
  await modal.locator('[data-connector-panel-save]').click();
  await expect(modal.locator('[data-connector-config-error]')).toBeVisible();
  await expect(modal.locator('[data-connector-wizard-step="save"]')).toBeVisible();
  await expect(modal.locator('[data-connector-panel-save]')).toBeEnabled();
  await expect(modal.locator('[data-connector-panel-save]')).toBeInViewport();
  expect(writes).toBe(1);
});

test('configuration on a narrow screen keeps all controls within the dialog', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 375, height: 844 });
  const modal = await openConfig(page);
  expect(await modal.locator('.connector-panel').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(modal.locator('[data-connector-panel-save]')).toBeInViewport();
  await modal.locator('.connector-panel-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(modal.locator('[data-connector-panel-save]')).toBeInViewport();
  await modal.locator('.connector-panel-body').evaluate(el => { el.scrollTop = 0; });
  await modal.locator('.connector-panel').screenshot({ path: test.info().outputPath('config-375.png') });
});

test('standalone detail preserves the existing note and save layout', async ({ page }) => {
  await fixture(page);
  await page.goto('/admin/connectors/claw');
  const card = page.locator('[data-connector-config-card]');
  await expect(card.locator('[data-connector-field="label"]')).toBeVisible();
  await expect(card).not.toHaveClass(/connector-config-compact/);
  await expect(card.locator('[data-connector-field="purpose"]')).toHaveAttribute('rows', '5');
  await expect(card.locator('.connector-card-actions [data-connector-panel-save]')).toBeVisible();
  await expect(card.locator('.connector-icon-field')).not.toHaveClass(/is-compact/);
});
