import {test,expect,type Page} from '@playwright/test';
async function fixture(page:Page){
 const account={id:'governance-reader',name:'管理员',available_modes:['admin','employee']};
 let queueFailure=true,summaryFailure=false;
 const reads:string[]=[];
 const data={tenant:'company',bases:[],domains:[],rows:[],total:3,page:1,page_size:20,page_count:1,facets:{},stats:{status:{draft:1,normalizing:1,failed:1} as Record<string,number>,pending_review:{count:0,max_wait_days:0},pending_documents:{count:0,max_wait_days:0},expiring:{count:0,nearest:null}}};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path==='/api/auth/status')return route.fulfill({json:{authenticated:true,account}});
  if(path==='/api/me')return route.fulfill({json:account});
  if(path==='/api/preferences')return route.fulfill({json:{theme:'light'}});
  if(path==='/api/cron/jobs')return route.fulfill({json:{jobs:[]}});
  if(path==='/api/admin/knowledge/workspace-v1'){
   reads.push(url.search);
   return summaryFailure?route.fulfill({status:503,json:{detail:'统计服务暂不可用'}}):route.fulfill({json:data});
  }
  if(/\/admin\/knowledge\/(feedback|proposals)$/.test(path))return queueFailure?route.fulfill({status:503,json:{detail:'治理队列服务暂不可用'}}):route.fulfill({json:[]});
  return route.fulfill({json:[]});
 });
 await page.goto('/admin/knowledge?reviewCompany=company');
 return {data,reads,recoverQueue:()=>{queueFailure=false;},failSummary:()=>{summaryFailure=true;},recoverSummary:()=>{summaryFailure=false;}};
}
test('asset totals include persisted processing and failure states',async({page})=>{
 await fixture(page);
 const panel=page.locator('[data-knowledge-assets]');await expect(panel).toContainText('全局共 3 条');
 // 状态分布条已移至中栏顶部：生命周期四段与加工健康队列分开呈现。
 const strip=page.locator('[data-kbv-asset-strip]');
 await expect(strip.locator('[data-kb-status="draft"]')).toContainText('1');
 await expect(strip.locator('button[data-kb-status]')).toHaveCount(4);
 expect(await strip.locator('.kbv-asset-seg-num').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent),0))).toBe(1);
 await expect(panel.locator('[data-kb-queue="failed"] .kbadmin-queue-count')).toHaveText('1');
 await expect(panel.locator('a[data-kb-queue="failed"]')).toHaveAttribute('href',/stage=processing/);
});
test('queue failure is not displayed as zero and retry restores the true empty state',async({page})=>{
 const state=await fixture(page);
 // 最新主分支保留生命周期深链，不再把它展示成一级 Tab（未改变原地址契约）。
 await page.goto('/admin/knowledge?reviewCompany=company&stage=lifecycle');
 await expect(page).toHaveURL(/stage=lifecycle/);
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
 const strip=page.locator('[data-kbv-asset-strip]');
 await expect(strip.getByRole('alert')).toContainText('统计服务暂不可用');
 await expect(strip.locator('[data-kb-status]')).toHaveCount(0);
 state.recoverSummary();await strip.getByRole('button',{name:'重试'}).click();
 await expect(strip.locator('[data-kb-status="draft"] .kbv-asset-seg-num')).toHaveText('1');
 await expect(strip.getByRole('alert')).toHaveCount(0);
});
test('asset strip supports keyboard filtering and toggles back to all without changing global counts',async({page})=>{
 const state=await fixture(page),draft=page.locator('[data-kbv-asset-strip] [data-kb-status="draft"]');
 await draft.focus();await page.keyboard.press('Enter');
 await expect(draft).toHaveAttribute('aria-pressed','true');await expect(page).toHaveURL(/view=draft/);
 await expect.poll(()=>state.reads.some(search=>new URLSearchParams(search).get('view')==='draft')).toBe(true);
 await page.keyboard.press('Space');await expect(draft).toHaveAttribute('aria-pressed','false');
 await expect(page).toHaveURL(/view=all/);
 await expect(draft.locator('.kbv-asset-seg-num')).toHaveText('1');
});
test('asset health queues drill into matching document and expiry query axes',async({page})=>{
 const state=await fixture(page);
 await page.locator('[data-knowledge-assets] [data-kb-queue="documents"]').click();
 await expect(page).toHaveURL(/view=pending/);await expect(page).toHaveURL(/asset=document/);
 await expect.poll(()=>state.reads.some(search=>{const p=new URLSearchParams(search);return p.get('view')==='pending'&&p.get('asset')==='document';})).toBe(true);
 await page.locator('[data-kbv-filter-note-clear]').click();
 await page.locator('[data-knowledge-assets] [data-kb-queue="expiry"]').click();
 await expect(page).toHaveURL(/expiring=1/);
 await expect.poll(()=>state.reads.some(search=>new URLSearchParams(search).get('expiring')==='1')).toBe(true);
});
test('small status segments remain readable at skewed counts and compact widths',async({page})=>{
 const state=await fixture(page);
 state.data.total=25;state.data.stats.status={draft:24,pending_review:1,published:0,archived:0};
 state.data.stats.pending_review={count:1,max_wait_days:7};await page.reload();
 const strip=page.locator('[data-kbv-asset-strip]');
 await expect(strip.locator('[data-kb-status="pending"]')).toContainText('最长等待 7 天');
 for(const width of [1920,1440,1024,375,320]){
  await page.setViewportSize({width,height:900});
  await expect(strip.locator('[data-kb-status]')).toHaveCount(4);
  const fits=await strip.locator('[data-kb-status]').evaluateAll(nodes=>nodes.every(node=>{
   const box=node.getBoundingClientRect();return [...node.children].every(child=>{const b=child.getBoundingClientRect();return b.x>=box.x&&b.right<=box.right+1;});
  }));expect(fits,`${width}px status text remains inside its segment`).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'test-results/kb-asset-strip-readable-1440.png',fullPage:true});
});
