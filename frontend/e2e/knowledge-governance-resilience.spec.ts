import {test,expect,type Page} from '@playwright/test';
async function fixture(page:Page){
 const account={id:'governance-reader',name:'管理员',available_modes:['admin','employee']};
 let queueFailure=true,summaryFailure=false;
 const data={tenant:'company',bases:[],domains:[],rows:[],total:3,page:1,page_size:20,page_count:1,facets:{},stats:{status:{draft:1,normalizing:1,failed:1},pending_review:{count:0,max_wait_days:0},pending_documents:{count:0,max_wait_days:0},expiring:{count:0,nearest:null}}};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/status')return route.fulfill({json:{authenticated:true,account}});
  if(path==='/api/me')return route.fulfill({json:account});
  if(path==='/api/preferences')return route.fulfill({json:{theme:'light'}});
  if(path==='/api/cron/jobs')return route.fulfill({json:{jobs:[]}});
  if(path==='/api/admin/knowledge/workspace-v1')return summaryFailure?route.fulfill({status:503,json:{detail:'统计服务暂不可用'}}):route.fulfill({json:data});
  if(/\/admin\/knowledge\/(feedback|proposals)$/.test(path))return queueFailure?route.fulfill({status:503,json:{detail:'治理队列服务暂不可用'}}):route.fulfill({json:[]});
  return route.fulfill({json:[]});
 });
 await page.goto('/admin/knowledge?reviewCompany=company');
 return {recoverQueue:()=>{queueFailure=false;},failSummary:()=>{summaryFailure=true;}};
}
test('asset totals include persisted processing and failure states',async({page})=>{
 await fixture(page);
 const panel=page.locator('[data-knowledge-assets]');await expect(panel).toContainText('全局共 3 条');
 await expect(panel.locator('[data-kb-status="normalizing"]')).toContainText('1');
 await expect(panel.locator('[data-kb-status="failed"]')).toContainText('1');
 expect(await panel.locator('.kbadmin-status-count').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent),0))).toBe(3);
 await expect(panel.locator('button[data-kb-status="normalizing"],button[data-kb-status="failed"]')).toHaveCount(0);
});
test('queue failure is not displayed as zero and retry restores the true empty state',async({page})=>{
 const state=await fixture(page);await page.getByRole('tab',{name:'生命周期',exact:true}).click();
 await expect(page.locator('[data-knowledge-queue-error]')).toContainText('治理队列服务暂不可用');
 await expect(page.locator('[data-kb-queue="feedback"] .kbadmin-queue-count')).toHaveText('—');
 await page.locator('[data-kb-queue="feedback"]').click();
 await expect(page.locator('[data-admin-kb-feedback]')).not.toContainText('当前没有待处置反馈');
 state.recoverQueue();await page.locator('[data-knowledge-queue-error]').getByRole('button',{name:'重试'}).click();
 await expect(page.locator('[data-knowledge-queue-error]')).toHaveCount(0);
 await expect(page.locator('[data-kb-queue="feedback"] .kbadmin-queue-count')).toHaveText('0');
 await expect(page.locator('[data-admin-kb-feedback]')).toContainText('当前没有待处置反馈');
});
test('summary failure keeps an explicit retry and never fabricates zero asset statistics',async({page})=>{
 const state=await fixture(page);state.failSummary();await page.reload();
 await expect(page.locator('[data-knowledge-right] [role="alert"]')).toContainText('统计服务暂不可用');
 await expect(page.locator('[data-knowledge-assets]')).toHaveCount(0);
 await expect(page.locator('[data-knowledge-right]').getByRole('button',{name:'重试'})).toBeVisible();
});
