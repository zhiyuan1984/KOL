---
name: responsive-page-layout
description: 从信息优先级与实际容器选择共享布局和阅读骨架。页面排版、长内容、窄栏、短屏或触摸键盘适配时使用。
---

# 响应式页面骨架构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **ui-ux/frontend** 职责作决定；遵守 CONST-04, TECH-FE-02, TECH-TEST-02，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 读取 DESIGN.md §1/6/11/24/28；测量实际容器宽、高和输入模态，而非仅按设备名。
2. 从 docs/governance/development-component-catalog.md 选择列表详情、单列编辑或文档阅读模式；实例化 templates/layout-contract.json 的组件树。
3. 先安排资料标题/版本与任务信息，再安排主要操作、阅读面与次级加工记录。使用 InformationLayout 中 PropertyList/HorizontalForm/RecordRow/ActionGroup；不维护平行通用控件。
4. 窄容器独立字段组单列，长内容明确内部阅读区；文本允许换行，min-width:0。不得用外层 overflow:hidden 掩盖布局缺陷。
5. 用 375/768/1280/1920 宽及短高、触摸/键盘测试重点文字与操作可见；记录容器而非仅视口，保持唯一 L1 和 token 数值来源。

## 可实例化资产与交接

- 用 `templates/layout-contract.json` 构造 **layout-contract**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py responsive-page-layout <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
