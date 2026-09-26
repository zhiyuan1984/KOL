import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Task } from "../api";
import { HOME_ENTRY_REGISTRY as HOME_ENTRY_REGISTRY_BACKEND } from "../../../backend/src/host/entry-registry.js";
import { HOME_ENTRY_REGISTRY } from "./entryRegistry";
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
      task({ id: "due_soon", title: "临期到期", due_at: day(2) }),
      task({ id: "start_today", title: "今天开始", start_date: day(0) }),
      task({ id: "running", title: "进行中", status: "running" }),
      task({ id: "later", title: "无日期事项" }),
      task({ id: "closed", title: "已完成", status: "completed", priority: "important_urgent" }),
      task({ id: "planning", title: "今日规划", task_type: "today_plan", status: "running" }),
    ];
    const today = scopeRows("today", rows).map((row) => row.id);
    const todo = scopeRows("todo", rows).map((row) => row.id);

    expect(today).toEqual(["overdue", "due_today", "due_soon", "start_today"]);
    expect(todo).toEqual(["running", "later"]);
    // Complete over the open rows and disjoint: nothing is lost or shown twice.
    expect(new Set([...today, ...todo]).size).toBe(today.length + todo.length);
    expect(today).not.toContain("planning");
    expect(todo).not.toContain("closed");
  });

  it("keeps terminal discovery runs in task history without reopening ordinary completed tasks", () => {
    const rows = [
      task({ id: "closed_discovery", title: "AI发现 · YouTube · camping", task_type: "discovery_crawl", status: "completed", discovery_run_id: "drun_1" }),
      task({ id: "closed_normal", title: "普通已完成任务", status: "completed" }),
    ];
    const todo = scopeRows("todo", rows).map((row) => row.id);
    expect(todo).toEqual(["closed_discovery"]);
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

  it("keeps one workspace shell for all five panes", () => {
    const shell = read("./WorkspaceShell.tsx");
    const scope = read("./ScopeWorkspace.tsx");
    const discovery = read("./DiscoveryWorkspace.tsx");
    const objects = read("./ObjectWorkspace.tsx");
    const boardCss = read("./today-plan-board.css");
    const home = read("../pages/Home.tsx");

    // 两栏几何只在 WorkspaceShell 里写一次，今日/待办与 AI发现 都组合它。
    expect(shell).toContain('data-scope-ai-workspace');
    expect(shell).toContain("data-scope-task-rail");
    expect(shell).toContain("scope-workspace-center-scroll");
    expect(scope).toContain("<WorkspaceShell");
    expect(discovery).toContain("<WorkspaceShell");
    expect(objects).toContain("<WorkspaceShell");
    // 内容组件不许再写骨架：出现这些选择器就意味着出现了第二套几何。
    for (const file of [scope, discovery, objects]) {
      expect(file).not.toContain("data-scope-ai-workspace");
      expect(file).not.toContain("data-scope-task-rail");
      expect(file).not.toContain("scope-task-rail-toggle");
      expect(file).not.toContain("scope-workspace-center-content");
    }
    // 折叠隐藏的是槽内容：外壳不认识任何具体业务组件。
    expect(shell).not.toContain("task-board");
    expect(boardCss).toContain(".scope-task-rail.is-collapsed .scope-task-rail-body");
    expect(boardCss).not.toContain(".scope-task-rail.is-collapsed > .task-board");
    // AI发现与两个对象面都组合唯一骨架。
    expect(home).toContain("<DiscoveryWorkspace");
    expect(home.match(/<ObjectWorkspace/g)?.length).toBe(2);
    expect(shell).toContain('"pool" | "lifecycle"');
    expect(home).toContain("data-home-workspace={workspacePane");
    expect(home).not.toContain('<section className="home-mode-pane discovery-pane"');
    expect(home).not.toContain('data-home-quick-task="first-outreach"');
  });

  it("keeps workspace rail geometry on DESIGN tokens", () => {
    const css = read("../styles.css");
    const boardCss = read("./today-plan-board.css");
    const discoveryCss = read("./discovery-workspace.css");
    for (const token of [
      "--workspace-result-rail-min",
      "--workspace-result-rail-ideal",
      "--workspace-result-rail-max",
      "--workspace-result-rail-collapsed",
    ]) {
      expect(css).toContain(`${token}:`);
    }
    expect(boardCss).toContain("var(--workspace-result-rail-min)");
    expect(boardCss).not.toMatch(/clamp\(\s*600px/);
    expect(boardCss).toContain("max-width: 1100px");
    // Empty discovery results are content state only. They must not shrink the
    // expanded rail below the same width used by today and todo.
    expect(boardCss).not.toContain(".scope-workspace.is-result-idle:not(.is-task-rail-collapsed)");
    expect(discoveryCss).not.toContain("padding-top: calc(var(--space-5) + var(--space-5))");
  });

  it("object panes no longer declare a second pane skeleton", () => {
    const pool = read("./PoolPane.tsx");
    const followed = read("./FollowedPane.tsx");
    // embedded prop removed: panes always render as result-rail content.
    expect(pool).not.toContain("embedded");
    expect(followed).not.toContain("embedded");
    // No self-declared page pane: the shell owns data-home-pane.
    expect(pool).not.toContain("data-home-pane");
    expect(followed).not.toContain("data-home-pane");
    expect(pool).not.toContain("home-mode-pane");
    expect(followed).not.toContain("home-mode-pane");
    // Fixed result-rail class is always present, including the compact public
    // list, so the shell and object panes preserve the same rail geometry.
    expect(pool).toContain("is-result-rail");
    expect(followed).toContain("is-result-rail");
  });

  /**
   * 前后端登记表同构（CONST-07）：同一个入口 id 在两边的 kind 与四个副作用标志必须逐字相同。
   * 只做文案或只在一端加条目的改法在这里会红。
   */
  it("keeps the mail entries identical in both registries", () => {
    const ids = ["list-mailbox-mail", "open-mail-thread", "mail-compose-catalog", "sync-mailbox-mail"];
    for (const id of ids) {
      const front = HOME_ENTRY_REGISTRY.find((row) => row.id === id);
      const back = HOME_ENTRY_REGISTRY_BACKEND.find((row) => row.id === id);
      expect(front).toBeDefined();
      expect(back).toEqual(front);
    }
    expect(HOME_ENTRY_REGISTRY.find((row) => row.id === "mail-compose-catalog")).toMatchObject({
      kind: "memory",
      action: "通讯邮件任务目录",
      creates_session: false,
      creates_turn: false,
      calls_model: false,
      route: "GET /api/mail/compose-catalog",
    });
  });
});
