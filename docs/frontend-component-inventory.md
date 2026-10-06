# 前端组件清单（组件 · 作用 · 对应接口）

> 基线：工作区当前内容，提交 `2af2f79b`；扫描当刻另有 83 个路径存在未提交改动（其后工作区会继续变化），本清单描述的是扫描当刻磁盘上的代码。
> 生成日期：2026-10-01。扫描方法：`git ls-files` 冻结文件清单 → 逐文件整篇通读 → `api.*` 调用点与 `frontend/src/api.ts` 方法表逐字比对。
> 原始证据：`../artifacts/component-inventory/`（`manifest.json` 文件清单与哈希、`api-map.json` 接口表、`usage.json`、`helper-map.json`、`parts/*.json` 分组原始记录）。
> **本文件是实施事实清单，不属规范正文**（与 [implementation-registry.md](implementation-registry.md) 同类），不改写任何条款；只描述「存在什么、调用了什么」，不表示任何功能已完成或可用。

口径说明：

- 范围：`frontend/src` 下 git 跟踪的全部 `.tsx` 共 111 个文件；每个文件一条记录。
- 「对应接口」只记**该文件自己触发或读取**的接口；它渲染的子组件有各自的记录，不重复计入父行。
- 路径中的 `${…}` 是源码里的模板变量（如 `${encodeURIComponent(id)}`），原样保留；`?sync=1&force=1` 表示源码在条件成立时追加的可选查询串。
- 来源标注：`直连`＝文件内直接调用 `api.*` 或 `fetch`；`经 hook`＝经 `frontend/src/hooks/*`；`经包装模块`＝经其他 `.ts` 包装模块（`home/kolSurfaceApi.ts` 等）；`父传入`＝数据由父组件经 props 提供。
- 标 `（api.ts 未封装）` 的接口是组件内原生 `fetch` / `EventSource` / 下载直链，`api.ts` 无对应方法，后端确实存在。
- 备注里出现的 `.ts` 文件名均为仓库路径的相对简写；完整证据见 `../artifacts/component-inventory/parts/`。

## 0. 总览

| 指标 | 数值 |
|---|---|
| 组件文件（git 跟踪 .tsx） | 111 |
| 代码行数合计 | 31,148 行 |
| 页面级（有路由） | 33 |
| 组件 / Provider / 注册表 / 入口 | 78 |
| 组件 → 接口 记录条目 | 322 |
| 文件内有直连接口的组件 | 45 |
| 仅经 hook / 包装模块取数 | 4 |
| 纯 props 驱动、无直接接口 | 62 |
| `api.ts` 登记的接口方法 | 253（主路径去重 218） |

目录分布：

| 目录 | 文件数 |
|---|---|
| `home/` | 27 |
| `pages/` | 26 |
| `components/` | 24 |
| `admin/connector/` | 8 |
| `mail/components/` | 8 |
| `admin/knowledge/` | 6 |
| `home/workspace/` | 4 |
| `（根目录）/` | 3 |
| `composer/` | 3 |
| `admin/employees/` | 1 |
| `layout/` | 1 |

## 1. 页面与路由

路由来自 `../frontend/src/App.tsx`；管理端分节路由来自 `../frontend/src/layout/adminNav.ts` 与 `AdminConsole.tsx`。

