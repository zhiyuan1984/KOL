import { expect, test, type Page } from '@playwright/test';
const lead = { id: 'lead-layout', display_name: '完整达人名称'.repeat(16), platform: 'YouTube', lead_stage: 'pending_contact', lead_source: 'manual', data_version: 1, brand: 'LT', region: '全球英', updated_at: '2026-10-11T01:00:00Z', created_at: '2026-10-10T01:00:00Z', is_archived: false };
const coop = { id: 'coop-layout', title: '全球英语合作项目', coop_stage: 'INITIAL_CONTACT', coop_type: 'paid', currency: 'USD', brand: 'LT', lead_display_name: '完整达人名称', lead_platform: 'YouTube', updated_at: '2026-10-11T01:00:00Z', data_version: 1 };
async function fixture(page: Page) {
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const account={id:'layout-admin',name:'布局测试管理员',roles:['admin'],available_modes:['employee','admin']};
  await page.route('**/api/**', async route => {
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET') { writes.push(path); return route.fulfill({status:409,json:{error:'test_read_only'}}); }
    let json: unknown=[];
    if(path==='/api/auth/status') json={authenticated:true,account,user:account};
    else if(path==='/api/me') json=account;
    else if(path==='/api/preferences') json={theme:'light'};
    else if(path==='/api/kol/leads') json={leads:[lead],total:1};
    else if(path==='/api/kol/leads/automation-status') json={enabled:false};
    else if(path==='/api/kol/leads/lead-layout') json={lead,work_orders:[],cooperations:[],allowed_actions:[]};
    else if(path.endsWith('/events')) json={events:[]};
    else if(path==='/api/kol/cooperations') json={cooperations:[coop],total:1};
    else if(path==='/api/kol/cooperations/coop-layout') json={cooperation:coop,lead,work_orders:[],events:[],allowed_actions:[]};
    else if(path==='/api/admin/ontology/registries') json={registries:['objects','events','tickets','rules'].map(scope=>({scope,base_version:'layout-baseline',data:{objects:[{id:'p',name:'人员',status:'active'}]}}))};
    else if(path==='/api/admin/ontology/change-approvals/latest') json={latest:null,base_version:'layout-baseline'};
    else if(path==='/api/admin/work-orders/data-quality') json={active_person_count:1,active_unit_count:1,issue_count:0,issues:[],registry_revision:'layout-org',seeded_at:null,as_of:'2026-10-11T01:00:00Z'};
    else if(path==='/api/admin/work-orders/account-bindings/options') json={accounts:[],people:[]};
    else if(path==='/api/admin/work-orders/templates') json={templates:[]};
    else if(path==='/api/admin/work-orders/automation-releases') json={releases:[]};
    else if(path==='/api/task-work-orders') json={items:[]};
    else if(path==='/api/tickets/reports/organization') json={rows:[],by_assignee_unit:[],authorization:{mode:'company_admin',root_units:[]},total_authorized:0,totals:{total:0,by_status:{}},as_of:'2026-10-11T01:00:00Z'};
    else if(path==='/api/tickets/reports/organization/stages') json={rows:[],by_stage:[],by_business_category:[],total_authorized:0,as_of:'2026-10-11T01:00:00Z'};
    await route.fulfill({json});
  });
  return { writes, errors };
}
for(const entry of [{url:'/leads',text:'线索管理'},{url:'/cooperations',text:'合作项目'},{url:'/admin/ontology',text:'本体管理'},{url:'/admin/work-orders',text:'工单治理'}]) {
  test(`global layout read-only smoke ${entry.url}`,async({page})=>{
    const state=await fixture(page);await page.goto(entry.url);await expect(page.getByRole('heading',{name:entry.text,exact:true}).first()).toBeVisible();
    await expect(page.getByText('正在检查账户…')).toHaveCount(0); await page.screenshot({path:`test-results/global-layout/smoke-${entry.url.replaceAll('/','-')}.png`,fullPage:true});
    expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
  });
}
test('long lead title has a keyboard-accessible complete view and does not trigger a business write',async({page})=>{
  const state=await fixture(page);await page.goto('/leads');const expand=page.getByRole('button',{name:`查看完整标题：${lead.display_name}`}).first();await expect(expand).toBeVisible();await expand.focus();await page.keyboard.press('Enter');await expect(page.locator('.ui-full-text')).toHaveText(lead.display_name);expect(state.writes).toEqual([]);
});
test('touch conversation controls retain 44px hit areas',async({browser})=>{
  const context=await browser.newContext({viewport:{width:375,height:900},hasTouch:true,isMobile:true});const page=await context.newPage();await fixture(page);
  await page.route('**/api/me/settings-sessions',r=>r.fulfill({json:[{id:'s1',title:'发现任务 · YouTube · 全球英',archived_at:null}]}));
  await page.route('**/api/me/data-summary',r=>r.fulfill({json:{sessions:1}}));
  await page.goto('/settings?tab=privacy');const row=page.locator('[data-session-row="s1"]');await expect(row).toBeVisible();
  for(const button of await row.locator('button,a').all()) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await context.close();
});

