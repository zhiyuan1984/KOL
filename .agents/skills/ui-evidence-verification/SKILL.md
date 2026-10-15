---
name: ui-evidence-verification
description: 按需求与提交验证状态、导航、布局和阅读面。验收 UI、异步状态、文档保真或准备交付/发布时使用；缺失与跳过不能当通过。
---

# 任务全过程证据验收

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **test-manager/ui-ux** 职责作决定；遵守 CONST-10, TECH-TEST-01, TECH-TEST-02, TECH-TEST-03，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 从执行器任务 route 获取必需产物与检查；把每个检查关联源码/技能版本及规则，不凭截图数量判 UX 正确。
2. 使用 templates/browser-and-source-evidence.json 区分 pure/component、mock-browser、real-service、原页对照、人工UX复核；任何一项不能冒充另一项。
3. 实际运行 typecheck/build、相关状态组件测试与 Playwright 流程；保存命令、退出码、开始时间、源码指纹与完整日志，负例也要运行。
4. 浏览器覆盖入队交接、长等待、断线、失败、uncertain、同名切换、候选核对入口和原页定位。测量关键区溢出/裁切及 CTA，人工回答阶段/原因/下一步/原文可读四问。
5. 缺必需环境/截图/原件标记 unverified/blocked；运行执行器 verify，明确未通过项和回滚点。用户未授权则不替人核对、审批、发布，不批量重跑生产资料以制造成功证据。

## 可实例化资产与交接

- 用 `templates/browser-and-source-evidence.json` 构造 **browser-and-source-evidence**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py ui-evidence-verification <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
