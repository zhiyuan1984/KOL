import { expect, test } from "@playwright/test";

/**
 * 员工端知识库「阶段 3」契约：服务端搜索、适用筛选、同页详情（右栏）溯源与草稿卡引用芯片。
 *
 * 只断言页面自己的 DOM 契约，不改 workbench.spec.ts 的既有基线：
 *   搜索 → [data-kb-search]（debounce 后走 GET /api/knowledge?q=）
 *   适用 → 行内 [data-kb-scope] chips 只露品牌值（阶段在右栏给中文标签），
 *          阶段筛选为标签行：＋增加、×移除、无「全部」；值按代码过滤、展示中文标签
 *   溯源 → 右栏 [data-kb-provenance]：发布人 / 版本 / 更新时间 / 适用
 *   芯片 → 草稿与回执 [data-draft-knowledge]：模板：{标题} v{n}
 *
 * stub 种子（backend/src/host/knowledge.ts seedKnowledge）里：
 *   kb_mail_ship「发货通知」的 subject 是 "Sample shipped — [运单号]"，正文没有 shipped，
 *   所以 q=shipped 只命中它一条 —— 顺带证明关键词检索覆盖了 subject。
 */

test.beforeEach(async ({ request }) => {
  // 种子库跨运行保留（其它用例会重建协作与隐藏知识），先回到工作台基线再断言。
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  for (const id of ["kb_mail_kol", "kb_mail_followup", "kb_mail_ship"]) {
    await request.delete(`/api/knowledge/${id}/deprecate`);
  }
});

test("搜索按关键词收敛到单条种子，清空后恢复", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toBeVisible();

  await kb.locator("[data-kb-search]").fill("shipped");
  await expect(kb.locator('[data-knowledge="kb_mail_ship"]')).toBeVisible();
  await expect(kb.locator('[data-knowledge="kb_mail_ship"]')).toContainText("发货通知");
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toHaveCount(0);
  await expect(kb.locator('[data-knowledge="kb_mail_followup"]')).toHaveCount(0);

  await kb.locator("[data-kb-search]").fill("");
  await expect(kb.locator('[data-knowledge="kb_mail_kol"]')).toBeVisible();
  await expect(kb.locator('[data-knowledge="kb_mail_followup"]')).toBeVisible();
});

test("同页详情给出来源与版本与全文（右栏常显）", async ({ page }) => {
  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await kb.locator('[data-kb-open="kb_mail_followup"]').click();

  const rail = page.locator('[data-kb-preview="kb_mail_followup"]');
  await expect(rail).toBeVisible();
  const provenance = rail.locator("[data-kb-provenance]");
  await expect(provenance).toBeVisible();
  await expect(provenance).toContainText("来源与版本");
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

  const mail = kb.locator('[data-knowledge="kb_mail_followup"] [data-kb-scope]');
  await expect(mail).toBeVisible();
  await expect(mail).toContainText("LT");
  await expect(mail).not.toContainText("初步接触");

  const policy = kb.locator('[data-knowledge="kb_followup"] [data-kb-scope]');
  await expect(policy).toBeVisible();
  await expect(policy).toContainText("通用");

  await kb.locator('[data-kb-open="kb_followup"]').click();
  const rail = page.locator('[data-kb-preview="kb_followup"] [data-kb-scope]');
  await expect(rail).toContainText("全阶段");
  await expect(rail).toContainText("通用");

  // 阶段筛选＝标签行：＋增加、×移除，无「全部」标签（select 选项文本不计入芯片）。
  const stageRow = kb.locator("[data-kb-filter='stage']");
  await expect(stageRow).not.toContainText("全部");
  await stageRow.locator("[data-kb-stage-add]").selectOption("INITIAL_CONTACT");
  await expect(stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]')).toBeVisible();
  await stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]').click();
  await expect(stageRow.locator('[data-kb-stage-remove="INITIAL_CONTACT"]')).toHaveCount(0);

  await expect(kb.locator("[data-kb-filter='brand']")).toBeVisible();
});

test("草稿卡显示「模板：{标题} v{n}」引用芯片", async ({ page, request }) => {
  await request.post("/api/knowledge/kb_mail_followup/cite", { data: {} });
  const ses = await request.post("/api/collaborations/col_xiaomei/session")
    .then((r) => r.json() as Promise<{ id: string }>);
  await page.goto(`/s/${ses.id}`);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await input.fill("/");
  await page.locator("[data-knowledge-option='kb_mail_followup']").click();
  await expect(input).toHaveValue(/LiTime collab kit/);

  await page.locator("[data-send]").click();
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
