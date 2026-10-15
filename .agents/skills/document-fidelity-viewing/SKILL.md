---
name: document-fidelity-viewing
description: 构造原件与提取文本的双阅读面以及源页定位。PDF、PPTX、长文档预览、引用证据、缩放或文本错位任务时使用。
---

# 文档保真阅读构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **ui-ux/frontend/backend** 职责作决定；遵守 CONST-06, TECH-FE-02, TECH-BE-01, TECH-BE-06，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 确认资料稳定 ID、版本、media_type、normalize 产物和源页映射；区分应用外壳溢出与原件转换版式问题。
2. 实例化 templates/preview-contract.json；优先复用 /api/admin/knowledge/documents/:id/preview 的逐页 PDF，已有 PDF 使用合法 file 入口。
3. 用成熟浏览器 PDF 阅读器保留页比例与页码；标注“原件预览（转换 PDF）”和“提取文本（不保留版式）”。不要从文本/坐标重新拼幻灯片。
4. URL 编码 document/company 并保留授权；源页通过 #page=N 指向原幻灯片页。预览不可用或浏览器不支持时提示并保留合法原件/新窗入口。
5. 以多栏、中文长段、图表和窄屏的代表页与原页对照；截图+来源页+转换工具版本组成证据。纯文本换行通过不证明 PDF 保真。

## 可实例化资产与交接

- 用 `templates/preview-contract.json` 构造 **preview-contract**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py document-fidelity-viewing <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
