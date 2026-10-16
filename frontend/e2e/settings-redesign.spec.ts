import { expect, test, type Page } from '@playwright/test';
const context = {
  profile: { name: '王想', email: 'xiang.wang@amperetime.com', phone: '', employee_no: '1083', position: 'AI产品经理', company_name: '安培时代', organization_path: ['研究院', '数字智能中心', '产品部', 'AI产品组'], manager_name: '黄启友', managed: true },
  brands: [{ id: 'LT', label: 'LiTime' }, { id: 'RO', label: 'Redodo' }],
  mailboxes: [{ id: 'box1', email: 'work@litime.com', brand: 'LT', status: 'connected', is_default: true }, { id: 'box2', email: 'expired@redodo.com', brand: 'RO', status: 'expired', is_default: false }],
  preferences: { theme: 'dark', locale: 'en', notifications: true, model_tier: 'quality', default_brand: 'LT', default_mailbox: 'work@litime.com' }, editable_fields: [],
};
async function mock(page: Page) {
  const calls: string[] = []; const writes: Array<{ path: string; data: any }> = [];
  let failRead = false; let failSave = false;
  const account = { id: 'employee-test', name: '王想', email: 'xiang.wang@amperetime.com', roles: ['employee'], available_modes: ['employee'] };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method(); calls.push(path);
    if (method !== 'GET') writes.push({ path, data: route.request().postDataJSON() });
    if (path === '/api/me/settings-context') { await new Promise(r => setTimeout(r, 150)); if (failRead) return route.fulfill({ status: 500, json: { detail: 'postgres /srv/private token=SECRET' } }); return route.fulfill({ json: context }); }
    if (path === '/api/preferences') { if (method === 'PATCH' && failSave) return route.fulfill({ status: 502, json: { detail: 'Authorization: Bearer SECRET /srv/path stack trace' } }); return route.fulfill({ json: method === 'PATCH' ? route.request().postDataJSON() : { analytics_cookies: false } }); }
    if (path === '/api/auth/status') return route.fulfill({ json: { authenticated: true, setup_required: false, user: account, available_modes: ['employee'] } });
    if (path === '/api/me') return route.fulfill({ json: account });
    if (path === '/api/health') return route.fulfill({ json: { ok: true } });
    if (path === '/api/memory') return route.fulfill({ json: [{ id: 'm1', title: '邮件风格', body_md: '简洁清楚', scope: 'private', enabled: true, version: 2, editable: true }] });
    if (path === '/api/me/settings-sessions') return route.fulfill({ json: [{ id: 's1', title: '本人的对话', archived_at: null }] });
    if (path === '/api/me/data-summary') return route.fulfill({ json: { sessions: 1, archived_sessions: 0, memories: 1, database_bytes: 999999 } });
    if (path === '/api/me/starry-binding/probe') return route.fulfill({ json: { mailboxes: [{ id: 'new1', mailbox_email: 'other@litime.com', brand: 'LT', owner_name: '员工' }] } });
    if (path === '/api/me/starry-binding') return route.fulfill({ json: { bound: true, status: 'connected' } });
    if (path === '/api/home/entries') return route.fulfill({ json: { entries: [], groups: [], meta: {} } });
    if (path.includes('/dashboard')) return route.fulfill({ json: { tasks: { items: [] }, recent: [] } });
    if (path === '/api/tasks') return route.fulfill({ json: { tasks: [] } });
    if (path === '/api/cron/jobs') return route.fulfill({ json: { jobs: [] } });
    if (path === '/api/cron/alerts') return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return { calls, writes, failRead: () => { failRead = true; }, failSave: () => { failSave = true; } };
}

