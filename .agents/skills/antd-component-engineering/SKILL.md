---
name: antd-component-engineering
description: 基于锁定的 Ant Design 6.6.5 和项目共享组件实施页面。通用控件、异步信息区、表单、主题映射或组件收敛任务时使用，不默认升级依赖。
---

# AntD 组件构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **frontend** 职责作决定；遵守 TECH-ARCH-01, TECH-ARCH-04, TECH-FE-02，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 查 docs/governance/development-component-catalog.md；复用既有组件优先于直接引入 AntD 或再造控件。
2. 确认 frontend/package-lock.json 的 antd 6.6.5；查安装包组件类型、当前样例和 API。需要外部文档时固定相同版本，不假设 ProComponents 存在。
3. 使用 templates/component-selection.json 输出职责→组件→主题映射→状态样例；正常语义 section、标题、内容文本无需强塞进组件库。
4. 通过项目 ConfigProvider 适配现有 styles.css token；状态图形用 accent，主CTA才用 primary。拒绝新的 hex、独立字号阶梯与平行主题事实源。
5. 用实际组件覆盖 loading/disabled/error/success、键盘焦点、主题/减弱动画；运行 typecheck、构建和适用组件测试。Steps/Progress 只呈现事实，不判审批或权限。

## 可实例化资产与交接

- 用 `templates/component-selection.json` 构造 **component-selection**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py antd-component-engineering <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
