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

  const start = Date.now();
  try {
    await page.goto('http://47.88.94.205/skills', { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log('GOTO ERROR', e.message);
  }
  const loadTime = Date.now() - start;

  await page.waitForTimeout(3000);

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? {
      domContentLoaded: nav.domContentLoadedEventEnd,
      loadComplete: nav.loadEventEnd,
      responseEnd: nav.responseEnd,
      transferSize: nav.transferSize,
      decodedBodySize: nav.decodedBodySize,
    } : {};
  });

  const title = await page.title();
  const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 800));

  await page.screenshot({ path: 'skills-screenshot.png', fullPage: true });

  console.log(JSON.stringify({ loadTime, title, visibleText, perf, requests: requests.slice(0, 50) }, null, 2));
  await browser.close();
})();