test('profile loads only its own settings, preserves fourth-level organization and removes internal noise', async ({ page }) => {
  const state = await mock(page); await page.goto('/settings'); await expect(page.locator('[data-property="name"] dd')).toHaveText('王想');
  expect(state.calls).not.toContain('/api/memory'); expect(state.calls).not.toContain('/api/me/settings-sessions'); expect(state.calls).not.toContain('/api/me/data-summary');
  await expect(page.locator('.settings-content')).not.toContainText(/handle|thread|MCP|Markdown|jeffrey|schema|连接器/);
  await expect(page.locator('[data-nav-disabled]')).toHaveCount(0); await expect(page.locator('[data-app-version]')).toHaveCount(0);
  await expect(page.locator('.settings-profile-facts input')).toHaveCount(0);
  await page.getByText('组织资料', { exact: true }).click(); await expect(page.locator('.settings-content')).toContainText('AI产品组');
  await page.screenshot({ path: 'test-results/settings/profile-1280.png', fullPage: true });
});
test('asynchronous preferences display persisted values, failed save does not apply a theme or leak errors', async ({ page }) => {
  const state = await mock(page); await page.goto('/settings?tab=preferences');
  await expect(page.locator('#theme').locator('..')).toContainText('深色'); await expect(page.locator('.settings-content')).toContainText('高质量');
  state.failSave(); const before = await page.evaluate(() => document.documentElement.dataset.theme || 'system');
  await page.getByRole('button', { name: '保存偏好', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('工作偏好未保存');
  expect(await page.evaluate(() => document.documentElement.dataset.theme || 'system')).toBe(before);
  await expect(page.locator('.settings-content')).not.toContainText(/SECRET|Authorization|\/srv|stack/);
  expect(state.writes.filter(row => row.path === '/api/preferences')).toHaveLength(1);
});
test('read failure is not an empty successful state and retry is visible', async ({ page }) => {
  const state = await mock(page); state.failRead(); await page.goto('/settings'); await expect(page.getByRole('alert')).toContainText('无法读取个人资料'); await expect(page.getByRole('button', { name: '重试' })).toBeVisible(); await expect(page.getByLabel('姓名', { exact: true })).toHaveCount(0);
});
test('cancel restores the latest saved preferences and clearing brand does not offer unmatched mailboxes', async ({ page }) => {
  await mock(page); await page.goto('/settings?tab=preferences');
  await page.locator('#theme').click(); await page.getByText('浅色', { exact: true }).click();
  await page.getByRole('button', { name: '保存偏好' }).click(); await expect(page.getByRole('status')).toContainText('工作偏好已保存');
  await page.locator('#theme').click(); await page.getByText('深色', { exact: true }).click();
  await page.getByRole('button', { name: '取消修改' }).click(); await expect(page.locator('#theme').locator('..')).toContainText('浅色');
  await page.locator('#default_brand').click(); await page.getByText('每次选择', { exact: true }).first().click();
  await expect(page.locator('#default_mailbox').locator('..')).toContainText('每次选择');
  await page.locator('#default_mailbox').click(); await expect(page.locator('.ant-select-dropdown:visible:not(.ant-slide-up-leave)')).not.toContainText('work@litime.com');
});
test('password mismatch retains input and makes no request, leaving asks before discarding', async ({ page }) => {
  const state = await mock(page); await page.goto('/settings?tab=security');
  await page.getByLabel('当前密码', { exact: true }).fill('old-password'); await page.getByLabel('新密码', { exact: true }).fill('new-password-123'); await page.getByLabel('确认新密码', { exact: true }).fill('wrong-password-123');
  await page.getByRole('button', { name: '更新密码' }).click(); await expect(page.getByText('两次新密码不一致。')).toBeVisible(); expect(state.writes).toHaveLength(0);
  await page.getByRole('tab', { name: '个人资料', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('放弃未保存的修改'); await page.getByRole('button', { name: '继续编辑' }).click(); await expect(page).toHaveURL(/tab=security/);
  await expect(page.getByLabel('新密码', { exact: true })).toHaveValue('new-password-123');
});
test('sidebar navigation is blocked while unsaved and deep links remain compatible', async ({ page }) => {
  await mock(page); await page.goto('/settings?tab=security');
  await page.getByLabel('当前密码', { exact: true }).fill('old-password');
  await page.getByRole('link', { name: '任务中心' }).click();
  await expect(page.getByRole('dialog')).toContainText('放弃未保存的修改');
  await page.getByRole('button', { name: '继续编辑' }).click(); await expect(page).toHaveURL(/settings\?tab=security/);
  await page.getByRole('tab', { name: '工作偏好', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改' }).click(); await expect(page).toHaveURL(/tab=preferences/);
  await page.reload(); await expect(page.getByRole('button', { name: '保存偏好' })).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/tab=security/);
});
test('expired mailbox is not marked connected, unbind cancel writes nothing, probe does not auto-select', async ({ page }) => {
  const state = await mock(page); await page.goto('/settings?tab=starry'); await expect(page.locator('[data-starry-status="expired"]')).toContainText('连接已过期');
  await page.locator('[data-starry-unbind]').first().click(); await expect(page.getByRole('dialog')).toContainText('不会自动改用其他邮箱'); await page.getByRole('button', { name: '取消操作', exact: true }).click(); expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: '读取可用邮箱' }).click(); await expect(page.getByRole('button', { name: '绑定所选邮箱' })).toBeDisabled();
});
test('memory uses list and on-demand editor; no body is shown until editing', async ({ page }) => {
  await mock(page); await page.goto('/settings?tab=memories'); await expect(page.getByText('邮件风格', { exact: true })).toBeVisible(); await expect(page.locator('textarea')).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await expect(page.getByLabel('内容', { exact: true })).toHaveValue('简洁清楚');
  await page.screenshot({ path: 'test-results/settings/memory-drawer.png', fullPage: true });
});
test('privacy shows only reviewed summary fields and owned conversation actions', async ({ page }) => {
  await mock(page); await page.goto('/settings?tab=privacy'); await expect(page.getByText('本人的对话')).toBeVisible(); await page.getByText('账户数据摘要', { exact: true }).click(); await expect(page.locator('.settings-content')).not.toContainText(/999999|database_bytes/); await expect(page.getByRole('link', { name: '导出对话' })).toHaveAttribute('href', '/api/sessions/s1/export?format=md');
});
for (const width of [375, 768, 1280, 1920]) {
  test(`settings at ${width}px have no horizontal document overflow`, async ({ page }) => {
    await mock(page); await page.setViewportSize({ width, height: 900 }); await page.goto('/settings?tab=preferences');
    await expect(page.getByRole('button', { name: '保存偏好' })).toBeVisible();
    const sizes = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, viewport: window.innerWidth, body: document.body.scrollWidth }));
    expect(sizes.doc).toBeLessThanOrEqual(width); expect(sizes.body).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/settings/preferences-${width}.png`, fullPage: true });
  });
}

test('short properties use aligned label/value columns with a deliberate gap', async ({ page }) => {
  const state = await mock(page); await page.goto('/settings');
  const row = page.locator('[data-property="name"]'); await expect(row).toContainText('王想');
  const box = await row.evaluate(e => { const l=e.querySelector('dt')!.getBoundingClientRect(),v=e.querySelector('dd')!.getBoundingClientRect(); return { ly:l.y, vy:v.y, gap:v.x-l.right, height:e.getBoundingClientRect().height }; });
  expect(Math.abs(box.ly-box.vy)).toBeLessThan(2); expect(box.gap).toBe(24); expect(box.height).toBeLessThanOrEqual(36); expect(state.writes).toHaveLength(0);
});
test('normal conversation title state and actions share a compact line', async ({ page }) => {
  await mock(page); await page.goto('/settings?tab=privacy'); const row=page.locator('[data-session-row="s1"]'); await expect(row).toContainText('本人的对话');
  const box = await row.evaluate(e=> {const a=e.querySelector('.ui-record-title')!.getBoundingClientRect(),b=e.querySelector('.ui-record-status')!.getBoundingClientRect(),c=e.querySelector('.ui-record-actions')!.getBoundingClientRect();return {titleY:a.y+a.height/2,statusY:b.y+b.height/2,actionY:c.y+c.height/2,height:e.getBoundingClientRect().height};});
  expect(Math.abs(box.titleY-box.statusY)).toBeLessThan(3); expect(Math.abs(box.titleY-box.actionY)).toBeLessThan(3); expect(box.height).toBeLessThanOrEqual(44);
});
for (const width of [320, 480, 720]) {
  test(`short form follows actual ${width}px content container`, async ({ page }) => {
    await mock(page); await page.goto('/settings?tab=preferences'); await expect(page.locator('#theme')).toBeVisible();
    await page.locator('.ui-form-container').evaluate((e,w)=>{(e as HTMLElement).style.width=w+'px';},width);
    const box = await page.locator('#theme').evaluate(e => {const row=e.closest('.ant-form-item')!,l=row.querySelector('.ant-form-item-label')!.getBoundingClientRect(),v=row.querySelector('.ant-form-item-control')!.getBoundingClientRect();return {lx:l.x,ly:l.y,vx:v.x,vy:v.y,vwidth:v.width,overflow:row.scrollWidth-row.clientWidth};});
    if(width<480) expect(box.vy).toBeGreaterThan(box.ly); else { expect(box.vx).toBeGreaterThan(box.lx+100); expect(Math.abs(box.vy-box.ly)).toBeLessThan(2); }
    expect(box.overflow).toBeLessThanOrEqual(1);
  });
}
