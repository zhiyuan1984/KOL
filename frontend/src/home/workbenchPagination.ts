import { api, type Task, type WorkbenchTaskPage } from "../api";

export type WorkbenchPageLoader = (
  view: "today" | "todo",
  options?: { cursor?: string; limit?: number },
) => Promise<WorkbenchTaskPage>;

/**
 * Loads every authorized row from the server-owned workbench projection.
 * The API remains bounded per request; duplicate ids are replaced in-place so
 * a row that moves while pagination is in flight is never rendered twice.
 */
export async function loadAllWorkbenchTasks(
  view: "today" | "todo",
  loadPage: WorkbenchPageLoader = api.workbenchTasks,
): Promise<Task[]> {
  const byId = new Map<string, Task>();
  const order: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    if (pages++ >= 100) throw new Error("任务分页超过安全上限，请缩小筛选范围后重试");
    const page = await loadPage(view, { cursor: cursor || undefined, limit: 100 });
    for (const item of page.items || []) {
      if (!byId.has(item.id)) order.push(item.id);
      byId.set(item.id, item);
    }
    cursor = page.page?.next_cursor || null;
  } while (cursor);
  return order.map((id) => byId.get(id)!).filter(Boolean);
}
