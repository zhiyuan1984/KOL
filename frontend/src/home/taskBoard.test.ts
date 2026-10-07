import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(name: string) {
  return fs.readFileSync(path.resolve(here, name), "utf8");
}

describe("today task board presentation", () => {
  it("hides the priority field while retaining priority ordering", () => {
    const board = read("TaskBoard.tsx");
    const row = read("BoardRow.tsx");
    const model = read("homeModel.ts");
    expect(board).not.toContain('<th>优先级</th>');
    expect(row).not.toContain("board-priority");
    expect(model).toContain("const byPriority = taskPriorityRank(a) - taskPriorityRank(b);");
  });

  it("opens a task detail rail without replacing the explicit task action", () => {
    const board = read("TaskBoard.tsx");
    const row = read("BoardRow.tsx");
    const scope = read("ScopeWorkspace.tsx");
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    expect(board).toContain("onOpen={onOpen}");
    expect(row).toContain("(onOpen || onAct)(task)");
    expect(row).toContain('data-home-entry={opensTask ? "open-task" : "acknowledge-task"}');
    expect(row).toContain("data-board-status");
    expect(row).toContain("task-board-chip is-");
    expect(scope).toContain("onOpen?: (task: Task) => void;");
    expect(scope).toContain("<TaskDetailRail");
    expect(home).toContain("setDetailTask(current);");
    expect(home).toContain("const startTaskExecution = async");
    expect(home).not.toContain("const sessionId = taskSessionId(current);");
    expect(home).toContain("onOpen={(task) => void openTask(task)}");
  });

  it("maps the today shortcut to its skill template context", () => {
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    expect(home).toContain('lockedIntent === "creator_daily_tasks"');
    expect(home).toContain("definitions.find((definition) => definition.id === \"creator_daily_tasks\")?.ui_template");
    expect(home).toContain("<SkillTemplateContext template={activeSkillTemplate}");
  });
});

describe("today/todo consistency fixes", () => {
  it("renders waiting_approval as its own 等审批 status (not 进行中)", async () => {
    const { boardStatus } = await import("./BoardRow");
    const { taskDetailStatus } = await import("./TaskDetailRail");
    const waiting = { id: "t", title: "x", status: "waiting_approval" } as never;
    expect(boardStatus(waiting)).toEqual({ label: "等审批", tone: "approval" });
    expect(taskDetailStatus(waiting)).toEqual({ label: "等审批", tone: "approval" });
    // the rest of the mapping is untouched
    expect(boardStatus({ id: "t", title: "x", status: "running" } as never).label).toBe("进行中");
    expect(boardStatus({ id: "t", title: "x", status: "pending" } as never).label).toBe("待处理");
  });

  it("names the failed plan button 重新规划 (not 生成)", async () => {
    const { planButtonState } = await import("./TaskBoard");
    expect(planButtonState("failed", "today").label).toBe("重新规划今日计划");
    expect(planButtonState("failed", "todo").label).toBe("重新规划待办计划");
    expect(planButtonState("refreshed", "today").label).toBe("生成今日计划");
  });

  it("keeps risk icon and R chip on the same risk_level source", () => {
    const row = read("BoardRow.tsx");
    // icon risk no longer derives from priority rank (a second risk system)
    expect(row).not.toContain("taskPriorityRank(task) <=");
    expect(row).toContain('riskChip(task) === "R1"');
  });
});
