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

describe("today/todo compact board", () => {
  it("reuses lifecycle priority filters and separates overlapping attention filters", () => {
    const board = read("TaskBoard.tsx");
    expect(board).toContain("<LifecycleNavigation");
    expect(board).toContain('mode="filter"');
    expect(board).toContain('aria-label="任务提醒筛选"');
    expect(board).not.toContain('role="tab"');
    expect(board).not.toContain('aria-selected=');
    expect(board).not.toContain('task-board-refresh');
    expect(board).not.toContain('task-board-result-count');
    expect(board).toContain('import WorkspaceSearchInput from "../components/WorkspaceSearchInput";');
    expect(board).toContain("<WorkspaceSearchInput");
    expect(board).not.toContain("task-board-search-icon");
    expect(board).not.toContain("<svg");
  });

  it("hides zero-count filters unless currently selected and keeps the compact board controls", () => {
    const board = read("TaskBoard.tsx");
    const css = read("today-plan-board.css");
    expect(board).toContain('BOARD_FILTERS.filter(({ id }) => counts[id] > 0 || filter === id)');
    expect(board).toContain('ATTENTION_FILTERS.filter(({ id }) => attentionCounts[id] > 0 || attention === id)');
    expect(board).toContain("<Button");
    expect(board).toContain('type="text"');
    expect(board).toContain('size="small"');
    expect(board).toContain("<HighlightOutlined");
    expect(board).toContain('planStartEvent(scope)');
    expect(board).toContain("<colgroup>");
    expect(css).toContain("height: var(--table-row-h-compact);");
    expect(css).toContain("box-sizing: border-box;");
    expect(css).toContain("height: var(--workspace-task-action-h);");
    expect(css).toContain("color: var(--cat-assistant-text);");
    expect(css).toContain("min-height: var(--touch-hit-min);");
  });

  it("keeps formal status, execution failure, and due date in separate cells", () => {
    const row = read("BoardRow.tsx");
    expect(row).toContain('className="task-board-cell-status"');
    expect(row).toContain('className="task-board-cell-due"');
    expect(row).toContain('hidden={!expanded}');
    expect(row).toContain('aria-controls={detailsId}');
    expect(row).not.toContain('className="task-board-meta"');
    expect(row).toContain('task.status === "queued" ? "已入队"');
    expect(row).toContain('const taskFailed = status.tone === "failed";');
    expect(row).not.toContain('const statusLabel = displayStatusLabel(task)');
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
    expect(planButtonState("refreshed", "today").label).toBe("整理今日任务");
  });

  it("maps task severity low/medium/high to R1/R2/R3 without using priority", async () => {
    const { riskChip } = await import("./BoardRow");
    for (const [risk_level, expected] of [["low", "R1"], ["medium", "R2"], ["high", "R3"], ["none", ""], ["unknown", ""]]) {
      expect(riskChip({ id: "t", title: "x", risk_level, priority: "high" } as never)).toBe(expected);
    }
    const row = read("BoardRow.tsx");
    // icon risk no longer derives from priority rank (a second risk system)
    expect(row).not.toContain("taskPriorityRank(task) <=");
    expect(row).toContain('riskChip(task) === "R3"');
  });
});
