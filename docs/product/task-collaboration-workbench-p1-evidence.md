# P1 发现任务连续协作：实施与验收记录

| 项目 | 内容 |
|---|---|
| 日期 / 基线 | 2026-10-04 / `248764c` 工作区增量 |
| 关联设计 | [产品设计](task-collaboration-workbench-prd.md)、[Phase 计划](task-collaboration-workbench-phases.md) §3 |
| 状态 | `in_progress`；入口与候选链路已于 main `19c78a1` 发布，质量与异常验收未齐；新增订阅数来源验收见[质量记录](task-collaboration-workbench-p1-quality.md) |
| 当前边界 | 新 AI发现任务；保存条件、同版本技能模板、任务会话、受控采集、任务级候选读取与恢复 |
| 后续阶段 | 邮件、审批、工单、阶段期限、归属和工作规划仍按 P2–P5 推进 |

## 1. 审宪与审法

| 需求 | 主责角色 | 宪法条款 | 基本法 / 实施细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 保存发现现场，返回同一工作 | 平台产品 / 智能体产品 / 前端 / 后端 | CONST-03/04/07 | PROD-AGENT-08、TECH-ARCH-04、TECH-FE-03 | 符合；沿用 Task/run/session，保存结构化条件与模板快照；UI 不另造业务阶段 | 完成真实入口验收 |
| 技能参数、工具范围和确认一致 | 智能体产品 / 后端 | CONST-02/03/05 | TECH-BE-01/02/07、07-mcp-data-contract 工具风险目录 | 符合；运行时保留远端原始 schema 审核指纹，另收窄模型可见及可调用参数；已核对线上 schema 与实现 | 真实 harness 核验提案与确认范围 |
| 单任务采集与持久恢复 | 后端 / 测试 | CONST-03/05/10 | TECH-BE-03/04、TECH-TEST-02 | 符合；采集预留与监控入队同事务，终态与候选读取入队同事务；沿用统一执行队列 | 真实断线、取消与对账演练 |
| 本任务候选及来源可复核 | KOL 业务 / 后端 / 前端 | CONST-05/06 | TECH-BE-01/08、TECH-TEST-03 | 符合；无任务隔离能力不暴露结果工具、不读取全局候选；缺失指标保留未知 | 取得真实候选数据及字段映射证据 |
| 准确报告完成状态 | 项目经理 / 测试 | CONST-08/10 | TECH-TEST-03/04 | 符合；P1 不标完成；模拟、真实 harness、外部集成分别登记 | 补齐本期退出条件后再发布 |

本次没有修改宪法、基本法、KOL 业务阶段或审批规则。

## 2. 问题、原因与修复边界

| 用户现象 | 仓库证据 / 判断 | 本次处理 | 证据边界 |
|---|---|---|---|
| 新发现没有筛选卡 | `useDiscovery.loadExisting` 在未指定任务时回退到历史首条，旧失败可以覆盖新建场景 | 新建不自动选历史；显式任务/运行继续保留恢复能力 | 本地历史失败夹具验证 |
| 技能模板不见 | Home 的通用模板选择排除了发现入口，没有补回发现模板 | AI发现展示实际 `crawler_collect` 技能模板；该技能登记预计步骤和边界；服务端保存相同模板版本 | 浏览器验证；不以旧 `creator_discovery` 的启动说明冒充新链路 |
| 中栏成为爬虫工程师 | 提交入口直接召唤 `expert:crawler`，只带文本，没有发现任务现场 | 创建 `lead` 发现任务，按当前用户已授权 Agent 装配解析执行身份；显示“线索智能体 · AI发现” | 仓库因果明确；不覆盖管理员已发布绑定 |
| 返回位置不对 | 会话返回固定 `/`，无法恢复发现来源与条件 | 返回 `/?tab=discovery&resume=<task>`；恢复正文和条件，可继续原会话；修改后提交为新任务 | 刷新、返回、再次进入回归通过 |
| 返回或左侧点击没反应 | 截图不能证明事件层根因；没有证据证明所有导航都由采集迁移直接造成 | 返回采用 Router 原生链接；验证侧栏技能入口跳转 | 本地未复现点击无效；生产当时原因仍未定，不伪称已定位 |
| 采集失败 / 查询缺 task_id | 新工具描述范围比本地物理闸门更宽；状态调用必须对应持久启动回执 | 启动白名单和暴露 schema 对齐；查询/停止要求 task_id；远端未声明任务参数则不暴露工具 | 参数失败与远端采集执行失败分开；未新增生产调用证据 |

