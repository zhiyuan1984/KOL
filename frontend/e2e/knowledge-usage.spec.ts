import { expect, test, type Page } from "@playwright/test";
import { prepareEmployeeKnowledgeMailbox, prepareEmployeeKnowledgeSeedOwners } from "./fixtures/native-employee-seed-owner";

/**
 * 员工端知识库「阶段 3」契约：服务端搜索、适用筛选、同页详情（右栏）溯源与草稿卡引用芯片。
 *
 * 只断言页面自己的 DOM 契约，不改 workbench.spec.ts 的既有基线：
 *   搜索 → [data-kb-search]（debounce 后走 GET /api/knowledge?q=）
 *   适用 → 当前紧凑行只显示标题和类型；品牌与阶段在打开后的右栏完整给出，
 *          阶段筛选默认全部＋五个字典标签，其余下拉；值按代码过滤、展示中文标签
 *   溯源 → 右栏 [data-kb-provenance]：发布人 / 版本 / 更新时间 / 适用
 *   芯片 → 草稿与回执 [data-draft-knowledge]：模板：{标题} v{n}
 *
 * stub 种子（backend/src/host/knowledge.ts seedKnowledge）里：
 *   kb_mail_ship「发货通知」的 subject 是 "Sample shipped — [运单号]"，正文没有 shipped，
 *   所以 q=shipped 只命中它一条 —— 顺带证明关键词检索覆盖了 subject。
 */

/** Compact browse starts with five records; paging must not depend on seed sort order. */
async function expandKnowledgeList(page: Page): Promise<void> {
  await expect(page.locator("[data-knowledge]").first()).toBeVisible();
  const more = page.locator("[data-kb-load-more]");
  while (await more.count()) await more.click();
}

test.beforeEach(async ({ page }) => {
  // Native auth has no demo reset. Preserve seed content/lifecycle, correcting
  // only their missing legacy owner in the explicit isolated employee fixture.
  await prepareEmployeeKnowledgeSeedOwners(["kb_mail_kol", "kb_mail_followup", "kb_mail_ship", "kb_followup"]);
  const request = page.request;
  for (const id of ["kb_mail_kol", "kb_mail_followup", "kb_mail_ship"]) {
    const restored = await request.delete(`/api/knowledge/${id}/deprecate`);
    expect(restored.ok(), `恢复本人的知识可见性失败：${restored.status()} ${await restored.text()}`).toBeTruthy();
  }
});

test("搜索按关键词收敛到单条种子，清空后恢复", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expandKnowledgeList(page);
  const allCount = await kb.locator("[data-kbv-count]").textContent();
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toBeVisible();

  await kb.locator("[data-kb-search]").fill("shipped");
  await expect(kb.locator('[data-knowledge="kb_mail_ship"]')).toBeVisible();
  await expect(kb.locator('[data-knowledge="kb_mail_ship"]')).toContainText("发货通知");
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toHaveCount(0);
  await expect(kb.locator('[data-knowledge="kb_mail_followup"]')).toHaveCount(0);

  await kb.locator("[data-kb-search]").fill("");
  await expect(kb.locator("[data-kbv-count]")).toHaveText(allCount!);
  await expandKnowledgeList(page);
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toBeVisible();
  await expect(kb.locator('[data-knowledge="kb_mail_followup"]')).toBeVisible();
});

test("同页详情给出来源与版本与全文（右栏常显）", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expandKnowledgeList(page);
  await kb.locator('[data-kb-open="kb_mail_followup"]').click();

  const rail = page.locator('[data-kb-preview="kb_mail_followup"]');
  await expect(rail).toBeVisible();
  const provenance = rail.locator("[data-kb-provenance]");
  await expect(provenance).toBeVisible();
  await expect(provenance).toHaveAttribute("aria-label", "来源与版本");
  await expect(provenance).toContainText("发布人");
  await expect(provenance).toContainText("v1");
  await expect(provenance).toContainText("更新时间");
  await expect(provenance).toContainText("阶段：初步接触");

  const body = rail.locator("[data-kb-preview-body]");
  await expect(body).toContainText("Just a quick follow-up");
  await expect(body).toContainText("Happy to share the spec sheet");
});

