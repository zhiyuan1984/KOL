import { expect, test, type Page } from "@playwright/test";

async function surface(page: Page, status = "pending_review", legacy = false) {
  const account = { id: "admin", name: "管理员", available_modes: ["admin", "employee"] };
  const base = { id: "specs", name: "产品规格", kind: "unstructured", family_id: "ipd", family_name: "ipd", domain_id: "battery", domain_name: "电池" };
  let doc = { id: "pdf", base_id: base.id, title: "NETC-50160116-A5-102储能型产品规格书", filename: "NETC-50160116-A5-102储能型产品规格书.pdf", media_type: "pdf", size_bytes: 2000, status, retry_count: 0, created_by: "管理员", created_at: "2026-10-05T01:00:00Z", updated_at: "2026-10-05T02:00:00Z", error: status === "failed" ? "索引服务不可用，请恢复连接后重试" : "" };
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `text-${i}`, title: `合作知识 ${i + 1}`, kind: "policy", body: "授权知识正文", current_version: 1, status: "published", brand: "LT", stage_codes: [], created_by: "知识负责人", updated_at: "2026-10-05T01:00:00Z" }));
  const calls: string[] = [], errors: string[] = [];
  let failPublish = false, failList = false, detailReads = 0;
  let publication:Record<string,unknown>|null=status === "published" ? {tenant:"company",instanceId:"review-1",documentId:"pdf",filename:doc.filename,fingerprint:"published-version",status:"published",reviewStatus:"approved",receipt:{id:"publish-receipt",status:"published",at:doc.updated_at}} : null;
  let checkAllowed=true;
  const definition={schema:"review.definition.v1",name:"知识发布审批",description:"",fields:[],nodes:[{id:"start",name:"开始",type:"start",next:"review"},{id:"review",name:"评审",type:"review",next:"end",mode:"single",reject:"any_reject",assignee:{kind:"named",userIds:["reviewer"]}},{id:"end",name:"结束",type:"end"}]};
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/admin/knowledge") {
      if (failList) return route.fulfill({ status: 503, json: { detail: "知识服务暂不可用" } });
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const created = { ...rows[0], ...body, id: "created", status: "draft" };
        rows.push(created); json = created;
      } else json = rows;
    } else if (path === "/api/admin/knowledge/bases") json = { bases: [{ ...base, status: "active" }, { id: "structured", name: "历史知识", kind: "structured", code: "legacy", status: "active" }] };
    else if (path === "/api/admin/knowledge/domains") json = { domains: [{ id: "ipd", name: "ipd", level: "family" }, { id: "battery", name: "电池", level: "domain", parent_id: "ipd" }] };
    else if (path === "/api/admin/knowledge/documents") json = { documents: [{...doc, publication_label:doc.status==="pending_review"?(publication?"审批中":"解析完成 · 待提交审批"):undefined}] };
    else if (path === "/api/admin/knowledge/documents/pdf/publication-v2") json=legacy?{tenant:"company",legacy:{updatedAt:doc.updated_at},templates:[],publication:null,intake:{allowed:true,reason:""}}:{tenant:"company",templates:[{id:"knowledge-release",version:1,definition}],publication,intake:{allowed:true,reason:""}};
    else if(path==="/api/admin/knowledge/documents/pdf/publication") json={tenant:"company",base_id:"specs",version:1,review_status:publication?"reviewing":"not_submitted",publication_status:"unpublished",blocking_reason:"",allowed_actions:publication?["view_review"]:["submit"],instance_id:publication?"review-1":null,error:null,attempts:0,binding:{template_id:"knowledge-release",version:1,name:"知识发布审批"},fields:[]};
    else if(path==="/api/approvals/v2/context") json={tenant:"company",actor:"admin",admin:true,people:[]};
    else if(path==="/api/admin/approval-types/v2/templates") json=[{id:"knowledge-release",publishedVersion:1,version:1,definition:{...definition,subjectType:"knowledge_publication"}}];
    else if(path==="/api/admin/knowledge/documents/pdf/review-check") json={allowed:checkAllowed,reason:checkAllowed?"":"无法解析合格评审人，或发起人与评审人冲突",reviewers:checkAllowed?["评审人"]:[]};
    else if(path==="/api/admin/knowledge/documents/pdf/review-prepare") json={confirmationId:"confirmed",command:{action:"submit",templateId:"knowledge-release",templateVersion:1,title:doc.title,values:{publication_note:route.request().postDataJSON().note,knowledge_request:"material"}},material:{title:doc.title,base_name:"产品规格",pages:1,version:1},summary:{consequence:"审批通过后由服务端发布",reviewers:["评审人"]}};
    else if(path==="/api/approvals/v2/commands") {calls.push("submit");publication={instanceId:"review-1",status:"waiting"};json={resourceId:"review-1"};}
    else if (path === "/api/admin/knowledge/documents/pdf/publication-v2/check") json={allowed:checkAllowed,reason:checkAllowed?"":"无法解析合格评审人，或发起人与评审人冲突。请修复组织配置后重试。",reviewers:checkAllowed?["评审人"]:[],fingerprint:"frozen"};
    else if (path === "/api/admin/knowledge/documents/pdf/publication-v2/prepare") json={confirmationId:"confirmed",expiresAt:"2099-01-01",summary:{name:doc.title,flow:"知识发布审批",version:1,reviewers:["评审人"],consequence:"流程通过后由服务端自动发布本次资料版本"}};
    else if (path === "/api/admin/knowledge/documents/pdf/publication-v2/submit") {
      calls.push("submit");
      await new Promise(resolve=>setTimeout(resolve,150));
      if(failPublish) return route.fulfill({status:409,json:{detail:"资料已变更，请重新检查"}});
      const body=route.request().postDataJSON();
      publication={tenant:"company",instanceId:"review-1",documentId:"pdf",title:doc.title,filename:doc.filename,fingerprint:"frozen-version",releaseNote:body.command.releaseNote,status:"waiting",reviewStatus:"reviewing",createdAt:doc.created_at,updatedAt:doc.updated_at};
      json={id:"submission-receipt",instanceId:"review-1",tenant:"company"};
    }
    else if (path === "/api/admin/knowledge/documents/pdf") {
      detailReads++;
      const job = { id: "job", document_id: "pdf", kind: "index", status: doc.status === "indexing" ? "running" : "done", progress_total: 0, progress_done: 0, attempt: 1, created_at: doc.created_at };
      json = { document: { ...doc, latest_job: job }, base, jobs: [job], text_preview: { name: "提取稿", text: "产品规格与范围" } };
    } else if (path.startsWith("/api/admin/knowledge/documents/pdf/") && route.request().method() === "POST") {
      const action = path.split("/").at(-1)!;
      calls.push(action);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (action === "publish" && failPublish) return route.fulfill({ status: 409, json: { detail: "资料已变更，请重新检查" } });
      doc = { ...doc, status: action === "publish" ? "published" : action === "cancel" ? "cancelled" : "uploaded", error: "" };
      json = { document: doc };
    }
    await route.fulfill({ json });
  });
  await page.goto("/admin/knowledge");
  await expect(page.locator("[data-kbv-record]")).toHaveCount(5,{timeout:15000});
  await page.locator('[data-kbv-filter-pane] [data-kb-scope-base="specs"]').click();
  await expect(page.locator("[data-kbv-count]")).toHaveText("1 条知识");
  await expect(page.locator("[data-kbv-detail]")).toContainText("非结构化 PDF");
  return { calls, errors, seedDrafts: () => { rows.push(...Array.from({ length: 5 }, (_, i) => ({ ...rows[0], id: `draft-${i}`, status: "draft" }))); }, failPublish: () => { failPublish = true; }, blockCheck:()=>{checkAllowed=false;}, approve:()=>{doc={...doc,status:"published"};publication={...publication,status:"published",reviewStatus:"approved",receipt:{id:"publish-receipt",status:"published",at:doc.updated_at}};}, failList: (value: boolean) => { failList = value; }, finish: () => { doc = { ...doc, status: "pending_review" }; }, reads: () => detailReads };
}

