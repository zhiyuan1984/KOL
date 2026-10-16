import {test,expect,type Page} from '@playwright/test';
import {agentBrowse} from '../../backend/src/agents/organization-browse';
async function surface(page:Page, mixed=false, theme='light',owned=false,manyDepartments=false,retiredSkill=false){
 const account={id:'admin',name:'管理员',available_modes:['admin','employee']};
 const skill={id:'skill-one',label:'知识分析',summary:'根据资料形成分析',category:'知识',release_hash:'abcdef0123456789',published:true,document_query:false,risk:'R1',knowledge_revision:null,knowledge_ready:true,resources:[],execution:'skill'};
 const coverage={agent_id:'agent-0',org_version:7,user_ids:['employee'],person_refs:['person-employee'],users:[{user_id:'employee',person_ref:'person-employee',display_name:'员工',via:'unit_member',via_unit_id:'dept',via_unit_display_name:'部门'}]};
 const bindings=[{id:'binding',company_id:'company',agent_id:'agent-0',target_type:'organization_unit',target_id:'dept',status:'active',created_at:'2026-10-12T01:00:00Z'}];
 const directory={units:[{id:'root',company_id:'company',display_name:'产品中心',level:1,parent_id:'company',status:'active',org_version:7},{id:'dept',company_id:'company',display_name:'产品管理',level:2,parent_id:'root',status:'active',org_version:7},{id:'team',company_id:'company',display_name:'产品咨询组',level:3,parent_id:'dept',status:'active',org_version:7},{id:'root-other',company_id:'company',display_name:'增长中心',level:1,parent_id:'company',status:'active',org_version:7},{id:'dept-other',company_id:'company',display_name:'推广部',level:2,parent_id:'root-other',status:'active',org_version:7}],versions:{company:7},selectable_ids:['root','dept','team','root-other','dept-other']};
 const assignment=(id:string)=>({id:'owner-'+id,company_id:'company',org_unit_id:id,path:id==='team'?directory.units.slice(0,3):[directory.units[3],directory.units[4]],valid:true,issues:[],assigned_at:'2026-10-12T01:00:00Z',assigned_by:'admin'});
 if(manyDepartments)for(let i=0;i<9;i++){directory.units.push({id:`extra-${i}`,company_id:'company',display_name:`扩展组 ${i}`,level:3,parent_id:'dept',status:'active',org_version:7});directory.selectable_ids.push(`extra-${i}`);}
 let agents:any[]=Array.from({length:24},(_,i)=>({id:`agent-${i}`,name:`岗位 ${i+1}`,description:`职责 ${i+1}`,status:'published',version:1,published_revision:1,created_at:'2026-10-12T01:00:00Z',updated_at:'2026-10-12T01:00:00Z',effective:{name:`岗位 ${i+1}`,description:`职责 ${i+1}`,skills:[{skill_id:skill.id,release_hash:skill.release_hash,knowledge_revision:null}]},draft:null,actions:{edit:true,publish:false,disable:true,enable:false},bindings,coverage,organization:{revision:0,assignment:owned&&i<12?assignment(i<8?'team':'dept-other'):null,system:false},organization_history:[],governance_basis:'basis-0'}));
 if(mixed)agents=agents.map((row,i)=>({...row,status:i<4?'draft':i<8?'disabled':'published',published_revision:i<4?null:1,bindings:i%2?bindings:[],draft:i%3===0?{...row.effective,revision:1,updated_at:row.updated_at,updated_by:'admin'}:null}));
 if(retiredSkill)agents[0].effective.skills.push({skill_id:'sop_content_planning',release_hash:'legacy-release',knowledge_revision:null});
 let failSave=false,failRelease=false,failOrganization=false,blocked=false;let ownerCheck:any=null;const calls:string[]=[],errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,method=route.request().method();let json:any=[];
  if(path==='/api/auth/status')json={authenticated:true,account};else if(path==='/api/me')json=account;else if(path==='/api/preferences')json={theme};else if(path==='/api/health')json={ok:true};else if(path==='/api/cron/jobs')json={jobs:[]};
  else if(path==='/api/admin/agents/workspace-v1')json={agents,browse:agentBrowse(agents,directory.units,Object.fromEntries(new URL(route.request().url()).searchParams)),organization_directory:directory,skills:[skill],units:[{id:'dept',company_id:'company',display_name:'部门',level:2,parent_id:null,status:'active'}],people:[{person_ref:'person-employee',display_name:'员工',user_id:'employee',company_id:'company',unit_ids:['dept']}]};
  else if(path.endsWith('/organization-preview-v1')){calls.push('owner-preview');const row=agents.find(value=>value.id===path.split('/')[4]),input=route.request().postDataJSON();if(input.expected_revision!==row.organization.revision)return route.fulfill({status:409,json:{detail:'归属版本已变化，请重新读取'}});ownerCheck={preparation_id:'owner-preparation',expires_at:'2099-10-12T00:00:00Z',revision:row.organization.revision,org_version:7,before:row.organization.assignment,after:input.org_unit_id?assignment(input.org_unit_id):null};json=ownerCheck;}
  else if(path.endsWith('/organization-v1')){calls.push('owner-change');const row=agents.find(value=>value.id===path.split('/')[4]);if(failOrganization||ownerCheck.revision!==row.organization.revision)return route.fulfill({status:409,json:{detail:'部门关系已变化，请重新预览'}});expect(route.request().postDataJSON()).toMatchObject({preparation_id:ownerCheck.preparation_id,confirmed:true,reason:'岗位调动'});json={id:'owner-receipt',agent_id:row.id,revision:row.organization.revision+1,actor:'admin',changed_at:'2026-10-12T03:00:00Z',before:ownerCheck.before,after:ownerCheck.after,reason:'岗位调动'};row.organization={...row.organization,revision:json.revision,assignment:json.after};row.organization_history.unshift(json);}
  else if(path==='/api/admin/agents/draft-v1'||/^\/api\/admin\/agents\/[^/]+\/draft-v1$/.test(path)){
   calls.push('save');if(failSave)return route.fulfill({status:409,json:{detail:'草稿已被其他人修改'}});const input=route.request().postDataJSON();if(input.skill_ids.some((id:string)=>id!==skill.id))return route.fulfill({status:400,json:{detail:'技能不存在'}});const id=path.split('/')[4],row=agents.find(value=>value.id===id),draft={name:input.name,description:input.description,skills:input.skill_ids.map((id:string)=>({skill_id:id,release_hash:skill.release_hash,knowledge_revision:null})),governance:input.governance,revision:(row?.draft?.revision||0)+1,updated_at:'2026-10-12T02:00:00Z',updated_by:'admin'};
   const next=row?{...row,draft}:{...agents[0],id:'created',name:input.name,description:input.description,status:'draft',published_revision:null,draft,effective:{name:input.name,description:input.description,skills:[]},bindings:[],coverage:{...coverage,users:[],user_ids:[]}};agents=row?agents.map(value=>value.id===id?next:value):[...agents,next];json=next;
  }
  else if(path.endsWith('/workspace-v1')){const row=agents.find(value=>value.id===path.split('/')[4]);json={...row,versions:[{...row.effective,version:1,published_at:row.updated_at,published_by:'admin',receipt_id:'previous-receipt'}],exam_blocked:[],dependency_issues:[],health_evidence:'configuration_only'};}
  else if(path.endsWith('/prepare-release-v1')){calls.push('prepare');const row=agents.find(value=>value.id===path.split('/')[4]),gov=row.draft.governance,owner=gov?.organization?assignment(gov.organization.org_unit_id):null,key=(target:any)=>`${target.target_type}:${target.target_id}`;
   const added=(gov?.bindings||row.bindings).filter((target:any)=>!row.bindings.some((before:any)=>key(before)===key(target))),removed=row.bindings.filter((before:any)=>!(gov?.bindings||row.bindings).some((target:any)=>key(before)===key(target)));
   const changed=gov&&row.organization.assignment?.org_unit_id!==gov.organization?.org_unit_id&&(row.organization.assignment||gov.organization);
   json={preparation_id:'preparation',expires_at:'2099-10-12T00:00:00Z',revision:row.draft.revision,org_version:7,content:row.draft,added_skills:[],removed_skills:row.effective.skills.filter((pin:any)=>!row.draft.skills.some((next:any)=>next.skill_id===pin.skill_id)).map((pin:any)=>pin.skill_id),updated_skills:[],coverage_count:gov?.bindings.length===0?0:1,binding_count:gov?.bindings.length??row.bindings.length,blockers:blocked?['技能尚未发布']:[],warnings:[],changes:{name:row.name!==row.draft.name?{before:row.name,after:row.draft.name}:null,description:row.description!==row.draft.description?{before:row.description,after:row.draft.description}:null,organization:changed?{before:row.organization.assignment,after:owner}:null,bindings_added:added,bindings_removed:removed,users_added:[],users_removed:[],reason:gov?.reason||'',total:1}};}
  else if(path.endsWith('/release-v1')){calls.push('publish');if(failRelease)return route.fulfill({status:409,json:{detail:'组织依据已变化，请重新预检'}});const row=agents.find(value=>value.id===path.split('/')[4]),gov=row.draft.governance;if(gov){row.organization={...row.organization,assignment:gov.organization?assignment(gov.organization.org_unit_id):null};row.bindings=gov.bindings.map((target:any,i:number)=>({...target,id:'binding-'+i,agent_id:row.id,status:'active'}));}row.effective=row.draft;row.name=row.draft.name;row.description=row.draft.description;row.draft=null;row.published_revision=2;json={id:'release-receipt',agent_id:row.id,version:2,published_at:'2026-10-12T03:00:00Z',request_id:'request'};}
  else if(path.endsWith('/audit'))json={items:[],next_cursor:null};
  else if(path.endsWith('/bindings/bulk-preview')){calls.push('preview');json={before:coverage,after:{...coverage,user_ids:['employee','second']},added:[coverage.users[0]],removed:[],org_version:7,preview_signature:'preview-v1'};}
  else if(path.endsWith('/bindings/bulk')){expect(route.request().postDataJSON().preview_signature).toBe('preview-v1');calls.push('binding');json={agent:agents[0]};}
  else if(path.endsWith('/revoke-preview')){calls.push('revoke-preview');json={before:coverage,after:{user_ids:[],person_refs:[]},added:[],removed:[coverage.users[0]],org_version:7,preview_signature:'revoke-v1'};}
  else if(method==='DELETE'&&path.endsWith('/bindings/binding')){expect(route.request().postDataJSON()).toMatchObject({reason:'转岗',org_version:7,preview_signature:'revoke-v1'});calls.push('revoke');agents[0].bindings=[];agents[0].coverage={...coverage,user_ids:[],users:[]};json=agents[0];}
  if(path.endsWith('/prepare-release-v1')){const changes=json.changes;changes.total=Number(Boolean(changes.name))+Number(Boolean(changes.description))+Number(Boolean(changes.organization))+changes.bindings_added.length+changes.bindings_removed.length+json.removed_skills.length;if(!changes.total)json.blockers.push('草稿与当前生效配置相同，无需发布新版本');}
  await route.fulfill({json});
 });
 await page.goto('/admin/agents');await expect(page.locator('[data-agent-record]')).toHaveCount(20);
 return {calls,errors,failSave:()=>failSave=true,failRelease:()=>failRelease=true,failOrganization:()=>failOrganization=true,allowOrganization:()=>failOrganization=false,moveOwner:()=>{agents[0].organization={revision:1,assignment:assignment('dept-other'),system:false};},block:()=>blocked=true};
}
test('list, identity-first detail and return preserve page and keyboard focus',async({page})=>{
 const s=await surface(page);await expect(page.locator('[data-agent-mode=list]')).toBeVisible();await expect(page.getByRole('heading',{name:'职责与身份',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.locator('[data-agent-record="agent-22"]').click();await expect(page.locator('[data-agent-mode=detail]')).toBeVisible();await expect(page.getByRole('heading',{name:'岗位 23',exact:true})).toBeVisible();await expect(page.locator('[data-agent-record]')).toHaveCount(4);await expect(page.locator('[data-agent-middle]')).toBeVisible();await page.getByRole('button',{name:'返回列表',exact:true}).click();await expect(page.locator('[data-agent-middle] .agent-pagination')).toContainText('第 2 / 2 页');await expect(page.locator('[data-agent-open="agent-22"]')).toBeFocused();expect(s.errors).toEqual([]);
});
test('draft save keeps effective identity, explicit release confirms once and exposes receipt',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByLabel('Agent 名称',{exact:true}).fill('修订后的岗位');await page.getByLabel('职责说明',{exact:true}).fill('新的职责');await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('heading',{name:'岗位 1',exact:true})).toBeVisible();await expect(page.locator('[data-agent-mode=detail]')).toContainText('尚未应用');expect(s.calls).toEqual(['save']);
 await page.getByRole('button',{name:'检查并发布',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('修订后的岗位');await page.getByRole('button',{name:'确认发布（R3）',exact:true}).click();expect(s.calls).toEqual(['save','prepare']);await page.getByRole('dialog').getByRole('button',{name:'确认发布',exact:true}).dblclick();await expect(page.locator('[data-agent-mode=detail]')).toContainText('release-receipt');await expect(page.getByRole('heading',{name:'修订后的岗位',exact:true})).toBeVisible();expect(s.calls).toEqual(['save','prepare','publish']);expect(s.errors).toEqual([]);
});
test('a missing legacy skill remains visible until explicitly removed from a draft, with release review preserving the effective assembly',async({page})=>{
 const s=await surface(page,false,'light',false,false,true);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();
 const missing=page.getByRole('region',{name:'目录缺失技能',exact:true}),legacy=missing.getByRole('checkbox',{name:'sop_content_planning',exact:true});await expect(legacy).toBeChecked();await expect(missing.getByRole('heading')).toHaveCSS('font-size','13px');await page.getByLabel('职责说明',{exact:true}).fill('保留的修订职责');await page.getByLabel('搜索技能',{exact:true}).fill('不匹配任何技能');await expect(legacy).toBeVisible();
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('alert')).toContainText('请先取消选择目录中不存在的技能');await expect(missing).toBeFocused();await expect(page.getByLabel('职责说明',{exact:true})).toHaveValue('保留的修订职责');expect(s.calls).toEqual([]);
 await legacy.uncheck();await expect(missing).toContainText('尚未发布');await legacy.check();await expect(legacy).toBeChecked();await legacy.uncheck();await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 await expect(page.locator('[data-agent-mode=detail]')).toContainText('技能 2 项');await page.getByText('查看生效配置明细与历史',{exact:true}).click();await expect(page.locator('[data-agent-mode=detail]')).toContainText('sop_content_planning');expect(s.calls).toEqual(['save']);
 await page.getByRole('button',{name:'继续修订草稿',exact:true}).click();await expect(page.getByRole('region',{name:'目录缺失技能',exact:true})).toHaveCount(0);await expect(page.getByLabel('职责说明',{exact:true})).toHaveValue('保留的修订职责');await page.getByRole('button',{name:'取消修订',exact:true}).click();
 await page.getByRole('button',{name:'检查并发布',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('移除技能：sop_content_planning');expect(s.calls).toEqual(['save','prepare']);expect(s.errors).toEqual([]);
});

test('conflict retains local input and cancelling dirty exit stays in the editor',async({page})=>{
 const s=await surface(page);await page.getByRole('button',{name:'新建 Agent',exact:true}).click();await page.getByLabel('Agent 名称',{exact:true}).fill('保留的名称');s.failSave();await page.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(page.getByRole('alert')).toContainText('草稿已被其他人修改');await expect(page.getByLabel('Agent 名称',{exact:true})).toHaveValue('保留的名称');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'返回列表',exact:true}).click();await expect(page.locator('[data-agent-mode=create]')).toBeVisible();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'返回列表',exact:true}).click();await expect(page.locator('[data-agent-mode=list]')).toBeVisible();expect(s.errors).toEqual([]);
});
test('blocked release and changed evidence never report success',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByLabel('职责说明',{exact:true}).fill('本次修改职责');await page.getByRole('button',{name:'保存草稿',exact:true}).click();s.failRelease();await page.getByRole('button',{name:'检查并发布',exact:true}).click();await page.getByRole('button',{name:'确认发布（R3）',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('组织依据已变化');await expect(page.locator('.agent-notice')).not.toContainText('已发布 v2');await page.getByRole('dialog').locator('[data-admin-confirm-cancel]').click();s.block();await page.getByRole('button',{name:'重新检查',exact:true}).click();await expect(page.getByRole('button',{name:'确认发布（R3）',exact:true})).toBeDisabled();
});
test('personnel targets are saved in the unified draft and only released after review',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByText('使用绑定 · 草稿 1 个目标',{exact:true}).click();await page.getByRole('checkbox',{name:'人员 · 员工',exact:true}).check();await page.getByLabel('配置变更原因',{exact:true}).fill('新增协作人员');await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('新增使用绑定：员工');expect(s.calls).toEqual(['save','prepare']);await page.getByRole('button',{name:'返回详情',exact:true}).click();await expect(page.locator('[data-agent-mode=detail]')).toContainText('使用绑定 1 个');expect(s.errors).toEqual([]);
});
test('filters have the same source count and an empty list never auto-selects another Agent',async({page})=>{
 await surface(page);await page.getByLabel('搜索名称与职责',{exact:true}).fill('不存在的岗位');await expect(page.locator('[data-agent-record]')).toHaveCount(0);await expect(page.locator('[data-agent-mode=list]')).toContainText('没有符合条件');await expect(page.getByRole('heading',{name:'职责与身份',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'重置筛选',exact:true}).click();await expect(page.locator('[data-agent-record]')).toHaveCount(20);
});
test('revoke shows affected people, requires a reason, then refreshes qualification',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'紧急撤权',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();const confirm=page.getByRole('dialog');await expect(confirm).toContainText('员工');await expect(confirm.locator('[data-admin-confirm-ok]')).toBeDisabled();await confirm.locator('[data-admin-confirm-reason]').fill('转岗');await confirm.locator('[data-admin-confirm-ok]').click();await expect(page.locator('.agent-notice')).toContainText('紧急撤权已生效');expect(s.calls).toEqual(['revoke-preview','revoke']);expect(s.errors).toEqual([]);
});
test('revoke confirmation can be cancelled without a reason or any write',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'紧急撤权',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('dialog').locator('[data-admin-confirm-cancel]').click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[data-agent-mode=bindings]')).toContainText('组织 · 部门');expect(s.calls).toEqual(['revoke-preview']);
});
test('Knowledge baseline: compact stable columns, scoped facets and independent global counts',async({page},testInfo)=>{
 const s=await surface(page,true);
 const middle=page.locator('[data-agent-middle]'),right=page.locator('[data-agent-right]');
 const before=await middle.boundingBox();await expect(right).toBeVisible();
 expect(await page.locator('.agent-workspace .knowledge-list-row').first().evaluate(el=>el.getBoundingClientRect().height)).toBe(36);
 expect(await page.getByLabel('搜索名称与职责',{exact:true}).evaluate(el=>el.closest('.workspace-search-input')!.getBoundingClientRect().height)).toBe(32);
 expect(await page.locator('.agent-workspace .knowledge-filter-option').first().evaluate(el=>el.getBoundingClientRect().height)).toBe(24);
 const states=page.getByLabel('发布状态筛选',{exact:true}),bindings=page.getByLabel('人员绑定筛选',{exact:true});
 await states.getByRole('button',{name:'已发布 16',exact:true}).click();
 await expect(bindings.getByRole('button',{name:'已有绑定 8',exact:true})).toBeVisible();
 await bindings.getByRole('button',{name:'尚未绑定 8',exact:true}).click();
 await expect(page.locator('[data-agent-count]')).toHaveText('8 个 Agent');
 await expect(page.locator('[data-agent-status=published] strong')).toHaveText('16');
 await page.screenshot({path:testInfo.outputPath('agent-browse-desktop.png')});
 await page.locator('[data-agent-record="agent-8"]').click();
 const after=await middle.boundingBox();expect(after?.width).toBe(before?.width);expect(after?.x).toBe(before?.x);
 await expect(page.locator('[data-agent-count]')).toHaveText('8 个 Agent');
 await expect(page.getByRole('heading',{name:'岗位 9',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('agent-detail-desktop.png')});
 await page.getByRole('tab',{name:'修订草稿',exact:true}).focus();await page.keyboard.press('Home');
 await expect(page.getByRole('tab',{name:'Agent 资产',exact:true})).toHaveAttribute('aria-selected','true');
 expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});

test('failed list refresh and failed detail keep their own recovery without fabricating empty data',async({page})=>{
 const s=await surface(page);
 await page.route('**/api/admin/agents/workspace-v1*',route=>route.fulfill({status:503,json:{detail:'列表暂不可用'}}));
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await expect(page.locator('[data-agent-middle]')).toContainText('列表暂不可用');
 await expect(page.locator('[data-agent-count]')).toHaveText('24 个 Agent（上次结果）');
 await expect(page.locator('[data-agent-middle] [data-kb-facet-count]')).toHaveCount(0);
 await expect(page.locator('[data-agent-status=published] strong')).toHaveText('24');
 await page.route('**/api/admin/agents/agent-0/workspace-v1',route=>route.fulfill({status:503,json:{detail:'详情暂不可用'}}));
 await page.locator('[data-agent-record="agent-0"]').click();
 await expect(page.locator('[data-agent-right]')).toContainText('详情暂不可用');
 await expect(page.locator('[data-agent-middle]')).toContainText('列表暂不可用');
 await expect(page.getByRole('button',{name:'重新读取详情',exact:true})).toBeVisible();
 expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});

test('dark theme keeps compact identity and the shared filter selected state',async({page},testInfo)=>{
 const s=await surface(page,true,'dark');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('[data-agent-middle] .knowledge-filter-option').first()).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-agent-record="agent-8"]').click();
 await expect(page.getByRole('heading',{name:'岗位 9',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('agent-dark.png')});
 expect(s.errors).toEqual([]);
});

