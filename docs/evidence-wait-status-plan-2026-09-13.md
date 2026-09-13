# 等待中任务状态：只读审查与落地方案（2026-09-13）

## 一行结论

`FE-only 可做`（总结论不变；Agents「运行中 / 最近」壳与失败列表可用现有 session / task API 拼，不单独改成需后端。仅当要会话级 `last_error`、崩溃后仍可信的 running、或专用 retry-last-turn 时，才需后端，且只影响 Agents 投影。）

本审查只读、无代码改动、无 LIVE 副作用。目标：判断当前 API 与前端是否已足以**真实反馈「等待中」任务状态**；并审查员工「我的智能体」页能否支撑「运行中 / 最近 / 失败重试」。给出 FE-only 最小方案，以及仅当产品要做重试协议 / 接管 / 卡死回收 / 会话级失败投影时的最小后端方案（不实施）。

**事实 vs 建议：** 带「事实」的段落只陈述仓库现状；带「建议」的段落是未实施的落地选项。

---

## 总判（事实）

当前实现**不足以**把员工看到的「等待中」当成真实等待态。

- `work_items.status = waiting` 在成功 run / 采集结束后表示**结果待确认**，不是排队未开始。
- Home 把 `waiting` / `queued` 都标成「等待中」；Chat 把同一 `waiting` 标成「待确认」。
- `recognizing` 只是 Home 本地 `busy`，不是持久状态。
- `GET /api/home/board` 裁掉 `started_at` / `updated_at` / 耗时；Home 只读 board，不读更完整的 `GET /api/tasks`。
- Home 无 interval 刷新；会话有 SSE，采集有轮询。
- 无通用重试资源、无接管 API、无工作项/采集 Job 卡死回收。

规格 `UX-STATE-VISIBLE` / `F-UX-STATE` / e2e `waiting-and-failure-states` 已写在文档里，对应测试**不存在**。

**建议：** 「真实反馈等待中」可用现有 `GET /api/tasks` + 文案重映射 + 短轮询在前端落地；不要为展示单独改状态机。次数/冷却/接管/卡死扫描仍要后端，但不阻塞本次展示目标。

---

## 覆盖矩阵

| # | 能力 | 判定 | 事实摘要 |
|---|---|---|---|
| 1 | 进行中 / 排队 / recognizing 建模与展示 | **部分** | 至少四套状态机，同词不同义；`recognizing` 仅前端本地 |
| 2 | 开始时间 / 已耗时 / 最近进展 / 心跳 | **部分** | 采集 Job 较完整；工作项有字段但 Home 不展示、也不算耗时 |
| 3 | 失败：真实错误 / 失败时间 / 可操作信息 | **部分** | 会话 `error_card` 较好；Home 把失败标成「有风险」；成功失败事件常是英文 |
| 4 | 重试：API / 幂等 / 次数 / 冷却 / 权限 / UI | **部分** | 无 `POST /tasks/:id/retry`；可再调 `/run`；采集重试上传仅管理员 |
| 5 | 接管 / 人工处理：API / 权限 / 审计 / UI | **缺失** | 无 takeover 路由；`MANUAL_INTERVENE` 只是文案启发式 |
| 6 | 轮询 / SSE / 刷新 | **部分** | 会话 SSE + 采集 1s 轮询；Home 几乎不刷新；Chat 对成功后的 `waiting` 仍 1s 打任务接口 |
| 7 | 卡死 / 超时检测 | **部分** | Worker / 识别有单次超时；工作项与采集 Job 无卡死回收 |
| 8 | Agents「运行中 / 最近 / 失败重试」 | **部分** | `GET /api/sessions` 已有 `agent_status`；Agents 页未用。失败不是 session 状态，须拼 `GET /api/tasks?status=failed` |

---

## 1) 进行中 / 排队 / recognizing

### 事实：至少四套状态，没有统一「等待中」

**工作项 `work_items.status`**（`backend/src/routers/tasks.ts` `STATUSES`）：

`needs_clarification | pending | running | waiting | completed | failed | cancelled`

