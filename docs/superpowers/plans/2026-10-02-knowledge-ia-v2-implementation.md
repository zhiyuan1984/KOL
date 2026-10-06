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
| 2026-10-02 | 术语统一＋三级 tab＋标签筛选（用户五点确认：品牌多选／带计数／弹窗退役／旧版痕迹清零／说明省略） | 共享组件 `ScopeTabs`（业务域→业务主题→知识库，三级联动 tab，带计数）＋`FilterChips`（品牌多选/阶段单选，值全部露出）；双端下拉全部替换；分类弹窗删除；子视图仅保留「← 返回知识管理」回链（旧版导航与文案清零）；管理端行式单行化（>700px：标题/分类同行、状态与维护人右侧单行）；右栏左内边距；e2e（workbench/usage/v2-home/admin-knowledge）与截图同批适配 | 完成 |
| 2026-10-02 | 员工端同款单行化＋阶段中文标签（用户复核：管理端阶段改中文标签；员工端单行省阶段、值为中文、品牌只留值） | bedc75a：双端行式统一（>700px 单行：标题/类型/chips 一列，右端时间·版本；标题与类型不参与收缩）；行内省阶段 chip（右栏保留）、品牌只留值（LT/RO/通用）；阶段值中文标签（双端筛选 chips＋员工右栏＋管理端条目详情；过滤仍按代码）；阶段筛选按 SOP 自然序；e2e 知识套件 **16 过＋1 跳过**、workbench 知识 **3 过**（`workbench:3078` 既有基线不变）；截图 16 张刷新 | 完成 |
| 2026-10-02 | 复核两处对齐（用户：单行图标与文字未居中；中栏左留白大于右） | 行 `align-items:center`（探针：图标-文字中线差 5px→1px，双端）；`>1100px` 管理端列表右补 `--page-gutter` 外檐，与 admin-body 左侧对称（探针 30.7/30.7，行不再顶到右栏分隔线）；e2e 同套件 16 过＋1 跳过、workbench 3 过；截图 16 张刷新 | 完成 |
| 2026-10-02 | 上传弹窗改版＋阶段标签行统一（用户：头部留白多；去「统一归档到知识库」与「上传服务暂不可用」；归档改 3 行三级 tab；阶段标签可＋可×、无「全部」） | 弹窗：头部间距收紧（标题-描述 33.5→12.5px）；归档目标换 `ScopeTabs`（业务域→业务主题→知识库，`showCount=false`，三级联动）；提交仍禁用但去掉灰置说明；新增共享 `StageTags`（芯片＋增加、×移除，select 选项即阶段列表）同时用于双端筛选行与弹窗；双端筛选由单选改多选（命中任一阶段即显示）；e2e 断言改精确芯片定位（select 选项文本不计入）、知识套件 **16 过＋1 跳过**、workbench 3 过；截图 16 张刷新 | 完成 |
| 2026-10-03 | 管理端中栏 v4 落地（用户交付 kb-midcol 原型：七组统一「标签＋计数」chips、每组「全部」、零计数收起、阶段 >8 先折叠、去品牌/阶段 ×/＋、细线分组、中栏 320px、列表行加日期、新建知识弹窗真写草稿） | `KnowledgeFilters`/`KnowledgeHome` 重写（计数口径＝点选该 chip 后的实际结果数；taxonomy 沿族→域→库收窄）＋新 `CreateKnowledgeDialog`（POST /admin/knowledge 落草稿；无结构化库禁用并说明；弹窗内「去知识目录」承接目录入口）＋`knowledge-page.css`（统一 `.kbv-chip`：贴合文字、不加粗、选中＝辅助色＋描边加厚）＋行「类型 · 状态 · 日期」；e2e 两 spec 更新＋新增草稿用例（API 自清理）；`tsc`/`build` 通过；知识主页套件 **12 过＋1 跳过**；截图 22 张（5 视口×浅深＋上传/新建弹窗；0 溢出 / 1 实底 CTA / 0 报错，`artifacts/knowledge-ia-v2/p2-midcol/`）；原型归档 `artifacts/knowledge-ia-v2/kb-midcol-prototype.html` | 完成 |
| 2026-10-03 | 回归（知识周边 6 套件＋workbench 知识子集） | 6 套件：**16 过＋5 flaky（重试过）＋1 跳过＋2 失败**；workbench 知识子集 3 过＋1 失败（`workbench:3078` 既有基线）。2 项失败＝`mail-confirmation-flow` 两例，已在**基线 b8cfe46（本变更 stash 后）同库复现**，属既有环境/数据基线，与本变更无关；5 flaky 同批重试通过 | 已留证 |
| 2026-10-03 | 审宪记录（CONST-08） | 需求＝中栏 v4 落地（基线 b8cfe46）；角色＝平台产品经理＋UI/UX 专家＋前端专家；宪法：CONST-04（不重写审批/权限/阶段判定——发布仍只在审批系统）✓、CONST-05（新建＝草稿 L2；删除草稿 L3 确认＋回执沿用）✓、CONST-10（上传提交不假实现，缺口登记）✓；细则：DESIGN §1（≤1 实底 CTA）、§1-4（chip 选中＝辅助色＋描边加厚，非单色）、§4（阶段 >8 折叠）、§8-2（零计数收起）、§11（命中区沿用）；结论＝符合（1 处 §4 张力按 §8-2 处置并登记） | 完成 |
| 2026-10-03 | 与原型/后端的偏差登记 | ① 上传弹窗提交维持禁用（后端无「多格式→草稿条目」通道：raw 通道不支持 base/阶段且产 `pending_review`；documents 通道仅 PDF 产资料）＝P2；② 「修订」保持跳条目编辑页（不做原型简化小弹窗，不降级结构化编辑器）；③ 品牌/阶段保持多选（原型 mock 单选属示意）；④ 新建弹窗内品牌单选（后端 `brand` 单值）、阶段多选；⑤ 「新建」改弹窗后目录入口由弹窗内「去知识目录」承接 | 已登记 |
| 2026-10-06 | 视觉整改（用户：线上那套视觉不达标，需要整改；基线 `3b05f178`） | ① **DESIGN §9.2 增两条**：同一对象的生命周期状态用**分布条**（分段＋计数＋点击），不得拆成并列 KPI 卡；下钻优先落带筛选条件的明细表，确无筛选轴才定位页内队列并登记缺口（§6.2 同步补「同维度状态不适用 KPI 卡」）。② 驾驶舱由 6 张等价卡（`repeat(6,1fr)`，每张仅 118px 宽、说明被截断）改为 **4 段状态分布条**（草稿/待审批/已发布/已停用，口径 `kbStatusCounts`，段宽按计数成比例）＋ **4 行待处置队列**（待审资料/30 天内到期/员工反馈/隔离提案）；有筛选轴的下钻写成链接 `?view=` / `?view=pending&asset=document` / `?expiring=1`（L4 链接语义：可复制、可后退），没有筛选轴的（反馈、提案）在页内展开自身列表。③ 实测基线（1440×900，stub）：员工端列表行高 **63px**、一屏仅 **4** 整行；管理端列表行高 **92px**；`--bg-subtle`/`--surface`/`--text-quiet`/`--table-row-h`/`--table-header-h`/`--stat-*`/`--dialog-h-max` **全部未定义**（行 hover 背景计算值为透明、sticky 表头无底色带）；`--chip-h` 为 26px 而非 §4.1 的 28px。④ 顺带：状态色补文字档（13px 正文用 `--warning` 对比度不足）、关键说明不再只靠 hover、行内重复动作降为 L3 文字按钮。 | 进行中 |
| 2026-10-06 | 缺口登记（DESIGN §9.2「确无筛选轴时登记」） | 「员工反馈待处置」与「隔离提案」两行仍是页内展开：工作区行的数据源是知识条目/资料（`workspace-v1`），不含反馈与提案，因此没有可下钻的筛选轴；等这两类进入统一工作区行模型后再改为筛选下钻。 | 已登记 |
| 2026-10-06 | 视觉整改第二批（动作分级 / 弹窗档位 / 文案与机器串 / 表单与命中区） | ① §4.2 动作分级：`.kbadmin-action-link` 去常驻下划线、hover 出淡底与下划线，危险态走 `--danger-text`；`EntryView` 的「归档 / 彻底删除 / 复制到 X」由一排描边按钮改为 1 个 L2（归档）+ 其余 L3 文字按钮。② §7.1 弹窗档位：`.kbv-dialog` 由一刀切 `--dialog-w-form`(560px) 改为按内容 `data-size` 选 sm/md/lg（新建 md、上传 lg、维护 sm），padding 走 `--dialog-pad-*`，删掉 `--spacing-20` 第二套间距档。③ §9.3 空态：员工端与管理端列表空态各加内联恢复动作（清筛选）。④ §1.6/§8.4 文案去重：删除右栏里重复的「打开全文，不会把资料发出去」。⑤ §15 机器串：条目/资料正文行里的内部 ID、技能 id、版本指纹、回执号、发布作业号移入「处理详情」折叠区或不打印。⑥ §19 表单：`.kbadmin-form-grid` 由 auto-fit 铺满改为最多 2 列（窄容器 1 列）。⑦ §4.1 触摸模态：去掉「所有按钮/链接/select/summary 一律 min-height 44px」的放大写法，改为对象化伪元素扩命中区（视觉控件仍按 chip/control 档绘制）。⑧ 清理：删除 `knowledgeCopy.kbScopeLine`（死代码，与 `shared.kbScopeLine` 同名两份）、`UploadDialog.formatSize` 合并到 `shared.formatBytes`、`DocumentRail` 体积与 `EntryView` 到期改用既有格式化函数。验证：tsc 无输出、build 通过、知识 5 套件 25 过 / 10 失败（失败项与基线同源，见下）。 | 完成 |
| 2026-10-06 | 两处缺口登记（本批未做，需设计责任角色裁决） | ① **§3.2 知识来源色标**：`--cat-memory/-doc/-pattern/-ontology` 四个色值在 `docs/DESIGN.md` 登记表里仍是 ⚠️（未注册数值），且仓库里没有 kind→来源 的映射；凭空造 4 个类别色与映射会改写品牌色板，故本批只清理了「图标被涂成 `--danger`」的颜色职责串用，来源色标待数值注册后落地。② **§8.7 静默裁切**：员工端单行行式的既有策略是「标题与类型保持完整、空间不够由适用 chips 让位」（1280 宽 + 右栏 54% 时 chips 会被压成 0 宽）。这与 §8.7「禁止静默裁切」直接冲突；本批实测两种候选（chips 换行 / 保护 chips 标题截断）都会把行高从 44px 抬到 67px，属密度与不变量的取舍，需设计责任角色裁决后再改。 | 已登记 |