test('knowledge provenance uses shared properties and keeps the complete body',async({page})=>{
  const state=await fixture(page);const row={id:'kb-layout',title:'布局资料',kind:'guide',status:'approved',current_version:1,created_by:'tester',updated_at:'2026-10-11T01:00:00Z',body:'完整资料正文，用于核对布局不会删除原始事实。',scope_brand:'LT',scope_stage:null,is_favorite:false};
  await page.route('**/api/knowledge**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/knowledge'?[row]:{families:[],domains:[],bases:[]}}));
  await page.goto('/kb');await page.locator('[data-kb-open="kb-layout"]').click();const provenance=page.locator('[data-kb-provenance]');await expect(provenance.locator('.ui-properties')).toBeVisible();await expect(provenance).toContainText('版本');await expect(page.locator('[data-kb-preview="kb-layout"]')).toContainText(row.body);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('mail normal sync status and actions use a record and original text is preserved',async({page})=>{
  const state=await fixture(page);const mailbox='work@example.test';const conversation={id:'thr-layout',mailbox,conversation_id:'mail-layout',subject:'合作邮件完整主题',peer_email:'creator@example.test',peer_name:'Creator',last_at:'2026-10-11T01:00:00Z',message_count:1,unread_count:1,match_state:'matched',collaboration_id:'col-layout'};
  await page.route('**/api/me/starry-binding',r=>r.fulfill({json:{bound:true,status:'connected',mailbox_email:mailbox}}));
  await page.route('**/api/queries/mail.box**',r=>r.fulfill({json:{entry:'memory',kind:'memory',bound:true,mailbox,unread:1,synced_at:'2026-10-11T01:00:00Z'}}));
  await page.route('**/api/queries/mail.conversations**',r=>r.fulfill({json:{entry:'memory',mailbox,conversations:[conversation]}}));
  await page.route('**/api/queries/mail.conversation?**',r=>r.fulfill({json:{entry:'memory',conversation,messages:[{id:'message-layout',conversation_id:'mail-layout',direction:'inbound',subject:conversation.subject,body_text:'Original mail text remains complete.',from_addr:conversation.peer_email,to_addr:mailbox,occurred_at:'2026-10-11T01:00:00Z'}]}}));
  await page.route('**/api/queries/mail.person**',r=>r.fulfill({json:{entry:'memory',mailbox,peer_email:conversation.peer_email,digest_text:''}}));
  await page.goto(`/mail?box=${mailbox}&c=mail-layout`);await expect(page.locator('[data-mail-box].ui-record-row')).toBeVisible();await expect(page.locator('[data-mail-thread]')).toContainText(conversation.subject);await expect(page.locator('.mail-detail-properties')).toContainText('Creator');expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
