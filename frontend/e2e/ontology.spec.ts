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
const enterprise=JSON.parse(fs.readFileSync(path.join(root,'config/ontology-enterprise-catalog.json'),'utf8'));
async function fixture(page:Page,admin=true,complete=false){
  let document:OntologyDocument={code:profile.code,revision:0,draft:null,published:structuredClone(profile),status:'registered',updatedAt:null};
  const account={id:admin?'admin':'employee',username:'ontology-ui',name:'界面测试用户',roles:admin?['admin','employee']:['employee'],available_modes:admin?['admin','employee']:['employee'],brands:[]};
  let commits=0;let failOnce=false;let savedDefinition:OntologyDefinition|undefined;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());const p=url.pathname;
    if(p==='/api/ontology/workspace/catalog'){
      if(failOnce){await route.fulfill({status:503,json:{detail:'本体服务暂不可用'}});return;}
      const catalog:OntologyCatalog={context:{companyId:'company:test',companies:[{id:'company:test',name:'测试公司'}],admin},sourceVersion:'test-source',objects:[{...structuredClone(document),draft:admin?document.draft:null},{code:'collaboration',revision:0,draft:null,published:collaboration,status:'registered',updatedAt:null}]};
      if(complete){
        catalog.objects=enterprise.objects.map((o:any)=>({code:o.code,revision:0,draft:null,status:'registered',updatedAt:null,published:o.code==='kol_profile'?profile:{code:o.code,id:o.id,name:o.name,description:'企业业务架构规划目录；无实例数据',layer:'kol_business',taxonomy:[enterprise.families.find((f:any)=>f.code===o.family).name,o.domain,o.theme],source:'用户提供目录',items:{properties:[],relations:[],events:[],rules:[],actions:[]}}}));
        catalog.taxonomy={nodes:enterprise.families.map((f:any)=>({id:f.code,parentId:null,level:1,name:f.name,detailStatus:f.detailStatus})),placements:enterprise.placements.map((p:any)=>({objectCode:p.objectCode,path:[enterprise.families.find((f:any)=>f.code===p.family).name,p.domain,p.theme],primary:false})),missing:enterprise.missing};
      }
      await route.fulfill({json:catalog});return;
    }
    if(p==='/api/ontology/workspace/drafts'){
      const body=route.request().postDataJSON();savedDefinition=body.definition;document={...document,draft:body.definition,revision:document.revision+1};
      await route.fulfill({json:{id:'save-receipt',code:'kol_profile',revision:document.revision,action:'save_draft',createdAt:new Date().toISOString()}});return;
    }
    if(p==='/api/ontology/workspace/prepare'){await route.fulfill({json:{token:'confirm-token',code:'kol_profile',revision:document.revision,action:'publish',expiresAt:new Date(Date.now()+300000).toISOString(),previous:document.published,next:document.draft}});return;}
    if(p==='/api/ontology/workspace/commit'){commits++;document={...document,published:document.draft,draft:null,revision:document.revision+1,status:'published'};await route.fulfill({json:{id:'publish-receipt',code:'kol_profile',revision:document.revision,action:'publish',createdAt:new Date().toISOString()}});return;}
    if(p.startsWith('/api/ontology/workspace/history/')){await route.fulfill({json:{items:[]}});return;}
    let json:unknown=[];
    if(p==='/api/auth/status')json={authenticated:true,account};else if(p==='/api/me')json=account;else if(p==='/api/me/preferences')json={};else if(p==='/api/health')json={ok:true};else if(p==='/api/version')json={version:'ontology-ui-test'};
    await route.fulfill({json});
  });
  return {failNextLoad:()=>{failOnce=true;},resumeLoad:()=>{failOnce=false;},getSaved:()=>savedDefinition,getCommits:()=>commits};
}


