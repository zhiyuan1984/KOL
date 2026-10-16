import type { APIRequestContext, Page } from "@playwright/test";

/** The disabled-native test actor and B.active membership use one stable identity. */
const HOME_FOLLOW_TEST_IDENTITY = {
  employee_id: "u_sriphy",
  follow_scope: {
    required: true,
    bound: true,
    mailbox_email: "sriphy@amperetime.com",
    mailbox_id: "mailbox_sriphy",
    owner_name: "Sriphy",
    status: "connected",
    has_token: true,
  },
};

/** Complete B.active server authority. Board-shaped data is accepted only as fixture input, never as a UI fallback. */
export async function stubHomeFollowing(page: Page, kols: Array<Record<string, unknown>> = []) {
  const activeRows = kols.map((kol) => ({
    ...kol,
    source_kind: typeof kol.source_kind === "string" && kol.source_kind ? kol.source_kind : "kol_follow_index",
    status: "active",
  }));
  // The authoritative membership read carries a scope query. Match the
  // pathname plus optional query so this remains a legal server-bound
  // collaboration fixture instead of falling through to a live empty read.
  await page.route(/\/api\/home\/following(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "我的跟进",
        contract: "B.active+verified_starry_binding",
        authority: "kol_follow_index+verified_starry_binding",
        completeness: "complete",
        ...HOME_FOLLOW_TEST_IDENTITY,
        kols: activeRows,
      },
    });
  });
}

/** Independent read-only server snapshot: global total and query/filter matched are distinct. */
export function homePoolReadonlyPayload(items: Array<Record<string, unknown>>, params = new URLSearchParams()) {
  const query = (params.get("query") || "").trim().toLowerCase();
  const filter = params.get("filter") || "all";
  const offset = Number(params.get("offset") || 0);
  const limit = Number(params.get("limit") || 50);
  const isNew = (row: Record<string, unknown>) => !row.has_conversation && !row.last_conversation_id;
  const queried = items.filter((row) => !query || [row.handle, row.display_name, row.platform, row.region, row.direction]
    .join(" ").toLowerCase().includes(query));
  const matched = queried.filter((row) => filter === "all" || (filter === "new" ? isNew(row) : !isNew(row)));
  const sort = params.get("sort") || "default";
  const metric = (row: Record<string, unknown>) => Number(String(row.followers || "0").replace(/,/g, ""));
  const ordered = [...matched];
  if (sort.startsWith("followers-")) ordered.sort((a, b) => (metric(a) - metric(b)) * (sort.endsWith("asc") ? 1 : -1));
  const newCount = queried.filter(isNew).length;
  const overdueCount = queried.length - newCount;
  return {
    entry: "memory", kind: "memory", creates_session: false, calls_model: false, index: "公海",
    library: { ok: true, count: items.length },
    items: ordered.slice(offset, offset + limit),
    page: { offset, limit, total: items.length, matched: matched.length,
      new_count: newCount, overdue_count: overdueCount,
      next_offset: offset + limit < matched.length ? offset + limit : null },
  };
}

export async function stubHomePool(page: Page, items: Array<Record<string, unknown>> = []) {
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: homePoolReadonlyPayload(items, new URL(route.request().url()).searchParams) });
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