| 路由 | 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|---|
| / | Home | [`frontend/src/pages/Home.tsx`](../frontend/src/pages/Home.tsx) | 首页五模式（今日/待办/我的红人/公海/AI发现）工作台：聚合任务记忆与红人名单，承载识别、分析、采集与发送入口。 | `GET /api/tasks?${query}`〔直连 · tasks〕<br>`GET /api/home/today-brief`〔直连 · todayBrief〕<br>`POST /api/home/today-brief/plan`〔直连 · planToday〕<br>`GET /api/home/todo-brief`〔直连 · todoBrief〕<br>`POST /api/home/todo-brief/plan`〔直连 · planTodo〕<br>`GET /api/home/board?refresh=1`〔直连 · homeBoard〕<br>`GET /api/task-definitions`〔直连 · taskDefinitions〕<br>`GET /api/knowledge/${encodeURIComponent(id)}`〔直连 · knowledgeItem〕<br>`POST /api/sessions`〔直连 · createSession〕<br>`POST /api/tasks`〔直连 · createTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/run`〔直连 · runTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/acknowledge`〔直连 · acknowledgeTask〕<br>`GET /api/tasks/${encodeURIComponent(id)}`〔直连 · task〕<br>`POST /api/collaborations/${encodeURIComponent(collaborationId)}/session`〔直连 · openKolSession〕<br>`GET /api/knowledge/question-templates`〔直连 · questionTemplates〕<br>`POST /api/tasks/adopt-recommendation`〔直连 · adoptRecommendation〕<br>`POST /api/tasks/${encodeURIComponent(id)}/dismiss`〔直连 · dismissTask〕<br>`POST /api/home/kol-analyze/enqueue`〔直连 · enqueueKolAnalyze〕<br>`POST /api/tasks/from-text`〔直连 · createTaskFromText〕<br>`POST /api/home/kol-analyze/enqueue`〔经包装模块 · kolSurfaceApi.enqueueKolAnalyze〕<br>`GET /api/home/pool`〔经包装模块 · kolSurfaceApi.loadHomePool〕<br>`POST /api/home/pool/sync`〔经包装模块 · kolSurfaceApi.syncHomePoolIndex〕<br>`POST /api/home/pool/jev-assess`〔经包装模块 · kolSurfaceApi.assessPoolWithJev〕<br>`POST /api/kols/${encodeURIComponent(kolUid)}/claim`〔经包装模块 · kolSurfaceApi.claimPoolKol〕<br>`POST /api/follows/${encodeURIComponent(followId)}/release`〔经包装模块 · kolSurfaceApi.releaseFollowedKol〕<br>`GET /api/home/following`〔经包装模块 · kolSurfaceApi.loadHomeFollowing〕<br>`GET /api/home/discovery/template`〔经包装模块 · discoveryHome.loadDiscoveryTemplate〕<br>`POST /api/home/discovery/run`〔经包装模块 · discoveryHome.runHomeDiscovery〕<br>`GET /api/home/today-tasks`〔经包装模块 · todayTasksApi.fetchTodayTasks〕（api.ts 未封装）<br>`GET /api/home/todo-tasks`〔经包装模块 · todayTasksApi.fetchTodoTasks〕（api.ts 未封装）<br>`POST /api/email-compose/prepare`〔经 hook · useMailComposeFlow.prepare〕<br>`POST /api/collaborations/${encodeURIComponent(collaborationId)}/session`〔经 hook · useFollowedWorkspace.confirmStage〕 |
| /admin | EmployeeDirectory | [`frontend/src/admin/employees/EmployeeDirectory.tsx`](../frontend/src/admin/employees/EmployeeDirectory.tsx) | 员工目录页：按组织与品牌筛选员工，支持新增或编辑资料、启停账号，并单独配置每位员工可用的工具授权。 | `GET /api/admin/organization-units`〔直连 · adminOrganizationUnits〕<br>`GET /api/admin/users/${encodeURIComponent(userId)}/context`〔直连 · adminEmployeeContext〕<br>`GET /api/admin/users/${encodeURIComponent(userId)}/tools`〔直连 · adminEmployeeTools〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕 |
| /admin、/admin/connectors、/admin/connectors/:detailId、/admin/knowledge、/admin/approvals、/admin/skills、/admin/exams、/admin/agents、/admin/data、/admin/cost、/admin/kol | AdminConsole | [`frontend/src/pages/AdminConsole.tsx`](../frontend/src/pages/AdminConsole.tsx) | 管理端外壳：按 /admin 分节渲染员工目录、连接器、技能、考试、数据与成本面板，并集中加载用户、连接器与审计数据。 | `GET /api/admin/users`〔直连 · adminUsers〕<br>`GET /api/admin/connectors`〔直连 · adminConnectors〕<br>`GET /api/admin/exams`〔直连 · adminExams〕<br>`GET /api/admin/exam-assignments`〔直连 · adminAssignments〕<br>`GET /api/admin/retention-policy`〔直连 · adminDataPolicy〕<br>`GET /api/audit`〔直连 · adminAudit〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕 |
| /admin/agents | AdminAgents | [`frontend/src/pages/AdminAgents.tsx`](../frontend/src/pages/AdminAgents.tsx) | 管理端 /admin/agents 治理面板：只读展示发布包状态、能力域可写范围与考试分配闸门，并链到考试与技能配置页。 | `GET /api/agent-manifest`〔直连 · agentManifest〕<br>`GET /api/profiles`〔直连 · profiles〕<br>`GET /api/admin/exams`〔父传入 · adminExams〕<br>`GET /api/admin/exam-assignments`〔父传入 · adminAssignments〕 |
| /admin/connectors | ConnectorHub | [`frontend/src/admin/connector/ConnectorHub.tsx`](../frontend/src/admin/connector/ConnectorHub.tsx) | 连接器枢纽：汇总受管连接器治理状态计数，提供搜索、浏览目录、新建 MCP 或 HTTP API 与查看工具清单的入口。 | `PUT （调用方传入的动态路径）`〔父传入 · onSave→adminSave〕 |
| /admin/connectors/:id | ConnectorDetail | [`frontend/src/admin/connector/ConnectorDetail.tsx`](../frontend/src/admin/connector/ConnectorDetail.tsx) | 连接器详情页：展示单个连接器的状态与用途，列出最近测试与治理记录，并可测试连接、启停与按技能定义挂载工具。 | `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/activity?limit=${limit}`〔直连 · runtimeConnectorActivity〕<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/probe`〔直连 · probeRuntimeConnector〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕<br>`GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}`〔经包装模块 · useDeclaredToolMount.mount〕<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared`〔经包装模块 · useDeclaredToolMount.mount〕 |
| /admin/exams | AdminExams | [`frontend/src/pages/AdminExams.tsx`](../frontend/src/pages/AdminExams.tsx) | 考试治理面板：从已发布知识生成并采纳候选题，发布题卷、按员工分配考试，并查看服务端判分成绩。 | `GET /api/admin/exams/${encodeURIComponent(id)}/items`〔直连 · adminExamItems〕<br>`GET /api/admin/exam-scores`〔直连 · adminExamScores〕<br>`GET /api/admin/knowledge`〔直连 · adminKnowledge〕<br>`POST /api/admin/exams`〔直连 · createExam〕<br>`POST /api/admin/exams/${encodeURIComponent(id)}/generate`〔直连 · generateExamItems〕<br>`POST /api/admin/exam-items/${encodeURIComponent(id)}/accept`〔直连 · acceptExamItem〕<br>`POST /api/admin/exams/${encodeURIComponent(id)}/items`〔直连 · addExamItem〕<br>`POST /api/admin/exams/${encodeURIComponent(id)}/publish`〔直连 · publishExam〕<br>`POST /api/admin/exams/${encodeURIComponent(id)}/assign`〔直连 · assignExam〕<br>`GET /api/admin/exams`〔父传入 · adminExams〕<br>`GET /api/admin/exam-assignments`〔父传入 · adminAssignments〕<br>`GET /api/admin/users`〔父传入 · adminUsers〕 |
| /admin/knowledge | TodoView | [`frontend/src/admin/knowledge/TodoView.tsx`](../frontend/src/admin/knowledge/TodoView.tsx) | 知识治理待办汇总：待审批与草稿清单、隔离提案的批准或否决，以及临近到期资产的提醒行。 | `GET /api/admin/knowledge/review`〔直连 · adminKnowledgeReview〕<br>`GET /api/admin/knowledge`〔直连 · adminKnowledge〕<br>`GET /api/admin/knowledge/proposals`〔直连 · adminKnowledgeProposals〕<br>`DELETE /api/admin/knowledge/${encodeURIComponent(id)}`〔直连 · deleteKnowledge〕<br>`POST /api/admin/knowledge/evolve/${encodeURIComponent(id)}/review`〔直连 · reviewKnowledgeProposal〕 |
| /admin/knowledge、/admin/knowledge/assets、/admin/knowledge/assets/:id、/admin/knowledge/ingest、/admin/knowledge/bindings、/admin/knowledge/feedback | AdminKnowledge | [`frontend/src/pages/AdminKnowledge.tsx`](../frontend/src/pages/AdminKnowledge.tsx) | 知识治理宿主：按路径解析待办、资产、资产详情、入库、绑定与反馈子视图，渲染子导航、标题口径与操作回执区。 | —（无直接接口） |
| /admin/knowledge/assets | AssetsView | [`frontend/src/admin/knowledge/AssetsView.tsx`](../frontend/src/admin/knowledge/AssetsView.tsx) | 知识资产目录：按类型、状态、品牌与关键词过滤列表，显示引用技能数，支持新建草稿与归档已发布知识。 | `GET /api/admin/knowledge/assets`〔直连 · adminKnowledgeAssets〕<br>`POST /api/admin/knowledge`〔直连 · createKnowledge〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/archive`〔直连 · archiveKnowledge〕 |
| /admin/knowledge/assets/:id | AssetDetailView | [`frontend/src/admin/knowledge/AssetDetailView.tsx`](../frontend/src/admin/knowledge/AssetDetailView.tsx) | 资产详情治理页：按状态渲染唯一主行动，提供编辑新版本、版本时间线对比与回滚、范围授权及归档删除。 | `GET /api/admin/knowledge/assets`〔直连 · adminKnowledgeAssets〕<br>`GET /api/knowledge/${encodeURIComponent(id)}/versions`〔直连 · knowledgeVersions〕<br>`GET /api/admin/knowledge/${encodeURIComponent(id)}/grants`〔直连 · adminKnowledgeGrants〕<br>`GET /api/admin/knowledge/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}`〔直连 · adminKnowledgeVersion〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/approve`〔直连 · approveKnowledge〕<br>`PUT /api/admin/knowledge/${encodeURIComponent(id)}`〔直连 · editKnowledge〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/archive`〔直连 · archiveKnowledge〕<br>`DELETE /api/admin/knowledge/${encodeURIComponent(id)}`〔直连 · deleteKnowledge〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/transfer`〔直连 · transferKnowledgeBrand〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/rollback`〔直连 · adminKnowledgeRollback〕<br>`PUT /api/admin/knowledge/${encodeURIComponent(id)}/grants`〔直连 · adminKnowledgeSetGrants〕 |
| /admin/knowledge/bindings | BindingsView | [`frontend/src/admin/knowledge/BindingsView.tsx`](../frontend/src/admin/knowledge/BindingsView.tsx) | 知识引用配置台：维护技能绑定的选择器与启停、删除绑定，并用只读解析试算列出命中与跳过原因。 | `GET /api/admin/knowledge/bindings`〔直连 · adminKnowledgeBindings〕<br>`GET /api/skills`〔直连 · skills〕<br>`POST /api/admin/knowledge/bindings`〔直连 · adminKnowledgeBindingSave〕<br>`PATCH /api/admin/knowledge/bindings/${encodeURIComponent(id)}`〔直连 · adminKnowledgeBindingSave〕<br>`POST /api/admin/knowledge/resolve-preview`〔直连 · adminKnowledgeResolvePreview〕<br>`DELETE /api/admin/knowledge/bindings/${encodeURIComponent(id)}`〔直连 · adminKnowledgeBindingDelete〕 |
| /admin/knowledge/feedback | FeedbackView | [`frontend/src/admin/knowledge/FeedbackView.tsx`](../frontend/src/admin/knowledge/FeedbackView.tsx) | 员工反馈处置台：按隐藏原因汇总计数并列出明细，选中后可转修订、归档或忽略，记录处置人与备注。 | `GET /api/admin/knowledge/feedback`〔直连 · adminKnowledgeFeedback〕<br>`POST /api/admin/knowledge/${encodeURIComponent(id)}/feedback-handle`〔直连 · adminKnowledgeFeedbackHandle〕 |
| /admin/knowledge/ingest | IngestView | [`frontend/src/admin/knowledge/IngestView.tsx`](../frontend/src/admin/knowledge/IngestView.tsx) | 素材入库台：上传原文并列出原文库，触发抽取后按服务端终态展示提取作业，失败可对同一原文重试。 | `GET /api/admin/knowledge/raw`〔直连 · adminKnowledgeRaw〕<br>`GET /api/admin/knowledge/extract-jobs`〔直连 · adminKnowledgeJobs〕<br>`POST /api/admin/knowledge/upload`〔直连 · uploadKnowledgeRaw〕<br>`POST /api/admin/knowledge/extract/${encodeURIComponent(rawId)}`〔直连 · extractKnowledge〕 |
| /admin/kol | Skills, Admin | [`frontend/src/pages/SimplePages.tsx`](../frontend/src/pages/SimplePages.tsx) | 旧版管理配置与我的技能视图：只读渲染连接器、能力域与邮箱配置快照，技能卡可新建会话并跳转到对话。 | `GET /api/skills`〔直连 · skills〕<br>`POST /api/sessions`〔直连 · createSession〕<br>`GET /api/admin`〔直连 · admin〕 |
| /admin/skills | SkillLifecycle | [`frontend/src/pages/SkillLifecycle.tsx`](../frontend/src/pages/SkillLifecycle.tsx) | 管理端技能治理页：筛选技能列表并打开详情，编辑内容与运行契约草稿，配置工具知识依赖、直接授权、测试与版本发布回滚。 | `GET /api/admin/skills`〔直连 · adminSkills〕<br>`GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}`〔直连 · runtimeSkillCoverage〕<br>`POST /api/admin/skills/${encodeURIComponent(id)}/stage`〔直连 · skillLifecycleStage〕<br>`POST /api/admin/skills/import`〔直连 · importAdminSkill〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/sop`〔直连 · adminSkillSop〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/draft`〔直连 · adminSkillDraft〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/versions`〔直连 · skillVersions〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/tests`〔直连 · skillTests〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/metrics?days=${days}`〔直连 · skillMetrics〕<br>`POST /api/admin/skills/${encodeURIComponent(id)}/versions`〔直连 · publishSkillVersion〕<br>`PUT /api/admin/skills/${encodeURIComponent(id)}/draft`〔直连 · saveAdminSkillDraft〕<br>`POST /api/admin/skills/${encodeURIComponent(id)}/versions/rollback`〔直连 · rollbackSkillVersion〕<br>`POST /api/admin/skills/${encodeURIComponent(id)}/tests`〔直连 · createSkillTest〕<br>`POST /api/admin/skills/${encodeURIComponent(id)}/tests/run`〔直连 · runSkillTests〕<br>`PUT /api/admin/skills/${encodeURIComponent(id)}/grants`〔直连 · saveSkillGrants〕<br>`PATCH /api/admin/skills/${encodeURIComponent(id)}/lifecycle`〔直连 · skillLifecycleMetaSave〕<br>`DELETE /api/admin/skills/${encodeURIComponent(id)}/tests/${encodeURIComponent(testId)}`〔直连 · deleteSkillTest〕<br>`GET /api/admin/knowledge/bindings`〔直连 · adminKnowledgeBindings〕<br>`GET /api/admin/knowledge/assets`〔直连 · adminKnowledgeAssets〕<br>`POST /api/admin/knowledge/resolve-preview`〔直连 · adminKnowledgeResolvePreview〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/template`〔直连 · adminSkillTemplate〕<br>`GET /api/experts`〔直连 · experts〕 |
| /agents、/agents/:id | Agents | [`frontend/src/pages/Agents.tsx`](../frontend/src/pages/Agents.tsx) | 数字员工页：列出岗位卡片，按岗位分流到思考会话、采集作业台或审批队列，也可按 URL 参数展示单个专家详情。 | `GET /api/approvals?box=${encodeURIComponent(box)}`〔直连 · approvals〕<br>`GET /api/experts`〔经包装模块 · fetchExperts〕<br>`GET /api/experts/${encodeURIComponent(id)}`〔经包装模块 · fetchExpert〕<br>`POST /api/experts/${encodeURIComponent(id)}/summon`〔经包装模块 · summonExpert〕<br>`POST /api/sessions`〔经包装模块 · summonExpert〕 |
| /agents/:id | AgentCrawler | [`frontend/src/pages/AgentCrawler.tsx`](../frontend/src/pages/AgentCrawler.tsx) | 采集专家作业台：提交 YouTube/Instagram 关键词或指定内容采集作业，列出作业状态与候选创作者，并逐条确认跟进。 | `GET /api/tasks?${query}`〔直连 · tasks〕<br>`GET /api/tasks/${encodeURIComponent(id)}/crawl-job`〔直连 · crawlJob〕<br>`POST /api/tasks`〔直连 · createTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/actions/start-crawl`〔直连 · startCrawl〕<br>`GET /api/discovery/requests`〔经包装模块 · listDiscoveryRequests〕<br>`POST /api/discovery/candidates/${encodeURIComponent(id)}/follow`〔经包装模块 · followCandidate〕 |
| /approvals、/approvals/:id | Approvals | [`frontend/src/pages/Approvals.tsx`](../frontend/src/pages/Approvals.tsx) | 工作审批页：按待我决定/我发起/已处理分栏列出审批链与回执，可发起费用审批并按版本与幂等键同意或驳回。 | `POST /api/approvals/preview`〔直连 · previewApproval〕<br>`POST /api/approvals`〔直连 · createApproval〕<br>`GET /api/approvals?box=${encodeURIComponent(box)}`〔直连 · approvals〕<br>`GET /api/wecom/cards`〔直连 · wecomCards〕<br>`GET /api/approvals/${encodeURIComponent(id)}`〔直连 · approval〕<br>`POST /api/approvals/${encodeURIComponent(id)}/decide`〔直连 · decide〕 |
| /cron、/cron/:jobId | Cron | [`frontend/src/pages/Cron.tsx`](../frontend/src/pages/Cron.tsx) | 定时任务页：列出计划状态、下次运行与最近运行，可暂停或立即运行，并在详情中用提问框编辑任务内容、查看回执与运行记录。 | `GET /api/cron/jobs`〔直连 · cronJobs〕<br>`GET /api/cron/jobs/${encodeURIComponent(id)}`〔直连 · cronJob〕<br>`GET /api/cron/runs/${encodeURIComponent(runId)}`〔直连 · cronRun〕<br>`PATCH /api/cron/jobs/${encodeURIComponent(id)}`〔直连 · patchCronJob〕<br>`POST /api/cron/jobs/${encodeURIComponent(id)}/run`〔直连 · runCronJob〕<br>`POST /api/cron/jobs`〔直连 · createCronJob〕 |
| /exam、/exam/:assignmentId | Exam | [`frontend/src/pages/Exam.tsx`](../frontend/src/pages/Exam.tsx) | 学习考试页：列出分配题卷与通过状态，开放题卷可逐题作答并提交，判分与合格由服务端按已发布快照计算。 | `GET /api/me`〔直连 · me〕<br>`GET /api/exams`〔直连 · examAssignments〕<br>`GET /api/exams/${encodeURIComponent(id)}/result`〔直连 · examResult〕<br>`POST /api/exams/${encodeURIComponent(id)}/start`〔直连 · startExam〕<br>`POST /api/exams/${encodeURIComponent(id)}/submit`〔直连 · submitExam〕 |
| /kb | Knowledge | [`frontend/src/pages/Knowledge.tsx`](../frontend/src/pages/Knowledge.tsx) | 知识库浏览页：按分类、阶段、品牌筛选和搜索资料，查看全文与版本来源，收藏或填入当前任务，并可对本人隐藏资料。 | `GET /api/knowledge?${qs}`〔直连 · knowledge〕<br>`GET /api/knowledge/skill-templates`〔直连 · skillTemplates〕<br>`POST /api/knowledge/${encodeURIComponent(id)}/cite`〔直连 · citeKnowledge〕<br>`DELETE /api/knowledge/${encodeURIComponent(id)}/deprecate`〔直连 · undeprecateKnowledge〕<br>`POST /api/knowledge/${encodeURIComponent(id)}/deprecate`〔直连 · deprecateKnowledge〕 |
| /mail | Mail | [`frontend/src/pages/Mail.tsx`](../frontend/src/pages/Mail.tsx) | 通讯工作台：按联系人分组列出邮箱会话与邮件，可查看原文/摘要/译稿，就地起草任务、入队红人分析并收取邮箱。 | `GET /api/mail/compose-catalog`〔直连 · mailComposeCatalog〕<br>`POST /api/mail/conversations/${encodeURIComponent(id)}/read`〔直连 · markMailConversationRead〕<br>`GET /api/mail/box?box=${encodeURIComponent(box)}`〔直连 · mailBox〕<br>`POST /api/home/kol-analyze/enqueue`〔直连 · enqueueKolAnalyze〕<br>`POST /api/tasks/from-text`〔直连 · createTaskFromText〕<br>`POST /api/tasks/${encodeURIComponent(id)}/run`〔直连 · runTask〕<br>`PUT /api/mail/conversations/${encodeURIComponent(id)}`〔直连 · updateMailConversation〕<br>`POST /api/mail/memory/generate`〔直连 · generateMailMemory〕<br>`GET /api/mail/person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}`〔直连 · mailPerson〕<br>`GET /api/mail/conversations/${encodeURIComponent(id)}`〔直连 · mailConversation〕<br>`GET /api/mail/box?box=${encodeURIComponent(box)}`〔经包装模块 · loadMailWorkspaceFast〕<br>`GET /api/mail/conversations?box=${encodeURIComponent(box)}`〔经包装模块 · loadMailWorkspaceFast〕<br>`GET /api/mail/conversations/${encodeURIComponent(id)}`〔经包装模块 · loadMailThread〕<br>`GET /api/mail/person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}`〔经包装模块 · loadMailPersonDigest〕<br>`POST /api/mail/sync`〔经包装模块 · syncMailboxMail〕<br>`GET /api/me/starry-binding`〔经包装模块 · decorateWorkspace〕 |
| /market/skills | SkillHub, HubTile, HubMark, SkillHubChrome | [`frontend/src/pages/SkillHub.tsx`](../frontend/src/pages/SkillHub.tsx) | 技能市场页：展示已授权可用的技能磁贴与常用入口，点选后新建会话把技能带入对话，未开通的置灰并提示联系管理员。 | `GET /api/skills/market`〔直连 · skillMarket〕<br>`POST /api/sessions`〔直连 · createSession〕 |
| /partners | Partners | [`frontend/src/pages/Partners.tsx`](../frontend/src/pages/Partners.tsx) | 占位说明页：声明本页既不是首页的跟进红人板也不是技能目录，只提供回首页继续跟进红人的链接。 | —（无直接接口） |
| /pipeline | Pipeline | [`frontend/src/pages/Pipeline.tsx`](../frontend/src/pages/Pipeline.tsx) | 合作资产看板：筛选全部红人并用 15 阶段位置图显示进度与旁路异常，在抽屉内查看详情、提出具体目标阶段变更。 | `GET /api/pipeline?exception=${exception}`〔直连 · pipeline〕<br>`POST /api/collaborations/${encodeURIComponent(collaborationId)}/session`〔直连 · openKolSession〕 |
| /s/:id | Chat | [`frontend/src/pages/Chat.tsx`](../frontend/src/pages/Chat.tsx) | 会话工作台页：渲染任务标题与对话流，承载提问发送、停止生成、重新执行、标记完成、达人采集进度与右侧结果工作台。 | `POST /api/sessions/${sid}/messages`〔直连 · postMessage〕<br>`GET /api/tasks/${encodeURIComponent(id)}`〔直连 · task〕<br>`GET /api/tasks/by-session/${encodeURIComponent(sessionId)}`〔直连 · taskBySession〕<br>`GET /api/tasks/${encodeURIComponent(id)}/events`〔直连 · taskEvents〕<br>`GET /api/tasks/${encodeURIComponent(id)}/crawl-job`〔直连 · crawlJob〕<br>`GET /api/tasks/${encodeURIComponent(id)}/crawl-job/events`〔直连 · crawlEvents〕<br>`POST /api/sessions/${sid}/stop`〔直连 · stopSession〕<br>`DELETE /api/sessions/${sid}/queue/${encodeURIComponent(qid)}`〔直连 · removeQueued〕<br>`POST /api/tasks/${encodeURIComponent(id)}/complete`〔直连 · completeTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/run`〔直连 · runTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/actions/start-crawl`〔直连 · startCrawl〕<br>`POST /api/tasks/${encodeURIComponent(id)}/actions/stop-crawl`〔直连 · stopCrawl〕<br>`POST /api/admin/crawl-jobs/${encodeURIComponent(jobId)}/retry-upload`〔直连 · retryCrawlUpload〕<br>`POST /api/admin/crawl-history/clear`〔直连 · clearCrawlHistory〕<br>`GET /api/sessions/${id}?sync=1&force=1`〔经 hook · useSessionMessages〕<br>`GET /api/tasks/by-session/${encodeURIComponent(sessionId)}`〔经 hook · useRunStatus〕<br>`GET /api/tasks/${encodeURIComponent(id)}/events`〔经 hook · useRunStatus〕<br>`POST /api/email-compose/prepare`〔经 hook · useMailComposeFlow.prepare〕<br>`POST /api/tasks`〔经包装模块 · bindTemplateSessionTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/run`〔经包装模块 · bindTemplateSessionTask〕 |
| /settings | AccountSettings | [`frontend/src/pages/AccountSettings.tsx`](../frontend/src/pages/AccountSettings.tsx) | 个人设置页：以标签切换资料、Starry 绑定、偏好、密码、记忆与隐私数据，执行保存、归档、导出与删除。 | `GET /api/preferences`〔直连 · preferences〕<br>`GET /api/memory`〔直连 · memories〕<br>`GET /api/me/data-summary`〔直连 · dataSummary〕<br>`GET /api/sessions?include_archived=1`〔直连 · sessions〕<br>`GET /api/privacy/cookies`〔直连 · cookiePrivacy〕<br>`PATCH /api/me`〔直连 · updateMe〕<br>`PATCH /api/preferences`〔直连 · savePreferences〕<br>`POST /api/auth/password`〔直连 · changePassword〕<br>`PATCH /api/memory/${id}`〔直连 · updateMemory〕<br>`POST /api/memory`〔直连 · createMemory〕<br>`DELETE /api/memory/${id}`〔直连 · deleteMemory〕<br>`POST /api/sessions/${id}/unarchive`〔直连 · unarchiveSession〕<br>`POST /api/sessions/${id}/archive`〔直连 · archiveSession〕<br>`DELETE /api/sessions/${id}`〔直连 · deleteSession〕 |
| /share/:token | SharedSession | [`frontend/src/pages/SharedSession.tsx`](../frontend/src/pages/SharedSession.tsx) | 只读分享页：用 URL token 拉取共享会话，渲染对话线程与邮件草稿，无编辑、发送或阶段操作入口。 | `GET /api/shared/${encodeURIComponent(token)}`〔直连 · sharedSession〕 |
| /skills | SkillCatalog | [`frontend/src/pages/SkillCatalog.tsx`](../frontend/src/pages/SkillCatalog.tsx) | 员工端技能目录：按取数口径与业务阶段筛选技能，选中后展示入口口径、执行边界与工具风险档，并把技能填入输入框。 | `GET /api/skills`〔直连 · skills〕<br>`GET /api/skills/${encodeURIComponent(id)}`〔直连 · skill〕 |
| /tasks | Tasks | [`frontend/src/pages/Tasks.tsx`](../frontend/src/pages/Tasks.tsx) | 任务中心页：按进行中/历史筛选并每 4 秒轮询任务列表，可查看执行事件详情、取消排队任务与重试失败任务。 | `GET /api/tasks?${query}`〔直连 · tasks〕<br>`GET /api/tasks/${encodeURIComponent(id)}`〔直连 · task〕<br>`GET /api/tasks/${encodeURIComponent(id)}/events`〔直连 · taskEvents〕<br>`POST /api/tasks/${encodeURIComponent(id)}/cancel`〔直连 · cancelTask〕<br>`POST /api/tasks/${encodeURIComponent(id)}/run`〔直连 · runTask〕 |
| /teams | AgentTeams | [`frontend/src/pages/AgentTeams.tsx`](../frontend/src/pages/AgentTeams.tsx) | 旧 Teams 地址的重定向页：把 /teams 直接跳转到 /agents，不再把专家团当作独立的数字员工界面。 | —（无直接接口） |
| （无路由） | Admin | [`frontend/src/pages/Admin.tsx`](../frontend/src/pages/Admin.tsx) | 管理端技能治理页：产品经理登录后新建、上架/下架、删除技能，编辑技能说明草稿，并按组织、团队、个人分配使用授权。 | `GET /api/admin`〔直连 · admin〕<br>`GET /api/admin/skills`〔直连 · adminSkills〕<br>`POST /api/login`〔直连 · login〕<br>`POST /api/logout`〔直连 · logout〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/sop`〔直连 · adminSkillSop〕<br>`GET /api/admin/skills/${encodeURIComponent(id)}/draft`〔直连 · adminSkillDraft〕<br>`PATCH /api/admin/skills/${encodeURIComponent(id)}`〔直连 · patchAdminSkill〕<br>`PUT /api/skills/${encodeURIComponent(id)}/sop`〔直连 · saveSkillSop〕<br>`DELETE /api/skills/${encodeURIComponent(id)}/sop`〔直连 · resetSkillSop〕<br>`PUT /api/admin/skills/${encodeURIComponent(id)}/grants`〔直连 · saveSkillGrants〕<br>`POST /api/admin/skills`〔直连 · createAdminSkill〕<br>`DELETE /api/admin/skills/${encodeURIComponent(id)}`〔直连 · deleteAdminSkill〕 |

