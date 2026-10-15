# 前端开发执行入口

本文件适用于 `frontend/` 及其子目录；先继承仓库根 [`../AGENTS.md`](../AGENTS.md)，不改变宪法、基本法、业务权限或发布规则。

## 开工

1. 读取根入口、[`../docs/CONSTITUTION.md`](../docs/CONSTITUTION.md)、[`../docs/TECHNOLOGY.md`](../docs/TECHNOLOGY.md)；界面、导航、布局、等待或预览任务还读取 [`../docs/DESIGN.md`](../docs/DESIGN.md) 与 [`../docs/ia-information-architecture.md`](../docs/ia-information-architecture.md)。
2. 按 [`../docs/governance/development-execution.md`](../docs/governance/development-execution.md) 对用户意图和实际改动路径运行 preflight。将生成的 `loading-bundle.json` 的**实际文件内容**交给开发入口，而不是只引用 YAML。
3. 以 `task-contract.json` 为准分配角色、条款、技能、输出和检查。只有选中的技能需要加载；导航、文档预览和异步状态可与普通 UI 路由叠加。

## 前端职责与边界

- **UI/UX** 决定导航、布局、可见反馈与无障碍呈现；**前端** 实现组件和客户端状态；**后端** 决定执行事实、队列、进度与恢复；**测试经理** 收集证据。不要在页面重写业务权限、审批或阶段判断。
- 按 `task-contract` 的 `required_outputs` 交付适用的状态/动作、导航、布局、组件、预览、异步与浏览器/源证据产物。预览必须区分原件阅读与文本阅读；`Steps` 等组件只呈现服务端事实。
- 深链、刷新和浏览器返回保持原地址与对象。共享组件、视觉统一或状态投影不授权迁移路由。
- 对真实等待显示原因、阶段和真实恢复入口；未知进度、失败或不确定结果不得伪装成完成。

## 完成前

运行 `development-verify.mjs`，并提供适用的机器测试报告和人工/浏览器记录。验证脚本只校验文件、哈希、schema 和记录完整性；它不会声称 UI/UX 专家已经审阅，也不会把截图或 skip 当作通过。
