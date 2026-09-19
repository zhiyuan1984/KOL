const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text().slice(0, 200));
  });
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[name="email"]', { timeout: 30000 });
  await page.fill('input[name="email"]', 'sriphy');
  await page.fill('input[name="password"]', '123456789');
  await page.press('input[name="password"]', 'Enter');
  await page.waitForTimeout(5000);

  await page.goto('http://127.0.0.1:4177/skills', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const title = await page.title();
  const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 1000));
  const url = page.url();

  await page.screenshot({ path: 'skill-catalog-screenshot.png', fullPage: true });

  console.log(JSON.stringify({ url, title, visibleText }, null, 2));
  await browser.close();
})();
