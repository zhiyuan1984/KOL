# 非结构化层 P1 实施计划（PageIndex 本地 ＋ 多模态规整层）

> 日期：2026-10-02
> 依据：[详细设计](../specs/2026-10-02-knowledge-unstructured-pageindex-design.md)（用户已确认四项决策：直接给答案 / 发布即可见＋品牌范围 / 音视频全文转写稿＋摘要 / P1 仅管理端）
> 范围（P1）：管线骨架（2 表＋状态机＋侧车契约）＋ PDF 两条路（文本型直通、扫描件走多模态）＋ 索引（PageIndex 本地）＋ 待审/发布/归档/删除 ＋ 管理端进度/重试/取消 ＋ 管理端试算（直接给答案＋页级引用）。**仅管理端**。
> 明确不在 P1：音视频与 PPTX/图片（P2；P1 上传先只收 PDF，其余格式返回明确未实现说明）；Worker/Agent 通道、员工面、文档级 grants（P3）；真机质量评测（试点清单见设计 §12.3）。
> 验收门：后端 `npm run typecheck` 通过；`node scripts/test.mjs tests/knowledge-documents.test.ts` 全绿；前端 `tsc --noEmit`＋`vite build` 通过；Playwright `e2e/knowledge-documents.spec.ts`（stub 全链路）＋知识三规格回归通过。

## P1.1 数据层

- [x] `backend/src/db.ts` initSchema 增 `knowledge_documents`、`knowledge_document_jobs`＋索引（随打开即建，幂等）。
- [x] `backend/migrations/021_knowledge_documents.sql` 留档（与 initSchema 同构）。
- [x] 单测（并入 P1.6）：新表存在、默认值、状态约束走代码校验。

## P1.2 桥接器（Node ↔ Python 侧车）

- [x] `backend/src/knowledge-bridge.ts`：`runBridge()`——spawn、stdout JSON、超时杀进程、错误码映射（设计 §7.4）；`KNOWLEDGE_ENGINE_MODE=stub` 时用夹具替身（ping/index/ask/make-pdf，全部在 Node 内假实现，不依赖 Python）。
- [x] `backend/tools/pageindex-bridge/`：`bridge.py`（ping/index/ask/make-pdf 四命令）、`requirements.txt`（pin `pageindex` 与 `reportlab`）、`README.md`（与 Node 契约的对应关系）。
- [x] `scripts/e2e-server.mjs`：e2e 注入 `KNOWLEDGE_ENGINE_MODE=stub`（stub gate 不依赖 Python）。

## P1.3 Host 模块（`backend/src/host/knowledge-documents.ts`）

- [x] `uploadDocument`：校验库（非结构化＋active）与格式（P1 仅 pdf）、落盘 `source.pdf`、建行（uploaded）、入队 normalize。
- [x] 作业执行器（模块级单并发队列）：`normalize`（文本型直通 / 扫描件走媒体模型 → `make-pdf` 归正）→ `index`（侧车 index）；真实进度（页/阶段）写入 jobs；失败保原文；超时；取消杀进程。
- [x] `retry / cancel / reprocess / publish（L3 guard）/ archive / delete（仅未发布，级联清理文件与索引）`。
- [x] `searchDocuments`：`ask`（答案＋页级引用）；未发布默认不参与；`include_pending` 仅单文档；引擎不可用 503。
- [x] `indexHealth`：侧车 `ping`；不可用时返回原因（页面灰置上传）。
- [x] 审计事件：`knowledge.document.upload|normalize|index|retry|cancel|publish|archive|delete|search`。
- [x] 启动对账：`running` 作业 → `failed(interrupted)`（挂到 app 启动）。
- [x] 成本：桥返回 usage 时记 `cost_events`（`source=knowledge_normalize|knowledge_search`）。

## P1.4 路由（`backend/src/routers/knowledge.ts`）

- [x] 10 端点（设计 §10）：上传（multipart）/列表/详情/重试/取消/重新加工/发布/归档/删除/试算/健康。上传与试算注册在 `:id` 泛路由之前。

## P1.5 前端（管理端）

- [x] `frontend/src/api.ts`：`KnowledgeDocument`/`KnowledgeDocumentJob` 类型与 10 方法。
- [x] `IngestView` 升级：上传表单（库选择＋文件）、资料列表（状态/真实进度/重试/取消/删除）、引擎健康提示。
- [x] `BaseView`：`kind='unstructured'` 分支 → 资料列表＋试算面板（答案＋引用）；结构化分支不动。
- [x] `ReviewView`：待审资料区块（发布/重新加工/删除）。
- [x] `knowledgeCopy.ts` 文案；样式仅用既有 token（`var(--…)`）；DOM 契约 `data-admin-kb-doc*` / `data-admin-kb-trial*`。
- [x] 不变量：每视口 0–1 实底 CTA；状态不只颜色；L3 确认＋回执；不可用即灰置说明。

