import { test, expect, type Page } from "@playwright/test";
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
    if (path.endsWith("/diff"))
      return route.fulfill({ json: { publishedVersion: 1, changes: [] } });
    if (path.endsWith("/validate"))
      return route.fulfill({ json: { issues: [] } });
    if (route.request().method() === "GET")
      return route.fulfill({ json: [template] });
    const b = route.request().postDataJSON();
    template = {
      ...template,
      definition: b.definition,
      version: template.version + 1,
    };
    return route.fulfill({ json: template });
  });
  return { commands, getTemplate: () => template };
}
test("employee can save a non-expense draft and explicitly confirm submission", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起评审", exact: true }).click();
  await main.getByLabel("申请标题").fill("新品视频评审");
  await main.getByLabel("稿件内容").fill("待审核的脚本内容");
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(main.getByText("草稿已保存 v1")).toBeVisible();
  await main.getByRole("button", { name: "预览并提交" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "提交评审", exact: true }).click();
  await expect(main.getByText(/回执 receipt/)).toBeVisible();
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0].command).toMatchObject({
    action: "submit",
    title: "新品视频评审",
    values: { content: "待审核的脚本内容" },
    draft: { id: "draft", version: 1 },
  });
});
test("node properties survive dragging, undo and save; unpublished edits disable publish", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "评审流程", exact: true }).click();
  await main.getByRole("button", { name: "添加评审节点", exact: true }).click();
  await main.getByRole("button", { name: "负责人评审 单人评审" }).click();
  await main.getByLabel("节点名称").fill("内容负责人");
  const cards = main.locator(".review-canvas li");
  await cards.nth(2).locator(".review-node").dragTo(cards.nth(1));
  await expect(cards.nth(0)).toContainText("→ 内容负责人");
  await expect(main.getByLabel("节点名称")).toHaveValue("内容负责人");
  await main.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(main.getByLabel("节点名称")).toHaveValue("内容负责人");
  await main.getByRole("button", { name: "校验与发布", exact: true }).click();
  await expect(main.getByRole("button", { name: /检查并发布/ })).toBeDisabled();
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
  expect(
    f.getTemplate().definition.nodes.find((n) => n.id === "review")?.name,
  ).toBe("内容负责人");
  await expect(main.getByRole("button", { name: /检查并发布/ })).toBeEnabled();
});
test("narrow viewport and keyboard node movement keep controls reachable", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "评审流程", exact: true }).click();
  await main.getByRole("button", { name: "添加评审节点", exact: true }).click();
  const down = main.getByRole("button", {
    name: "负责人评审上移",
    exact: true,
  });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(main.locator(".review-canvas li").nth(1)).toContainText(
    "负责人评审",
  );
  expect(await main.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
    true,
  );
  await expect(main.locator("button.primary:visible")).toHaveCount(1);
});

test("administrator saves explicit operation policies and separates handling from approval", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "评审流程", exact: true }).click();
  await main.getByRole("button", { name: "负责人评审 单人评审" }).click();
  await main.getByLabel("允许当前评审人转交").check();
  await main.getByLabel("允许的目标人员").selectOption(["reviewer"]);
  await main.getByLabel("允许请求补充材料").check();
  await main.getByLabel("可修改的字段").selectOption(["content"]);
  await main.getByRole("button", { name: "添加办理", exact: true }).click();
  await expect(main.getByLabel("拒绝规则")).toHaveCount(0);
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => f.getTemplate().definition.nodes.length).toBe(4);
  expect(
    f.getTemplate().definition.nodes.find((n) => n.id === "review")?.operations,
  ).toMatchObject({
    transfer: {
      candidates: { kind: "named", userIds: ["reviewer"] },
      deadline: "preserve",
    },
    amendment: { fields: ["content"], restart: "start" },
  });
  expect(
    f.getTemplate().definition.nodes.some((n) => n.type === "handler"),
  ).toBe(true);
});

test("compound conditions survive saving and disabling a template requires confirmation", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "内容评审", exact: true }).click();
  await main.getByRole("button", { name: "评审流程", exact: true }).click();
  await main.getByRole("button", { name: "添加条件分支", exact: true }).click();
  await main.getByLabel("组合方式").selectOption("all");
  await main.getByLabel("比较值").fill("内容A");
  await main.getByRole("button", { name: "添加条件", exact: true }).click();
  await main.getByLabel("组合方式").nth(2).selectOption("not");
  await main.getByLabel("比较值").nth(1).fill("内容B");
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => f.getTemplate().version).toBe(2);
  expect(
    f.getTemplate().definition.nodes.find((n) => n.type === "condition")
      ?.condition,
  ).toMatchObject({
    op: "all",
    conditions: [
      { value: "内容A" },
      { op: "not", condition: { value: "内容B" } },
    ],
  });
  await main.getByRole("button", { name: "校验与发布", exact: true }).click();
  await main.getByRole("button", { name: "停用流程", exact: true }).click();
  expect(f.commands).toHaveLength(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "停用流程", exact: true })
    .click();
  await expect(
    main.getByRole("button", { name: "启用流程", exact: true }),
  ).toBeVisible();
  expect(f.commands[0].command).toMatchObject({
    action: "disable",
    expectedVersion: 2,
    expectedLifecycleVersion: 0,
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
  await main.getByRole("button", { name: "发起评审", exact: true }).click();
  await main.getByLabel("申请标题").fill("附材料");
  await main.getByLabel("稿件内容").fill("附件说明");
  await main.locator("input[type=file]").setInputFiles({
    name: "稿件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("正文"),
  });
  await expect(main.getByRole("link", { name: "稿件.txt" })).toBeVisible();
  await main.getByRole("button", { name: "预览并提交" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "提交评审", exact: true })
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
  await main.getByRole("button", { name: "发起评审", exact: true }).click();
  await main.getByLabel("申请标题").fill("自动保存草稿");
  await main.getByLabel("稿件内容").fill("未提交材料");
  await expect(main.getByText(/草稿已自动保存 v/)).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await main.getByRole("button", { name: "返回（保留本次填写）" }).click();
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
  await main.getByRole("button", { name: "表单字段", exact: true }).click();
  await main.getByLabel("字段类型").selectOption("money");
  await main.getByLabel("字段名称").fill("预算");
  await main.getByLabel("总精度（位）").fill("22");
  await main.getByLabel("小数位", { exact: true }).fill("2");
  await main.getByLabel("允许币种，每行一个代码").fill("CNY\nUSD");
  await main.getByLabel("币种及金额规则来源与版本").fill("测试金额规则 v1");
  await main.getByRole("button", { name: "保存草稿", exact: true }).click();
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
  await main.getByRole("button", { name: "发起评审", exact: true }).click();
  await main.getByLabel("申请标题").fill("精确预算测试");
  await main
    .getByLabel("预算金额", { exact: true })
    .fill("9007199254740993.01");
  await main.getByLabel("预算币种", { exact: true }).selectOption("CNY");
  await main.getByRole("button", { name: "预览并提交", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "提交评审", exact: true })
    .click();
  await expect(main.getByText(/回执 receipt/)).toBeVisible();
  expect(f.commands[0].command).toMatchObject({
    values: { content: { amount: "9007199254740993.01", currency: "CNY" } },
  });
});