- `POST /api/tasks/:id/run` 写入 `pending`，事件 `run.pending` / 「任务已加入队列」。
- 会话真正开跑时 `startBoundTask`（`backend/src/host/api.ts`）把 run + work item 标 `running`，并写 `started_at`。
- **成功结束不是 `completed`，而是 `waiting`**（`finishBoundTask`：`taskStatus = failed ? "failed" : "waiting"`）。契约测试 `backend/tests/tasks-runtime.test.ts` 断言 run 成功后 `detail.body.status === "waiting"`。
- 采集完成后同样把 work item 打成 `waiting`（`backend/src/crawl/service.ts` `completeJob` / `stopCrawl`）。
- `queued`、`in_progress`、`recognizing` **不在** 工作项合法枚举里。

**采集 Job `crawl_jobs.status`：** `queued → crawling/uploading/analyzing → result_ready | error | stopped`（另有 starting/running/stopping）。此处的 `queued` 是真排队。

**会话 `agent_status`**（`sessionStatus`）：`listening | running | waiting_approval`。  
内存队列 `backend/src/host/run-control.ts` `queues`：同会话第二条 ask 进 `run_queue`，`DELETE /api/sessions/:sid/queue/:qid`。测试：`backend/tests/run-queue.test.ts`。

**recognizing：** 不是持久状态。Home 在 `busy && !feedback` 时渲染 `data-kind="recognizing"`（`frontend/src/pages/Home.tsx`）。后端 `POST /api/tasks/recognize`、`/from-text` 同步返回。超时 `TASK_RECOGNIZE_TIMEOUT` 默认 12s（`backend/src/config.ts` `taskRecognizeTimeout`）。

**展示不一致（事实）：**

| 源状态 | Home `statusLabel` | Home 待办桶 | Chat `agentTaskUxStatus` |
|---|---|---|---|
| `waiting` | 等待中 | 等待中 | **待确认** (`PENDING_APPROVE`) |
| `queued` | 等待中 | 等待中 | **进行中** (`RUNNING`) |
| `pending` | 待处理 | 后续（无 due） | 待确认 |
| `running` / `in_progress` | 进行中 | 后续 | 进行中 |
| `failed` | **有风险** | 不进等待桶 | 失败 / 需介入 |

种子 `tsk_home_laozhang_quote` 的 `waiting` 本意是「金额待确认发送」（`backend/src/seed-fixtures.ts`），Home 却把它算进「等待中」计数（`backend/src/host/home-board.ts` `buildWorkbench`；`backend/tests/home-workbench.test.ts` 期望 `waiting: 1`）。

### 建议

员工文案拆成「识别中 / 已入队 / 执行中 / 结果待确认 / 等审批」，不要再用一个「等待中」覆盖 `work_items.waiting`。

---

## 2) 开始时间、已耗时、最近进展、心跳

### 工作项（事实）

- 表有 `started_at`、`updated_at`、`completed_at`、`task_events.time`（`backend/src/db.ts`）。
- `GET /api/tasks` / `GET /api/tasks/:id` 经 `publicWorkItem` 原样带出这些字段，并附 `history` / `history_summary`。
- **`GET /api/home/board` 主动丢掉 `started_at` / `updated_at` / `created_at` / `completed_at`**，只留 `history` / `history_summary`（`buildHomeBoard` 任务映射）。Home 只读 `api.homeBoard()`，不读 `/api/tasks`。
- Home 行只展示 `history_summary` / `due_at` / 合作摘要，**没有开始时间、已耗时、心跳**。
- 后端**从不计算** `elapsed_seconds`。前端类型里有该字段（`frontend/src/api.ts`），仅采集 UI 使用。

### 采集（事实，相对完整）

- `started_at`、`last_checked_at`、`updated_at`、`completed_at`。
- 监控循环 `MEDIACRAWLER_POLL_INTERVAL_MS`（默认 2s）写 `last_checked_at`（`monitorCrawlJob`）。
- `CrawlArtifact` 用 `elapsed_seconds` 或 `started_at`/`created_at` 算「已用时」，并展示「最近检查」和最近 5 条事件。
- Chat 中间条默认**不**显示耗时；`last_checked_at` 包在 `debug` 的 `<details>` 里。

### 会话执行（事实）

