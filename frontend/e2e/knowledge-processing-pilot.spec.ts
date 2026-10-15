import { expect, test } from '@playwright/test';
import { knowledgePilotSurface } from './fixtures/knowledge-pilot-surface';

// All HTTP calls in this suite are mocked; PG and real-original checks are separate.
test('handoff gap continues polling and terminal candidate becomes visible without reload', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'handoff');
  const state = page.getByRole('region', { name: '资料加工状态' });
  await expect(state).toContainText('等待范围提炼交接');
  await expect(page.getByText('尚未提炼', { exact: true })).toHaveCount(0);
  const before = fixture.reads;
  fixture.setState('running');
  await expect(state).toContainText('正在依据原文提炼知识范围', { timeout: 10000 });
  await expect(state).toContainText('2/4');
  fixture.setProgress(3);
  await expect(state).toContainText('3/4', { timeout: 10000 });
  fixture.setState('candidate');
  await expect(state).toContainText('范围待核对', { timeout: 10000 });
  await expect(page.getByRole('button', { name: '确认已核对原文范围', exact: true })).toBeEnabled();
  expect(fixture.reads).toBeGreaterThan(before);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('active job overrides queued handoff and no unstarted/published conflict is shown', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'running');
  const state = page.getByRole('region', { name: '资料加工状态' });
  await expect(state).toContainText('正在依据原文提炼知识范围');
  await expect(state).not.toContainText('等待范围提炼交接');
  await expect(page.getByText('尚未提炼', { exact: true })).toHaveCount(0);
  const confirm = page.getByRole('button', { name: '确认已核对原文范围', exact: true });
  if (await confirm.count()) await expect(confirm).toBeDisabled();
  else await expect(confirm).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test('uncertain is visible and never offers or submits a blind retry', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'uncertain');
  await expect(page.getByRole('region', { name: '资料加工状态' })).toContainText('范围提炼结果待核查');
  await expect(page.getByText('尚未提炼', { exact: true })).toHaveCount(0);
  const generate = page.getByRole('button', { name: '提炼知识范围', exact: true });
  if (await generate.count()) await expect(generate).toBeDisabled();
  await page.getByRole('region', { name: '资料加工状态' }).getByRole('button', { name: '重新读取', exact: true }).click();
  expect(fixture.writes).toEqual([]);
});

test('transient read failure recovers and permission failure stops automatic reading', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'running');
  const state = page.getByRole('region', { name: '资料加工状态' });
  await expect(state).toContainText('正在依据原文提炼');
  fixture.failReads(503);
  await expect(state).toContainText('暂时无法读取', { timeout: 10000 });
  fixture.failReads(0);
  await expect(state).toContainText('正在依据原文提炼', { timeout: 10000 });
  fixture.failReads(403);
  await expect(state).toContainText('停止自动刷新', { timeout: 10000 });
  const count = fixture.reads;
  await page.waitForTimeout(3000);
  expect(fixture.reads).toBe(count);
  expect(fixture.writes).toEqual([]);
});

test('same-name documents keep distinct identities and versions on direct open and refresh', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'running');
  await page.goto('/admin/knowledge?reviewCompany=company&stage=processing&assetId=pilot-two&assetType=document&mode=detail');
  await expect(page).toHaveURL(/assetId=pilot-two/);
  await expect(page.locator('.kbv-document-body')).toContainText('v2');
  await page.reload();
  await expect(page).toHaveURL(/assetId=pilot-two/);
  await expect(page.locator('.kbv-document-body')).toContainText('v2');
  const frame = page.locator('[data-pdf-source]');
  await expect(frame).toHaveAttribute('data-pdf-source', /pilot-two/);
  expect(fixture.writes).toEqual([]);
});

test('reader distinguishes original and extracted text and source links preserve page identity', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'candidate');
  const iframe = page.locator('[data-pdf-source]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('data-pdf-source', /\/pilot-one\/preview\?company=company/);
  await page.getByRole('tab', { name: /提取文本/ }).click();
  await expect(page.locator('.kbpilot-reader')).toContainText('不保留');
  await expect(page.locator('.kbpilot-reader')).toContainText('长中文段落');
  const source = page.getByRole('link', { name: '原件第 3 页', exact: true });
  await expect(source).toHaveAttribute('href', /pilot-one\/preview.*#page=3/);
  await page.getByRole('tab', { name: /原件预览/ }).click();
  await expect(iframe).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('narrow containers and short viewport keep state and text readable without horizontal crop', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'running');
  for (const width of [1920, 1280, 768, 375]) {
    await page.setViewportSize({ width, height: width === 1280 ? 600 : 900 });
    await page.getByRole('tab', { name: /提取文本/ }).click();
    await expect(page.getByRole('region', { name: '资料加工状态' })).toContainText('2/4');
    const overflow = await page.locator('.kbpilot-async, .kbpilot-reader').evaluateAll(elements => elements.map(el => ({ width: el.clientWidth, scroll: el.scrollWidth })));
    for (const box of overflow) expect(box.scroll).toBeLessThanOrEqual(box.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { for (const node of document.querySelectorAll('.kbw-body')) node.scrollTop = 0; });
    await page.screenshot({ path: `test-results/knowledge-pilot-${width}.png`, fullPage: true });
    await page.locator('.kbpilot-reader').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/knowledge-pilot-text-${width}.png`, fullPage: true });
  }
  expect(fixture.errors).toEqual([]);
});

test('draft keeps original replacement input and requires an explicitly selected file before save', async ({ page }) => {
  const fixture = await knowledgePilotSurface(page, 'idle');
  fixture.setDocumentStatus('draft');
  await page.reload();
  await expect(page.getByRole('region', { name: '资料加工状态' })).toContainText('原件草稿已保存，尚未解析');
  await page.getByRole('button', { name: '替换草稿原件', exact: true }).click();
  const input = page.locator('.kbv-document-replacement input[type=file]');
  await expect(input).toBeVisible();
  const save = page.getByRole('button', { name: '保存', exact: true });
  await expect(save).toBeDisabled();
  await input.setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nread-only browser test\n') });
  await expect(save).toBeEnabled();
  await expect(page.locator('.kbv-document-replacement')).toContainText('replacement.pdf');
  expect(fixture.writes).toEqual([]);
});

test('unavailable PDF is visibly identified and manual recovery only sends a read-only probe', async ({ page }) => {
  let probes = 0;
  page.on('request', request => { if (request.method() === 'HEAD' && request.url().includes('/preview')) probes++; });
  const fixture = await knowledgePilotSurface(page, 'running');
  const reader = page.getByRole('region', { name: '资料阅读' });
  await expect(reader).toContainText('原件预览读取失败');
  await expect(reader).toContainText('HTTP 503');
  const before = probes;
  await reader.getByRole('button', { name: '重新读取预览', exact: true }).click();
  await expect.poll(() => probes).toBeGreaterThan(before);
  await expect(reader).toContainText('原件预览读取失败');
  expect(fixture.writes).toEqual([]);
});
