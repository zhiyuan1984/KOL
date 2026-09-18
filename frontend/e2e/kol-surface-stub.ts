import type { APIRequestContext, Page } from "@playwright/test";

/** #172 GET /api/home/following envelope. `kols` may be board-shaped; FE toFollowKol accepts both. */
export async function stubHomeFollowing(page: Page, kols: Array<Record<string, unknown>> = []) {
  await page.route("**/api/home/following", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "我的跟进",
        authority: "kol_follow_index",
        kols,
      },
    });
  });
}

export async function stubHomePool(page: Page, items: Array<Record<string, unknown>> = []) {
  await page.route("**/api/home/pool", async (route) => {
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
    await page.route("**/api/tasks", (route) => route.fulfill({ json: board.tasks }));
  }
}

/** Demo fixtures seed collaborations on board, not B.index — mirror for follow-pane e2e. */
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
