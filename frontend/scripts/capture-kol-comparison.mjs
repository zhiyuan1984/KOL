import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const baseURL = process.env.KOL_CAPTURE_URL || 'http://127.0.0.1:4196';
const out = process.env.KOL_CAPTURE_DIR;
if (!out) throw new Error('Set KOL_CAPTURE_DIR to the output directory');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    // No API may reach a real service: fixture commands are not clicked.
    await page.route('**/api/**', route => route.abort());
    await page.goto(`${baseURL}/e2e/kol-card-fixture.html?container=820&theme=${theme}`);
    await page.locator('[data-fixture-card=discovery] [data-kol-unified]').waitFor();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.evaluate(() => document.fonts.ready);
    for (const kind of ['followed', 'pool', 'discovery']) {
      await page.locator(`[data-fixture-card=${kind}] [data-kol-unified]`).screenshot({ path: path.join(out, `${theme}-${kind}.png`) });
    }
    await page.close();
  }
} finally { await browser.close(); }
