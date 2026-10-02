const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const results=[];
 const open=async mode=>page.goto('file:///'+path.join(__dirname,`space-3-${mode}.html`).replaceAll('\\','/'));
 await open('employee');
 assert.equal(await page.locator('.nav-item').count(),12);
 assert.equal(await page.locator('.record').count(),24);
 await page.locator('#search').fill('红人筛选');assert.equal(await page.locator('.record').count(),1);
 await page.locator('#favorite').click();assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'false');
 await page.locator('#use').click();assert.equal(await page.locator('.primary').count(),1);
 await page.locator('#confirm-use').click();assert.equal(await page.locator('dialog').isVisible(),false);
 await page.locator('#reset').click();await page.locator('#category').click();await page.locator('#tree-search').fill('安装售后');
 await page.locator('[data-topic="安装售后"]').click();assert.equal(await page.locator('.record').count(),1);
 await page.locator('#reset').click();await page.screenshot({path:path.join(__dirname,'space-3-employee.png')});
 results.push('员工：12 项菜单、24 条发布示例、搜索、收藏、分类筛选、任务引用确认通过');
 await open('admin');assert.equal(await page.locator('.nav-item').count(),10);assert.equal(await page.locator('.record').count(),48);
 await page.locator('[data-view="待审核"]').click();assert.equal(await page.locator('.record').count(),12);
 await page.locator('#review').click();await page.locator('#publish').click();assert.ok(await page.locator('#review-error').textContent());
 await page.locator('#review-note').fill('已核对示例内容与范围');await page.locator('#publish').click();assert.equal(await page.locator('.record').count(),11);
 await page.locator('#new').click();await page.locator('#save').click();assert.ok(await page.locator('#edit-error').textContent());
 await page.locator('#edit-title').fill('冒烟测试草稿');await page.locator('#edit-body').fill('仅用于交互测试');await page.locator('#save').click();
 assert.equal(await page.locator('.rail h2').textContent(),'冒烟测试草稿');
 await page.locator('#reset').click();await page.locator('[data-view="已发布"]').click();await page.locator('#edit').click();
 await page.locator('#edit-body').fill('新增修订内容');await page.locator('#save').click();
 assert.match(await page.locator('.subtitle').textContent(),/草稿/);
 results.push('管理：10 项菜单、48 条示例、审核必填校验与发布、新建草稿、已发布版本保留并新建修订草稿通过');
 await open('admin');await page.screenshot({path:path.join(__dirname,'space-3-admin.png')});
 for(const mode of ['employee','admin']) for(const [width,height] of [[1920,1080],[1440,900],[1100,800],[860,700],[768,1024],[390,844],[1280,600]]){
  await page.setViewportSize({width,height});await open(mode);
  const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,primary:[...document.querySelectorAll('.primary')].filter(x=>x.getBoundingClientRect().width>0).length,side:getComputedStyle(document.querySelector('.side')).width,title:getComputedStyle(document.querySelector('h1')).fontSize}));
  assert.ok(dims.scroll<=dims.width,`${mode} overflow at ${width}: ${dims.scroll}`);assert.ok(dims.primary<=1,`${mode} multiple primary`);assert.equal(dims.title,'16px');
  if(width===390){await page.locator('.mobile-menu').click();assert.equal(await page.locator('.side').isVisible(),true);await page.locator('.mobile-close').click();await page.screenshot({path:path.join(__dirname,`space-3-${mode}-mobile.png`),fullPage:true})}
 }
 assert.deepEqual(errors,[]);results.push('两端 7 档视口：无横向溢出、最多一个主 CTA、16px 页面标题、移动导航通过；无浏览器异常');
 fs.writeFileSync(path.join(__dirname,'space-3-smoke-results.json'),JSON.stringify({date:new Date().toISOString(),scope:'Static prototype only; no production API or authorization tests',results},null,2));
 console.log(results.join('\n'));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
