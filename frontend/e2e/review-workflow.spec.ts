import { test, expect, type Page } from "@playwright/test";
import { validateDefinition, validatePublicationNames } from "../../backend/src/approval/review-engine";
import { reviewStarters } from "../../backend/src/approval/review-starters";
import { emptyReviewDefinition } from "../../shared/review";

/** Browser interaction fixtures only; authenticated persistence is tested in review-api.test.ts. */
async function fixture(page: Page) {
  const definition = emptyReviewDefinition();
  definition.name = "内容评审";
  definition.fields = [
    { id: "content", label: "稿件内容", type: "textarea", required: true },
  ];
  let template = {
    id: "template",
    enabled: true,
    lifecycleVersion: 0,
    version: 1,
    publishedVersion: 1,
    definition,
    updatedAt: "2026-10-04T00:00:00Z",
  };
  const requests: { path: string; body: any }[] = [];
  const commands: Record<string, unknown>[] = [],
    drafts: Record<string, unknown>[] = [];
  await page.route("**/api/approvals/v2/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname.split("/v2/")[1];
    if (p === "companies")
      return route.fulfill({ json: [{ id: "test", name: "测试组织" }] });
    if (p === "context")
      return route.fulfill({
        json: {
          tenant: "test",
          actor: "employee",
          admin: true,
          organization: {
            defaultUnitId: "group",
            units: [
              { id: "test", name: "测试组织", parentId: null },
              { id: "institute", name: "研究院", parentId: "test" },
              { id: "center", name: "产品中心", parentId: "institute" },
              { id: "department", name: "产品部", parentId: "center" },
              { id: "group", name: "规格组", parentId: "department" },
              { id: "other-center", name: "运营中心", parentId: "institute" },
              { id: "other-department", name: "内容部", parentId: "other-center" },
            ],
          },
          people: [
            { id: "employee", name: "测试员工", managerIds: ["reviewer"] },
            { id: "reviewer", name: "测试负责人", managerIds: [] },
          ],
        },
      });
    if (p === "templates") return route.fulfill({ json: [template] });
    if (p === "notifications") return route.fulfill({ json: [] });
    if (p === "instance-page")
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (p === "instances") return route.fulfill({ json: [] });
    if (p === "instances/instance") return route.fulfill({ json: { id: "instance", templateId: template.id, templateVersion: template.version, version: 1, definition: template.definition, title: "已提交申请", requester: "employee", values: {}, currentNode: "review", status: "reviewing", tasks: [], allowedActions: [], createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" } });
    if (p === "drafts") {
      if (route.request().method() === "POST") {
        const b = route.request().postDataJSON();
        const d = {
          ...b,
          id: "draft",
          version: 1,
          updatedAt: "2026-10-04T00:00:00Z",
        };
        drafts.splice(0, drafts.length, d);
        return route.fulfill({ json: d });
      }
      return route.fulfill({ json: drafts });
    }
    if (p === "preview") return route.fulfill({ json: { summary: { name: template.definition.name, version: template.version, consequence: "审批通过后不会自动外发或推进阶段。" }, trace: template.definition.nodes.map(n => ({ nodeId: n.id, type: n.type, ...(n.type === "review" ? { userIds: ["reviewer"] } : {}) })) } });
    if (p === "prepare")
      return route.fulfill({
        json: {
          confirmationId: "confirmation",
          expiresAt: "2099-01-01",
          summary: {
            name:
              route.request().postDataJSON().title || template.definition.name,
            version: template.version,
            consequence: "此操作将记录评审决定，不触发外发。",
          },
        },
      });
    if (p === "commands") {
      const posted = route.request().postDataJSON();
      commands.push(posted);
      if (["enable", "disable"].includes(posted.command.action))
        template = {
          ...template,
          enabled: posted.command.action === "enable",
          lifecycleVersion: template.lifecycleVersion + 1,
        };
      return route.fulfill({
        json: { id: "receipt", resourceId: "instance", version: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { detail: "unknown fixture" } });
  });
  await page.route("**/api/admin/approval-types/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/starters")) return route.fulfill({ json: reviewStarters() });
    if (path.endsWith("/copy")) { const b = route.request().postDataJSON(); requests.push({ path: "copy", body: b }); return route.fulfill({ json: { ...template, id: "copied", version: 1, publishedVersion: null, definition: { ...template.definition, name: template.definition.name + "（副本）" } } }); }
    if (path.endsWith("/choice-options")) return route.fulfill({ json: { review: ["reviewer"] } });
    if (path.endsWith("/diff"))
      return route.fulfill({ json: { publishedVersion: 1, changes: [] } });
    if (path.endsWith("/validate")) {
      const b = route.request().postDataJSON(); requests.push({ path: "validate", body: b });
      const issues = [...validateDefinition(b.definition), ...validatePublicationNames(b.definition)].map(issue => {
        const [group, index, ...property] = issue.path.split(".");
        return { ...issue, target: { step: group === "fields" ? "form" : group === "nodes" ? "flow" : "basic", id: (b.definition[group]?.find((item: { id: string }) => item.id === index) || b.definition[group]?.[Number(index)])?.id, property: property.join(".") } };
      });
      return route.fulfill({ json: { issues } });
    }
    if (path.endsWith("/simulate")) {
      const b = route.request().postDataJSON(); requests.push({ path: "simulate", body: b });
      return route.fulfill({ json: { status: "approved", issues: [], tasks: [], trace: b.definition.nodes.map((n: any) => ({ nodeId: n.id, type: n.type, ...(n.type === "review" ? { userIds: ["reviewer"] } : {}) })) } });
    }
    if (route.request().method() === "GET")
      return route.fulfill({ json: [template] });
    const b = route.request().postDataJSON(); requests.push({ path: "save", body: b });
    template = {
      ...template,
      definition: b.definition,
      version: template.version + 1,
    };
    return route.fulfill({ json: template });
  });
  return { commands, requests, getTemplate: () => template };
}

async function openEditor(page: Page) {
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "编辑流程", exact: true }).click();
  return main;
}
async function addStep(page: Page, name: string, source = "负责人评审") {
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: `在${source}之后添加步骤`, exact: true }).click();
  await main.getByRole("button", { name: new RegExp(`^${name}`) }).filter({ has: page.locator("strong") }).click();
}
test("admin picks a starter or copies a published version without publishing it", async ({ page }) => {
  const f = await fixture(page); await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await expect(main.getByRole("region", { name: "流程摘要" })).toBeVisible();
  await main.getByRole("button", { name: "新建流程", exact: true }).click();
  await main.getByRole("button", { name: /^通用事项审批/ }).click();
  await expect(main.getByLabel("流程名称")).toHaveValue("通用事项审批");
  expect(f.commands).toHaveLength(0); expect(f.requests).toHaveLength(0);
  await page.reload();
  await main.getByRole("button", { name: "复制流程", exact: true }).click();
  await expect(main.getByLabel("流程名称")).toHaveValue("内容评审（副本）");
  expect(f.requests.find(r => r.path === "copy")?.body.source).toBe("published");
  expect(f.commands).toHaveLength(0);
});
test("employee uses published candidates, read-only preview, and explicit R3 confirmation", async ({ page }) => {
  const f = await fixture(page); const t = f.getTemplate();
  t.definition.nodes[1].assignee = { kind: "requester_choice", candidates: { kind: "manager" } };
  await page.route("**/api/approvals/v2/templates", route => route.fulfill({ json: [{ ...t, choiceCandidates: { review: ["reviewer"] } }] }));
  await page.goto("/approvals"); const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("核对选择"); await main.getByLabel("稿件内容").fill("材料 A");
  const chooser = main.getByLabel("负责人评审的审批人");
  await expect(chooser.locator("option")).toHaveCount(2); await chooser.selectOption("reviewer");
  await main.getByRole("button", { name: "核对申请与路径", exact: true }).click();
  await expect(main.getByRole("complementary", { name: "申请核对" })).toContainText("测试负责人");
  expect(f.commands).toHaveLength(0);
  await main.getByLabel("稿件内容").fill("材料 B");
  await expect(main.getByRole("complementary", { name: "申请核对" })).toContainText("修改材料或选人后需重新核对");
  await main.getByRole("button", { name: "提交审批", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认提交审批" });
  await expect(dialog).toContainText("R3"); expect(f.commands).toHaveLength(0);
  await expect(main.locator("button.primary:visible")).toHaveCount(0);
  await dialog.getByRole("button", { name: "提交审批", exact: true }).click();
  expect(f.commands[0].command.selectedApprovers).toEqual({ review: ["reviewer"] });
});
for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 480 }]) test(`draft restore keeps material and accessible submission at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await fixture(page);
  await page.route("**/api/approvals/v2/drafts", route => route.fulfill({ json: [{ id: "restored", version: 1, templateId: "template", templateVersion: 1, title: "待补申请", values: { content: "原材料" }, updatedAt: "2026-10-09" }] }));
  await page.setViewportSize(viewport); await page.goto("/approvals?draft=restored");
  const main = page.locator("main.review-page");
  await expect(main.getByLabel("申请标题")).toHaveValue("待补申请");
  await expect(main.getByLabel("稿件内容")).toHaveValue("原材料");
  await expect(main.getByRole("button", { name: "提交审批", exact: true })).toBeInViewport();
  await expect(main.locator("button.primary:visible")).toHaveCount(1);
  expect(await main.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
test("business entry freezes the read source in the same employee draft", async ({ page }) => {
  const f = await fixture(page);
  const source = { type: "collaboration", id: "source", label: "来源红人", version: "abcdef123456789", snapshot: { handle: "source-kol", brand: "品牌", stage: "S01", notes: "授权材料" } };
  await page.route("**/api/approvals/v2/source/collaboration/source", route => route.fulfill({ json: source }));
  await page.goto("/approvals?sourceId=source");
  const main = page.locator("main.review-page"); await expect(main).toContainText("来源：来源红人");
  await main.getByLabel("稿件内容").fill("申请材料"); await main.getByRole("button", { name: "提交审批", exact: true }).click();
  await page.getByRole("dialog", { name: "确认提交审批" }).getByRole("button", { name: "提交审批", exact: true }).click();
  expect(f.commands[0].command.source).toEqual(source);
});
test("AI draft result shows its gaps and opens the employee draft without submitting", async ({ page }) => {
  const f = await fixture(page);
  await page.route("**/api/sessions/review-ai**", route => {
    if (new URL(route.request().url()).pathname.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    return route.fulfill({ json: { id: "review-ai", agent_status: "listening", messages: [{ id: "ai-draft", role: "assistant", kind: "task_result_card", created_at: "2026-10-09T00:00:00Z", payload: { type: "task_result", artifact_type: "review_draft", review_draft_id: "restored", review_company: "test", source_session_id: "review-ai", title: "审批申请草稿", summary: "R2 草稿已保存，尚未提交。", sections: [{ title: "待补充与核对", items: ["补充原始材料"] }], recommended_actions: [{ label: "核对申请草稿", href: "/approvals?draft=restored&reviewCompany=test&session=review-ai" }] } }] } });
  });
  await page.route("**/api/approvals/v2/drafts", route => route.fulfill({ json: [{ id: "restored", version: 1, templateId: "template", templateVersion: 1, title: "AI草稿", values: {}, updatedAt: "2026-10-09" }] }));
  await page.goto("/s/review-ai");
  const result = page.getByRole("button", { name: "查看成果", exact: true });
  if (await result.isVisible()) await result.click();
  await expect(page.getByText("补充原始材料", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "核对申请草稿", exact: true }).first().click();
  await expect(page.locator("main.review-page").getByLabel("申请标题")).toHaveValue("AI草稿");
  expect(f.commands).toHaveLength(0);
});
test("pipeline object links directly to the same draft flow", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/pipeline?*", route => route.fulfill({ json: { columns: ["S01"], groups: { S01: [{ id: "source", handle: "source-kol", brand: "品牌", stage_code: "S01", stage_label: "线索", display_name: "来源红人", email: "", notes: "授权材料" }] }, exceptions: [] } }));
  await page.goto("/pipeline?kol=source-kol");
  await expect(page.getByRole("link", { name: "发起审批", exact: true })).toHaveAttribute("href", "/approvals?sourceId=source");
});
test("touch input keeps draft actions at the design target size", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await fixture(page); await page.goto("/approvals");
    const main = page.locator("main.review-page"); await main.getByRole("button", { name: "发起审批", exact: true }).click();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const target = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--icon-box")));
    const rect = await main.getByRole("button", { name: "提交审批", exact: true }).boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(target);
    await expect(main.getByRole("button", { name: "提交审批", exact: true })).toBeInViewport();
  } finally { await context.close(); }
});

for (const subject of ["", "?subject=knowledge_publication"]) test(`authoring automatically saves and checks before explicit publication ${subject || "general"}`, async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true }));
  const f = await fixture(page);
  await page.goto(`/admin/approval-types${subject}`);
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "新建流程", exact: true }).click();
  await main.getByRole("button", { name: "从空白创建", exact: true }).click();
  await expect(main.getByRole("button", { name: "基本信息", exact: true })).toContainText("待完善");
  await main.getByLabel("流程名称").fill("新流程");
  await main.getByRole("button", { name: "下一步：表单设计", exact: true }).click();
  await expect(main.getByRole("heading", { name: /表单字段/ })).toBeVisible();
  if (subject) {
    await expect(main.getByLabel("字段名称").first()).toBeDisabled();
    await main.getByRole("button", { name: "添加字段", exact: true }).click();
    await main.getByLabel("字段名称").last().fill("产品型号");
  }
  await main.getByRole("button", { name: "下一步：评审步骤", exact: true }).click();
  await expect(main.getByRole("heading", { name: "评审步骤", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "保存并检查", exact: true }).click();
  await expect(main.getByText("配置检查通过", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("review-publish.png") });
  expect(f.requests[0].path).toBe("save"); expect(f.requests[1].path).toBe("validate");
  const publish = main.getByRole("button", { name: /发布流程 v/ });
  await expect(publish).toBeEnabled(); await publish.click();
  expect(f.commands).toHaveLength(0);
  const dialog = page.getByRole("dialog", { name: "确认发布流程" });
  await expect(main.locator("button.primary:visible")).toHaveCount(0);
  let failOnce = true;
  await page.route("**/api/approvals/v2/commands", route => {
    f.commands.push(route.request().postDataJSON());
    if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { detail: "临时连接失败" } }); }
    return route.fulfill({ json: { id: "trial-publish-receipt" } });
  });
  await dialog.getByRole("button", { name: "发布流程", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "发布流程", exact: true }).click();
  await expect(main.getByText(/回执 trial-publish-receipt/)).toBeVisible();
  expect(f.commands[0].idempotencyKey).toBe(f.commands[1].idempotencyKey);
  expect(f.commands[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("authoring failed autosave keeps content and does not check; recovered create uses the same key", async ({ page }) => {
  const f = await fixture(page); await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page"); await main.getByRole("button", { name: "新建流程", exact: true }).click();
  await main.getByRole("button", { name: "从空白创建", exact: true }).click();
  await main.getByLabel("流程名称").fill("保留草稿");
  const keys: string[] = []; let fail = true;
  await page.route("**/api/admin/approval-types/v2/templates", async route => {
    if (route.request().method() === "GET") return route.fallback();
    keys.push(route.request().postDataJSON().creationKey);
    if (fail) return route.fulfill({ status: 503, json: { detail: "保存失败" } });
    return route.fallback();
  });
  await main.getByRole("button", { name: "下一步：表单设计", exact: true }).click();
  await expect(main.getByLabel("流程名称")).toHaveValue("保留草稿");
  expect(f.requests.filter(r => r.path === "validate")).toHaveLength(0);
  fail = false; await main.getByRole("button", { name: "下一步：表单设计", exact: true }).click();
  await expect(main.getByRole("heading", { name: /表单字段/ })).toBeVisible(); expect(keys[0]).toBe(keys[1]);
});

test("authoring edit and undo expire checks, re-entry checks automatically, and trial inputs do not expire configuration", async ({ page }) => {
  const f = await fixture(page); const main = await openEditor(page);
  await main.getByLabel("流程名称").fill("已修改");
  await main.getByRole("button", { name: "检查与发布", exact: true }).click();
  await expect(main.getByText("配置检查通过", { exact: true })).toBeVisible();
  await main.getByLabel("稿件内容").fill("测试内容"); await main.getByRole("button", { name: "开始试运行", exact: true }).click();
  await expect(main.getByRole("heading", { name: /路径试运行结果 · 路径可解析/ })).toBeVisible();
  await main.getByLabel("测试发起人").selectOption("reviewer");
  await expect(main.getByText("测试输入或配置已修改，需重新试运行", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: /发布流程 v/ })).toBeEnabled();
  await main.getByRole("button", { name: "基本信息", exact: true }).click();
  await main.getByLabel("流程名称").fill("再次修改"); await main.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(main.getByText("配置已修改，需重新检查", { exact: true })).toBeVisible();
  const checks = f.requests.filter(r => r.path === "validate").length;
  await main.getByRole("button", { name: "检查与发布", exact: true }).click();
  await expect(main.getByText("配置检查通过", { exact: true })).toBeVisible();
  expect(f.requests.filter(r => r.path === "validate").length).toBe(checks+1);
});

test("authoring failed recheck clears prior approval and blocks publishing until recovery", async ({ page }) => {
  await fixture(page); const main = await openEditor(page);
  await main.getByLabel("流程名称").fill("重新检查的新版本");
  await main.getByRole("button", { name: "检查与发布", exact: true }).click();
  await expect(main.getByText("配置检查通过", { exact: true })).toBeVisible();
  const failedCheck = (route: import("@playwright/test").Route) => route.fulfill({ status: 503, json: { detail: "检查服务暂不可用" } });
  await page.route("**/api/admin/approval-types/v2/validate", failedCheck);
  await main.getByRole("button", { name: "基本信息", exact: true }).click();
  await main.getByRole("button", { name: "检查与发布", exact: true }).click();
  await expect(main.getByRole("button", { name: /发布流程 v/ })).toBeDisabled();
  await expect(main.getByText("配置检查通过", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/admin/approval-types/v2/validate", failedCheck);
  await main.getByRole("button", { name: "重新检查", exact: true }).click();
  await expect(main.getByRole("button", { name: /发布流程 v/ })).toBeEnabled();
});

test("authoring fields preview live, add focuses, delete can undo, and preview attachments never upload", async ({ page }) => {
  const f = await fixture(page); const main = await openEditor(page);
  await main.getByRole("button", { name: "表单设计", exact: true }).click();
  await main.getByRole("button", { name: "添加字段", exact: true }).click();
  await expect(main.getByLabel("字段名称").last()).toBeFocused();
  await main.getByLabel("字段名称").last().fill("产品型号");
  await expect(main.getByRole("region", { name: "员工填写预览" }).getByLabel("产品型号")).toBeVisible();
  await main.getByRole("button", { name: "删除字段 2", exact: true }).click();
  await expect(main.getByText(/已删除「产品型号」/)).toBeVisible(); await main.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(main.getByLabel("字段名称").last()).toHaveValue("产品型号");
  await main.getByLabel("字段类型").last().selectOption("attachment");
  await expect(main.locator("input[type=file]")).toHaveCount(0);
  await main.getByRole("button", { name: "保存", exact: true }).click();
  expect(f.getTemplate().definition.fields[1].type).toBe("attachment");
  await page.screenshot({ path: test.info().outputPath("review-fields.png") });
});

test("authoring execution graph inserts, moves and deletes steps without manual linear links", async ({ page }) => {
  const f = await fixture(page); const main = await openEditor(page);
  await main.getByRole("button", { name: "评审步骤", exact: true }).click(); await addStep(page, "评审");
  await main.getByLabel("步骤名称").fill("补充评审");
  await expect(main.getByLabel("后续步骤（按连线执行）")).toHaveCount(0);
  await main.getByRole("button", { name: "补充评审上移", exact: true }).click();
  await main.getByRole("button", { name: "保存", exact: true }).click();
  expect(f.getTemplate().definition.nodes.find(n => n.id === "start")?.next).toBe(f.getTemplate().definition.nodes.find(n => n.name === "补充评审")?.id);
  await main.getByRole("button", { name: "删除步骤（自动连接前后路径）", exact: true }).click();
  await main.getByRole("button", { name: "保存", exact: true }).click();
  expect(f.getTemplate().definition.nodes.find(n => n.id === "start")?.next).toBe("review");
  await addStep(page, "条件分支", "发起");
  await expect(main.getByText("两条路径当前相同，可在各路径添加步骤。", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "在条件分支不满足路径添加步骤", exact: true }).click();
  await main.getByRole("button", { name: /^办理/ }).filter({ has: page.locator("strong") }).click();
  await main.getByRole("button", { name: "保存", exact: true }).click();
  const branch = f.getTemplate().definition.nodes.find(n => n.type === "condition")!;
  expect(branch.next).toBe("review"); expect(branch.otherwise).not.toBe("review");
  await expect(main.getByRole("button", { name: "负责人评审上移", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("review-branches.png") });
});

test("authoring checks missing configuration and locates the exact step property", async ({ page }) => {
  await fixture(page); const main = await openEditor(page);
  await main.getByRole("button", { name: "评审步骤", exact: true }).click();
  await main.locator('[data-node-id="review"] > .review-node').click();
  await main.getByRole("combobox", { name: "人员来源", exact: true }).selectOption("named");
  await main.getByRole("button", { name: "保存并检查", exact: true }).click();
  await expect(main.getByRole("button", { name: /发布流程 v/ })).toBeDisabled();
  await expect(main.getByText(/还有 .* 项配置问题/).first()).toBeVisible();
  await main.getByRole("button", { name: "去修改", exact: true }).first().click();
  await expect(main.getByRole("combobox", { name: "人员来源", exact: true })).toBeFocused();
  await main.locator('[data-node-id="start"] > .review-node').click();
  await expect(main.getByLabel("步骤名称")).toHaveValue("发起");
  await main.getByRole("button", { name: "定位缺项", exact: true }).click();
  await expect(main.getByRole("combobox", { name: "人员来源", exact: true })).toBeFocused();
});

test("authoring narrow and low viewports keep footer reachable, preserve organization changes and one primary action", async ({ page }) => {
  const f = await fixture(page); const main = await openEditor(page);
  for (const viewport of [{ width:1440, height:900 }, { width:1024, height:589 }, { width:390, height:667 }]) {
    await page.setViewportSize(viewport); await expect(main.locator(".review-save-bar")).toBeInViewport();
    expect(await main.evaluate(e => e.scrollWidth <= e.clientWidth+1)).toBe(true);
    await expect(main.locator("button.primary:visible")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`review-basic-${viewport.width}.png`) });
  }
  await main.locator(".review-departments summary").click();
  await main.getByLabel("当前组织", { exact: true }).selectOption("institute");
  await main.getByLabel("一级部门", { exact: true }).selectOption("other-center");
  await expect(main.getByLabel("二级部门", { exact: true })).toHaveValue("");
  await main.getByLabel("二级部门", { exact: true }).selectOption("other-department");
  await main.locator(".review-departments summary").click(); await main.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => f.getTemplate().definition.organizationUnitId).toBe("other-department");
});

test("authoring leave protects failed saves and lifecycle actions stay in the list with explicit confirmation", async ({ page }) => {
  const f = await fixture(page); const main = await openEditor(page);
  await main.getByLabel("流程名称").fill("未保存"); await main.getByRole("button", { name: "返回上一页", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "离开前保存修改？" });
  await dialog.getByRole("button", { name: "留在此页", exact: true }).click(); await expect(main.getByLabel("流程名称")).toHaveValue("未保存");
  await main.getByRole("button", { name: "返回上一页", exact: true }).click();
  await dialog.getByRole("button", { name: "放弃修改并返回", exact: true }).click();
  await main.getByRole("button", { name: "停用流程", exact: true }).click(); expect(f.commands).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: "停用流程", exact: true }).click();
  await expect(main.getByRole("button", { name: "启用流程", exact: true })).toBeVisible();
});

test("employee can save a non-expense draft and explicitly confirm submission", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("新品视频评审");
  await main.getByLabel("稿件内容").fill("待审核的脚本内容");
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(main.getByText("草稿已保存 v1")).toBeVisible();
  await main.getByRole("button", { name: "提交审批" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(main.getByText(/回执 receipt/)).toBeVisible();
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0].command).toMatchObject({
    action: "submit",
    title: "新品视频评审",
    values: { content: "待审核的脚本内容" },
    draft: { id: "draft", version: 1 },
  });
});
test("stale draft upgrade preserves source and opens compatible material for review", async ({
  page,
}) => {
  await fixture(page);
  const source = {
    id: "stale",
    version: 1,
    templateId: "template",
    templateVersion: 0,
    title: "原稿",
    values: { content: "保留内容", removed: "原字段材料" },
    updatedAt: "2026-10-04T00:00:00Z",
  };
  await page.route("**/api/approvals/v2/drafts", (route) =>
    route.fulfill({ json: [source] }),
  );
  await page.route("**/api/approvals/v2/drafts/stale/upgrade", (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? {
              source,
              templateVersion: 1,
              omitted: [
                {
                  field: "removed",
                  label: "原字段",
                  value: "原字段材料",
                  reason: "已删除",
                },
              ],
              changes: [],
              issues: [],
            }
          : {
              ...source,
              id: "copy",
              templateVersion: 1,
              values: { content: "保留内容" },
            },
    }),
  );
  await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByText("个人草稿 · 1", { exact: true }).click();
  await main.getByRole("button", { name: "原稿", exact: true }).click();
  await expect(main.getByText('原字段："原字段材料"（已删除）')).toBeVisible();
  await main
    .getByRole("button", { name: "复制兼容材料到新草稿", exact: true })
    .click();
  await expect(main.getByLabel("稿件内容")).toHaveValue("保留内容");
  await expect(
    main.getByText("已复制兼容材料，请核对后提交；原草稿保留。"),
  ).toBeVisible();
});
test("attachment upload completes before a review can be submitted", async ({
  page,
}) => {
  const f = await fixture(page);
  const template = f.getTemplate();
  template.definition.fields.push({
    id: "files",
    label: "评审附件",
    type: "attachment",
    required: true,
  });
  await page.route("**/api/approvals/v2/attachments", (route) =>
    route.fulfill({ json: { id: "file-test", name: "稿件.txt", size: 4 } }),
  );
  await page.route(
    "**/api/approvals/v2/attachments/file-test?metadata=1",
    (route) => route.fulfill({ json: { name: "稿件.txt" } }),
  );
  await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("附材料");
  await main.getByLabel("稿件内容").fill("附件说明");
  await main.locator("input[type=file]").setInputFiles({
    name: "稿件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("正文"),
  });
  await expect(main.getByRole("link", { name: "稿件.txt" })).toBeVisible();
  await main.getByRole("button", { name: "提交审批" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "提交审批", exact: true })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  expect(f.commands[0].command).toMatchObject({
    values: { files: ["file-test"] },
  });
});

test("personal draft autosaves without submitting a formal review", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("自动保存草稿");
  await main.getByLabel("稿件内容").fill("未提交材料");
  await expect(main.getByText(/草稿已自动保存 v/)).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await main.getByRole("button", { name: "返回（保留本次填写）" }).click();
  await main.getByText("个人草稿 · 1", { exact: true }).click();
  await expect(
    main.getByRole("button", { name: "自动保存草稿", exact: true }),
  ).toBeVisible();
});

test("money configuration and employee submission preserve exact decimal strings", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "编辑流程", exact: true }).click();
  await main.getByRole("button", { name: "表单设计", exact: true }).click();
  await main.getByLabel("字段类型").selectOption("money");
  await main.getByLabel("字段名称").fill("预算");
  await main.getByLabel("总精度（位）").fill("22");
  await main.getByLabel("小数位", { exact: true }).fill("2");
  await main.getByLabel("允许币种，每行一个代码").fill("CNY\nUSD");
  await main.getByLabel("币种及金额规则来源与版本").fill("测试金额规则 v1");
  await main.getByRole("button", { name: "保存", exact: true }).click();
  await expect(main.getByLabel("字段名称")).toHaveValue("预算");
  await expect
    .poll(() => f.getTemplate().definition.fields[0].type)
    .toBe("money");
  expect(f.getTemplate().definition.fields[0]).toMatchObject({
    numeric: { precision: 22, scale: 2 },
    currencies: ["CNY", "USD"],
    currencySource: "测试金额规则 v1",
  });
  await page.goto("/approvals");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("精确预算测试");
  await main
    .getByLabel("预算金额", { exact: true })
    .fill("9007199254740993.01");
  await main.getByLabel("预算币种", { exact: true }).selectOption("CNY");
  await main.getByRole("button", { name: "提交审批", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "提交审批", exact: true })
    .click();
  await expect(main.getByText(/回执 receipt/)).toBeVisible();
  expect(f.commands[0].command).toMatchObject({
    values: { content: { amount: "9007199254740993.01", currency: "CNY" } },
  });
});
