# 知识库 IA v2 实施计划（P1 骨架：管理端 `/admin/knowledge` ＋ 员工端 `/kb`）

> 日期：2026-10-02
> 依据：[设计稿 v2](../specs/2026-10-02-knowledge-ia-v2-design.md)（用户已确认：中/右栏采纳、左栏保持现状、审批方案 B、员工端补反馈/隐藏）
> 范围（P1）：两端新结构（顶栏＋检索＋快捷视图＋列表＋同页详情）＋真实数据只读＋两条入口就位（未接后端处显式标注）。新主页替换 `/admin/knowledge` 默认视图；旧子路由（目录/库/条目/入库/引用）**过渡保留**（slim 导航）。
> 不在 P1：新建/修订/提交审批的写入（P2）、审批系统泛化与接入（P3）、员工端增强批次（P4）、旧路由退役与重定向（其能力逐项折叠后再做）。
> 验收门：`npx tsc --noEmit`＋`npm run build` 通过；e2e 隔离串行（admin-knowledge 更新版＋新增 knowledge-v2 规格＋knowledge-usage 调整版＋knowledge-documents/knowledge-question-template 回归）通过；两端 6 档视口截图（浅/深）归档 `artifacts/knowledge-ia-v2/p1/`。

## 全局约束

- **视觉**：只用 `frontend/src/styles.css` token（`--bg`/`--bg-elevated`/`--border`/`--accent`/`--primary`/`--text-muted`/`--control-*`/`--radius-*`/`--left-width`/`--cat-library`/`--ds-font-*`/`--spacing-*`）；不新增依赖、不引字体/CDN；弹窗宽度用 `--dialog-w-form`。
- **文案（定稿）**：状态＝草稿/待审批/已发布/已停用；未接能力标注＝「P2 接入」「P3 接入」（禁止假动作、假数据）。
- **不变量**：0–1 实底主 CTA；状态不靠颜色；弹窗打开时背景主按钮降级；断点 1100/860/480；外层不滚动、栏内滚动；粗指针 ≥44px。
- **路由**：`/admin/knowledge`＝新主页；旧 `/admin/knowledge/{catalog,bases/:id,entries/:id,ingest,bindings}` 过渡保留（slim 导航：`← 知识首页` ＋ 5 项，`data-admin-kb-tab` 值 6→5）；员工端 `/kb` 原地重构。
- **DOM 契约**：管理端新主页新增 `data-kbv-*`；员工端保留既有 `data-kb-*`（`data-kb-page='mine'`、`data-kb-search`、`data-knowledge`、`data-kb-open`、`data-kb-provenance`、`data-kb-scope`、`data-draft-knowledge`）不变。
- 每个任务一次提交，提交信息 `feat(knowledge): P1.x …`。

## 文件结构（P1）

| 文件 | 动作 | 职责 |
|---|---|---|
| `frontend/src/knowledge-page.css` | 新建 | 两端共用的新页面布局与组件样式（`kbv-` 前缀；由 `artifacts/knowledge-ia-v2/space-3.css` 翻译，全部换 token） |
| `frontend/src/pages/AdminKnowledge.tsx` | 重写 | 宿主：默认路由＝新主页；旧子路由过渡渲染（slim 导航） |
| `frontend/src/admin/knowledge/LibraryPane.tsx` | 新建 | 中栏：检索/快捷视图/列表/空态 |
| `frontend/src/admin/knowledge/DetailRail.tsx` | 新建 | 右栏：内容/属性与范围/版本记录＋动作区 |
| `frontend/src/admin/knowledge/CategoryDialog.tsx` | 新建 | 分类目录弹窗（选择态真实；管理态说明） |
| `frontend/src/admin/knowledge/UploadDialog.tsx` | 新建 | 上传弹窗壳（格式/目标库/队列；提交禁用标注） |
| `frontend/src/admin/knowledge/PhaseNotice.tsx` | 新建 | 「P2/P3 接入」阶段说明弹窗（含旧版过渡链接） |
| `frontend/src/pages/Knowledge.tsx` | 重写 | 员工端新结构（保留既有逻辑与 DOM 契约） |
| `frontend/e2e/admin-knowledge.spec.ts` | 修改 | review 断言迁出；tab 数 6→5＋首页链接 |
| `frontend/e2e/knowledge-v2-home.spec.ts` | 新建 | 两端主链路契约 |
| `frontend/e2e/knowledge-usage.spec.ts` | 修改 | 筛选控件按新设计；抽屉→右栏 |
| `frontend/scripts/kb-v2-screens.mjs` | 新建 | 截图脚本（e2e-server＋chromium；双端×6 视口×浅深） |

