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

  it("maps the today shortcut to its skill template context", () => {
    const home = fs.readFileSync(path.resolve(here, "../pages/Home.tsx"), "utf8");
    expect(home).toContain('lockedIntent === "creator_daily_tasks"');
    expect(home).toContain("definitions.find((definition) => definition.id === \"creator_daily_tasks\")?.ui_template");
    expect(home).toContain("<SkillTemplateContext template={activeSkillTemplate}");
  });
});
