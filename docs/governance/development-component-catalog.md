# 开发组件与构造模板目录

版本：1.0.0 · 基线：`4cc14b1a` · 实施职责：前端 / UI-UX / 架构师。

本目录是实施资产，不是新的视觉基本法。**先查项目组件，再查锁定版本 AntD，最后才新增确实缺失的组合。** 唯一数值来源为 `docs/DESIGN.md`，运行颜色与尺寸来自 `frontend/src/styles.css`。没有安装 ProComponents，不默认升级 AntD。

## 1. 组件选择索引

| 页面职责 | 复用源 | 构造方式 | 不承担的决定 |
|---|---|---|---|
| 元数据与标签/值 | `frontend/src/components/InformationLayout.tsx` → `PropertyList` | `items: {key,label,value,emptyText}[]`；容器单列 | 不根据字段推断权限 |
| 单列表单 | 同文件 → `HorizontalForm` | AntD Form + 实际容器适配，标签可换行 | 不修改服务端校验口径 |
| 列表行与明细 | 同文件 → `RecordRow` | title/meta/status/actions/detail 分区 | 不合并同名对象身份 |
| 主要/次级动作组合 | 同文件 → `ActionGroup`；`CompactButton.tsx` | 稳定按钮位置，次级文字按钮，唯一 L1 | 不新增业务动作 |
| 可展开长标题 | 同文件 → `TruncatableText` | 截断后点击展开，兼容键盘/触摸 | 不以 hover 替代完整内容 |
| 工作台搜索 | `frontend/src/components/WorkspaceSearchInput.tsx` | 统一搜索高、清空和焦点 | 不把清空当刷新 |
| 分类筛选/知识浏览 | `KnowledgeBrowse.tsx`、`KnowledgeFilterControls.tsx` | 保留对象、查询、选中与返回上下文 | 不迁移既有深链 |
| 生命周期导航 | `LifecycleNavigation.tsx`、`LifecycleWorkspace.tsx` | 页面局部一级能力切换 | 不把过滤器改为页面导航 |
| 局部页签 | `SectionTabs.tsx` 或 AntD `Tabs` | 使用 tablist/tab/tabpanel 与方向键 | 不触发保存/重跑 |
| 服务端异步事实 | `frontend/src/admin/knowledge/AsyncTaskInfo.tsx` | Alert + Steps + Progress + Collapse；当前阶段/原因/进展/下一步 | 不创造百分比、判审批或自动重试 |
| 文档阅读 | `frontend/src/admin/knowledge/DocumentReader.tsx` | 原件预览 / 提取文本 Tabs；既有 PDF URL + 原件入口 | 不从文本重拼原件版式 |
| 项目 AntD 主题 | `frontend/src/components/ProjectTheme.tsx` | ConfigProvider 从现有 CSS token 解析适配；支持主题切换/减少动画 | 不维护第二套 palette |
| 知识范围核对 | `frontend/src/admin/knowledge/KnowledgeScopePanel.tsx` | 稳定 document_id/revision、候选与服务端动作、dirty 保留 | 不代人核对/审批/发布 |
| 资料详情组合 | `frontend/src/admin/knowledge/DocumentRail.tsx` | 身份/版本、元数据、任务信息、阅读、核对、操作、次级来源 | 不把后台成功当页面全部通过 |

## 2. 已锁定的成熟组件

`frontend/package.json` / 锁文件：`antd: 6.6.5`、`@ant-design/icons: 6.3.4`。

| 需要 | 选择 | 注意 |
|---|---|---|
| 表单输入 | Form / Input / Select | 禁用原因就近文字说明；服务端允许动作优先 |
| 异常与等待原因 | Alert | 状态词和图形，不只颜色 |
| 已知阶段 | Steps | 使用真实服务端阶段，未发生步骤不显示已完成 |
| 已知数量进度 | Progress | 只有 done/total 都有效才呈现；未知不估算 |
| 局部阅读模式 | Tabs | 不修改地址或资料身份 |
| 次级加工记录 | Collapse | 仅明细层；核心阶段不能藏在日志 |
| 长表或治理细节 | Drawer | 复用现有框架和焦点恢复 |
| 文档原页 | PDF.js 5.4.149 + PdfPageViewer / 新窗口 | 真实 viewport 按容器渲染；保留原件入口，不宣称转换保真 |

主题映射方向：正文→`--text`，辅助→`--text-quiet`，执行/选中→`--accent`，主 CTA→`--primary`，失败→`--danger`，告警→`--warning`，成功→`--success`；字号/尺寸/间距/圆角使用已登记 token。正常语义 HTML 可保留，不将所有标题和文本强塞进组件库。

