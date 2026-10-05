import { test,expect,type Page } from "@playwright/test";
import { knowledgeReviewDefinition } from "../../shared/review";

// Browser interaction fixtures only. Native PostgreSQL review/publish and
// authenticated PDF/trial boundaries are covered by knowledge-publication.test.ts.
async function fixture(page:Page,missing=false){
  const doc={id:"publication-pdf",base_id:"publication-base",title:"产品规格",filename:"规格.pdf",status:"pending_review",updated_at:"2026-10-05T00:00:00Z",created_at:"2026-10-05T00:00:00Z"};
  const definition=knowledgeReviewDefinition();
  const template={id:"publication-flow",version:1,publishedVersion:1,enabled:true,definition,updatedAt:doc.updated_at};
  let state={tenant:"test",base_id:doc.base_id,version:1,label:"待提交审批",review_status:"not_submitted",publication_status:"unpublished",
    fields:[{id:"model",label:"产品型号",type:"text",required:true}],
    blocking_reason:missing ? "尚未配置知识发布审批流程" : "",binding:missing ? null : {template_id:template.id,version:1,name:definition.name},allowed_actions:missing ? [] : ["submit"],instance_id:null as string|null,error:null as string|null,attempts:0};
  const commands:any[]=[],actions:string[]=[];
  let failOnce=false;
  await page.route("**/api/admin/knowledge**",async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p==="/api/admin/knowledge")return route.fulfill({json:[]});
    if(p.endsWith("/domains"))return route.fulfill({json:{domains:[]}});
    if(p.endsWith("/bases"))return route.fulfill({json:{bases:[{id:doc.base_id,name:"产品库",kind:"unstructured",status:"active"}]}});
    if(p.endsWith("/documents"))return route.fulfill({json:{documents:[doc]}});
    if(p.endsWith(`/documents/${doc.id}`))return route.fulfill({json:{document:doc,jobs:[],text_preview:null}});
    if(p.endsWith("/publication"))return route.fulfill({json:state});
    if(p.endsWith("/publication-execute")){actions.push("publish");state={...state,label:"已发布",publication_status:"published",allowed_actions:["view_review","create_revision"]};return route.fulfill({json:{publication_status:"published"}});}
    if(p.endsWith("/review-prepare"))return route.fulfill({json:{confirmationId:"prepared",command:{action:"submit",templateId:template.id,templateVersion:1,title:"发布产品规格",values:{...route.request().postDataJSON().values,knowledge_request:"frozen-request",publication_note:route.request().postDataJSON().note}},
      material:{title:doc.title,base_name:"产品库",pages:16,version:1},summary:{reviewers:["reviewer"],consequence:"审批通过后将自动发布此版本；不会自动重跑原咨询任务。"}}});
    if(p.endsWith("/publication-flow")){actions.push("bind");state={...state,binding:{template_id:template.id,version:1,name:definition.name},blocking_reason:"",allowed_actions:["submit"]};return route.fulfill({json:{bound:true}});}
    if(p.endsWith("/publication-retry")){actions.push("retry");state={...state,label:"已批准·等待发布",publication_status:"queued",allowed_actions:["view_review","create_revision"],error:null};return route.fulfill({json:{queued:true}});}
    return route.fulfill({status:404,json:{detail:"unknown UI fixture"}});
  });
  await page.route("**/api/admin/approval-types/v2/**",route=>route.fulfill({json:missing ? [] : [template]}));
  await page.route("**/api/approvals/v2/**",async route=>{
    const p=new URL(route.request().url()).pathname.split("/v2/")[1];
    if(p==="companies")return route.fulfill({json:[{id:"test",name:"测试组织"}]});
    if(p==="context")return route.fulfill({json:{tenant:"test",actor:"owner",admin:true,people:[{id:"owner",name:"资料管理员",managerIds:[]},{id:"reviewer",name:"资料审核人",managerIds:[]}]}});
    if(p?.startsWith("instance-page"))return route.fulfill({json:{items:[],nextCursor:null}});
    if(p==="commands"){
      commands.push(route.request().postDataJSON());
      if(failOnce){failOnce=false;return route.fulfill({status:503,json:{detail:"临时连接失败，请重试"}});}
      state={...state,label:"审批中",review_status:"reviewing",allowed_actions:["view_review","create_revision"],instance_id:"publication-instance"};
      return route.fulfill({json:{resourceId:"publication-instance",id:"receipt",version:1}});
    }
    return route.fulfill({json:[]});
  });
  await page.goto(`/admin/knowledge?document=${doc.id}&reviewCompany=test`);
  const panel=page.locator("[data-knowledge-publication]");await expect(panel).toContainText(state.label);
  return {panel,commands,actions,setFail:()=>{failOnce=true;},setState:(s:Partial<typeof state>)=>{state={...state,...s};}};
}

