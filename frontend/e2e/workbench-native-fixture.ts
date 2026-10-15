import type { Page } from "@playwright/test";
import { stubHomeBoardAndFollowing } from "./kol-surface-stub";

/** Rendering-only fixtures. The native task board reads host task membership, not legacy board.todo. */
export async function stubNativeHomeBoardAndFollowing(page: Page, board: Record<string, unknown>) {
  await stubHomeBoardAndFollowing(page, board);
  if (!Array.isArray(board.tasks)) return;
  const tasks = board.tasks as Array<Record<string, unknown>>;
  await page.route(/\/api\/workbench\/tasks(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { items: tasks, page: { next_cursor: null } } });
  });
  // No historic plan is allowed to introduce tasks or retain a running/demo plan.
  await page.route(/\/api\/workbench\/plan(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false, calls_model: false } });
  });
  await page.route(/\/api\/home\/(?:today|todo)-tasks(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { items: tasks.map((task, index) => ({ work_item_id: task.id, rank: index + 1 })) } });
  });
}