## 2. 组件清单（按目录）

### 2.1 `pages/` 中的非路由组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| AgentApprover | [`frontend/src/pages/AgentApprover.tsx`](../frontend/src/pages/AgentApprover.tsx) | 审批岗位详情：展示审批岗使命与说明，内嵌待人处理的审批队列，并可按需让 KOL 说明某条审批的风险。 | —（无直接接口） |
| AgentKol | [`frontend/src/pages/AgentKol.tsx`](../frontend/src/pages/AgentKol.tsx) | KOL 岗位详情：展示岗位使命、说明、可帮事项与示例提问，并提供「开始工作」按钮把该专家召唤进思考会话。 | —（无直接接口） |

### 2.2 `components/` 通用组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| AccountBar | [`frontend/src/components/AccountBar.tsx`](../frontend/src/components/AccountBar.tsx) | 账户块：显示头像、姓名与角色，提供员工端与管理端切换、个人设置入口以及退出登录按钮。 | `POST /api/logout`〔经 hook · useAccount.logout〕 |
| AgentTaskList | [`frontend/src/components/AgentTaskList.tsx`](../frontend/src/components/AgentTaskList.tsx) | 可拖拽调宽的任务/邮件侧栏：任务模式下筛选状态、搜索并下拉刷新任务，邮件模式下渲染会话往来邮件列表。 | `GET /api/tasks?${query}`〔直连 · tasks〕 |
| AuthGate | [`frontend/src/components/AuthGate.tsx`](../frontend/src/components/AuthGate.tsx) | 登录门禁与会话上下文：检查账户状态并渲染初始化或登录表单，向子树提供账户信息、刷新与退出登录。 | `GET /api/auth/status`〔直连 · authStatus〕<br>`GET /api/me`〔直连 · me〕<br>`POST /api/logout`〔直连 · logout〕<br>`POST /api/auth/setup`〔直连 · setup〕<br>`POST /api/login`〔直连 · login〕 |
| BrandLockup | [`frontend/src/components/BrandLockup.tsx`](../frontend/src/components/BrandLockup.tsx) | 品牌标识：按首页、侧栏或弹窗变体渲染 Li Time 标志，可选展示中英文品牌口号。 | —（无直接接口） |
| DraftArtifact, ConfirmStageArtifact, SupplementArtifact, InboundArtifact, OverdueArtifact, ResultDraftPreview, KolMailCard, ChatThread | [`frontend/src/components/ChatBlocks.tsx`](../frontend/src/components/ChatBlocks.tsx) | 会话消息渲染块：把线程、过程轨迹与结果卡渲染成员工可读文案，并承载草稿发送、阶段确认与未绑定来信操作。 | `GET /api/sessions/${id}?sync=1&force=1`〔直连 · session〕<br>`GET /api/sessions/${encodeURIComponent(id)}/events`〔直连 · useSessionMessages.stream〕（api.ts 未封装）<br>`PATCH /api/drafts/${encodeURIComponent(id)}`〔直连 · patchDraft〕<br>`POST /api/drafts/${id}/translate`〔直连 · translate〕<br>`GET /api/drafts/${encodeURIComponent(id)}/actions`〔经 hook · useConfirmedDraftSend.requestSend〕<br>`POST /api/drafts/${id}/send`〔经 hook · useConfirmedDraftSend.requestSend〕<br>`POST /api/sessions/${sid}/confirm-stage`〔直连 · confirmSessionStage〕<br>`POST /api/sessions/${sid}/messages`〔直连 · postMessage〕<br>`POST /api/inbound/${id}/bind`〔直连 · inboundBind〕<br>`GET /api/inbound/${id}/search?q=${encodeURIComponent(q)}`〔直连 · inboundSearch〕<br>`POST /api/inbound/${id}/create`〔直连 · inboundCreate〕<br>`POST /api/inbound/${id}/resume`〔直连 · inboundResume〕<br>`POST /api/inbound/${id}/defer`〔直连 · inboundDefer〕 |
| ComposerDock | [`frontend/src/components/ComposerDock.tsx`](../frontend/src/components/ComposerDock.tsx) | 全局提问框：组合技能、知识库、附件、项目与专家，编辑发现条件、锁定邮件底稿并提交任务，同时展示运行、队列与上传状态。 | `GET /api/skills`〔直连〕<br>`GET /api/skills/market`〔直连〕<br>`GET /api/knowledge/skill-templates`〔直连 · skillTemplates〕<br>`GET /api/knowledge/composer`〔直连〕（api.ts 未封装）<br>`GET /api/knowledge`〔直连〕<br>`GET /api/knowledge/market`〔直连〕<br>`GET /api/projects`〔直连〕（api.ts 未封装）<br>`GET /api/files/recent?limit=12`〔直连〕（api.ts 未封装）<br>`POST /api/attachments`〔直连〕（api.ts 未封装） |
| ConfirmDialog | [`frontend/src/components/ConfirmDialog.tsx`](../frontend/src/components/ConfirmDialog.tsx) | L3 确认弹窗：列出对象、范围、变更与后果，可要求填写原因并锁定焦点，供管理端与审批动作统一复用；员工类确认（person）用紧凑三区：姓名＋邮箱同行、停用范围＋值同行、影响与次要说明，执行中按钮文案走 busyLabel。 | —（无直接接口） |
| ConnectorCredentialVault | [`frontend/src/components/ConnectorCredentialVault.tsx`](../frontend/src/components/ConnectorCredentialVault.tsx) | 凭据保险库：登记组织 Secret 与个人账号凭据引用，列出元数据并支持启用、停用与删除。 | `GET /api/admin/runtime/credentials`〔直连 · runtimeCredentials〕<br>`POST /api/admin/runtime/credentials`〔直连 · createRuntimeCredential〕<br>`PUT /api/admin/runtime/credentials/${encodeURIComponent(id)}`〔直连 · updateRuntimeCredential〕<br>`DELETE /api/admin/runtime/credentials/${encodeURIComponent(id)}`〔直连 · deleteRuntimeCredential〕 |
| CrawlArtifact | [`frontend/src/components/CrawlArtifact.tsx`](../frontend/src/components/CrawlArtifact.tsx) | 远程采集面板：选平台与采集模式发起任务，展示进度、异常与候选创作者明细，并把画像/评分/推荐动作回填输入框。 | —（无直接接口） |
| FollowedKolAgentReport | [`frontend/src/components/FollowedKolAgentReport.tsx`](../frontend/src/components/FollowedKolAgentReport.tsx) | 合作助理结果面板：按红人列出当前阶段、合作摘要与推荐动作，并汇总有兴趣、待回复与已拒绝的数量。 | —（无直接接口） |
| FollowedKolWorkCard | [`frontend/src/components/FollowedKolWorkCard.tsx`](../frontend/src/components/FollowedKolWorkCard.tsx) | 已跟进红人工作卡：展示阶段、风险、停留天数与最新往来事实，并按 AI 建议给出详情、互动、回公海与主操作按钮。 | —（无直接接口） |
| FollowStyleTagPills, FollowStyleTagBar, SuggestedFollowTags | [`frontend/src/components/FollowStyleTags.tsx`](../frontend/src/components/FollowStyleTags.tsx) | 跟进标签组件族：胶囊展示已有标签，面板内多选预设或自定义标签写回协作对象，并支持一键应用 AI 建议标签。 | `PUT /api/collaborations/${encodeURIComponent(collaborationId)}/follow-style-tags`〔直连 · saveFollowStyleTags〕 |
| JourneyGuide | [`frontend/src/components/JourneyGuide.tsx`](../frontend/src/components/JourneyGuide.tsx) | 合作之旅引导：按八个 SOP 阶段标出当前阶段，显示引导标题、模式说明与还缺哪些技能。 | —（无直接接口） |
| Markdown | [`frontend/src/components/Markdown.tsx`](../frontend/src/components/Markdown.tsx) | Markdown 渲染器：用 react-markdown 配合 remark-gfm 把传入文本渲染成带样式的富文本。 | —（无直接接口） |
| PanelToggleIcon | [`frontend/src/components/PanelToggleIcon.tsx`](../frontend/src/components/PanelToggleIcon.tsx) | 面板收起展开图标：按被折叠的一侧渲染左侧栏或右侧栏图标，供侧栏与结果栏共用。 | —（无直接接口） |
| RouteErrorBoundary, RouteLoadingFallback | [`frontend/src/components/RouteErrorBoundary.tsx`](../frontend/src/components/RouteErrorBoundary.tsx) | 路由容错：把懒加载 chunk 失效或渲染崩溃转成有原因和刷新入口的提示，并为慢加载提供兜底刷新。 | —（无直接接口） |
| RunHud | [`frontend/src/components/RunHud.tsx`](../frontend/src/components/RunHud.tsx) | 运行状态条：显示待命、执行中或等待确认等状态与阶段/任务名，并提示刷新页面不会取消后台执行。 | —（无直接接口） |
| SideWorkbench | [`frontend/src/components/SideWorkbench.tsx`](../frontend/src/components/SideWorkbench.tsx) | 会话右栏工作台：按本轮消息判定结果/邮件/草稿/阶段标签，渲染任务结果、采集候选与审批入口，并提供导出、复制与分享。 | `PATCH /api/preferences`〔直连 · savePreferences〕<br>`POST /api/sessions/${id}/share`〔直连 · shareSession〕<br>`DELETE /api/sessions/${id}/share`〔直连 · revokeShare〕 |
| SkillConnectorBindings | [`frontend/src/components/SkillConnectorBindings.tsx`](../frontend/src/components/SkillConnectorBindings.tsx) | Skill 工具挂载面板：列出连接器及其已登记工具，逐项勾选挂载或停用，并显示 R1/R2/R3 风险分级与版本冲突提示。 | `GET /api/admin/connectors`〔直连 · adminConnectors〕<br>`GET /api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors`〔直连 · runtimeSkillConnectors〕<br>`GET /api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools`〔直连 · runtimeSkillTools〕<br>`GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/policies`〔直连 · runtimeConnectorPolicies〕<br>`PUT /api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors/${encodeURIComponent(connectorId)}`〔直连 · saveRuntimeSkillConnector〕<br>`PUT /api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools/${encodeURIComponent(connectorId)}/${encodeURIComponent(toolName)}`〔直连 · saveRuntimeSkillTool〕 |
| SkillDeclaredDependencies | [`frontend/src/components/SkillDeclaredDependencies.tsx`](../frontend/src/components/SkillDeclaredDependencies.tsx) | 技能依赖面板：按连接器分组展示技能声明的 MCP 工具与登记/挂载状态，提供确认后的按定义挂载。 | `POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared`〔直连 · mountRuntimeConnectorDeclaredTools〕 |
| SkillTemplateContext | [`frontend/src/components/SkillTemplateContext.tsx`](../frontend/src/components/SkillTemplateContext.tsx) | 只读技能交互模板：展示技能功能、预计执行步骤、输出说明、可选条件与使用边界。 | —（无直接接口） |
| StarryBindForm | [`frontend/src/components/StarryBindForm.tsx`](../frontend/src/components/StarryBindForm.tsx) | 绑定跟进邮箱表单：读取并探测 Starry 可用发件箱、保存所选邮箱，并在确认后解除绑定。 | `GET /api/me/starry-binding`〔直连 · starryBinding〕<br>`POST /api/me/starry-binding/probe`〔直连 · probeStarryBinding〕<br>`POST /api/me/starry-binding`〔直连 · saveStarryBinding〕<br>`DELETE /api/me/starry-binding`〔直连 · clearStarryBinding〕 |
| TeamRail | [`frontend/src/components/TeamRail.tsx`](../frontend/src/components/TeamRail.tsx) | 数字团队进度轨：按会话进度把团队各步骤标为已完成、当前或未开始，并链接到团队页。 | `GET /api/agent-manifest`〔经 hook · useAgentManifest〕 |
| VersionDiff | [`frontend/src/components/VersionDiff.tsx`](../frontend/src/components/VersionDiff.tsx) | 只读版本对比：逐项对照标题、主题、品牌、语言、适用阶段，并对中英文正文做行级 diff 标注增删行。 | —（无直接接口） |