- SSE 推 `job_status` / `process_trace` / `operation_trace`（`runInBackground` + `backend/src/worker/progress.ts`）。
- `RunHud` 有「执行中」+ phase，**无时钟**。
- 测试：`backend/tests/worker-progress.test.ts`、`frontend/e2e/workbench.spec.ts`「process trace shows harness thinking…」。

### 建议

Home 至少展示 `history[-1].time` + `history_summary`；`running` 再用 `started_at` 做客户端已耗时。不必先等后端算 `elapsed_seconds`。数据已在 `GET /api/tasks`。

---

## 3) 失败：真实错误、失败时间、可操作信息

### 事实：会话层可用，看板层不够

- `task_runs.error` 存 JSON；`GET /api/tasks/:id` 返回 `runs[].error`。Home / 列表**不读**这条。
- `finishBoundTask` 失败事件：`label: "Task failed"`，`safe_summary: "Task execution failed; inspect the linked error artifact."`（英文、不可操作）。
- Worker 失败会落持久 `error_card`（`code` / `message` / `next_action`）。`ChatBlocks` 渲染「下一步」。`CodexUnavailable` 带 `next_action`（`backend/src/worker/errors.ts`）。
- 采集：`crawl_jobs.error` / `upload_error` 经 `sanitize`；`failJob` 写 `completed_at`。Chat 中间条与 `CrawlArtifact` 展示异常。
- Home 把 `failed` 标成「有风险」；种子失败摘要是业务说明（「样品丢失争议…」），不是执行错误。
- 识别失败可 fail-open：「识别服务未就绪」+ `next_action`（`backend/tests/task-recognize.test.ts`）；Home 有「再试一次」。

### 建议

Home 失败行应显示最后事件时间 + `safe_summary` / `error_card.next_action`，不要用「有风险」代替失败。可先 `GET /api/tasks/:id` 读 `runs[-1].error`。

---

## 4) 重试

### 事实：没有通用 `POST /tasks/:id/retry`

| 机制 | 幂等 | 次数 / 冷却 | 权限 | UI |
|---|---|---|---|---|
| 再调 `POST /api/tasks/:id/run` | 每次新 `run_id`；`running/completed/cancelled` 会 409 | 无 | 所有者或 admin + `requireSkill` | Chat **无**重试按钮；Home 打开无 session 的任务会再 run |
| 采集 `Idempotency-Key` | 同 key 返回 `duplicate: true` | 全局同时只允许 1 个 active crawl（409） | `requireConnector("claw","write")` | 启动表单 |
| `POST /api/admin/crawl-jobs/:id/retry-upload` | 无次数/冷却 | 无 | **admin** | `CrawlArtifact`「重试上传」仅 `crawlAdmin` |
| 识别「再试一次」 | 再打 `/from-text` | 无 | 登录用户 | 仅识别服务未就绪 |
| 会话队列 `removeQueued` | 内存，非持久 | 无 | 会话访问 | Composer 移出队列 |

失败 run 允许再 `run`（`startBoundTask` 接受 `pending|failed`）。这是隐式重跑，不是带预算的重试协议。

### 建议

UI 可先把「重试」接到现有 `/run`。产品级次数 / 冷却 / 幂等键必须后端补，**不阻塞「等待中」展示**。

---

## 5) 可接管 / 人工处理

### 事实：不存在 takeover API

已搜无 `takeover` / `manual_takeover` / `intervene` 路由。

相近但不是接管：

- `POST /complete`：人工标完成（Chat「标记完成」）。
- `POST /promote` / `/dismiss`：AI 发现进待办 / 忽略，带 `task.promoted` / `task.dismissed` 审计。
- `waiting_approval`：审批箱 + 杀 box（`markWaitingApproval`）；`RunHud`「等你确认」。这是审批，不是任务接管。
- `frontend/src/agentUx.ts`：`failed` 且 `risk/next_action` 匹配 `/人工|接管|介入|retry|重试/` 才显示「需介入」。无按钮、无权限、无审计。

规格要求 `manual_takeover`（`specs/UX-KOL.md`、`docs/03-prd-and-functional-spec.md`）。`docs/15-conformance-gaps.md` 也写了前后端状态契约未统一。

