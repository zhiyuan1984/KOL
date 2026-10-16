import { expect, test, type Page } from "@playwright/test";

const AID = "appr_eb5335a2b424";
type Options = { readOnly?: boolean; failGovernance?: boolean; staleOnce?: boolean; unknownCommittedOnce?: boolean; inputErrorOnce?: boolean; failDetail?: boolean; failNative?: boolean; legacyBoxes?: boolean };
function governanceApproval(readOnly = false) {
  return {
    id: AID, kind: "ontology_change", kind_label: "平台本体治理", title: "本体变更审批：对象注册表",
    status: "pending", version: 1, can_decide: !readOnly, allowed_actions: readOnly ? [] : ["approve", "reject"],
    chain: ["user:usr_org_zhang_huiling"], chain_detail: [{ name: "张慧玲", role: "本次授权终审人" }],
    current_index: 0, current_node: "张慧玲", created_at: "2026-10-15T00:00:00.000Z",
    payload: { scope: "objects", scope_label: "对象注册表", summary: "新增主数据导入批次对象 C15，支撑master-data导入链路", change_ref: "4788ff93fdb6a773ede6a87be78ab7259c7502d1", base_version: "objects:v1@git:b5bd14cbf52ef575a4e7f7bd8ad30849f33a934a", target_digest: "sha256:ad078e6b45389c6580a1a70a275e4920bf73a6451317f766174a777e1feb7854" },
  };
}

/** Isolated browser fixtures only: every API request is intercepted; no backend/database or real decision is used. */
async function fixture(page: Page, options: Options = {}) {
  const nativeCalls: string[] = [], boxes: Array<string | null> = [], writes: string[] = [];
  const decisions: Record<string, unknown>[] = [];
  let detailReads = 0, failGovernance = !!options.failGovernance, failDetail = !!options.failDetail, failNative = !!options.failNative;
  let stale = !!options.staleOnce, unknown = !!options.unknownCommittedOnce, inputError = !!options.inputErrorOnce;
  let approval = governanceApproval(!!options.readOnly);
  const account = options.readOnly
    ? { id: "usr_org_huang_qiyou", name: "黄启友", roles: ["admin"], available_modes: ["employee", "admin"] }
    : { id: "usr_org_zhang_huiling", name: "张慧玲", roles: ["employee"], available_modes: ["employee"] };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (method !== "GET") writes.push(path);
    if (path === "/api/auth/status") return route.fulfill({ json: { authenticated: true, account, user: account } });
    if (path === "/api/me") return route.fulfill({ json: account });
    if (path === "/api/preferences") return route.fulfill({ json: { theme: "light" } });
    if (path === "/api/approvals/badge") return route.fulfill({ json: { count: options.readOnly ? 0 : 1 } });
    if (path === "/api/approvals/v2/context") return route.fulfill({ json: { tenant: "company:amperetime", actor: account.id, admin: !!options.readOnly, people: [{ id: account.id, name: account.name, managerIds: [] }] } });
    if (path === "/api/approvals/v2/companies") return route.fulfill({ json: [{ id: "company:amperetime", name: "安培时代" }] });
    if (path === "/api/approvals/v2/templates" || path === "/api/approvals/v2/drafts") return route.fulfill({ json: [] });
    if (path === "/api/approvals/v2/notifications" || path === "/api/approvals/v2/notifications/inbox") return route.fulfill({ json: path.endsWith("/inbox") ? { items: [], unreadCount: 0 } : [] });
    if (path === "/api/approvals/v2/instance-page") {
      nativeCalls.push(url.search);
      return failNative ? route.fulfill({ status: 503, json: { detail: "普通审批暂不可用" } }) : route.fulfill({ json: { items: [], nextCursor: null } });
    }
    if (path === "/api/approvals" && method === "GET") {
      const box = url.searchParams.get("box"); boxes.push(box);
      if (failGovernance) return route.fulfill({ status: 503, json: { detail: { message: "治理审批源暂不可用" } } });
      if (options.legacyBoxes && ["mine", "processed", "all"].includes(box || "")) return route.fulfill({ status: 400, json: { detail: { code: "unknown_box", message: "unknown_box" } } });
      const show = !box || box === "all" || ((box === "mine" || box === "submitted") && !!options.readOnly) || ((box === "done" || box === "processed") && approval.status !== "pending") || (box === "inbox" && approval.status === "pending" && !options.readOnly);
      return route.fulfill({ json: show ? [approval] : [] });
    }
    if (path === `/api/approvals/${AID}` && method === "GET") {
      detailReads++;
      return failDetail ? route.fulfill({ status: 503, json: { detail: { message: "详情暂不可用" } } }) : route.fulfill({ json: approval });
    }
    if (path === `/api/approvals/${AID}/decide` && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>; decisions.push(body);
      if (stale) {
        stale = false; approval = { ...approval, version: 2, payload: { ...approval.payload, summary: "C15 补充材料后的新版本" } };
        return route.fulfill({ status: 409, json: { detail: { code: "stale", message: "审批内容已变化" } } });
      }
      if (inputError) { inputError = false; return route.fulfill({ status: 400, json: { detail: { code: "invalid_input", message: "提交参数校验失败" } } }); }
      approval = { ...approval, status: body.decision === "reject" ? "rejected" : "consumed", version: approval.version + 1, can_decide: false, allowed_actions: [] };
      if (unknown) { unknown = false; return route.fulfill({ status: 503, json: { detail: { message: "决定回执连接中断" } } }); }
      return route.fulfill({ json: approval });
    }
    return route.fulfill({ status: 404, json: { detail: `unmocked ${method} ${path}` } });
  });
  return { nativeCalls, boxes, writes, decisions, detailReads: () => detailReads, recover: () => { failGovernance = false; failDetail = false; failNative = false; } };
}
function main(page: Page) { return page.locator("main.review-workbench"); }
function detail(page: Page) { return main(page).getByRole("region", { name: "本体治理审批详情" }); }
async function openFromList(page: Page) { await main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true }).click(); await expect(detail(page)).toBeVisible(); }
function assertOnlyOriginalWrites(writes: string[]) { expect(writes.every(path => path === `/api/approvals/${AID}/decide`)).toBe(true); }

