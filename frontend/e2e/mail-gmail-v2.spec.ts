import { expect, test, type Page, type Route } from '@playwright/test';

const BOX='fixture@example.com';
const CONV={id:'fixture-thread',conversation_id:'fixture-c',mailbox:BOX,subject:'Autumn campaign fixture',peer_email:'peer@example.com',peer_name:'测试联系人',last_at:'2026-10-12T00:00:00Z',last_direction:'inbound',unread_count:1,message_count:1};
const MESSAGE={id:'fixture-m',conversation_id:CONV.conversation_id,subject:CONV.subject,body_text:'A UI fixture: please confirm the autumn campaign schedule.',direction:'inbound',occurred_at:CONV.last_at,from_addr:CONV.peer_email,to_addr:BOX,memory_fingerprint:'fixture-fp',translation_source:'pending',body_status:'ready'};
type Override=(route:Route)=>Promise<void>;
async function fixture(page:Page, overrides:Record<string,Override>={}) {
 const posts:string[]=[];const reads:string[]=[];
 await page.route('**/api/**',async route=>{
  const request=route.request();const url=new URL(request.url());if(request.method()==='POST')posts.push(url.pathname);if(url.pathname==='/api/queries/mail.conversation')reads.push(url.pathname);
  if(overrides[url.pathname])return overrides[url.pathname](route);
  let data:unknown=[];
  if(url.pathname==='/api/auth/status')data={authenticated:true,account:{id:'fixture-user',name:'测试员工',available_modes:['business']}};
  else if(url.pathname==='/api/me')data={id:'fixture-user',name:'测试员工',available_modes:['business']};
  else if(url.pathname==='/api/queries/mail.box')data={mailbox:BOX,bound:true,unread:1,bindings:[{mailbox:BOX,bound:true}],synced_at:CONV.last_at};
  else if(url.pathname==='/api/queries/mail.conversations')data={conversations:[CONV,{...CONV,id:'second-thread',conversation_id:'second-c',subject:'Second fixture'}]};
  else if(url.pathname==='/api/queries/mail.conversation')data={conversation:CONV,messages:[MESSAGE]};
  else if(url.pathname==='/api/queries/mail.labels')data={mailbox:BOX,labels:[],assignments:[],selected_label_ids:[],version:0};
  else if(url.pathname==='/api/queries/mail.person')data={mailbox:BOX,peer_email:CONV.peer_email,digest_text:'Stored fixture summary'};
  else if(url.pathname==='/api/preferences')data={};
  else if(url.pathname==='/api/actions/mail.prepare')data={status:'needs_context',editor:{from:BOX,to:[CONV.peer_email],subject:CONV.subject,body:''},candidates:[],missing_fields:[]};
  else if(url.pathname==='/api/cron')data={jobs:[],alerts:{}};
  else if(url.pathname==='/api/tasks/from-text')data={task:{id:'fixture-task',title:'测试邮件任务',task_type:'mail_summary'}};
  else if(url.pathname==='/api/tasks/fixture-task/run')data={session_id:'fixture-session'};
  await route.fulfill({json:data});
 });return {posts,reads};
}
async function open(page:Page){await page.goto(`/mail?box=${encodeURIComponent(BOX)}&c=${CONV.conversation_id}`);await expect(page.locator('[data-composer-input]')).toBeVisible();}
async function labels(page:Page){await page.locator('[data-mail-label-picker]').click();await expect(page.locator('[data-mail-label-search]')).toBeVisible();}