上述是发现链路的连续性修复。中栏实时捕获邮件、审批和工单变化属于后续通用任务上下文能力；它们共享现场和受控执行基础，不是同一项缺陷修复。

## 3. 本次实现

### 3.1 工作现场

- `POST /api/home/discovery/workspace` 使用原生 PostgreSQL 同事务保存 session、ticket、task_run。
- 按用户和 request_id 幂等；重试返回原任务，复用键却改变正文或条件返回冲突。
- `tickets.input.discovery_workspace` 保存版本、真实执行 Agent ID、lead 业务角色、brief、提交正文、技能模板及版本、站内返回路径。
- 平台、地区、方向、关键词和数值范围按现有发现字典验证，忽略任意附加 brief 字段；不接受客户端伪造技能快照。
- 首次分析通过已有 pending ask 进入统一 harness；准备任务本身不运行模型、不启动采集。
- 页面关闭导致浏览器 pending 消息丢失时，通过按所有者与当前技能权限保护的 pending 查询恢复原 run，不额外创建任务。
- 普通 HTTP/IP 环境使用 `getRandomValues` 生成幂等键，不依赖只在安全上下文提供的 `randomUUID`。

### 3.2 技能和执行契约

- 产品入口仍叫 AI发现；其采集步骤使用已装配的 `crawler_collect`。业务身份与采集工具名称分开呈现。
- 启动参数限定单平台、模式和对应目标；地区、方向、粉丝、均播、期望人数是候选核对条件。
- 经线上契约核验，开放 `max_notes_count`（远端技术范围 1–10000），评论与子评论均限定为 `false`。不开放评论采集。
- `max_notes_count` 是按关键词/采集模式执行的内容数量参数，并非整个任务的去重 KOL 总上限；频道信息补充仍产生额外读取。期望候选人数仍是核对条件，不能混用。
- 远端原始 schema 的审核、权限、版本检查与 L3 闸门保留；模型可见契约和实际调用同时受收窄规则约束。
- 采集预留及监控、监控状态及下一轮调度、终态及结果读取分别同事务提交。
- 停止与采集成功并发时，不用迟到的停止回执覆盖已保存成功终态。

### 3.3 结果与恢复

- 新增增量迁移 `20261004_discovery_results`：在 `runtime_crawl_jobs` 保存结果状态、候选快照及结果错误。
- 新持久作业 `crawler.results` 沿用 PostgreSQL 执行记录与 Outbox；失败读取可以恢复，活动读取任务去重。
- 仅从远端声明支持 `task_id/offset/limit` 的 `get_creators` 读取；每页响应必须回传相同 task_id。
- 校验平台、候选 ID、重复分页和 total；候选保留来源地址、原始指标和读取时间，未知数值不转成零。
- 前台区分采集状态、候选读取状态和模型分析状态；空结果不是读取失败，聊天结束不表示采集完成。
- 右栏显示候选、来源、粉丝及均播门槛差距；地区与方向没有可靠证据时保持待核验，不声称完全匹配。
- 候选读取失败只重试读取；重新采集仍需独立提案与确认。
- 当前单轮读取最多 20 页、每页 100 条；超过预算标记部分结果，员工点击“继续读取候选”从已保存位置续读。跨页或续读时总数变化会保留原快照并报错，不合并两版数据。
- 远端 `views` 只能标为本次采集样本，不能冒充已核验的最近10条内容。候选卡分别展示样本均播及近10条均播是否可核验。
- “让线索智能体分析候选”沿用当前会话及统一 harness。读取快照前后重新校验当前 Agent/技能/连接器权限，只取同员工、同会话、同 Agent/技能的任务；注入最多4次采集快照、每次80位候选，总候选正文预算24000字符，并标明截断、缺失和时间。
- 候选是非可信来源数据，不能作为指令。技能要求基于已保存候选分析，不因总结重新采集；导入、发信仍为独立动作。

