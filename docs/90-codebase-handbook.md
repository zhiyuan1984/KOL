# 代码与运行手册

本手册是代码地图，不定义业务规则。规则以 `00`–`13` 主线和真实物理资料为准。

## 阅读顺序

先读 `00-platform-charter.md`、`01-organization-tenancy.md`、`03-prd-and-functional-spec.md`、`05-agent-workflow-skill-policy.md`、`06-codex-harness.md`，再读目标模块的 Skill、MCP 物理资料和测试。

## 修改归属

| 需求 | 首选位置 |
|---|---|
| 业务意图、缺口、推荐、禁止事项 | Skill/Workflow |
| 租户、权限、状态、幂等、审批、发送闸门 | Host/平台内核 |
| 真实外部读写 | 授权远程 MCP / Gateway |
| 员工端业务体验 | 前端通用工作台与 schema |
| 管理端资产与 Trace | 管理端 |
| 测试和模型质量 | 测试、评价集和回归流水线 |

不要通过新增 Host 正则、前端分支或旁路 REST 解决 Skill 缺陷。

## Codex app-server 最小流程

`initialize/initialized → skills/extraRoots/set → thread/start|resume → turn/start → 流式 item/tool/approval 事件 → turn/completed → schema 校验 → WorkItem 持久化`。

## Stub 模式

Stub 是确定性测试替身，用于状态机、权限、幂等和错误路径；它不代表模型选择、Skill 调用、真实 MCP 或员工 UX。生产和真实 UX/集成验收必须使用 app-server 与授权 MCP。
