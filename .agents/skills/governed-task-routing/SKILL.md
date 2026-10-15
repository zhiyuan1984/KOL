---
name: governed-task-routing
description: 将需求、意图与受影响路径转为角色、规则、技能及验收契约。开始开发任务、跨前后端改造或发现一直等待等体验缺陷时使用。
---

# 受治理任务路由

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **project-manager** 职责作决定；遵守 CONST-04, CONST-08, CONST-10, TECH-TEST-01，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 确认目标、授权与代码基线；读取根 AGENTS.md 和宪法，按领域加载基本法。不要从目录名猜任务类型。
2. 在仓库根运行 `node scripts/development-preflight.mjs --task-id "稳定任务ID" --intent "用户原始需求" --path "受影响路径" --out "任务输出目录"`；多个路径重复 `--path`。如命令接口发生变化，先执行 `--help`，不得猜参数。
3. 阅读执行器输出的 route、必读文件及技能 bundle。按每个技能的构造步骤生成产物，不以“专家已调用”代替输出。关联同一任务 ID、源码版本与技能内容哈希。
4. 使用 templates/task-contract.json，分别记录职责、受保护契约、交接与成功条件；纯后端无关任务不强制 UI 技能。
5. 完成相关检查后运行执行器 verify；缺失技能或适用证据只阻塞依赖它的部分。禁止把 draft、skip 或模拟服务通过标为生产已验收。

## 可实例化资产与交接

- 用 `templates/task-contract.json` 构造 **task-contract**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py governed-task-routing <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
