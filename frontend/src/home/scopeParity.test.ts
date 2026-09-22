import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { scopeRows } from "./scopeRows";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => fs.readFileSync(path.resolve(here, ...parts), "utf8");

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    source: "manual",
    status: "pending",
    priority: "normal",
    ...partial,
  };
}

const day = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString();
};

/**
 * 今日任务 and 我的待办 must be the same product surface twice: one workspace, one
 * row projection, and the same request set — only the scope path differs.
 * These are the executable form of that promise (docs/DESIGN.md, CONST-10).
 */
describe("pane parity", () => {
  it("splits the same open memory into two disjoint, complete slices", () => {
    const rows = [
      task({ id: "overdue", title: "已逾期", due_at: day(-3) }),
      task({ id: "due_today", title: "今天到期", due_at: day(0) }),
      task({ id: "running", title: "进行中", status: "running" }),
      task({ id: "later", title: "无日期事项" }),
      task({ id: "closed", title: "已完成", status: "completed", priority: "important_urgent" }),
      task({ id: "planning", title: "今日规划", task_type: "today_plan", status: "running" }),
    ];
    const today = scopeRows("today", rows).map((row) => row.id);
    const todo = scopeRows("todo", rows).map((row) => row.id);

    expect(today).toEqual(["overdue", "due_today", "running"]);
    expect(todo).toEqual(["later"]);
    // Complete over the open rows and disjoint: nothing is lost or shown twice.
    expect(new Set([...today, ...todo]).size).toBe(today.length + todo.length);
    expect(today).not.toContain("planning");
    expect(todo).not.toContain("closed");
  });

  it("stamps the plan why on both slices without reordering today", () => {
    const rows = [
      task({ id: "due_today", title: "今天到期", due_at: day(0) }),
      task({ id: "later", title: "无日期事项" }),
    ];
    const layout = [{ work_item_id: "later", rank: 1, why: "待办里先做这一件" }];
    const todo = scopeRows("todo", rows, layout);
    expect(todo.map((row) => row.id)).toEqual(["later"]);
    expect(todo[0].layout_why).toBe("待办里先做这一件");
    const today = scopeRows("today", rows, [{ work_item_id: "due_today", rank: 9, why: "本轮先处理" }]);
    expect(today.map((row) => row.id)).toEqual(["due_today"]);
    expect(today[0].layout_why).toBe("本轮先处理");
  });

  it("keeps one request site per scope path, shared by both tabs", () => {
    const api = read("../api.ts");
    const tasksApi = read("./todayTasksApi.ts");
    const home = read("../pages/Home.tsx");

    expect(api).toContain("`/api/home/${scope}-brief`");
    expect(api).toContain("`/api/home/${scope}-brief/plan`");
    expect(tasksApi).toContain("`/api/home/${scope}-tasks`");
    // One fetch site parameterized by scope — not one per tab.
    expect(tasksApi.match(/fetch\(/g)?.length).toBe(1);
    for (const scope of ["today", "todo"]) {
      expect(home).toContain(`usePlanScope("${scope}"`);
      expect(tasksApi).toContain(`fetchScopeTasks("${scope}")`);
      expect(home).not.toContain(`/api/home/${scope}-`);
    }
    // Opening memory and acting on a row are the same request for both tabs.
    expect(home.match(/api\.tasks\(\{ view: "open" \}\)/g)?.length).toBe(2);
  });

  it("forbids scope branches outside SCOPE_CONFIG and scopeRows", () => {
    const workspace = read("./ScopeWorkspace.tsx");
    const board = read("./TaskBoard.tsx");
    const home = read("../pages/Home.tsx");

    // The workspace is scope-parameterized; it must not special-case a tab.
    expect(workspace).not.toMatch(/scope === "today"/);
    expect(workspace).not.toMatch(/scope === "todo"/);
    // The board's start entry serves both scopes (「plan-today」 regression guard).
    expect(board).not.toContain('scope !== "today"');
    expect(board).toContain("data-home-entry={`plan-${scope}`}");
    // Home renders one workspace for both tabs instead of a branch per tab.
    expect(home.match(/<ScopeWorkspace/g)?.length).toBe(1);
    expect(home).not.toContain("TodoPane");
    expect(home).not.toContain("TodayPane");
  });
});