test("行内只露品牌值；阶段中文标签在右栏；无适用范围写全阶段 · 通用", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expandKnowledgeList(page);

  // 当前 KnowledgeBrowse 紧凑行故意只放标题与类型；范围不能悄悄丢失，必须在右栏完整可读。
  const mail = kb.locator('[data-knowledge="kb_mail_followup"]');
  await expect(mail).toHaveText(/^\s*阶段跟进\s*邮件模板\s*$/);
  await expect(mail).not.toContainText(/LiTime|初步接触/);
  await mail.click();
  const mailRail = page.locator('[data-kb-preview="kb_mail_followup"] [data-kb-scope]');
  await expect(mailRail).toContainText("LT");
  await expect(mailRail).toContainText("初步接触");

  const policy = kb.locator('[data-knowledge="kb_followup"]');
  await expect(policy).toHaveText(/^\s*跟进信模板（阶段保持）\s*口径\s*$/);
  await expect(policy).not.toContainText(/全阶段|通用/);

  await policy.click();
  const rail = page.locator('[data-kb-preview="kb_followup"] [data-kb-scope]');
  await expect(rail).toContainText("全阶段");
  await expect(rail).toContainText("通用");

  const stageRow = kb.locator("[data-kb-filter='stage']");
  await expect(stageRow.locator("[data-kb-filter-value='']")).toHaveAttribute("aria-pressed", "true");
  await stageRow.locator("[data-kb-filter-value='INITIAL_CONTACT']").click();
  await expect(stageRow.locator("[data-kb-filter-value='INITIAL_CONTACT']")).toHaveAttribute("aria-pressed", "true");
  await stageRow.locator("[data-kb-filter-value='']").click();

  await expect(kb.locator("[data-kb-filter='brand']")).toBeVisible();
});

test("草稿卡显示「模板：{标题} v{n}」引用芯片", async ({ page }) => {
  const request = page.request;
  const cited = await request.post("/api/knowledge/kb_mail_followup/cite", { data: {} });
  expect(cited.ok(), `启用真实邮件模板失败：${cited.status()} ${await cited.text()}`).toBeTruthy();
  const mailbox = await prepareEmployeeKnowledgeMailbox();
  // col_xiaomei belongs to the retired demo principal. A real normal-login
  // session is sufficient for the original template/draft provenance contract.
  const created = await request.post("/api/sessions", { data: { title: `知识引用芯片 ${Date.now()}` } });
  expect(created.ok(), `创建本人的真实会话失败：${created.status()} ${await created.text()}`).toBeTruthy();
  const ses = await created.json() as { id: string };
  expect(ses.id).toEqual(expect.any(String));
  await page.goto(`/s/${ses.id}`);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await input.fill('/');
  await page.locator('[data-skill-option="email_compose"]').click();
  await expect(page.locator('[data-skill-chip="email_compose"]')).toHaveCount(1);
  // The current composer loads mail templates only for the explicit mail task,
  // not for every generic slash query. This remains a real template selection.
  await input.fill("写合作邮件 /");
  await expect(page.locator("[data-knowledge-option='kb_mail_followup']")).toBeVisible();
  await page.locator("[data-knowledge-option='kb_mail_followup']").click();
  await expect(input).toHaveValue(/LiTime collab kit/);

  // Chat intentionally uses its specialized mail path instead of Home's generic
  // parameter cards. Keep the selected knowledge source and complete the real
  // first-contact address fields in the editable request; no send is performed.
  const body = await input.inputValue();
  await input.fill(`写合作邮件\n发件邮箱：${mailbox}\n收件邮箱：knowledge-citation-recipient@fixture.example\n邮件主题：Following up — LiTime collab kit\n\n${body}`);
  await page.locator("[data-send]").click();
  await expect.poll(async () => {
    const state = await request.get(`/api/sessions/${ses.id}`);
    expect(state.ok()).toBeTruthy();
    const result = await state.json();
    return result.messages?.find((message: { kind: string; payload: Record<string, unknown> }) => message.kind === 'email_card')?.payload;
  }, { timeout: 20000, message: '字段齐全后必须真正生成草稿，不能以缺字段任务结果或乐观芯片冒充' }).toMatchObject({ knowledge_id: 'kb_mail_followup', knowledge_version: 1 });
  const card = page.locator("[data-workbench] [data-kind='email-card']").first();
  await expect(card).toBeVisible({ timeout: 20000 });
  const chip = card.locator("[data-draft-knowledge]");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("模板：");
  await expect(chip).toContainText("阶段跟进");
  await expect(chip).toContainText("v1");
});

test("员工面子树不出现内部实现词与管理口径", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expect(kb).not.toContainText(/Codex|Harness|MCP|发送不等于推进阶段|发送不等于改阶段|发送\s*≠|不会改阶段|用这份写信|资产·不发送|资产 · 不发送|知识市场|我的知识库|口径与其它/);
});
