import { expect, test, type Page } from "@playwright/test";
import type { KnowledgeBusinessTaxonomy } from "../../shared/knowledge-taxonomy.js";
const taxonomy: KnowledgeBusinessTaxonomy = { sourceVersion: "fixture", nodes: [
  ...["战略与经营", "市场", "品牌", "营销", "产品"].map((name, i) => ({ id: `B0${i + 1}`, name, level: 1, parentId: null })),
  { id: "domain_111111111111111111111111", name: "战略管理", level: 2, parentId: "B01" },
  { id: "theme_111111111111111111111111", name: "企业战略", level: 3, parentId: "domain_111111111111111111111111" },
  { id: "domain_444444444444444444444444", name: "KOL营销", level: 2, parentId: "B04" },
  { id: "theme_444444444444444444444444", name: "达人资源", level: 3, parentId: "domain_444444444444444444444444" },
], bindings: [{ baseId: "base", themeId: "theme_444444444444444444444444" }] };
const stamp = "2026-10-20T00:00:00Z";
const domains = [{id:"legacy-family",name:"未分类",code:"uncategorized",level:"family",parent_id:null,status:"active",updated_at:stamp}, {id:"kdom_legacy",name:"未分类",code:"legacy",level:"domain",parent_id:"legacy-family",status:"active",updated_at:stamp}];
const bases = [{id:"base",name:"合作资料",code:"base",domain_id:"kdom_legacy",kind:"structured",status:"active",version:1,updated_at:stamp}, {id:"old",name:"历史知识",code:"legacy",domain_id:"kdom_legacy",kind:"structured",status:"active",version:1,updated_at:stamp}];
async function fixture(page: Page) {
  const writes: string[] = [], errors: string[] = [], queries: string[] = [];
  const rows = [{id:"entry",title:"已授权的合作规则",body:"原始正文",base_id:"base",brand:"LT",kind:"policy",status:"published",published_version:1,current_version:1,favorite:false,cited:false}, {id:"old-entry",title:"原历史知识",body:"历史正文",base_id:"old",brand:"LT",kind:"policy",status:"published",current_version:1}];
  page.on("pageerror",error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const r=route.request(), u=new URL(r.url()), p=u.pathname;
    if(r.method()!=="GET") writes.push(p);
    const account={id:"test-admin",name:"测试用户",roles:["admin","employee"],available_modes:["employee","admin"]};
    let json: unknown=[];
    if(p==="/api/auth/status")json={authenticated:true,account};
    else if(p==="/api/me")json=account;
    else if(p==="/api/health")json={ok:true};
    else if(p==="/api/preferences")json={theme:"light"};
    else if(p==="/api/cron/jobs")json={jobs:[]};
    else if(p==="/api/knowledge/business-taxonomy")json=taxonomy;
    else if(p==="/api/admin/knowledge/domains")json={domains};
    else if(p==="/api/admin/knowledge/bases")json={bases};
    else if(p==="/api/knowledge")json=rows;
    else if(p==="/api/admin/knowledge/workspace-v1"){
      queries.push(u.search);
      json={tenant:"fixture",business_taxonomy:taxonomy,domains,bases,rows:u.searchParams.has("catalog_family_id")?[]:rows,total:u.searchParams.has("catalog_family_id")?0:2,page:1,page_size:20,page_count:1,
        facets:Object.fromEntries(["catalog_family","catalog_domain","catalog_theme","family","domain","base","brand","kind","view","stage"].map(key=>[key,{all:2,values:{B04:1,LT:2,policy:2,published:2}}])),
        stats:{status:{published:2},pending_review:{count:0,max_wait_days:0},pending_documents:{count:0,max_wait_days:0},expiring:{count:0,nearest:null}}};
    }
    await route.fulfill({json});
  });
  return {writes,errors,queries};
}

test("employee and admin expose identical ontology hierarchy including empty categories",async({page})=>{
  const state=await fixture(page);
  for(const path of ["/kb","/admin/knowledge"]){
    await page.goto(path);const directory=page.locator("[data-business-directory]");await expect(directory).toBeVisible();
    await expect(directory).toContainText("业务主题");await expect(directory.locator('[data-kb-scope-family="B01"]')).toBeVisible();
    await directory.getByRole("button",{name:"展开业务族"}).click();
    await expect(directory.locator('[data-kb-scope-family="B04"]')).toBeVisible();
    await directory.locator('[data-kb-scope-family="B04"]').click();
    await expect(directory.locator('[data-kb-scope-domain="domain_444444444444444444444444"]')).toBeVisible();
    await expect(directory.locator('[data-kb-scope-base="theme_444444444444444444444444"]')).toBeVisible();
    await expect(directory.locator('[data-kb-scope-base="theme_111111111111111111111111"]')).toHaveCount(0);
    await page.screenshot({path:`test-results/business-directory-${path.startsWith("/admin")?"admin":"employee"}.png`});
  }
  expect(state.queries.some(query=>query.includes("catalog_family_id=B04"))).toBe(true);
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test("planning reads canonical themes, keeps legacy containers separate, and cancellation does not mutate",async({page})=>{
  const state=await fixture(page);await page.goto("/admin/knowledge?stage=catalog");
  const planning=page.locator("[data-business-catalog]");await expect(planning).toBeVisible();await expect(planning.locator("[data-business-catalog-summary]")).toContainText("5 个业务族 · 2 个业务域 · 2 个业务主题");
  await planning.getByRole("textbox",{name:"搜索知识规划"}).fill("达人资源");
  await planning.locator('[data-business-node="theme_444444444444444444444444"]').click();
  await expect(planning.locator('[data-business-base="base"]')).toContainText("合作资料");
  await planning.getByRole("button",{name:"新建知识库",exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await expect(dialog.getByRole("combobox",{name:"业务主题"})).toHaveValue("theme_444444444444444444444444");
  await dialog.getByRole("button",{name:"取消",exact:true}).click();
  await planning.getByRole("button",{name:"未归类知识库（1）"}).click();await expect(planning.locator('[data-business-base="old"]')).toContainText("历史知识");
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test("directory remains keyboard reachable and no horizontal overflow on narrow viewports",async({page})=>{
  const state=await fixture(page);
  for(const width of [1440,768,375]){await page.setViewportSize({width,height:800});await page.goto("/kb");
    const more=page.getByRole("button",{name:"展开业务族"});await more.focus();await page.keyboard.press("Enter");
    await expect(page.locator('[data-kb-scope-family="B05"]')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);
});