async function chooseCategory(page:Page,label:string,value:string){
 const input=page.getByRole('combobox',{name:label,exact:true});await input.fill(value);
 await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp('^'+value+'$')}).click();
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
  await expect(page.locator('.onto-receipt[role=status]')).toContainText('publish-receipt');expect(state.getCommits()).toBe(1);await expect(page.getByText('已发布',{exact:true})).toBeVisible();
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
 await expect(page.getByRole('combobox',{name:'业务域',exact:true})).toBeDisabled();
 await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','亚马逊经营');await chooseCategory(page,'业务主题','商品管理');
 await expect(page.getByRole('button',{name:'Amazon Listing',exact:true})).toBeVisible();await page.getByRole('button',{name:'Amazon Listing',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Amazon Listing',exact:true})).toBeVisible();await expect(page.getByText('尚未定义属性',{exact:true})).toBeVisible();
 await expect(page.getByRole('table',{name:'属性定义',exact:true})).toHaveCount(0);
 await chooseCategory(page,'业务族','战略与经营');await chooseCategory(page,'业务域','战略管理');await chooseCategory(page,'业务主题','企业战略');await page.getByRole('button',{name:'企业战略',exact:true}).click();await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();
 await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','销售分析');await chooseCategory(page,'业务主题','渠道经营');
 await expect(page.getByRole('button',{name:'渠道利润分析',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/ontology/enterprise.png',fullPage:true});
});


test('compact layout retains stable controls, single selection and URL filter context',async({page})=>{
 await fixture(page,true,true);await page.setViewportSize({width:1680,height:940});await page.goto('/admin/ontology');
 await expect(page.getByRole('heading',{name:'业务对象管理',exact:true})).toBeVisible();
 await expect(page.locator('.onto-object-table input[type=checkbox]')).toHaveCount(0);
 const filters=await page.locator('.onto-filters').boundingBox();expect(filters!.height).toBeLessThan(150);
 const list=await page.locator('.onto-object-list').boundingBox();expect(list!.height).toBeGreaterThan(400);
 await chooseCategory(page,'业务族','销售');await chooseCategory(page,'业务域','亚马逊经营');await chooseCategory(page,'业务主题','商品管理');
 await page.getByRole('button',{name:'Amazon Listing',exact:true}).click();const url=page.url();
 await page.reload();await expect(page.getByRole('heading',{name:'Amazon Listing',exact:true})).toBeVisible();expect(page.url()).toBe(url);
 const separator=page.getByRole('separator',{name:'调整对象列表宽度'});const old=Number(await separator.getAttribute('aria-valuenow'));await separator.focus();await page.keyboard.press('ArrowRight');expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(old);
 await page.getByRole('button',{name:'＋ 新建对象',exact:true}).click();await expect(page.getByLabel('业务族（L1） *',{exact:true})).toHaveValue('销售');await expect(page.getByLabel('业务域（L2） *',{exact:true})).toHaveValue('亚马逊经营');await page.keyboard.press('Escape');
 await page.getByLabel('搜索业务对象').fill('企业战略');await expect(page.getByText('没有匹配对象。请调整筛选或搜索。')).toBeVisible();await page.getByLabel('跨分类搜索').click();await expect(page.getByLabel('跨分类搜索')).toBeChecked();await page.getByRole('button',{name:'企业战略',exact:true}).click();
 await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('family')).toBe('战略与经营');
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.getByLabel('搜索业务对象')).toHaveValue('');await expect(page.getByText('当前范围 878 个对象',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'企业战略',exact:true})).toBeVisible();await expect(page.locator('.onto-object-table tr.selected')).toContainText('企业战略');await page.getByRole('button',{name:'下一页'}).click();await expect(page.locator('.onto-object-table tr.selected')).toHaveCount(1);await page.reload();await expect(page.locator('.onto-object-table tr.selected')).toHaveCount(1);await page.getByRole('button',{name:'上一页'}).click();
 await page.screenshot({path:'test-results/ontology/compact.png',fullPage:true});
});

test('object information, impacts and field details remain available without duplicate headings',async({page})=>{
 await fixture(page);await page.goto('/admin/ontology');await expect(page.getByRole('heading',{name:'属性',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'查看稳定 ID',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('数据类型');await expect(page.getByRole('dialog')).toContainText('定义依据');await page.keyboard.press('Escape');
 await page.getByLabel('对象更多操作').click();await expect(page.getByRole('link',{name:'注册表与审批治理',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'停用对象',exact:true})).toBeVisible();
 await page.getByLabel('对象更多操作').click();await page.getByRole('button',{name:'对象定义帮助',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('负责人映射');await expect(page.getByRole('dialog')).toContainText('不管理实际账号');await page.keyboard.press('Escape');
});
