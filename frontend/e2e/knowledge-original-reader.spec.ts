import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { knowledgePilotSurface } from './fixtures/knowledge-pilot-surface';

// Explicit opt-in; this test uses a real private PDF, never commits the original.
// HTTP state remains mocked. It verifies PDF bytes and PDF.js viewport/page navigation,
// NOT equivalence between a converted PDF and PowerPoint's source rendering.
test('real existing PDF bytes and original page link survive PDF.js container rendering', async ({ page }) => {
  const file = process.env.KNOWLEDGE_PILOT_REAL_PDF;
  if (!file) throw new Error('KNOWLEDGE_PILOT_REAL_PDF is required for original-reader verification');
  const bytes = fs.readFileSync(file);
  await page.context().route('**/api/admin/knowledge/documents/pilot-one/preview?*', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const fixture = await knowledgePilotSurface(page, 'candidate');
  await page.route('**/api/admin/knowledge/documents/pilot-one/preview?*', route => route.fulfill({ contentType: 'application/pdf', body: bytes, headers: { 'Content-Disposition': 'inline; filename="verified-original.pdf"' } }));
  const received = page.waitForResponse(res => res.url().includes('/pilot-one/preview') && res.headers()['content-type']?.includes('application/pdf'));
  await page.reload();
  const pdf = await received;
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  // Chromium substitutes a PDF-plugin HTML shell for navigation response.body().
  // Inspect actual source bytes through a browser fetch, not that plugin shell.
  const fetched = await page.evaluate(async () => {
    const response = await fetch('/api/admin/knowledge/documents/pilot-one/preview?company=company');
    const buffer = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return { bytes: buffer.byteLength, hash: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') };
  });
  expect(fetched.bytes).toBe(bytes.length);
  expect(fetched.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  const reader = page.locator('.kbpilot-reader');
  await reader.scrollIntoViewIfNeeded();
  await expect(reader.locator('canvas')).toBeVisible();
  await expect(reader.locator('canvas')).toHaveAttribute('data-rendered', 'true');
  expect(await reader.locator('canvas').evaluate(canvas => Math.abs(canvas.clientWidth / canvas.clientHeight - 4 / 3))).toBeLessThan(0.02);
  await expect(reader).toContainText('字体或换行差异');
  await page.waitForTimeout(2000);
  await reader.screenshot({ path: 'test-results/knowledge-real-pdf-reader.png' });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect.poll(() => reader.locator('canvas').evaluate(canvas => canvas.clientWidth <= canvas.parentElement!.clientWidth + 1)).toBe(true);
  await expect(reader.locator('canvas')).toHaveAttribute('data-rendered', 'true');
  await reader.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await reader.screenshot({ path: 'test-results/knowledge-real-pdf-reader-375.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: '原件第 3 页', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('load');
  await expect(popup).toHaveURL(/#page=3/);
  await popup.waitForTimeout(2000);
  await popup.screenshot({ path: 'test-results/knowledge-real-pdf-page-3.png' });
  await popup.close();
  expect(fixture.writes).toEqual([]);
});