test("new draft clears incompatible filters and selects its actual page", async ({ page }) => {
  const s = await surface(page); s.seedDrafts();
  await page.locator("[data-kbv-new]").click();
  await page.locator("[data-kbv-create-title]").fill("新建资料定位验证");
  await page.locator("[data-kbv-create-submit]").click();
  await expect(page.locator("[data-kbv-create-dialog]")).toBeHidden();
  await expect(page.locator("[data-kbv-page]")).toHaveText("第 2 / 2 页");
  await expect(page.locator('[data-kbv-record="created"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-kbv-detail]")).toContainText("正文");
});

test("keyboard collapse preserves selection; search and pagination reset correctly", async ({ page }) => {
  const s = await surface(page);
  const group = page.getByRole("group", { name: "知识库", exact: true });
  const summary = page.locator("details").filter({ has: group }).locator("summary");
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(group).toBeHidden();
  await expect(page.locator("[data-kbv-count]")).toHaveText("1 条知识");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-kbv-filter-pane] [data-kb-scope-base="specs"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-kbv-filter-pane] [data-kb-scope-base=""]').click();
  await page.locator("[data-kbv-next]").click();
  await expect(page.locator("[data-kbv-page]")).toHaveText("第 2 / 2 页");
  await expect(page.locator("[data-kbv-record]").first()).toHaveAttribute("aria-current", "true");
  await page.locator("[data-kbv-search]").fill("不存在的标题");
  await expect(page.locator("[data-kbv-empty]")).toContainText("没有匹配");
  await expect(page.locator("[data-kbv-page]")).toHaveText("第 1 / 1 页");
  expect(s.errors).toEqual([]);
});

test("approval submission requires confirmation and leaves document unpublished", async ({ page }) => {
  const s = await surface(page);
  await expect(page.getByRole("link", { name: /查看 PDF 原件/ })).toHaveAttribute("href", "/api/admin/knowledge/documents/pdf/file");
  await page.locator('[data-kbv-doc-action="submit"]').click();
  await expect(page.locator('[data-admin-confirm="knowledge-document-publish"]')).toBeVisible();
  expect(s.calls).toEqual([]);
  await expect(page.getByRole("button",{name:"取消，不执行",exact:true})).toBeFocused();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toBeHidden(); expect(s.calls).toEqual([]);
  await page.locator('[data-kbv-doc-action="submit"]').click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).dblclick();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已提交审批");
  await expect(page.locator('[data-kbv-record="pdf"]')).toContainText("审批中");
  await expect(page.locator('[data-kbv-doc-action="submit"]')).toHaveCount(0);
  await expect(page.getByRole("link",{name:/查看审批记录/})).toHaveAttribute("href","/reviews/review-1?reviewCompany=company");
  s.approve();
  await expect(page.locator('[data-kbv-record="pdf"]')).toContainText("已发布",{timeout:10000});
  await expect(page.locator('[data-kbv-detail]')).toContainText("publish-receipt");
  expect(s.calls).toEqual(["submit"]); expect(s.errors).toEqual([]);
});