旧视图文件（`ReviewView/CatalogView/BaseView/EntryView/IngestView/BindingsView/UnstructuredBasePanel/StructuredFields/knowledge-admin.css`）P1 一律**保留不动**（过渡路由继续使用；折叠迁移在 P2/P3 完成后删除）。

---

## 任务

### P1.1 样式基建与壳层适配

**Files**：新建 `frontend/src/knowledge-page.css`；只读核对 `frontend/src/styles.css`（`.admin-shell`/`.admin-body`/`.workbench` 高度与滚动）、`frontend/src/admin/knowledge/knowledge-admin.css`、`artifacts/knowledge-ia-v2/space-3.css`。

**Produces**：`.kbv`（页根，填充壳内高度）｜`.kbv-top`（顶栏）｜`.kbv-workspace`（grid：list 弹性＋rail `clamp(360px,54%,820px)`）｜`.kbv-list`/`.kbv-rail`（各自内部滚动）｜`.kbv-record` 双行列表行（选中左缘强调线）｜`.kbv-dialog` 弹窗基础｜断点：≤1100 上下堆叠＋列表折叠 6 条、≤860、≤480。

**Steps**
- [x] 读壳层样式，确定页面全高填充方式（不改壳：页面内用 `height:100%`/`min-height:0` 结构适配）。
- [x] 写 `knowledge-page.css`（从 `space-3.css` 逐条翻译：选择器语义保留，数值全部替换为 styles.css 既有 token；不引入外部字体/图标）。
- [x] 运行 `cd frontend && npx tsc --noEmit`（文件尚未被引用，应通过）。
- [x] 提交：`feat(knowledge): P1.1 新页面样式基建（kbv-）`。

### P1.2 管理端宿主重写（主页骨架＋过渡路由）

**Files**：重写 `frontend/src/pages/AdminKnowledge.tsx`。

**Consumes**：`parseKnowledgePath`（保留语义）；旧六视图组件（原样引用）。

**Produces**：
- 主页：`<section className="kb admin-govern" data-admin-knowledge data-admin-kb-v2="home">`＝顶栏（`data-kbv-top`：标题「知识管理」＋`data-kbv-category` 分类目录＋`data-kbv-upload` 上传文件＋`data-kbv-new` 新建知识）＋空工作区占位（`.kbv-workspace`，P1.3/P1.6 填充）。
- 过渡宿主：pathname 为 `catalog/bases/entries/ingest/bindings` 时渲染 slim 导航（`data-admin-kb-home-link` ← 知识首页 ＋ `data-admin-kb-tab` 5 项）＋原视图组件；`review` 段重定向到主页。

**Steps**
- [x] 重写宿主（旧逻辑保留：notice/error 回执条、`CatalogHint`）。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.2 管理端宿主重写与旧路由过渡`。

### P1.3 中栏 LibraryPane（真实数据、视图、检索）

**Files**：新建 `frontend/src/admin/knowledge/LibraryPane.tsx`；宿主接入数据装载。

**Consumes**：`api.adminKnowledge()`、`api.adminKnowledgeBases()`、`api.adminKnowledgeDomains()`、`api.adminKnowledgeDocuments({status:"pending_review"})`（仅取待审资料数）；`knowledgeCopy` 的 `statusLabel/kindLabel`；`shared.ts` 的 `useKbData/KbFeed/KbAssetRow`。

**Produces**：props `{ rows, bases, domains, view, onView, query, onQuery, category, onPick, type, onType, sort, onSort, selectedId, onSelect, expanded, onExpand, pendingDocsCount }`；DOM：`data-kbv-search|type|reset|view|count|sort|record|more|empty`。

**行为**：视图＝全部/待审批/已发布/草稿/已停用＋真实计数；搜索＝标题/主题/维护人（客户端）；类型＝kind 下拉；分类＝领域/主题（来自 bases/domains join，无值显示「未分类」）；排序＝最近更新/标题；行两行（图标＋标题＋路径·类型＋状态/维护人）；≤1100 折叠 6 条＋「展开全部」；空态三分（无数据/无匹配）；待审批视图顶部一行「待审资料 N 份 → 旧版入库处理（迁移中）」链接（N>0 才出现）。

**Steps**
- [x] 实现 LibraryPane＋宿主装载（`useKbData` 并行取数）。
- [x] 顺带统一知识域状态文案：「已归档」→「已停用」（`knowledgeCopy.ts` 与知识视图内硬编码处；不动 `AccountSettings` 等其它域同名词）；相关 e2e 断言在 P1.8 同批更新。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.3 中栏列表（真实数据）＋状态文案统一`。