### 建议

无 API 就不要画「接管」按钮。接管不能 FE-only。

---

## 6) 轮询 / SSE / 刷新

### 事实

| 面 | 机制 | 缺口 |
|---|---|---|
| Home | 首屏 `GET /api/home/board`；`visibilitychange` 强制 refresh；邮件按钮手动 refresh | **无 interval**；切走再回来才更新「等待中」 |
| Chat 工作项 | `status ∈ pending\|running\|waiting\|queued` 时 **1s** `GET /tasks/:id` + events | 成功后的 `waiting`（结果待看）也会一直轮询 |
| 采集 | 活跃态 1s；404 最多再试 10 次 | 无 SSE |
| 会话 | `EventSource /api/sessions/:sid/events`：snapshot / upsert / status / journey / queue；15s ping | 不推 work item 状态 |
| `useRunStatus` | `agentStatus==="running"` 时 2s | Home 不用 |
| AgentTaskList | 下拉刷新 `GET /api/tasks` | 无自动轮询 |
| 采集后端 | `scheduleMonitor` 默认 2s；进程重启 `restoreActiveCrawlJobs` | 监控失败只记 `monitor_error`，不 fail job |

无 WebSocket。

E2E：采集中条 `data-crawl-middle-status`（`frontend/e2e/workbench.spec.ts`）。**没有**名为 `waiting-and-failure-states` 的测试（`specs/ux-traceability.json` 已引用）。`docs/16-production-test-plan.md` 的 `F-UX-STATE` 同样未落地为具名测试。

---

## 7) 卡死 / 超时

### 有（单次调用超时，事实）

- `HOST_WORKER_TIMEOUT` / `CODEX_TURN_TIMEOUT` 默认 120s（`CodexAppServer` deadline；注释写过 home 卡在 recognizing）。
- `TASK_RECOGNIZE_TIMEOUT` 12s；`MAIL_ANALYSIS_TIMEOUT` 45s。
- MCP 调用 `MEDIACRAWLER_MCP_TIMEOUT_MS` 默认 30s。
- 邮件摘要 pending：Chat 2s 轮询，**45s 后停**（不再判失败）。
- 识别失败开放：超时 / 无 Codex → 澄清文案，不写 work item。

### 无（任务级卡死回收，事实）

- 无 job 扫描 `running` / `queued` 超过阈值则 fail。
- 采集：`last_checked_at` 只是心跳；远程一直 active 会无限 `scheduleMonitor`。
- work item 可停在 `pending`（run 已建、会话未发）或 `running`（进程死掉且未 restore）。
- Home recognizing：`busy=true` 直到 `/from-text` 返回，**无前端超时条**。

测试：`backend/tests/async-worker.test.ts` 把 `HOST_WORKER_TIMEOUT=2` 用于异步完成，不是卡死回收套件。

---

## 关键符号 / 路由 / 组件 / 测试

### API

- `GET/POST /api/tasks`、`POST /api/tasks/recognize`、`POST /api/tasks/from-text`
- `GET /api/tasks/:id`、`GET /api/tasks/:id/events`、`GET /api/tasks/by-session/:sid`
- `POST /api/tasks/:id/run|promote|dismiss|complete`
- `GET /api/home/board`
- `GET /api/sessions/:sid/events`（SSE）
- `DELETE /api/sessions/:sid/queue/:qid`
- `POST /api/tasks/:id/actions/start-crawl|stop-crawl`
- `GET /api/tasks/:id/crawl-job`、`.../events`
- `POST /api/admin/crawl-jobs/:id/retry-upload`

### 符号

- `STATUSES`、`appendTaskEvent`、`finishBoundTask`、`startBoundTask`、`sessionStatus`
- `buildWorkbench`、`historySummary`、`statusText`
- `monitorCrawlJob`、`last_checked_at`、`restoreActiveCrawlJobs`
- `agentTaskUxStatus`、`CRAWL_PROGRESS`、`useSessionMessages`

### 前端