## P1.6 测试与门禁

- [x] `backend/tests/knowledge-documents.test.ts`：上传校验、状态机全链路（stub：uploaded→…→pending_review→published）、失败重试、取消、删除仅未发布、试算（答案＋引用＋未发布不可见）、健康、审计事件。
- [x] `frontend/e2e/knowledge-documents.spec.ts`（stub）：上传 fixture PDF → 列表出现 → 进度完成 → 待审 → 发布（L3 回执）→ 试算显示答案与引用。
- [x] 回归：知识三规格 e2e；`typecheck`/`build`。
- [x] 数据字典补两表（落地后，按实际 schema）。
- [x] 登记表 KNOWLEDGE-02 证据回填。

## 执行记录

| 日期 | 事项 | 命令 / 证据 | 结果 |
|---|---|---|---|
| 2026-10-02 | 落档 | ADR-2026-10-01（三）修订、旧 spec 指针、KNOWLEDGE-02 登记、本计划 | 完成 |
| 2026-10-02 | 后端实现 | `db.ts`（2 表＋索引）＋`migrations/021_knowledge_documents.sql`；`src/host/knowledge-documents.ts`（上传/单并发作业状态机/发布/删除/试算/健康/启动对账）；`src/knowledge-bridge.ts`＋`tools/pageindex-bridge/`（桥与契约、stub 夹具）；`routers/knowledge.ts`（11 端点＋原文件流）；`app.ts` 对账；`scripts/e2e-server.mjs` stub 注入 | 完成 |
| 2026-10-02 | 后端测试 | `node scripts/test.mjs tests/knowledge-documents.test.ts`；八文件知识套件（documents＋taxonomy＋bases＋governance＋wikiskill＋question-templates＋mail-compose-prepare＋exam-governance） | 8/8；77/77 通过 |
| 2026-10-02 | 前端实现 | `api.ts`（类型＋9 方法）、`IngestView` 升级（上传/资料/进度/重试/取消/删除/详情）、`UnstructuredBasePanel`（资料清单＋试算）、`BaseView`（非结构化分支）、`ReviewView`（待审资料）、`CatalogView` 文案、`knowledgeCopy`／`adminConfirm`／`knowledge-admin.css` | 完成 |
| 2026-10-02 | 前端门禁 | `npx tsc --noEmit`；`npm run build`（tsc＋vite） | 通过 |
| 2026-10-02 | e2e（stub） | `knowledge-documents.spec.ts`：上传→（真实进度）待审→发布（L3 回执）→库详情试算（答案＋页级引用）→归档收尾 | 1/1 通过 |
| 2026-10-02 | e2e 回归 | 五规格（documents／usage／question-template／admin-knowledge／mail）隔离串行（`E2E_PORT=8899 --workers=1`） | 17/17 通过 |
| 2026-10-02 | e2e 并行观察 | 默认并行（3 workers）批次出现共享 data-e2e 交互干扰（col_xiaomei 池/邮件类用例；失败集逐次变化，隔离串行即全绿，属既有基建问题）；另修正一条自 `9c32e1c` 起的错误断言（归档 score 不影响 risk 槽位，经活体探针证实） | 已记录；规格修正 |
| 2026-10-02 | 数据字典 | `knowledge_documents`／`knowledge_document_jobs` 两节（分组 10：103→105 表） | 完成 |
| 2026-10-02 | 登记表 | KNOWLEDGE-02 evidence 回填 | 完成 |
| 2026-10-02 | 真机试点 | Python 侧车安装、中文 PDF/扫描件/音视频质量与成本 | **未做**（下一批次；见设计 §12.3） |
| 2026-10-02 | 视觉整改（用户反馈「视觉是最差一环」后） | 通读 `docs/DESIGN.md`＋逐页 1280×720 截图取证；修复：标题按钮原生 chrome 复位、受控文件选择器（不露原生控件）、资料表列收敛（7→5）＋状态 chip（含失败/已发布语义）、非结构化库头计数与「条目/资料」措辞按 kind 分支、文案去重（host lead / P1 注释 / 空态）、试算结果改内容块（答案＋引用标签＋用量）＋问题输入舒展；证据：终版 build＋`knowledge-documents`/`admin-knowledge` e2e 7/7、四页验收截图 | 完成 |
| 2026-10-02 | 模块级视觉 v2（用户复核「管理端纹丝未动」后） | 作用域 `.admin-kb`（不动其它管理面板）：子导航由盒状改**链接式下划线 tab**；标题升一档、导语/计数降辅助级；面板圆角内边距与行距收紧；行内动作链接降噪（悬停恢复）；页头 CTA 不换行；**键值网格防溢出压列**（条目详情实测修复）；目录非结构化库去「0 条条目」；证据：六视图 1280×720 截图＋`knowledge-documents`/`admin-knowledge` 复跑 7/7＋`tsc` 通过 | 完成 |
