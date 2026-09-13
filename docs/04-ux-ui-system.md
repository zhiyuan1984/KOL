# UI/UX 系统与工作台规范

设计目标是让员工完成业务任务，让管理员理解和控制运行，而不是让员工学习引擎。

KOL 试点的可执行 UX 实例是 [`specs/UX-KOL.md`](../specs/UX-KOL.md)，其 ID、FS、红线和 E2E 绑定见 [`specs/ux-traceability.json`](../specs/ux-traceability.json)。没有 UX ID 和追踪关系的交互描述只能作为设计讨论稿。

## 双端边界

员工端只展示我的任务、品牌、KOL、SOP、草稿、待确认、结果、证据、下一步和异常接管；隐藏 MCP、Codex、Thread、Skill 时序、原始堆栈和连接器配置。管理端提供组织、品牌、Agent、Skill、MCP、知识、Policy、任务、Trace、审计和人工接管。

超级用户可以进入两端和显式调试视图，但仍不能跳过发送、阶段、解密、导入、删除和审批闸门。

员工端四页分工（Home = 现在做什么 / Pipeline = 正式生命周期资产 / Chat = 完成一件任务 / Admin = 谁与审计）以 `19-ui-ux-constitution.md` 的页面角色法律为准。Pipeline 不得复用首页待办桶或会话技能启动器。

## 任务驱动体验

首页推荐是预填建议，不是自动执行；AI 发现不会自动变成员工待办，用户提交或转办后才创建 Task。点击推荐、芯片或快捷入口只锁定/预填 Skill，不绕过权限、审批和状态机。

会话页采用任务列表 + 业务工作区；管理员可额外打开执行 Trace。员工看“当前阶段、本阶段要做什么、结果和证据”，不看“调用了哪个 MCP”。

## 状态可见性

至少支持 `IDLE`、`SUBMITTING`、`QUEUED`、`RUNNING`、`WAITING_INPUT`、`WAITING_APPROVAL`、`SUCCEEDED`、`FAILED`、`RETRYING`、`MANUAL_TAKEOVER`、`CANCELLED`。等待期间必须显示：任务已接收、当前业务阶段、最后更新时间、已完成产物、下一步、停止/重试/接管；禁止无状态 loading。

## 消息和操作

- L1 只读分析：事实、来源和建议，不写外部数据。
- L2 草稿/预览：明确“AI 生成、未生效”，可编辑和重写。
- L3 待确认变更：显示前后 diff、风险、证据、确认/拒绝；拒绝必须有原因。

发送、阶段变更、解密、导入和删除必须使用不同操作卡。发送不等于阶段推进；阶段写入必须选择具体 `stage_code`，不能用“下一阶段”。

## 视觉与无障碍

蓝色表示主操作，橙色表示高风险，绿色表示成功/已发布，红色表示错误；统一任务列表、业务对象卡、时间线、草稿卡、审批卡、风险标签、来源引用和异常恢复组件。支持键盘、焦点可见、读屏播报、错误关联字段、足够对比度和响应式布局。

## UX 验收覆盖

UX 验收只认 `specs/UX-KOL.md` 中的 ID 和 `specs/ux-traceability.json` 的追踪关系。每个关键路径至少验证以下状态：

| UX ID | 必测行为 | 证据要求 |
|---|---|---|
| UX-CTX-BRAND | 常驻展示公司、品牌、区域、发件箱和 Agent 状态；切换范围清空未提交草稿 | 员工端 E2E + R-019 |
| UX-DEF-MAILBOX-N | 多邮箱无默认选择；停用/移交邮箱只能查看不能发信 | R-010/R-011 + 员工端 E2E |
| UX-MAIL-STATUS | 展示邮箱品牌、负责人、授权状态、来源时间 | 真实 MCP 脱敏回放 |
| UX-TB-BIND | TB 绑定未就绪时显示阻断态，不回退其他品牌 | TB 契约测试 + E2E |
| UX-AGENT-UNPUBLISHED | 未发布 Agent 可查看说明但不能提交任务 | manifest 闸门测试 + E2E |
| UX-OWNER-NOT-SKIP | 部门负责人仍看到高风险确认/审批卡 | 权限测试 + E2E |
| UX-SEND-NE-STAGE | 发送卡和阶段卡分离，发送后不推进阶段 | R-006/R-008 |
| UX-STATE-VISIBLE | queued/running/input/approval/retry/failed/takeover 均有业务文案、时间、产物和下一步 | Playwright 状态矩阵 |
| UX-COPY-ENGINE | 员工端不出现 MCP/Codex/Thread/Skill/原始堆栈 | 文案扫描 + E2E |

没有 E2E、截图或脱敏 Trace 的 UX 项只能标记为“规格存在”，不能标记为“体验验收通过”。