- `frontend/src/pages/Home.tsx`（recognizing、等待中桶）
- `frontend/src/pages/Chat.tsx`（1s 轮询、采集中条、标记完成）
- `frontend/src/components/{RunHud,CrawlArtifact,ChatBlocks,AgentTaskList,ComposerDock}.tsx`
- `frontend/src/{agentUx,hooks/useRunStatus,api}.ts`

### 测试 / 规格缺口

- 有：`backend/tests/tasks-runtime.test.ts`、`home-workbench.test.ts`、`mediacrawler.test.ts`、`run-queue.test.ts`、`worker-progress.test.ts`、`task-recognize.test.ts`、crawl e2e
- 无：`F-UX-STATE`、`waiting-and-failure-states`（仅 `specs/ux-traceability.json`、`docs/16-production-test-plan.md` 点名）

---

## FE-only 最小方案（建议，不实施）

不改后端也能把「等待中」说清楚，因为 `GET /api/tasks` 已有 `started_at`、`updated_at`、`history[]`。

1. **改文案映射，不要改库。**
   - 识别中：现有 `data-kind="recognizing"`，加已等待秒数；超过 ~12s 显示「识别超时，可再试」。
   - `pending`：已入队，等待开始。
   - `running`：进行中。
   - `waiting`：结果待确认（与 Chat `PENDING_APPROVE` 对齐），**不要叫等待中**。
   - 采集 `queued`：远程采集已排队（只用 `CRAWL_PROGRESS`）。
2. **Home 待办：** 打开或刷新时用 `GET /api/tasks`（或与 board 合并）。等待 / 进行中行展示：状态、最后事件时间、`history_summary`；`running` 用 `started_at` 做客户端已耗时。
3. **刷新：** Home 在 `pending|running` 时 3–5s 拉一次 `/api/tasks` 或 board；`waiting`（待确认）不必 1s 打。Chat 应对成功后的 `waiting` **停**任务轮询。
4. **失败行：** 徽章改为「失败」；展开 `history` 最后一条 + `GET /tasks/:id` 的 `runs[-1].error.message`。按钮：「打开会话」；若 `status∈{failed,waiting,pending}` 再调现有 `runTask` 作为重试。
5. **不要做假接管按钮。** 无 API 就不要画「接管」。

这只能改善展示，不能提供次数 / 冷却 / 接管 / 卡死回收。

---

## 若需后端：最小方案（建议，不实施）

仅当产品要把重试协议、接管或卡死回收纳入「等待中」范围时才需要。展示本身不必先做这些。

1. **`phase`（或稳定 `display_status`）** 与原始 `status` 并存：  
   `recognizing`（可选） / `queued`（pending run） / `running` / `awaiting_review`（今日的 `waiting`） / `awaiting_approval` / `failed` / `completed`。  
   Home / Chat 只渲染 `phase`。
2. **`GET /api/home/board` 与 `GET /api/tasks` 对齐：** `started_at`、`updated_at`、`completed_at`、`last_event_at`、`last_event_summary`、`elapsed_seconds`（由 `started_at` 计算）、`heartbeat_at`（工作项用最后 `task_events.time`，采集用 `last_checked_at`）。
3. **失败事件中文化**，带 `next_action`；`GET /api/tasks` 列表带 `last_error`，避免 Home 再打详情。
4. **重试（仅当产品要约束时）：** `POST /api/tasks/:id/retry`，内部走现有 run；`Idempotency-Key`；`attempt_count`；冷却；权限复用 `ownedWorkItem` + `requireSkill`；审计 `task.retry`。
5. **接管（仅当产品要人工占有时）：** `POST /api/tasks/:id/takeover` → `manual_takeover` + `taken_over_by/at` + 审计；UI 再接线。
6. **卡死扫描：** `running` 且 `heartbeat_at` 超过 `HOST_WORKER_TIMEOUT`（或独立阈值）→ `failed` + `code: stuck_timeout`；采集 `last_checked_at` 过旧同理。进程重启已有 `restoreActiveCrawlJobs`，扫描是补「远程永不结束」。

---

## 事实 vs 建议（对照）

