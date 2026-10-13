import { expect, test, type Page } from "@playwright/test";

// HTTP fixtures verify presentation and request boundaries, not production identity/MCP execution.
async function fixture(page: Page, options: { agentsFail?: boolean; versionChanged?: boolean; noSessions?: boolean; sessionDenied?: boolean; favoriteFail?: boolean; delayRead?: number } = {}) {
  const writes: string[] = [], errors: string[] = [];
  const skills = Array.from({length:35},(_,i) => ({id:`skill-${i}`,title:`合作技能 ${i+1}`,label:`合作技能 ${i+1}`,summary:`完整技能说明 ${i+1}`,
    funnel:i % 2 ? "sample" : "reach",badge:"SOP",employee_visible:true,risk:i===1 ? "L3" : "L1",keeps_stage:true,
    employee_quick:"读取授权的合作资料",employee_agent:"起草建议后由员工确认",employee_example:["示例：准备合作方案"],
    output:"draft",learning:{inputs:["合作对象"],steps:["核实目标","读取资料","形成建议"],result:"draft",confirmation:"执行前确认"},
    execution:{tools:[{ref:"starrykol.getCreator",risk:"L1"}],permissions:["kol:read"],receipt_required:true,async:{enabled:i===1,cancelable:true,retryable:true}}}));
  const personal = skills.map((s,i) => ({skill_id:s.id,favorite:false,viewed_at:null as string|null,use_count:i===1?3:0,used_at:i===1?"2026-10-12T08:00:00Z":null}));
  const knowledge = Array.from({length:35},(_,i) => ({id:`kb-${i}`,title:`合作知识 ${i+1}`,body:`完整资料正文 ${i+1}`,kind:i===1 ? "mail_template" : "document",status:"published",
    subject:i===1?"邮件主题":undefined,brand:"LT",stage_codes:["INITIAL_CONTACT"],current_version:1,published_version:1,created_by:"发布人",
    favorite:false,cited:false,updated_at:"2026-10-08T08:00:00Z"}));
  page.on("pageerror",error => errors.push(error.message));
  await page.route("**/api/**",async route => {
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if (request.method()!=="GET") writes.push(`${request.method()} ${path}`);
    let json: unknown=[];
    if(path==="/api/health") json={ok:true};
    else if(path==="/api/auth/status") json={authenticated:true,account:{id:"employee",name:"员工",available_modes:["employee"]}};
    else if(path==="/api/me") json={id:"employee",name:"员工",available_modes:["employee"]};
    else if(path==="/api/preferences") json={theme:"light"};
    else if(path==="/api/skills") json=skills;
    else if(path==="/api/skills/personal") json={items:personal};
    else if(/^\/api\/skills\/skill-\d+\/agents$/.test(path)) {
      if(options.agentsFail) return route.fulfill({status:503,json:{detail:"授权服务不可用"}});
      json={agents:[{id:"agent:chosen",name:"合作专员"}]};
    } else if(/^\/api\/skills\/skill-\d+\/favorite$/.test(path)) {
      if(options.favoriteFail) return route.fulfill({status:503,json:{detail:"保存失败"}});
      const row=personal.find(row=>path.includes(`/${row.skill_id}/`))!;row.favorite=request.method()==="POST";json={id:row.skill_id,favorite:row.favorite};
    } else if(/^\/api\/skills\/skill-\d+\/view$/.test(path)) {
      const row=personal.find(row=>path.includes(`/${row.skill_id}/`))!;row.viewed_at=new Date().toISOString();json={id:row.skill_id};
    } else if(/^\/api\/skills\/skill-\d+$/.test(path)) json={...skills.find(row=>path.endsWith(`/${row.id}`)),employee_doc:"### 用法\n完整说明书\n- 示例步骤"};
    else if(path==="/api/knowledge") {
      const q=url.searchParams.get("q");json=q ? knowledge.filter(row=>row.title.includes(q)||row.body.includes(q)) : knowledge;
    } else if(path==="/api/knowledge/taxonomy") json={domains:[],bases:[]};
    else if(/^\/api\/knowledge\/kb-\d+\/(cite|favorite)$/.test(path)) {
      const row=knowledge.find(row=>path.includes(`/${row.id}/`))!;
      if(path.endsWith("favorite")) row.favorite=request.method()==="POST";else row.cited=true;
      json=row;
    } else if(/^\/api\/knowledge\/kb-\d+$/.test(path)) {
      if(options.delayRead) await new Promise(resolve=>setTimeout(resolve,options.delayRead));
      json={...knowledge.find(row=>path.endsWith(`/${row.id}`)),current_version:options.versionChanged?2:1,published_version:options.versionChanged?2:1};
    }
    else if(path==="/api/sessions") json=options.noSessions?[]:[{id:"ses_ctx",title:"当前合作任务"}];
    else if(path==="/api/sessions/ses_ctx") {
      if(options.sessionDenied)return route.fulfill({status:403,json:{detail:"任务访问资格已撤销"}});
      json={messages:[],agent_status:"listening"};
    } else if(path==="/api/task-work-orders/sessions/ses_ctx/context") json={workspace:null};
    else if(path==="/api/tasks/by-session/ses_ctx") json={id:"task-ctx",session_id:"ses_ctx",title:"当前合作任务",skill:"stage_sop",task_type:"general",status:"pending",created_at:"2026-10-13"};
    else if(path.includes("/events")) json={events:[]};
    else if(path==="/api/knowledge/composer") json=knowledge;
    else if(path==="/api/experts") json=[];
    else if(path==="/api/cron/jobs") json={jobs:[]};
    else if(path==="/api/queries/runtime.actions") json={actions:[]};
    await route.fulfill({json});
  });
  return {writes,errors,skills,personal,knowledge};
}
async function seedDraft(page:Page) {
  await page.evaluate(()=>sessionStorage.setItem("workspace:asset-draft:employee:ses_ctx",JSON.stringify({
    target:{sessionId:"ses_ctx",path:"/s/ses_ctx",title:"当前合作任务"},
    draft:{text:"已经填写的合作需求",attachments:[{path:"/file/context.pdf",name:"合作资料.pdf"}],object_refs:[{kind:"kol",id:"object-a",label:"当前红人"}],
      model_tier:"quality",scope:{expert_id:"agent:chosen"},chips:[]}})));
  await page.evaluate(()=>sessionStorage.setItem("workspace:asset-draft:employee:last",JSON.stringify({sessionId:"ses_ctx",path:"/s/ses_ctx",title:"当前合作任务"})));
}

