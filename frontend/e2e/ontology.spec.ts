import { test, expect, type Page } from '@playwright/test';
import type { OntologyCatalog, OntologyDefinition, OntologyDocument } from '../../shared/ontology';
import fs from 'node:fs';
import path from 'node:path';

// Deliberately explicit UI-only fixtures. Persistence/SQL is not simulated as proof.
const root=path.resolve(process.cwd(),'..');
const registry=JSON.parse(fs.readFileSync(path.join(root,'config/objects-registry.yaml'),'utf8'));
const semantics=JSON.parse(fs.readFileSync(path.join(root,'config/ontology-semantics.json'),'utf8'));
const profile:OntologyDefinition={code:'kol_profile',id:'B2',name:'KOL 画像',description:'Starry 提供正式档案事实',layer:'kol_business',taxonomy:['营销','KOL营销','达人资源'],source:'BIZ-01 / BIZ-02',items:{
  properties:registry.objects.find((o:any)=>o.code==='kol_profile').properties.map((p:any)=>({code:p.code,name:p.name,description:p.rule||'',source:p.lineage||'业务目录',type:p.biz_type})),
  relations:semantics.relations.filter((i:any)=>i.object==='kol_profile').map(({object,...i}:any)=>i),
  events:[{code:'kol.profile_updated',name:'画像已更新',description:'事件类型，非历史事实',source:'BIZ-02'}],
  rules:semantics.rules.filter((i:any)=>i.object==='kol_profile').map(({object,...i}:any)=>i),
  actions:semantics.actions.filter((i:any)=>i.object==='kol_profile').map(({object,...i}:any)=>i),
}};
const collaboration:OntologyDefinition={...structuredClone(profile),code:'collaboration',id:'B3',name:'合作关系',taxonomy:['营销','KOL营销','达人合作'],items:{properties:[],relations:[],events:[],rules:[],actions:[]}};
const candidateRegistry=registry.objects.find((o:any)=>o.code==='creator_candidate');
const candidate:OntologyDefinition={code:'creator_candidate',id:candidateRegistry.id,name:candidateRegistry.name,description:semantics.definitions.creator_candidate,layer:'kol_business',taxonomy:['营销','KOL营销','达人资源'],source:candidateRegistry.authority_source,items:{properties:candidateRegistry.properties.map((p:any)=>({code:p.code,name:p.name,description:p.rule||'',source:p.lineage||'业务目录',type:p.biz_type})),relations:[],events:[],rules:[],actions:[]}};
const enterprise=JSON.parse(fs.readFileSync(path.join(root,'config/ontology-enterprise-catalog.json'),'utf8'));
async function fixture(page:Page,admin=true,complete=false){
  let document:OntologyDocument={code:profile.code,revision:0,draft:null,published:structuredClone(profile),status:'registered',updatedAt:null};
  const account={id:admin?'admin':'employee',username:'ontology-ui',name:'界面测试用户',roles:admin?['admin','employee']:['employee'],available_modes:admin?['admin','employee']:['employee'],brands:[]};
  let commits=0;let failOnce=false;let configured=true;let mappings:any[]=[];let scopeRevision=0;let feedbackCount=0;let savedDefinition:OntologyDefinition|undefined;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const p=url.pathname;
    if(p==='/api/ontology/workspace/catalog'){
      if(failOnce){await route.fulfill({status:503,json:{detail:'本体服务暂不可用'}});return;}
      const catalog:OntologyCatalog={context:{companyId:'company:test',companies:[{id:'company:test',name:'测试公司'}],admin},relevance:{configured,relatedDomains:configured?[['营销','KOL营销']]:[],matchedMappings:[],owners:[]},sourceVersion:'test-source',objects:[{...structuredClone(document),draft:admin?document.draft:null},{code:'collaboration',revision:0,draft:null,published:collaboration,status:'registered',updatedAt:null},...(document.code===candidate.code?[]:[{code:candidate.code,revision:0,draft:null,published:candidate,status:'registered' as const,updatedAt:null}])]};
      if(complete){
        catalog.objects=enterprise.objects.map((o:any)=>({code:o.code,revision:0,draft:null,status:'registered',updatedAt:null,published:o.code==='kol_profile'?profile:o.code==='creator_candidate'?candidate:{code:o.code,id:o.id,name:o.name,description:'企业业务架构规划目录；无实例数据',layer:'kol_business',taxonomy:[enterprise.families.find((f:any)=>f.code===o.family).name,o.domain,o.theme],source:'用户提供目录',items:{properties:[],relations:[],events:[],rules:[],actions:[]}}}));
        catalog.taxonomy={nodes:enterprise.families.map((f:any)=>({id:f.code,parentId:null,level:1,name:f.name,detailStatus:f.detailStatus})),placements:enterprise.placements.map((p:any)=>({objectCode:p.objectCode,path:[enterprise.families.find((f:any)=>f.code===p.family).name,p.domain,p.theme],primary:false})),missing:enterprise.missing};
      }
      await route.fulfill({json:catalog});return;
    }
    if(p==='/api/ontology/workspace/scope'){
      if(route.request().method()==='POST'){const b=route.request().postDataJSON();mappings=b.mappings;scopeRevision++;configured=!!mappings.length;await route.fulfill({json:{id:'scope-receipt',code:'scope-settings',revision:scopeRevision,action:'configure_scope',createdAt:new Date().toISOString()}});return;}
      await route.fulfill({json:{revision:scopeRevision,mappings,updatedAt:null,options:{units:[{id:'unit:test',name:'真实测试部门'}],positions:['运营专员'],people:[{id:'person:test',name:'测试员工'}]}}});return;
    }
    if(p==='/api/ontology/workspace/maintenance'){if(route.request().method()==='POST'){feedbackCount++;await route.fulfill({json:{id:'feedback-receipt',code:'collaboration',revision:0,action:'maintenance_feedback',createdAt:new Date().toISOString()}});}else await route.fulfill({json:{items:[]}});return;}
    if(p==='/api/ontology/workspace/drafts'){
      const body=route.request().postDataJSON();savedDefinition=body.definition;document={...document,code:body.definition.code,published:body.definition.code===candidate.code?candidate:document.published,draft:body.definition,revision:document.revision+1};
      await route.fulfill({json:{id:'save-receipt',code:'kol_profile',revision:document.revision,action:'save_draft',createdAt:new Date().toISOString()}});return;
    }
    if(p==='/api/ontology/workspace/prepare'){await route.fulfill({json:{token:'confirm-token',code:'kol_profile',revision:document.revision,action:'publish',expiresAt:new Date(Date.now()+300000).toISOString(),previous:document.published,next:document.draft}});return;}
    if(p==='/api/ontology/workspace/commit'){commits++;document={...document,published:document.draft,draft:null,revision:document.revision+1,status:'published'};await route.fulfill({json:{id:'publish-receipt',code:'kol_profile',revision:document.revision,action:'publish',createdAt:new Date().toISOString()}});return;}
    if(p.startsWith('/api/ontology/workspace/history/')){await route.fulfill({json:{items:[]}});return;}
    let json:unknown=[];
    if(p==='/api/auth/status')json={authenticated:true,account};else if(p==='/api/me')json=account;else if(p==='/api/me/preferences')json={};else if(p==='/api/health')json={ok:true};else if(p==='/api/version')json={version:'ontology-ui-test'};
    await route.fulfill({json});
  });
  return {failNextLoad:()=>{failOnce=true;},resumeLoad:()=>{failOnce=false;},getSaved:()=>savedDefinition,getCommits:()=>commits,getFeedbackCount:()=>feedbackCount,clearScope:()=>{configured=false;}};
}