test("缺流程保留资料并引导新建专用流程，系统字段不可改",async({page})=>{
  const f=await fixture(page,true);await expect(f.panel).toContainText("尚未配置知识发布审批流程");
  await expect(f.panel.getByRole("button",{name:"提交审批",exact:true})).toHaveCount(0);
  await f.panel.getByText("配置知识发布流程",{exact:true}).click();
  await f.panel.getByRole("link",{name:"新建审批流程"}).click();
  await page.getByRole("button",{name:"新建流程",exact:true}).click();
  await expect(page.getByLabel("流程名称")).toHaveValue("知识发布审批");
  await page.getByRole("button",{name:"填写表单字段",exact:true}).click();
  await expect(page.getByLabel("字段名称").first()).toBeDisabled();
  await page.getByRole("button",{name:"添加字段",exact:true}).click();
  await page.getByRole("button",{name:"添加字段",exact:true}).click();
  await expect(page.locator(".review-field-row")).toHaveCount(4);
  await expect(page.getByLabel("字段名称").last()).toBeEnabled();
  expect(f.commands).toHaveLength(0);
  await expect(page.getByRole("button",{name:"返回上一页",exact:true})).toBeVisible();
});

test("提交明确确认、取消无副作用、失败重试保留幂等键并链接真实审批",async({page})=>{
  const f=await fixture(page);await f.panel.getByLabel("发布说明").fill("核对产品规格后发布");
  await f.panel.getByLabel("产品型号").fill("LT-100");
  await f.panel.getByRole("button",{name:"提交审批",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"确认提交知识发布审批"});
  await expect(dialog).toContainText("16页");await expect(dialog).toContainText("资料审核人");
  await expect(dialog).toContainText("LT-100");
  await dialog.locator("[data-admin-confirm-cancel]").click();expect(f.commands).toHaveLength(0);
  await f.panel.getByRole("button",{name:"提交审批",exact:true}).click();f.setFail();
  await dialog.getByRole("button",{name:"确认提交审批",exact:true}).click();await expect(dialog).toContainText("临时连接失败");
  await dialog.getByRole("button",{name:"确认提交审批",exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(f.commands).toHaveLength(2);expect(f.commands[0].idempotencyKey).toBe(f.commands[1].idempotencyKey);
  expect(f.commands[0].command.values.model).toBe("LT-100");
  await expect(f.panel).toContainText("审批中");await expect(f.panel.getByRole("link",{name:/查看本次审批/})).toHaveAttribute("href","/reviews/publication-instance?reviewCompany=test");
});

test("已批准的失败发布可恢复，重新进入页面仍展示发布状态",async({page})=>{
  const f=await fixture(page);f.setState({review_status:"approved",publication_status:"failed",label:"已批准·发布失败",instance_id:"publication-instance",allowed_actions:["view_review","retry_publication","create_revision"],error:"索引产物暂不可读",attempts:3});
  await page.reload();await expect(f.panel).toContainText("已批准·发布失败");
  await f.panel.getByRole("button",{name:"重试已批准版本的发布"}).click();
  await page.getByRole("dialog",{name:"确认重试发布"}).getByRole("button",{name:"确认重试发布",exact:true}).click();
  await expect(f.panel).toContainText("已批准·等待发布");
  expect(f.actions).toEqual(["retry"]);expect(f.commands).toHaveLength(0);
  await page.reload();await expect(f.panel).toContainText("已批准·等待发布");
});

test("审核页展示冻结原件、限定版本试算和发布时间",async({page})=>{
  await page.route("**/api/approvals/v2/**", route => {
    const path = new URL(route.request().url()).pathname.split("/v2/")[1];
    if (path === "companies") return route.fulfill({ json: [{ id: "test", name: "测试组织" }] });
    if (path === "context") return route.fulfill({ json: { tenant: "test", actor: "owner", admin: false, people: [{ id: "owner", name: "资料管理员", managerIds: [] }] } });
    if (path === "instance-page") return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ json: [] });
  });
  const id="publication-instance",definition=knowledgeReviewDefinition(),trials:any[]=[];
  await page.route(`**/api/approvals/v2/instances/${id}**`,async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith("/trial")){trials.push(route.request().postDataJSON());return route.fulfill({json:{answer:"规格试算结果",scope:"仅本次审批版本",citations:[{page:2,source_url:`/api/approvals/v2/instances/${id}/knowledge/file?company=test#page=2`}]}});}
    if(p.endsWith("/knowledge"))return route.fulfill({json:{title:"产品规格",pages:16,version:1,publication_status:"published",error:null,receipt:{published_at:"2026-10-05T08:00:00Z"}}});
    return route.fulfill({json:{id,templateId:"publication-flow",templateVersion:1,version:2,requester:"owner",title:"产品规格发布",definition,values:{knowledge_request:"hidden-token",publication_note:"已核对"},currentNode:"end",status:"approved",tasks:[],createdAt:"2026-10-05T00:00:00Z",updatedAt:"2026-10-05T00:00:00Z",allowedActions:[]}});
  });
  await page.goto(`/reviews/${id}?reviewCompany=test`);
  const material=page.getByRole("region",{name:"审批资料版本"});await expect(material).toContainText("16页");
  await expect(page.getByText("hidden-token",{exact:true})).toHaveCount(0);
  await material.getByText("本次资料版本试算",{exact:true}).click();await material.getByLabel("试算问题").fill("额定容量？");
  await material.getByRole("button",{name:"试算",exact:true}).click();await expect(material).toContainText("规格试算结果");
  expect(trials).toEqual([{query:"额定容量？"}]);
  await expect(material.getByRole("link",{name:"原文第2页"})).toHaveAttribute("href",/knowledge\/file\?company=test#page=2/);
  await expect(material).toContainText("发布时间：");
  await expect(material.getByText("发布回执",{exact:true})).toHaveCount(0);
});

test("已批准版本可立即发布，取消不写入，也不要求填写回执",async({page})=>{
  const f=await fixture(page);
  f.setState({review_status:"approved",publication_status:"queued",label:"已批准·等待发布",instance_id:"publication-instance",allowed_actions:["publish_approved","view_review","create_revision"]});
  await page.reload();await f.panel.getByRole("button",{name:"立即发布",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"确认发布",exact:true});
  await expect(dialog).toContainText("可供员工问答使用");
  await dialog.locator("[data-admin-confirm-cancel]").click();expect(f.actions).toEqual([]);
  await f.panel.getByRole("button",{name:"立即发布",exact:true}).click();
  await dialog.getByRole("button",{name:"确认发布",exact:true}).click();
  await expect(f.panel).toContainText("已发布");
  await expect(f.panel.getByRole("button",{name:"立即发布",exact:true})).toHaveCount(0);
  expect(f.actions).toEqual(["publish"]);expect(f.commands).toHaveLength(0);
});
