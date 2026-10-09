import { expect, test, type Page } from '@playwright/test';
async function surface(page:Page,status='pending_review') {
 const account={id:'admin',name:'管理员',available_modes:['admin','employee']};
 const bases=[{id:'structured',code:'legacy',name:'历史知识',kind:'structured',status:'active'},{id:'specs',name:'电池',kind:'unstructured',status:'active',family_id:'ipd',family_name:'产品与解决方案',domain_id:'battery',domain_name:'产品管理'}];
 const domains=[{id:'ipd',name:'产品与解决方案',level:'family'},{id:'battery',name:'产品管理',level:'domain',parent_id:'ipd'}];
 let rows:any[]=Array.from({length:24},(_,i)=>({id:`text-${i}`,title:`合作知识 ${i+1}`,body:'知识正文',kind:'policy',base_id:'structured',status:'draft',current_version:1,brand:'*',lang:'en',stage_codes:[],structured:{},created_by:'admin',updated_at:'2026-10-05T01:00:00Z'}));
 let doc:any={id:'pdf',base_id:'specs',title:'NETC 产品规格书',filename:'NETC.pdf',media_type:'pdf',size_bytes:2000,status,retry_count:0,created_by:'admin',created_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-05T02:00:00Z',error:status==='failed'?'索引服务不可用':''};
 let publication:any=null,failSave=false,failSubmit=false;const calls:string[]=[],errors:string[]=[];
 const definition={schema:'review.definition.v1',subjectType:'knowledge_publication',name:'知识发布审批',fields:[],nodes:[{id:'start',type:'start',next:'review'},{id:'review',name:'评审',type:'review',next:'end',mode:'single',reject:'any_reject',assignee:{kind:'named',userIds:['reviewer']}},{id:'end',type:'end'}]};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();let json:any=[];
  if(path==='/api/auth/status')json={authenticated:true,account};else if(path==='/api/me')json=account;else if(path==='/api/preferences')json={theme:'light'};else if(path==='/api/health')json={ok:true};else if(path==='/api/cron/jobs')json={jobs:[]};
  else if(path==='/api/knowledge')json=rows.map(row=>({...row,status:'published'}));
  else if(path==='/api/knowledge/taxonomy')json={domains,bases};
  else if(path==='/api/admin/knowledge/documents')json={documents:[doc]};
  else if(path==='/api/admin/knowledge/bases')json={bases};
  else if(path==='/api/admin/knowledge/domains')json={domains};
  else if(path==='/api/admin/knowledge/index-health')json={ok:true,mode:'test'};
  else if(path==='/api/admin/knowledge/workspace-v1'){
   // 服务端分页/过滤仿真（与后端 workspace.ts 同 shape）：page/page_size/base_id。
   const url=new URL(route.request().url());
   const page=Math.max(1,Number(url.searchParams.get('page')||1));
   const pageSize=Math.min(100,Math.max(1,Number(url.searchParams.get('page_size')||20)));
   const baseId=url.searchParams.get('base_id')||'';
   const all=[...rows,{...doc,kind:'document',asset_type:'document',family_id:'ipd',domain_id:'battery'}];
   const filtered=baseId?(baseId==='__none__'?all.filter(r=>!r.base_id):all.filter(r=>String(r.base_id||'')===baseId)):all;
   const pageCount=Math.max(1,Math.ceil(filtered.length/pageSize));
   const slice=filtered.slice((page-1)*pageSize,page*pageSize);
   const group=(key)=>{const values={};for(const r of all){const k=String(r[key]??'__none__');values[k]=(values[k]||0)+1;}return {all:all.length,values};};
   const brandValues={},unbranded=all.filter(r=>!r.brand||r.brand==='*').length;
   json={tenant:'company',bases,domains,rows:slice,total:filtered.length,page,page_size:pageSize,page_count:pageCount,
    facets:{view:group('status'),kind:group('kind'),brand:{all:all.length,values:brandValues,unbranded},stage:{all:all.length,values:{},empty:all.length},family:group('family_id'),domain:group('domain_id'),base:group('base_id')},
    stats:{status:{draft:24,pending_review:1,published:0,archived:0},pending_review:{count:0,max_wait_days:0},pending_documents:{count:1,max_wait_days:3},expiring:{count:0,nearest:null}}};
  }
  else if(path.startsWith('/api/admin/knowledge/workspace-v1/entries')){
   const id=path.split('/')[6],row=rows.find(r=>r.id===id);
   if(method==='GET')json={row,versions:[],grants:[],refs:[],actions:{edit:true,revision:false,delete:true,submit:true}};
   else if(method==='POST'||method==='PUT'){calls.push('save');if(failSave)return route.fulfill({status:422,json:{detail:{message:'请修正知识字段',issues:[{path:'title',message:'请填写标题'}]}}});const input=route.request().postDataJSON();const saved={...(row||rows[0]),...input,id:row?.id||'created'};rows=row?rows.map(r=>r.id===id?saved:r):[...rows,saved];json=saved;}
   else if(method==='DELETE'){calls.push('delete');rows=rows.filter(r=>r.id!==id);json={id:'delete-receipt'};}
  }
  else if(path.endsWith('/publication-v2/companies'))json=[{id:'company',name:'公司'}];
  else if(path.endsWith('/publication-v2'))json={tenant:'company',templates:[{id:'flow',version:1,definition}],publication,intake:{allowed:true,reason:''}};
  else if(path.endsWith('/publication-v2/check'))json={allowed:true,reason:'',reviewers:['评审人']};
  else if(path.endsWith('/publication-v2/prepare'))json={confirmationId:'confirm',summary:{name:doc.title,flow:'知识发布审批',version:1,reviewers:['评审人'],consequence:'审批通过后等待单独发布'}};
  else if(path.endsWith('/publication-v2/submit')){calls.push('submit');await new Promise(r=>setTimeout(r,120));if(failSubmit)return route.fulfill({status:409,json:{detail:{message:'材料已变化，请重新检查'}}});publication={tenant:'company',instanceId:'review-1',filename:doc.filename,fingerprint:'frozen-content-version',status:'waiting',reviewStatus:'reviewing',releaseMode:'manual',canPublish:false};json={id:'submit-receipt',instanceId:'review-1',tenant:'company'};}
  else if(path.endsWith('/publish/prepare'))json={confirmationId:'publish-confirm',title:doc.title};
  else if(path.endsWith('/publish/submit')){calls.push('publish');doc={...doc,status:'published'};publication={...publication,status:'published',canPublish:false,receipt:{id:'publish-receipt',status:'published'}};json={id:'publish-receipt'};}
  else if(path.endsWith('/scope'))json={revision:1,state:'checked',frozen:false,explanation:'产品规格与范围',scope:{summary:'NETC 规格',topics:[],entities:[],question_types:[],limitations:[],unverified_notes:[],coverage:{status:'complete',unreadable_pages:[]},evidence:[]},job:null,actions:{edit:true,generate:true,check:false}};
  else if(path==='/api/admin/knowledge/documents/pdf')json={document:doc,base:bases[1],jobs:[],actions:{edit:doc.status==='draft',start:doc.status==='draft',retry:['failed','cancelled'].includes(doc.status),cancel:['uploaded','indexing','normalizing'].includes(doc.status),revision:['pending_review','published','archived'].includes(doc.status)},text_preview:{text:'产品规格与范围'}};
  else if(path.endsWith('/retry')||path.endsWith('/cancel')){const action=path.split('/').at(-1)!;calls.push(action);doc={...doc,status:action==='retry'?'uploaded':'cancelled',error:''};json={document:doc};}
  await route.fulfill({json});
 });
 await page.goto('/admin/knowledge?reviewCompany=company');await expect(page.locator('[data-kbv-record]')).toHaveCount(20,{timeout:15000});
 return {calls,errors,failSave:()=>{failSave=true;},failSubmit:()=>{failSubmit=true;},approve:()=>{publication={...publication,reviewStatus:'approved',canPublish:true};}};
}
async function pdf(page:Page){await page.locator('[data-kb-scope-base="specs"]').click();await page.locator('[data-kbv-record="pdf"]').click();await expect(page.locator('[data-workspace-mode="detail"]')).toBeVisible();}
test('right rail lifecycle tabs preserve middle list and offer all first-level capabilities',async({page})=>{
 const s=await surface(page);
 await expect(page.locator('[data-knowledge-right] [role="tab"]')).toHaveCount(8);
 await expect(page.locator('[data-knowledge-middle] [role="tab"]')).toHaveCount(0);
 await expect(page.locator('[data-kbv-new]')).toHaveCount(0);
 await page.locator('[data-kbv-next]').click();
 for(const [id,label,target] of [
  ['catalog','知识目录','[data-admin-kb-catalog]'],['create','知识创作','[data-knowledge-creation]'],
  ['processing','知识加工','[data-admin-kb-documents]'],['pending-review','发布审批','[data-kb-queue="documents"]'],
  ['published','知识资产','[data-knowledge-assets]'],['bindings','查询技能','[data-admin-kb-bindings]'],
  ['lifecycle','生命周期','[data-kb-queue="expiry"]'],['graph','知识关系','[data-kb-knowledge-graph]']]) {
  await page.getByRole('tab',{name:label,exact:true}).click();
  await expect(page).toHaveURL(new RegExp('stage='+id));
  await expect(page.locator('[data-kbv-page]')).toHaveText('第 2 / 2 页');
  await expect(page.locator('[data-kbv-record="text-22"]')).toBeVisible();
  await expect(page.locator(target)).toBeVisible();
  await expect(page.locator('[data-knowledge-middle] [data-kbv-new], [data-knowledge-middle] [data-kbv-upload]')).toHaveCount(0);
 }
 expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
 await page.getByRole('tab',{name:'知识创作',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'知识加工',exact:true})).toBeFocused();
 await expect(page.getByRole('tab',{name:'知识加工',exact:true})).toHaveAttribute('aria-selected','true');
});
test('same viewport matches employee column tracks and internal gutters',async({page})=>{
 await surface(page);
 const measure=()=>page.evaluate(()=>{
  const box=(selector)=>{const el=document.querySelector(selector)!,b=el.getBoundingClientRect(),cs=getComputedStyle(el);return {x:b.x,width:b.width,padLeft:cs.paddingLeft,padRight:cs.paddingRight};};
  return {middle:box('.knowledge-browse .kbv-list'),right:box('.knowledge-browse .kbv-rail'),filter:box('.knowledge-filter-bar')};
 });
 for(const width of [1440,1920]){
  await page.setViewportSize({width,height:900});await page.goto('/kb');await expect(page.locator('.knowledge-filter-bar')).toBeVisible();const employee=await measure();
  await page.goto('/admin/knowledge?reviewCompany=company');await expect(page.locator('[data-knowledge-assets]')).toBeVisible();const admin=await measure();console.log('GEOMETRY',JSON.stringify({width,employee,admin}));
  for(const key of ['middle','right','filter'])for(const attr of ['x','width'])expect(Math.abs(admin[key][attr]-employee[key][attr]),`${width} ${key} ${attr}`).toBeLessThanOrEqual(1);
  expect(admin.filter.padLeft).toBe(employee.filter.padLeft);expect(admin.filter.padRight).toBe(employee.filter.padRight);
  const pad=await page.locator('.kbw-body').evaluate(el=>[getComputedStyle(el).paddingLeft,getComputedStyle(el).paddingRight]);expect(pad).toEqual([employee.filter.padLeft,employee.filter.padRight]);
 }
 await page.screenshot({path:'test-results/knowledge-governance-1920.png',fullPage:true});
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'test-results/knowledge-governance-1440.png',fullPage:true});
});
test('legacy governance routes resolve to the same right rail host',async({page})=>{
 const s=await surface(page);
 for(const [route,stage] of [['catalog','catalog'],['ingest','processing'],['bindings','bindings']]){
  await page.goto('/admin/knowledge/'+route+'?reviewCompany=company');await expect(page).toHaveURL(new RegExp('/admin/knowledge/'+route));
  await expect(page.locator('[data-knowledge-right]')).toHaveAttribute('data-kb-active-stage',stage);
  await page.reload();await expect(page).toHaveURL(new RegExp('/admin/knowledge/'+route));
  await expect(page.locator('[data-knowledge-middle]')).toBeVisible();await expect(page.locator('[data-knowledge-right] [role="tab"]')).toHaveCount(8);
 }
 expect(s.errors).toEqual([]);
});
test('list/detail/editor replace in place and restore page and selection',async({page})=>{
 const s=await surface(page);await page.locator('[data-kbv-next]').click();await page.locator('[data-kbv-record="text-22"]').click();await expect(page.locator('[data-kbv-list]')).toBeVisible();await expect(page.getByRole('heading',{name:'合作知识 23',exact:true})).toBeVisible();await page.getByRole('button',{name:'修订',exact:true}).click();await page.locator('input[name="title"]').fill('修订后的标题');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('修订后的标题');await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-kbv-page]')).toHaveText('第 2 / 2 页');await expect(page.locator('[data-kbv-record="text-22"]')).toHaveAttribute('aria-current','true');expect(s.calls).toEqual(['save']);expect(s.errors).toEqual([]);
});
test('create preserves taxonomy and save is independent from approval',async({page})=>{
 const s=await surface(page);await page.getByRole('tab',{name:/知识创作/}).click();await page.locator('[data-kb-scope-base="specs"]').click();await page.goto('/admin/knowledge?reviewCompany=company&stage=create&mode=create');await page.locator('input[name="title"]').fill('新的结构化知识');await page.locator('textarea[name="body"]').fill('草稿内容');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('新的结构化知识');await expect(page.locator('[data-kb-scope-base="specs"]')).toHaveAttribute('aria-pressed','true');expect(s.calls).toEqual(['save']);
});
test('validation preserves fields and unsaved exit can be cancelled',async({page})=>{
 const s=await surface(page);await page.goto('/admin/knowledge?reviewCompany=company&stage=create&mode=create');await page.locator('textarea[name="body"]').fill('保留这段正文');s.failSave();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert')).toContainText('请修正知识字段');await expect(page.locator('input[name="title"]')).toBeFocused();await expect(page.locator('textarea[name="body"]')).toHaveValue('保留这段正文');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-workspace-mode="create"]')).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-workspace-mode="list"]')).toBeVisible();
});
test('approval is confirmed once and approved waits for separate publication',async({page})=>{
 const s=await surface(page);await pdf(page);await page.getByRole('button',{name:'提交审批',exact:true}).click();await expect(page.locator('[data-workspace-mode="review"]')).toBeVisible();await page.locator('.kbv-release-note textarea').fill('规格更新');await expect(page.locator('[data-kbv-doc-action="submit"]')).toBeEnabled();await page.locator('[data-kbv-doc-action="submit"]').click();expect(s.calls).toEqual([]);await page.getByRole('button',{name:'确认提交审批',exact:true}).dblclick();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('审批中');s.approve();await expect(page.getByRole('button',{name:'发布',exact:true})).toBeVisible({timeout:10000});await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('审批通过 · 等待发布');expect(s.calls).toEqual(['submit']);await page.getByRole('button',{name:'发布',exact:true}).click();await page.getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('publish-receipt');expect(s.calls).toEqual(['submit','publish']);expect(s.errors).toEqual([]);
});
test('submit failure retains form and never reports success',async({page})=>{
 const s=await surface(page);s.failSubmit();await pdf(page);await page.getByRole('button',{name:'提交审批',exact:true}).click();await page.locator('.kbv-release-note textarea').fill('不能丢失的说明');await expect(page.locator('[data-kbv-doc-action="submit"]')).toBeEnabled();await page.locator('[data-kbv-doc-action="submit"]').click();await page.getByRole('button',{name:'确认提交审批',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('材料已变化');await expect(page.locator('.kbv-release-note textarea')).toHaveValue('不能丢失的说明');await expect(page.locator('[data-admin-receipt]')).toHaveCount(0);
});
test('processing retry and cancel remain independent actions',async({page})=>{
 const s=await surface(page,'failed');await pdf(page);await expect(page.getByRole('alert')).toContainText('索引服务不可用');await page.locator('[data-kbv-doc-action="retry"]').dblclick();await expect(page.locator('[data-kbv-doc-action="cancel"]')).toBeVisible();await page.locator('[data-kbv-doc-action="cancel"]').click();await expect(page.locator('[data-kbv-doc-action="retry"]')).toBeVisible();expect(s.calls).toEqual(['retry','cancel']);
});
test('flat work area fits desktop and compact viewport with fixed footer',async({page})=>{
 await surface(page);await pdf(page);const area=page.locator('.kbw-workarea'),body=page.locator('.kbw-body'),footer=page.locator('.kbw-action-bar');await expect(footer).toBeVisible();const filter=await page.locator('[data-kbv-filter-pane]').boundingBox();expect(filter!.width).toBeGreaterThanOrEqual(400);const right=await area.boundingBox();expect(Math.abs(filter!.width-right!.width)).toBeLessThanOrEqual(1);const a=await area.boundingBox(),b=await body.boundingBox(),f=await footer.boundingBox();expect(b!.y+b!.height).toBeLessThanOrEqual(f!.y+1);expect(f!.y+f!.height).toBeLessThanOrEqual(a!.y+a!.height+1);await page.screenshot({path:'test-results/knowledge-workspace-desktop.png',fullPage:true});await page.setViewportSize({width:1024,height:600});await expect(page.getByRole('link',{name:/查看 PDF 原件/})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('browser back cancellation keeps unsaved editor mounted',async({page})=>{
 await surface(page);await page.locator('[data-kbv-record="text-0"]').click();await page.getByRole('button',{name:'修订',exact:true}).click();await page.locator('textarea[name="body"]').fill('浏览器返回也不能丢失');page.once('dialog',d=>d.dismiss());await page.goBack();await expect(page.locator('[data-workspace-mode="edit"]')).toBeVisible();await expect(page.locator('textarea[name="body"]')).toHaveValue('浏览器返回也不能丢失');
});
test('draft deletion confirms knowledge and version and returns to list',async({page})=>{
 const s=await surface(page);await page.locator('[data-kbv-record="text-0"]').click();await page.getByRole('button',{name:'删除草稿',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('合作知识 1 · v1');await page.getByRole('dialog').getByRole('button',{name:'删除草稿',exact:true}).click();await expect(page.locator('[data-workspace-mode="list"]')).toBeVisible();await expect(page.locator('[data-kbv-record="text-0"]')).toHaveCount(0);expect(s.calls).toEqual(['delete']);
});

test('same viewport keeps at most one filled primary action',async({page})=>{
 const s=await surface(page);
 const filled=()=>page.evaluate(()=>{
  const probe=document.createElement('div');
  probe.style.color=getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  document.body.appendChild(probe);
  const rgb=getComputedStyle(probe).color;probe.remove();
  return [...document.querySelectorAll('.kbw-workarea *')].filter((node)=>{
   const el=node as HTMLElement,cs=getComputedStyle(el);
   return cs.backgroundColor===rgb&&cs.visibility!=='hidden'&&el.getBoundingClientRect().width>0;
  }).length;
 });
 // 列表态（含治理驾驶舱）：没有实底主行动。
 expect(await filled(),'列表态').toBeLessThanOrEqual(1);
 await pdf(page);
 // 资料详情：解析/提交/发布三类动作里只有当前可推进的那一个是实底（本页 L1 取 §3 的品牌主色档）。
 // 资料详情：提交审批是唯一实底，且取 §3 的品牌主色档（filled() 按 --primary 计色，等于同时断言了颜色）。
 // 审批面板依赖范围面板就绪后异步挂载，故用轮询等待动作条稳定，而不是瞬时取数。
 await expect.poll(filled, { message: "资料详情实底主 CTA", timeout: 10000 }).toBe(1);
 await page.getByRole('button',{name:'提交审批',exact:true}).first().click();
 await expect(page.locator('[data-workspace-mode="review"]')).toBeVisible();
 expect(await filled(),'发起审批态').toBeLessThanOrEqual(1);
 expect(s.errors).toEqual([]);
});

test('new middle uses title-kind rows and the shared editable stage dictionary',async({page})=>{
 const s=await surface(page);
 const middle=page.locator('[data-knowledge-middle]'),stages=middle.locator('[data-kb-filter="stage"]');
 await expect(stages.locator('[data-kb-filter-value]')).toHaveCount(10);
 await expect(middle.locator('[data-kbv-record="text-0"] .knowledge-row-title')).toHaveText('合作知识 1');
 await expect(middle.locator('[data-kbv-record="text-0"] .knowledge-row-kind')).toHaveText('口径');
 await expect(middle.locator('.knowledge-row-metadata, .knowledge-row-actions')).toHaveCount(0);
 const first=await middle.locator('[data-kbv-record-wrap]').nth(0).boundingBox(),second=await middle.locator('[data-kbv-record-wrap]').nth(1).boundingBox();expect(first!.height).toBe(36);expect(second!.y-first!.y).toBe(36);
 await stages.getByRole('button',{name:'移除阶段：初步接触',exact:true}).click();
 await expect(stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]')).toHaveCount(0);
 await stages.getByRole('button',{name:'添加阶段',exact:true}).click();
 await stages.getByRole('group',{name:'可添加阶段'}).getByRole('button',{name:'初步接触',exact:true}).click();
 await expect(stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('tab',{name:'知识创作',exact:true}).click();
 await expect(stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]')).toHaveAttribute('aria-pressed','true');
  expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});

test('creation surface removes redundant controls and keeps one working draft action',async({page})=>{
 const s=await surface(page);
 await page.getByRole('tab',{name:'知识创作',exact:true}).click();
 const creation=page.locator('[data-knowledge-creation]');
 await expect(creation).toBeVisible();
 await page.screenshot({path:process.env.KNOWLEDGE_CREATION_SCREENSHOT || 'test-results/knowledge-creation-desktop.png',fullPage:true});
 await expect(creation.getByRole('heading',{name:'知识创作',exact:true})).toHaveCount(0);
 await expect(creation.locator('[data-kbv-upload], [data-kbv-new]')).toHaveCount(0);
 await expect(creation.locator('button')).toHaveCount(1);
 await expect(creation.locator('.knowledge-panel-help')).toHaveText('新建在线知识或上传资料，保存草稿后继续加工、审批与发布。');
 const draft=creation.getByRole('button',{name:'查看草稿',exact:true});
 await expect(draft).toBeVisible();
 const request=page.waitForRequest(req=>{
  const url=new URL(req.url());
  return url.pathname==='/api/admin/knowledge/workspace-v1' && url.searchParams.get('view')==='draft';
 });
 await draft.click();await request;
 await expect(page).toHaveURL(/view=draft/);
 await expect(page.locator('[data-knowledge-right]')).toHaveAttribute('data-kb-active-stage','create');
 await expect(page.locator('[data-kbv-filter-note]')).toContainText('当前查看：草稿');
 await expect(page.locator('[data-kb-lifecycle-tabs] [role="tab"]')).toHaveCount(5);
 await page.getByRole('tab',{name:'知识加工',exact:true}).click();
 await expect(page.locator('[data-admin-kb-documents]')).toBeVisible();
 await page.getByRole('tab',{name:'知识创作',exact:true}).click();
 await expect(draft).toBeVisible();
 expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});

test('creation surface fits compact widths and upload deep link is retained',async({page})=>{
 const s=await surface(page);
 await page.getByRole('tab',{name:'知识创作',exact:true}).click();
 for(const width of [1440,1024,768,375]){
  await page.setViewportSize({width,height:800});
  const draft=page.locator('[data-knowledge-creation]').getByRole('button',{name:'查看草稿',exact:true});
  await expect(draft).toBeVisible();
  const box=await draft.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/knowledge-creation-${width}.png`,fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/admin/knowledge?reviewCompany=company&stage=create&mode=upload');
 await expect(page.locator('[data-workspace-mode="upload"]')).toBeVisible();
 await expect(page.locator('input[type="file"]')).toHaveCount(1);
 await page.getByRole('button',{name:'← 返回列表',exact:true}).click();
 await expect(page.locator('[data-knowledge-creation]').getByRole('button',{name:'查看草稿',exact:true})).toBeVisible();
 expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});