test('完整单 Composer 和 Gmail SVG：建议仅填草稿，发送才统一 intake',async({page})=>{
 let payload:Record<string,unknown>={};const {posts,reads}=await fixture(page,{'/api/tasks/from-text':async r=>{payload=r.request().postDataJSON();await r.fulfill({json:{task:{id:'fixture-task',title:'测试摘要',task_type:'mail_summary'}}});}});
 await open(page);await expect(page.locator('[data-composer-input]')).toHaveCount(1);await expect(page.locator('.mi-airow,.mi-aichips,[data-mi-dockfloat]')).toHaveCount(0);
 await expect(page.locator('[data-mi-compose] svg.mail-icon-compose')).toHaveCount(1);await expect(page.locator('[data-mail-list-star] svg.mail-icon-star').first()).toBeVisible();
 await page.locator('details[data-composer-task-menu] summary').click();await page.locator('[data-ai-next="mail_summary"]').click();
 expect(posts.filter(p=>p.includes('/tasks/'))).toHaveLength(0);await expect(page.locator('[data-composer-input]')).toHaveValue(/请总结/);
 await page.locator('[data-send]').click();await expect(page).toHaveURL(/\/s\/fixture-session/);
 expect(payload.intent).toBe('mail_summary');expect((payload.entities as Record<string,unknown>).mailbox).toBe(BOX);expect((payload.entities as Record<string,unknown>).body_fingerprint).toBe('fixture-fp');expect(String(payload.text)).toContain(MESSAGE.body_text);expect(reads.length).toBe(1);
});

test('本地读取超过5秒显示具体状态，8秒截止后可重试且只有一个请求',async({page})=>{
 let calls=0;await fixture(page,{'/api/queries/mail.conversation':async r=>{calls++;if(calls===1){await new Promise(resolve=>setTimeout(resolve,12000));await r.fulfill({json:{conversation:CONV,messages:[MESSAGE]}}).catch(()=>{});}else await r.fulfill({json:{conversation:CONV,messages:[MESSAGE]}});}});
 await open(page);await expect(page.getByText(/本地读取超过5秒/).first()).toBeVisible({timeout:6500});await expect(page.locator('[data-mail-read-retry]').first()).toBeVisible({timeout:5500});expect(calls).toBe(1);
 await page.locator('[data-mail-read-retry]').first().click();await expect(page.locator('[data-mail-timeline-item]').first()).toBeVisible();expect(calls).toBe(2);
});

test('原文ready且翻译pending不会轮询原文：持续可读、零AI调用',async({page})=>{
 const {posts,reads}=await fixture(page);await open(page);await expect(page.locator('[data-mail-timeline-item]').first()).toBeVisible();await page.locator('[data-mail-timeline-item]').first().click();await expect(page.locator('[data-mail-body]')).toContainText(MESSAGE.body_text);await page.waitForTimeout(4400);expect(reads.length).toBe(1);expect(posts.filter(p=>p.includes('/tasks/')||p.includes('label-suggestions'))).toHaveLength(0);
});

test('空字典通过真实接口契约候选后独立确认，只提交receipt不可手写创建',async({page})=>{
 let saved=false;let mutation:Record<string,unknown>={};const snapshot=()=>({mailbox:BOX,labels:saved?[{id:'new-label',name:'待确认档期',count:1}]:[],assignments:saved?[{conversation_id:CONV.conversation_id,label_ids:['new-label']}]:[],selected_label_ids:saved?['new-label']:[],version:saved?1:0});
 const {posts}=await fixture(page,{'/api/queries/mail.labels':async r=>{await r.fulfill({json:snapshot()});},'/api/actions/mail.label-suggestions':async r=>{await r.fulfill({json:{status:'completed',source:'codex',mailbox:BOX,conversation_id:CONV.conversation_id,receipt_id:'receipt-fixture',label_state_version:0,suggestions:[{id:'candidate-fixture',label_id:null,name:'待确认档期',reason:'测试原文提及确认档期',source_fingerprint:'fixture-fp',mailbox:BOX,conversation_id:CONV.conversation_id}]}});},'/api/actions/mail.label':async r=>{mutation=r.request().postDataJSON();saved=true;await r.fulfill({json:{...snapshot(),ok:true,conversation_id:CONV.conversation_id,label_ids:['new-label']}});}});
 await open(page);await labels(page);await expect(page.locator('input[data-mail-label-input],datalist')).toHaveCount(0);await page.locator('[data-mail-label-search]').fill('不应创建');expect(posts.filter(p=>p==='/api/actions/mail.label')).toHaveLength(0);
 await page.locator('[data-mail-label-recommend]').click();await expect(page.locator('[data-mail-label-candidate]')).toBeVisible();expect(saved).toBe(false);
 await page.locator('[data-mail-label-candidate]').click();expect(saved).toBe(false);await page.locator('[data-mail-label-confirm]').click();await expect(page.locator('[data-mail-saved-label="new-label"]')).toBeVisible();expect(mutation).toMatchObject({candidate_receipt_id:'receipt-fixture',candidate_id:'candidate-fixture',expected_version:0,confirm:true});expect(mutation.name).toBeUndefined();
 await page.reload();await expect(page.locator('[data-mail-saved-label="new-label"]')).toBeVisible();
});