| 事实 | 建议 |
|---|---|
| 成功 run 后工作项是 `waiting`（结果待看），Home 却显示「等待中」 | 把 `waiting` 展示为「结果待确认」 |
| Home board 不返回 `started_at` / 耗时；`GET /api/tasks` 有 | 前端改读 `/api/tasks`，或以后再让 board 补字段 |
| recognizing 只是 Home `busy` | 加本地耗时 / 超时文案即可，不必先落库 |
| 无 retry / takeover 资源 | 重试可先复用 `/run`；接管必须先有 API |
| 会话 SSE + 采集轮询存在；Home 无轮询 | Home 只对 `pending/running` 短轮询 |
| Worker 有 turn 超时；Job / 工作项无卡死回收 | 用已有 heartbeat 字段做扫描（后端，非本次必须） |
| `UX-STATE-VISIBLE` 的 e2e 名未实现 | 落地后补 `waiting-and-failure-states` |
| Agents 页不读会话；侧栏已有进行中 / 最近 | Agents 复用 `GET /api/sessions` + `GET /api/tasks?status=failed` |
| `agent_status` 无 failed；失败在 message / work_item | 失败列表用 tasks，不要从 session 状态猜 |

---

## Agents / 我的智能体：运行中 · 最近 · 失败重试

范围：员工 `/agents`（「我的智能体」）是否已能撑起「运行中」壳，以及「最近」「失败重试」的现有能力与缺口。只读；不实施。

### 覆盖结论（事实）

| 能力 | 判定 | 一句话 |
|---|---|---|
| 运行中壳 | **部分 / FE-only 可拼** | `GET /api/sessions` 每行已算 `agent_status`；Agents 页不读、不展示。侧栏「进行中」已用同一接口 |
| 最近 | **部分 / FE-only 可拼** | 同接口按 `updated_at DESC`；侧栏 `data-recents` 取前 24 条。Agents 页没有 |
| 失败重试 | **部分** | session **没有** `failed` 态；失败在 `error_card` / `work_items.status=failed`。可拼 `GET /api/tasks?status=failed` + 现有 `POST /run`。无会话级 retry-last-turn |

**建议：** Agents「运行中 / 最近」不必等后端。失败列表用任务 API 拼即可；不要在 `agent_status` 上发明 `failed`。

### 证据路径

**Agents 页本身（事实）：**

- 路由：`frontend/src/App.tsx` `/agents` → `frontend/src/pages/Agents.tsx`。
- 标题「我的智能体」。加载 `api.profiles()` / `api.skills()` / `api.connectors()` / `useAgentManifest()`。
- **不调用** `api.sessions()`，无运行中 / 最近 / 失败分区。
- 动作只有 `startSkill`：`POST /api/sessions` + `storePending` + `nav(/s/:id)`。
- 团队页 `frontend/src/pages/AgentTeams.tsx` 同样只创建会话，不列运行态。
- E2E：`frontend/e2e/workbench.spec.ts` 只断言 heading「我的智能体」可见（约 1189 行），无运行中壳。

**会话 / `agent_status` API（事实）：**

- `GET /api/sessions`（`backend/src/host/api.ts`）：当前用户未删除、默认未归档会话，`ORDER BY updated_at DESC`；每行 `d.agent_status = sessionStatus(id)`。
- `GET /api/sessions/:sid`、SSE `GET /api/sessions/:sid/events` 同样带 `agent_status`。
- `sessionStatus`：内存 `isSessionRunning` → `running`；否则看最新 `workers.status`（`waiting_approval` / `running`）或最新 `drafts.status === waiting_approval`；否则 `listening`。
- 合法值只有 `listening | running | waiting_approval`（`frontend/src/api.ts` `SessionRow`）。**没有 failed / queued / recognizing。**
- 列表是整行 `sessions` 投影 + `agent_status`：有 `id` / `title` / `created_at` / `updated_at` / `collaboration_id` / `archived_at` 等。前端类型只声明了部分字段，运行时 JSON 仍带 `updated_at`。
- **没有** `last_error`、`last_skill`、`last_intent`、`started_at`、`elapsed_seconds`、失败标志。
- **没有** `?status=running` 过滤；客户端自滤。
- 无全局 session 列表 SSE；单会话 SSE 不能驱动 Agents 页全表。
- 测试：`backend/tests/async-worker.test.ts`、`run-queue.test.ts`、`session-events.test.ts`、`codex.test.ts` 覆盖单会话 `agent_status`；`host-contracts.test.ts` 有 `GET /api/sessions` 列表。侧栏 E2E：`sidebar 进行中 highlights only when viewing a running session`（mock `agent_status: "running"`）。