## 4. 验证记录

本节记录第一次发布前的验证。后续 main `19c78a1` 发布及追加验收以[发布记录](task-collaboration-workbench-p1-release.md)和[质量记录](task-collaboration-workbench-p1-quality.md)为准；下方“未发布/未应用”描述保留原验证时点，不能用作当前状态。

环境：Windows、本工作区、独立本地 PostgreSQL 16、Chromium。远端及模型测试使用隔离夹具；浏览器开启真实本地登录，模型为 stub，不连接真实采集目标。

| 检查 | 结果 | 说明 |
|---|---|---|
| 后端 typecheck | 通过 | 覆盖运行时代码、结果契约和测试类型 |
| 前端 build | 通过 | 包含 TypeScript 检查与 Vite 构建 |
| validate:contracts / validate:registry | 通过 | 无错误、无告警 |
| PostgreSQL 执行队列集成 | 6/6 通过 | 新增调用方事务回滚场景，任务和 Outbox 一起回滚 |
| 技能运行时与采集契约 | 首轮 45/46；补齐参考数据后失败项及相关场景 8/8；本轮定向 12/12 通过 | 首轮失败为模板库缺 Starry 连接器目录，按标准 `db:seed:reference` 补齐。本轮增加范围限制、2001位候选跨轮续读、当前会话上下文隔离与撤权；Worker 协议使用 fake Codex，不是真实模型 |
| AI发现浏览器回归 | 7/7 通过 | 包括候选样本/最近10条区分及当前会话分析提交、丢失 pending 恢复、条件模板与身份/返回/侧栏、HTTP 缺 randomUUID、历史失败、确认一次及回执恢复；候选及确认响应为隔离夹具 |
| 线上只读契约核验 | 通过 | 2026-10-04 20:33（北京时间）；部署代码 `912fea5`、claw v14 已启用且 verified；读取已持久化旧取消任务，仅打印状态/数量/字段名，无新采集 |
| 真实 Codex harness / 授权候选采集 | 一次采集、3位候选、同会话分析通过；数据质量有缺口 | 详见 §4.2，不能据此宣称所有退出条件通过 |
| YouTube 订阅数解析补丁 | 离线 4/4 单测及线上源码副本 3 项断言通过 | 只针对混合账号文本误取数字；没有修改线上采集器，没有再次采集 |

发布门禁已接入独立 `playwright.runtime.config.ts`，以真实本地登录验证 Agent 权限；不通过关闭认证使测试通过。线上 E2E 的新步骤尚未执行。

最终工作区另通过 `git diff --check`、发布工作流 YAML 解析、产品文档的相对链接检查。未执行全仓测试、完整模型评价集或线上发布门禁。

视口补充：1440×900 指针、1024×589 键盘、820×700 触摸验证了返回/继续/侧栏和无横向溢出。截图复核发现窄屏顶栏被网格自动行撑高，已将外壳设置为 `auto + minmax(0,1fr)`；右栏在抽屉宽度下无历史偏好时默认收起，保留手动偏好，避免遮挡中栏。最终构建及7项回归通过。这不代替完整 DESIGN 三轴、读屏、缩放与所有触摸命中区验收。

复核命令（数据库须使用隔离测试库，模板库按仓库脚本先建 schema 并 seed reference）：