async function chooseCategory(page:Page,label:string,value:string){
 const group=page.getByRole('group',{name:label,exact:true});
 const target=group.getByRole('button',{name:value,exact:true});
 if(!await target.count())await group.getByRole('button',{name:'更多⌄',exact:true}).click();
 await group.getByRole('button',{name:value,exact:true}).click();
}

test('employee browses all five dimensions without management controls',async({page})=>{
  await fixture(page,false);await page.goto('/ontology');await expect(page.getByRole('heading',{name:'KOL 画像',exact:true})).toBeVisible();
  const catalog=await page.getByLabel('业务对象目录').innerText();
  for(const name of ['属性','关系','事件','规则','动作']){await page.getByRole('tab',{name:new RegExp('^'+name)}).click();await expect(page.getByRole('tabpanel')).toBeVisible();await expect(page.getByRole('tab',{name:new RegExp('^'+name)})).toHaveAttribute('aria-selected','true');expect(await page.getByLabel('业务对象目录').innerText()).toBe(catalog);}
  await expect(page.getByRole('button',{name:'编辑对象'})).toHaveCount(0);await expect(page.getByRole('button',{name:/新建/})).toHaveCount(0);await expect(page.getByRole('button',{name:'预览发布'})).toHaveCount(0);
  await page.getByLabel('搜索业务对象').fill('不存在');await expect(page.getByText('没有匹配对象。请调整筛选或搜索。')).toBeVisible();
});

