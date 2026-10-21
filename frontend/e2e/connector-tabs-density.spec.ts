import { test, expect } from "./fixtures/connector-density-fixture";

for (const [width, height] of [[375, 844], [768, 900], [1280, 720], [1920, 900], [1280, 520]]) {
  test(`four tabs respect 13/20/28 and visible spacing at ${width}x${height}`, async ({ page, apiCalls }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/connectors/claw?tab=config");
    const root = page.locator('[data-admin-page="connector-detail"]');
    const card = root.locator('[data-connector-config-card]');
    await expect(card.locator('[data-connector-field="label"]')).toBeVisible();
    const layout = await card.evaluate(el => {
      const rect = (selector: string) => {
        const node = el.querySelector<HTMLElement>(selector)!;
        const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return { x: box.x, y: box.y, h: box.height, w: box.width, bottom: box.bottom, font: style.fontSize, line: style.lineHeight };
      };
      const fields = [...el.querySelectorAll<HTMLElement>('.connector-config-inline')];
      const sections = [...el.querySelectorAll<HTMLElement>('.connector-config-section')];
      const gaps = sections.slice(1).map((node, index) => node.getBoundingClientRect().top - sections[index].getBoundingClientRect().bottom);
      return { width: el.clientWidth, name: rect('[data-connector-field="label"]'), nameLabel: rect('.connector-field-name > span'), transport: rect('[data-connector-field="transport"]'), timeout: rect('[data-connector-field="timeout"]'), purpose: rect('[data-connector-field="purpose"]'), url: rect('[data-connector-field="url"]'), icon: rect('[data-connector-icon-preview]'), save: rect('[data-connector-panel-save]'), inline: getComputedStyle(fields[0]).gridTemplateColumns.split(' ').length === 2, gaps, overflow: el.scrollWidth - el.clientWidth };
    });
    for (const control of [layout.name, layout.transport, layout.timeout, layout.url, layout.save]) {
      expect(control.h).toBe(28); expect(control.font).toBe('13px');
      // Chromium reports native select line-height as normal even with 20px CSS.
      // Keep the 28px outer box and 13px font checks; body text is tested below.
      expect(control.line).toBe(control === layout.transport ? 'normal' : '20px');
    }
    expect(layout.transport.w).toBeLessThanOrEqual(112); expect(layout.timeout.w).toBeLessThanOrEqual(112);
    expect(layout.name.w).toBeLessThanOrEqual(360); expect(layout.purpose.h).toBe(50);
    expect(layout.gaps).toEqual([12, 12]); expect(layout.overflow).toBeLessThanOrEqual(1);
    if (layout.inline) {
      expect(layout.nameLabel.w).toBe(96);
      expect(layout.name.x - (layout.nameLabel.x + layout.nameLabel.w)).toBe(8);
      expect(layout.transport.y - layout.name.bottom).toBe(8);
      for (const control of [layout.transport, layout.url, layout.purpose, layout.icon, layout.timeout, layout.save]) expect(control.x).toBe(layout.name.x);
    } else {
      expect(layout.name.x).toBe(layout.nameLabel.x);
      expect(layout.save.x).toBe(layout.name.x);
    }
    await card.locator('[data-connector-panel-save]').scrollIntoViewIfNeeded();
    await expect(card.locator('[data-connector-panel-save]')).toBeInViewport();
    const measurements: unknown[] = [{ tab: 'config', layout }];
    for (const tab of ['tools', 'credentials', 'audit']) {
      await root.locator(`[data-connector-detail-tab="${tab}"]`).click();
      const panel = root.locator(`[data-connector-detail-panel="${tab}"]`);
      await expect(panel).toBeVisible();
      if (tab === 'tools') {
        await expect(panel.locator('[data-connector-tool]')).toHaveCount(3);
        await expect(panel.locator('.connector-tool-platform-state.status-ok')).toHaveCount(2);
        await expect(panel.getByText('平台未启用 · 调用默认拒绝', { exact: true })).toBeVisible();
        for (const state of await panel.locator('.connector-tool-platform-state').all()) await expect(state).toBeVisible();
      }
      if (tab === 'credentials') await expect(panel.locator('[data-connector-credential-references] > li')).toHaveCount(2);
      if (tab === 'audit') await expect(panel.locator('.connector-audit-list > li')).toHaveCount(4);
      const metrics = await root.evaluate(el => ({
        bodyOverflow: document.body.scrollWidth - innerWidth,
        rootOverflow: el.scrollWidth - el.clientWidth,
        tabs: [...el.querySelectorAll('[role="tab"]')].map(node => ({ height: node.getBoundingClientRect().height, font: getComputedStyle(node).fontSize })),
        visibleText: [...el.querySelectorAll('p, h3, h4, time')].filter(node => node.getBoundingClientRect().width > 0).map(node => ({ font: getComputedStyle(node).fontSize, line: getComputedStyle(node).lineHeight })),
        controls: [...el.querySelectorAll('.connector-detail-panel:not([hidden]) .btn, .connector-detail-panel:not([hidden]) select, .connector-detail-panel:not([hidden]) .ant-input-affix-wrapper')].map(node => ({ class: node.className, text: node.textContent?.slice(0, 50), height: node.getBoundingClientRect().height, font: getComputedStyle(node).fontSize })),
      }));
      expect(metrics.bodyOverflow).toBeLessThanOrEqual(1); expect(metrics.rootOverflow).toBeLessThanOrEqual(1);
      for (const control of [...metrics.tabs, ...metrics.controls]) { expect(control.height, JSON.stringify(control)).toBe(28); expect(control.font).toBe('13px'); }
      for (const text of metrics.visibleText) { expect(text.font).toBe('13px'); expect(text.line).toBe('20px'); }
      measurements.push({ tab, metrics });
      await root.screenshot({ path: test.info().outputPath(`${tab}-${width}x${height}.png`) });
    }
    expect(apiCalls.every(call => call.startsWith('GET '))).toBe(true);
    await test.info().attach('visible-density-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
}

test('local filtering and navigation preserve drafts, do not rediscover, and restore Schema focus', async ({ page, apiCalls }) => {
  await page.goto('/admin/connectors/claw?tab=config&from=density');
  const root = page.locator('[data-admin-page="connector-detail"]');
  await root.locator('[data-connector-field="url"]').fill('https://changed.fixture.test/mcp');
  await root.locator('[data-connector-detail-tab="tools"]').click();
  await expect(root.locator('[data-connector-tool]')).toHaveCount(3);
  const discoveryBefore = apiCalls.filter(call => call.endsWith('/discovery')).length;
  await root.getByRole('textbox', { name: '搜索工具' }).fill('missing_fixture_tool');
  await expect(root.locator('[data-connector-tools-filter-empty]')).toBeVisible();
  await root.locator('[data-connector-tools-clear-filters]').click();
  await expect(root.locator('[data-connector-tool]')).toHaveCount(3);
  expect(apiCalls.filter(call => call.endsWith('/discovery'))).toHaveLength(discoveryBefore);
  const schemaButton = root.locator('[data-connector-tool="get_creators"] button');
  await schemaButton.click();
  await expect(page.locator('[data-connector-tools-schema-readonly]')).toContainText('inputSchema');
  await page.keyboard.press('Escape');
  await expect(schemaButton).toBeFocused().catch(async cause => {
    console.log('Schema focus diagnostic', await page.evaluate(() => ({
      active: document.activeElement?.outerHTML.slice(0, 300),
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      inert: [...document.querySelectorAll('[inert]')].map(node => node.className),
    })));
    throw cause;
  });
  await root.locator('[data-connector-detail-tab="audit"]').focus();
  await page.keyboard.press('Home');
  await expect(root.locator('[data-connector-detail-tab="config"]')).toBeFocused();
  await expect(root.locator('[data-connector-field="url"]')).toHaveValue('https://changed.fixture.test/mcp');
  await page.keyboard.press('Tab');
  await expect(root.locator('[data-connector-detail-panel="config"]')).toBeFocused();
  expect(apiCalls.every(call => call.startsWith('GET '))).toBe(true);
});
