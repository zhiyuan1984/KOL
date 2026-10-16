import { test, expect } from '@playwright/test';

// Rendering-only fixtures; never connect this suite to production APIs.
for (const theme of ['light', 'dark']) {
  test(`five tabs retain scoped antd controls, geometry and keyboard access: ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    const writes: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
      let json: unknown = [];
      if (path === '/api/auth/status') json = { authenticated: true, account: { id: 'employee', name: '员工', available_modes: ['employee'] } };
      else if (path === '/api/me') json = { id: 'employee', name: '员工', available_modes: ['employee'] };
      else if (path === '/api/preferences') json = { theme };
      else if (path === '/api/home/board') json = { kols: [], tabs: [], tasks: [], workbench: { today: [], todo: [] }, follow_scope: { required: false, bound: false } };
      else if (path === '/api/home/following') json = { entry: 'memory', creates_session: false, calls_model: false, kols: [], follow_scope: { required: false, bound: false } };
      else if (path === '/api/home/pool') json = { entry: 'memory', creates_session: false, calls_model: false, items: [], kols: [], library: { count: 0 }, page: { offset: 0, limit: 50, total: 0, matched: 0, next_offset: null } };
      else if (path === '/api/workbench/tasks' || path === '/api/tickets') json = { items: [], page: { next_cursor: null } };
      else if (path === '/api/home/today-tasks' || path === '/api/home/todo-tasks') json = { items: [] };
      else if (path === '/api/workbench/plan') json = { planning: false, brief: null, events: [], creates_session: false, calls_model: false };
      else if (path === '/api/tasks') json = { tasks: [] };
      else if (path === '/api/cron/jobs') json = { jobs: [] };
      if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      await route.fulfill({ json });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1440, 1920, 1280, 1101, 1100, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const samples: Array<{ width: number; left: number; top: number }> = [];
      for (const tab of ['today', 'todo', 'discovery', 'pool', 'lifecycle']) {
        await page.goto(`/?tab=${tab}`);
        const root = page.locator(`[data-home-pane="${tab}"][data-scope-workspace="${tab}"]`);
        await expect(page.locator('[data-home]')).toHaveCount(1);
        await expect(page.locator('[data-home]')).toHaveAttribute('data-home-active-mode', tab);
        await expect(root).toBeVisible();
        await expect(page.locator(':root')).toHaveAttribute('data-theme', theme);
        const sample = await root.evaluate(el => {
          const style = getComputedStyle(el);
          const stage = el.closest<HTMLElement>('[data-home]')?.querySelector<HTMLElement>('.home-stage');
          if (!stage) throw new Error('missing current Home stage around workspace');
          const center = el.querySelector<HTMLElement>('[data-scope-ai-workspace]')!;
          const rail = el.querySelector<HTMLElement>('[data-scope-task-rail]')!;
          const r = el.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          const stageStyle = getComputedStyle(stage);
          const centerRect = center.getBoundingClientRect();
          const railRect = rail.getBoundingClientRect();
          return { width: r.width, left: r.left, top: r.top,
            display: style.display, agentVisual: el.getAttribute('data-agent-visual'),
            stage: { width: stageRect.width, left: stageRect.left, top: stageRect.top,
              paddingTop: stageStyle.paddingTop, paddingLeft: stageStyle.paddingLeft,
              paddingRight: stageStyle.paddingRight, maxWidth: stageStyle.maxWidth },
            center: { left: centerRect.left, right: centerRect.right, top: centerRect.top, bottom: centerRect.bottom, width: centerRect.width },
            rail: { left: railRect.left, right: railRect.right, top: railRect.top, bottom: railRect.bottom, width: railRect.width },
            primary: style.getPropertyValue('--av-primary').trim(),
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        expect(sample.primary).toBe(theme === 'light' ? '#1677ff' : '#177ddc');
        expect(sample.display).toBe('grid');
        expect(sample.overflow).toBe(false);
        if (width >= 1101) {
          expect(sample.rail.width).toBeGreaterThanOrEqual(360);
          expect(Math.abs(sample.center.top - sample.rail.top)).toBeLessThan(1);
          expect(Math.abs(sample.center.bottom - sample.rail.bottom)).toBeLessThan(1);
          expect(Math.abs(sample.center.right - sample.rail.left)).toBeLessThanOrEqual(1);
          if (tab === 'discovery') {
            expect(sample.stage.width).toBe(width - 260);
            expect(sample.width).toBe(sample.stage.width);
            expect(sample.left).toBe(sample.stage.left);
            expect(sample.agentVisual).toBe('session-pre-2e909ebe');
            expect(sample.center.width).toBe(432);
          } else {
            expect(sample.stage.width).toBeLessThanOrEqual(1200);
            expect(sample.stage.maxWidth).toBe('1200px');
            expect(Math.abs(sample.stage.left - (260 + (width - 260 - sample.stage.width) / 2))).toBeLessThan(1);
            expect(sample.stage.paddingTop).toBe('4px');
            expect(Math.abs(sample.left - sample.stage.left - parseFloat(sample.stage.paddingLeft))).toBeLessThan(1);
            expect(Math.abs(sample.stage.left + sample.stage.width - sample.width - sample.left - parseFloat(sample.stage.paddingRight))).toBeLessThan(1);
            expect(sample.agentVisual).toBeNull();
          }
        } else {
          expect(sample.rail.top).toBeGreaterThanOrEqual(sample.center.bottom);
        }
        if (tab !== 'discovery') samples.push({ width: sample.width, left: sample.left, top: sample.top });
        const active = root.locator('[data-home-quick-tasks] button[aria-selected="true"]');
        await expect(active).toHaveCount(1);
        await expect(active).toHaveAttribute('data-home-mode', tab);
        await active.focus();
        await expect(active).toBeFocused();
        await expect(active).toHaveCSS('border-bottom-width', '2px');
        if (width === 1440) await page.screenshot({ path: info.outputPath(`${tab}-${theme}.png`), fullPage: true });
      }
      for (const sample of samples) expect(sample).toEqual(samples[0]);
    }
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}