test("skills and knowledge share actual column geometry, row height, controls and empty detail",async({page})=>{
  const state=await fixture(page);
  const geometry=[];
  for(const path of ["/kb","/skills"]){
    await page.goto(path);await expect(page.locator(".knowledge-list-row").first()).toBeVisible();
    await expect(page.locator(".kbv-rail")).toContainText("从列表选择");
    const list=await page.locator("[data-kbv-list]").boundingBox(), detail=await page.locator(".kbv-rail").boundingBox();
    geometry.push([list!.x,list!.width,detail!.x,detail!.width]);
    expect((await page.locator(".knowledge-list-row").first().boundingBox())!.height).toBe(36);
    expect((await page.locator(".workspace-search-input").boundingBox())!.height).toBe(32);
    await page.locator(".knowledge-list-open").first().click();
    expect((await page.locator("[data-asset-use]").boundingBox())!.height).toBe(28);
    await expect(page.locator(".kbv-title-row h2")).toHaveCSS("font-size","13px");
    await expect(page.locator(".knowledge-row-title").first()).toHaveCSS("font-size","13px");
    await expect(page.locator(".skill-tabs,.skill-catalog-main")).toHaveCount(0);
    await page.screenshot({path:`test-results/asset-${path.slice(1)}-desktop.png`});
  }
  expect(geometry[0]).toEqual(geometry[1]);expect(state.errors).toEqual([]);
});

test("favorites persist, views remain separate from real use, and legacy scene links combine with all modes",async({page})=>{
  const state=await fixture(page);await page.goto("/skills?tab=sample");
  await page.locator('[data-skill-open="skill-1"]').click();
  await page.locator('[data-skill-favorite="skill-1"]').click();await expect(page.locator('[data-skill-favorite="skill-1"]')).toHaveAttribute("aria-pressed","true");
  await page.locator('[data-skill-view="favorites"]').click();await expect(page.locator("[data-skill-id]")).toHaveCount(1);
  await page.reload();await expect(page.locator('[data-skill-favorite="skill-1"]')).toHaveAttribute("aria-pressed","true");
  await page.locator('[data-skill-view="viewed"]').click();await expect(page.locator("[data-skill-id]")).toHaveCount(1);
  expect(state.personal.find(row=>row.skill_id==="skill-1")!.use_count).toBe(3);
  await page.getByRole("combobox",{name:"更多技能视图"}).click();await page.getByText("常用",{exact:true}).click();
  await expect(page).toHaveURL(/mode=frequent.*stage=sample/);await expect(page.locator("[data-skill-id]")).toHaveCount(1);
  expect(state.errors).toEqual([]);
});