test("approval submission failure stays in confirmation and never reports success", async ({ page }) => {
  const s = await surface(page); s.failPublish();
  await page.locator('[data-kbv-doc-action="submit"]').click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("资料已变更");
  await expect(page.locator("[data-admin-receipt]")).toHaveCount(0);
  expect(s.calls).toEqual(["submit"]);
});

test("persisted job snapshot refreshes to terminal and updates list", async ({ page }) => {
  const s = await surface(page, "indexing");
  await expect(page.getByRole("status").filter({ hasText: "自动刷新" })).toContainText("无细分进度");
  const reads = s.reads(); await expect.poll(s.reads, { timeout: 10000 }).toBeGreaterThan(reads); s.finish();
  await expect(page.locator('[data-kbv-doc-action="submit"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-kbv-record="pdf"]')).toContainText("待提交审批");
  expect(s.calls).toEqual([]);
});

test("unavailable service is distinct from empty filtering and has recovery", async ({ page }) => {
  const s = await surface(page); s.failList(true);
  await page.locator('[data-kbv-doc-action="submit"]').click();
  await page.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("知识服务暂不可用");
  await expect(page.locator("[data-kbv-empty]")).toHaveCount(0);
  await expect(page.locator('[data-kbv-doc-action="submit"]')).toHaveCount(0);
  s.failList(false);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.locator('[data-kbv-record="pdf"]')).toContainText("审批中");
});

