import { chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>${css}</style>
</head>
<body>
  <div class="workbench" data-ui-shell="agent-v1">
    <aside class="sidebar">
      <div class="sidebar-head">
        <a class="sidebar-brand" data-sidebar-brand>
          <span class="brand-name sidebar-label">灵工 工作</span>
        </a>
      </div>
      <div class="sidebar-scroll">
        <nav class="nav-group">
          <a class="nav-link active" data-nav="new-task"><span class="sidebar-label">新工作任务</span></a>
          <a class="nav-link" data-nav="running"><span class="sidebar-label">进行中</span></a>
        </nav>
      </div>
      <div class="sidebar-foot">
        <div class="account-bar" data-account-bar>
          <div class="account-identity account-pedestal" data-account-pedestal>
            <span class="account-avatar" aria-hidden>鄢</span>
            <span class="account-copy sidebar-label">
              <span class="account-name" data-account-name>鄢棽</span>
              <span class="account-role" data-account-role>管理员</span>
            </span>
          </div>
          <div class="account-actions">
            <nav class="surface-switch" aria-label="工作界面" data-surface-switch-group>
              <a class="surface-switch-seg" data-surface-switch="employee" aria-current="page" title="员工端"><svg class="nav-ico" viewBox="0 0 24 24" aria-hidden><path d="M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10 M20 21a8 8 0 0 0-16 0" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
              <a class="surface-switch-seg" data-surface-switch="admin" title="管理端"><svg class="nav-ico" viewBox="0 0 24 24" aria-hidden><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
            </nav>
            <span class="account-actions-split" aria-hidden></span>
            <a class="account-icon-btn" data-account-settings title="个人设置"><svg class="nav-ico" viewBox="0 0 24 24" aria-hidden><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915 M15 12a3 3 0 0 1-6 0 3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
            <button class="account-icon-btn" data-account-logout type="button" title="退出登录"><svg class="nav-ico" viewBox="0 0 24 24" aria-hidden><path d="M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          </div>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="home-pane" data-home>
        <div class="home-stage">
          <div class="home-hero">
            <h1 data-home-title="today">今天有什么工作要处理？</h1>
            <p class="home-stats">3项待处理</p>
            <section class="task-group">
              <h2>推荐任务</h2>
            </section>
            <section class="followed-agent-report" data-followed-agent-report>
              <header class="agent-report-head">
                <p class="page-conclusion">有 3 位红人可以继续推进</p>
              </header>
              <div class="agent-report-identity">
                <strong data-kol-name>林小美</strong>
                <span data-kol-scope>@linxiaomei</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  </div>
</body>
</html>`;

const metricsScript = () => {
  const cs = (el) => getComputedStyle(el);
  const typeOf = (el) => {
    if (!el) return null;
    const s = cs(el);
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      lineHeight: s.lineHeight,
    };
  };
  const sidebar = document.querySelector(".sidebar");
  const workbench = document.querySelector(".workbench");
  const grid = cs(workbench).gridTemplateColumns;
  const token = cs(document.documentElement).getPropertyValue("--left-width").trim();
  const sidebarRules = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      const text = rule.cssText || "";
      if (text.includes(".sidebar") && (text.includes("width") || text.includes("grid-template-columns") || text.includes("--left-width"))) {
        sidebarRules.push(text.slice(0, 280));
      }
    }
  }
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    tokenLeftWidth: token,
    workbenchGrid: grid,
    workbenchFirstCol: grid.split(" ")[0],
    sidebar: {
      computedWidth: cs(sidebar).width,
      minWidth: cs(sidebar).minWidth,
      maxWidth: cs(sidebar).maxWidth,
      padding: cs(sidebar).padding,
      borderRightWidth: cs(sidebar).borderRightWidth,
      boxSizing: cs(sidebar).boxSizing,
      rectWidth: sidebar.getBoundingClientRect().width,
    },
    html: typeOf(document.documentElement),
    body: typeOf(document.body),
    homeTitle: typeOf(document.querySelector("[data-home-title]")),
    conclusion: typeOf(document.querySelector(".page-conclusion")),
    sectionTitle: typeOf(document.querySelector(".task-group h2")),
    navActive: typeOf(document.querySelector(".nav-link.active")),
    navItem: typeOf(document.querySelector(".nav-link:not(.active)")),
    username: typeOf(document.querySelector("[data-account-name]")),
    handle: typeOf(document.querySelector("[data-kol-scope]")),
    overrideHints: sidebarRules.slice(0, 20),
  };
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/`);
const desktop = await page.evaluate(metricsScript);

await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => {
  document.querySelector(".workbench")?.classList.add("sidebar-collapsed");
});
const collapsedDesktopPrep = await page.evaluate(() => {
  document.querySelector(".workbench")?.classList.remove("sidebar-collapsed");
  return true;
});
void collapsedDesktopPrep;

await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => document.querySelector(".workbench")?.classList.add("sidebar-collapsed"));
const collapsed = await page.evaluate(metricsScript);

await page.evaluate(() => document.querySelector(".workbench")?.classList.remove("sidebar-collapsed"));
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => document.querySelector(".sidebar")?.classList.add("mobile-open"));
const mobile = await page.evaluate(metricsScript);

const out = { desktop, collapsed, mobile };
const dest = process.argv[2] || path.join(root, "test-results", "shell-metrics-before.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
