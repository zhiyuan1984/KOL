---
name: ux-task-and-state-design
description: 构造用户可理解的当前阶段、等待原因、真实进展及下一步。异步加工、禁用按钮、空态、失败或不确定结果等界面任务时使用。
---

# 用户任务与状态构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **ui-ux** 职责作决定；遵守 CONST-04, TECH-FE-01, TECH-FE-03, TECH-BE-03，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 把用户任务写成一页一问：处理哪份资料/版本，现在是什么阶段，需要谁做什么。
2. 从服务端状态、持久意图、允许动作生成事实表；使用 templates/state-and-action-map.json 的状态样例，不以 CTA 或颜色推断业务状态。
3. 构造单点任务信息区：阶段 + 原因 + 已知进展 + 下一步。调用项目异步信息组合组件；数值未知时明确写“未提供细分进度”。
4. 对每个禁用操作给出可见原因。构造排队、运行、重试、失败、取消、uncertain、候选待核对和读取失败样例；uncertain 先查询/接管，不盲重试。
5. 测试执行中的 empty 不显示“尚未提炼”；候选生成不等于已核对/审批/发布。用实际浏览器复核五秒内能否指出阶段和下一步，记录该复核不能冒充用户研究。

## 可实例化资产与交接

- 用 `templates/state-and-action-map.json` 构造 **state-and-action-map**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py ux-task-and-state-design <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
