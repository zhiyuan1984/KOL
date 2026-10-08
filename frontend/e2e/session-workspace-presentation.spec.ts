import { expect, test, type Page } from "@playwright/test";
test.setTimeout(60000);

// UI fixtures validate rendering and request boundaries, not external execution.
async function fixture(page: Page, discovery = false, withDraft = false, initialResult = true, sessionId = "ordinary-session") {
  const errors: string[] = [];
  const writes: Array<{ path: string; body: unknown }> = [];
  let actionState = "pending";
  let version = "version-1";
  let taskReadStatus = 200;
  const brief = { platforms: ["youtube"], region: "global_en", directions: [], keywords: ["camping"],
    min_followers: 10000, max_followers: null, min_avg_plays_10: 5000, expect_count: 30 };
  const task = { id: "workspace-task", session_id: sessionId, title: discovery ? "露营线索发现" : "合作报告",
    status: "waiting", execution: { result_ready: true }, skill_id: discovery ? "crawler_collect" : "kol_analyze",
    input: discovery ? { discovery_workspace: { kind: "discovery", version: 1, agent_id: "lead", profile: "lead",
      brief, template: { id: "crawler_collect", skill_id: "crawler_collect", version: "1", title: "采集线索", inputs: [], steps: [], constraints: [] }, submitted_text: "发现露营线索" } } : {} };
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /Maximum update depth|route crash/.test(message.text())) errors.push(message.text()); });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let json: unknown = [];
    if (request.method() === "POST") writes.push({ path, body: request.postDataJSON() });
    if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path.includes("/api/tasks/by-session/") || path === "/api/tasks/workspace-task") {
      if (taskReadStatus !== 200) return route.fulfill({ status: taskReadStatus, json: { detail: "会话任务暂时无法读取" } });
      json = { task };
    }
    else if (path.endsWith("/pending")) json = { pending: null };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/queries/runtime.actions") json = { actions: discovery || new URL(request.url()).searchParams.get("session_id") === "confirmation-session" ? [{
      id: "action-1", skill_id: "crawler_collect", operation: "start_crawl", risk: "L3", state: actionState,
      confirmation_version: version, arguments: { platform: "youtube", keywords: "camping" },
      created_at: "2026-10-08T01:00:00Z", receipt: actionState === "succeeded" ? { accepted: true } : null,
    }] : [] };
    else if (path === "/api/actions/runtime.confirm") { actionState = "succeeded"; json = { ok: true }; }
    else if (path.startsWith("/api/sessions/") && !path.endsWith("/events")) json = {
      agent_status: "listening", messages: [
        { id: "request", kind: "me", payload: { text: "请分析当前合作" } },
        ...Array.from({ length: 20 }, (_, index) => ({ id: `process-${index}`, kind: "text", payload: { text: `过程 ${index + 1}：核对合作依据。`.repeat(12) } })),
        { id: "report-1", kind: "task_result_card", created_at: "2026-10-08T01:01:00Z", payload: { title: withDraft ? "邮件草稿" : "合作报告", summary: "报告已生成",
          ...(withDraft ? { subject: "合作邮件", body: "人工草稿", draft_id: "mail-draft" } : {}), sections: [{ title: "完整成果", content: "真实成果的完整正文".repeat(100) }] } },
        ...(withDraft ? [{ id: "draft-1", kind: "email_card", payload: { draft_id: "mail-draft", from: "owner@example.test", to: "creator@example.test", subject: "合作邮件", body: "人工草稿", status: "draft", allowed_from_mailboxes: [{ email: "owner@example.test", authorized: true }] } }] : []),
      ].filter(message => initialResult || message.kind !== "task_result_card"),
    };
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return { errors, writes, revise: () => { version = "version-2"; }, setTaskReadStatus: (status: number) => { taskReadStatus = status; } };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 589 }, { width: 860, height: 700 }]) {
  test(`Chat shares the task shell and keeps composer visible at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state = await fixture(page);
    await page.goto("/s/ordinary-session");
    await expect(page.locator("[data-scope-workspace='session']")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-round-results]")).toContainText("真实成果的完整正文");
    await expect(page.locator("[data-session-stream-pane]")).not.toContainText("真实成果的完整正文");
    await expect(page.locator("[data-ai-prompt-submit]")).toBeInViewport();
    await expect(page.locator("[data-task-context]")).not.toHaveAttribute("open", "");
    const geometry = await page.locator("[data-scope-workspace]").evaluate(el => {
      const center = el.querySelector(".scope-workspace-center")!.getBoundingClientRect();
      const rail = el.querySelector("[data-scope-task-rail]")!.getBoundingClientRect();
      return { center: { top: center.top, right: center.right, bottom: center.bottom }, rail: { top: rail.top, left: rail.left, width: rail.width }, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.overflow).toBe(false);
    if (viewport.width > 1100) { expect(geometry.rail.width).toBeGreaterThanOrEqual(360); expect(geometry.rail.left).toBeGreaterThanOrEqual(geometry.center.right); }
    else expect(geometry.rail.top).toBeGreaterThanOrEqual(geometry.center.bottom);
    await page.locator("[data-workbench-toggle]").click();
    await page.locator("[data-session-stream-pane]").getByRole("button", { name: "查看成果" }).click();
    await expect(page.locator("[data-round-results]")).toBeVisible();
    await expect(page.locator("[data-workbench-toggle]")).toHaveAttribute("aria-expanded", "true");
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("center and result reading positions survive reload without updates pulling the reader", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page);
  await page.goto("/s/ordinary-session");
  const center = page.locator("[data-session-stream-pane]");
  const rail = page.locator(".scope-task-rail-scroll");
  await expect(page.locator("[data-round-results]")).toContainText("真实成果的完整正文");
  await expect.poll(() => center.evaluate(el => el.scrollTop)).toBe(0);
  await center.evaluate(el => { el.scrollTop = 240; });
  await rail.evaluate(el => { el.scrollTop = 120; });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("ui:workspace-reading:ordinary-session:center"))).toBe("240");
  const railTop = await rail.evaluate(el => el.scrollTop);
  await center.locator(".scope-workspace-center-scroll-content").evaluate(el => {
    const row = document.createElement("p"); row.textContent = "新到达的过程"; el.append(row);
  });
  await expect(page.locator("[data-scope-scroll-jump]")).toHaveAccessibleName("回到最新");
  expect(await center.evaluate(el => el.scrollTop)).toBe(240);
  await page.reload();
  await expect.poll(() => center.evaluate(el => el.scrollTop)).toBe(240);
  await expect.poll(() => rail.evaluate(el => el.scrollTop)).toBe(railTop);
  await page.locator("[data-scope-scroll-jump]").click();
  await expect.poll(() => center.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
  expect(state.errors).toEqual([]);
});

test("the first late result starts at the top and later updates follow only after reading to the tail", async ({ page }) => {
  const state = await fixture(page, false, false, false);
  await page.goto("/s/ordinary-session");
  const rail = page.locator(".scope-task-rail-scroll");
  await expect(rail).toBeVisible();
  await expect(page.locator('[data-task-detail]')).toBeAttached();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const append = () => rail.locator('.scope-task-rail-body').evaluate(el => {
    const row = document.createElement('p'); row.textContent = '晚到的成果内容。'.repeat(2000); el.append(row);
  });
  await append();
  await expect.poll(() => rail.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => rail.evaluate(el => el.scrollTop)).toBe(0);
  await rail.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('ui:workspace-reading:ordinary-session:rail')) > 0)).toBe(true);
  await append();
  await expect.poll(() => rail.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
  expect(state.errors).toEqual([]);
});

test("confirmation is visible, demotes send, uses the current version and retains a receipt", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page);
  await page.clock.install();
  await page.goto("/s/confirmation-session");
  const confirm = page.getByRole("button", { name: "确认开始采集", exact: true });
  await expect(confirm).toBeInViewport();
  await expect(page.locator("[data-workspace-status]")).toHaveText(/待你确认/);
  await expect(page.locator("[data-ai-prompt-submit]")).toHaveAttribute("data-send-emphasis", "secondary");
  expect(await page.locator("[data-ai-prompt-submit]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await confirm.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  state.revise();
  await page.clock.runFor(5100);
  await confirm.click();
  await expect(confirm).toHaveCount(0);
  expect(state.writes.filter(row => row.path === "/api/actions/runtime.confirm")).toHaveLength(1);
  expect(state.writes.find(row => row.path === "/api/actions/runtime.confirm")?.body).toMatchObject({ confirmation_version: "version-2" });
  await expect(page.getByText("查看执行回执与范围", { exact: true })).toBeVisible();
  await expect(page.locator("[data-workspace-status]")).not.toHaveText(/执行中/);
  expect(state.errors).toEqual([]);
});

test("discovery confirmation uses the refreshed snapshot once and waits for remote completion", async ({ page }) => {
  const state = await fixture(page, true);
  await page.clock.install();
  await page.goto("/?tab=discovery&session_id=ordinary-session");
  const confirm = page.locator("[data-discovery-start-confirm]");
  await expect(confirm).toBeInViewport();
  await expect(page.locator("[data-discovery-run-status-label]")).toContainText("待确认");
  expect(await page.locator("[data-ai-prompt-submit]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  state.revise();
  await page.clock.runFor(2100);
  await confirm.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(confirm).toHaveCount(0);
  expect(state.writes.filter(row => row.path === "/api/actions/runtime.confirm")).toHaveLength(1);
  expect(state.writes.find(row => row.path === "/api/actions/runtime.confirm")?.body).toMatchObject({ confirmation_version: "version-2" });
  await expect(page.locator("[data-discovery-run-status-label]")).toContainText("启动中");
  await expect(page.locator('[data-result-rail="discovery"]')).toHaveAttribute("data-result-status", "preparing");
  expect(state.errors).toEqual([]);
});

test("a runtime confirmation owns the primary action beside a single editable mail draft", async ({ page }) => {
  const state = await fixture(page, false, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/s/confirmation-session");
  await expect(page.getByRole("button", { name: "确认开始采集", exact: true })).toBeInViewport();
  const send = page.locator('[data-round-results] [data-email-action="send"]');
  await expect(send).toHaveCount(1);
  await expect(page.locator('[data-draft-body]')).toHaveValue("人工草稿");
  expect(await send.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("an ordinary session ID and a Home session link restore the same server discovery task", async ({ page }) => {
  const state = await fixture(page, true);
  await page.goto("/?tab=discovery&session_id=ordinary-session");
  await expect(page.locator("[data-scope-workspace='discovery']")).toBeVisible({ timeout: 15000 });
  await page.goto("/s/ordinary-session");
  await expect(page.locator("[data-scope-workspace='discovery']")).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL("/s/ordinary-session");
  await expect(page.locator("[data-scope-workspace='discovery']")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", "ordinary-session");
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  await page.goto("/?tab=discovery&session_id=ordinary-session");
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", "ordinary-session");
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  expect(state.writes.filter(row => row.path.includes("/confirm") || row.path === "/api/home/discovery/workspace")).toEqual([]);
  expect(state.errors).toEqual([]);
});

// Route expectations come from IA §1.1; shared rendering must not rewrite them.
for (const sessionId of ["ordinary-session", "ses_discovery_saved"]) {
  test(`independent discovery session preserves its address and browser history: ${sessionId}`, async ({ page }) => {
    const state = await fixture(page, true, false, true, sessionId);
    const sessionUrl = `/s/${sessionId}?source=task-list`;
    await page.goto("/skills");
    await page.goto(sessionUrl);
    await expect(page.locator("[data-scope-workspace='discovery']")).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(sessionUrl);
    await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", sessionId);
    await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
    await expect(page.locator("[data-home-modes]")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
    await expect(page).toHaveURL(sessionUrl);
    await page.goBack();
    await expect(page).toHaveURL("/skills");
    await page.goForward();
    await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
    await expect(page).toHaveURL(sessionUrl);
    await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", sessionId);
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('Chat and Home discovery use the same composer spacing and text geometry', async ({ page }, info) => {
  await fixture(page);
  const samples: Record<string, unknown>[] = [];
  for (const path of ['/s/ordinary-session', '/?tab=discovery']) {
    await page.goto(path);
    await expect(page.locator('[data-ai-prompt-submit]')).toBeInViewport();
    const editor = page.getByRole('button', { name: '编辑完整请求' });
    if (await editor.count()) await editor.click();
    const sample = await page.locator('.scope-workspace .composer--workspace').evaluate(el => {
      const composer = getComputedStyle(el);
      const input = getComputedStyle(el.querySelector('textarea')!);
      return { padding: composer.padding, gap: composer.gap, radius: composer.borderRadius,
        minHeight: composer.minHeight, fontSize: input.fontSize, lineHeight: input.lineHeight, inputMinHeight: input.minHeight };
    });
    samples.push(sample);
  }
  await info.attach('composer-parity', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  expect(samples[1]).toEqual(samples[0]);
});

for (const status of [503, 403]) test(`session task read failure ${status} stays at the saved address and can retry without creating work`, async ({ page }) => {
  const state = await fixture(page, true);
  state.setTaskReadStatus(status);
  await page.goto("/s/ordinary-session");
  const failure = page.locator("[data-session-route-error]");
  await expect(failure).toContainText("会话任务暂时无法读取");
  await expect(page).toHaveURL("/s/ordinary-session");
  await expect(page.locator("[data-discovery-start-confirm]")).toHaveCount(0);
  state.setTaskReadStatus(200);
  await failure.getByRole("button", { name: "重试读取" }).click();
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  await expect(page).toHaveURL("/s/ordinary-session");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("a discovery-shaped ID with an ordinary task stays an ordinary independent session", async ({ page }) => {
  const sessionId = "ses_discovery_ordinary";
  const state = await fixture(page, false, false, true, sessionId);
  await page.goto(`/s/${sessionId}`);
  await expect(page.locator("[data-scope-workspace='session']")).toBeVisible({ timeout: 15000 });
  await expect(page).toHaveURL(`/s/${sessionId}`);
  await expect(page.locator("[data-round-results]")).toContainText("真实成果的完整正文");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