### P1.4 分类目录弹窗

**Files**：新建 `frontend/src/admin/knowledge/CategoryDialog.tsx`；宿主接线 `data-kbv-category`。

**Consumes**：domains/bases 与各层计数（由 rows join 计算）。

**Produces**：`data-kbv-category-dialog|search|node|all`；选择态：族→领域→主题树行＋搜索＋计数，选中即过滤列表并关窗；管理态说明（「新建/改名/合并需校验引用，保留历史标识」）＋「旧版目录管理（迁移中）→ `/admin/knowledge/catalog`」。

**Steps**
- [x] 实现弹窗（原生 `<dialog>`，焦点归还）。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.4 分类目录弹窗`。

### P1.5 上传弹窗＋「新建知识」阶段说明

**Files**：新建 `frontend/src/admin/knowledge/UploadDialog.tsx`、`PhaseNotice.tsx`；宿主接线。

**Produces**：上传弹窗 `data-kbv-upload-dialog|drop|pick|queue|target-base|submit`；PhaseNotice `data-kbv-phase-notice`（参数：标题/说明/过渡链接）。

**行为**
- 上传弹窗：批量选择＋拖入；格式白名单＝文档（pdf/doc/docx/xls/xlsx/csv/ppt/pptx/txt/md/html）＋图片（png/jpg/jpeg/webp）＋**音视频（mp3/m4a/wav/mp4/mov/webm）**，文案标注「音视频将先转写；扫描件将先 OCR」；队列行（名称/类型/大小/「待上传」/移除）；目标库选择（bases）；「创建文件草稿」禁用并注明「P2 接入：上传与提取管线」＋「旧版入库（迁移中）→ `/admin/knowledge/ingest`」。
- 新建知识 → PhaseNotice：「P2 接入：新建与修订」＋「旧版新建（迁移中）→ `/admin/knowledge/catalog`（进库后新建条目）」。

**Steps**
- [x] 实现两组件＋接线。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.5 上传弹窗与阶段说明`。

### P1.6 详情 rail

**Files**：新建 `frontend/src/admin/knowledge/DetailRail.tsx`；宿主接线（`data-kbv-detail`）。

**Consumes**：`KbAssetRow`；`KNOWLEDGE_KIND_SPECS`（`shared.ts`）；审批与回执：`EntryView.tsx:166-170` 现有调用点（`api.approveKnowledge`）＋`knowledgePublishConfirm`；`api.adminKnowledgeArchive`＋`knowledgeArchiveConfirm`；`api.adminKnowledgeDelete`＋`knowledgeHardDeleteConfirm`；`api.adminKnowledgeAssets`（版本记录）；`useAdminConfirm`。

**Produces**：`data-kbv-detail`、`data-kbv-detail-tab="content|props|versions"`、`data-kbv-status`、`data-kbv-approval-hint`、动作 `data-kbv-action="approve|goto-approval|edit|submit|scope|archive|delete|versions"`。

**行为（0–1 实底按状态）**
- 头部：crumb→标题→状态＋版本＋维护人·更新。
- 内容：待审批提示条「此版本正在审批中 · 前往审批 →」（`data-kbv-approval-hint`）；正文/结构化字段（按 kind 规格渲染）；来源行（文件上传→文件名；在线编辑→维护人）。
- 属性与范围：知识标识/分类/适用范围/维护责任人/类型/模型·载体/来源/当前版本/审批时间（有则显示）；底部「完整治理信息（迁移中）→ 旧版条目视图 `/admin/knowledge/entries/:id`」。
- 版本记录：当前版本＋`adminKnowledgeAssets` 可得历史；无数据时空态（不虚构）。
- 动作：
  - 待审批：**[审核]**（实底，`knowledgePublishConfirm`＋`approveKnowledge(id, version)`＋回执刷新）｜[前往审批 ↗]（次；PhaseNotice「P3 接入：审批系统」）｜[修订]（PhaseNotice「P2」＋旧版链接）。
  - 草稿：**[提交审批]**（PhaseNotice「P2」）｜[修订]（同）｜[删除草稿]（实底：`adminKnowledgeDelete`＋确认＋回执）。
  - 已发布：[修订]（PhaseNotice＋旧版链接）｜[更多]＝版本记录（切 tab）／调整适用范围（PhaseNotice「P2」）／[停用]（`adminKnowledgeArchive`＋确认＋回执）。
  - 已停用：[修订]（同）｜[更多]＝版本记录。

