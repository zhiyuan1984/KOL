import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const original = "Hi team,\n\nI am interested and would love to collaborate. Please share the deliverables.\n\nBest regards,\nCreator\n\nOn Tue, Brand wrote:\n> A previous invitation.\n<script>send secrets</script>";
const quote = "would love to collaborate";

async function fixture(page: Page, mode: "normal" | "missing" | "unmatched" | "recommended" | "requested" | "composing" = "normal", theme = "light") {
  const writes: Array<{ path: string; body: unknown }> = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("ui:right-collapsed", "false"));
  const messages = [
    { id: "outbound", kind: "kol_mail_card", payload: { direction: "outbound", subject: "Original invitation", from: "brand@example.test", to: "creator@example.test", body: "We would like to invite you.", occurred_at: "2026-10-08T01:00:00Z", provider_message_id: "mail-outbound" } },
    { id: "previous", kind: "kol_mail_card", payload: { direction: "inbound", subject: "Earlier reply", from: "creator@example.test", body: "Not available this month.", occurred_at: "2026-10-08T02:00:00Z", judgment: { reason: "此前表示本月暂不可合作，需同时核对新回复。", evidence: [] } } },
    { id: "latest", kind: "kol_mail_card", payload: { collaboration_id: "evidence-col", handle: "creator", direction: "inbound", conversation_id: "conversation-real-id", subject: "Re: Collaboration and deliverables", from: "creator@example.test", from_name: "Creator", to: "brand@example.test", mailbox: "brand@example.test", body: mode === "missing" ? null : original, snippet: "Provider preview only", translation_zh: "我有兴趣合作，请分享交付要求。", attachments: ["media-kit.pdf"], links: ["https://example.test/media"], occurred_at: "2026-10-09T01:00:00Z", source: "starry", source_version: "source-v4", provider_message_id: "mail-latest", current_stage: "INITIAL_CONTACT", judgment: { suggested_stage: "INTERESTED", suggested_label: "已回复-有兴趣", reason: "对方明确表达合作意向，下一步需确认交付要求。", evidence: mode === "missing" ? [] : [{ source: "body", snippet: mode === "unmatched" ? "signed the contract" : quote }] } } },
    { id: "stage-card", kind: "confirm_stage_card", payload: { collaboration_id: "evidence-col", current_stage: "INITIAL_CONTACT", current_label: "初步接触", proposed_stage: "INTERESTED", expected_version: 4, reason: "对方表达合作意向", targets: [{ code: "INTERESTED", label: "已回复-有兴趣", kind: "adjacent", track: "main" }] } },
  ];
  if (mode === "recommended") messages.push({ id: "analysis-result", kind: "task_result_card", payload: {
    title: "合作意向分析", summary: "下一步核对交付要求", recommended_actions: [
      { label: "询问交付要求", prompt: "给@creator 起草回复，询问交付要求" },
      { label: "核对历史承诺", prompt: "分析@creator 的历史承诺" },
    ],
  } } as typeof messages[number]);
  if (mode === "requested") messages.splice(3, 0, { id: "stage-request", kind: "me", payload: { text: "提出阶段变更 @creator 到 已回复-有兴趣", intent: "confirm_stage" } } as typeof messages[number]);
  if (mode === "composing") messages.push({ id: "draft", kind: "email_card", payload: {
    draft_id: "draft-real-id", from: "brand@example.test", to: "creator@example.test", subject: "Deliverables", body: "Saved draft", status: "draft", buttons: [], keep_stage: true,
  } } as typeof messages[number]);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let json: unknown = [];
    if (!["GET", "HEAD"].includes(request.method())) writes.push({ path: pathname, body: request.postDataJSON() });
    if (pathname === "/api/health") json = { ok: true };
    else if (pathname === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (pathname === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (pathname === "/api/preferences") json = { theme };
    else if (pathname === "/api/cron/jobs") json = { jobs: [] };
    else if (pathname.startsWith("/api/tasks/")) json = { task: { id: "evidence-task", session_id: "evidence-session", title: "核对合作意向", skill_id: mode === "composing" ? "email_compose" : "reply_analysis", input: {}, status: "waiting" } };
    else if (pathname === "/api/sessions/evidence-session") json = { agent_status: "listening", collaboration_id: "evidence-col", journey: { collaboration_id: "evidence-col", handle: "creator", stage_code: "INITIAL_CONTACT" }, messages };
    else if (pathname === "/api/queries/runtime.actions") json = { actions: [] };
    else if (pathname === "/api/queries/mail.reply-context") json = { version: "v4", cursor: 4, complete: true, sources: [], messages: [] };
    else if (pathname === "/api/sessions/evidence-session/confirm-stage") json = { stage_changed: false, waiting_approval: true, stage_label: "初步接触", target_label: "已回复-有兴趣" };
    else if (pathname.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return { writes, errors };
}

test("first screen connects suggestion, actions and compact evidence without hiding conflicting mail", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  await expect(workbench).toBeVisible();
  await expect(workbench.locator("[data-mail-evidence]")).toHaveCount(3);
  await expect(workbench).toContainText("此前表示本月暂不可合作");
  await expect(workbench.getByRole("button", { name: "准备回复 · R2 草稿" })).toBeVisible();
  await expect(workbench.locator("[data-evidence-original]:visible")).toHaveCount(0);
  await expect(workbench.locator("[data-mail-evidence='mail-latest'] [data-evidence-excerpt]")).toContainText(quote);
  const firstScreen = await workbench.locator("[data-stage-suggestion]").boundingBox();
  const actions = await workbench.locator(".mail-decision-actions").boundingBox();
  expect(firstScreen!.y).toBeGreaterThanOrEqual(0);
  expect(actions!.y + actions!.height).toBeLessThan(900);
  const row = await workbench.locator("[data-mail-evidence='mail-latest']").boundingBox();
  expect(row!.height).toBeLessThan(125);
  expect(state.writes.filter(write => write.path !== "/api/preferences")).toEqual([]);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: path.resolve("../artifacts/review/mail-decision/default.png") });
});