test("skill detail retains full use instructions, examples, inputs, outputs and async boundaries",async({page})=>{
  await fixture(page);await page.goto("/skills");await page.locator('[data-skill-open="skill-1"]').click();
  const detail=page.locator("[data-skill-detail]");
  for(const text of ["完整技能说明 2","合作专员","合作对象","核实目标","R3 · 执行前确认","可取消","可重试","执行前确认"])
    await expect(detail).toContainText(text);
  await detail.locator("summary").filter({hasText:"说明书与示例"}).click();await expect(detail).toContainText("完整说明书");await expect(detail).toContainText("准备合作方案");
  await detail.locator("summary").filter({hasText:"调用关系与安全边界"}).click();await expect(detail).toContainText("操作回执");
});

test("skill handoff keeps the original session, text, attachment, object, Agent and model without starting a run",async({page})=>{
  const state=await fixture(page);await page.goto("/skills");await seedDraft(page);await page.reload();
  await page.locator('[data-skill-open="skill-0"]').click();await expect(page.locator("[data-asset-use]")).toBeEnabled();await page.locator("[data-asset-use]").click();
  await expect(page).toHaveURL(/\/s\/ses_ctx$/);
  await expect(page.locator(".composer textarea")).toHaveValue("已经填写的合作需求");
  await expect(page.locator('[data-skill-chip="skill-0"]')).toBeVisible();await expect(page.locator('[data-attachment-name="合作资料.pdf"]')).toBeVisible();
  await expect(page.locator('[data-composer-draft-chip="object-a"]')).toBeVisible();
  const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("workspace:asset-draft:employee:ses_ctx")||"{}"));
  expect(stored.draft.scope.expert_id).toBe("agent:chosen");expect(stored.draft.model_tier).toBe("quality");
  expect(state.writes.every(path=>path.endsWith("/view"))).toBe(true);expect(state.errors).toEqual([]);
});

test("knowledge handoff carries a versioned reference and leaves user text intact",async({page})=>{
  const state=await fixture(page);await page.goto("/kb");await seedDraft(page);await page.reload();
  await page.locator('[data-kb-open="kb-0"]').click();await page.locator("[data-asset-use]").click();await expect(page).toHaveURL(/\/s\/ses_ctx$/);
  await expect(page.locator(".composer textarea")).toHaveValue("已经填写的合作需求");await expect(page.locator('[data-knowledge-chip="kb-0"]')).toBeVisible();
  expect(state.writes).toEqual(["POST /api/knowledge/kb-0/cite"]);expect(state.errors).toEqual([]);
});

test("changed knowledge versions keep the catalogue and draft without writes",async({page})=>{
  const state=await fixture(page,{versionChanged:true});await page.goto("/kb");await seedDraft(page);await page.reload();
  await page.locator('[data-kb-open="kb-0"]').click();await page.locator("[data-asset-use]").click();
  await expect(page.getByRole("alert")).toContainText("新版本");await expect(page).toHaveURL(/\/kb$/);expect(state.writes).toEqual([]);
});

test("revoked target access keeps selection and does not hand off or execute",async({page})=>{
  const state=await fixture(page,{sessionDenied:true});await page.goto("/skills");await seedDraft(page);await page.reload();
  await page.locator('[data-skill-open="skill-0"]').click();await page.locator("[data-asset-use]").click();
  await expect(page.locator(".asset-action-error")).toContainText("访问资格已撤销");await expect(page).toHaveURL(/\/skills$/);
  expect(state.writes).toEqual(["POST /api/skills/skill-0/view"]);
});

