import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { taskDefinitions } from "../src/tasks/registry.js";
import { skillCatalog } from "../src/host/skills-catalog.js";

/**
 * 员工面文案：技能目录给员工看的 `summary` 应优先用 SKILL.md 的 `employee_summary`
 * （业务语言），缺省才回落到 `description`（引擎口径，可能含 today_brief / display_tasks
 * 这类原始字段名 —— 见 specs/UX-EMPLOYEE.md §员工禁词）。
 */

let root: string;

function manifest(extra: string): string {
  return `---
id: demo_skill
title: 演示技能
description: 由 Host 产出 task_result 并写入 display_tasks
category: 线索
profile: lead
output: task_result
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
${extra}---

# 演示技能
`;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-summary-"));
  fs.mkdirSync(path.join(root, "demo_skill"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("技能员工面文案", () => {
  it("填了 employee_summary 时，目录用它而不是引擎描述", () => {
    fs.writeFileSync(
      path.join(root, "demo_skill", "SKILL.md"),
      manifest("employee_summary: 按关键词查达人库，只读结果，不改阶段\n"),
    );
    expect(taskDefinitions(root)[0]?.employee_summary).toBe("按关键词查达人库，只读结果，不改阶段");
    expect(skillCatalog(root)[0]?.summary).toBe("按关键词查达人库，只读结果，不改阶段");
  });

  it("没填时回落到 description（现状如实保留，便于门禁暴露引擎词）", () => {
    fs.writeFileSync(path.join(root, "demo_skill", "SKILL.md"), manifest(""));
    expect(taskDefinitions(root)[0]?.employee_summary).toBeUndefined();
    expect(skillCatalog(root)[0]?.summary).toContain("task_result");
  });

  it("employee_summary 写成空值时按清单错误报出，不静默采用", () => {
    fs.writeFileSync(path.join(root, "demo_skill", "SKILL.md"), manifest("employee_summary:   \n"));
    expect(() => taskDefinitions(root)).toThrow(/employee_summary/);
  });
});