### 2.3 `composer/` 提问框组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| ChipRail | [`frontend/src/composer/ChipRail.tsx`](../frontend/src/composer/ChipRail.tsx) | 提问框上方的芯片轨道：逐条展示已附加的技能、知识库、专家、项目与附件，支持移除该芯片或把它插回正文光标处。 | —（无直接接口） |
| ModelTierControl | [`frontend/src/composer/ModelTierControl.tsx`](../frontend/src/composer/ModelTierControl.tsx) | 工具栏里的回答档位选择器：在快速、均衡、高质量三档间切换，并把档位写入本地偏好供提问框随提交带上。 | —（无直接接口） |
| PlusMenu | [`frontend/src/composer/PlusMenu.tsx`](../frontend/src/composer/PlusMenu.tsx) | 提问框「＋」菜单：按文件、技能、知识库、数字员工、项目分组检索并选取本次提问要加入的资料，写技能标注需确认。 | —（无直接接口） |

### 2.4 `home/` 首页工作台组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| BoardRow | [`frontend/src/home/BoardRow.tsx`](../frontend/src/home/BoardRow.tsx) | 统一任务表格行：显示序号、优先级、标题、why 说明与状态/风险标签，并提供打开任务和编辑入口。 | —（无直接接口） |
| ClaimFollowConfirm | [`frontend/src/home/ClaimFollowConfirm.tsx`](../frontend/src/home/ClaimFollowConfirm.tsx) | 公海对象行内的 L3 领取确认条：说明领取只建立我的跟进、不发信也不改阶段，并提供确认、取消与失败提示。 | —（无直接接口） |
| DiscoveryAiSummary | [`frontend/src/home/DiscoveryAiSummary.tsx`](../frontend/src/home/DiscoveryAiSummary.tsx) | 右栏 AI 摘要：用真实运行状态给出标题、状态、原始与入围计数及主要结论，失败时提供重试与技术详情。 | —（无直接接口） |
| DiscoveryFollowConfirm | [`frontend/src/home/DiscoveryFollowConfirm.tsx`](../frontend/src/home/DiscoveryFollowConfirm.tsx) | 跟进确认弹层：以 L3 对话框承载调用方说明文案，处理 Esc/Tab 焦点与回退，确认后才由调用方写入跟进关系。 | —（无直接接口） |
| DiscoveryIngestConfirm | [`frontend/src/home/DiscoveryIngestConfirm.tsx`](../frontend/src/home/DiscoveryIngestConfirm.tsx) | 入库公海确认弹层：L3 对话框呈现待写入数量、平台、来源运行与错误，确认或取消后由父级执行写入。 | —（无直接接口） |
| DiscoveryLeadRow | [`frontend/src/home/DiscoveryLeadRow.tsx`](../frontend/src/home/DiscoveryLeadRow.tsx) | 候选行：紧凑展示昵称、平台、推荐分、置信度与匹配理由，可展开二级指标，并提供看来源、勾选与忽略。 | —（无直接接口） |
| DiscoveryNextPlan | [`frontend/src/home/DiscoveryNextPlan.tsx`](../frontend/src/home/DiscoveryNextPlan.tsx) | 下一步计划卡：按运行、筛选与失败状态推导当前该做什么，给出重试、检查连接、改条件或进入入库确认。 | —（无直接接口） |
| DiscoveryProcessPanel | [`frontend/src/home/DiscoveryProcessPanel.tsx`](../frontend/src/home/DiscoveryProcessPanel.tsx) | 发现过程流：逐步显示 task_events 的步骤状态、Codex 推理片段与运行中等待说明，并可把条件卡调回中栏。 | —（无直接接口） |
| DiscoveryResultPane | [`frontend/src/home/DiscoveryResultPane.tsx`](../frontend/src/home/DiscoveryResultPane.tsx) | 发现结果右栏：汇总 AI 摘要、候选筛选与转化概览，并承载入库公海、重试与检查采集连接的操作入口。 | —（无直接接口） |
| DiscoveryRunStatusCard | [`frontend/src/home/DiscoveryRunStatusCard.tsx`](../frontend/src/home/DiscoveryRunStatusCard.tsx) | 检索状态卡：单行展示运行状态、完成时间、耗时与原始/入围数量，使同一屏上入围口径保持一致。 | —（无直接接口） |
| DiscoverySearchCard | [`frontend/src/home/DiscoverySearchCard.tsx`](../frontend/src/home/DiscoverySearchCard.tsx) | 发现条件卡：按 schema 渲染平台、地区、方向与阈值表单，条件改动即回传新 brief，改方向时同步关键词。 | —（无直接接口） |
| DiscoveryWorkspace | [`frontend/src/home/DiscoveryWorkspace.tsx`](../frontend/src/home/DiscoveryWorkspace.tsx) | AI 发现工作台：中栏按条件卡与 Codex 过程流取数，右栏呈现本轮运行的线索结果、转化概览与入库确认入口。 | `GET /api/home/discovery/runs`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}/candidates`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/tasks/${encodeURIComponent(id)}/events`〔经包装模块 · useDiscovery.loadExisting〕<br>`POST /api/home/discovery/runs/${encodeURIComponent(runId)}/retry`〔经包装模块 · useDiscovery.retryRun〕<br>`GET /api/discovery/connection`〔经包装模块 · useDiscovery.checkCollector〕<br>`POST /api/home/discovery/ingest`〔经包装模块 · useDiscovery.confirmIngest〕 |
| EditTaskDialog | [`frontend/src/home/EditTaskDialog.tsx`](../frontend/src/home/EditTaskDialog.tsx) | 编辑任务的模态框：修改标题、内容、状态、优先级、风险等级与起止日期，仅提交改动字段并回传保存结果。 | `PATCH /api/tasks/${encodeURIComponent(id)}`〔直连 · updateTask〕 |
| FollowedBatchConfirm | [`frontend/src/home/FollowedBatchConfirm.tsx`](../frontend/src/home/FollowedBatchConfirm.tsx) | 批量进入阶段的 L3 确认弹窗：列出待确认对象与建议目标阶段，声明不发信，由用户确认或取消，支持 Esc 与焦点回收。 | —（无直接接口） |
| FollowedBrief | [`frontend/src/home/FollowedBrief.tsx`](../frontend/src/home/FollowedBrief.tsx) | 跟进简报：按已拒绝、临近 14 天未联系、有意向三级优先级汇总在跟数量，给出先看哪一位与筛选入口。 | —（无直接接口） |
| FollowedInteraction | [`frontend/src/home/FollowedInteraction.tsx`](../frontend/src/home/FollowedInteraction.tsx) | 跟进对象交互左栏：呈现当前概览、合作生命周期分组计数与需要关注的情境入口，并作为插槽承载 Agent 交互区。 | —（无直接接口） |
| FollowedPane | [`frontend/src/home/FollowedPane.tsx`](../frontend/src/home/FollowedPane.tsx) | 跟进名单列表面板：搜索、阶段与情境筛选、排序与只看未读，全选后可批量分析或进阶段，并渲染各类空态与恢复入口。 | —（无直接接口） |
| ObjectWorkspace | [`frontend/src/home/ObjectWorkspace.tsx`](../frontend/src/home/ObjectWorkspace.tsx) | 公海与我的红人共用的对象工作台组合层：中栏呈现选择态与提问引导，右栏承载对象结果与受控动作。 | —（无直接接口） |
| PlanSummary | [`frontend/src/home/PlanSummary.tsx`](../frontend/src/home/PlanSummary.tsx) | 计划简报摘要：展示 lead、首条非政策说明与未完成任务/异常统计，作为任务表头部信息使用。 | —（无直接接口） |
| PoolInteraction | [`frontend/src/home/PoolInteraction.tsx`](../frontend/src/home/PoolInteraction.tsx) | 公海交互左栏：显示公海 KOL 总数与高潜、高风险、资料完整度分析入口，KOL 评分前展示确认条与模板缺失提示。 | —（无直接接口） |
| PoolPane | [`frontend/src/home/PoolPane.tsx`](../frontend/src/home/PoolPane.tsx) | 公海对象列表面板：搜索、未首次建联与 14 天未联系筛选、排序，行内领取/撤销跟进、评分徽章与红人库同步入口。 | —（无直接接口） |
| ReleaseFollowConfirm | [`frontend/src/home/ReleaseFollowConfirm.tsx`](../frontend/src/home/ReleaseFollowConfirm.tsx) | L3 回公海确认弹窗：列明对象、释放范围与 B.active→released 变更及后果，用户确认后才释放跟进归属。 | —（无直接接口） |
| ScopeWorkspace | [`frontend/src/home/ScopeWorkspace.tsx`](../frontend/src/home/ScopeWorkspace.tsx) | 今日任务与我的待办共用的工作区：把计划进度流、任务表与计划摘要组合进两栏外壳，并给出空态与去重提示。 | —（无直接接口） |
| StreamingLines | [`frontend/src/home/StreamingLines.tsx`](../frontend/src/home/StreamingLines.tsx) | 等待卡上的逐字流式文案：按行逐步显现并显示已等待秒数，读屏只播完整文案，减弱动效时直接出全文。 | —（无直接接口） |
| TaskBoard | [`frontend/src/home/TaskBoard.tsx`](../frontend/src/home/TaskBoard.tsx) | 今日与待办共用的任务表格：按优先级分档筛选、关键词搜索、折叠展开，并用表头按钮触发重新规划。 | —（无直接接口） |
| TodayPlanProgress | [`frontend/src/home/TodayPlanProgress.tsx`](../frontend/src/home/TodayPlanProgress.tsx) | 渲染一轮规划的 Codex 过程：里程碑步骤、推理流、已用时与失败原因，并可折叠查看上一版计划。 | —（无直接接口） |
| NextActionBar | [`frontend/src/home/workspace/NextActionBar.tsx`](../frontend/src/home/workspace/NextActionBar.tsx) | 结果栏下一步区：列出建议并可采纳为待办；受控动作按权限、状态与 L2/L3 分级要求二次确认后执行。 | —（无直接接口） |
| ResultRail | [`frontend/src/home/workspace/ResultRail.tsx`](../frontend/src/home/workspace/ResultRail.tsx) | 右栏结果协议渲染层：按视图模型展示来源/时间/新鲜度、结果值、记忆、历史、建议与注册动作。 | —（无直接接口） |
| ResultRendererRegistry | [`frontend/src/home/workspace/ResultRendererRegistry.tsx`](../frontend/src/home/workspace/ResultRendererRegistry.tsx) | 结果渲染器注册表：按 resultType 分发已注册渲染函数，缺失时回退为字符串、数组与对象的只读安全展示。 | —（无直接接口） |
| SkillParamCard | [`frontend/src/home/workspace/SkillParamCard.tsx`](../frontend/src/home/workspace/SkillParamCard.tsx) | 由 schema 驱动的参数表单：按字段类型渲染单选、多选、文本、数字等控件，供发现表单、澄清与只读汇总复用。 | —（无直接接口） |
| WorkspaceShell | [`frontend/src/home/WorkspaceShell.tsx`](../frontend/src/home/WorkspaceShell.tsx) | Home 两栏工作台的外壳：提供中栏唯一滚动容器、可折叠结果右栏、流式贴底跟随与回到底部按钮。 | —（无直接接口） |

### 2.5 `mail/components/` 邮件组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| ConversationItem | [`frontend/src/mail/components/ConversationItem.tsx`](../frontend/src/mail/components/ConversationItem.tsx) | 邮箱树第二层：一个会话主题及其邮件数量，未建档时给出标签，点击展开或收起该会话。 | —（无直接接口） |
| CorrespondentRow | [`frontend/src/mail/components/CorrespondentRow.tsx`](../frontend/src/mail/components/CorrespondentRow.tsx) | 邮箱树第一层：一个往来对象邮箱地址及其主题数量，点击只展开或收起，不移动阅读位置。 | —（无直接接口） |
| MailboxSwitcher | [`frontend/src/mail/components/MailboxSwitcher.tsx`](../frontend/src/mail/components/MailboxSwitcher.tsx) | 邮箱切换器：折叠态显示当前邮箱地址，展开后列出全部绑定邮箱与未读数，并提供收取入口。 | —（无直接接口） |
| MailContent | [`frontend/src/mail/components/MailContent.tsx`](../frontend/src/mail/components/MailContent.tsx) | 通讯第三栏：渲染当前选中邮件的发件人、收件人、时间与正文，并区分收件与发件两种样式。 | —（无直接接口） |
| MailDigestCard | [`frontend/src/mail/components/MailDigestCard.tsx`](../frontend/src/mail/components/MailDigestCard.tsx) | 往来摘要卡片：按摘要来源标注规则或模型，超长文本默认折叠，可展开查看完整摘要。 | —（无直接接口） |
| MailFold | [`frontend/src/mail/components/MailFold.tsx`](../frontend/src/mail/components/MailFold.tsx) | 详情栏可折叠区块：标题按钮控制展开，折叠状态按块写入本地存储，正文始终挂载以保住契约。 | —（无直接接口） |
| MailTimelineItem | [`frontend/src/mail/components/MailTimelineItem.tsx`](../frontend/src/mail/components/MailTimelineItem.tsx) | 邮箱树第三层：一行邮件条目，展示主题、已读未读状态与收或发的时间戳，点击即选中该封邮件。 | —（无直接接口） |
| PlainText | [`frontend/src/mail/components/PlainText.tsx`](../frontend/src/mail/components/PlainText.tsx) | 纯文本段落渲染器：解码 HTML 实体后按空行拆分段落，供邮件摘要与正文等记忆文本使用。 | —（无直接接口） |