test('admin edits a real definition, retains drafts after reload and explicitly confirms publication',async({page})=>{
  const state=await fixture(page);await page.goto('/admin/ontology');await page.getByRole('button',{name:'编辑稳定 ID',exact:true}).click();
  await page.getByLabel('名称 *',{exact:true}).fill('稳定身份标识');await page.getByLabel('变更原因 *').fill('对齐对象定义');await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('.onto-receipt[role=status]')).toContainText('save-receipt');await expect(page.getByText('草稿 · 未生效',{exact:true})).toBeVisible();expect(state.getSaved()?.items.properties[0].name).toBe('稳定身份标识');expect(state.getCommits()).toBe(0);
  await page.reload();await expect(page.getByText('稳定身份标识',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'预览发布'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'确认发布',exact:true})).toBeDisabled();await page.getByText('核对完整内容差异').click();await expect(page.getByRole('dialog').getByText('稳定身份标识',{exact:false})).toBeVisible();
  await page.getByLabel('变更原因',{exact:true}).fill('确认对齐定义');await page.getByLabel('我已核对对象、完整定义内容和影响范围').check();await page.getByRole('button',{name:'确认发布',exact:true}).click();
  await expect(page.locator('.onto-receipt[role=status]')).toContainText('publish-receipt');expect(state.getCommits()).toBe(1);await page.getByLabel('对象更多操作').click();await expect(page.getByText(/治理状态：已发布/)).toBeVisible();
});

test('five editor cards preserve structure and keyboard close; dirty changes require discard',async({page})=>{
  await fixture(page);await page.goto('/admin/ontology');
  for(const name of ['属性','关系','事件','规则','动作']){
    await page.getByRole('tab',{name:new RegExp('^'+name)}).click();await page.getByRole('button',{name:'＋ 新建'+name,exact:true}).click();await expect(page.getByRole('heading',{name:'新建'+name})).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('button',{name:'＋ 新建动作',exact:true}).click();await page.getByLabel('名称 *',{exact:true}).fill('新动作');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'关闭卡片'}).click();await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('error recovery, admin route guard and viewport layout',async({page})=>{
  const state=await fixture(page);state.failNextLoad();await page.goto('/admin/ontology');await expect(page.getByRole('alert')).toContainText('本体服务暂不可用');state.resumeLoad();await page.getByRole('button',{name:'重试'}).click();await expect(page.getByRole('heading',{name:'KOL 画像'})).toBeVisible();
  for(const viewport of [{width:1680,height:940},{width:390,height:844},{width:1280,height:500}]){
    await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'编辑对象'}).click();const box=await page.getByRole('dialog').locator('footer').boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1680,height:940});await page.screenshot({path:'test-results/ontology/admin.png',fullPage:true});
});

test('employee cannot enter admin editing surface',async({page})=>{
  await fixture(page,false);await page.goto('/admin/ontology');await expect(page.getByRole('alert')).toContainText('需要本体治理管理权限');await expect(page.getByRole('button',{name:'＋ 新建对象'})).toHaveCount(0);
});