**侧栏已有壳（事实，不在 Agents 页）：**

- `frontend/src/layout/Workbench.tsx`：`api.sessions()` 在 `loc.pathname` 变化时重拉（**无 interval**）。
- 「进行中」`data-nav="running"`：`runningCount`、`firstRunning`，链到第一条 `agent_status==="running"` 的 `/s/:id`，否则 `/`。徽章是计数，不是列表。
- 「最近」`data-recents`：`sessions.slice(0, 24)` + 标题筛选；`status-dot` 用 `agent_status`。菜单：重命名 / 导出 / 归档 / 删除。无失败重试。
- 「等我确认」混了 `waiting_approval` 会话与审批 inbox，不是 Agents 失败列表。

**失败与重试（事实）：**

- run 结束后 `agent_status` 回到 `listening`（`afterRun` → `sessionStatus`），**失败不会把 session 标 failed**。
- 失败落在会话 `error_card`（须 `GET /sessions/:sid` 带 messages）或 `work_items.status=failed`（`GET /api/tasks?status=failed` 已支持）。
- `GET /api/tasks` 含 `session_id`，可回链会话。
- 无 `POST /sessions/:sid/retry`。可重开会话再提交，或对失败 work item 再 `POST /api/tasks/:id/run`（`startBoundTask` 接受 `pending|failed` run）。
- 进程重启后内存 `running` Set 清空（`run-control.ts` `onConnReset`）；若 `workers.status` 仍为 `running` 则列表仍显示 running，否则会漏。

### FE-only 是否可做（建议，不实施）

**可以。** 不改后端也能在 `/agents` 做出可用壳：

1. **运行中：** `GET /api/sessions`，滤 `agent_status === "running"`（可选再列 `waiting_approval`）。展示 title、`updated_at`、点进 `/s/:id`。页在前台时 3–5s 重拉（侧栏现无 interval）。不要为列表开 N 条 EventSource。
2. **最近：** 同一列表按 `updated_at` 取前 N 条；复用侧栏 `status-dot` 语义。可显示 `collaboration_id` 若行上有。
3. **失败重试：** 另拉 `GET /api/tasks?status=failed`（或列表后再滤）。行：title、`history_summary`、`updated_at`。有 `session_id` 则「打开会话」；再调现有 `runTask` 作为重试。不要对 `listening` 会话猜失败（须扫 messages，不适合列表）。
4. **不要**在 Agents 上画接管、次数/冷却重试、或假 `failed` session 状态。

缺口（FE 无法独自补齐，但不阻塞壳）：列表无 last_error / last_skill / 已耗时；running 在进程重启后可能不准；失败与「智能体入口」无直接绑定（任务有 `skill`，session 没有）。

### 若需后端：最小改动（建议，不实施；仅 Agents 投影）

只在产品要求「会话列表自带失败 / 技能 / 可信 running」时做。不必先改 Home 等待中方案。

1. **`GET /api/sessions` 可选投影（最小）：** `last_skill`（最近 user message 的 `intent` 或绑定 `work_items.task_type`）、`last_outcome`（`ok | failed | listening`，由最近 `error_card` / `job_status` / 绑定 task 推导）、`last_error`（safe，截断）、`running_since`（若 running，取最新 worker / 内存开始时间）。允许 `?agent_status=running`。
2. **不要**把 `failed` 写进 `sessionStatus` 三态，以免冲掉 `listening` 后的可继续会话。失败用投影字段。
3. **进程重启：** `restoreActiveCrawlJobs` 之外，对 `workers.status=running` 且无活进程的会话标 failed 或清成 listening，避免幽灵「运行中」。
4. **仅当要「重试上一轮」而非重跑 work item：** `POST /api/sessions/:sid/retry-last`（复用最后一条 user ask + intent；审计 `session.retry`）。有 work item 时内部走现有 `/run`。次数/冷却与任务重试同一套再做。

以上均未实施。
