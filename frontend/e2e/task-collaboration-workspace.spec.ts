import {expect,test,type Page} from "@playwright/test";

// Transport fixtures verify navigation and rendering, not production approvals.
async function workspace(page:Page) {
  let revoked=false,version="evidence-v1",posts=0;
  const counts={total:0,open:0,blocked:0,waiting_review:0,completed:0,automatic_created:0,automatic_assigned:0};
  const task={task_id:"workspace-task",title:"绑定原任务",goal:"复核当前依赖",status:"open",priority:"normal",data_version:1,workspace_allowed:true};
  const aggregate={task,counts,work_orders:[],verified_events:[],current_blocking_work_order:null};
  await page.route("**/api/tasks**",route=>route.fulfill({json:{items:[],page:{total:0,next_cursor:null}}}));
  await page.route("**/api/queries/runtime.actions**",route=>route.fulfill({json:{actions:[]}}));
  await page.route("**/api/task-work-orders/dashboard**",route=>route.fulfill({json:{summary:{tasks:{total:1,open:1,blocked:0},work_orders:counts},by_template:[],tasks:{items:[aggregate],page:{total:1,next_cursor:null}}}}));
  await page.route(/\/api\/task-work-orders\/workspace-task$/,route=>route.fulfill({json:aggregate}));
  await page.route("**/api/task-work-orders/workspace-task/workspace",route=>route.fulfill({json:{id:"workspace-session",task_id:task.task_id,replayed:true,calls_model:false}}));
  await page.route("**/api/task-work-orders/sessions/workspace-session/context",route=>revoked?route.fulfill({status:404,json:{detail:{code:"task_not_found"}}}):route.fulfill({json:{workspace:{task_id:task.task_id,title:task.title,evidence_version:version},calls_model:false,risk:"L1"}}));
  await page.route("**/api/task-work-orders/workspace-task/collaboration-context**",route=>route.fulfill({json:{task_id:task.task_id,gates:[],events:[],cursor:0,has_more:false,risk:"L1",calls_model:false,version}}));
  await page.route("**/api/task-work-orders/workspace-task/suggestions",route=>route.fulfill({json:{suggestions:[],calls_model:false}}));
  await page.route("**/api/tasks/by-session/workspace-session**",route=>route.fulfill({status:404,json:{detail:"no legacy task"}}));
  const messages=[{id:"analysis",session_id:"workspace-session",role:"assistant",kind:"task-result",created_at:"2026-10-05T07:00:00Z",payload:{type:"task_result",title:"原任务分析",summary:"依赖缺失，需要补齐发布依据",sections:[],metrics:[],task_context_id:task.task_id,task_context_version:"evidence-v1",task_context_stale:false}}];
  await page.route("**/api/sessions/workspace-session**",route=>{
    if(route.request().url().includes("/events")) return route.abort();
    if(route.request().method()==="POST") {posts++;expect(route.request().postDataJSON().intent).toBe("kol_analyze");}
    return route.fulfill({json:{id:"workspace-session",title:task.title,messages,agent_status:"listening",journey:null,run_queue:[]}});
  });
  return {revoke:()=>{revoked=true;},change:()=>{version="evidence-v2";},posts:()=>posts};
}

test("opens the original Task workspace, restores after reload, and returns to that Task without model calls",async({page})=>{
  const control=await workspace(page);
  await page.goto("/tasks?businessTask=workspace-task");
  await page.getByRole("button",{name:"打开协作工作台"}).click();
  await expect(page).toHaveURL(/\/s\/workspace-session$/);
  await expect(page.getByRole("region",{name:"当前业务任务"})).toContainText("复核当前依赖");
  await page.reload();
  await expect(page.getByRole("region",{name:"当前业务任务"})).toContainText("绑定原任务");
  expect(control.posts()).toBe(0);
  await page.locator('a[href="/tasks?businessTask=workspace-task"]').click();
  await expect(page).toHaveURL(/\/tasks\?businessTask=workspace-task$/);
  await expect(page.getByRole("dialog",{name:"AI 标准工单任务详情"})).toContainText("绑定原任务");
});

test("marks stale evidence and clears Task content on current permission revocation",async({page})=>{
  await page.clock.install();
  const control=await workspace(page);
  await page.goto("/s/workspace-session");
  await expect(page.getByRole("region",{name:"当前业务任务"})).toBeVisible();
  control.change();await page.clock.fastForward(15_100);
  await expect(page.getByRole("region",{name:"任务分析依据"})).toContainText("已有分析的依据已变化");
  expect(control.posts()).toBe(0);
  control.revoke();await page.clock.fastForward(15_100);
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("region",{name:"当前业务任务"})).toHaveCount(0);
});

test("starts only an explicitly submitted Task analysis without creating a legacy task",async({page})=>{
  const control=await workspace(page);let legacyWrites=0;
  page.on("request",request=>{if(request.method()==="POST" && /\/api\/tasks(?:\/|\?|$)/.test(request.url())) legacyWrites++;});
  await page.goto("/s/workspace-session");
  await page.getByRole("button",{name:"让 Agent 分析当前依赖"}).click();
  expect(control.posts()).toBe(0);
  await page.getByRole("button",{name:"发送",exact:true}).click();
  await expect.poll(control.posts).toBe(1);
  expect(legacyWrites).toBe(0);
});

test.describe("Task workspace width, height and touch input",()=>{
  test.use({hasTouch:true});
  for(const viewport of [{width:390,height:844},{width:1280,height:600}]) {
    test(`keeps current Task and explicit analysis accessible at ${viewport.width} x ${viewport.height}`,async({page})=>{
      await page.setViewportSize(viewport);const control=await workspace(page);
      await page.goto("/s/workspace-session");
      await expect(page.getByRole("region",{name:"当前业务任务"})).toContainText("复核当前依赖");
      const analyze=page.getByRole("button",{name:"让 Agent 分析当前依赖"});
      await analyze.scrollIntoViewIfNeeded();await expect(analyze).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth+1)).toBe(true);
      expect(control.posts()).toBe(0);
    });
  }
});
