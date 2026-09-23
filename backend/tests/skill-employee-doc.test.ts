import { describe, expect, it } from "vitest";
import { employeeDocFromText } from "../src/host/skills-catalog.js";

/**
 * 员工面「说明书」只取技能文件 `## 员工口径` 小节的正文，并按白名单整段丢弃含引擎系统词 /
 * JSON 片段 / 英文 snake_case id 的段落（`GET /skills/:id` 的 `employee_doc`）。
 * 依据：不把 SKILL.md 原文整段发给前端 —— 原文混着引擎实现细节（CONST-10 实施诚实）。
 */

function file(body: string): string {
  return `---
id: demo_skill
title: 演示技能
description: 演示
category: 线索
profile: lead
output: task_result
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
---

# 演示技能

${body}
`;
}

describe("员工口径小节抽取", () => {
  it("只取该小节，段落 / 列表 / 小标题按原样保留", () => {
    const text = file(`## 员工口径

在达人库里按关键词查已有档案，结果只读。

- 打开筛选面板收窄范围。
- 看结果列的摘要。

### 范围

只看你被授权的达人范围。

## 禁止事项

- 这一节不该被抽到。`);
    expect(employeeDocFromText(text)).toBe(
      "在达人库里按关键词查已有档案，结果只读。\n\n"
      + "- 打开筛选面板收窄范围。\n\n"
      + "- 看结果列的摘要。\n\n"
      + "### 范围\n\n"
      + "只看你被授权的达人范围。",
    );
  });

  it("含引擎系统词 / JSON 片段 / 英文 snake_case id 的段落整段丢弃，其余照留", () => {
    const text = file(`## 员工口径

保留这一段。

这段提到 Codex app-server 的 turn，丢弃。

这段带 JSON 片段 {"stage":"reach"}，丢弃。

- 保留的列表项。
- 这项走 starrykol.pageKolProfiles 分页，丢弃。

保留的收尾段。`);
    expect(employeeDocFromText(text)).toBe(
      "保留这一段。\n\n- 保留的列表项。\n\n保留的收尾段。",
    );
  });

  it("没有该小节时返回空字符串", () => {
    expect(employeeDocFromText(file("## 禁止事项\n\n- 禁止发信。"))).toBe("");
  });

  it("该小节整段被过滤时同样返回空字符串（不拿空壳冒充说明书）", () => {
    expect(employeeDocFromText(file("## 员工口径\n\n走 MCP 工具 Host 编排。"))).toBe("");
  });
});
