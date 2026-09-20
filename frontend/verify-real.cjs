const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1255, height: 630 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('http://47.88.94.205/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[name="email"]', { timeout: 60000 });
  await page.fill('input[name="email"]', 'sriphy');
  await page.fill('input[name="password"]', '123456789');
  await page.press('input[name="password"]', 'Enter');
  await page.waitForTimeout(8000);
  await page.goto('http://47.88.94.205/skills', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const tabRows = new Set([...document.querySelectorAll('.skill-tab')].map((e) => Math.round(e.getBoundingClientRect().top))).size;
    const nameEl = document.querySelector('.skill-grid-4 .skill-card-name');
    return {
      content: r('.skill-catalog-content'), preview: r('.skill-catalog-preview'),
      card: r('.skill-grid-4 .skill-card'), tabRows,
      cols: getComputedStyle(document.querySelector('.skill-grid-4')).gridTemplateColumns,
      firstNameClipped: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 1 : null,
      descClipped: (() => { const d = document.querySelector('.skill-grid-4 .skill-card-desc'); return d ? d.scrollHeight > d.clientHeight + 1 : null; })(),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'skill-real.png', fullPage: false });
  await browser.close();
})();