## 3. 可实例化模式

### A. 知识加工 / 单列资料阅读

**入口实现：** `DocumentRail.tsx`（实际组件唯一位置）。

组件树：

```text
ProjectTheme
└─ DocumentRail：稳定 id + 版本 + 服务端动作
   ├─ 标题与 PropertyList（元数据）
   ├─ KnowledgeScopePanel
   │  └─ AsyncTaskInfo：当前阶段、原因、真实进展、下一步
   ├─ DocumentReader
   │  ├─ 原件预览：已有 /preview 逐页 PDF；页码对应原幻灯片
   │  └─ 提取文本：可读可检索，不宣称保留版式
   ├─ 候选范围：原页依据 + 显式人工核对
   ├─ ActionGroup / WorkspaceActions：服务端允许动作
   └─ Collapse：次级加工记录与来源
```

实际结构以源码为准；本目录不复制维护第二套组件。先使用技能 `responsive-page-layout/templates/layout-contract.json` 选模式，再通过 `antd-component-engineering/templates/component-selection.json` 记录本次复用或例外理由。

### B. 列表 + 详情 / 返回上下文

入口资产为已有 `KnowledgeBrowse` / 知识工作区。列表保留 filter/page/selected ID；详情基于 ID，不以同名合并。窄屏仍保留原地址与所选资料，局部展开/阅读不新增导航迁移。

### C. 异步状态样例

| 输入事实 | 核心反馈 | 操作边界 |
|---|---|---|
| doc.pending_review + handoff.pending，无 job | 索引已完成，等待持久交接 | 有界读取；后端恢复，不假装运行 |
| handoff.queued + job.running | 当前提炼运行中 | 活跃作业优先于历史交接与旧候选 |
| job.running + progress 2/4 | 2/4 **已完成批次**，最近业务进展 | 不是心跳，不根据时间上涨 |
| job.running + total=null | 未提供细分进度 | 不显示估算百分比 |
| job.uncertain | 结果待核查 | 不自动重跑，不冒充尚未开始 |
| state.candidate + 无活跃作业 | 范围待核对、未发布 | 人工核对与审批/发布独立 |
| 读取 503 | 上次快照可能过期，有限恢复 | 不宣称失败作业或生成完成 |
| 读取 403 | 自动读取暂停，恢复后重新检查 | 不越权、无无限轮询 |

### D. 文档阅读样例

- 有 PPTX normalize PDF：默认原件预览，另有 PPTX 原件入口；页码跳转采用 `#page=N`。
- 有 PDF：复用已授权 file/preview 入口。
- 无预览：明确提示不可用并保留原件入口；不得显示纯文本假装原件。
- 提取文本：长中文、长标识自然换行，阅读区独立滚动，不用整页裁切隐藏溢出。

## 4. 使用和检查

1. 将对应技能草案实例化为当前任务产物，补充资料身份、布局和状态决定。
2. 直接导入目录中的组件，并使用运行时源码；不拷贝组件源码到技能模板。
3. 检查相关版本、主题、禁用原因、键盘焦点、唯一主 CTA 与长文本。
4. 运行类型检查、构建、知识领域组件测试和 `knowledge-processing-pilot.spec.ts`。
5. 单独记录 mock-browser、真实 PG、真实原件对照和人工复核证据，缺层不能混报通过。

构造模板生成草案不是已实现，组件目录存在不是已发布，截图存在不是 UX 已通过。

## 5. 原页阅读器增量选型

实际截图证实原生 iframe 在窄栏裁切，单加 `#view=FitH` 无效。`PdfPageViewer.tsx` 现用 PDF.js 真实页坐标与 viewport 按容器/DPI渲染，提供页码与缩放；不按提取文本坐标拼版，不重写转换服务。

固定依赖 `pdfjs-dist@5.4.149`，gitHead `9e2e9e20968051a267683ba8a6f71d6a64e5aee7`，许可证 Apache-2.0。来源：[Mozilla PDF.js](https://github.com/mozilla/pdf.js)、[官方 viewport 示例](https://mozilla.github.io/pdf.js/examples/)、[固定 npm 元数据](https://registry.npmjs.org/pdfjs-dist/5.4.149)。只新增已证明缺失的阅读器依赖，既有 AntD 不升级；worker 本地打包、不依赖外部 CDN。来源与许可随依赖包保留。

Canvas 不是可访问文本层；可选择、检索的原文使用明确的“提取文本”模式。本轮不声称 PDF 注释、屏幕阅读器或所有页面均已验收。
