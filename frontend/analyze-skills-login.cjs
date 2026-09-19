const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const requests = [];
  page.on('request', req => {
    requests.push({ url: req.url(), method: req.method(), start: Date.now() });
  });
  page.on('response', async res => {
    const req = requests.find(r => r.url === res.url());
    if (req) {
      req.status = res.status();
      req.duration = Date.now() - req.start;
      try {
        const headers = await res.allHeaders();
        req.contentLength = headers['content-length'];
        req.contentType = headers['content-type'];
      } catch (e) {}
    }
  });
  page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text().slice(0, 200)));
  page.on('pageerror', err => console.log('PAGEERROR', err.message));

  await page.goto('http://47.88.94.205/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('input[name="email"]', { timeout: 60000 });
  await page.waitForTimeout(2000);

  await page.fill('input[name="email"]', 'sriphy');
  await page.fill('input[name="password"]', '123456789');
  await page.press('input[name="password"]', 'Enter');
  await page.waitForTimeout(10000);

  const urlAfterLogin = page.url();
  console.log('After login URL:', urlAfterLogin);

  const skillsStart = Date.now();
  await page.goto('http://47.88.94.205/skills', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);
  const skillsLoadTime = Date.now() - skillsStart;

  const title = await page.title();
  const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  const url = page.url();

  await page.screenshot({ path: 'skills-page-screenshot.png', fullPage: true });

  console.log(JSON.stringify({ urlAfterLogin, url, title, skillsLoadTime, visibleText, requests: requests.slice(-30) }, null, 2));
  await browser.close();
})();
