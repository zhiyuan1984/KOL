# 技能员工面文案：机制 + 待改写清单

> 决策/实施记录，不是现行法。规则本体：`specs/UX-EMPLOYEE.md` §员工禁词（员工表面不摊 MCP、Codex、Thread、英文 Skill 时序、原始堆栈）。

## 1. 问题

员工在 `/skills` 看到的技能说明 = 接口字段 `summary`，它由 `backend/src/host/skills-catalog.ts` 取
`SKILL.md` front-matter 的 **`description`**（`summary: definition.description`）。
而 `description` 是写给引擎看的：里面有 `today_brief`、`display_tasks`、`discovery_brief/v1`、`kol_analyze_brief`、
`stage_sop`、`Nylas`、`Starry` 这类原始字段名 / 契约版本号 / 外部厂商名 / 引擎名。
共 **11 条**技能命中（见文末清单）。

**为什么不在前端清洗**：那是业务口径（CONST-04 归 KOL 业务专家）。前端擅自改写等于替业务改口径，
也会让"引擎读的"和"员工读的"两份文本失去单一来源。

## 2. 机制（已实施）

`SKILL.md` front-matter 新增**可选**字段 `employee_summary`：

```yaml
---
id: todo_plan
title: 待办规划
description: 根据 Host 打包的待办记忆与来源增量，产出封面 today_brief 和展示任务行 display_tasks，不写正式待办或状态
employee_summary: 结合你的待办记忆，生成今天的待办封面和任务行；不会替你写正式待办或改状态
---
```

- 落点：`backend/src/tasks/registry.ts`（类型 + 解析 + 空值校验）、
  `backend/src/host/skills-catalog.ts`（`summary: definition.employee_summary || definition.description`）。
- 行为：填了就用它；**没填则如实回落到 `description`**（不静默替换成占位文案，便于门禁暴露问题）。
- 校验：`employee_summary` 写成空串 → 清单错误（`manifest employee_summary must be a non-empty string`），不静默采用。
- 验证：`cd backend && npx vitest run tests/skill-employee-summary.test.ts`（3 例：优先取用 / 缺省回落 / 空值报错）。
- 待办：把 `employee_summary` 写进 `docs/BUSINESS.md` 或技能编写说明（属业务侧文档，等所有者定）。

## 3. 待业务专家改写清单（11 条）

| 技能 id | 现 description（会显示给员工） | 命中的引擎词 / 英文 |
|---|---|---|
| `confirm_stage` | 按 Starry 阶段定义提出指针变更，等人在会话里确认后再写入 | Starry |
| `creator_contact_decrypt` | 按达人 UID 解密联系方式，属于敏感操作 | UID |
| `discovery_brief` | 采集空闲后，按 Host 已过滤的候选人写 discovery_brief/v1。不入库、不建联。 | Host、discovery_brief/v1 |
| `email_app_conversation_list` | 按关键词、风险标签或达人 UID 查询应用侧邮件会话 | UID |
| `email_conversation_read` | 按会话 ID 读取邮件会话正文和消息 | ID |
| `email_mailbox_list` | 查询品牌邮箱和 Nylas 授权状态 | Nylas |
| `kol_analyze` | 只读分析公海或跟进红人，产出 kol_analyze_brief，不发信不改阶段不解密 | kol_analyze_brief |
| `reply_analysis` | 按 Starry 十五阶段核对来信事实，给出指针与下一步，不改阶段、不发信 | Starry |
| `today_analyze` | 分析已选对象并建议下一步，不自动写状态；对人可附 stage_sop | stage_sop |
| `today_plan` | 根据 Host 打包的历史记忆与来源增量，产出封面 today_brief 和展示任务行 display_tasks，不写正式待办或状态 | Host、today_brief、display_tasks |
| `todo_plan` | 根据 Host 打包的待办记忆与来源增量，产出封面 today_brief 和展示任务行 display_tasks，不写正式待办或状态 | Host、today_brief、display_tasks |

## 4. 验收

- 现有员工面门禁（`frontend/e2e/skills-catalog.spec.ts`）对**系统名**是硬断言（MCP / Codex / Thread / starrykol / kolclaw 不得出现在整页文本）；
  对描述里的原始 id 只取"页面自己翻译的四个小节不得出现英文"这条。
- 业务专家改写完成后，可把整页断言收紧到「不出现 `[a-z]+_[a-z]+` 形态的原始 id」，届时门禁才真正覆盖描述层。
  **在那之前不要把断言收紧** —— 那会让门禁红给所有人看，而问题不在代码。