```text
backend: npm run typecheck
backend: npm run validate:contracts
backend: npm run validate:registry
backend: npm test -- tests/crawl-tool-contract.test.ts tests/skill-runtime-execution.test.ts
backend: npm test -- tests/skill-runtime-execution.test.ts -t "discovery workspace|mounts MediaCrawler|routes Starry business"
backend: npm test -- tests/postgres-execution-jobs.integration.test.ts
frontend: npm run test:e2e:runtime -- --workers=1
```

### 4.1 线上结果契约证据与结论修正

此前“远端任务级候选接口缺失”的判断仅基于仓库补丁覆盖范围，证据不足。2026-10-04 的线上源码、`tools/list` 与实际只读调用已推翻该判断；无需为此重复改造远端。

- 实际 `get_creators` 声明 `task_id/platform/offset/limit`，按带任务 ID 的 `kol_creators` 文件名选择数据；Crawler Manager 将任务 ID 传给采集进程，writer 写入对应任务文件。
- 用既有持久回执 `20261004161922_158c6b2e` 的原执行上下文与当前权限读取：回执状态 `cancelled`，响应任务 ID 一致，`total=0, offset=0, limit=1, returned_rows=0`。这是旧取消任务的隔离读取证据，不是正常完成的空结果验收。
- 远端 writer 保留最多10条采集样本；关键词搜索样本不等于频道最近10条。loader 会去除内容 ID/明细，只返回 `views`，并可能跳过无法解析的文件，因此不能凭空数组证明采集正常成功。
- 检查脚本 `backend/scripts/inspect-discovery-result-contract.ts` 只枚举契约或按已有回执读取一页，不启动/停止采集，不输出候选内容及凭据。线上临时脚本已移除。

线上源文件 SHA-256（用于固定本次证据，不作为后续版本承诺）：

| 文件 | SHA-256 |
|---|---|
| `mcp_server.py` | `fc789a7664ea7ab6d05445c69903736991782f75127878c622eb4e823139c180` |
| `crawler_manager.py` | `41bfc05154530bf1b68681be311a876a906f4d14351cd10b7d82ef5a22318291` |
| `standard_creator_writer.py` | `4eae5ee31fe49b45982bc8e1227b82d2bb8401c6b91613a1c997588f6f438bf0` |

### 4.2 用户授权后的真实闭环

用户在本会话明确选择“按此范围验收”：隔离环境、一次 YouTube `camping` 搜索、`max_notes_count=5`、评论和子评论关闭；只读本任务候选并分析，必要时只取消本任务，不导入、不发信、不发布生产代码。

[可复核验收数据](evidence/task-collaboration-workbench-p1-live-20261004.json)保存确认范围、真实回执、候选快照、作业统计与最终模型简报，不含连接凭据或业务邮件。

| 环节 | 结果 | 证据边界 |
|---|---|---|
| 隔离准备 | 独立代码目录、独立 PostgreSQL，仅复制所需治理配置；其他外部连接器禁用 | 未接入生产 Redis 队列；使用同一个原生持久作业 dispatcher 按 ID 执行 |
| 首轮真实模型 | 工具目录为空，模型明确未执行 | 原因为隔离复制的外键级联清掉绑定；按父表先于子表顺序修正，非生产工具缺失；未发生采集 |
| 正式提案 | 真实模型生成且仅生成1个待确认启动动作；参数与授权逐项相同 | `action_c62434cf-e2d1-49a6-8bf4-42ad385e8645`；核验后经正式确认操作入队 |
| 启动与完成 | `20261004205542_10922516`；北京时间20:55:42启动，采集成功，结果读取完成 | 启动、监控、结果读取均有持久作业成功回执；一次启动，无第二次采集 |
| 真实候选 | 3位，task_id一致；12:56:48Z保存 | Go4x4、Baum Outdoors、Abel & Victoria；每位只有1条采集播放样本，不能核验近10条均播 |
| 同任务分析 | 真实 harness 完成，未新增动作 | 指明3位少于期望5位、地区和方向证据限制、样本不等于最近10条；未导入、未发信 |
| 质量复核 | 未通过完整数据质量验收 | Go4x4源粉丝数为4，模型据此判低于门槛，需要核验原文 |