test('切换会话不呈现旧推荐候选，旧回执不可保存到新对象',async({page})=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);const {posts}=await fixture(page,{'/api/actions/mail.label-suggestions':async r=>{await wait;await r.fulfill({json:{status:'completed',source:'codex',mailbox:BOX,conversation_id:CONV.conversation_id,receipt_id:'old-receipt',suggestions:[{id:'old-candidate',label_id:null,name:'旧对象候选',reason:'旧对象',mailbox:BOX,conversation_id:CONV.conversation_id}]}}).catch(()=>{});}});
 await open(page);await labels(page);await page.locator('[data-mail-label-recommend]').click();await page.locator('[data-mail-thread-row="second-c"]').click();release();await expect(page.locator('[data-mail-label-candidate]')).toHaveCount(0);expect(posts.filter(p=>p==='/api/actions/mail.label')).toHaveLength(0);
});

test('草稿与附件按邮箱会话恢复，提交失败不清空附件',async({page})=>{
 await fixture(page,{'/api/tasks/from-text':async r=>{await r.fulfill({status:503,json:{detail:'fixture failure'}});}});
 await page.addInitScript(()=>{sessionStorage.setItem('mail-draft:v2:fixture-user:fixture%40example.com:fixture-c',JSON.stringify({text:'仅此会话草稿',attachments:[{name:'fixture.txt',path:'fixture-upload',size:12,type:'text/plain'}],chips:[],model_tier:'quality'}));});
 await open(page);await expect(page.locator('[data-composer-input]')).toHaveValue('仅此会话草稿');await expect(page.getByText('fixture.txt').first()).toBeVisible();await page.locator('[data-send]').click();await expect(page.locator('[data-mail-error]')).toBeVisible();await expect(page.getByText('fixture.txt').first()).toBeVisible();await expect(page.locator('[data-composer-input]')).toHaveValue('仅此会话草稿');
});

for(const viewport of [{width:1280,height:400},{width:768,height:1024},{width:375,height:667}])test(`短高与窄宽 ${viewport.width}x${viewport.height} 单输入、写信及发送真实可达`,async({page})=>{
 await page.setViewportSize(viewport);await fixture(page);await open(page);if(viewport.width<=1100)await page.locator('[data-mail-pane="detail"]').click();await page.locator('[data-mi-compose]').click();await expect(page.locator('[data-mail-compose-subject]')).toBeVisible();const send=page.locator('[data-send]');await send.scrollIntoViewIfNeeded();await expect(send).toBeVisible();const rect=await send.boundingBox();expect(rect && rect.y>=0 && rect.y+rect.height<=viewport.height+1).toBeTruthy();await expect(page.locator('[data-composer-input]')).toHaveCount(1);await page.screenshot({path:test.info().outputPath(`gmail-${viewport.width}x${viewport.height}.png`)});
});

test('缺原文与摘要显示诚实空态，不把0/0或未执行的摘要冒充就绪',async({page})=>{
 const {posts}=await fixture(page,{'/api/queries/mail.conversation':async r=>{await r.fulfill({json:{conversation:CONV,messages:[]}});},'/api/queries/mail.person':async r=>{await r.fulfill({json:{mailbox:BOX,peer_email:CONV.peer_email,digest_text:''}});}});
 await open(page);await expect(page.locator('[data-mail-summary-pending]')).toContainText('尚未生成摘要');await expect(page.locator('[data-mi-aibar]')).toContainText('原文尚未同步');await expect(page.locator('[data-mi-aibar]')).not.toContainText('0/0');expect(posts).toHaveLength(0);
});