test("one citation click opens and focuses the exact original while full sources remain available", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  await workbench.getByRole("button", { name: "[1] 正文", exact: true }).click();
  const detail = workbench.locator("[data-mail-evidence='mail-latest'] [data-evidence-original]");
  await expect(detail).toBeVisible();
  await expect(detail.locator("[data-evidence-highlight]")).toHaveText(quote);
  await expect(detail.locator("[data-evidence-highlight]")).toBeFocused();
  await expect(detail).toContainText("mail-latest · 版本 source-v4");
  await expect(detail.getByText("引用与历史往来", { exact: true })).toBeVisible();
  await detail.getByText("完整原文（含签名与历史）", { exact: true }).click();
  await expect(detail.locator("[data-evidence-full-body]")).toHaveText(original);
  await expect(detail.locator("script")).toHaveCount(0);
  await detail.getByText("查看中文译文", { exact: true }).click();
  await expect(detail).toContainText("我有兴趣合作");
  await detail.getByText("附件与链接（2）", { exact: true }).click();
  await expect(detail).toContainText("media-kit.pdf");
  await page.screenshot({ path: path.resolve("../artifacts/review/mail-decision/expanded.png") });
  await detail.getByRole("button", { name: "回到下一步动作" }).click();
  await expect(workbench.locator(".mail-decision-actions")).toBeFocused();
  expect(state.writes.filter(write => write.path !== "/api/preferences")).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("reply preparation only prefills; stage review requires its independent confirmation and reports waiting", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  await workbench.getByRole("button", { name: "准备回复 · R2 草稿" }).click();
  await expect(page.locator("[data-composer-input]")).toHaveValue(/回复会话 conversation-real-id.*收件: creator@example.test/);
  await expect(workbench).toContainText("已预填回复要求");
  await workbench.getByRole("button", { name: "核对阶段变更 · R3 需确认" }).click();
  await expect(page.locator("[data-confirm-stage]")).toBeVisible();
  expect(await page.locator("[data-send]").evaluate(button => getComputedStyle(button).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  expect(state.writes.filter(write => write.path !== "/api/preferences")).toEqual([]);
  await page.locator("[data-confirm-stage]").click();
  await expect(page.locator("[data-kind='confirm-stage-card']")).toContainText("阶段尚未变更");
  expect(state.writes.filter(write => write.path !== "/api/preferences")).toEqual([{ path: "/api/sessions/evidence-session/confirm-stage", body: expect.objectContaining({ stage_code: "INTERESTED", expected_version: 4 }) }]);
  await page.screenshot({ path: path.resolve("../artifacts/review/mail-decision/action-feedback.png") });
  expect(state.errors).toEqual([]);
});

test("evidence decision puts the supplied next action first and keeps additional recommendations folded", async ({ page }) => {
  const state = await fixture(page, "recommended");
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  const next = workbench.getByRole("button", { name: "询问交付要求", exact: true });
  await expect(next).toBeVisible();
  await expect(workbench.getByRole("button", { name: "核对历史承诺", exact: true })).not.toBeVisible();
  await next.click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("给@creator 起草回复，询问交付要求");
  expect(state.writes.filter(write => write.path !== "/api/preferences")).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("requested stage confirmation opens the saved collapsed result rail and reaches the viewport", async ({ page }) => {
  await fixture(page, "requested");
  await page.addInitScript(() => localStorage.setItem("ui:right-collapsed", "true"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/s/evidence-session");
  await expect(page.locator("[data-confirm-stage]")).toBeVisible();
  await expect(page.locator("[data-confirm-stage]")).toBeInViewport();
});

test("composing keeps the active human draft first and offers the evidence as context", async ({ page }) => {
  await fixture(page, "composing");
  await page.goto("/s/evidence-session");
  await expect(page.locator("[data-draft-body]")).toHaveValue("Saved draft");
  await expect(page.locator("[data-mail-decision-workbench]")).not.toBeVisible();
  await page.getByText("阶段建议与证据链", { exact: true }).click();
  await expect(page.locator("[data-mail-decision-workbench]")).toBeVisible();
  await expect(page.locator("[data-draft-body]")).toHaveValue("Saved draft");
});

test.describe("coarse pointer evidence controls", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("evidence expansion keeps a touch hit area without horizontal overflow", async ({ page }) => {
    await fixture(page);
    await page.goto("/s/evidence-session");
    const expand = page.locator("[data-mail-evidence='mail-latest']").getByRole("button", { name: "展开原文" });
    await expect(expand).toBeVisible();
    expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expand.tap();
    await expect(page.locator("[data-mail-evidence='mail-latest'] [data-evidence-original]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

for (const mode of ["missing", "unmatched"] as const) test(`${mode} evidence never produces a verified source`, async ({ page }) => {
  await fixture(page, mode);
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  if (mode === "missing") {
    await expect(workbench).toContainText("尚无可定位的原文引用");
    await workbench.locator("[data-mail-evidence='mail-latest']").getByRole("button", { name: "展开原文" }).click();
    await expect(workbench).toContainText("当前预览不能代替完整原文");
    await page.screenshot({ path: path.resolve("../artifacts/review/mail-decision/insufficient.png") });
  } else {
    await workbench.getByRole("button", { name: "[1] 正文", exact: true }).click();
    await expect(workbench).toContainText("当前原文无法核验这条引用");
    await expect(workbench.locator("[data-evidence-highlight]")).toHaveCount(0);
  }
});

for (const viewport of [{ width: 1440, height: 630 }, { width: 1000, height: 900 }, { width: 390, height: 844 }]) test(`evidence can be opened by keyboard at ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await fixture(page, "normal", "dark");
  await page.setViewportSize(viewport);
  await page.goto("/s/evidence-session");
  const workbench = page.locator("[data-mail-decision-workbench]");
  const citation = workbench.getByRole("button", { name: "[1] 正文", exact: true });
  await citation.focus();
  await page.keyboard.press("Enter");
  await expect(workbench.locator("[data-evidence-highlight]").last()).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