test("普通审批空列表时，授权终审人可在新中心看到、核对并处理同一正式治理单", async ({ page }) => {
  const f = await fixture(page); await page.goto("/approvals");
  await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible();
  await expect(main(page).getByText("当前页暂无匹配申请。", { exact: false })).toHaveCount(0);
  await expect(main(page).getByText("平台治理共 1 条", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("owner-new-center-list.png") });
  await openFromList(page); await expect(page).toHaveURL(new RegExp(`/approvals\\?[^#]*id=${AID}`));
  await expect(detail(page)).toContainText("objects:v1@git:b5bd14cb");
  await expect(detail(page)).toContainText("sha256:ad078e6b");
  await expect(detail(page)).toContainText("张慧玲");
  await expect(detail(page).getByRole("button", { name: "撤回申请", exact: true })).toHaveCount(0);
  await detail(page).getByRole("button", { name: "同意", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认同意？" });
  await expect(dialog).toContainText("不会复制审批单或自动部署发布");
  await expect(dialog).toContainText("sha256:ad078e6b");
  await expect(main(page).locator("button.primary:visible")).toHaveCount(0);
  await dialog.getByRole("button", { name: "确认同意", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(detail(page)).toContainText("审批已通过");
  expect(f.decisions).toHaveLength(1); expect(f.decisions[0]).toMatchObject({ decision: "approve", expected_version: 1 });
  expect(f.decisions[0].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(detail(page).getByRole("button", { name: "同意", exact: true })).toHaveCount(0);
  await detail(page).getByRole("button", { name: "返回列表", exact: true }).click();
  for (const [tab, box] of [["我发起的", "mine"], ["已处理", "processed"], ["我参与的", "all"]] as const) {
    await main(page).getByRole("button", { name: tab, exact: true }).click(); await expect.poll(() => f.boxes).toContain(box);
  }
  const search = main(page).getByRole("textbox", { name: "搜索标题或流程名称" });
  await search.fill("C15"); await search.press("Enter"); await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible();
  await search.fill("不存在的摘要"); await search.press("Enter"); await expect(main(page).getByText("当前页暂无匹配申请。", { exact: false })).toBeVisible();
  assertOnlyOriginalWrites(f.writes);
});

test("管理员只读投影不能代批；治理源失败不是空列表且可恢复", async ({ page }) => {
  const f = await fixture(page, { readOnly: true, failGovernance: true }); await page.goto("/approvals");
  const error = main(page).locator("[data-governance-approval-error]");
  await expect(error).toContainText("治理审批读取失败"); await expect(main(page).getByText("当前页暂无匹配申请。", { exact: false })).toHaveCount(0);
  f.recover(); await error.getByRole("button", { name: "重新读取治理审批" }).click();
  await main(page).getByRole("button", { name: "我发起的", exact: true }).click(); await openFromList(page);
  await expect(detail(page)).toContainText("当前没有可执行动作 · 只读");
  await expect(detail(page).getByRole("button", { name: "同意", exact: true })).toHaveCount(0);
  await expect(detail(page).getByRole("button", { name: "驳回", exact: true })).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});

test("驳回必须填原因，版本冲突关闭旧确认，重核后只提交新版本", async ({ page }) => {
  const f = await fixture(page, { staleOnce: true }); await page.goto("/approvals"); await openFromList(page);
  await detail(page).getByRole("button", { name: "驳回", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "确认驳回？" });
  await expect(dialog.getByRole("button", { name: "确认驳回", exact: true })).toBeDisabled();
  await dialog.getByLabel("驳回原因").fill("材料版本已变化"); await dialog.getByRole("button", { name: "确认驳回", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(detail(page)).toContainText("C15 补充材料后的新版本");
  await expect(detail(page)).toContainText("审批内容已变化"); expect(f.decisions).toHaveLength(1);
  await detail(page).getByRole("button", { name: "驳回", exact: true }).click(); dialog = page.getByRole("dialog", { name: "确认驳回？" });
  await expect(dialog).toContainText("C15 补充材料后的新版本"); await dialog.getByLabel("驳回原因").fill("重新核对后仍需补充证据");
  await dialog.getByRole("button", { name: "确认驳回", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(f.decisions[0].expected_version).toBe(1); expect(f.decisions[1].expected_version).toBe(2);
  expect(f.decisions[1].idempotency_key).not.toBe(f.decisions[0].idempotency_key); await expect(detail(page)).toContainText("审批已驳回");
  assertOnlyOriginalWrites(f.writes);
});

test("决定已落地但回执未知时先读取正式状态，关闭旧确认且不重复提交", async ({ page }) => {
  const f = await fixture(page, { unknownCommittedOnce: true }); await page.goto(`/approvals?id=${AID}`); await expect(detail(page)).toBeVisible();
  const reads = f.detailReads(); await detail(page).getByRole("button", { name: "同意", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认同意？" }); await dialog.getByRole("button", { name: "确认同意", exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(detail(page)).toContainText("审批结果未知，系统未自动重试");
  await expect(detail(page)).toContainText("审批已通过"); await expect.poll(() => f.detailReads()).toBeGreaterThan(reads);
  await expect(detail(page).getByRole("button", { name: "同意", exact: true })).toHaveCount(0);
  expect(f.decisions).toHaveLength(1); assertOnlyOriginalWrites(f.writes);
});

test("稳定新中心深链支持刷新、详情刷新、返回与浏览器返回，不跳旧页", async ({ page }) => {
  const f = await fixture(page); await page.goto("/approvals"); await openFromList(page);
  await expect(page).toHaveURL(new RegExp(`/approvals\\?[^#]*id=${AID}`)); await page.reload(); await expect(detail(page)).toBeVisible();
  const reads = f.detailReads(); await detail(page).getByRole("button", { name: "刷新详情", exact: true }).click();
  await expect.poll(() => f.detailReads()).toBeGreaterThan(reads); await expect(detail(page).getByRole("button", { name: "返回列表", exact: true })).toBeEnabled();
  await page.goBack(); await expect(page).toHaveURL(/\/approvals$/); await expect(detail(page)).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(0);
});

test("普通审批源失败仍能打开治理单，治理详情失败可从原地址重读", async ({ page }) => {
  const f = await fixture(page, { failNative: true, failDetail: true }); await page.goto(`/approvals?id=${AID}`);
  const error = main(page).locator("[data-governance-approval-error]"); await expect(error).toContainText("治理审批详情读取失败");
  await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/approvals\\?id=${AID}`)); f.recover();
  await error.getByRole("button", { name: "重新读取治理审批" }).click(); await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText("张慧玲"); expect(f.writes).toHaveLength(0);
});

test("同一确认的确定性失败重试复用幂等键，不切换到普通评审命令", async ({ page }) => {
  const f = await fixture(page, { inputErrorOnce: true }); await page.goto(`/approvals?id=${AID}`); await expect(detail(page)).toBeVisible();
  await detail(page).getByRole("button", { name: "同意", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "确认同意？" });
  await dialog.getByRole("button", { name: "确认同意", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("提交参数校验失败");
  await dialog.getByRole("button", { name: "确认同意", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(f.decisions).toHaveLength(2); expect(f.decisions[0]).toEqual(f.decisions[1]); assertOnlyOriginalWrites(f.writes);
});

test("现有正式账本的 submitted/done/无box 别名被兼容，不放宽访问范围", async ({ page }) => {
  const f = await fixture(page, { legacyBoxes: true, readOnly: true }); await page.goto("/approvals");
  for (const [tab, alias] of [["我发起的", "submitted"], ["已处理", "done"], ["我参与的", null]] as const) {
    await main(page).getByRole("button", { name: tab, exact: true }).click(); await expect.poll(() => f.boxes).toContain(alias);
  }
  await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible(); expect(f.writes).toHaveLength(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 480 }]) test(`治理列表与长摘要详情在 ${viewport.width}x${viewport.height} 可见且无越界`, async ({ page }) => {
  await fixture(page); await page.setViewportSize(viewport); await page.goto("/approvals");
  await expect(main(page).getByRole("button", { name: "本体变更审批：对象注册表", exact: true })).toBeVisible();
  await openFromList(page); await expect(detail(page).getByRole("button", { name: "同意", exact: true })).toBeVisible();
  expect(await main(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`governance-detail-${viewport.width}x${viewport.height}.png`) });
});

test("从治理详情发起普通审批时清除原治理深链和详情，不新建治理副本", async ({ page }) => {
  const f = await fixture(page);
  await page.route("**/api/approvals/v2/templates", route => route.fulfill({ json: [{ id: "ordinary", enabled: true, lifecycleVersion: 0, version: 1, publishedVersion: 1, definition: { name: "普通审批", description: "独立公司申请", fields: [], nodes: [] } }] }));
  await page.goto(`/approvals?id=${AID}`); await expect(detail(page)).toBeVisible();
  await main(page).getByRole("button", { name: "发起审批", exact: true }).click();
  await expect(main(page).getByLabel("申请标题")).toBeVisible();
  await expect(page).toHaveURL(/\/approvals$/); await expect(detail(page)).toHaveCount(0);
  expect(f.writes).toHaveLength(0);
});
