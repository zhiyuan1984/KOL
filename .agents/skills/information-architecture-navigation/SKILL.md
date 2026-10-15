---
name: information-architecture-navigation
description: 构造入口、页面职责、局部切换、深链及返回上下文。页面导航、列表详情联动或共享布局改造时使用，不能将视觉统一当路由迁移。
---

# 信息架构与导航构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **ui-ux** 职责作决定；遵守 CONST-04, TECH-FE-03, PROD-PLAT-02，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 读取 docs/ia-information-architecture.md，记录每个表面的唯一问题及现有 URL、对象身份。
2. 使用 templates/navigation-contract.json 描述节点、边、局部切换与返回状态；查询组件目录优先复用 LifecycleNavigation、SectionTabs、知识浏览骨架。
3. 区分导航 Menu/Breadcrumb、局部 Tabs 和筛选按钮；使用各自键盘/ARIA 语义，不把筛选伪装 Tab。
4. 实现不改变当前深链：列表→详情→返回保留筛选、资料 ID 和合理滚动上下文。需要迁移时另立明确迁移契约，不在本技能暗中重定向。
5. 验证直开、刷新、重开、浏览器返回与失败恢复的 URL 和对象身份；检查动作计数，避免“返回”触发重跑。

## 可实例化资产与交接

- 用 `templates/navigation-contract.json` 构造 **navigation-contract**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py information-architecture-navigation <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