本次验收结束后，已确认隔离库无排队/运行/重试中的作业，关闭隔离连接器并移除复制的凭据和密钥，保留任务回执与候选证据。生产代码仍为 `912fea5`，生产权限和连接器未修改。

订阅数问题的证据：线上 `parse_count` 提取文本中的第一个数字；离线输入 `@Go4x4 1.8M subscribers` 返回4，而独立 `1.8M subscribers` 返回1800000。这里的1.8M是测试输入，不是对该频道真实粉丝数的断言。频道 DOM 回退取整段含 subscribers 的文本，因此有混入账号数字的可能；本次未保留原始订阅数文本，不能断言这一候选的实际错误路径已证实。

已准备 `patch-youtube-subscriber-count.py`，只收窄频道订阅数提取，不修改通用视频计数。默认 dry-run，源代码形态变化会拒绝覆盖，应用前独立保留原文件；4项离线回归和下载的线上源码副本测试通过。**未应用到线上**。下一步需要保存订阅数原文及字段来源、复核该候选，再验收修复；禁止凭账号常识手填粉丝数。

## 5. 剩余工作与发布门禁

1. **发布版本一致性。** main `19c78a1` 的迁移、API、前端与执行 Worker 已发布并核验；后续质量修复仍须通过门禁并核对版本。不能把采集器外部补丁当成本平台代码已经发布。
2. **数据质量与简报验收。** 已完成一条真实有候选链路及真实 harness 分析。继续修复/验证订阅数原文与解析、来源一致性和空结果用例；不能将3条候选的成功读取等同于全部业务指标准确。
3. **真实异常路径。** 验证启动响应丢失、取消、执行进程重启、结果查询故障恢复；确认未知结果不会启动第二个任务。
4. **导航和设备验收。** 本地标准视口已验证发现返回及侧栏技能入口；补生产问题复现、其余相关入口及 DESIGN 三轴矩阵。当前证据不足以把生产所有点击失效统一归因。
5. **发布及回滚演练。** 应用增量迁移后，后端、执行 Worker、Outbox Worker 与前端按兼容版本发布。任务数据不可清空；回滚必须保留新作业的处理器/监控，不能直接降级为不认识 `crawler.results` 的 Worker。

§4.2 仅使用当时的一次采集授权，没有导入或发信。随后用户明确授权合并、推送及发布，并另授权两次限定采集；范围与回执另见上述后续记录。新的对象或追加运行不自动继承有限授权；只读复核已有结果可以继续。

## 6. 实施资产索引

以下是代码证据，不是规范依赖：

- 后端：`src/crawl/discovery-workspace.ts`、`tool-contract.ts`、`runtime-gates.ts`、`results.ts`、`result-schema.ts`、`context.ts`；`runtime/action-gates.ts`、`action-operations.ts`、`execution.ts`；`execution-jobs/postgres-store.ts`；`routers/home-discovery.ts`；`worker/runner.ts`；`skills/crawler_collect/SKILL.md`；`scripts/inspect-discovery-result-contract.ts`、`accept-discovery-live.ts`、`patch-youtube-subscriber-count.py`、`test-youtube-subscriber-count.py`。
- 前端：`pages/Home.tsx`、`pages/Chat.tsx`、`home/useDiscovery.ts`、`home/discoveryWorkspaceState.ts`、`home/DiscoveryRuntimeResults.tsx`、`components/RuntimeActions.tsx`、`components/SideWorkbench.tsx`。
- 测试：`backend/tests/crawl-tool-contract.test.ts`、`skill-runtime-execution.test.ts`、`postgres-execution-jobs.integration.test.ts`；`frontend/e2e/runtime-actions.spec.ts`、`frontend/playwright.runtime.config.ts`。