### 2.6 `admin/` 治理端组件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| ConnectorConfigCard | [`frontend/src/admin/connector/ConnectorConfigCard.tsx`](../frontend/src/admin/connector/ConnectorConfigCard.tsx) | 接入配置表单：读取并保存协议、端点、超时与请求头密钥引用，并可预览 OpenAPI 文档生成 HTTP 动作定义。 | `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔直连 · runtimeConnectorConfig〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/import-openapi`〔直连 · previewRuntimeOpenApi〕<br>`GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔经包装模块 · connectorSetup.readConnectorConfigVersion〕<br>`PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕<br>`POST /api/admin/runtime/credentials`〔经包装模块 · connectorSetup.resolveHeaderRefs〕<br>`POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕 |
| ConnectorMark | [`frontend/src/admin/connector/ConnectorMark.tsx`](../frontend/src/admin/connector/ConnectorMark.tsx) | 连接器图标块：有已上传图标时显示图片，缺失或加载失败时回落为名称首字母，供卡片、详情与抽屉复用。 | —（无直接接口） |
| ModalShell, SplitButton, ConnectorIconUpload, HeaderNameInput, HeaderNameHint, HeaderRowsEditor, SecretKeysEditor, ApiConfigPanel, UrlAddPanel, JsonImportPanel | [`frontend/src/admin/connector/ConnectorPanels.tsx`](../frontend/src/admin/connector/ConnectorPanels.tsx) | 连接器控制台共用弹窗与表单控件，并提供自定义 HTTP API、URL 添加 MCP 与 JSON 导入三个创建面板。 | `PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔直连 · saveRuntimeConnectorConfig〕<br>`POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon`〔直连 · uploadConnectorIcon〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕<br>`POST /api/admin/connectors/import-mcp`〔直连 · importMcpConnectors〕<br>`PUT （调用方传入的动态路径）`〔经包装模块 · connectorSetup.createConnectorRecord〕<br>`POST /api/admin/runtime/credentials`〔经包装模块 · connectorSetup.resolveHeaderRefs〕<br>`PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕<br>`POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕 |
| ConnectorSetupWizard, McpConfigPanel | [`frontend/src/admin/connector/ConnectorSetupWizard.tsx`](../frontend/src/admin/connector/ConnectorSetupWizard.tsx) | 连接器接入向导：按保存、测试、工具清单、启用四步写入配置、探测远端工具目录、扫描技能挂载并控制启用状态。 | `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/activity?limit=${limit}`〔直连 · runtimeConnectorActivity〕<br>`GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}`〔直连 · runtimeSkillCoverage〕<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/probe`〔直连 · probeRuntimeConnector〕<br>`PUT （调用方传入的动态路径）`〔直连 · adminSave〕<br>`PUT （调用方传入的动态路径）`〔经包装模块 · connectorSetup.createConnectorRecord〕<br>`GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔经包装模块 · connectorSetup.readConnectorConfigVersion〕<br>`PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕<br>`POST /api/admin/runtime/credentials`〔经包装模块 · connectorSetup.resolveHeaderRefs〕<br>`POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon`〔经包装模块 · connectorSetup.saveConnectorConfigForm〕<br>`GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}`〔经包装模块 · useDeclaredToolMount.mount〕<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared`〔经包装模块 · useDeclaredToolMount.mount〕 |
| ConnectorToolsReadOnlyList, ConnectorToolsCard | [`frontend/src/admin/connector/ConnectorToolsCard.tsx`](../frontend/src/admin/connector/ConnectorToolsCard.tsx) | 只读工具清单：重新发现连接器暴露的工具，并对照平台已保存的风险档与启用状态展示，不提供授权或范围操作。 | `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/policies`〔直连 · runtimeConnectorPolicies〕<br>`GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/discovery`〔直连 · runtimeConnectorDiscovery〕 |
| ConnectorToolsDrawer | [`frontend/src/admin/connector/ConnectorToolsDrawer.tsx`](../frontend/src/admin/connector/ConnectorToolsDrawer.tsx) | 枢纽侧边抽屉：以弹层展示某连接器的只读工具目录，提供重新发现入口与跳转连接器详情的链接。 | —（无直接接口） |

### 2.7 `layout/` 与根级文件

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| Workbench | [`frontend/src/layout/Workbench.tsx`](../frontend/src/layout/Workbench.tsx) | 登录后的全局外壳：渲染侧栏导航与未读、待办徽标和账户栏，并为子路由提供 Outlet 与错误边界。 | `GET /api/version`〔直连 · version〕<br>`GET /api/tasks?${query}`〔直连 · tasks〕<br>`GET /api/sessions?include_archived=1`〔直连 · sessions〕<br>`GET /api/me`〔直连 · me〕<br>`GET /api/approvals/badge`〔直连 · approvalBadge〕<br>`GET /api/cron/jobs`〔直连 · cronJobs〕<br>`GET /api/mail/box?box=${encodeURIComponent(box)}`〔直连 · mailBox〕<br>`GET /api/preferences`〔直连 · preferences〕<br>`PATCH /api/preferences`〔直连 · savePreferences〕 |

### 2.8 其他

| 组件 | 文件 | 作用 | 对应接口 |
|---|---|---|---|
| App | [`frontend/src/App.tsx`](../frontend/src/App.tsx) | 应用根组件兼路由注册表：按路径懒加载各页面，区分 /share/:token 与登录后外壳两套路由。 | —（无直接接口） |
|  | [`frontend/src/main.tsx`](../frontend/src/main.tsx) | 浏览器入口：挂载 React 根节点与 BrowserRouter，并在懒加载资源失效时防抖硬刷新一次。 | —（无直接接口） |
| ViewModeProvider | [`frontend/src/viewMode.tsx`](../frontend/src/viewMode.tsx) | 视图模式上下文：依据当前账号是否管理员推导 admin 标记，并持久化管理员的调试视图开关。 | —（无直接接口） |

## 3. 接口反向索引（接口 → 使用它的组件）

共 225 个不同接口，按路径层级排序；`${…}` 为模板变量。

| 接口 | 使用组件 |
|---|---|
| `PUT （调用方传入的动态路径）` | AdminConsole、ApiConfigPanel、ConnectorConfigCard、ConnectorDetail、ConnectorHub、ConnectorIconUpload、ConnectorSetupWizard、EmployeeDirectory、HeaderNameHint、HeaderNameInput、HeaderRowsEditor、JsonImportPanel、McpConfigPanel、ModalShell、SecretKeysEditor、SplitButton、UrlAddPanel |
| `GET /api/admin` | Admin、Skills |
| `GET /api/agent-manifest` | AdminAgents、TeamRail |
| `GET /api/approvals?box=${encodeURIComponent(box)}` | Agents、Approvals |
| `GET /api/audit` | AdminConsole |
| `GET /api/exams` | Exam |
| `GET /api/experts` | Agents、SkillLifecycle |
| `GET /api/knowledge` | ComposerDock |
| `GET /api/knowledge?${qs}` | Knowledge |
| `GET /api/me` | AuthGate、Exam、Workbench |
| `GET /api/memory` | AccountSettings |
| `GET /api/pipeline?exception=${exception}` | Pipeline |
| `GET /api/preferences` | AccountSettings、Workbench |
| `GET /api/profiles` | AdminAgents |
| `GET /api/projects` | ComposerDock |
| `GET /api/sessions?include_archived=1` | AccountSettings、Workbench |
| `GET /api/skills` | Admin、BindingsView、ComposerDock、SkillCatalog、Skills |
| `GET /api/task-definitions` | Home |
| `GET /api/tasks?${query}` | AgentCrawler、AgentTaskList、Home、Tasks、Workbench |
| `GET /api/version` | Workbench |
| `PATCH /api/me` | AccountSettings |
| `PATCH /api/preferences` | AccountSettings、SideWorkbench、Workbench |
| `POST /api/approvals` | Approvals |
| `POST /api/attachments` | ComposerDock |
| `POST /api/login` | Admin、AuthGate |
| `POST /api/logout` | AccountBar、Admin、AuthGate |
| `POST /api/memory` | AccountSettings |
| `POST /api/sessions` | Admin、Agents、Home、HubMark、HubTile、SkillHub、SkillHubChrome、Skills |
| `POST /api/tasks` | AgentCrawler、Chat、Home |
| `DELETE /api/me/starry-binding` | StarryBindForm |
| `DELETE /api/memory/${id}` | AccountSettings |
| `DELETE /api/sessions/${id}` | AccountSettings |
| `GET /api/admin/connectors` | AdminConsole、SkillConnectorBindings |
| `GET /api/admin/exam-assignments` | AdminAgents、AdminConsole、AdminExams |
| `GET /api/admin/exam-scores` | AdminExams |
| `GET /api/admin/exams` | AdminAgents、AdminConsole、AdminExams |
| `GET /api/admin/knowledge` | AdminExams、TodoView |
| `GET /api/admin/organization-units` | EmployeeDirectory |
| `GET /api/admin/retention-policy` | AdminConsole |
| `GET /api/admin/skills` | Admin、SkillLifecycle |
| `GET /api/admin/users` | AdminConsole、AdminExams |
| `GET /api/approvals/${encodeURIComponent(id)}` | Approvals |
| `GET /api/approvals/badge` | Workbench |
| `GET /api/auth/status` | AuthGate |
| `GET /api/cron/jobs` | Cron、Workbench |
| `GET /api/discovery/connection` | DiscoveryWorkspace |
| `GET /api/discovery/requests` | AgentCrawler |
| `GET /api/experts/${encodeURIComponent(id)}` | Agents |
| `GET /api/files/recent?limit=12` | ComposerDock |
| `GET /api/home/board?refresh=1` | Home |
| `GET /api/home/following` | Home |
| `GET /api/home/pool` | Home |
| `GET /api/home/today-brief` | Home |
| `GET /api/home/today-tasks` | Home |
| `GET /api/home/todo-brief` | Home |
| `GET /api/home/todo-tasks` | Home |
| `GET /api/knowledge/${encodeURIComponent(id)}` | Home |
| `GET /api/knowledge/composer` | ComposerDock |
| `GET /api/knowledge/market` | ComposerDock |
| `GET /api/knowledge/question-templates` | Home |
| `GET /api/knowledge/skill-templates` | ComposerDock、Knowledge |
| `GET /api/mail/box?box=${encodeURIComponent(box)}` | Mail、Workbench |
| `GET /api/mail/compose-catalog` | Mail |
| `GET /api/mail/conversations?box=${encodeURIComponent(box)}` | Mail |
| `GET /api/mail/person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}` | Mail |
| `GET /api/me/data-summary` | AccountSettings |
| `GET /api/me/starry-binding` | Mail、StarryBindForm |
| `GET /api/privacy/cookies` | AccountSettings |
| `GET /api/sessions/${id}?sync=1&force=1` | Chat、ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `GET /api/shared/${encodeURIComponent(token)}` | SharedSession |
| `GET /api/skills/${encodeURIComponent(id)}` | SkillCatalog |
| `GET /api/skills/market` | ComposerDock、HubMark、HubTile、SkillHub、SkillHubChrome |
| `GET /api/tasks/${encodeURIComponent(id)}` | Chat、Home、Tasks |
| `GET /api/wecom/cards` | Approvals |
| `PATCH /api/drafts/${encodeURIComponent(id)}` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `PATCH /api/memory/${id}` | AccountSettings |
| `PATCH /api/tasks/${encodeURIComponent(id)}` | EditTaskDialog |
| `POST /api/admin/exams` | AdminExams |
| `POST /api/admin/knowledge` | AssetsView |
| `POST /api/admin/skills` | Admin |
| `POST /api/approvals/preview` | Approvals |
| `POST /api/auth/password` | AccountSettings |
| `POST /api/auth/setup` | AuthGate |
| `POST /api/cron/jobs` | Cron |
| `POST /api/email-compose/prepare` | Chat、Home |
| `POST /api/mail/sync` | Mail |
| `POST /api/me/starry-binding` | StarryBindForm |
| `POST /api/tasks/adopt-recommendation` | Home |
| `POST /api/tasks/from-text` | Home、Mail |
| `DELETE /api/admin/knowledge/${encodeURIComponent(id)}` | AssetDetailView、TodoView |
| `DELETE /api/admin/skills/${encodeURIComponent(id)}` | Admin |
| `DELETE /api/knowledge/${encodeURIComponent(id)}/deprecate` | Knowledge |
| `DELETE /api/sessions/${id}/share` | SideWorkbench |
| `DELETE /api/skills/${encodeURIComponent(id)}/sop` | Admin |
| `GET /api/admin/knowledge/assets` | AssetDetailView、AssetsView、SkillLifecycle |
| `GET /api/admin/knowledge/bindings` | BindingsView、SkillLifecycle |
| `GET /api/admin/knowledge/extract-jobs` | IngestView |
| `GET /api/admin/knowledge/feedback` | FeedbackView |
| `GET /api/admin/knowledge/proposals` | TodoView |
| `GET /api/admin/knowledge/raw` | IngestView |
| `GET /api/admin/knowledge/review` | TodoView |
| `GET /api/admin/runtime/credentials` | ConnectorCredentialVault |
| `GET /api/cron/jobs/${encodeURIComponent(id)}` | Cron |
| `GET /api/cron/runs/${encodeURIComponent(runId)}` | Cron |
| `GET /api/drafts/${encodeURIComponent(id)}/actions` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `GET /api/exams/${encodeURIComponent(id)}/result` | Exam |
| `GET /api/home/discovery/runs` | DiscoveryWorkspace |
| `GET /api/home/discovery/template` | Home |
| `GET /api/inbound/${id}/search?q=${encodeURIComponent(q)}` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `GET /api/knowledge/${encodeURIComponent(id)}/versions` | AssetDetailView |
| `GET /api/mail/conversations/${encodeURIComponent(id)}` | Mail |
| `GET /api/sessions/${encodeURIComponent(id)}/events` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `GET /api/tasks/${encodeURIComponent(id)}/crawl-job` | AgentCrawler、Chat |
| `GET /api/tasks/${encodeURIComponent(id)}/events` | Chat、DiscoveryWorkspace、Tasks |
| `GET /api/tasks/by-session/${encodeURIComponent(sessionId)}` | Chat |
| `PATCH /api/admin/skills/${encodeURIComponent(id)}` | Admin |
| `PATCH /api/cron/jobs/${encodeURIComponent(id)}` | Cron |
| `POST /api/admin/connectors/import-mcp` | ApiConfigPanel、ConnectorIconUpload、HeaderNameHint、HeaderNameInput、HeaderRowsEditor、JsonImportPanel、ModalShell、SecretKeysEditor、SplitButton、UrlAddPanel |
| `POST /api/admin/crawl-history/clear` | Chat |
| `POST /api/admin/knowledge/bindings` | BindingsView |
| `POST /api/admin/knowledge/resolve-preview` | BindingsView、SkillLifecycle |
| `POST /api/admin/knowledge/upload` | IngestView |
| `POST /api/admin/runtime/credentials` | ApiConfigPanel、ConnectorConfigCard、ConnectorCredentialVault、ConnectorIconUpload、ConnectorSetupWizard、HeaderNameHint、HeaderNameInput、HeaderRowsEditor、JsonImportPanel、McpConfigPanel、ModalShell、SecretKeysEditor、SplitButton、UrlAddPanel |
| `POST /api/admin/skills/import` | SkillLifecycle |
| `POST /api/approvals/${encodeURIComponent(id)}/decide` | Approvals |
| `POST /api/collaborations/${encodeURIComponent(collaborationId)}/session` | Home、Pipeline |
| `POST /api/drafts/${id}/send` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/drafts/${id}/translate` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/exams/${encodeURIComponent(id)}/start` | Exam |
| `POST /api/exams/${encodeURIComponent(id)}/submit` | Exam |
| `POST /api/experts/${encodeURIComponent(id)}/summon` | Agents |
| `POST /api/follows/${encodeURIComponent(followId)}/release` | Home |
| `POST /api/home/discovery/ingest` | DiscoveryWorkspace |
| `POST /api/home/discovery/run` | Home |
| `POST /api/home/kol-analyze/enqueue` | Home、Mail |
| `POST /api/home/pool/jev-assess` | Home |
| `POST /api/home/pool/sync` | Home |
| `POST /api/home/today-brief/plan` | Home |
| `POST /api/home/todo-brief/plan` | Home |
| `POST /api/inbound/${id}/bind` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/inbound/${id}/create` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/inbound/${id}/defer` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/inbound/${id}/resume` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/knowledge/${encodeURIComponent(id)}/cite` | Knowledge |
| `POST /api/knowledge/${encodeURIComponent(id)}/deprecate` | Knowledge |
| `POST /api/kols/${encodeURIComponent(kolUid)}/claim` | Home |
| `POST /api/mail/memory/generate` | Mail |
| `POST /api/me/starry-binding/probe` | StarryBindForm |
| `POST /api/sessions/${id}/archive` | AccountSettings |
| `POST /api/sessions/${id}/share` | SideWorkbench |
| `POST /api/sessions/${id}/unarchive` | AccountSettings |
| `POST /api/sessions/${sid}/confirm-stage` | ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/sessions/${sid}/messages` | Chat、ChatThread、ConfirmStageArtifact、DraftArtifact、InboundArtifact、KolMailCard、OverdueArtifact、ResultDraftPreview、SupplementArtifact |
| `POST /api/sessions/${sid}/stop` | Chat |
| `POST /api/tasks/${encodeURIComponent(id)}/acknowledge` | Home |
| `POST /api/tasks/${encodeURIComponent(id)}/cancel` | Tasks |
| `POST /api/tasks/${encodeURIComponent(id)}/complete` | Chat |
| `POST /api/tasks/${encodeURIComponent(id)}/dismiss` | Home |
| `POST /api/tasks/${encodeURIComponent(id)}/run` | Chat、Home、Mail、Tasks |
| `PUT /api/admin/knowledge/${encodeURIComponent(id)}` | AssetDetailView |
| `PUT /api/collaborations/${encodeURIComponent(collaborationId)}/follow-style-tags` | FollowStyleTagBar、FollowStyleTagPills、SuggestedFollowTags |
| `PUT /api/mail/conversations/${encodeURIComponent(id)}` | Mail |
| `PUT /api/skills/${encodeURIComponent(id)}/sop` | Admin |
| `DELETE /api/admin/knowledge/bindings/${encodeURIComponent(id)}` | BindingsView |
| `DELETE /api/admin/runtime/credentials/${encodeURIComponent(id)}` | ConnectorCredentialVault |
| `DELETE /api/sessions/${sid}/queue/${encodeURIComponent(qid)}` | Chat |
| `GET /api/admin/exams/${encodeURIComponent(id)}/items` | AdminExams |
| `GET /api/admin/knowledge/${encodeURIComponent(id)}/grants` | AssetDetailView |
| `GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}` | ConnectorDetail、ConnectorSetupWizard、McpConfigPanel、SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/draft` | Admin、SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/metrics?days=${days}` | SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/sop` | Admin、SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/template` | SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/tests` | SkillLifecycle |
| `GET /api/admin/skills/${encodeURIComponent(id)}/versions` | SkillLifecycle |
| `GET /api/admin/users/${encodeURIComponent(userId)}/context` | EmployeeDirectory |
| `GET /api/admin/users/${encodeURIComponent(userId)}/tools` | EmployeeDirectory |
| `GET /api/home/discovery/runs/${encodeURIComponent(runId)}` | DiscoveryWorkspace |
| `GET /api/tasks/${encodeURIComponent(id)}/crawl-job/events` | Chat |
| `PATCH /api/admin/knowledge/bindings/${encodeURIComponent(id)}` | BindingsView |
| `PATCH /api/admin/skills/${encodeURIComponent(id)}/lifecycle` | SkillLifecycle |
| `POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon` | ApiConfigPanel、ConnectorConfigCard、ConnectorIconUpload、ConnectorSetupWizard、HeaderNameHint、HeaderNameInput、HeaderRowsEditor、JsonImportPanel、McpConfigPanel、ModalShell、SecretKeysEditor、SplitButton、UrlAddPanel |
| `POST /api/admin/crawl-jobs/${encodeURIComponent(jobId)}/retry-upload` | Chat |
| `POST /api/admin/exam-items/${encodeURIComponent(id)}/accept` | AdminExams |
| `POST /api/admin/exams/${encodeURIComponent(id)}/assign` | AdminExams |
| `POST /api/admin/exams/${encodeURIComponent(id)}/generate` | AdminExams |
| `POST /api/admin/exams/${encodeURIComponent(id)}/items` | AdminExams |
| `POST /api/admin/exams/${encodeURIComponent(id)}/publish` | AdminExams |
| `POST /api/admin/knowledge/${encodeURIComponent(id)}/approve` | AssetDetailView |
| `POST /api/admin/knowledge/${encodeURIComponent(id)}/archive` | AssetDetailView、AssetsView |
| `POST /api/admin/knowledge/${encodeURIComponent(id)}/feedback-handle` | FeedbackView |
| `POST /api/admin/knowledge/${encodeURIComponent(id)}/rollback` | AssetDetailView |
| `POST /api/admin/knowledge/${encodeURIComponent(id)}/transfer` | AssetDetailView |
| `POST /api/admin/knowledge/extract/${encodeURIComponent(rawId)}` | IngestView |
| `POST /api/admin/skills/${encodeURIComponent(id)}/stage` | SkillLifecycle |
| `POST /api/admin/skills/${encodeURIComponent(id)}/tests` | SkillLifecycle |
| `POST /api/admin/skills/${encodeURIComponent(id)}/versions` | SkillLifecycle |
| `POST /api/cron/jobs/${encodeURIComponent(id)}/run` | Cron |
| `POST /api/discovery/candidates/${encodeURIComponent(id)}/follow` | AgentCrawler |
| `POST /api/mail/conversations/${encodeURIComponent(id)}/read` | Mail |
| `POST /api/tasks/${encodeURIComponent(id)}/actions/start-crawl` | AgentCrawler、Chat |
| `POST /api/tasks/${encodeURIComponent(id)}/actions/stop-crawl` | Chat |
| `PUT /api/admin/knowledge/${encodeURIComponent(id)}/grants` | AssetDetailView |
| `PUT /api/admin/runtime/credentials/${encodeURIComponent(id)}` | ConnectorCredentialVault |
| `PUT /api/admin/skills/${encodeURIComponent(id)}/draft` | SkillLifecycle |
| `PUT /api/admin/skills/${encodeURIComponent(id)}/grants` | Admin、SkillLifecycle |
| `DELETE /api/admin/skills/${encodeURIComponent(id)}/tests/${encodeURIComponent(testId)}` | SkillLifecycle |
| `GET /api/admin/knowledge/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}` | AssetDetailView |
| `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/activity?limit=${limit}` | ConnectorDetail、ConnectorSetupWizard、McpConfigPanel |
| `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config` | ConnectorConfigCard、ConnectorSetupWizard、McpConfigPanel |
| `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/discovery` | ConnectorToolsCard、ConnectorToolsReadOnlyList |
| `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/policies` | ConnectorToolsCard、ConnectorToolsReadOnlyList、SkillConnectorBindings |
| `GET /api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors` | SkillConnectorBindings |
| `GET /api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools` | SkillConnectorBindings |
| `GET /api/home/discovery/runs/${encodeURIComponent(runId)}/candidates` | DiscoveryWorkspace |
| `POST /api/admin/knowledge/evolve/${encodeURIComponent(id)}/review` | TodoView |
| `POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/import-openapi` | ConnectorConfigCard |
| `POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared` | ConnectorDetail、ConnectorSetupWizard、McpConfigPanel、SkillDeclaredDependencies |
| `POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/probe` | ConnectorDetail、ConnectorSetupWizard、McpConfigPanel |
| `POST /api/admin/skills/${encodeURIComponent(id)}/tests/run` | SkillLifecycle |
| `POST /api/admin/skills/${encodeURIComponent(id)}/versions/rollback` | SkillLifecycle |
| `POST /api/home/discovery/runs/${encodeURIComponent(runId)}/retry` | DiscoveryWorkspace |
| `PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config` | ApiConfigPanel、ConnectorConfigCard、ConnectorIconUpload、ConnectorSetupWizard、HeaderNameHint、HeaderNameInput、HeaderRowsEditor、JsonImportPanel、McpConfigPanel、ModalShell、SecretKeysEditor、SplitButton、UrlAddPanel |
| `PUT /api/admin/runtime/skills/${encodeURIComponent(skillId)}/connectors/${encodeURIComponent(connectorId)}` | SkillConnectorBindings |
| `PUT /api/admin/runtime/skills/${encodeURIComponent(skillId)}/tools/${encodeURIComponent(connectorId)}/${encodeURIComponent(toolName)}` | SkillConnectorBindings |

## 4. 无直接接口的组件

这些组件的数据与动作全部由父组件或 Props 传入；接口归属见 §3 与其父页面记录。

### 4.1 纯 props / 上下文驱动（无任何接口记录）

| 组件 | 文件 | 作用 | 数据 / 动作来源（原始备注） |
|---|---|---|---|
| ConnectorMark | [`frontend/src/admin/connector/ConnectorMark.tsx`](../frontend/src/admin/connector/ConnectorMark.tsx) | 连接器图标块：有已上传图标时显示图片，缺失或加载失败时回落为名称首字母，供卡片、详情与抽屉复用。 | 纯展示组件，无接口调用；图标 URL 由调用方经 props 传入，图片加载失败时只在本组件内回落为首字母。 |
| ConnectorToolsDrawer | [`frontend/src/admin/connector/ConnectorToolsDrawer.tsx`](../frontend/src/admin/connector/ConnectorToolsDrawer.tsx) | 枢纽侧边抽屉：以弹层展示某连接器的只读工具目录，提供重新发现入口与跳转连接器详情的链接。 | 无自有接口：连接器卡片由 ConnectorHub 以 props 传入，工具清单由子组件 ConnectorToolsReadOnlyList 自行读取。 |
| App | [`frontend/src/App.tsx`](../frontend/src/App.tsx) | 应用根组件兼路由注册表：按路径懒加载各页面，区分 /share/:token 与登录后外壳两套路由。 | 无接口：只声明路由与懒加载（lazy/Suspense/RouteErrorBoundary），取数由各页面组件自己完成。 |
| BrandLockup | [`frontend/src/components/BrandLockup.tsx`](../frontend/src/components/BrandLockup.tsx) | 品牌标识：按首页、侧栏或弹窗变体渲染 Li Time 标志，可选展示中英文品牌口号。 | 纯展示组件，不取数。 |
| ConfirmDialog | [`frontend/src/components/ConfirmDialog.tsx`](../frontend/src/components/ConfirmDialog.tsx) | L3 确认弹窗：列出对象、范围、变更与后果，可要求填写原因并锁定焦点，供管理端与审批动作统一复用；员工类确认（person）用紧凑三区：姓名＋邮箱同行、停用范围＋值同行、影响与次要说明，执行中按钮文案走 busyLabel。 | 无自身接口：弹窗只渲染确认事实与原因输入，真正的写操作由调用方传入的 run 回调执行（useAdminConfirm 的 ask(copy, run) 包装 busy/error/reason 状态）；焦点锁来自 hooks/useFocusLock（不调接口）。 |
| CrawlArtifact | [`frontend/src/components/CrawlArtifact.tsx`](../frontend/src/components/CrawlArtifact.tsx) | 远程采集面板：选平台与采集模式发起任务，展示进度、异常与候选创作者明细，并把画像/评分/推荐动作回填输入框。 | 无自身接口：只从 ../api 引入类型；plan、job、events、candidates 与 onStart、onStop、onRetryUpload、onClearHistory 回调全部由父组件（SideWorkbench / Chat 页）经 props 传入。本组件负责关键词/ID 校验、按 idempotency_key 组装 StartCrawlInput、每秒刷新已用时、以及候选表的基础评分与置信度计算；「清除采集历史」前用 window.confirm 二次确认。 |
| FollowedKolAgentReport | [`frontend/src/components/FollowedKolAgentReport.tsx`](../frontend/src/components/FollowedKolAgentReport.tsx) | 合作助理结果面板：按红人列出当前阶段、合作摘要与推荐动作，并汇总有兴趣、待回复与已拒绝的数量。 | 红人卡片由父组件传入（FollowedKolCardModel），本组件只做状态分类、标签裁剪与回调（打开详情/写草稿/确认阶段）分发。 |
| FollowedKolWorkCard | [`frontend/src/components/FollowedKolWorkCard.tsx`](../frontend/src/components/FollowedKolWorkCard.tsx) | 已跟进红人工作卡：展示阶段、风险、停留天数与最新往来事实，并按 AI 建议给出详情、互动、回公海与主操作按钮。 | 纯 props 驱动：卡片模型 FollowedKolCardModel 与 onOpenDetail、onPrimary、onOpenMail、onCompose、onConfirmStage、onRelease、onToggleSelect 等回调由父组件（home/FollowedPane.tsx、pages/Home.tsx）传入，本文件不直接调用任何接口；卡片内的选择态、悬停态、CTA 强调级别同样由父级控制。 |
| JourneyGuide | [`frontend/src/components/JourneyGuide.tsx`](../frontend/src/components/JourneyGuide.tsx) | 合作之旅引导：按八个 SOP 阶段标出当前阶段，显示引导标题、模式说明与还缺哪些技能。 | 旅程事件取自 journey 模块的本地存储与订阅（进入即记一次 enter），红人、任务与技能定义由父组件 props 传入。 |
| Markdown | [`frontend/src/components/Markdown.tsx`](../frontend/src/components/Markdown.tsx) | Markdown 渲染器：用 react-markdown 配合 remark-gfm 把传入文本渲染成带样式的富文本。 | 内容由父组件传入，本组件不取数。 |
| PanelToggleIcon | [`frontend/src/components/PanelToggleIcon.tsx`](../frontend/src/components/PanelToggleIcon.tsx) | 面板收起展开图标：按被折叠的一侧渲染左侧栏或右侧栏图标，供侧栏与结果栏共用。 | 纯 SVG 图标组件，无取数；绘制口径与侧栏导航一致。 |
| RouteErrorBoundary, RouteLoadingFallback | [`frontend/src/components/RouteErrorBoundary.tsx`](../frontend/src/components/RouteErrorBoundary.tsx) | 路由容错：把懒加载 chunk 失效或渲染崩溃转成有原因和刷新入口的提示，并为慢加载提供兜底刷新。 | 纯前端错误边界与等待态，不调用接口；RouteLoadingFallback 由 layout/Workbench 使用。 |
| RunHud | [`frontend/src/components/RunHud.tsx`](../frontend/src/components/RunHud.tsx) | 运行状态条：显示待命、执行中或等待确认等状态与阶段/任务名，并提示刷新页面不会取消后台执行。 | 状态、阶段、任务名与远端标签均由父组件以 props 传入；文件内只 import 类型 AgentRunStatus，不取数。 |
| SkillTemplateContext | [`frontend/src/components/SkillTemplateContext.tsx`](../frontend/src/components/SkillTemplateContext.tsx) | 只读技能交互模板：展示技能功能、预计执行步骤、输出说明、可选条件与使用边界。 | template 由父组件传入（SkillTemplate），组件只做只读呈现，不表示任何执行状态。 |
| VersionDiff | [`frontend/src/components/VersionDiff.tsx`](../frontend/src/components/VersionDiff.tsx) | 只读版本对比：逐项对照标题、主题、品牌、语言、适用阶段，并对中英文正文做行级 diff 标注增删行。 | 左右两个版本对象由父组件以 props 传入，本组件不取数；每侧正文最多对比前 400 行。 |
| ChipRail | [`frontend/src/composer/ChipRail.tsx`](../frontend/src/composer/ChipRail.tsx) | 提问框上方的芯片轨道：逐条展示已附加的技能、知识库、专家、项目与附件，支持移除该芯片或把它插回正文光标处。 | 纯受控展示组件：chips 数组与 onRemove/onInsert 回调都由 ComposerDock 传入，组件自身不调用任何接口；附件芯片的「已上传」与体积文案只取自传入数据。 |
| ModelTierControl | [`frontend/src/composer/ModelTierControl.tsx`](../frontend/src/composer/ModelTierControl.tsx) | 工具栏里的回答档位选择器：在快速、均衡、高质量三档间切换，并把档位写入本地偏好供提问框随提交带上。 | 无接口调用：档位经 localStorage 读写并用 MODEL_TIER_EVENT 广播给提问框；面板内「更多设置…」链接跳转 /settings?tab=preferences。 |
| PlusMenu | [`frontend/src/composer/PlusMenu.tsx`](../frontend/src/composer/PlusMenu.tsx) | 提问框「＋」菜单：按文件、技能、知识库、数字员工、项目分组检索并选取本次提问要加入的资料，写技能标注需确认。 | 无接口调用：技能、知识库、最近文件、项目、已选技能与专家均由 ComposerDock 经 props 传入，仅从 localStorage 读取最近使用技能；「查看全部技能」链接跳转 /skills。 |
| BoardRow | [`frontend/src/home/BoardRow.tsx`](../frontend/src/home/BoardRow.tsx) | 统一任务表格行：显示序号、优先级、标题、why 说明与状态/风险标签，并提供打开任务和编辑入口。 | 单行任务由 TaskBoard 经 props 传入；打开与编辑只上抛 onAct/onEdit 回调，由页面决定后续接口。 |
| ClaimFollowConfirm | [`frontend/src/home/ClaimFollowConfirm.tsx`](../frontend/src/home/ClaimFollowConfirm.tsx) | 公海对象行内的 L3 领取确认条：说明领取只建立我的跟进、不发信也不改阶段，并提供确认、取消与失败提示。 | 纯 props 驱动：card/busy/error 与 onConfirm/onCancel 由 PoolPane 再向上由 Home 传入；领取上游为 kolSurfaceApi.claimPoolKol（ POST /api/kols/${encodeURIComponent(kolUid)}/claim ）。本文件不调接口。 |
| DiscoveryAiSummary | [`frontend/src/home/DiscoveryAiSummary.tsx`](../frontend/src/home/DiscoveryAiSummary.tsx) | 右栏 AI 摘要：用真实运行状态给出标题、状态、原始与入围计数及主要结论，失败时提供重试与技术详情。 | run、failure、emptyKind/emptyMessage 与 connection 均由 DiscoveryResultPane 传入（run 来自 GET /api/home/discovery/runs/${runId}，连接状态来自 GET /api/discovery/connection）；重试与「检查采集服务」只触发父级回调。本文件不取数，结论文案全部由已有运行/候选状态推导，技术详情点开才显示。 |
| DiscoveryFollowConfirm | [`frontend/src/home/DiscoveryFollowConfirm.tsx`](../frontend/src/home/DiscoveryFollowConfirm.tsx) | 跟进确认弹层：以 L3 对话框承载调用方说明文案，处理 Esc/Tab 焦点与回退，确认后才由调用方写入跟进关系。 | 纯 L3 弹层：经 createPortal 渲染调用方传入的 children，自身不取数、不发请求。确认动作由调用方执行——当前唯一调用方 pages/AgentCrawler.tsx 在 onConfirm 里经 home/discovery.ts 的 followCandidate 调 POST /api/discovery/candidates/${encodeURIComponent(id)}/follow；组件 mode 另支持 selected/conditional（批量与条件跟进），但走哪个接口由调用方决定，本文件不参与。 |
| DiscoveryIngestConfirm | [`frontend/src/home/DiscoveryIngestConfirm.tsx`](../frontend/src/home/DiscoveryIngestConfirm.tsx) | 入库公海确认弹层：L3 对话框呈现待写入数量、平台、来源运行与错误，确认或取消后由父级执行写入。 | 纯 L3 弹层，自身不取数、不发请求；确认与取消都由父级回调执行，最终是 useDiscovery.confirmIngest / cancelIngest 调 POST /api/home/discovery/ingest（取消时 body.cancel=true，仅在后端回过 needs_confirmation 后才发）。busy 期间禁用两个按钮并吞掉 Esc/背景点击，避免重复提交。 |
| DiscoveryLeadRow | [`frontend/src/home/DiscoveryLeadRow.tsx`](../frontend/src/home/DiscoveryLeadRow.tsx) | 候选行：紧凑展示昵称、平台、推荐分、置信度与匹配理由，可展开二级指标，并提供看来源、勾选与忽略。 | 纯展示行：候选字段（含 ingestReadiness、libraryStatus、matchedKeywords、邮箱掩码）由父级候选列表经 props 传入，来源为 GET /api/home/discovery/runs/${runId}/candidates；本文件不发任何请求。「忽略」只把 id 写入父级的本地 ignoredIds，不等于调用了 dismiss 候选接口；无可看 URL 时「看来源」渲染为禁用态而不是编造链接。 |
| DiscoveryNextPlan | [`frontend/src/home/DiscoveryNextPlan.tsx`](../frontend/src/home/DiscoveryNextPlan.tsx) | 下一步计划卡：按运行、筛选与失败状态推导当前该做什么，给出重试、检查连接、改条件或进入入库确认。 | 计划项由 run、可见/已选条数、failure、inFlight、emptyKind 在本地推导（数据来自 useDiscovery 的运行详情、候选列表与任务事件）；按钮只回调父级：重试→POST /api/home/discovery/runs/${runId}/retry，检查连接→GET /api/discovery/connection，改条件与进入确认只切本地卡片/弹层。本文件自身不发请求。 |
| DiscoveryProcessPanel | [`frontend/src/home/DiscoveryProcessPanel.tsx`](../frontend/src/home/DiscoveryProcessPanel.tsx) | 发现过程流：逐步显示 task_events 的步骤状态、Codex 推理片段与运行中等待说明，并可把条件卡调回中栏。 | 步骤、推理文本与失败/在途标志均由 DiscoveryWorkspace 经 props 传入；数据来源是 useDiscovery 对 GET /api/tasks/${encodeURIComponent(id)}/events 的 1.5s 轮询（事件被 presentDiscoveryEvents/presentDiscoveryThink 转成步骤与推理段）。本文件只做渲染、状态着色与「改条件再搜」回调，不取数。 |
| DiscoveryResultPane | [`frontend/src/home/DiscoveryResultPane.tsx`](../frontend/src/home/DiscoveryResultPane.tsx) | 发现结果右栏：汇总 AI 摘要、候选筛选与转化概览，并承载入库公海、重试与检查采集连接的操作入口。 | 全部状态与回调由父级 DiscoveryWorkspace 的 useDiscovery 状态对象传入，本文件不自行取数：可直接指认的来源是 GET /api/home/discovery/runs/${runId}（运行详情）、GET /api/home/discovery/runs/${runId}/candidates（候选与转化准备度）、GET /api/discovery/connection（采集连接）、POST /api/home/discovery/runs/${runId}/retry（重试）、POST /api/home/discovery/ingest（入库，含取消分支）。运行列表 GET /api/home/discovery/runs 与过程事件 GET /api/tasks/${id}/events 由该 hook 另读，这里只消费派生的 failure / emptyKind。「忽略」只写本地 ignoredIds，不发请求；筛选、展开、全选均为本地状态。 |
| DiscoveryRunStatusCard | [`frontend/src/home/DiscoveryRunStatusCard.tsx`](../frontend/src/home/DiscoveryRunStatusCard.tsx) | 检索状态卡：单行展示运行状态、完成时间、耗时与原始/入围数量，使同一屏上入围口径保持一致。 | run 与 shortlistFallback 由调用方传入（run 结构来自 GET /api/home/discovery/runs/${runId}），本文件只做格式化，不取数。当前 frontend/src 内没有任何组件或测试引用它（旧 DiscoveryPanel 已删除，仅 artifacts/review/t4-t7.diff 的历史 diff 里出现过），属未接线的孤立组件。 |
| DiscoverySearchCard | [`frontend/src/home/DiscoverySearchCard.tsx`](../frontend/src/home/DiscoverySearchCard.tsx) | 发现条件卡：按 schema 渲染平台、地区、方向与阈值表单，条件改动即回传新 brief，改方向时同步关键词。 | brief、catalog、schema 全由父级传入：catalog 来自页面 Home 的 loadDiscoveryTemplate → GET /api/home/discovery/template（api-map 标注 optional，404 时回落内置模板），schema 来自 creator_discovery 的 input_schema。FALLBACK_FIELDS 上的 options_source 只是 api:/home/discovery/template#… 标记，SkillParamCard 不会据此发请求，缺选项时用 OVERSEAS_DISCOVERY_PLATFORMS 等内置常量渲染；本文件不调接口。 |
| FollowedBatchConfirm | [`frontend/src/home/FollowedBatchConfirm.tsx`](../frontend/src/home/FollowedBatchConfirm.tsx) | 批量进入阶段的 L3 确认弹窗：列出待确认对象与建议目标阶段，声明不发信，由用户确认或取消，支持 Esc 与焦点回收。 | 纯 props 驱动：open/cards/busy 与 onConfirm/onCancel 由 Home 传入（followedWorkspace.batchPending → confirmBatch/cancelBatch），确认后只打开既有单对象阶段确认，不直接发接口；本文件自身不调接口。 |
| FollowedBrief | [`frontend/src/home/FollowedBrief.tsx`](../frontend/src/home/FollowedBrief.tsx) | 跟进简报：按已拒绝、临近 14 天未联系、有意向三级优先级汇总在跟数量，给出先看哪一位与筛选入口。 | 纯 props 驱动：cards 由 Home 经 useFollowedWorkspace 传入（上游 GET /api/home/following ）。默认导出的简报组件目前没有任何页面渲染，实际被复用的是文件内的分类函数 followedBriefPriority / briefingForFollowed（FollowedPane、FollowedInteraction、useFollowedWorkspace、Home 只引这些）。 |
| FollowedInteraction | [`frontend/src/home/FollowedInteraction.tsx`](../frontend/src/home/FollowedInteraction.tsx) | 跟进对象交互左栏：呈现当前概览、合作生命周期分组计数与需要关注的情境入口，并作为插槽承载 Agent 交互区。 | 纯 props 驱动：cards/completeness/stageFilter/situation 由 Home 经 useFollowedWorkspace 传入（上游 GET /api/home/following ）；对 useFollowedWorkspace 只有 type-only import，本文件不发请求。 |
| FollowedPane | [`frontend/src/home/FollowedPane.tsx`](../frontend/src/home/FollowedPane.tsx) | 跟进名单列表面板：搜索、阶段与情境筛选、排序与只看未读，全选后可批量分析或进阶段，并渲染各类空态与恢复入口。 | 纯 props 驱动：可见卡片、空态文案与全部回调由页面 Home（路由 /）传入；跟进数据上游为 useFollowedWorkspace → kolSurfaceApi.loadHomeFollowing（端点 GET /api/home/following ，404/405 缺失时回退 board 适配数据）。本文件自身不调接口，只渲染并发事件。 |
| ObjectWorkspace | [`frontend/src/home/ObjectWorkspace.tsx`](../frontend/src/home/ObjectWorkspace.tsx) | 公海与我的红人共用的对象工作台组合层：中栏呈现选择态与提问引导，右栏承载对象结果与受控动作。 | 选择数量、结果计数、中栏交互与右栏内容均由页面 Home 传入（分别来自 usePoolWorkspace / useFollowedWorkspace），组件自身不取数。 |
| PlanSummary | [`frontend/src/home/PlanSummary.tsx`](../frontend/src/home/PlanSummary.tsx) | 计划简报摘要：展示 lead、首条非政策说明与未完成任务/异常统计，作为任务表头部信息使用。 | brief 对象由 ScopeWorkspace 经 props 传入（来源为 usePlanScope 的今日/待办简报），组件不渲染任何业务按钮。 |
| PoolInteraction | [`frontend/src/home/PoolInteraction.tsx`](../frontend/src/home/PoolInteraction.tsx) | 公海交互左栏：显示公海 KOL 总数与高潜、高风险、资料完整度分析入口，KOL 评分前展示确认条与模板缺失提示。 | 纯 props 驱动：totalCount、templates、scoreConfirm 与 onAnalyze/onConfirmScore/onCancelScore 由 Home 传入；分析入口委派父级预填 Agent 提问，KOL 评分上游为 kolSurfaceApi.assessPoolWithJev（ POST /api/home/pool/jev-assess ）。本文件不调接口。 |
| PoolPane | [`frontend/src/home/PoolPane.tsx`](../frontend/src/home/PoolPane.tsx) | 公海对象列表面板：搜索、未首次建联与 14 天未联系筛选、排序，行内领取/撤销跟进、评分徽章与红人库同步入口。 | 纯 props 驱动：cards、筛选/排序状态与领取、同步、撤销回调均由 Home（路由 /）传入，上游 usePoolWorkspace → kolSurfaceApi（ GET /api/home/pool 、POST /api/home/pool/sync 、POST /api/kols/${encodeURIComponent(kolUid)}/claim 、POST /api/follows/${encodeURIComponent(followId)}/release ）。本文件只渲染并发事件。 |
| ReleaseFollowConfirm | [`frontend/src/home/ReleaseFollowConfirm.tsx`](../frontend/src/home/ReleaseFollowConfirm.tsx) | L3 回公海确认弹窗：列明对象、释放范围与 B.active→released 变更及后果，用户确认后才释放跟进归属。 | 纯 props 驱动：handle/open/busy/error 与 onConfirm/onCancel 由 Home 传入（followedWorkspace.releaseTarget → confirmRelease）；释放上游为 kolSurfaceApi.releaseFollowedKol（ POST /api/follows/${encodeURIComponent(followId)}/release ）。本文件不调接口。 |
| ScopeWorkspace | [`frontend/src/home/ScopeWorkspace.tsx`](../frontend/src/home/ScopeWorkspace.tsx) | 今日任务与我的待办共用的工作区：把计划进度流、任务表与计划摘要组合进两栏外壳，并给出空态与去重提示。 | rows/brief/phase/events/previousBrief 等全部由页面 Home 经 usePlanScope 传入，组件自身不发请求；scope 只决定文案与存储键。 |
| StreamingLines | [`frontend/src/home/StreamingLines.tsx`](../frontend/src/home/StreamingLines.tsx) | 等待卡上的逐字流式文案：按行逐步显现并显示已等待秒数，读屏只播完整文案，减弱动效时直接出全文。 | 纯展示组件；文案 lines 与 seconds 由调用方传入（Home 的识别等待卡），不涉及接口。 |
| TaskBoard | [`frontend/src/home/TaskBoard.tsx`](../frontend/src/home/TaskBoard.tsx) | 今日与待办共用的任务表格：按优先级分档筛选、关键词搜索、折叠展开，并用表头按钮触发重新规划。 | 任务行数据由父级 ScopeWorkspace 经 rows 传入；表头的规划按钮不调接口，只派发 window 事件（planStartEvent），监听方在 Home 的 usePlanScope。 |
| TodayPlanProgress | [`frontend/src/home/TodayPlanProgress.tsx`](../frontend/src/home/TodayPlanProgress.tsx) | 渲染一轮规划的 Codex 过程：里程碑步骤、推理流、已用时与失败原因，并可折叠查看上一版计划。 | 事件轨迹与简报由 ScopeWorkspace 经 props 传入（来源是 usePlanScope 的轮询结果），组件只做展示、状态推导与本地计时，不直接调接口。 |
| NextActionBar | [`frontend/src/home/workspace/NextActionBar.tsx`](../frontend/src/home/workspace/NextActionBar.tsx) | 结果栏下一步区：列出建议并可采纳为待办；受控动作按权限、状态与 L2/L3 分级要求二次确认后执行。 | 推荐项与注册动作来自 ResultRail 传入的 result-contract 视图；采纳/执行只触发上层回调，组件本身不调接口。 |
| ResultRail | [`frontend/src/home/workspace/ResultRail.tsx`](../frontend/src/home/workspace/ResultRail.tsx) | 右栏结果协议渲染层：按视图模型展示来源/时间/新鲜度、结果值、记忆、历史、建议与注册动作。 | 视图模型与领域子内容由各模式（ScopeWorkspace/ObjectWorkspace/DiscoveryWorkspace）经 props 传入，组件不取数。 |
| ResultRendererRegistry | [`frontend/src/home/workspace/ResultRendererRegistry.tsx`](../frontend/src/home/workspace/ResultRendererRegistry.tsx) | 结果渲染器注册表：按 resultType 分发已注册渲染函数，缺失时回退为字符串、数组与对象的只读安全展示。 | 模块级 Map 注册表 + 一个默认取值分发的渲染组件；注册方（各结果类型模块）自行决定数据来源，本文件无接口调用。 |
| SkillParamCard | [`frontend/src/home/workspace/SkillParamCard.tsx`](../frontend/src/home/workspace/SkillParamCard.tsx) | 由 schema 驱动的参数表单：按字段类型渲染单选、多选、文本、数字等控件，供发现表单、澄清与只读汇总复用。 | 字段定义与取值由调用方传入；选项取自 optionSets prop 或字段自带 options，缺失时只提示选项不可用，组件不自行拉取。 |
| WorkspaceShell | [`frontend/src/home/WorkspaceShell.tsx`](../frontend/src/home/WorkspaceShell.tsx) | Home 两栏工作台的外壳：提供中栏唯一滚动容器、可折叠结果右栏、流式贴底跟随与回到底部按钮。 | 纯布局外壳，内容全部经 centerHeader/centerScroll/centerFooter/rail 插槽由父级传入，自身不取数。 |
| ConversationItem | [`frontend/src/mail/components/ConversationItem.tsx`](../frontend/src/mail/components/ConversationItem.tsx) | 邮箱树第二层：一个会话主题及其邮件数量，未建档时给出标签，点击展开或收起该会话。 | 纯 props 驱动：会话行 row、展开态、当前态与邮件数 mailCount 均由 pages/Mail.tsx 传入；邮件数在会话详情读出前保持空，不猜测。 |
| CorrespondentRow | [`frontend/src/mail/components/CorrespondentRow.tsx`](../frontend/src/mail/components/CorrespondentRow.tsx) | 邮箱树第一层：一个往来对象邮箱地址及其主题数量，点击只展开或收起，不移动阅读位置。 | 纯 props 驱动：分组 group（来自 mail/groups.ts 的本地聚合）与展开态由 pages/Mail.tsx 传入，本文件不取数。 |
| MailboxSwitcher | [`frontend/src/mail/components/MailboxSwitcher.tsx`](../frontend/src/mail/components/MailboxSwitcher.tsx) | 邮箱切换器：折叠态显示当前邮箱地址，展开后列出全部绑定邮箱与未读数，并提供收取入口。 | 纯 props 驱动：current/bindings/syncing/onSelect/onSync 均由 pages/Mail.tsx 传入（收取动作在上层最终走 mail/client.ts 的 syncMailboxMail），「添加邮箱／邮箱设置」只是跳 /settings?tab=starry 的链接。 |
| MailContent | [`frontend/src/mail/components/MailContent.tsx`](../frontend/src/mail/components/MailContent.tsx) | 通讯第三栏：渲染当前选中邮件的发件人、收件人、时间与正文，并区分收件与发件两种样式。 | 纯 props 驱动：message/peerName/peerEmail/ownerName/mailbox 由 pages/Mail.tsx 传入（邮件数据来自 mail/client.ts 的 mailConversation 等）；正文未缓存时提示点「收取」后重开，本文件不自行取数。 |
| MailDigestCard | [`frontend/src/mail/components/MailDigestCard.tsx`](../frontend/src/mail/components/MailDigestCard.tsx) | 往来摘要卡片：按摘要来源标注规则或模型，超长文本默认折叠，可展开查看完整摘要。 | 纯 props 驱动：digest（MailPersonDigest）由 pages/Mail.tsx 传入；标签与免责声明来自 mail/digestView.ts 的本地推导，生成失败或缺失时显示等待/失败提示，本文件不取数。 |
| MailFold | [`frontend/src/mail/components/MailFold.tsx`](../frontend/src/mail/components/MailFold.tsx) | 详情栏可折叠区块：标题按钮控制展开，折叠状态按块写入本地存储，正文始终挂载以保住契约。 | 无接口、无 props 取数：只读写 localStorage（mail:fold:*，另导出 readMailFolds/writeMailFold/MAIL_FOLD_KEYS），内容由父级 pages/Mail.tsx 作为 children 传入。 |
| MailTimelineItem | [`frontend/src/mail/components/MailTimelineItem.tsx`](../frontend/src/mail/components/MailTimelineItem.tsx) | 邮箱树第三层：一行邮件条目，展示主题、已读未读状态与收或发的时间戳，点击即选中该封邮件。 | 纯 props 驱动：message/selected/readState/onSelect 由 pages/Mail.tsx 传入，本文件只渲染一行并提供选中回调。 |
| PlainText | [`frontend/src/mail/components/PlainText.tsx`](../frontend/src/mail/components/PlainText.tsx) | 纯文本段落渲染器：解码 HTML 实体后按空行拆分段落，供邮件摘要与正文等记忆文本使用。 | 无接口：只把传入文本按空行分段渲染（避免引入 markdown 管线），数据由父级提供。 |
|  | [`frontend/src/main.tsx`](../frontend/src/main.tsx) | 浏览器入口：挂载 React 根节点与 BrowserRouter，并在懒加载资源失效时防抖硬刷新一次。 | 无导出组件、无接口：仅 createRoot 挂载 App、引入全局样式，并监听 vite:preloadError 做一次自愈刷新（20s 时间窗防循环）。 |
| AdminKnowledge | [`frontend/src/pages/AdminKnowledge.tsx`](../frontend/src/pages/AdminKnowledge.tsx) | 知识治理宿主：按路径解析待办、资产、资产详情、入库、绑定与反馈子视图，渲染子导航、标题口径与操作回执区。 | 该文件不直接取数：自身只解析路径、渲染子导航与 notice/error 回执，数据由 TodoView / AssetsView / AssetDetailView / IngestView / BindingsView / FeedbackView 六个子视图各自调用接口（子视图在 admin/knowledge/ 下有独立记录）。 |
| AgentApprover | [`frontend/src/pages/AgentApprover.tsx`](../frontend/src/pages/AgentApprover.tsx) | 审批岗位详情：展示审批岗使命与说明，内嵌待人处理的审批队列，并可按需让 KOL 说明某条审批的风险。 | 无接口调用：专家档案由 Agents 传入，内嵌的 Approvals 组件自行读取审批队列；本组件只渲染审批岗说明，并在「说明风险」时回调父级。另导出 approverRiskPrompt 文案函数，不发请求。 |
| AgentKol | [`frontend/src/pages/AgentKol.tsx`](../frontend/src/pages/AgentKol.tsx) | KOL 岗位详情：展示岗位使命、说明、可帮事项与示例提问，并提供「开始工作」按钮把该专家召唤进思考会话。 | 无接口调用：专家档案、busy/error 与 onSummon 回调均由 Agents 按 /agents/:id 传入（召唤实际经 experts.ts 的 summonExpert 发出），本组件只做详情渲染与「今天的工作」跳转。 |
| AgentTeams | [`frontend/src/pages/AgentTeams.tsx`](../frontend/src/pages/AgentTeams.tsx) | 旧 Teams 地址的重定向页：把 /teams 直接跳转到 /agents，不再把专家团当作独立的数字员工界面。 | 无接口：组件只返回 <Navigate to="/agents" replace />，不渲染任何界面、不取数。 |
| Partners | [`frontend/src/pages/Partners.tsx`](../frontend/src/pages/Partners.tsx) | 占位说明页：声明本页既不是首页的跟进红人板也不是技能目录，只提供回首页继续跟进红人的链接。 | 无任何接口调用、无 props、无取数：纯静态说明页，只渲染文案与指向首页 / 的 Link。 |
| ViewModeProvider | [`frontend/src/viewMode.tsx`](../frontend/src/viewMode.tsx) | 视图模式上下文：依据当前账号是否管理员推导 admin 标记，并持久化管理员的调试视图开关。 | 无接口：账号来自 components/AuthGate 的 useAccount() 上下文；debug 开关存 localStorage（ui:debug-view），并导出 useViewMode 与 isAdminAccount。 |

### 4.2 有接口但不直连（全部经 hook / 包装模块）

| 组件 | 文件 | 作用 | 接口（来源） |
|---|---|---|---|
| ConnectorHub | [`frontend/src/admin/connector/ConnectorHub.tsx`](../frontend/src/admin/connector/ConnectorHub.tsx) | 连接器枢纽：汇总受管连接器治理状态计数，提供搜索、浏览目录、新建 MCP 或 HTTP API 与查看工具清单的入口。 | `PUT （调用方传入的动态路径）`〔父传入 · onSave→adminSave〕 |
| AccountBar | [`frontend/src/components/AccountBar.tsx`](../frontend/src/components/AccountBar.tsx) | 账户块：显示头像、姓名与角色，提供员工端与管理端切换、个人设置入口以及退出登录按钮。 | `POST /api/logout`〔经 hook · useAccount.logout〕 |
| TeamRail | [`frontend/src/components/TeamRail.tsx`](../frontend/src/components/TeamRail.tsx) | 数字团队进度轨：按会话进度把团队各步骤标为已完成、当前或未开始，并链接到团队页。 | `GET /api/agent-manifest`〔经 hook · useAgentManifest〕 |
| DiscoveryWorkspace | [`frontend/src/home/DiscoveryWorkspace.tsx`](../frontend/src/home/DiscoveryWorkspace.tsx) | AI 发现工作台：中栏按条件卡与 Codex 过程流取数，右栏呈现本轮运行的线索结果、转化概览与入库确认入口。 | `GET /api/home/discovery/runs`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}/candidates`〔经包装模块 · useDiscovery.loadExisting〕<br>`GET /api/tasks/${encodeURIComponent(id)}/events`〔经包装模块 · useDiscovery.loadExisting〕<br>`POST /api/home/discovery/runs/${encodeURIComponent(runId)}/retry`〔经包装模块 · useDiscovery.retryRun〕<br>`GET /api/discovery/connection`〔经包装模块 · useDiscovery.checkCollector〕<br>`POST /api/home/discovery/ingest`〔经包装模块 · useDiscovery.confirmIngest〕 |