test('ontology direct links survive refresh, navigation and browser back',async({page})=>{
  await fixture(page,false);await page.goto('/ontology');
  await expect(page.getByRole('heading',{name:'KOL 画像',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'合作关系',exact:true}).click();
  await expect(page.getByRole('heading',{name:'合作关系',exact:true})).toBeVisible();
  const selectedUrl=page.url();await page.reload();
  await expect(page.getByRole('heading',{name:'合作关系',exact:true})).toBeVisible();
  await page.goto('/ontology');await page.goBack();expect(page.url()).toBe(selectedUrl);
  await expect(page.getByRole('heading',{name:'合作关系',exact:true})).toBeVisible();
});


test('full enterprise hierarchy filters Amazon Listing and opens completed B01 and canonical references',async({page})=>{
 await fixture(page,true,true);await page.goto('/admin/ontology');await expect(page.getByRole('heading',{name:'KOL 画像',exact:true})).toBeVisible();
 await expect(page.getByRole('group',{name:'业务域',exact:true})).toBeVisible();await expect(page.getByRole('group',{name:'业务主题',exact:true})).toBeVisible();await page.getByRole('button',{name:'全部范围',exact:true}).click();
 await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','亚马逊经营');await chooseCategory(page,'业务主题','商品管理');
 await expect(page.getByRole('button',{name:'Amazon Listing',exact:true})).toBeVisible();await page.getByRole('button',{name:'Amazon Listing',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Amazon Listing',exact:true})).toBeVisible();await expect(page.getByText('尚未定义属性',{exact:true})).toBeVisible();
 await expect(page.getByRole('table',{name:'属性定义',exact:true})).toHaveCount(0);
 await chooseCategory(page,'业务族','战略与经营');await chooseCategory(page,'业务域','战略管理');await chooseCategory(page,'业务主题','企业战略');await page.getByRole('table',{name:'业务对象',exact:true}).getByRole('button',{name:'企业战略',exact:true}).click();await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();
 await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','销售分析');await chooseCategory(page,'业务主题','渠道经营');
 await expect(page.getByRole('button',{name:'渠道利润分析',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/ontology/enterprise.png',fullPage:true});
});


test('compact layout retains stable controls, single selection and URL filter context',async({page})=>{
 await fixture(page,true,true);await page.setViewportSize({width:1680,height:940});await page.goto('/admin/ontology');
 await expect(page.getByRole('heading',{name:'业务对象管理',exact:true})).toBeVisible();
 await expect(page.locator('.onto-object-table input[type=checkbox]')).toHaveCount(0);
 const filters=await page.locator('.onto-filters').boundingBox();expect(filters!.height).toBeLessThan(150);
 const catalog=await page.getByLabel('业务对象目录').boundingBox();expect(catalog!.height).toBeGreaterThan(400);
 await page.getByRole('button',{name:'全部范围',exact:true}).click();await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','亚马逊经营');await chooseCategory(page,'业务主题','商品管理');
 await page.getByRole('button',{name:'Amazon Listing',exact:true}).click();const url=page.url();
 await page.reload();await expect(page.getByRole('heading',{name:'Amazon Listing',exact:true})).toBeVisible();expect(page.url()).toBe(url);
 const separator=page.getByRole('separator',{name:'调整对象列表宽度'});const old=Number(await separator.getAttribute('aria-valuenow'));await separator.focus();await page.keyboard.press('ArrowRight');expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(old);
 await page.getByRole('button',{name:'＋ 新建对象',exact:true}).click();await expect(page.getByLabel('业务族（L1） *',{exact:true})).toHaveValue('销售');await expect(page.getByLabel('业务域（L2） *',{exact:true})).toHaveValue('亚马逊经营');await page.keyboard.press('Escape');
 await page.getByLabel('搜索业务对象').fill('企业战略');await expect(page.getByText('没有匹配对象。请调整筛选或搜索。')).toBeVisible();await page.getByLabel('跨范围搜索').click();await expect(page.getByLabel('跨范围搜索')).toBeChecked();await page.getByRole('table',{name:'业务对象',exact:true}).getByRole('button',{name:'企业战略',exact:true}).click();
 await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('family')).toBe('战略与经营');
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.getByLabel('搜索业务对象')).toHaveValue('');await expect(page.getByText('当前范围 878',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();await expect(page.locator('.onto-object-table tr.selected')).toContainText('企业战略');await page.getByRole('button',{name:'下一页'}).click();await expect(page.locator('.onto-object-table tr.selected')).toHaveCount(1);await page.reload();await expect(page.locator('.onto-object-table tr.selected')).toHaveCount(1);await page.getByRole('button',{name:'上一页'}).click();
 await page.screenshot({path:'test-results/ontology/compact.png',fullPage:true});
});

test('object information, impacts and field details remain available without duplicate headings',async({page})=>{
 await fixture(page);await page.goto('/admin/ontology');await expect(page.getByRole('heading',{name:'属性',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'查看业务内容：稳定 ID',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('数据类型');await expect(page.getByRole('dialog')).toContainText('定义依据');await page.keyboard.press('Escape');
 await page.getByLabel('对象更多操作').click();await expect(page.getByRole('link',{name:'注册表与审批治理',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'停用对象',exact:true})).toBeVisible();
 await page.getByLabel('对象更多操作').click();await page.getByRole('button',{name:'对象定义帮助',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('默认范围不等于访问授权');await expect(page.getByRole('dialog')).toContainText('不管理实际账号');await page.keyboard.press('Escape');
});

test('related defaults are distinct from access and unconfigured mapping has a useful next step',async({page})=>{
 const state=await fixture(page,true,true);await page.goto('/admin/ontology');await expect(page.getByRole('button',{name:'与我相关',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('table',{name:'业务对象',exact:true}).getByRole('button',{name:'企业战略',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'全部范围',exact:true}).click();await expect(page.getByRole('table',{name:'业务对象',exact:true}).getByRole('button',{name:'企业战略',exact:true})).toBeVisible();
 state.clearScope();await page.goto('/admin/ontology');await expect(page.getByText('尚未配置组织／岗位与业务域的关联。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'配置相关业务域',exact:true})).toBeVisible();await page.getByRole('button',{name:'查看全部范围',exact:true}).click();await expect(page.getByRole('table',{name:'业务对象',exact:true}).getByRole('button',{name:'企业战略',exact:true})).toBeVisible();
});
test('admin maintains explicit organization-domain mappings with confirmation and receipt',async({page})=>{
 await fixture(page);await page.goto('/admin/ontology');await page.getByRole('button',{name:'配置范围',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('不授予或撤销访问权限');
 for(const [name,value] of [['组织／岗位／人员','真实测试部门'],['默认关联业务域','营销 / KOL营销']]){await page.getByRole('combobox',{name,exact:true}).fill(value);await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:value}).click();}
 await page.getByRole('button',{name:'添加关联',exact:true}).click();await expect(page.getByRole('button',{name:'确认保存范围',exact:true})).toBeDisabled();await page.getByLabel('配置变更原因').fill('确认运营职责默认范围');await page.getByLabel('我已核对以上关联，仅调整默认浏览范围').check();await page.getByRole('button',{name:'确认保存范围',exact:true}).click();await expect(page.locator('.onto-receipt')).toContainText('scope-receipt');
});
test('empty relations offer admin creation, employee feedback and explicit applicability',async({page})=>{
 const state=await fixture(page,false);await page.goto('/ontology?object=collaboration&dimension=relations');await expect(page.getByRole('tab',{name:'关系 0',exact:true})).toBeVisible();await expect(page.getByText('尚未定义关系',{exact:true})).toBeVisible();await page.getByRole('button',{name:'反馈维护',exact:true}).click();await page.getByLabel('维护说明').fill('请补充合作与达人之间的关系');await page.getByRole('button',{name:'提交维护反馈',exact:true}).click();await expect(page.locator('.onto-receipt')).toContainText('feedback-receipt');expect(state.getFeedbackCount()).toBe(1);
});
test('business first header and minimal table columns retain full definition values',async({page})=>{
 await fixture(page);await page.goto('/admin/ontology');await expect(page.getByText('目录已收录',{exact:true})).toHaveCount(0);await expect(page.getByText(/已维护.*类定义/)).toHaveCount(0);await expect(page.locator('.onto-object-head .onto-code')).toHaveCount(0);await expect(page.getByRole('button',{name:'版本历史',exact:true})).toHaveCount(0);
 const table=page.getByRole('table',{name:'属性定义',exact:true});await expect(table.getByRole('columnheader',{name:'定义依据',exact:true})).toHaveCount(0);await expect(table.getByRole('columnheader',{name:'编码',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'查看业务内容：稳定 ID',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('stable_id');await expect(page.getByRole('dialog')).toContainText('定义依据');await page.keyboard.press('Escape');await page.screenshot({path:'test-results/ontology/business-first.png',fullPage:true});
});

test('reference layout shows lead business definition, exposed filters and empty relation next steps',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1680,height:940});await page.goto('/admin/ontology?scope=related&object=creator_candidate&family=营销&domain=KOL营销&topic=达人资源');await expect(page.getByRole('heading',{name:'线索',exact:true})).toBeVisible();await expect(page.locator('.onto-object-head')).toContainText('尚未完成合作评估');await expect(page.locator('.onto-object-table tr.selected')).toContainText('线索');
 const datatype=await page.getByRole('columnheader',{name:'数据类型',exact:true}).boundingBox();const required=await page.getByRole('columnheader',{name:'必填',exact:true}).boundingBox();expect(datatype!.width).toBeLessThanOrEqual(74);expect(required!.width).toBeLessThanOrEqual(50);await page.screenshot({path:'test-results/ontology/reference.png',fullPage:true});
 await page.getByRole('tab',{name:'关系 0',exact:true}).click();await expect(page.getByRole('button',{name:'＋ 新建关系',exact:true})).toBeVisible();await page.screenshot({path:'test-results/ontology/empty-relations.png',fullPage:true});
 await page.getByRole('button',{name:'设置适用性',exact:true}).click();await page.getByLabel('明确标记为不适用').check();await page.getByLabel('适用性依据').fill('经业务负责人确认，此对象暂不建立关系定义');await page.getByRole('button',{name:'保存适用性草稿',exact:true}).click();await expect(page.getByText('关系不适用',{exact:true})).toBeVisible();await expect(page.getByText('草稿 · 未生效',{exact:true})).toBeVisible();
});

test('requested middle-column correction: all levels visible, no category search, leftmost wrapping and one scroller',async({page})=>{
 await fixture(page,true,true);await page.setViewportSize({width:1680,height:940});await page.goto('/admin/ontology?scope=all');
 for(const label of ['业务族','业务域','业务主题'])await expect(page.getByRole('group',{name:label,exact:true})).toBeVisible();
 const family=page.getByRole('group',{name:'业务族',exact:true});await family.getByRole('button',{name:'更多⌄',exact:true}).click();
 await expect(page.locator('.onto-filters [role=combobox]')).toHaveCount(0);
 const wraps=await family.evaluate(group=>{const x=group.getBoundingClientRect().left;const options=[...group.querySelectorAll('button')];const firstY=options[0].getBoundingClientRect().top;const wrapped=options.find(b=>b.getBoundingClientRect().top>firstY+5);return {left:x,wrappedLeft:wrapped?.getBoundingClientRect().left};});expect(wraps.wrappedLeft).toBeDefined();expect(Math.abs(wraps.wrappedLeft!-wraps.left)).toBeLessThan(3);
 const scrolls=await page.getByLabel('业务对象目录').evaluate(catalog=>({catalog:getComputedStyle(catalog).overflowY,filter:getComputedStyle(catalog.querySelector('.onto-filters')!).overflowY,list:getComputedStyle(catalog.querySelector('.onto-object-list')!).overflowY}));expect(scrolls).toEqual({catalog:'auto',filter:'visible',list:'visible'});
 await page.screenshot({path:'test-results/ontology/middle-correction.png',fullPage:true});
});