test("failed job can retry and cancel as separate locked requests", async ({ page }) => {
  const s = await surface(page, "failed");
  await expect(page.getByRole("alert")).toContainText("索引服务不可用");
  await page.locator('[data-kbv-doc-action="retry"]').dblclick();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已提交重试");
  await expect(page.locator('[data-kbv-doc-action="cancel"]')).toBeVisible();
  await page.locator('[data-kbv-doc-action="cancel"]').click();
  await expect(page.locator('[data-kbv-doc-action="retry"]')).toBeVisible();
  expect(s.calls).toEqual(["retry", "cancel"]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 589 }, { width: 860, height: 700 }]) {
  test(`layout and actions visible at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const s = await surface(page);
    if (viewport.width < 1100) await page.locator('[data-kbv-doc-action="submit"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-kbv-doc-action="submit"]')).toBeInViewport();
    await expect(page.locator("[data-kbv-upload]")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath("knowledge.png") });
    expect(s.errors).toEqual([]);
  });
}

test.describe("touch input", () => {
  test.use({ hasTouch: true, viewport: { width: 860, height: 700 } });
  test("facet and primary action hit areas remain usable", async ({ page }) => {
    await surface(page);
    const button = page.locator('[data-kbv-doc-action="submit"]');
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(await button.evaluate(el => parseFloat(getComputedStyle(el, "::after").height))).toBeGreaterThanOrEqual(44);
    const facet = page.locator('[data-kbv-filter-pane] [data-kb-scope-base="specs"]');
    expect(await facet.evaluate(el => parseFloat(getComputedStyle(el, "::after").height))).toBeGreaterThanOrEqual(44);
  });
});


test("reviewer conflict is visible and prevents submission until server recheck", async ({page})=>{
  const s=await surface(page);s.blockCheck();
  await page.getByRole("button",{name:"刷新资料",exact:true}).click();
  await page.getByLabel("发布说明",{exact:true}).fill("本次更新规格");
  await expect(page.getByRole("alert")).toContainText("无法解析合格评审人");
  await expect(page.locator('[data-kbv-doc-action="submit"]')).toBeDisabled();
  expect(s.calls).toEqual([]);
});


test("existing publication records preserve readonly preflight and confirmed submission",async({page})=>{
  const flow=await surface(page,"pending_review",true);
  await page.getByLabel("发布说明",{exact:true}).fill("更新产品规格");
  const button=page.locator('[data-kbv-doc-action="submit"]');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("审批通过后由服务端发布");
  await page.getByRole("dialog").getByRole("button",{name:"确认提交审批",exact:true}).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(flow.calls.filter(x=>x==="submit")).toHaveLength(1);
  await expect(page.locator('[data-kbv-detail]')).toContainText("查看本次审批与发布回执");
});


test("reference structure keeps desktop rows inline and all document actions in the body", async ({page},info)=>{
  await page.setViewportSize({width:1800,height:1000});
  await surface(page);
  await expect(page.getByRole("heading",{name:"NETC-50160116-A5-102储能型产品规格书",exact:true})).toBeVisible();
  await expect(page.locator(".kbv-document-body [data-kbv-doc-action=submit]")).toHaveCount(1);
  await expect(page.locator(".kbv-document-foot")).toHaveCount(0);
  const layout=await page.locator('[data-kbv-record="pdf"]').evaluate(el=>{
    const title=el.querySelector(".kbv-record-heading")!.getBoundingClientRect();
    const meta=el.querySelector(".kbv-browser-record-meta")!.getBoundingClientRect();
    return {inline:Math.abs((title.top+title.bottom)/2-(meta.top+meta.bottom)/2)<2,scroll:getComputedStyle(document.querySelector(".kbv-document-body")!).overflowY};
  });
  expect(layout.inline).toBe(true);expect(layout.scroll).toBe("visible");
  await expect(page.locator('[data-kb-filter="stage"]')).toBeInViewport();
  await page.screenshot({path:info.outputPath("reference-desktop.png")});
});

test("published documents have one revision action and no submission form",async({page},info)=>{
  await surface(page,"published");
  await expect(page.getByRole("button",{name:"创建新版本草稿",exact:true})).toHaveCount(1);
  await expect(page.locator('[data-kbv-doc-action="submit"]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath("published-desktop.png")});
});
