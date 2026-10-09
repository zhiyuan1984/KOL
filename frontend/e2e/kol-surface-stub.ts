import type { APIRequestContext, Page } from "@playwright/test";

/** Complete B.active server authority. Board-shaped data is accepted only as fixture input, never as a UI fallback. */
export async function stubHomeFollowing(page: Page, kols: Array<Record<string, unknown>> = []) {
  const activeRows = kols.map((kol) => ({
    ...kol,
    source_kind: typeof kol.source_kind === "string" && kol.source_kind ? kol.source_kind : "kol_follow_index",
    status: "active",
  }));
  await page.route("**/api/home/following", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "我的跟进",
        authority: "kol_follow_index+verified_starry_binding",
        completeness: "complete",
        kols: activeRows,
      },
    });
  });
}

export async function stubHomePool(page: Page, items: Array<Record<string, unknown>> = []) {
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "公海",
        items,
        kols: items,
      },
    });
  });
}

export async function stubHomeBoardAndFollowing(page: Page, board: Record<string, unknown>) {
  const kols = Array.isArray(board.kols) ? board.kols as Array<Record<string, unknown>> : [];
  await page.route("**/api/home/board", (route) => route.fulfill({ json: board }));
  await stubHomeFollowing(page, kols);
  if (Array.isArray(board.tasks)) {
    await page.route(/\/api\/tasks(?:\?.*)?$/, (route) => route.fulfill({ json: board.tasks }));
  }
}

/** Demo fixtures supply B.active rows separately from board so follow-pane tests stay server-authority-only. */
export async function stubFollowingFromServerBoard(page: Page, request: APIRequestContext) {
  try {
    const board = await request.get("/api/home/board").then((row) => row.json()) as {
      kols?: Array<Record<string, unknown>>;
    };
    await stubHomeFollowing(page, board.kols || []);
  } catch {
    await stubHomeFollowing(page, []);
  }
}

/**
 * 页签内容文本 = 页签去掉 tab 行与提问框。这两处是工作台 chrome，会带上「我的待办 /
 * AI发现」这类导航字样，不能算作该页签自己的内容（今日任务 / 我的待办 现在共用同一个
 * 工作台，chrome 对两边一样）。
 */
export async function paneBodyText(page: Page, scope: "today" | "todo"): Promise<string> {
  return page.locator(`[data-home-pane="${scope}"]`).evaluate((pane) => {
    const clone = pane.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-home-quick-tasks], .home-composer-dock").forEach((node) => node.remove());
    return clone.innerText;
  });
}
