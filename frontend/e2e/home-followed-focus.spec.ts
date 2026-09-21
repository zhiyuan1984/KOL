import { test, expect, type Page } from "@playwright/test";
import { stubHomeBoardAndFollowing } from "./kol-surface-stub";

/** 两张建议进入下一阶段的卡：CTA 是 [data-confirm-enter-stage]，强调随 hover / focus。 */
const CARD_A = {
  id: "col_stage_a",
  handle: "阶段甲",
  brand: "LT",
  stage_code: "INITIAL_CONTACT",
  stage_label: "初步接触",
  suggested_stage: "已回复-有兴趣",
  suggested_stage_code: "INTERESTED",
  days_in_stage: 3,
  mail_threads: [{
    conversation_id: "thread-a",
    subject: "Re: collab A",
    unread_count: 0,
    last_direction: "inbound",
    last_snippet: "我对这次合作有兴趣",
    last_at: "2026-09-12T10:00:00.000Z",
  }],
};

const CARD_B = {
  ...CARD_A,
  id: "col_stage_b",
  handle: "阶段乙",
  days_in_stage: 2,
  mail_threads: [{
    conversation_id: "thread-b",
    subject: "Re: collab B",
    unread_count: 0,
    last_direction: "inbound",
    last_snippet: "我对这次合作有兴趣",
    last_at: "2026-09-11T10:00:00.000Z",
  }],
};

async function openFollowed(page: Page) {
  await stubHomeBoardAndFollowing(page, { kols: [CARD_A, CARD_B] });
  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-followed-kol="阶段甲"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("只有指针真的移动才算悬停：滚动补发的 mouseenter 不抢键盘焦点", async ({ page }) => {
  await openFollowed(page);
  const stageA = page.locator('[data-followed-kol="阶段甲"]');
  const stageB = page.locator('[data-followed-kol="阶段乙"]');

  // 键盘焦点在 B 的按钮上。
  await stageB.locator("[data-confirm-enter-stage]").focus();
  await expect(stageB).toHaveAttribute("data-cta-emphasis", "strong");

  // 滚动换到指针底下的元素时，Chromium 补的是 mouseover/mouseenter，不带 mousemove。
  // 那种「悬停」不算用户意图：不 blur 焦点、不点亮 A 的实底 CTA。
  const hoveredByScrollOnly = await stageA.evaluate(async (el) => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return el.classList.contains("is-hovered");
  });
  expect(hoveredByScrollOnly).toBe(false);
  await expect(stageB).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(stageB.locator("[data-confirm-enter-stage]")).toBeFocused();
  await expect(stageA).toHaveAttribute("data-cta-emphasis", "quiet");

  // 指针真的移上去才算：A 拿走实底，B 退回幽灵。
  await stageA.hover();
  await expect(stageA).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/work/);
  await expect(stageB).toHaveAttribute("data-cta-emphasis", "quiet");
});