test("editing an actual session then returning from catalogue preserves the live draft",async({page})=>{
  const state=await fixture(page);await page.goto("/s/ses_ctx");
  await page.locator(".composer textarea").fill("从原会话填写的需求");
  await page.getByRole("link",{name:"技能",exact:true}).click();await page.locator('[data-skill-open="skill-0"]').click();
  await expect(page.locator("[data-asset-use]")).toBeEnabled();await page.locator("[data-asset-use]").click();
  await expect(page).toHaveURL(/\/s\/ses_ctx$/);await expect(page.locator(".composer textarea")).toHaveValue("从原会话填写的需求");
  expect(state.writes).toEqual(["POST /api/skills/skill-0/view"]);expect(state.errors).toEqual([]);
});

test("version changes after handoff stop submission and retain the text",async({page})=>{
  const options={versionChanged:false};const state=await fixture(page,options);await page.goto("/kb");await seedDraft(page);await page.reload();
  await page.locator('[data-kb-open="kb-0"]').click();await page.locator("[data-asset-use]").click();await expect(page).toHaveURL(/\/s\/ses_ctx$/);
  options.versionChanged=true;await page.locator(".composer button[data-send]").click();
  await expect(page.locator(".composer-err")).toContainText("引用资料已变更");await expect(page.locator(".composer textarea")).toHaveValue("已经填写的合作需求");
  expect(state.writes).toEqual(["POST /api/knowledge/kb-0/cite"]);
});

test("authorization failure is distinct from no eligible Agent and does not enable use",async({page})=>{
  await fixture(page,{agentsFail:true});await page.goto("/skills");await page.locator('[data-skill-open="skill-0"]').click();
  await expect(page.getByRole("alert")).toContainText("可用数字员工读取失败");await expect(page.locator("[data-asset-use]")).toBeDisabled();
  await expect(page.locator("[data-skill-detail]")).not.toContainText("暂无你可使用");
});

test("failed favorite does not claim success",async({page})=>{
  await fixture(page,{favoriteFail:true});await page.goto("/skills");await page.locator('[data-skill-open="skill-0"]').click();await page.locator('[data-skill-favorite="skill-0"]').click();
  await expect(page.getByRole("alert")).toContainText("收藏未保存");await expect(page.locator('[data-skill-favorite="skill-0"]')).toHaveAttribute("aria-pressed","false");
});

test("narrow layout returns to the same filter, selected row and focus; refresh preserves search",async({page})=>{
  await fixture(page);await page.setViewportSize({width:600,height:720});await page.goto("/skills?mode=all&stage=sample");
  await page.getByRole("textbox",{name:"搜索技能 / SOP / 场景"}).fill("技能 2");await page.reload();
  await expect(page.getByRole("textbox",{name:"搜索技能 / SOP / 场景"})).toHaveValue("技能 2");
  await page.locator('[data-skill-open="skill-1"]').click();await expect(page.locator("[data-kbv-list]")).toBeHidden();
  await page.getByRole("button",{name:"返回列表"}).click();await expect(page.locator('[data-skill-open="skill-1"]')).toBeFocused();
  await expect(page.locator('[data-skill-stage="sample"]')).toHaveAttribute("aria-pressed","true");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
});

test("no target task means no automatic session creation or execution",async({page})=>{
  const state=await fixture(page,{noSessions:true});await page.goto("/skills");await page.locator('[data-skill-open="skill-0"]').click();
  await expect(page.locator("[data-asset-use]")).toBeDisabled();await expect(page.locator("[data-skill-detail]")).toContainText("暂无可继续的任务");
  expect(state.writes).toEqual(["POST /api/skills/skill-0/view"]);
});


test("canceling an in-flight version check leaves the draft and prevents late submission",async({page})=>{
  const options={delayRead:0};const state=await fixture(page,options);await page.goto("/kb");await seedDraft(page);await page.reload();
  await page.locator('[data-kb-open="kb-0"]').click();await page.locator("[data-asset-use]").click();await expect(page).toHaveURL(/\/s\/ses_ctx$/);
  options.delayRead=600;await page.locator(".composer button[data-send]").click();await page.getByRole("button",{name:"取消核验"}).click();
  await expect(page.locator(".composer textarea")).toHaveValue("已经填写的合作需求");await expect(page.locator(".composer button[data-send]")).toBeEnabled();
  await page.waitForTimeout(700); // Covers the intentionally delayed, now-aborted response, not a loading-state shortcut.
  expect(state.writes).toEqual(["POST /api/knowledge/kb-0/cite"]);
});
