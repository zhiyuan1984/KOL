import { expect, test, type Page } from '@playwright/test';
async function surface(page:Page,status='pending_review') {
 const account={id:'admin',name:'管理员',available_modes:['admin','employee']};
 const bases=[{id:'structured',code:'legacy',name:'历史知识',kind:'structured',status:'active'},{id:'specs',name:'产品规格',kind:'unstructured',status:'active',family_id:'ipd',family_name:'IPD',domain_id:'battery',domain_name:'电池'}];
 const domains=[{id:'ipd',name:'IPD',level:'family'},{id:'battery',name:'电池',level:'domain',parent_id:'ipd'}];
 let rows:any[]=Array.from({length:24},(_,i)=>({id:`text-${i}`,title:`合作知识 ${i+1}`,body:'知识正文',kind:'policy',base_id:'structured',status:'draft',current_version:1,brand:'*',lang:'en',stage_codes:[],structured:{},created_by:'admin',updated_at:'2026-10-05T01:00:00Z'}));
 let doc:any={id:'pdf',base_id:'specs',title:'NETC 产品规格书',filename:'NETC.pdf',media_type:'pdf',size_bytes:2000,status,retry_count:0,created_by:'admin',created_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-05T02:00:00Z',error:status==='failed'?'索引服务不可用':''};
 let publication:any=null,failSave=false,failSubmit=false;const calls:string[]=[],errors:string[]=[];
 const definition={schema:'review.definition.v1',subjectType:'knowledge_publication',name:'知识发布审批',fields:[],nodes:[{id:'start',type:'start',next:'review'},{id:'review',name:'评审',type:'review',next:'end',mode:'single',reject:'any_reject',assignee:{kind:'named',userIds:['reviewer']}},{id:'end',type:'end'}]};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();let json:any=[];
  if(path==='/api/auth/status')json={authenticated:true,account};else if(path==='/api/me')json=account;else if(path==='/api/preferences')json={theme:'light'};else if(path==='/api/health')json={ok:true};else if(path==='/api/cron/jobs')json={jobs:[]};
  else if(path==='/api/admin/knowledge/workspace-v1')json={tenant:'company',bases,domains,rows:[...rows,{...doc,kind:'document',asset_type:'document',family_id:'ipd',domain_id:'battery'}]};
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
test('list/detail/editor replace in place and restore page and selection',async({page})=>{
 const s=await surface(page);await page.locator('[data-kbv-next]').click();await page.locator('[data-kbv-record="text-22"]').click();await expect(page.locator('[data-kbv-list]')).toHaveCount(0);await expect(page.getByRole('heading',{name:'合作知识 23',exact:true})).toBeVisible();await page.getByRole('button',{name:'修订',exact:true}).click();await page.locator('input[name="title"]').fill('修订后的标题');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('修订后的标题');await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-kbv-page]')).toHaveText('第 2 / 2 页');await expect(page.locator('[data-kbv-record="text-22"]')).toHaveAttribute('aria-current','true');expect(s.calls).toEqual(['save']);expect(s.errors).toEqual([]);
});
test('create preserves taxonomy and save is independent from approval',async({page})=>{
 const s=await surface(page);await page.locator('[data-kb-scope-base="specs"]').click();await page.locator('[data-kbv-new]').click();await page.locator('input[name="title"]').fill('新的结构化知识');await page.locator('textarea[name="body"]').fill('草稿内容');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('[data-workspace-mode="detail"]')).toContainText('新的结构化知识');await expect(page.locator('[data-kb-scope-base="specs"]')).toHaveAttribute('aria-pressed','true');expect(s.calls).toEqual(['save']);
});
test('validation preserves fields and unsaved exit can be cancelled',async({page})=>{
 const s=await surface(page);await page.locator('[data-kbv-new]').click();await page.locator('textarea[name="body"]').fill('保留这段正文');s.failSave();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('alert')).toContainText('请修正知识字段');await expect(page.locator('input[name="title"]')).toBeFocused();await expect(page.locator('textarea[name="body"]')).toHaveValue('保留这段正文');page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-workspace-mode="create"]')).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'← 返回列表',exact:true}).click();await expect(page.locator('[data-workspace-mode="list"]')).toBeVisible();
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
 await surface(page);await pdf(page);const area=page.locator('.kbw-workarea'),body=page.locator('.kbw-body'),footer=page.locator('.kbw-action-bar');await expect(footer).toBeVisible();const filter=await page.locator('[data-kbv-filter-pane]').boundingBox();expect(filter!.width).toBeGreaterThanOrEqual(220);expect(filter!.width).toBeLessThanOrEqual(260);const a=await area.boundingBox(),b=await body.boundingBox(),f=await footer.boundingBox();expect(b!.y+b!.height).toBeLessThanOrEqual(f!.y+1);expect(f!.y+f!.height).toBeLessThanOrEqual(a!.y+a!.height+1);await page.screenshot({path:'test-results/knowledge-workspace-desktop.png',fullPage:true});await page.setViewportSize({width:1024,height:600});await expect(page.getByRole('link',{name:/查看 PDF 原件/})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
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