## 5. 附录：非组件的接口包装模块

以下 `.ts` 模块不是组件，但组件经它们取数，故列出以便对照（来源：`../artifacts/component-inventory/helper-map.json`）。

| 模块 | 它调用的接口 |
|---|---|
| `admin/connector/connectorSetup.ts` | `GET /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`<br>`POST /api/admin/connectors/${encodeURIComponent(connectorId)}/icon`<br>`POST /api/admin/runtime/credentials`<br>`PUT /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/config`<br>`PUT （调用方传入的动态路径）` |
| `admin/connector/useDeclaredToolMount.ts` | `GET /api/admin/runtime/skills/coverage?connector_id=${connectorId}`<br>`POST /api/admin/runtime/connectors/${encodeURIComponent(connectorId)}/mount-declared` |
| `agentWork.ts` | `POST /api/collaborations/${encodeURIComponent(collaborationId)}/session`<br>`POST /api/sessions`<br>`POST /api/tasks/${encodeURIComponent(id)}/run` |
| `experts.ts` | `GET /api/experts`<br>`GET /api/experts/${encodeURIComponent(id)}`<br>`POST /api/experts/${encodeURIComponent(id)}/summon`<br>`POST /api/sessions` |
| `home/discovery.ts` | `GET /api/discovery/requests`<br>`GET /api/discovery/requests/${encodeURIComponent(id)}`<br>`GET /api/discovery/requests/${encodeURIComponent(id)}/results`<br>`GET /api/discovery/runs/${encodeURIComponent(runId)}`<br>`POST /api/discovery/candidates/${encodeURIComponent(id)}/dismiss`<br>`POST /api/discovery/candidates/${encodeURIComponent(id)}/follow`<br>`POST /api/discovery/candidates/follow-batch`<br>`POST /api/discovery/connection`<br>`POST /api/discovery/requests`<br>`POST /api/discovery/requests/${encodeURIComponent(requestId)}/runs` |
| `home/discoveryHome.ts` | `GET /api/discovery/connection`<br>`GET /api/home/discovery/runs`<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}`<br>`GET /api/home/discovery/runs/${encodeURIComponent(runId)}/candidates`<br>`GET /api/home/discovery/template`<br>`GET /api/tasks/${encodeURIComponent(id)}/events`<br>`POST /api/home/discovery/ingest`<br>`POST /api/home/discovery/run`<br>`POST /api/home/discovery/runs/${encodeURIComponent(runId)}/retry` |
| `home/kolSurfaceApi.ts` | `GET /api/home/following`<br>`GET /api/home/pool`<br>`GET /api/home/pool/avatar-enrich`<br>`GET /api/home/pool/cleanup-preview`<br>`GET /api/home/pool/jev-assess`<br>`GET /api/home/pool/sync`<br>`POST /api/follows/${encodeURIComponent(followId)}/release`<br>`POST /api/home/kol-analyze/enqueue`<br>`POST /api/home/pool/avatar-enrich`<br>`POST /api/home/pool/cleanup-missing-homepage`<br>`POST /api/home/pool/jev-assess`<br>`POST /api/home/pool/sync`<br>`POST /api/kols/${encodeURIComponent(kolUid)}/claim` |
| `home/useFollowedWorkspace.ts` | `POST /api/collaborations/${encodeURIComponent(collaborationId)}/session` |
| `hooks/useAgentManifest.ts` | `GET /api/agent-manifest` |
| `hooks/useConfirmedDraftSend.ts` | `GET /api/drafts/${encodeURIComponent(id)}/actions`<br>`POST /api/drafts/${id}/send` |
| `hooks/useMailComposeFlow.ts` | `POST /api/email-compose/prepare` |
| `hooks/useRunStatus.ts` | `GET /api/tasks/${encodeURIComponent(id)}/events`<br>`GET /api/tasks/by-session/${encodeURIComponent(sessionId)}` |
| `mail/client.ts` | `GET /api/home/board?refresh=1`<br>`GET /api/mail/box?box=${encodeURIComponent(box)}`<br>`GET /api/mail/conversations/${encodeURIComponent(id)}`<br>`GET /api/mail/conversations?box=${encodeURIComponent(box)}`<br>`GET /api/mail/person?box=${encodeURIComponent(box)}&p=${encodeURIComponent(p)}`<br>`GET /api/me/starry-binding`<br>`POST /api/mail/sync` |

## 6. 已知边界

- 仅做静态阅读与调用点比对：不运行前端、不发真实请求，因此「接口存在与否」以后端路由与 `api.ts` 为证，不代表该接口当前返回正确。
- `api.ts` 中路径为模板拼接或由调用方传入（如 `adminSave(path, body)`）的，按模板记录，不展开为具体实例；具体实例见对应记录备注。
- `optional: true` 的可选接口（404/405 被静默忽略）与 `.catch(() => [])` 静默降级已在记录备注中标注。
- 少数文件不是界面组件（`App.tsx` 路由注册表、`main.tsx` 入口、`viewMode.tsx` Provider、`ResultRendererRegistry.tsx` 注册表），已在「组件」列与作用里如实标注。
- `frontend/src/api.ts` 之外还有少量原生 `fetch`/`EventSource`/下载直链，已在接口列标 `（api.ts 未封装）`；它们在 `api.ts` 的方法表里查不到，属真实存在的旁路。
- 未提交改动：本清单基线为工作区内容（提交 `2af2f79b` 之后仍有 83 个路径被修改），下一步提交后需要以同样方法重扫才能反映新状态。