test('three organization facets use department ancestry and keep global counts, search focus and zero selections',async({page},testInfo)=>{
 const s=await surface(page,false,'light',true);
 const first=page.getByLabel('一级部门筛选',{exact:true}),second=page.getByLabel('二级部门筛选',{exact:true}),third=page.getByLabel('三级部门筛选',{exact:true});
 await first.getByRole('button',{name:'产品中心 8',exact:true}).click();await expect(second.getByRole('button',{name:'产品管理 8',exact:true})).toBeVisible();await expect(second).not.toContainText('推广部');
 await second.getByRole('button',{name:'产品管理 8',exact:true}).click();await third.getByRole('button',{name:'产品咨询组 8',exact:true}).click();await expect(page.locator('[data-agent-count]')).toHaveText('8 个 Agent');
 await expect(page.locator('[data-agent-status=published] strong')).toHaveText('24');
 const search=page.getByLabel('搜索名称与职责',{exact:true});await search.fill('不存在');await expect(page.locator('[data-agent-count]')).toHaveText('0 个 Agent');await expect(search).toBeFocused();
 await page.getByRole('button',{name:'收起空部门',exact:true}).click();await expect(third.getByRole('button',{name:'产品咨询组 0',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'显示空部门',exact:true}).click();await search.fill('');await expect(page.locator('[data-agent-count]')).toHaveText('8 个 Agent');await page.screenshot({path:testInfo.outputPath('agent-organization-filters.png')});
 await first.getByRole('button',{name:'增长中心 0',exact:true}).click();await expect(second.getByRole('button',{name:'全部 4',exact:true})).toHaveAttribute('aria-pressed','true');await expect(third.getByRole('button',{name:'全部 4',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-agent-count]')).toHaveText('4 个 Agent');expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});
async function chooseOwner(page:Page){
 await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByText('组织归属 · 未设置',{exact:true}).click();await page.getByLabel('草稿归属部门',{exact:true}).fill('产品咨询组');await page.locator('.ant-select-tree-node-content-wrapper').filter({hasText:'产品咨询组'}).click();await page.getByLabel('配置变更原因',{exact:true}).fill('岗位调动');
}
test('assets summarize current state and fetch detailed capability and audit only on demand',async({page},info)=>{
 const s=await surface(page);let audit=0;page.on('request',request=>{if(request.url().includes('/audit'))audit++;});await page.locator('[data-agent-record="agent-0"]').click();await expect(page.getByRole('heading',{name:'当前配置摘要',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'查看技能与依赖',exact:true})).toHaveCount(0);expect(audit).toBe(0);await page.screenshot({path:info.outputPath('agent-summary.png')});await page.getByText('查看生效配置明细与历史',{exact:true}).click();await expect(page.getByRole('link',{name:'查看技能与依赖',exact:true})).toBeVisible();await expect.poll(()=>audit).toBe(1);expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
});
test('a metadata-only check shows its diff, hides unchanged lists and blocks an empty revision',async({page})=>{
 const s=await surface(page);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.getByRole('alert')).toContainText('无需发布新版本');await expect(page.getByRole('button',{name:'确认发布（R3）',exact:true})).toBeDisabled();await page.getByRole('tab',{name:'修订草稿',exact:true}).click();await page.getByLabel('职责说明',{exact:true}).fill('更新后的职责');await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('职责新内容：更新后的职责');await expect(page.getByRole('button',{name:'确认发布（R3）',exact:true})).toBeEnabled();await expect(page.getByText('知识分析 · abcdef012345',{exact:true})).toBeHidden();expect(s.calls).toEqual(['save','prepare','save','prepare']);expect(s.errors).toEqual([]);
});
test('ownership becomes a draft; release review shows its diff and cancellation does not apply it',async({page},info)=>{
 const s=await surface(page);await chooseOwner(page);await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('组织归属：未设置组织归属 → 产品中心 / 产品管理 / 产品咨询组');expect(s.calls).toEqual(['save','prepare']);await page.screenshot({path:info.outputPath('agent-change-check.png')});await page.getByRole('button',{name:'确认发布（R3）',exact:true}).click();await page.getByRole('dialog').locator('[data-admin-confirm-cancel]').click();expect(s.calls).toEqual(['save','prepare']);await page.getByRole('button',{name:'返回详情',exact:true}).click();await expect(page.locator('[data-agent-mode=detail]')).toContainText('数字员工组织归属：未设置组织归属');await page.getByRole('button',{name:'检查并发布',exact:true}).click();await page.getByRole('button',{name:'确认发布（R3）',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认发布',exact:true}).dblclick();await expect(page.locator('[data-agent-mode=detail]')).toContainText('数字员工组织归属：产品中心 / 产品管理 / 产品咨询组');expect(s.calls.filter(value=>value==='publish')).toHaveLength(1);expect(s.errors).toEqual([]);
});
test('failed unified save preserves the selected department, reason and dirty exit protection',async({page})=>{
 const s=await surface(page);await chooseOwner(page);s.failSave();await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.getByRole('alert')).toContainText('草稿已被其他人修改');await expect(page.getByLabel('配置变更原因',{exact:true})).toHaveValue('岗位调动');await expect(page.locator('[data-agent-mode=edit]')).toContainText('产品咨询组');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'返回列表',exact:true}).click();await expect(page.locator('[data-agent-mode=edit]')).toBeVisible();expect(s.calls).toEqual(['save']);expect(s.errors).toEqual([]);
});
test('narrow governance draft keeps submit reachable and uses form density',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});const s=await surface(page);await chooseOwner(page);await expect(page.getByRole('button',{name:'提交检查',exact:true})).toBeInViewport();expect(await page.locator('.agent-workspace .compact-button--primary:visible').count()).toBe(1);for(const field of await page.locator('.agent-editor .ant-select').all())expect(await field.evaluate(element=>element.getBoundingClientRect().height)).toBe(32);await page.screenshot({path:info.outputPath('agent-governance-narrow.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(s.errors).toEqual([]);
});
test('clearing ownership is visible in release differences and does not remove human usage bindings',async({page})=>{
 const s=await surface(page,false,'light',true);await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();await page.getByText('组织归属 · 产品咨询组',{exact:true}).click();await page.getByRole('checkbox',{name:'不设置组织归属 / 清除归属',exact:true}).check();await page.getByLabel('配置变更原因',{exact:true}).fill('岗位调整');await page.getByRole('button',{name:'提交检查',exact:true}).click();await expect(page.locator('[data-agent-mode=publish]')).toContainText('产品中心 / 产品管理 / 产品咨询组 → 未设置组织归属');await expect(page.locator('[data-agent-mode=publish]')).toContainText('发布后 1 个绑定点');expect(s.calls).toEqual(['save','prepare']);expect(s.errors).toEqual([]);
});
test('HTTP crypto compatibility supports the unified release confirmation',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(window.crypto,'randomUUID',{value:undefined,configurable:true}));const s=await surface(page);let request='';page.on('request',value=>{if(value.url().endsWith('/release-v1'))request=value.postDataJSON().request_id;});await chooseOwner(page);await page.getByRole('button',{name:'提交检查',exact:true}).click();await page.getByRole('button',{name:'确认发布（R3）',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认发布',exact:true}).click();await expect(page.locator('.agent-notice')).toContainText('release-receipt');expect(request).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);expect(s.errors).toEqual([]);
});
test('large department sets use a compact searchable selector and retain a selected empty node on narrow screens',async({page})=>{
 await page.setViewportSize({width:390,height:844});const s=await surface(page,false,'light',false,true);const selection=page.getByLabel('三级部门选择',{exact:true});await selection.fill('扩展组 8');await page.locator('.ant-select-item-option-content').filter({hasText:'扩展组 8 0'}).click();await expect(page.locator('[data-agent-count]')).toHaveText('0 个 Agent');await page.getByRole('button',{name:'收起空部门',exact:true}).click();await expect(page.getByLabel('三级部门筛选',{exact:true})).toContainText('扩展组 8');expect(await selection.locator('..').evaluate(element=>element.closest('.ant-select')!.getBoundingClientRect().height)).toBe(24);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(s.errors).toEqual([]);expect(s.calls).toEqual([]);
});
test.describe('touch Agent browser',()=>{
 test.use({hasTouch:true});
 test('narrow list keeps new/create/back entries and 44px row targets',async({page})=>{
  await page.setViewportSize({width:390,height:844});const s=await surface(page);
  await expect(page.locator('[data-agent-right]')).not.toBeVisible();
  expect(await page.locator('.agent-workspace .knowledge-list-row').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.getByRole('button',{name:'新建 Agent',exact:true}).click();
  await expect(page.getByLabel('Agent 名称',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回列表',exact:true}).click();
  await expect(page.locator('[data-agent-middle]')).toBeVisible();
  expect(s.calls).toEqual([]);expect(s.errors).toEqual([]);
 });
});

for(const size of [{width:1440,height:900},{width:1024,height:600},{width:390,height:844},{width:844,height:390}])test(`layout and footer stay reachable at ${size.width}x${size.height}`,async({page},testInfo)=>{
 await page.setViewportSize(size);const s=await surface(page);await page.screenshot({path:testInfo.outputPath('agent-list.png')});await page.locator('[data-agent-record="agent-0"]').click();await page.getByRole('button',{name:'创建修订草稿',exact:true}).click();const save=page.getByRole('button',{name:'保存草稿',exact:true});await expect(save).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('.agent-workspace .compact-button--primary:visible').count()).toBe(1);await page.screenshot({path:testInfo.outputPath('agent-editor.png')});expect(s.errors).toEqual([]);
});