**Steps**
- [x] 读 `EntryView.tsx` 现有审批/归档/删除调用与确认文案，迁移为新 rail 的实现（不复制第二份审批逻辑判断，直接调用既有 API/确认构造器）。
- [x] 实现 rail＋接线。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.6 详情 rail（只读＋过渡动作）`。

### P1.7 员工端重构（`/kb`）

**Files**：重写 `frontend/src/pages/Knowledge.tsx`。

**Consumes**：`api.knowledge({q})`、`api.citeKnowledge`、`api.deprecateKnowledge/undeprecateKnowledge`、`api.skillTemplates`、`readKbFavorites/toggleKbFavorite/readKbRecent/rememberKbRecent`、`HIDE_REASONS`、`kbSummary/kbScopeTags/kbVersionTag/kbVariableLine/formatKbTime/kbAuthorLabel`。

**Produces**：顶栏（「知识库」＋范围说明）＋中栏（`data-kb-search` 保持、分类弹窗、类型、视图＝全部/收藏/最近查看）＋右栏（`data-kb-provenance` 来源与版本；`data-kb-scope` chips；动作：**[用于当前任务]** 实底＋[反馈/隐藏]（三原因＋备注，`deprecateKnowledge`；已隐藏给 `undeprecateKnowledge`）＋[收藏]）。

**契约保持**：`data-kb-page='mine'`、`data-knowledge=<id>`、`data-kb-open`（行选中）、`data-kb-search`、`data-draft-knowledge` 芯片、`data-kb-tip`。行为变化（登记）：适用（阶段/品牌）筛选按新设计收敛为 领域/主题＋类型（如需保留，P4 以高级筛选补回）。

**Steps**
- [x] 重写页面（数据加载/反馈/引用逻辑从旧文件迁移，保持 API 调用不变）。
- [x] `npx tsc --noEmit` 通过。
- [x] 提交：`feat(knowledge): P1.7 员工端新结构`。

### P1.8 e2e 更新与新增

**Files**：修改 `frontend/e2e/admin-knowledge.spec.ts`、`frontend/e2e/knowledge-usage.spec.ts`；新建 `frontend/e2e/knowledge-v2-home.spec.ts`。

**行为**
- `admin-knowledge.spec.ts`：review 段断言删除（迁入新规格）；`data-admin-kb-tab` 计数 6→5＋首页链接存在；catalog/entry/ingest/bindings 断言保留（适配 slim 导航）。
- `knowledge-v2-home.spec.ts`（新增）：管理端——主页可见→切「待审批」计数>0→搜索收敛→选行→rail 三 tab 可切→待审批行出现「前往审批」并打开 P3 说明→逐视口 0-1 CTA 核查；员工端——`/kb` 视图 全部/收藏/最近 可切→搜索→选行→rail `data-kb-provenance` 可见→反馈入口可见。
- `knowledge-usage.spec.ts`：筛选用例改用新控件（分类弹窗/类型）；抽屉断言改 rail（`data-kb-provenance` 保持）。
- 回归：`knowledge-documents.spec.ts`、`knowledge-question-template-flow.spec.ts`。

**命令**：`cd frontend && E2E_PORT=8899 npx playwright test e2e/admin-knowledge.spec.ts e2e/knowledge-v2-home.spec.ts e2e/knowledge-usage.spec.ts e2e/knowledge-documents.spec.ts e2e/knowledge-question-template-flow.spec.ts --workers=1 --retries=1`

**Steps**
- [x] 改/写三个规格；跑上述命令至全绿（或列出与本次无关的既有失败并留证）。
- [x] 提交：`feat(knowledge): P1.8 e2e 更新（v2 主页契约）`。

### P1.9 截图、门禁与报告

**Files**：新建 `frontend/scripts/kb-v2-screens.mjs`；产出 `artifacts/knowledge-ia-v2/p1/`。

**行为**：脚本 spawn `node ../scripts/e2e-server.mjs`（`E2E_PORT=8898`，stub/auth disabled），chromium 打开 `/admin/knowledge` 与 `/kb`：视口 1440×900、1280×600、1100×800、860×700、390×844，各浅/深（`colorScheme`）截图；含：列表默认、待审批视图、rail 三 tab、分类弹窗、上传弹窗、P3 说明弹窗、员工端 rail。

**门禁**：`npx tsc --noEmit`；`npm run build`；P1.8 e2e 全绿；截图为证；把 P1 变更与「已知标注（P2/P3 项、适用筛选收敛）」写回本文件执行记录。

**Steps**
- [x] 写脚本并跑出截图；核对无横向溢出、0–1 CTA、状态非纯色。
- [x] `npm run build` 通过；提交：`feat(knowledge): P1.9 截图与门禁证据`。

---

## 执行记录

| 日期 | 事项 | 命令 / 证据 | 结果 |
|---|---|---|---|
| 2026-10-02 | 计划落档 | 本文件（db591ec） | 完成 |
| 2026-10-02 | P1.1-P1.4 管理端主页 | efaf3d9/332ca72/b8ac3d1：styles 壳层挂点＋`knowledge-page.css`；宿主重写（旧子路由 slim 导航过渡）；中栏列表（真实数据/5 视图/分类弹窗/类型/排序/折叠/空态）；阶段说明弹窗；探针 45 条、0 溢出 | 完成 |
| 2026-10-02 | P1.5-P1.6 上传＋详情 rail | 608b9c7：UploadDialog（含音视频格式/目标库/队列；提交禁用标注 P2）；DetailRail（内容/属性与范围/版本三 tab；审核过渡入口＝既有确认+409+回执；前往审批 P3 标注；停用/删除草稿真实动作；0-1 CTA 让位） | 完成 |
| 2026-10-02 | P1.7 员工端 | 4916aa2：`/kb` 重构（顶栏/检索/族域库＋阶段品牌筛选/快捷视图 全部·收藏·最近/技能模板/双行列表/右栏同页详情）；保留 反馈三原因·隐藏·用于当前任务·引用链路与 `data-kb-*` 契约 | 完成 |
| 2026-10-02 | P1.8 e2e | 7f4b3b8：知识套件 **20 过＋1 按计划跳过**（反馈处置 UI 随旧待处置视图退役、P2 接回）；workbench 知识用例 **3 过**；新增 `knowledge-v2-home`；documents 发布路径改走旧版入库视图 | 完成；1 项既有基线：`workbench:3078`（侧栏技能项计数，09-29 侧栏改版遗留；未触碰 `Workbench.tsx`，失败先于知识页、纯 DOM 计数与本次无关） |
| 2026-10-02 | P1.9 截图与门禁 | `kb-v2-screens.mjs`：双端×5 视口×浅深＋4 弹窗＝**18 张**（`artifacts/knowledge-ia-v2/p1/`）；6 视口全部 **0 横向溢出、恰好 1 实底主 CTA、0 报错**；`tsc --noEmit`＋`npm run build` 通过 | **待视觉过审** |
| 2026-10-02 | 偏差与后置登记 | ① 员工端分类保留行式下拉（族/域/库）＋阶段/品牌筛选，不换弹窗；类型筛选评估后置；② 管理端 `?view=&focus=` 深链参数未实现（P2）；③ 「反馈处置」的家、新建/修订/上传/审批接线＝P2/P3；④ 旧子路由退役时点＝能力折叠完成后 | 已登记 |
| 2026-10-02 | P1.9 视觉整改（用户复核：留白＋工程话术） | ① 右栏操作区随内容收口（不再钉屏幕底）；②「展开全部结果」居中收口（不再通栏）；③ ≤480 隐藏行内 chips 与顶栏备注、行高恢复；④ 工程话术清零：未接线动作改**真实路径**（新建→目录、修订/调整范围→条目详情、前往审批→`/approvals`）或**灰置说明**（上传服务暂不可用），删除 PhaseNotice 组件；⑤ e2e 增加「页面无工程话术」断言；截图集重出（17 张，6 视口 0 溢出 / 1 实底 CTA / 0 报错） | 完成 |
