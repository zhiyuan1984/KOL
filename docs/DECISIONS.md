# 决策历史

本文件只记录「为什么」，不替代现行宪法、基本法或实施细则。现行规则以 `docs/` 下对应正文为准。

## ADR-2026-10-09：Starry 入库 uncertain 状态的真核对（替代永远 409）

- **状态**：已接受（线上 409「入库请求已提交，正在核对结果」实证：没有对账扫，uncertain 是死胡同，「正在核对」无人执行）。
- **背景**：`discovery_runtime_imports` 状态机只有 dispatching → succeeded / uncertain；uncertain 后重试永远 409，无恢复路径。根因链：MCP client 无超时 → 导入挂起 → nginx 60s 掐断 504（已修：后端导入 120s/核对 30s 硬超时 + nginx `proxy_read_timeout 240s`）。
- **决定**：
  1. 重试命中 uncertain（或 dispatching 超 10 分钟视为孤儿）时，真调 `pageKolProfiles` 按平台账号核对 Starry 侧：有 → 补成功落盘（画像 + succeeded + 审计 `reconciled: true`）；没有 → 删旧行重新派发（已核对，非盲目）。
  2. 核对本身失败（Starry 无响应）→ 502「入库状态核对失败，请稍后重试；未重复提交」，不删行、不盲目重试。
  3. 鲜活的 dispatching（10 分钟内）仍 409「正在处理，请稍后再试」。
- **理由**：CONST 不变量「真实等待有原因、不得伪造完成」——旧文案承诺的「正在核对」实际无人执行，属伪造状态；新路径让文案为真。R3 导入的确认与回执不变。
- **限制**：PG 真跑待用户环境；`discovery-candidate-actions.test.ts` 新增 3 项核对测试（原「never dispatches again」按新语义重写）。
- **追记（同日）**：跟进口 `candidate_import_pending` 是同一死锁的另一面——uncertain 行同样让「跟进」永远 409，而跟进成功后的 Starry 写入已走核对路径。决定：跟进前对 uncertain/孤儿 dispatching 复用 `reconcileUncertainImport`；Starry 有 → 补成功落盘后继续跟进；没有 → 删僵尸行走本地建档（跟进后的 Starry 写入会重新派发）；核对失败 → 502。鲜活 dispatching 仍 409，文案改为「该红人正在入库，请稍后再跟进」（诚实）。测试新增 4 项（跟进三态）。
- **追记（同日二）**：线上实证两条——①「已跟进，但 Starry 入库未完成：写入红人档案失败，未加入跟进」自相矛盾：`employeeImportError` 的「未加入跟进」是旧流程残留（当年跟进＝入库一步），现在跟进已成功、失败的只是写公海。决定：candidate-actions 内 `poolImportMessage`/`poolImportError` 把「加入跟进」纠正为「加入公海」（跟进口 catch 与加入公海口共用；不碰共享 fallback，其它流程断言不变）。② 超时那次若 Starry 侧实际写成功了，keyword 核对会漏检（刚建档案 keyword 查不到，`findExistingKolUid` 注释有载），误判「未入库」删行重派发会撞重复拒绝。决定：`lookupImportedKolUid` 加 listAll 兜底；`host.import_creator.failed` 审计补 `error_detail`（脱敏后真实错误，用户文案仍走白名单）。测试 +1（文案纠正）。
- **追记（同日三）**：线上 08:57 核对报「达人库无响应」，而公海页（同连接）正常、patch 已部署——根因是上一版把 keyword(快) 与 listAll(慢) 放在同一个 30s 预算里，池大时 listAll 直接耗尽。决定：分段预算（keyword 20s、listAll 60s），两处调用点总预算放宽到 100s（nginx 240s 内）；reconcile 的 502 区分「无响应/连接失败/脱敏后真实原因」，下次失败直接可读。
- **追记（同日四）**：Starry 侧 5xx 证实挂壁（对方网关/服务故障，与本方配置无关）——诊断闭环，代码侧无须为 outage 打补丁。附带发现真缺口：「已跟进但 Starry 未入库」的候选没有重试入口（按钮对已跟进禁用＋后端 candidate_followed 一律 409）。决定：补重试入口——后端 `starryImportCandidate` 仅拦他人的跟进，自己的跟进允许补入库（uncertain/孤儿行仍先核对；审计 `discovery.runtime.ingest.follow_retry`）；前端对已跟进卡片放开「加入公海」按钮（title 说明是补入库），成功后刷新不跳公海页。测试 +2。

## ADR-2026-10-08（二）：公海品牌可见性 —— 跟进后同品牌在公海不可见

- **状态**：已接受（用户 2026-10-08 直接要求实现）。
- **背景**：跟进（建线索）后，该 KOL 仍在公海对所有人可见，同品牌内部会重复跟进、撞单。
- **决定**：
  1. 线索记品牌归属（`kol_leads.brand`）：显式传入优先，否则取跟进人唯一品牌；多品牌/全品牌/无品牌留空。
  2. 建线索即建品牌锁（`kol_pool_brand_locks`，按平台+稳定外部 ID+品牌唯一）；线索归档时释锁（有其他有效同品牌线索则保留）。
  3. 公海读取按查看者品牌排除被锁 KOL：LT 跟进 → LT 用户不可见，RG 等其他品牌仍可见。
  4. 组长（2026-10-08 用户纠正：department_head 即组长，不限层级）：以组织树 `organization_units.head_person_ref` 为准，组长看全量公海（不受品牌锁限制）与本单元及下级单元的全部跟进线索；组长的上级（父单元 head）范围更大、权限更多。读放行，写（改/转/归档）仍只限本人或管理员。
- **理由**：CONST-04（权限在取数前校验，SQL 内过滤；线索列表 `ANY(memberIds)` 同理）；BIZ-15（锁身份键只用平台+稳定外部 ID）；组织表以人员页 `organization_units`（一级→二级→三级→四级→人员）为准。
- **限制**：PG 锁 SQL 与线索范围 SQL 真跑待用户环境。

## ADR-2026-10-08：AI发现去重三层 + 线索阶段 Jev 打分 + 候选卡片加入公海/跟进 CTA

- **状态**：已接受（用户 2026-10-08 裁决：按推荐做；卡片 CTA 作为二期综合考虑）。
- **背景**：AI发现跨运行零去重（只有 `ON CONFLICT(request_id, …)` 防重入），抓回来的数据高度重合；「去重打分」是纯前端 label；定时模板 `dedup_by` 无消费方。Jev 评分只在公海手动触发（≤12 个/次），线索阶段无分。首页候选卡片 `POST /home/discovery/candidates/:id/ingest` 501 占位、`…/follow` 403 禁止（10-07 §24.6「禁止从发现路径直接创建 Collaboration/排他认领」）。
- **决定**：
  1. **去重身份键** `(platform, 归一化 platform_creator_id)`（BIZ-15：只认平台+稳定外部 ID）；跨平台同一真人不自动合并，只标疑似。
  2. **三层去重**：批次内内存去重 → PG `kol_creator_pool` 跨运行（`window_days` 默认 30，模板可配；超窗口允许重新入池）→ `kol_leads`/`kol_cooperations`/`kol_follow_index` 跨业务标状态。被去重者入库标 `suppressed`，前端默认折叠。
  3. **模板 `dedup` 做实**：`system_template.dedup.window_days` 经 `enqueueSystemCrawl` 落 `args_json`，回填时记池。
  4. **线索阶段打分**：`createKolLead` 后异步调 `assessPublicKolWithJev`（字段映射 + 来源口径，缺啥评啥）；去重命中新鲜评分直接复用；`kol_leads` 加评分列。公海卡片沿用线索分 + 口径摘要展示，跨口径仅参考，不做全池重评。
  5. **二期 CTA**：「加入公海」（L2，全卡唯一）复用批量 `ingestOne` 同一 Starry 写入路径；「跟进」（L3）= 创建线索（`source='ai_discovery'`）+ upsert `kol_profile_index`（`ingest_source='discovery-lead'`，仍在公海 open）。行内二次确认。
  6. **决策变更**：10-07「禁止从发现路径直接创建 Collaboration/排他认领」部分推翻——跟进创建的是**线索业务对象**，不是排他认领（`kol_follow_index`）；排他认领仍只在公海完成。
- **理由**：BIZ-15/BIZ-27/CONST-04/R 分级见设计文档审宪记录（`your_files/discovery-dedup-score-design.md`）。
- **限制**：PG 集成测试沙箱跑不了（无 `TEST_DATABASE_URL`），待用户环境补；`ingestOne` 要求真实联系邮箱，无邮箱候选 409 如实失败。

## ADR-2026-10-07：写合作邮件三路径实时带出发件箱/收件人（来源+候选）、无模板首封可提交草稿

- **状态**：已接受（用户 2026-10-07 裁决：四个确认点全确认，按方案开工；合并/推送/部署待走查通过后再确认）。
- **背景**：首页/会话页/通讯页三处触发「写合作邮件」时，输入框仍出现 `[发件邮箱]`/`[收件邮箱]` 占位符，要员工手填本可自知的信息（ADR-2026-10-06 上下文设计稿 §1 已点名此为"强上下文技能"的典型痛处）。旧规则散在 SKILL.md 文字描述里：收件被表述为"当前合作 KOL 的明文邮箱"（依赖合作对象存在）；`mailbox`/`mail_thread` 上下文键与 collaboration 有硬依赖，没有合作对象时 `mail.prepare` 空手返回。三处前端各自按自己的理解拼接 From/To（CONST-04 风险）。另外旧 SKILL.md 把只读准备入口写成 `/api/email-compose/prepare`，实际契约为 `POST /api/actions/mail.prepare`，文档与代码漂移。
- **决定**：
  1. **规则统一放服务端**：`compose-sender.ts`（发件箱单一规则，不依赖合作对象）：口令明确指定 → 通讯页选中邮箱（本人挂载+品牌范围核对）→ 本人挂载默认邮箱 → 合作记录 `mailbox_from` → 当前品牌唯一授权箱；挂多只无默认时不取第一只，留空并返回候选。`compose-recipient.ts`（收件人单一规则，不依赖合作对象）：口令写明地址 → 通讯页选中会话的对方 → 已选合作下该红人最近往来地址（无往来则合作记录邮箱）→ 当前发件箱最近真实往来对方（排除本人邮箱与 noreply/mailer-daemon 类地址）；每档带来源标签与候选。
  2. **已核实收件来源登记为 BIZ-04 的合法来源**（不是"默认第一只"）：① 本人挂载邮箱中的真实往来记录（按 `last_at` 取最近的确定性时间规则）；② 通讯页中用户主动选中的会话的对方。两者不编造、不取第一只。
  3. **无合作也返回地址**：`mail.prepare` 在 `needs_context`（缺阶段/模板）时仍返回 `editor.from`/`editor.to`、空 subject/body、`sources`、发件/收件候选、可用的人摘要与条目数。无模板首封可以提交草稿，缺项由 Host 校验；真正发送仍走右栏独立 R3 确认；发送 ≠ 推进合作阶段。
  4. **往来匹配合作的保守语义**：最近往来会话携带 `collaboration_id` 时，用该合作重新打开 context resolver 套阶段模板与往来摘要（来源记"往来匹配"）；多合作候选时不猜，返回 `needs_context`；匹配不到合作时不猜正式阶段、不强套模板。
  5. **前端只替换占位符**：`composer/addresses.ts` 只替换 `[发件邮箱]`/`[收件邮箱]`，不覆盖用户已写内容；收发件来源展示、候选切换按钮；无模板时不再因 `!knowledgeId` 禁用提交；提交时 `compose_input` 与首页参数一致（通讯页同步接入）。
  6. **文档漂移收口**：SKILL.md 入口正名 `POST /api/actions/mail.prepare`；上下文键目录登记新增键 `recipient`，`mailbox` 标注"不依赖合作对象也可解析"。
- **理由**：三字段手填违反上下文设计稿第 1 条原则（事实应当由系统解析）；BIZ-04 禁止默认第一只邮箱、编造联系方式——收发件规则必须由服务端按优先级链执行，前端不得自行拼接（CONST-04）；草稿与外发区分、R3 独立确认、发送不推进阶段三条不变量不受影响（CONST-05）；"真实往来记录"与"用户选中的会话"是确定性事实（时间排序 / 用户主动选择），与"从候选中取第一只"的禁止项性质不同，因此登记为已核实来源而不是违宪。
- **审宪记录**：需求「首页/会话页/通讯页点写合作邮件时服务端实时解析发件箱与收件人（带来源与候选），输入框不再出现占位符；无模板首封可提交草稿；发送仍走右栏独立 R3 确认；发送不推进阶段」→ 主责 智能体产品经理（意图与草稿呈现）+ KOL 业务专家（收发件来源规则、真实往来定义）+ 架构师/后端专家（解析层、邮箱权限核对）+ 前端专家（占位符替换、候选切换、提交参数）；平台产品经理会签 → CONST-03（确定的优先级规则由程序执行）/ CONST-04（前端不重写业务规则，规则统一服务端）/ CONST-05（草稿≠外发、R3 确认与回执不放松）/ CONST-08 / CONST-09（SKILL.md 与 BIZ-04 同步修订，不偷偷改法）/ CONST-10（不伪造联系人：无模板如实提示缺模板；只读验证不靠发信证明）→ 基本法 `BUSINESS.md` BIZ-04、`docs/superpowers/specs/2026-10-06-context-resolution-design.md`（上下文键登记制、来源优先级链）、`docs/07-mcp-data-contract.md`（R3 外发确认）、`TECHNOLOGY.md` 前后端实施与测试登记 → **符合**（对 ADR-2026-10-06 上下文解析层作出补充：新增 `recipient` 键、`mailbox`/`mail_thread` 去合作硬依赖；补充由用户裁决授权）→ 下一步：本机验证（tsc、PG 真跑单测、前端单测/build、Playwright），真机三路径走查截图；走查通过且用户确认后合并推送部署。
- **限制**：① 沙箱无 PostgreSQL 测试库，`mail-compose-prepare` 在当前沙箱因缺 `TEST_DATABASE_URL` 失败（与本变更无关），PG 真跑待用户环境补；② push/deploy 在沙箱做不了（无 GitHub 认证、SSH 被网络层拦截），由用户本机按 patch 流程完成；③ 唯一合作匹配的完整服务端查询（同一地址多合作→`needs_context`）为 P0 已列实现缺口，当前采用线程自身 `collaboration_id`，需补服务端查询与失败测试。

## ADR-2026-10-06（三）：中栏一条时间流、说明先行的流式输出、右栏只留执行状态与成果目录、写入型工具通用放行

- **状态**：已接受（用户 2026-10-06 裁决：右栏按方案 (a)；写入型工具「通用性都放行，修改宪法法规都行」；流式用方案 B；滚动按钮不带条数；会话页与首页用同一套）。
- **背景**：会话页把智能体的产出拆在三处：中栏固定区块（技能参数卡、邮件摘要、采集状态、报错）不在事件流里；结果、草稿、阶段确认只在右栏完整呈现，中栏只剩「已放入结果工作台」指针；运行时动作卡追加在流末尾。原地更新的条目按创建时间排序，处理过程停在开头，结果反而排在过程上面。结构化输出整段生成完才出现，流式期间中栏只显示「正在整理结果」。发送确认是遮罩弹窗，脱离时间流。用户上滚时只给「有 N 条新内容」计数提示，而首页工作台是「滚到顶部/底部」切换，两套规则。另一方面，生产上 10 个写入型工具策略处于停用（2026-09-29 登记），无专用业务门禁的写入动作即使员工确认也提交不了（`runtime_business_gate_required`），技能声明的资料补全、负责人与状态更新无法执行。
- **决定**：
  1. **一条时间流**：智能体输出的消息、过程、状态、卡片、确认与回执全部按「最后一次有新内容」的时刻排进中栏同一条流，最新的贴着输入框上方。Host 对原地更新的文字条目（流式回答、状态行）只在文字变化时刷新 `updated_at`；处理过程按最晚一步排序；页面自己的条目（技能参数卡、采集状态与候选、报错）带时间进流；任务事件合成一条「任务进度」，已有处理过程时只补失败、停止、取消、模板变化这类异常里程碑。
  2. **成果在中栏完整出现一次**：结果卡、草稿、阶段确认、来信、补全、业务动作卡在产生时刻原位渲染；较早的草稿与阶段建议折叠为只读记录，只有最新的可以操作；L2 草稿在流内标注「未生效」。
  3. **右栏**：执行中（含待人确认、失败）显示状态；执行结束后状态文字退场，只列成果目录（标题 + 时间，点击滚动定位到流内卡片）；员工打开的邮件正文与专用工作台面板（发现结果、任务依据）保留在右栏。
  4. **流式方案 B**：下发给模型的输出约束最前加 `narrative`（给员工看的中文说明），模型先逐字写说明再写结构化字段；Host 把增量写进同一条流式消息，前端从半截 JSON 逐字取出说明显示；解析后从业务条目剥掉 `narrative`，下游契约不变。首页发现与今日计划把说明写成 `run.say` 任务事件，以正文段显示。
  5. **确认留在流内**：发送确认在草稿卡里原位展开（对象、范围、正文快照、后果、确认与取消不变），清除采集历史改为卡内二次确认，不再弹遮罩或浏览器对话框。
  6. **统一滚动规则**：会话页与首页共用一套——停在底部时跟随，上翻即停止，焦点在流内表单时不跟随；只有一个跳转控件，不在底部为「滚到底部」，在底部为「滚到顶部」，不带条数。会话页从最新开始，首页进入模式从顶部开始、只在产出期间跟随。
  7. **写入型工具通用放行**：存量停用的工具策略一次性放行（迁移 `20261006_release_write_tool_policies`）；没有专用业务门禁的写入走通用门禁——提交前重新核对 Agent→技能→连接器授权，仍须员工确认、只提交一次并留回执（动作存储统一承担）。发信与正式阶段写入没有专用门禁时连待确认动作都不提出（`runtime_host_path_required`），继续走发送确认与 `confirm_stage`。
- **理由**：一条时间流是「真实等待有原因、阶段与恢复入口」「状态单点」（DESIGN.md 不变量 6）与「不得伪造完成或进度」（CONST-10）在版面上的直接落地：员工按发生顺序读到过程、结果与确认，不再需要在两栏之间拼接。状态在执行结束后退场，避免「已完成」长期占位与结果争夺注意力。说明先行让员工在结构化结果成形前就知道智能体在做什么，同时不把 JSON 或内部词暴露给员工（§15）。写入通用放行由用户授权，CONST-05 要求的确认、回执与审计不放松；发信与改阶段保留专用路径，是因为 07 真实调用规则把它们绑定在发送网关（草稿快照 + 幂等键）与阶段确认上，通用门禁无法提供同等保证。
- **影响资产**：后端 `backend/src/runtime/action-gates.ts`（通用门禁、Host 专属路径守卫）、`backend/src/runtime/execution.ts`（提出动作前守卫）、`backend/scripts/apply-postgres-schema.ts`（策略放行迁移）、`backend/src/worker/runner.ts`（`withNarrative`、剥离 `narrative`）、`backend/src/host/api.ts`（`updated_at`、同步路径流式消息）、`backend/src/host/run-trace.ts`（`run.say`）、`shared/narrative.ts`；前端 `frontend/src/streamOrder.ts`、`frontend/src/components/{ChatBlocks,StreamArtifact,ResultArtifact,SideWorkbench,ConfirmDialog,CrawlArtifact,StreamScrollJump}.tsx`、`frontend/src/hooks/{useStreamScroll,useConfirmedDraftSend}.ts`、`frontend/src/pages/Chat.tsx`、`frontend/src/home/{WorkspaceShell,DiscoveryRunEvents,TodayPlanProgress,discoveryEvents,useDiscovery}.ts(x)`、样式；删除 `frontend/src/feedFollow.ts`。规范：`docs/DESIGN.md` §10.2、§14、§16 与自检清单，`docs/07-mcp-data-contract.md`，`docs/skill-runtime-operations.md`，`docs/superpowers/specs/2026-10-04-runtime-write-gates.md`。
- **审宪记录**：需求「智能体输出的消息、状态、卡片、文本、弹窗都按时间顺序输出，最新的在输入框上方；执行完右栏中间状态消失只展示结果，执行与状态记录存日志可回看；写入型工具通用放行；流式先说明后结构；滚动按钮不带条数；会话页与首页同一套」→ 主责 UI/UX 专家（版面、滚动、确认呈现）、智能体产品经理（流式说明与等待口径）、架构师/后端专家（写入门禁、迁移、流式协议）、前端专家；平台产品经理会签 → CONST-03（排序、状态退场、门禁判定由程序执行）、CONST-04（前端只呈现，不重写审批与阶段规则）、CONST-05（写入仍须确认、只提交一次、留回执与审计）、CONST-08、CONST-09（同步修订 DESIGN.md、07 契约与运行手册，不偷偷改法）、CONST-10 → 基本法 PROD-AGENT-03/09、TECH-FE-01/03、TECH-BE-02/03、DESIGN.md 不变量 1/4/6 与 §10、§14–§16、07 工具风险目录与真实调用规则 → **符合**（对 ADR-2026-10-06「任务状态单点在右栏」第 1、2、6 条与 2026-10-04 写入门禁「只有已注册业务门禁的动作才能提交」作出修订，修订均由用户裁决授权并在正文同步） → 下一步：服务器 PostgreSQL 回归与预发 E2E、合并部署、生产应用迁移并复核策略指纹，真实员工会话复验流式说明与一次写入确认。
- **限制**：① 消息接口仍一次返回整段会话，没有服务端分页；历史全部渲染、可滚动回看，会话很长时再补游标分页。② 结构化输出轮次是否逐字下发增量、模型是否先写 `narrative`，取决于真实模型行为，需上线后用真实运行核对；没有说明时按旧逻辑显示。③ 2026-09-29 登记的策略指纹若与远端不一致，放行后仍会被拦（`runtime_tool_schema_changed`），需要连接器重新探测刷新。④ 首页列表里员工自己发起的确认（如关注候选）不是智能体输出，本次不改。⑤ 只读分享页没有交互卡片，按摘要行显示成果。

## ADR-2026-10-06：任务会话页状态单点在右栏、连接器缺口前置拦截与设计 token 对账入门禁

- **状态**：已接受（用户 2026-10-06 裁决「状态展示在右栏」，并要求按评审建议整改）。
- **背景**：线上「达人库查询」任务会话页（0511d906）暴露六处问题：① 页头状态卡（`RunHud`）不在事件流里，只随任务状态重算，像孤儿块；② 同一状态在页头卡「结果已生成」、任务头徽章「待确认」、中栏顶部「分析摘要」出现三次且互相矛盾，「待确认」被挪用为「等你标记完成」；③ 结论性摘要固定在事件流之前，结果排在过程上面；④ 员工面出现「Starry KOL MCP」「creator_library_query」——模型照抄技能正文与运行指令里的内部词，且其输出被识别为结果卡片后绕过了前端清洗；⑤ 右栏在本轮无结果时扫描整个会话历史拼取卡片，仍标「本轮结果」，底部「再写一封」提示对所有任务硬编码显示；⑥ 用户上滚后新内容到来没有任何提示，跟随阈值变量未定义。另查实生产上 Starry KOL 系技能**从未挂载连接器**（审计 `runtime.tools.discovered` 全部 `tool_count: 0`），工具发现返回空后仍启动 Codex turn，只能由模型用散文报错，员工无法分辨「缺参数」还是「能力不可用」。DESIGN.md 对上述每一条都有明文（§10、§14、§15、§16），但没有执行闸门；末尾 token 登记表自称「由脚本生成」，实为手工填写，32 个未定义 token 被标为 ✅（含被代码实际引用的 `--surface`、`--bg-subtle`）。
- **决定**：
  1. **任务状态单点在右栏**：状态只在右栏结果区上方呈现一次；中栏页头只放标题与阶段动作，事件流顶部不放结论摘要；「待确认」只用于 R3 确认。页头移出滚动区（DESIGN.md §10.1、§14、§16 修订）。
  2. **右栏只呈现本轮结果**；展示较早结果时标「最近一次结果」并带时间，不再从会话历史任意消息拼取；结果修改提示只在可改写的邮件草稿场景出现。
  3. **连接器缺口前置拦截**：技能声明了已登记的受管连接器、但该连接器当前没有可用工具时，真实执行模式下不起箱、不启动 turn，给出结构化提示卡并写审计；远端发现失败同样在 turn 前终止。未登记连接器不计入。
  4. **员工面去内部词**：技能正文与运行指令改用业务名称并明确禁止在员工输出中出现 MCP、连接器、工具别名、技能 id；前端结构化卡片分支与普通文本走同一清洗。
  5. **设计 token 对账入门禁**：登记表由 `backend/scripts/check-design-tokens.mjs --write` 从实际内容生成，发布门禁校验表格与实际一致；⚠️ 待落地项如实列出、不拦发布。
  6. 新内容到来而用户不在底部时显示「有 N 条新内容」提示，替换原「滚到顶部/底部」切换按钮；定义 `--feed-follow-threshold`。
- **理由**：状态单点与右栏承载成果是 DESIGN.md 不变量 6、§8.6、§16 的执法；用户裁决把状态的唯一落点定为右栏，与「成果、证据和结果状态在右栏」（§14）一致。连接器缺口前置是 PROD-AGENT-09（真实原因与恢复入口）与 CONST-10（不得用模型散文冒充系统判定）的落地，也避免为一次必然失败的调用消耗模型 turn。登记表脚本化是为让「✅」可验证（CONST-10），并消除细则与样式实现之间的无声漂移。
- **影响资产**：`docs/DESIGN.md`（§14 状态单点、§16 验收、自检清单、token 登记表重生成）；`backend/scripts/check-design-tokens.mjs`（新增）、`backend/scripts/release-gate.mjs`、`backend/package.json`；后端连接器缺口判定与 Host 闸门、`backend/src/worker/runner.ts` 运行期兜底、`backend/src/host/skill-sop.ts` 运行指令、`backend/skills/*/SKILL.md` 正文用词；前端 `frontend/src/pages/Chat.tsx`、`frontend/src/components/{SideWorkbench,ChatBlocks,RunHud}.tsx`、`frontend/src/styles.css` 及相关测试。
- **审宪记录**：需求「状态展示在右栏；按评审建议整改任务会话页、内部词外泄、连接器不可用的诚实呈现、滚动提示与设计细则执法」→ 主责 UI/UX 专家（版面与状态呈现）、智能体产品经理（失败与等待的呈现口径）、架构师/后端专家（连接器缺口判定）、前端专家；平台产品经理会签技能正文用词 → CONST-03（确定的状态规则由程序执行）、CONST-04（前端只呈现、不重写规则）、CONST-05（确认与回执不放松）、CONST-08、CONST-09（细则修订留记录）、CONST-10（不伪造完成或进度）→ 基本法 PROD-AGENT-03/09、TECH-FE-01/03、DESIGN.md §1 不变量 4/6、§8、§10、§14–§16、07-mcp-data-contract → **符合**：只改呈现位置、文案与执行前判定；不改发送、阶段、审批、R3 闸门与权限 → 下一步：验证后合并部署；在管理端为声明工具已就绪的技能执行「按定义挂载」并真机复验。
- **限制**：① `creator_contact_decrypt`、`deal_memory` 声明的工具受写入策略约束，挂载后仍无可用工具，会持续给出缺口提示，需管理员按工具风险目录审批策略。② 登记表列出的 ⚠️ token 仍待 UX-DESIGN-04 落地，其中 `--surface`、`--bg-subtle` 已被代码引用却未定义，属现存样式缺陷。③ 缺口卡与新内容提示的视觉验收需按 DESIGN.md §13 矩阵截图。

## ADR-2026-10-06（二）：员工端「标记完成」不再强制手填验收依据，验收记录改由系统按事实生成

- **状态**：已接受（用户 2026-10-06 直接要求「取消掉」该弹窗：员工没有凭证可填，且在运行没有产出时还要求填写等于逼人编造）。
- **决定者**：平台产品经理（员工端功能与交互）、前端专家（实现）；测试经理（取证方式）。后端回执契约不在本次变更范围。
- **背景**：任务详情「标记完成」原实现用 `window.prompt` 强制员工输入自由文本「验收依据」，不填即中止并提示「未提交验收：需要填写验收依据后才能完成工单」。该要求无基本法依据：`BUSINESS.md` BIZ-16 只规定「任务完成依据任务验收条件」；`docs/superpowers/specs/2026-10-03-ticket-workbench-implementation-proposal.md` 要求的是「具备权限的人**提交**验收证据」，未要求由员工**撰写**。
- **决定**：
  1. 删除员工端强制手填验收依据的弹窗与对应中止分支；点击「标记完成」即构成一次明确的人工验收提交。
  2. 验收记录改由系统按已发生的事实生成（`source: employee_confirmation`、`accepted_at`、`task_title`、`ticket_version`，任务详情暴露 `execution.run_id` 时一并带上），不含任何用户输入。
  3. 后端 `POST /api/tickets/:id/commands` 的 `complete` 仍必须携带 `acceptance_evidence`，`ticket_acceptances` / `ticket_acceptance_history` 与审计写入不变；不新增也不取消任何完成门槛，「运行成功 ≠ 工单完成」的口径继续由「完成命令独立于运行、必须由具备权限的人提交」保证。
- **理由**：把「谁产生证据」从员工改为系统，职责更诚实——人能提供的是「我在这个版本上确认验收」，事实引用由系统留下；反过来要求员工在无产出时撰写理由，会诱导编造，违背 CONST-10。修改只发生在实施细则层面的交互与证据来源，未放松 CONFIRM/回执的 L3 类闸门。
- **影响资产**：`frontend/src/pages/Chat.tsx`（`complete()`、系统生成 `acceptance_evidence`）；`frontend/e2e/workbench.spec.ts`（用例改为 mock `POST /api/tickets/:id/commands`，断言点击后无任何弹窗、完成文案与请求体证据来源）。后端契约、SQL、迁移、管理端工作战报「验收证据」面板不改。
- **生效版本**：立即生效（员工端交互）。已登记的「完成必须携带验收证据」（`docs/superpowers/specs/2026-10-02-task-scheduling-m0-m3-status.md`、工单工作台方案）继续有效，本次只改变证据由谁产生。
- **审宪记录**：需求「取消标记完成时强制填写验收依据」→ 主责 平台产品经理 + 前端专家 + 测试经理 → CONST-04（前端不重写业务规则、但决定交互呈现）、CONST-05（正式业务变更需有人确认并留痕）、CONST-08、CONST-09（不偷偷改法）、CONST-10（不得伪造完成）→ 基本法 `BUSINESS.md` BIZ-16、`PRODUCT.md` PROD-PLAT-05、`TECHNOLOGY.md` 前后端实施与测试登记 → **符合**：不新增/不取消完成门槛，后端必填契约与回执保留，证据由系统按事实生成 → 下一步：前端实现 + E2E 取证（无弹窗、请求体含系统证据）。
- **限制**：本轮不处理「运行失败或无产出时仍可标记完成」这一相邻问题（要限制即属新增闸门，须产品与业务角色另行裁定）；「生成式验收结论」不做，系统只记录事实引用，不代员工下验收判断。

## ADR-2026-10-06：技能上下文解析层（context 契约与来源优先级链）

- **状态**：已接受（P0 规格 + P1 解析层已实施；P2 逐类迁移中）。
- **背景**：平台 50 个技能中，只有 `email_compose` 有实时上下文准备机制——它独占 `POST /api/actions/mail.prepare`，且该入口第一行就硬校验 `skill_id === "email_compose"`（`host/api.ts`），是全后端唯一的上下文准备动作。其余技能在上下文缺失时系统**永不追问**：缺口可见性取决于是否声明 `required_inputs`，而空数组让 `missing()` 恒返回空（`tasks/resolver.ts`），45 个技能因此静默。ADR-2026-09-23 已正确诊断「`required_inputs` 只是字符串数组，无类型、无标签、无选项来源」并给出 `input_schema` 契约化方案，但它把上下文建模为**「员工必须提供的参数」**而非**「系统应当解析的当前世界」**：`input_schema` 是表单形状，`prefill` 只有「文本抽取」一条来源，于是碰到 `email_compose` 这类强上下文技能时只能手写专用解析器。既有 `object_refs` 管道已随提交载荷传递，但全后端仅 `mail.prepare` 一个消费者。
- **决定**：
  1. 新增技能**上下文契约** `context`，与 `input_schema` 并列住在 SKILL.md frontmatter（沿用 ADR-2026-09-23 单一事实源决定，不建第二注册表）。`requires` 解析失败即 `needs_context`（不建箱、不启动 turn）；`prefers` 失败不阻塞但如实标注。空 `requires` 是「本技能不依赖当前世界」的显式声明，未声明 `context` 的技能保持现状并记为待补，不批量伪造。
  2. 上下文键目录**登记制**（`collaboration` / `stage` / `stage_tracks` / `mailbox` / `mail_thread` / `mail_template` / `message` / `conversation` / `creator` / `creator_filter` / `risk_scope`），键不得自创，未登记键在加载期拒绝，与 `input_schema.options_source` 同一处置。
  3. 统一**来源优先级链**：显式载荷 → UI 选中态（`object_refs`）→ 会话绑定 → 文本抽取 → 账号绑定 → 对象事实 → 记忆。显式载荷优先于一切；第 1 级与第 3 级冲突时不静默取其一；账号绑定只在品牌与范围核对通过时使用；任何一步都不得从多候选中取第一只（BIZ-04）。
  4. 新增只读入口 `POST /api/actions/context.resolve`，返回统一信封（`resolved` / `sources` 逐键来源档 / `missing` / `candidates` / `context_version`）。`mail.prepare` **保留为它的第一个消费者**，路由、请求体、响应字段与文案逐字不变。
  5. 缺口呈现沿用既有卡片形状与 DESIGN.md §8.8「空态诚实」三分；`needs_context`（系统没解析出事实）与 `needs_input`（人没给值）是两种状态，不得合并。
- **理由**：ADR-2026-09-23 的三条判断（契约化、Host 前置解析避免烧 turn、缺口必须诚实）成立且继续有效，但需要补上「上下文」这一层，否则每接一个强上下文技能就要再写一个专用解析器。本决定把 `email_compose` 的既有实现提炼为通用层，不改其行为（用 22 例既有定向用例锁回归），新增能力面向后续技能。
- **影响资产**：`docs/superpowers/specs/2026-10-06-context-resolution-design.md`（目标规格）；`backend/src/tasks/registry.ts`（`TASK_CONTEXT_KEYS` / `TaskContext` / 契约校验）；`backend/src/host/context-resolve.ts`（解析层，新增）；`backend/src/host/context-operations.ts`（只读入口，新增）；`backend/src/host/api.ts`（`prepareMail` 改为消费者；`preparedCollaboration` / `collaborationRefs` / `composeContextVersion` 提炼进解析层）；`backend/src/host/knowledge.ts`（`preparedTemplateChoice` 移入并导出）；`backend/src/app.ts`（挂载入口）；`backend/src/worker/runner.ts`（运行箱补齐阶段事实与声明式上下文投影）；`backend/skills/{confirm_stage,stage_sop}/SKILL.md`（P2.1 声明 context）；`backend/tests/context-resolve.test.ts`（新增）。
- **生效版本**：法条先行。P1 解析层已实施并有用例证据；P2.1 阶段类已迁移；P2.2–P2.4 与 P3 按实施登记表推进，**不得把设计文档或机制落地报告为全部技能已完成迁移**。
- **审宪记录**：需求「KOL 智能体的邮件类、达人类、阶段类等技能都做到实时感知上下文」→ 主责 智能体产品经理（入口与记忆）、平台产品经理（技能声明）、架构师（解析层）；UI/UX 专家（缺口呈现）、KOL 业务专家（事实口径）会签 → CONST-03（确定的状态规则由程序执行，不靠模型自觉）、CONST-04（前端不重写规则）、CONST-05（确认与回执不放松）、CONST-08（先审宪）、CONST-09（不偷改法）、CONST-10（不得用文档冒充完成）→ 基本法 PROD-AGENT-01（入口决定路径）、PROD-AGENT-02（快捷指令声明名称/输入/结果/权限/失败处理）、PROD-AGENT-03（只追问影响当前任务的必要信息；已明确的授权与选择应复用）、PROD-AGENT-09（可靠协作与重新核验）、TECH-BE-01/04、BIZ-04、DESIGN.md §8.8、07-mcp-data-contract → **符合**：只改善「执行前拿到什么」，不新增闸门、不放松确认与回执、不改阶段或权限判定；`context` 住既有单一事实源；未声明技能保持现状 → 下一步：P2 按业务痛感逐类迁移，每阶段附类型检查、定向测试与真机走查证据。
- **限制**：① 本决定不解决远端 MCP 工具 schema 的不确定性——真实可用的筛选参数需运行时 `execution.discover()` 从远端获取，仓库内只有 mock 与确定性分支。② 现行 `starrykol/service.ts` 的 `needs_input` 确定性兜底在生产**不可达**（非 stub 模式直接抛 `CodexUnavailable`），迁移后的行为需真机验证，不能只凭单测。③ 闸门目前只在 Host 意图路径生效；直接调 `runWorker`/`runCodex` 的旁路（compose 预览、today-plan、home-discovery）未加闸门（这些路径当前不跑阶段类技能）。④ 前端缺口卡按 `fields` 渲染输入框，其提交逻辑对阶段类缺口的文案仍无意义，属既有缺陷，待 UI/UX 专家按 §8.8 收口。⑤ 15 个 `sop_*` 的技能族废止（SKILL-RETIRE-2026-10-03）与代码内仍在的静态阶段渲染之间的一致性处理留待 P3 裁决。


## ADR-2026-10-06：DESIGN.md v3 升级与风险分级命名 R1/R2/R3

- **状态**：已接受；用户作为产品发起人确认升级视觉唯一来源。
- **背景**：`DESIGN.md` v2 beta 是「约束型」spec，只规定不许做什么，对「应该长什么样」的构造性 token 不足；同时 v2 的「行动分级 L1/L2/L3」与 v3 新增的「视觉强调四级 L1/L2/L3/L4」同名，造成规约与实现两层语义冲突。
- **决定**：
  1. 视觉唯一来源 `DESIGN.md` 升级到 v3（LLM 可执行版），适用范围由「员工端全部工作台表面」扩展到「员工端工作台 + 中台 2B 数据面」。
  2. 风险分级命名由 L1/L2/L3 改为 **R1/R2/R3**（R1 只读直接执行；R2 草稿必须标注；R3 外发、导入、删除、解密、正式写入执行前必须确认并留回执），避免与视觉强调四级混淆。
  3. 新增视觉强调四级（L1 实底主 CTA / L2 默认描边按钮 / L3 文字按钮 / L4 链接按钮）、表格密度三档、KPI 统计区、抽屉三档、表单规范、高级筛选、批量操作、权限/脱敏、导出/审计、流式输出排版、引用溯源等构造性 token。
  4. 不变量 6 由「同一信息只出现一次」修订为「同一信息不重复渲染，但允许汇总层/明细层分层呈现」。
- **理由**：补全构造性 token 使 LLM 可直接按数值实现；R 命名消除与视觉强调四级的冲突；中台 2B 数据面（数据表、统计区、筛选、批量操作、审计）需要高密度视觉规范；分层呈现规则与汇总/明细业务场景一致。
- **影响资产**：`docs/CONSTITUTION.md`（修订记录、重建记录、CONST-05 风险命名）；根 `AGENTS.md` §3/§4；`docs/AGENTS.md` §5；`docs/TECHNOLOGY.md` TECH-TEST-04（E2E 分层执行原则）；`docs/db-data-dictionary.md` 工具风险档位描述；`backend/src/routers/enterprise.ts` 失效锚点；`frontend/src/admin/connector/*.{tsx,css}` 失效锚点；`frontend/src/styles.css`（企业版 token 落地）；`docs/frontend-component-inventory.md`、`docs/product/task-collaboration-workbench-design.md`、`docs/superpowers/specs/2026-10-04-admin-agents-workspace-redesign.md` 等旧命名/旧不变量 6 转述点。
- **生效版本**：宪法 v2.3（2026-10-06 修订）；法条先行，视觉 token 落地与页面迁移按实施登记表推进，不得把文档修订报告为全部界面已迁移完成。
- **审宪记录**：需求「DESIGN.md 升 v3、风险分级改名 R1/R2/R3、适用范围扩展、补构造性 token」→ 主责 用户（产品方向/修宪）、UI/UX 专家（视觉细则）、平台产品经理（适用范围）、前端专家（token 落地）→ CONST-04（UI/UX 职责）、CONST-08（先审宪）、CONST-09（设计 token 属实施细则、数值只住 DESIGN.md 与 styles.css）、CONST-10（不得用文档冒充完成）→ 基本法 `DESIGN.md`（实施细则）→ **符合**：只改视觉细则命名与构造性 token，不改权限、审批、阶段、确认/回执等业务规则；R1/R2/R3 与 L1/L2/L3/L4 职责不重叠 → 下一步：落地 `frontend/src/styles.css` 企业版 token、迁移受影响页面、重跑类型检查与 E2E 分层脚本。

## ADR-2026-10-05：发现候选直接归属及任务页展示

- **状态**：已接受，用户已确认详细设计、排他归属与成功后导航。
- **决定**：粉丝默认至少1万，上限不限（null）；跟进点击即确认建立当前员工的独立排他关系，成功进入我的红人；加入公海独立确认，成功进入公海；忽略仅影响当前员工的当前发现任务并允许恢复。
- **理由**：候选决策不能被迫经过先导入再领取；也不能把跟进暗中当作导入、建联、发信或阶段变更。业务过程按实际记录时间合并展示，进度与记录采用业务文案，历史缺时间不补造。
- **法条与资产**：BIZ-01/03/05/06/10/14、CONST-03/05/06/08/09/10；BIZ-05显式新增直接跟进触发，领域对象补充候选引用，数据库归属保护、候选动作、过程事件与页面容器分别落实。完整审宪记录、实施状态和证据见 [详细设计](superpowers/specs/2026-10-05-ai-discovery-task-page-redesign.md)。
- **生效与边界**：规则2026-10-05生效；本地实现与生产发布分开登记。点击不启动14天有效邮件计时；真实采集及正式库外部写入须有独立对象与范围授权。

## ADR-2026-10-03：Agent 作为人员使用权限锚点

- **状态**：已接受；用户作为产品发起人明确要求修订宪法法规。
- **背景**：旧模型把人员授权放在每个技能上，管理员需要同时处理人员、技能、工具等多层关系，管理侧员工、Agent、技能三页的职责也因此混杂。
- **决定**：人员使用资格只通过 Agent 绑定决定；绑定目标是权威组织树中的任意组织单元（含三级组）或人员。绑定组织单元时，该单元负责人、该单元及其全部下级成员获得资格，并沿真实上级链逐级纳入该单元的上级负责人；绑定人员时，该人员本人及其所属各级上级负责人获得资格。组织单元不分层级深浅一律适用同一规则。负责人只沿权威组织树的上级链继承，不跨公司或旁支。Agent 装配技能与知识库；知识库查询作为技能实现。MCP、API、知识库是技能调用资源，不独立按人授权。员工页维护和查看 Agent 绑定，Agent 页维护技能及知识库查询技能装配，技能页治理技能与资源依赖。
- **理由**：权限单点收敛，能力分层开放。把「谁能使用」集中到 Agent，把「能做什么」放在技能，把「调用什么」放在资源依赖；组织即人员使用权限的载体，绑定自动向成员继承并沿真实上级链向负责人穿透。管理者的使用资格是内建监督关系，不是临时手工授权。统一调用链「人 → Agent → 技能 → 下游能力」便于版本、统计与审计；SOP 可先沉淀为技能，再装配给 Agent。资源接入无需新增按人授权配置，但仍须完成接入测试、范围和风险校验。
- **取代关系**：取代 ADR-2026-09-27「对外只暴露技能」第 1 条中「员工能否执行由技能授权决定」及第 3 条「人员授权唯一单位＝技能」，也取代相关实施规格中的 `user_skill_grants` 人员校验口径。连接器/MCP/API 不直接对员工暴露、资源不按人授权、技能调用工具、工具风险目录及启用门禁继续有效。历史文本保留供追溯，不能当现行法。
- **影响资产**：`CONSTITUTION.md` CONST-02/05、`PRODUCT.md` PROD-PLAT-04/05、`BUSINESS.md` BIZ-03、`TECHNOLOGY.md` TECH-FE-01/BE-01/BE-07/TEST-02、`org-permissions.md`、`ia-information-architecture.md`、`domain-objects.md`、`07-mcp-data-contract.md`；后续需迁移 `user_skill_grants` 运行时校验、员工目录和 `/admin/agents`，并补组织绑定契约与权限集成测试。
- **生效版本**：宪法 v2.3（2026-10-03）；法条先行，现有代码仍按旧授权实现，不得把本次文档修订报告为生产能力完成。
- **审宪记录**：需求「Agent 为权限锚点、三级绑定与负责人继承、技能与知识库装配」→ 主责 用户（修宪）、平台产品经理、KOL 业务专家、架构师/后端、UI/UX → CONST-02/05（本次由用户修订）、CONST-03/04/08/09/10（确定规则由程序执行、按角色修法并保留证据）→ 基本法 PROD-PLAT-04/05、BIZ-03、TECH-FE-01/BE-01/BE-07/TEST-02 → **符合**：用户直接决定新上位规则，原技能级人员授权口径明确废止；数据范围及 L1/L2/L3 闸门保留 → 下一步：契约、迁移、服务端授权校验、三页实现与权限验收。

## ADR-2026-10-03：PostgreSQL-only 数据层与工单执行基座

- **状态**：已接受；用户明确裁决「不再使用 SQLite，而是采用 PostgreSQL 建设」，并确认不保留 SQLite 数据。
- **背景**：现有实现以 SQLite 风格同步接口为主要仓储抽象，PostgreSQL 通过 SQL 方言转换桥接入；这造成 SQLite 与 PostgreSQL 双路径、运行语义漂移及大响应桥接缓冲故障。任务与调度子系统需要可靠的事务、并发领取、Outbox、审计和报表能力，不能继续以 SQLite 兼容作为建设前提。
- **决定**：PostgreSQL 是生产、开发、CI、测试、迁移、工单、规则、审计、报表、Outbox 与 Worker 的唯一运行时和唯一权威数据库。数据访问改为原生 PostgreSQL 驱动、参数化 SQL、显式事务、行级锁/乐观版本与版本化 migration；Redis/BullMQ 仅为传输和执行层，不保存业务权威状态。SQLite 文件、SQLite 回退、SQLite SQL 方言转换、SQLite 测试替身、SQLite 数据迁移窗口和归档副本均不保留。
- **理由**：单一数据库语义消除双写与兼容桥风险；PostgreSQL 原生事务、锁、JSONB 与索引能力满足持续事件、多人协作、自动派单、规则回放、可靠队列与报表的并发/可追溯需求；用户明确不保留 SQLite 历史数据，避免新系统长期背负旧库兼容成本。
- **影响资产**：`TECHNOLOGY.md` TECH-ARCH-01、数据库连接层、所有 SQLite 类型/SQL 方言调用、PostgreSQL migrations、Docker/环境模板、测试夹具、发布门禁、任务/调度 Repository、Outbox/Worker 与运行手册；`docs/superpowers/specs/2026-10-03-ticket-workbench-implementation-proposal.md` 作为工单域实施规划。
- **生效边界**：本 ADR 立即约束所有新模块；现有 SQLite 代码只能在隔离改造分支中作为待迁移遗留，不能进入 PostgreSQL-only 发布版本。系统在所有运行路径、CI 和迁移均完成 PostgreSQL 原生验证前，不得宣称已完成切换。
- **审宪记录**：需求「任务与调度子系统采用 PostgreSQL，不再使用 SQLite」→ 主责 用户（产品方向）、架构师/后端专家（数据库与一致性）、测试经理（迁移与回归证据）→ CONST-02（平台与业务分离：数据库不定义业务事实）、CONST-04（架构/后端职责）、CONST-08/09/10 → TECH-ARCH-01、TECH-BE-03/04、TECH-TEST-01~04 → **符合**：只替换实现载体，不改变 KOL 事实源、权限、审批或 L1/L2/L3 边界；通过原生 PostgreSQL 事务和测试提高可验证性 → 下一步：建立原生 PostgreSQL 迁移基座，迁移任务/调度 Repository，移除 SQLite 路径并完成 PostgreSQL 集成验收。

## ADR-2026-10-03 （之二）：组织单元三级化与 Agent 绑定持久化

- **状态**：已接受；用户 2026-10-03 追加裁决（三级组可绑定；推广部负责人由钟建奎接任；品牌/区域只落关系、字典仍以 registry 为权威；组织与绑定落新表）。
- **背景**：ADR-2026-10-03 把人员使用资格收到 Agent 绑定，并要求「按权威组织树与负责人关系计算」。但组织树此前只存在于 `config/org-registry.yaml` 与文档中，没有任何 DB 表（`GET /admin/organization-units` 是只读端点、层级按 parent 链现算）；`users` 没有组织字段，人员与部门的关系无处落库；也不存在任何「人/部门 → Agent」绑定表。同时用户确认权威组织为三级：品牌与用户增长中心（一级）→ 推广部（二级）→ LT组 / PQ-RO-TB组（三级）。
- **决定**：
  1. **组织单元三级化并落库**：新增 `organization_units`，含 `level`（1/2/3）、`parent_id`、负责人引用、状态、组织版本与来源；绑定目标可以是其中**任意一级**，层级深浅不改变继承规则。
  2. **人员用成员关系表达**：新增 `organization_memberships`（人员不是组织树节点，见 `org-permissions.md`），带职务/岗位、主组织或协作组织、生效期。
  3. **品牌/区域范围落关系**：新增 `scope_memberships`（主体 × 品牌 × 区域 × 生效期，可表达 `LT-EU` 这类人级范围与部门品牌范围）；**品牌与区域字典仍以 `config/brand-registry.yaml` 为唯一权威**，DB 只存关系（采纳用户选项 b），不建字典表。
  4. **使用资格落绑定**：新增 `agent_bindings`（目标为任意组织单元或人员）与 `org_versions`（组织版本锚点）；有效使用者由服务端统一计算，不在前端或页面重算。
  5. **事实来源与迁移**：当前组织事实来自 `config/org-registry.yaml`；一次性回填到 DB 后，DB 是运行时权威，registry 保留为声明来源、待补字段登记与来源凭证（`source`）。
- **组织事实更新（用户 2026-10-03 确认）**：推广部负责人由**钟建奎**接任（原刘敏）；张慧玲为**高级副总裁**兼品牌与用户增长中心负责人。`config/org-registry.yaml` 与相关事实源文档同步更新；刘敏的现任组织与职务、以及其 `resp:kol_business_owner` 业务负责人关系是否随之变化，登记为待确认（责任关系不等于部门负责人，见 `KOL业务对象关系-Link清单.md` N-04）。
- **理由**：三级组可绑定是既有「组织即权限载体、绑定向下继承、负责人向上穿透」原则在更深层级上的推广，不引入新的授权单位；把范围写成带生效期的关系而非人员标签，才能满足「撤权/组织变动后旧授权立即失效」；品牌/区域保留 registry 单一权威，避免出现第二份字典真相。
- **不影响**：L1/L2/L3 工具风险、数据范围、确认与审批闸门、连接器/MCP/API 不对员工暴露的边界。
- **影响资产**：`config/org-registry.yaml`、`backend/src/runtime/organization-tree.ts`（新增）、`backend/migrations/022_organization_agent_bindings.sql`（留档镜像）、`config/objects-registry.yaml`（C2/C4/C7/C8 载体）、`docs/db-data-dictionary.md`、`docs/implementation-registry.md`、`docs/superpowers/specs/2026-10-03-agent-skill-governance-design.md`。
- **生效版本**：宪法 v2.3（2026-10-03）。法条与落库先行，**现有运行时仍按 `user_skill_grants` 放行**，不得把本次建表报告为权限迁移完成。
- **审宪记录**：需求「实施新权限契约；持久化组织/人员/品牌区域关系；三级组可绑定；品牌区域字典仍引用 registry；对 Postgres 表做增加/更新/废弃」→ 主责 用户（追加裁决）、架构师/后端专家、KOL 业务专家、平台产品经理 → CONST-02/05（组织即权限载体、负责人继承）、CONST-08（先审宪）、CONST-09（不改法就实现）、CONST-10（不得用表或页面冒充已迁移）→ 基本法 PROD-PLAT-05、BIZ-03、TECH-BE-01/BE-07、DESIGN.md → **符合**：新增表只承载既有法条要求的事实，未扩大授权范围；品牌/区域字典仍单点权威 → 下一步：Phase 1 建表与回填、Phase 2 服务端换锚并迁移测试、Phase 3 管理端三页接入、Phase 4 旧授权表与孤儿表废弃。

## ADR-2026-09-23：Home 统一 Agent 工作台与公海一级模式

- **状态**：已接受
- **决定者**：用户（产品发起人）；平台产品经理、智能体产品经理与 UI/UX 专家职责范围内落地
- **背景**：今日任务、我的待办和 AI发现已经使用两栏工作台；公海和我的红人仍使用旧的全宽对象列表与页面级提问框，造成同一产品心智下存在两套几何与交互协议。
- **决定**：Home 采用五个一级模式——今日任务、我的待办、AI发现、公海、我的红人。五者共享「中栏人机协作、右栏结果与下一步」协议。公海仍是 KOL 试点能力，不进入平台内核。
- **动作边界**：「首次建联」不作为第六模式；它从公海、我的红人或对象详情启动，先形成 L2 草稿，再独立执行 L3 发送确认。发送不推进阶段。
- **理由**：模式回答稳定的工作问题；首次建联回答的是对某个对象执行什么动作。将二者并列会混淆导航、提问和受控动作入口。
- **影响**：修订 `ia-information-architecture.md`、`DESIGN.md`；扩展唯一 `WorkspaceShell`；迁移公海和我的红人；将模式导航移出 Composer；保留所有既有权限、审批、异步与回执闸门。
- **限制**：BIZ-07 尚未补齐的公海字段与重新分配口径仍是规则空白；界面只呈现后端已经授权返回的字段和动作，不自行补全。

## ADR-2026-09-23：邮箱通讯页四栏 + 技能/定时/记忆增量

- **状态**：已接受
- **决定者**：用户（产品发起人）；平台产品经理、智能体产品经理、KOL 业务专家与 UI/UX 专家职责范围内落地
- **背景**：邮箱通讯页原为邮件流水页，栏3 混入摘要，栏4 在读取路径触发模型，且总结/翻译无增量记忆与定时补算。
- **决定**：改为以人为中心的四栏往来档案页（栏1 全局导航 / 栏2 聚合树 / 栏3 纯正文 / 栏4 总结+中文译稿）。总结与翻译做成 `mail_summary`、`mail_translate` 两个技能，执行走无会话 Codex app-server 直连（形态一），结果写回本地记忆；页面只读记忆、零模型。收取新邮件后 fire-and-forget 触发增量作业，并登记 `mail_memory_increment` 定时任务兜底。人来往总结只取单一邮箱维度（当前选中邮箱，未选时取绑定第一个）。
- **理由**：形态一与 `cron/handlers.ts`「确定动作不得创建 thread/turn/session」硬约束相容，且是仓库既有做法（`mail-summary.ts`、`translate-zh.ts`）。页面零模型保证即时性与确定性；记忆增量避免重复模型开销。
- **影响**：修订 `docs/BUSINESS.md` 技能计数；新增 `docs/superpowers/specs/2026-09-23-mail-correspondent-workbench-design.md` 与 `docs/superpowers/plans/2026-09-23-mail-correspondent-workbench.md`；后端增记忆列、增量协调器、cron 作业；前端四栏改版。
- **限制**：`docs/ui-ux-rules.md` 与 `docs/DESIGN.md` 唯一数值来源冲突不在本次解决；邮箱通讯页 IA 一等能力登记仍是规则空白。

## ADR-2026-09-23：技能唤起三层入口、声明式参数契约与右栏记忆优先

- **状态**：已接受
- **决定者**：用户（产品发起人，委托专家方案）；智能体产品经理、平台产品经理与 UI/UX 专家职责范围内落地
- **背景**：技能唤起只有「锁定入口」与「from-text 判别」两条散路径；必要参数只是 `required_inputs` 字符串数组，澄清与条件卡各模式硬编码；右栏历史结果读取散在各 hook，记忆存储时机写死在代码里；工作台表面出现 hero 空态、28px/700 标题与硬编码字号，违反 data-dense-dashboard。
- **决定**：① 路由固定为三层入口——L0 记忆快捷（零 thread/turn/model）、L1 Host 锁定（显式 task_type，不再推断）、L2 判别器路由（登记目录内选 ≤1 技能，结构化澄清缺参，低置信出候选点选升级为锁定）；业务词语唤起靠登记 aliases + 判别器，禁止任何一端关键词硬编码。② 技能声明契约扩展进 SKILL.md frontmatter 单一事实源（input_schema / result_type / next_actions / memory_policy / supports），WorkspaceCapability 不另建第二注册表；技能管理面可编辑参数与接口。③ 右栏统一为记忆优先结果区：进入即读登记记忆范围，显示来源与新鲜度，版本可回看，空态诚实给双入口；记忆只在 run 终态且 Host 校验通过后按 memory_policy 写入，失败不覆盖，草稿不进记忆，建议不自动成事实。④ DESIGN.md 增补字号阶梯用途与内容密度规则并执法。
- **理由**：三层入口是 PROD-AGENT-01「入口决定路径、路由显式登记」的直接落地；澄清前置到 Host 层（结构化控件、不烧 Codex turn）与数字员工/Codex 运行时分工一致——Host 管路由、pack 装配、闸门与持久化，Codex 只在 box 内跑一份 SKILL.md 输出 schema 化 Item；参数声明住 manifest 避免注册表双真相源。
- **影响**：新增 `docs/superpowers/specs/2026-09-23-skill-routing-param-memory-design.md`；修订 `DESIGN.md`（字号用途与密度节）与 `BUSINESS.md`（alias 登记裁定）；registry/skill-publish/判别器/resolver 契约扩展；SkillParamCard/ResultRail/NextActionBar 通用渲染器；creator_discovery 试点迁移。
- **限制**：8 个未登记技能的快捷面/Agent 面口径、BIZ-07 公海字段仍是规则空白，待 KOL 业务专家裁定；「AI发现」alias 按用户明确要求登记。机制先行，不编其它业务口径。判别器不可用时保持诚实降级，不加本地关键词兜底。

## ADR-2026-09-26：账户块取代账户菜单（分段切换 + 个人设置 + 退出，去掉弹窗）

- **状态**：已接受
- **决定者**：用户（产品发起人）；UI/UX 专家负责组件呈现与无障碍，平台产品经理负责员工端/管理端通用入口。
- **背景**：员工端与管理端账户区是一个按钮加弹窗菜单（员工工作台 / 管理控制台 / 调试视图 / 个人设置 / 退出登录）。切工作面、进设置、退出都要先开弹窗；当前工作面不可见，窄栏还要另算弹窗定位。
- **决定**：账户区改为常驻「账户块」——身份行（头像首字 + 姓名 + 角色）加控制行：员工端⇄管理端分段切换（`Link` + `aria-current="page"` 表达当前工作面）、个人设置、退出登录；无 admin 模式时不渲染分段。调试视图（`data-debug-toggle`）迁到「个人设置 → 偏好 → 管理员工具」，状态源仍是 `localStorage: ui:debug-view`。管理端页头「← 返回员工工作台」保留。
- **理由**：三件事都是后果明确的常用动作，常驻控件比弹窗少一次点击，且状态可见（形状 + 辅助色 + `aria-current` 三重信号）；调试视图是个人偏好而非高频动作，住 Settings 与「一页一问」一致，也让账户块与用户给定稿的三控件形态一致。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-account-bar-design.md`；`UserMenu.tsx` 由 `AccountBar.tsx` 取代；修订 `docs/ia-information-architecture.md`（导航密度入口形态）；`frontend/src/styles.css` 增账户块、折叠轨道、管理顶栏、抽屉高度与触摸命中区规则；`frontend/e2e/workbench.spec.ts` 改用 `[data-account-*]` / `[data-surface-switch]` 选择器与 `enableDebugView` 帮手。含管理端措辞的 `DESIGN.md` 版本需同步把「账户菜单」改为「账户块」（本分支 DESIGN.md 尚无该节，留待合入时同步）。
- **审宪记录**：需求「用户页面和管理页面用新的账户区：第一个图标切换用户端/管理端，第二个个人设置，第三个退出；图标要更好；弹窗不再需要」→ 主责 UI/UX 专家、平台产品经理 → CONST-04（通用界面与组件呈现职责）、CONST-07（界面由产品与 UI/UX 规范约束）、CONST-08、CONST-10 → 细则：`ia-information-architecture.md` §3「使用 ≠ 治理」、§4 导航密度；`DESIGN.md` §控件尺寸 / §颜色（选中态走 `--accent*`）/ §不变量 1、4、5 / §验收矩阵；`TECHNOLOGY.md` TECH-FE（前端不重写权限、审批与阶段判定）→ **符合**：管理端入口仍只在账户块，admin 判据仍是 `available_modes` / `roles`（`isAdminAccount`）；选中态用辅助色 + 形状 + `aria-current`，不占主 CTA（`--primary` 未使用）；退出登录是会话动作，不新增 L3 确认闸门，也不与发送、删除、解密合并；页脚控件在矮视口与移动抽屉里都给内容让路 → 下一步按 DESIGN 验收矩阵截图核对员工端/管理端、展开/折叠、桌面/触摸，并跑 E2E。
- **限制**：管理员调试视图不再就地开关，需进个人设置（用一次跳转换三控件账户块，是否保留第四图标可由用户再裁决）；管理端页头返回入口与分段切换的重复关系留给下一轮 IA 复核。
- **修订（2026-09-26，同日）**：按用户要求改为**单行**（头像 + 账号名 + 员工端⇄管理端分段 + 个人设置 + 退出登录）并**去掉角色文案**（管理员 / 员工）。控件高度统一降到 `--control-h`（28px）、分段段宽 30px、图标按钮 28px，去掉分段与图标之间的分隔线；账号名弹性收缩 + 省略号。理由与代价：一行放下身份与三个动作，密度更高；角色信息不再就地呈现（管理端入口由分段本身表达，考试阻断仍有 `/exam` 闸门与侧栏「考试 · 待完成」徽标）。折叠 56px 轨道与 ≤720px 顶栏仍各自适配。

## ADR-2026-09-26：连接器管理端界面重做（复刻 + MCP 接口清单 + 连接器级组织范围 + SSE）

- **状态**：已接受（用户 2026-09-26 逐项批复）
- **决定者**：用户（产品发起人）；平台产品经理、UI/UX 专家、架构师、前端/后端专家在各自职责范围内落地
- **背景**：管理端连接器枢纽仍是「内联表单 + 行列表」，与用户提供的参考界面（卡片网格、分类 Tab、创建菜单、配置面板）不符；MCP 工具清单只有逐工具审批形态，没有「查看接口」只读面；组织范围只有逐工具绑定，没有连接器级；运行时只支持 StreamableHTTP；自定义 API（HTTP/OpenAPI）的后端内核存在但生产闸门关闭。
- **决定**：
  1. 按参考界面重做枢纽（「已添加的连接器」/「浏览连接器」两模式 + 搜索 + Tab + 创建菜单）与详情（Hero/接入配置/接口/可用范围/凭据引用/审计六卡）；创建菜单收敛为 自定义 MCP / 通过 JSON 导入 MCP / 通过 URL 添加 MCP。
  2. 新增「接口」只读清单（含 L1/L2/L3、schema 指纹、未审阅默认拒绝），保留逐工具审批与工具级范围。
  3. 新增**连接器级**组织范围（一级部门/二级部门/岗位/个人，read/write 绑定），与逐人授权取并集、作为工具级范围的补充而非放大；部门候选接入 `config/org-registry.yaml` canonical id（手输兜底）；启用闸门接受工具级或连接器级范围。
  4. 运行时新增 **SSE 传输**（`transport: streamable-http | sse`）。
  5. 表单接受**明文秘密值，保存时写入凭据保险库并只存引用**（不采纳「仅引用/仅环境变量」的输入方式；配置与回显仍永不落明文）。
  6. **不放开**自定义 API（HTTP/OpenAPI）生产闸门，本期不做该页签与流程。
- **理由**：枢纽与详情回答的仍是治理问题（挂了哪些、状态、下一步）；卡片网格与 Tab 提升扫描效率且不改变治理语义。连接器级范围把「哪些部门/人能用」从逐工具重复配置中解耦；SSE 是用户实际服务形态；明文值入保险库在保留附件式输入体验的同时不破坏「配置只存引用」的既有法律。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-connector-admin-console-redesign.md`；`connectors.icon_ref`、`runtime_connector_scope_policies/_bindings`、`transport` 配置字段、图标/组织单位/JSON 导入/连接器级范围端点；`frontend/src/admin/connector/*` 新组件；E2E 过时断言迁移。
- **审宪记录**：需求「按附件重做连接器界面；结合现在 api 连接；查看 MCP 服务接口；绑定一级/二级部门、人员」→ 主责 平台产品经理 + UI/UX 专家 → CONST-02/04/05/08/10 → 细则 `07-mcp-data-contract.md`（L1/L2/L3、秘密不落文）、`org-permissions.md`（枢纽/详情职责、凭据永不回显）、`DESIGN.md`（0–1 CTA、状态不靠颜色、token 唯一来源）、`ia-information-architecture.md`（一页一问）→ **符合**：不触碰 L3 Gateway 与发送/阶段/解密闸门；HTTP 闸门按用户裁决保持关闭 → 下一步按规格实施并附类型检查、测试与 E2E 证据。
- **限制**：连接器级范围只做「增加可达范围」，不做封禁（封禁走停用）；部门成员仍按既有节点/岗位匹配解析，本地账号无部门字段的既有语义不变；「项目」Tab 无对象，不做。
- **修订（2026-09-27）**：本条第 2、3 项中的逐工具授权、连接器级组织范围、按人 read/write 与 `connectorHasAnyScope` 启用闸门，由 ADR-2026-09-27「对外只暴露技能」取代并废止；界面重做、SSE、凭据保险库、JSON 导入、图标与只读工具清单仍有效。

## ADR-2026-09-26：管理端左侧菜单复刻员工端外壳（单壳共用）

- **状态**：已接受
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航外壳与三轴适配，平台产品经理负责管理端 IA 不降级。
- **背景**：管理端 `/admin/*` 自持一列 `.admin-nav`——只有品牌文字、一条「管理」kicker 与九个纯文字条目，没有条目图标、没有分簇分隔线、没有 Lucas、没有折叠 56px 轨道，≤860px 还把导航压成横向顶条；员工端侧栏（`Workbench` 的 `.sidebar`）则是「品牌 + Lucas + 折叠按钮 → 分簇图标条目 → 版本号 + 账户块」。用户要求：除菜单文字内容外，管理页左侧菜单必须与员工端完全复刻。
- **决定**：不再给管理端第二列导航。`/admin/*` 且账号含 admin 模式时，**同一个侧栏实例**改渲染管理端条目集合（`frontend/src/layout/adminNav.ts` 的 9 条：员工 / 数据 / 数字员工治理 / 技能 / 知识 / 审批 / 考试 / 连接器枢纽 / 配置），员工条目集合不渲染；`AdminConsole` 交出 `.admin-nav` 列与品牌块，只留 `.admin-shell > .admin-body`（页头 / 健康条 / 面板）。`styles.css` 删除 `.admin-nav*`（含 `--admin-nav-width`、≤860px 横向顶条、暗色与 ≤720px 覆盖），移除 `.workbench.admin-surface` 的隐藏与单列覆盖，并去掉侧栏轨道 / 折叠规则里的 `:not(.admin-surface)` 守卫。管理端分簇按员工端节奏落位（治理日常 2 / 数字员工 1 / 技能 1 / 资产 4 / 平台配置 1），资产簇顺序与员工端一致（知识 → 审批 → 考试 → 连接器）。
- **理由**：① 「完全复刻」只能由同一实例保证——几何、折叠状态、抽屉触发、页脚与焦点态不会再漂移；② 净减 CSS（约 150 行管理端导航专属规则），少一处「两套外壳各自演化」的重复；③ 复刻只动外壳：条目标签、href、面板与权限闸门、页头治理文案全部不变，员工开工条目在管理面不渲染，符合 `ia-information-architecture.md` §3「配套 ≠ 副本」与 §4「管理端顶栏不得跳员工开工入口」。
- **影响**：新增 `docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`；`frontend/src/layout/adminNav.ts`（新）、`Workbench.tsx`、`pages/AdminConsole.tsx`、`styles.css`；过时断言同步 `frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`（`.admin-nav` 选择器 → `.sidebar`，标签顺序改为新分簇顺序），证据脚本 `artifacts/account-footer/capture.cjs` 改抓 `.sidebar` 并新增折叠 / 抽屉截图；`docs/org-permissions.md` §导航规则两行补「同一侧栏外壳」说明。
- **审宪记录**：需求「除了菜单文字内容外，管理页的左侧菜单必须和用户端的左侧菜单完全复刻」→ 主责 UI/UX 专家、平台产品经理 → CONST-04（前端不重写权限判定）、CONST-07（两类界面各受产品与 UI/UX 规范约束）、CONST-08、CONST-10 → 细则：`ia-information-architecture.md` §3 / §4；`org-permissions.md` §管理端配套套件（两侧共用 MASTER token，不得做成第二套 Home / Agents）；`DESIGN.md` §三轴适配（260px 轨道）、§不变量 1 / 4 / 5、§验收矩阵；`TECHNOLOGY.md` TECH-FE → **符合**：管理端只回答谁 / 权限 / 审计，页头与九个面板未动，治理条目仍只走 `/admin/*`；admin 判据仍是 `available_modes`；复刻不含任何发送 / 阶段 / 解密 / 删除闸门 → 下一步按规格 §2 清单逐项截图核对，并跑 typecheck / build / vitest / E2E。
- **限制**：折叠偏好两面共用（同一 `ui:left-collapsed` 与 `left_sidebar_collapsed`）；若要两面独立记忆需另立一项。管理端配置面 `/admin/kol` 仍是遗留页，其内部 IA 不在本次范围。
- **修订（2026-09-27）**：条目顺序与两条文字（连接器枢纽 → 连接、数字员工治理 → 治理）改由 ADR-2026-09-27「管理端左侧菜单条目顺序与展示文字调整」取代；本条的「同一侧栏外壳、只有菜单文字不同」与「分簇 5 簇」仍有效。

## ADR-2026-09-27：「添加自定义 API」创建弹窗 1:1 复刻（端点后置到详情）

- **状态**：已接受（用户 2026-09-27 附参考图，要求必须 1:1 复刻）
- **决定者**：用户（产品发起人）；UI/UX 专家负责版式与交互，平台产品经理与前端/后端专家负责字段与契约落地。
- **背景**：`连接器 → 创建 ⌄ → 自定义 HTTP API` 的创建弹窗与用户附件（「添加自定义 API」）不符：多出「短名 / API Base URL / 自定义 headers / 无鉴权勾选」，缺少图标上传与「密钥（环境变量）」卡片区。参考图只收：名称 / 图标 / 备注（可选）/ 密钥（环境变量），页脚「取消 / 保存」。
- **决定**：
  1. 弹窗按参考图 1:1 重构（`docs/DESIGN.md` §连接器控制台「添加自定义 API 创建弹窗」）：字段集只保留 名称 / 图标 / 备注（可选）/ 密钥（环境变量）+「+ 添加密钥」；短名由名称自动生成（`api-` 前缀）；副标题按参考图文案（Manus → 平台）；名称未填时保存为禁用灰态；多于一张密钥卡时每卡常显「移除」。
  2. 「密钥」即现有的请求头引用（`headers_secret_refs`）：名称是请求头名，值写入凭据保险库，保存后不回显。
  3. **API Base URL 与「该端点明确允许无鉴权」移出创建弹窗**，由详情「接入配置」采集 —— 创建只建「身份 + 密钥引用」草稿。为此 `POST /api/admin/connectors` 新增可选 `protocol`（写入 `connectors.declared_protocol`；分类回退链 = 运行时配置 → 声明协议 → mcp），`validateConnectorConfig` 允许 http 草稿两者都缺省（同时提供仍拒绝；mcp 不变）。
  4. 未填端点时执行、测试连接与工具发现一律 fail-closed（`runtime_endpoint_invalid`），界面按诚实错误呈现，不得表述为可用。
- **理由**：① 用户要求 1:1，参考图的字段集就是产品口径；② 端点与动作属「接入配置」的真实字段，详情已有完整表单与 OpenAPI 导入，创建步骤不必重复采集；③ 先建草稿再补齐端点是既有治理叙事（保存 ≠ 启用；测试 → 审阅 → 范围 → 启用都不变）；④ 声明协议让无配置草稿保持「自定义 API」分类与 HTTP 字段集，不会在配置未建时被误判为 MCP。
- **影响**：`frontend/src/admin/connector/ConnectorPanels.tsx`（`SecretKeysEditor` + `ApiConfigPanel` 重构 + 图标空态 + `autoConnectorId(prefix)`）、`connectorAdmin.css`、`styles.css`（`--secret-card-pad` / `--secret-value-h` / `--help-icon`）、`ConnectorConfigCard.tsx`（无配置草稿按 `card.protocol` 初始化）、`e2e/connector-admin.spec.ts`（HTTP 流程重写 + 新增版式用例）；后端 `db.ts`（`declared_protocol` 迁移）、`routers/enterprise.ts`（POST `protocol` + 分类回退）、`runtime/store.ts`（http 草稿端点放行）；规格增补见 `docs/superpowers/specs/2026-09-26-connector-admin-console-redesign.md`。
- **审宪记录**：需求「连接器点击创建，点击自定义 HTTP API，修改弹窗如上传图片所示，必须 1:1 复刻」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04 / CONST-08 / CONST-09（数值只住 DESIGN.md 与 styles.css）/ CONST-10 → 细则：`DESIGN.md` §连接器控制台（唯一数值来源，改数值先改表）、§不变量 2（L2 草稿必须标注）；`07-mcp-data-contract.md`（秘密只存引用、不回显；真实调用 fail-closed）；`org-permissions.md`（凭据永不回显）→ **符合**：弹窗只建草稿，不触碰 L3；明文值只在提交瞬间存在；端点缺失不被表述为可用 → 下一步按 DESIGN 数值与 E2E 用例取证。
- **限制**：参考图文案中的 Manus 一律写作「平台」；多密钥的「移除」入口是参考图没有、无障碍需要的补充。端点后置意味着「创建即可测试」不再成立，测试前必须先补 Base URL。
- **修订（2026-09-27）**：同日 ADR「对外只暴露技能」取代其中「测试 → 审阅 → 范围 → 启用」里的『范围』——范围不再指员工授权；其余不变。

## ADR-2026-09-27：管理端左侧菜单条目顺序与展示文字调整

- **状态**：已接受（用户 2026-09-27 直接指定顺序与文字）
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航文字与分簇，平台产品经理负责管理端 IA 不降级。
- **背景**：管理端侧栏九条目的顺序与文字沿用 2026-09-26 复刻时的口径（员工 / 数据 / 数字员工治理 / 技能 / 知识 / 审批 / 考试 / 连接器枢纽 / 配置）。用户要求改为 员工 / 连接 / 知识 / 审批 / 技能 / 考试 / 治理 / 数据 / 配置，并明确「连接」即原「连接器枢纽」、「治理」即原「数字员工治理」，只改顺序与展示文字。
- **决定**：`frontend/src/layout/adminNav.ts` 的 `ADMIN_NAV_GROUPS` 按新顺序重排并缩短两条文字；分簇边界随之移动（治理日常 1 / 资产 3 / 技能 1 / 数字员工 2 / 平台配置 2，仍为 5 簇，分隔线条数不变）。`技能` 保持独立一等入口（`ia-information-architecture.md` §4）；`考试` 与「治理」同簇（考试是 `/admin/agents` 的治理闸门）；`数据` 与「配置」同簇（平台级设置）。`data-admin-nav` / `data-admin-tab` id、href、图标、面板与权限闸门全部不变。
- **理由**：用户口径即产品口径；只动条目排列与可见文字，不改任何治理职责、取数路径或闸门，风险面 = 侧栏渲染与两处顺序断言。
- **影响**：`frontend/src/layout/adminNav.ts`、`frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`（`.sidebar [data-admin-nav]` 文字序列）、`docs/org-permissions.md`（§导航规则「管理端信息架构」行的侧栏顺序）、`docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`（§3 菜单映射表）。
- **审宪记录**：需求「管理页面右侧导航调整为：员工 / 连接 / 知识 / 审批 / 技能 / 考试 / 治理 / 数据 / 配置；仅改变导航菜单项的顺序和展示文字」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04（前端不重写权限判定）、CONST-08、CONST-09（细则写死了旧顺序，须同步而非偷改）、CONST-10 → 细则：`ia-information-architecture.md` §4（禁可见组标题、簇间只用分割线、`aria-label` 留给读屏）；`org-permissions.md` §管理端左侧菜单 / §管理端信息架构；`TECHNOLOGY.md` TECH-FE → **符合**：href、id、面板内容、页头与发送 / 阶段 / 解密 / 删除闸门均未变 → 下一步以 typecheck / build / `vitest sidebarNav` / 管理端 E2E 取证。
- **限制**：管理端配置面 `/admin/kol` 仍是遗留页；「连接」「治理」只是入口名，相关面板标题仍为「已添加的连接器」「数字员工治理」等治理文案，两者措辞不一致属预期。
- **修订（2026-10-04）**：本条中的入口名「治理」由 ADR-2026-10-04 修订为「Agent」（图标同步为员工端同款）；条目顺序、href、id、分簇与其余文字不变。

## ADR-2026-09-27：对外只暴露技能（人员授权只对技能）

> **2026-10-03 取代注记：** 本 ADR 的人员授权单位及「员工能否执行由技能授权决定」已由 ADR-2026-10-03 取代；连接器/MCP/API 不直接对员工暴露、资源不按人授权及内部风险闸门继续有效。以下保留历史原文，不作现行规则。

- **状态**：已接受（用户 2026-09-27 裁决：「我们只对技能授权，不然的话管理过细，无法干活」）。
- **背景**：连接器控制台此前引入按人/按部门/按工具的多层授权（员工 read/write、连接器级组织范围、工具级范围、逐工具审阅授权）。用户裁定对外能力面只有技能：连接器、MCP 工具与 API 属平台内核能力；管理过细会导致无法干活。
- **决定**：
  1. 修宪：`CONSTITUTION.md` CONST-02 增加一段——连接器、MCP 工具与 API 是平台内核能力，只对技能与后台任务开放；对员工的能力面只有技能。员工能否执行由技能授权与技能内的工具绑定决定。
  2. 基本法同步修订：`PRODUCT.md` PROD-PLAT-04 / PROD-PLAT-05、`TECHNOLOGY.md` TECH-BE-07、`org-permissions.md` 员工连接器使用面与按人授权段落、`ia-information-architecture.md` 能力面 #6（原位废止并保留记录）。
  3. 人员授权唯一单位＝技能：谁有技能权限谁可执行；技能自决所用工具（技能 × 工具绑定）。
  4. 连接器不按人授权：员工连接器使用面、员工连接器 read/write、连接器级范围、工具级范围的**授权语义**退役；相关数据表保留但不参与运行时校验，不再提供按人授权入口。
  5. 内部门禁不变：`07-mcp-data-contract.md` 的 L1/L2/L3、L3 确认与回执（CONST-05）、host-only 拦截、工具指纹（schema_hash）。
- **启用门禁（替代原「已有范围」）**：测试通过（`status=verified`）且**已被至少一个技能绑定其工具**（存在启用的技能→连接器→工具绑定）。
- **影响资产**：`backend/src/runtime/execution.ts`（执行校验改技能授权）、`backend/src/routers/enterprise.ts`（启用闸门）、`backend/src/runtime/organization.ts`（范围接口退役）、前端 `ConnectorGrantsCard` / `ConnectorScopeCard` / `ConnectorToolsCard` 范围段 / 员工 `/connectors` 面、E2E `connector-admin.spec.ts`；逐文件清单见设计稿 `superpowers/specs/2026-09-27-connector-setup-wizard-design.md`。
- **生效版本**：随「连接器设置向导」实现同批发布；本 ADR 先于代码落地，期间代码现状与本 ADR 不一致处按本 ADR 修正。
- **审宪记录**：需求「对外只暴露技能；取消逐工具/按人授权」→ 主责 平台产品经理 + 权限域 + 架构师/后端 + UI/UX → CONST-02（本次修订）/ CONST-03（支持）/ CONST-05（L3 闸门不变）/ CONST-08/09（修宪与修法记录）/ CONST-10 → 基本法 `PRODUCT.md` PROD-PLAT-04/05、`TECHNOLOGY.md` TECH-BE-07、`org-permissions.md`、`ia-information-architecture.md` → **符合**（按用户修宪决定执行，内部门禁不放松）→ 下一步：设计稿评审后出实施计划。

## ADR-2026-09-28：写邮件默认发件箱＝当前用户挂载的邮箱；任务中栏只留一条滚动轴

- **状态**：已接受（用户 2026-09-27 直接要求：「写邮件如果没有指定发件箱，默认就是当前用户挂载的邮箱」「任务中栏多了一个区域输出 codex 思考过程，删除该区域，将思考过程拼接在中栏，通过滚轮进行自然滑动」）。
- **决定者**：用户（产品发起人）；KOL 业务专家与后端负责发件箱口径，UI/UX 专家与前端负责中栏几何。
- **背景**：① `backend/skills/email_compose/SKILL.md` 已写明默认发件邮箱是登录用户绑定的 Starry 邮箱，但 `preparedSender` 之后把它丢掉：核对不过就返回空，写邮件停在「待补：发件邮箱」，草稿卡「确认发送」置灰。② 提交 `a5c1990` 把技能交互模板块放进**不滚动**的任务头部，块内又自带 `max-height/overflow-y`（`frontend/src/components/skill-template-context.css`），任务详情中栏因此出现第二条滚动轴：模板卡占掉头部、时间线被压成一条缝，滚轮在头部与卡片上不产生滚动。
- **决定**：① 未指定发件箱时按「请求显式指定 → 当前用户挂载的 Starry 邮箱（`user_starry_bindings.is_default`）→ 合作记录 `mailbox_from` → 当前品牌唯一授权箱 → 留空」解析，规则只住 `backend/src/host/compose-sender.ts` 一处。挂载邮箱只在品牌与范围核对通过时使用：品牌取 `mailbox_owners` 登记，没有登记时用调用方给出的明确品牌（当前合作品牌）并要求该品牌在员工授权范围内；共用邮箱要求本人是 owner 或 `shared_with`。任何一步都不得从多个候选里取第一只（BIZ-04）。② 技能交互模板等中栏内容并入唯一滚动容器 `.session-stream`，`.session-skill-template` 不再自带滚动条；新内容只在用户本来就在底部时才跟随滚动。
- **理由**：① 是 BIZ-04「实际发件箱必须属于员工获准使用的品牌及范围」与 SKILL.md 默认口径的落地——默认来自用户自己的绑定，不是从候选列表挑第一只。② 是 `DESIGN.md`「中栏时间线与右栏结果体各自滚动」与 `docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`「InteractionTimeline ← 唯一中栏滚动容器」的执法。
- **影响**：`backend/src/host/compose-sender.ts`（新增）、`pep.ts`（From 授权分支与 `enforceSend`）、`api.ts`（prepare / 草稿落库 / 卡片载荷 / `PATCH /drafts/:did` 的 from_addr）、`frontend/src/pages/Chat.tsx`、`frontend/src/components/skill-template-context.css`、`frontend/src/components/ChatBlocks.tsx`、`frontend/src/api.ts`。
- **补充决定（同日，用户要求）**：任务详情页的**中栏与右栏改为复用今日任务工作台的视觉 token 与几何**：右栏宽度＝`clamp(--workspace-result-rail-min, --workspace-result-rail-ideal, --workspace-result-rail-max)`、收起＝`--workspace-result-rail-collapsed`；工作区可用宽度＝`.home-stage` 同款（`width: min(100%, --content-max)` + `padding-inline: var(--page-gutter)`）；栏首留白、hairline 颜色、字号/行高/控件（24px `--icon-btn`、`--radius-control`、`--surface-hover`、`--focus-ring`）与 composer 宽度（`--composer-maxw` 居中、dock 不再二次内缩）全部走同一组 token；收起/展开按钮复用今日任务右栏的 `.scope-task-rail-toggle` 控件（真控件：`aria-expanded`、悬停面、可见焦点环、收起态竖排标签）；两栏各只保留一条滚动轴（中栏 `.session-stream`，右栏 `.side-body`）。
- **影响（补充）**：`frontend/src/styles.css`（`.session-shell` / `.session-center` / `.task-detail-header` / `.session-stream` / `.session-composer` / `.side-workbench` / `.side-body` / 字号 token）、`frontend/src/components/SideWorkbench.tsx`（按钮与收起态标记）、`frontend/e2e/workbench.spec.ts`（跨页宽度对照与单滚动轴断言）。
- **审宪记录**：需求「默认＝用户挂载的发件箱 + 任务中栏单滚动轴」→ 主责 KOL 业务专家/后端 + UI/UX 专家/前端 → CONST-04（前端不重写权限）、CONST-05（L3 闸门不变）、CONST-09、CONST-10 → BIZ-04、`email_compose/SKILL.md`、`DESIGN.md`（工作台几何与不变量 5）、统一工作台规格 §7 → **符合**（属实施细则执法与实现补齐，未改法条；挂载邮箱仍受品牌与范围约束，发送仍走确认、幂等与回执）→ 下一步：后端用例与 E2E 取证。
- **限制**：`BRAND_MAILBOX_*` 仍是真实外发白名单；未登记品牌归属的挂载邮箱只有在本人挂载、调用方给出明确品牌且该品牌在其授权范围内时才作为默认，否则退回品牌箱。KOL 会话头部（journey/SOP）几何本次未收敛，矮视口裁切风险仍在。

## ADR-2026-09-28：候选推荐与「采纳为待办」不得混入「今日任务 / 我的待办」

- **状态**：已接受（用户 2026-09-28 报告「今日任务和我的任务又出现了这个，不合逻辑，这个是哪个版本引进来的」）。
- **决定者**：用户（产品发起人）；UI/UX 专家与前端负责渲染归属；平台产品经理保留「推荐块最终住哪个面」的归属决定。
- **背景**：截图里的三行（如「给 @测试1号 超时/风险扫描」「给@100705721 写合作邮件」＋「采纳为待办」）不是任务列表行，而是右栏「下一步动作」（`NextActionBar`）渲染的 `workbench.recommendations`。它出现过两轮：第 1 轮 `4649c43`（2026-09-16，画在今日任务中栏列表内）被次日 `8cdac8d` 删除；第 2 轮 **`e85b12a`（2026-09-23 22:57 +0800「feat(workspace): complete generic skill result and density work」）**把 `recommendations` / `onAdoptRecommendation` 接进今日任务与我的待办**共用**的 `ScopeWorkspace` 右栏，两个页签因此显示同一份行，`status` 又被硬编码为 `candidate`，采纳过的行按钮也不会消失。修复 `eca9156`（2026-09-26）只活在分支 `fix/today-todo-scope`，从未合入主干；`14c2b69`（2026-09-28）加的 board 预热（`void loadBoard("following")`）让这三行在首次进 Home 时就出现。
- **决定**：候选推荐不属于平台任务脊柱。`frontend/src/home/ScopeWorkspace.tsx` 不再接受 `recommendations` / `onAdoptRecommendation`；`frontend/src/pages/Home.tsx` 不再传这两个 prop，并删除唯一消费者 `convertSuggestion` 与从未渲染的 `recommendedItems`。后端的 `buildRecommendedTasks`（`backend/src/host/home-board.ts`）与采纳接口 `POST /api/tasks/recommendations/:id/adopt`、审计事件「采纳为待办」保持不变；`NextActionBar` 继续服务 `registeredActions`（AI发现 / 公海 / 我跟进的红人）。
- **理由**：`ia-information-architecture.md` §1 一页一问（每个表面只回答一个问题，不得把另一表面的信息架构或主 CTA 抄过来）与五模式段落（今日任务 / 我的待办是平台任务脊柱，两模式共享的是布局与状态语义）；推荐属候选面（后端测试 `backend/tests/discovery.test.ts:361`「AI发现 is not 今日任务 recommendations」）；两页签是同一判定下的互斥分流（`superpowers/specs/2026-09-22-today-todo-reuse.md`），候选推荐不在其中；`DESIGN.md` 不变量 1（同一视口 0–1 个实底主 CTA）。
- **影响资产**：`frontend/src/home/ScopeWorkspace.tsx`、`frontend/src/pages/Home.tsx`、`frontend/e2e/home-today-pane.spec.ts`（断言范围从 `[data-today-list]` 扩到整个页签，并先等 board 响应，避免抢在首次绘制前通过）、`frontend/e2e/home-pane-parity.spec.ts`（新增「两个页签右栏都不得出现候选推荐」用例）。
- **审宪记录**：需求「今日任务 / 我的待办不得出现候选推荐与采纳为待办」→ 主责 UI/UX 专家/前端 + 平台产品经理（归属）→ CONST-04（前端只实现已定义规则）、CONST-10（交付必须可验证）→ `ia-information-architecture.md` 一页一问与平台任务脊柱、`DESIGN.md` 不变量 1 → **符合**（执行既有 IA 与 CTA 不变量，未改法条；采纳能力与其审计事件保留）→ 下一步：E2E 取证。
- **限制**：推荐块今后住「AI发现」还是「我跟进的红人」属产品归属决定，本次未定；`eca9156` 的后端一半（today↔todo 互斥分流与 `isAwaitingApproval` 等）未随本次移植，另开一轮。

## ADR-2026-09-28：公海 / 我的红人「分析已选」提交后立即执行（入队接既有任务运行链路）

- **状态**：已接受（用户 2026-09-28 选定「方案A」：提交后 Codex 应真实执行，处理过程在中栏可见）。
- **决定者**：用户（产品发起人）；前端专家负责提交链路，KOL 业务专家负责分析执行口径。
- **背景**：`2026-09-27` 公海交互迁移后，中栏四个入口只预填草稿（`Home.tsx` `prefillPoolQuestion`），提交命中 `Home.tsx` 的 analyze 分支，只调 `POST /api/home/kol-analyze/enqueue` 写一条 `queued` 工作项（`routers/kol-memory.ts`，响应自报 `creates_session:false / calls_model:false`）。全仓创建 `task_runs` 只有两处——人工 `POST /api/tasks/:id/run` 与规划运行，没有任何消费者把排队中的 `kol_analyze` 推进为运行。因此「提交 → Codex 执行 → 中栏处理过程」这段链路实际断路：Codex 不执行、不建会话，中栏无从展示推理（用户验收报告「codex没有执行，中栏没有展示推理过程」）。
- **决定**：提交在入队成功后，立即用返回的 `work_item_id` 调用既有 `POST /api/tasks/:id/run`（`text` 携带完整提问框正文），并沿用 `openRun` 打开会话；执行、停止、恢复全部沿用既有任务运行链路，不新增接口、不新造状态机。`queued` 工作项保留为耐久凭据；「不走 from-text、不冒充副作用」的既有语义不变。该 analyze 分支同时服务「我的红人」的「分析已选」（`analyzeSurface=following`），两处语义一致。
- **理由**：CONST-10（等待必须有真实原因、阶段与恢复入口；入队后无执行者、无恢复入口）；`docs/superpowers/specs/2026-09-23-unified-agent-workspace.md`（「对象分析、澄清和过程进入中栏」；`queued/running` 需真实状态）；`docs/BUSINESS.md` 将 `kol_analyze` 的 Agent 面登记为规则空白——本决定以「不新造口径、复用既有运行链路」的最小方式补齐。
- **影响资产**：`frontend/src/pages/Home.tsx`（analyze 分支：取消检查 + `api.runTask` + `openRun`）、`frontend/e2e/home-pool-follow.spec.ts`（用例改为断言「入队 + run + messages(ask) + 落到 `/s/:session` + 完整 prompt 传递」）。
- **审宪记录**：需求「公海分析提交后 Codex 真实执行、中栏可见过程」→ 主责 KOL 业务专家 + 前端专家 → CONST-04（前端不重写权限与阶段规则，只编排既有受控接口）、CONST-08、CONST-10 → BIZ-16、PROD-AGENT-01、统一工作台规格 §6.1 → **符合**（未触碰发信 / 改阶段 / 领取 / 解密边界；`kol_analyze` 仍为只读分析，仍受技能授权与硬顶 3 约束）→ 下一步：E2E 取证。
- **限制**：入队后到运行之间若进程退出，工作项留在 `queued`，恢复入口仍是任务列表打开（与既有任务一致）；通讯页「快速分析」直连入队的入口不在本次范围（其既有验收仍为「点击即入队、不建会话」）。

## ADR-2026-09-28：工具风险档由平台自动推导，测试即登记（不设界面审批）

- **状态**：已接受（用户 2026-09-28 裁决「不要审批工具」；审宪记录随本决定重写）。
- **决定者**：用户（产品发起人）；平台产品经理负责治理面与登记口径；后端专家负责推导与登记实现；UI/UX 专家负责技能页挂载解阻；测试经理负责证据。
- **背景**：连接器设置向导落地（ADR-2026-09-27）后，「配置 → 授权 → 挂载 → 识别」在控制台内走不完：工具策略只有 API 且前端零调用（`frontend/src/api.ts` 的 `saveRuntimeConnectorPolicy` 无消费方；`ConnectorToolsCard` 标注「本页不做授权」）；技能页空态把管理员指向「连接器详情逐项审批」，该入口不存在；技能页挂载开关在连接器停用时被禁用，而每次测试通过都会把连接器置回 `enabled=0`，启用门禁又要求先有绑定——UI 自锁（后端 `runtime/store.ts` 的绑定本不要求连接器启用）。设计稿 §3 已定「风险档由平台按 07 文档规则自动推导（可内核覆盖），仅作为内部门禁与审计字段，不再作为界面上的『授权』操作」，§8 开放项 #1 待定推导规则。2026-09-28 实测远端 Starry KOL MCP 62 个工具均无 MCP annotations。
- **决定**：
  1. **推导规则落定**（唯一实现处 `backend/src/runtime/tool-catalog.ts` 的 `deriveToolPolicy`）：发布名单（`config/connector-risk-floor.json` 的 host-only 名单）与敏感命名家族 `send*/delete*/decrypt*/import*/upload*/clear*/confirm*` → **L3**；只读命名家族 `page*/list*/get*/read*/search*/query*/status*/summarize*/translate*/download*/count*/fetch*/check*` → **L1**；其余（草稿、预览与无法判定者）保守落 **L2**。`access`：L1 = `read`，L2/L3 = `write`。
  2. **测试即登记**：`POST /admin/runtime/connectors/:id/probe` 成功（且为 MCP 连接器）时自动登记/刷新工具策略——缺失行按推导创建（L1/L2 `enabled=1`；L3 登记但 `enabled=0`，不进技能面）；既有行保留 risk/access/enabled（管理员/内核覆盖不被回写），仅在指纹变化时刷新 `schema_hash`。审计 `runtime.tool_catalog.registered`（created/refreshed/skipped 计数）。`discovery` 保持纯只读（Discovery is not a grant）。
  3. **界面调整**：技能页「工具挂载」不再因连接器停用禁用挂载开关（与后端语义一致），保留诚实提示「启用并通过验证前不会向 Skill 提供工具」；「已审批工具」表述改为「已登记工具」。**不新增逐工具审批界面**；既有工具策略接口保留作覆盖/停用通道。
- **理由**：执法性落地——把 `07-mcp-data-contract.md` 的 L1/L2/L3 语义与设计稿 §3 的「平台自动推导」从条文落成实现，并关闭设计稿开放项 #1；不放宽任何门禁（授权单位仍是技能；挂载仍逐项手动；L3/host-only 仍走 Host/Gateway；发送与阶段等正式副作用链路不变）。
- **影响资产**：`backend/src/runtime/tool-catalog.ts`（新增）、`backend/src/routers/connector-operations.ts`（probe 登记 + 审计）、`backend/tests/tool-catalog.test.ts`（新增）、`backend/tests/connector-operations.test.ts`、`frontend/src/components/SkillConnectorBindings.tsx`、`frontend/src/admin/connector/ConnectorToolsCard.tsx`、`frontend/e2e/skill-tool-mounting.spec.ts`（新增）、`docs/skill-runtime-operations.md`、`docs/superpowers/specs/2026-09-27-connector-setup-wizard-design.md`（开放项 #1 关闭注记）。
- **审宪记录**：需求「管理员在控制台完成 配置→平台自动登记工具→技能挂载→启用→识别；不设工具审批界面」→ 主责 平台产品经理 + 后端专家 + UI/UX 专家 + 测试经理 → CONST-03（确定的权限与状态规则由程序执行）、CONST-04（前端不重写规则：推导只住服务端，页面只调用既有接口）、CONST-05（L3 确认与回执不放松；L3 行自动 `enabled=0`）、CONST-08/09（开放项按记录关闭）、CONST-10（验收证据）→ 基本法 `TECHNOLOGY.md` TECH-BE-07 与 ADR-2026-09-27（授权单位＝技能）、`07-mcp-data-contract.md` 工具风险目录、`ia-information-architecture.md`（只动治理面，员工面不变）→ **符合**（执法与 UI 解阻；未改法条；不放宽门禁）→ 下一步：定向测试与 E2E 取证（见验收追加记录）。
- **限制**：推导为命名家族 + 发布名单的启发式（远端无 annotations，无法从 schema 语义证明无副作用）；名单外的写类工具（如 `updateRiskDefinition`、`batchSaveRiskRules`、`addMailbox`）保守落 L2，需要更严时把名字加入 `config/connector-risk-floor.json`（该资产按发布纪律评审）；既有策略行不随推导规则升级回写，需显式覆盖或删除重建。

## ADR-2026-09-29：采纳 paperclip 借鉴——成本与预算、项目/活动承载与数字员工治理增强

> **2026-10-03 部分取代：** 本 ADR 第 5 项当时不采纳的 Agent 组织树用于「Agent 汇报线 / chain of command」；用户新法现要求用权威人员组织树做 Agent 使用绑定与负责人继承。该权限绑定由 ADR-2026-10-03 生效，仍不建立 Agent 互相汇报线或多运行时。以下保留历史原文。

- **状态**：已接受（用户 2026-09-29 裁决：成本覆盖至项目层；活动隶属项目；其余按分析建议采纳）。
- **决定者**：用户（产品发起人）；平台产品经理、智能体产品经理、KOL 业务专家、架构师/后端专家、UI/UX 专家在各自职责范围内落地。
- **背景**：对 [paperclipai/paperclip](https://github.com/paperclipai/paperclip)（MIT）的 agent / org / cost / project 四块做了借鉴分析。其成本与预算（cost events、按 Agent/项目月汇总、80%/100% 阈值与硬停）、项目承载（项目分组工作项、目标追溯）、Agent 生命周期治理值得借鉴；其 Agent 汇报线 / 自动招聘 / 多运行时与 `domain-objects.md`「Agent 无独立运行时、无专家团 API」、`ia-information-architecture.md`「数字团队保留未实现、禁止假导航」冲突。本仓现状：LLM 成本完全缺失；「项目」为 IA 占位（`/api/projects` 实为 collaborations 视图，`work_items.project_id` 全为 NULL）；Agent 无状态位与暂停恢复；Codex app-server 协议已含 `account/usage/read`（估计用量）与 `threadGoal.tokenBudget`，backend 零引用，本机实测可用。
- **决定**：
  1. **成本与预算**：按 paperclip 形状采纳改造——`cost_events`（provider/model/tokens/金额字段预留）+ 按公司 / Agent / 项目汇总 + 月预算 + 80% 警示 / 100% 硬停。用量唯一来源＝本仓 Codex app-server `account/usage/read`（估计值，事件须标注来源）；金额换算只在有版本化价格来源时提供，缺价格只显示 tokens；硬停是**运行前程序闸门**，不采纳 paperclip「Agent 自查预算」的软约束（CONST-03）。
  2. **成本覆盖到项目层**：`cost_events.project_id` 预留，按项目汇总随 Phase 2（项目实体）交付。
  3. **项目/活动**：活动隶属项目；KOL 业务语义由 KOL 业务专家补入 `BUSINESS.md`（BIZ-19），平台按 PROD-PLAT-03 承载；口径未发布前保持明示占位（禁止假完成）。
  4. **数字员工/Agent 治理增强**（Agent 状态位、暂停/恢复、组织 × 数字员工只读归属视图）采纳，属治理面，Phase 3。
  5. **不采纳（记档）**：Agent 汇报线 / 组织树 / chain of command、自动招聘审批、多运行时适配器（BYOA）、workspaces / 插件 / 公司导入导出；如未来立项须先修订 PRODUCT 与 `ia-information-architecture.md`。
- **理由**：① 成本是当前最大缺口，且协议原生数据源可实测、不必造假（CONST-10）；② 项目的可配置承载与「活动隶属项目」贴合 BIZ-01「公司 + 品牌 + 活动 + KOL」与 PROD-PLAT-02「KOL 项目属于业务包」；③ 治理增强落在既有 ia §3「使用 ≠ 治理」与 `/admin/agents` 治理面；④ paperclip 为 MIT，可参考设计与形状，但技术栈不同（Postgres/Drizzle vs 本仓 SQLite/手写 SQL），借概念不复制代码。
- **影响**：修订 `PRODUCT.md`（PROD-PLAT-02 能力表增补「成本与预算」；新增 PROD-PLAT-08）、`BUSINESS.md`（新增 BIZ-19 项目与活动）、`ia-information-architecture.md`（#11 项目/活动、Admin 问题域、§3 新增成本行）、`org-permissions.md`（管理端信息架构侧栏新增「成本」）。新增设计稿 `superpowers/specs/2026-09-29-cost-and-budget-design.md`、实施计划 `superpowers/plans/2026-09-29-cost-and-budget.md`、实施登记表 `implementation-registry.md`。代码资产：`backend/src/costs.ts`、`backend/src/routers/costs.ts`、`backend/src/db.ts`（两表）、`backend/src/worker/runner.ts`（闸门与采集）、`backend/src/host/api.ts`（错误卡与终态）；前端 `/admin/cost` 与导航。
- **审宪记录**：需求「借鉴 paperclip 的 agent/org/cost/project 到本项目的智能体与项目能力」→ 主责 平台产品经理（成本能力与治理面）+ KOL 业务专家（项目/活动语义）+ 智能体产品经理（Agent 治理）+ 后端专家/架构师 → CONST-02（业务口径不进内核）/ CONST-03（规则由程序执行）/ CONST-05（不放松发送、阶段、解密、删除闸门）/ CONST-08/09（修法记录）/ CONST-10（不得伪造、缺口如实）→ 基本法与细则：PRODUCT（PLAT-02/03/05 与新增 PLAT-08）、BUSINESS（BIZ-01/17 与新增 BIZ-19）、TECHNOLOGY（TECH-TEST-04 成本监控、TECH-BE-08 追溯）、`ia-information-architecture.md`、`org-permissions.md` → **符合（并补齐规则空白）**：成本能力条目与项目/活动口径随本 ADR 补齐后实施；不触碰 L3 闸门；不新增员工面导航 → 下一步：Phase 1 实施（后端采集 / 闸门 / 接口 + 前端成本治理面）与测试取证（见设计稿与实施计划）。
- **限制**：Phase 1 仅计量 `runWorker` 主链路（6 个调用点）的用量；辅助 Codex 调用点（邮件摘要、翻译、简报、意图识别等）未计量，登记为已知缺口；金额换算未建（`cost_cents` 恒 NULL）；`account/usage/read` 的 threadUsage 字段语义以真实环境联调为准，缺失按缺口呈现、不得以 0 冒充；「项目/活动」具体字段与状态机属规则空白；管理端侧栏仅新增一条「成本」（数据 / 成本 / 配置），其余文字与顺序不变。
- **修订（2026-09-29，同日）**：按用户追加要求，成本汇总与预算范围覆盖**员工个人**：`cost_events.user_id`（迁移见 `db.ts` migrateSchema）、汇总新增 `users`、预算 `scope=user`；运行前闸门判定顺序为 公司 → Agent → 员工。同步更新 `PRODUCT.md`（PLAT-08 口径）、`ia-information-architecture.md` §3、设计稿与实施登记表。


## ADR-2026-09-29：按技能声明批量挂载连接器工具，并由服务端状态恢复向导入口步

- **状态**：已接受。
- **决定者**：用户（产品发起人）；平台产品经理负责治理动作与呈现口径；后端专家负责扫描读模型与批量写入；UI/UX 专家负责向导与技能页。
- **背景**：启用连接器的门禁是「已验证 + 至少一个技能把它已登记的工具挂到可用状态」（`connector_skill_binding_required`），但控制台里走不通：技能页要管理员先勾连接器、再逐个勾工具（`SkillConnectorBindings`），每次测试通过又把连接器置回 `enabled=0`；而技能的定义里其实已经写明了它需要哪些工具（`backend/skills/<id>/SKILL.md` 的 `mcp: ["<connector>.<tool>", …]`，经 `tasks/registry.ts` 解析），平台却没有用这份声明做任何事。同时弹窗每次都从「保存」开始，已通过测试未启用的连接器重开时要重新走一遍。
- **决定**：
  1. **扫描读模型**（`GET /admin/runtime/skills/coverage`）：把「技能定义 / 数字员工绑定 / 发布阶段」与「声明工具 vs 连接器已登记工具 vs 运行时挂载」对齐成一个只读视图，工具状态只有五种：`mounted` / `available` / `blocked_by_policy` / `unregistered` / `unknown_connector`。实现度只有两档：**已上线**＝已挂启用的数字员工且 `stage=published`，其余为**待上线**。判定全部在后端，前端只呈现。
  2. **按定义挂载**（`POST /admin/runtime/connectors/:id/mount-declared`）：一次确认后，对目标技能（默认＝扫描出的已上线技能）先启用「技能→连接器」绑定，再对**声明里有的、连接器已登记且策略已启用**的工具逐条启用「技能→工具」绑定。跳过项如实回报（`policy_disabled` / `policy_unregistered` / `unknown_connector`），幂等，审计 `runtime.skill_mount.declared`。**不启用连接器、不启用工具策略、不挂声明之外的工具。**
  3. **向导按服务端最近状态进入**：已启用或已验证 → 「启用」步；验证失败 → 「测试」步；其余 → 「保存」步（新建仍是「保存」）。启用步显示服务端记录的上次测试时间与工具数，并承载「按技能定义挂载工具」这一次要动作；启用仍是该步唯一实底 CTA。详情页启用被拒时给出同一个动作。
  4. **技能页呈现**：列表行标出「已上线/待上线」与「工具 已挂/声明」，新增「实现度」筛选与整页汇总，详情「工具与知识」页给出按连接器分组的声明—挂载对照。
- **理由**：CONST-03/04（判定与写入在服务端，前端不重写规则）；CONST-05（挂载是治理写入，走确认 + 回执 + 审计；L3 不自动放行）；`07-mcp-data-contract.md`（工具风险目录、测试即登记、L3 闸门）；`BUSINESS.md` 覆盖表（技能是实现单位）；CONST-10（扫描读不到就写明缺哪一块，不用占位数字）。技能声明早已存在，用它对齐比让管理员手工枚举更不容易漏挂，也不放宽任何门禁。
- **影响资产**：`backend/src/runtime/skill-coverage.ts`（新增）、`backend/src/runtime/store.ts`（只读聚合）、`backend/src/routers/skill-runtime.ts`（两条路由）、`backend/tests/skill-coverage.test.ts`、`backend/tests/skill-declared-mount.test.ts`（新增）、`frontend/src/admin/connector/ConnectorSetupWizard.tsx`、`frontend/src/admin/connector/ConnectorDetail.tsx`、`frontend/src/admin/connector/useDeclaredToolMount.ts`（新增）、`frontend/src/admin/connector/wizardSteps.ts`（新增）、`frontend/src/components/SkillDeclaredDependencies.tsx`（新增）、`frontend/src/pages/SkillLifecycle.tsx`、`frontend/e2e/skill-coverage.spec.ts`（新增）、`frontend/e2e/connector-admin.spec.ts`、`docs/DESIGN.md`（§连接器设置向导）、`docs/skill-runtime-operations.md`。
- **审宪记录**：需求「解掉『尚无技能绑定其工具』、扫描规划技能的实现度、按定义默认挂载 Starry KOL 工具、弹窗保留最近状态」→ 主责 平台产品经理 + 后端专家 + UI/UX 专家 → CONST-03、CONST-04、CONST-05、CONST-08、CONST-10 → `BUSINESS.md` 覆盖表与 §技能；`07-mcp-data-contract.md` 工具风险目录、真实调用规则；`DESIGN.md` §连接器控制台 / §连接器设置向导；`TECHNOLOGY.md` 治理接口 → **符合**（只呈现既有事实并给出一个有确认与回执的治理动作；未改启用门禁、未自动启用、未放行 L3）→ 下一步：定向测试 + E2E 取证 + 真机走查。
- **限制**：技能声明里的遗留名字（`starry.get_collaboration` / `starry.deal_memory` / `starry.list_collaborations`）当前没有对应连接器，扫描会如实标为 `unknown_connector` 并跳过，不在本次补映射；「已上线」只由运行时事实推出，不代表 `BUSINESS.md` 的员工口径已补齐（8 个未登记口径的技能仍由员工端按原文案提示）；扫描不做远端调用，工具是否仍真实存在以连接器详情的一次通过测试为准。

## ADR-2026-09-30：任务运行状态诚实化——开始即执行、终态必达、重启对账

- **状态**：已接受（CONST-08 审查结论：按现行条款修正实现差距，不改法条、不放宽闸门）。
- **决定者**：后端专家（运行生命周期与对账）；前端专家（状态与过程呈现）；UI/UX 专家（布局、空态与无障碍）；智能体产品经理（排队/执行/失败/恢复的可见性口径）。
- **背景**：用户报告两个画面：① Home「今日任务」同屏出现「规划完成」与「识别中 / 这次分析有点久」两套口径；② 进入任务会话后 HUD 显示「待命 + 任务开始处理」、任务徽标「进行中」，中栏三张重复的「任务进度」卡停在「任务开始处理」，右栏写着「本轮结果 · 结果 / 本轮结果会出现在这里。中间是处理过程。」。代码级根因：`POST /sessions/:sid/messages` 在任何校验之前就调用绑定函数把运行写成 `running` 并落「任务开始处理」；其后的授权校验、忙时入队、「会话已停止」、进程退出等分支都不收盘，运行永远停在 `running`；队列只存在于进程内存；终态事件文案是英文，前端一律降级成「正在处理这项工作」；每条任务事件各渲染一张「任务进度」卡并自动展开「分析摘要」；HUD、徽标与右栏各算各的状态。
- **决定**：
  1. **开始即执行**：绑定拆为「只读校验」（`resolveBoundTask`）与「真正开始时才写 running + run.started」（`startBoundTask`）；忙时入队只写 `queued` +「已排队（轮到时自动开始）」；被拒绝/已停止的请求必须写终态（`run.failed` / `task.cancelled` / `run.stopped`），不再留半启动的运行。
  2. **终态必达且可读**：终态文案由后端给出中文（「结果已生成，等待你确认」/「执行失败：{原因}」/「已停止生成；已保留已产生内容」）；停止生成落工作项状态 `stopped`，可重新执行。
  3. **重启对账**：Host 启动时把仍为 `running` 的任务运行按「执行被中断；未产生结果，可重新执行」收尾（`backend/src/host/task-run-recovery.ts`）；`pending`/`queued` 保留为「已排队」。
  4. **前端单一状态口径**：新增 `frontend/src/runViewState.ts`，RunHud、任务徽标与右栏取同一状态；历史里程碑不再冒充「当前阶段」；「刷新页面不会取消后台执行」只在排队/执行中显示；终态任务给出「重新执行」入口（复用 `POST /tasks/:id/run`）。
  5. **过程与文案收敛**：任务事件合并为一条「任务进度」（连续重复合并、终态附原因）；「分析摘要」默认折叠；任务开始后技能契约收进「技能说明 · 只读」折叠；右栏去掉「本轮结果 · 结果」重复与解释布局的占位句；Home 等待卡阈值 12s→30s、不再劝「再发一次」（改为「完成后会自动打开任务页，可继续等待」）并标明「已收到你的请求」。
- **理由**：AGENTS §4「真实等待必须有原因、阶段与恢复入口；不得伪造进度」、TECH-BE-04（异步作业持久化状态/终态/错误/回执）、PROD-AGENT-09（排队/执行/失败/取消可见并给恢复入口）、TECH-FE-01/03、DESIGN.md §不变量 3/4 与 §内容密度；不触碰阶段、审批、发送与解密等 L3 闸门。
- **影响资产**：`backend/src/host/api.ts`、`backend/src/host/task-run-recovery.ts`（新增）、`backend/src/index.ts`、`backend/tests/task-run-recovery.test.ts`（新增）、`backend/vitest.config.ts`；`frontend/src/runViewState.ts`（新增，含单测）、`frontend/src/pages/Chat.tsx`、`components/{RunHud,SideWorkbench,ChatBlocks}.tsx`、`components/skill-template-context.css`、`hooks/useRunStatus.ts`、`agentUx.ts`、`waitStatus.ts`、`home/recognizeWait.ts`、`pages/Home.tsx`、`frontend/e2e/session-task-run.spec.ts`（新增）；`docs/implementation-registry.md`。
- **审宪记录**：需求「分析卡死与状态矛盾，并优化过程体验与视觉布局」→ 主责 后端专家 + 前端专家 + UI/UX 专家 → CONST-03（确定的状态规则由程序执行）、CONST-05（确认与回执不放松）、CONST-08/09（记录，不偷改法）、CONST-10（不伪造进度）→ PROD-AGENT-08/09、TECH-FE-01/03、TECH-BE-03/04、`07-mcp-data-contract.md`（真实调用与异步契约）、`DESIGN.md` → **符合** → 下一步：全量回归与真实环境走查。
- **限制**：队列仍是进程内存态——重启后 `queued` 任务保留「已排队」但需人工重新执行（自动续跑登记为缺口）；「正在打开任务会话…」的交接态未做；里程碑行内时间未展示；`frontend/src/pages/Mail.tsx` 存在与本变更无关的既有类型错误，会阻塞 `npm run build` 的 tsc 阶段（本次以前端产物 `vite build` 单独验证）。
- **修订（2026-09-30，同日）**：按用户对「今日任务／我的待办中栏思考过程又造假」的反馈（截图里 6 条步骤同一秒、标题停在「规划中」而列表已 ✓ 今日规划已完成、看不到真实业务分析），追加修正：① Host 里程碑（读记忆 / 打包增量 / 提交 Codex / 写入简报）改为 `upsertTaskEvent` 且写下即 `done`，摘要给真实计数与去向，不再留永远 running 的过程行让界面替它猜状态；② 「正在生成今日简报」语义收窄为 Host 校验并写入展示记忆，成功/失败都在同一 item_key 收尾；完成事件摘要改为「已更新今日/待办展示」；③ 前端 `effectivePlanPhase` 把 `run.completed` 也当终态（与失败对称），标题与计时器随终态收口；④ 中栏新增「Codex 业务分析」块，直接展示 `brief.reasoning`（模型按 SKILL.md 要求写的中文业务理由）与完成时刻，不再被折叠掉——此前该字段在界面完全未被渲染；⑤ 步骤按文案去重。资产：`backend/src/host/today-plan-run.ts`、`frontend/src/home/todayPlan.ts`、`home/TodayPlanProgress.tsx`、`home/ScopeWorkspace.tsx`、`home/today-plan-progress.css`、`frontend/src/home/todayPlan.test.ts`、`frontend/e2e/home-plan-analysis.spec.ts`（新增）。证据：后端 `tests/today-plan.test.ts` + `today-brief-real-output.test.ts` 33/33；前端 `todayPlan` 26/26、`runViewState` 4/4；`vite build` 通过。
- **验证（2026-10-01）**：① 后端全量套件（`node scripts/test.mjs`，独立 Vite 缓存、无并发负载）137 文件通过 / 5 失败，1328 通过 / 8 失败 / 1 跳过（1337）；8 条失败逐条归因——`host contracts > every home task runs a worker…` 是测试自身 30s 预算在本机被超过（`--testTimeout=180000` 下 35.4s 通过）；`skill-publish` 2 条与 `host contracts > skills sop is edited…` 是技能治理/发布口径与现行实现的落差（不在本次改动面）；`kol-memory` 2 条头像补全是抓取公开主页的外部依赖；`async-worker > acknowledges creator discovery immediately…` 与 `kol workbench contract (#172) > …进行中 counts…`（`frontend/src/home/kolContract.ts` 属工作区未提交改动）已由 stash A/B 分别证实在本次改动之前即红。② 前端 E2E：本次改动相关用例全绿（`session-task-run` 1/1、`home-plan-analysis` 1/1、`home-plan-trace` 5/5、`workbench` 定向 4/4）；分支既有 E2E 存在大面积红（全量跑到 [253/158] 超时，31+ 条失败集中于跟进红人、邮箱、审批等未提交改动面）：对 `home-today-pane:30`、`home-discovery-pane:597`、`workbench:971/1765/2326` 做了「暂存本次全部改动 + 重构建」的 A/B，失败完全相同；`workbench:428` 依赖的 `[data-open-work-panel]` 在 HEAD 的 `Home.tsx` 里也已不存在（由 `a78c00f` 移除），属过期用例。

## ADR-2026-10-01：视觉唯一来源收口——DESIGN.md v2 重写、ui-ux-rules.md 退役与《2B 端视觉 Token 体系》吸收

- **状态**：已接受（用户 2026-10-01 裁决：A 以 `DESIGN.md` 为准；B 登记 `ontop/` 为非规范材料；C 采纳《2B 端视觉 Token 体系》方向并经裁定并入）。
- **决定者**：用户（产品发起人）；UI/UX 专家（视觉细则重写与吸收）；项目经理、规范所有者（索引与记录对齐）；架构师（AntD 选型待办，见「限制」）。
- **背景**：`docs/ontop/` 新增研究笔记《2B 端视觉 Token 体系》，自检发现与现行法条多项冲突（平行数值来源、品牌色 `#1677ff`、对比度未验证、L1–L3 未映射、`DESIGN.md` 引用失准等）；且 `docs/DESIGN.md` 与 `docs/ui-ux-rules.md` 自 2026-09-21 起并存、互相声明「唯一来源」（已登记未决）。用户裁决后：① 根 `AGENTS.md` §3/§4 与 `docs/AGENTS.md`、`README.md`、`ia-information-architecture.md`、`org-permissions.md`、`BUSINESS.md`、`VERIFICATION.md` 的视觉引用统一改为 `DESIGN.md`（CONSTITUTION 2.2 修订记录在案）；② `DESIGN.md` 重写为 v2 beta（去营销风——弹窗字阶/圆角向工作台对齐、参考图只定结构；信息去重（不变量 6）；防挤压（不变量 7）；业务语义色并入四职责；「关键操作区无滚动」；中栏滚动行为 §10）；③ `DESIGN.md` 吸收笔记中未覆盖的动效与 `prefers-reduced-motion` 降级、等宽字体 `--mono`、间距 `--space-*`、深色默认（修订说明⑦）。
- **决定**：
  1. `DESIGN.md` 为员工端视觉 token 与布局**唯一**来源（覆盖员工端全部工作台表面：Home 五模式、Pipeline、Admin、一等能力面）。
  2. `ui-ux-rules.md` 的「唯一来源」主张原位废止并保留记录（CONST-09），保留作迁移对照；未承接条款（设备适配断点/密度细节等）按需裁定；无障碍偏好必测已并入 `DESIGN.md` §3.1/§13。
  3. `ontop/` 为非规范候选材料；《2B 端视觉 Token 体系》已并入 `DESIGN.md`，保留作来源记录。
  4. v2 重写对 ADR-2026-09-26/27 的「逐像素复刻」口径与 34px/14px 弹窗参数、「整窗无滚动」予以替代：参考图只定信息结构、不定视觉比例；弹窗控件高与圆角向工作台对齐（32px/8px）；「无滚动」修正为「关键操作区无滚动」（旧 ADR 中对 `DESIGN.md` 旧分节的引用按 v2 编号理解）。
- **理由**：① 单一来源与「候选 → 裁定 → 并入」程序（CONST-08/09）收口；② 不新增色相、以四职责与既有 token 收敛外来源；③ 补齐无障碍与中栏体验（`prefers-reduced-motion`、§10）；未放宽任何执行闸门。
- **影响资产**：`docs/DESIGN.md`、`CONSTITUTION.md`（2.2）、根 `AGENTS.md`、`docs/AGENTS.md`、`README.md`、`ia-information-architecture.md`、`org-permissions.md`、`BUSINESS.md`、`VERIFICATION.md`、`ui-ux-rules.md`、`ontop/2B端视觉Token体系.md`；待同步：`frontend/src/styles.css`、`frontend/src/admin/connector/connectorAdmin.css`、`frontend/e2e/connector-admin.spec.ts`（差距见 `implementation-registry.md` UX-DESIGN-04）。
- **审宪记录**：需求「以 DESIGN.md 为准；不符合的法条改之使其符合；DESIGN.md 吸收笔记」→ 主责 UI/UX 专家 + 项目经理 → CONST-04（视觉规范职责）、CONST-08（先审宪再审法）、CONST-09（细则层级、修法记录、原位废止）、CONST-10（不伪造、差距登记）→ 细则：`DESIGN.md`、根 `AGENTS.md` §3/§4、`docs/AGENTS.md` §1/§6、`README.md`、`ia-information-architecture.md`、`org-permissions.md`、`VERIFICATION.md`、`TECH-ARCH-01`、`TECH-TEST-02` → **符合**（未改任何执行闸门；实施差距按登记跟踪）→ 下一步：UX-DESIGN-04 落点同步与开放项裁定（见「限制」）。
- **限制**：① §12 `theme.darkAlgorithm` 依赖 AntD 选型未决——组件选型属架构师（TECH-ARCH-01），当前实现为纯 CSS + Vite；裁定前按 CSS 深色作用域理解；② `ui-ux-rules.md` 未承接的设备适配断点/密度细节待按需迁移；③ 实现落点差距与新 token 定义见 `implementation-registry.md`（UX-DESIGN-04），完成后过 G7（CSS token 与 DESIGN 一致）。

## ADR-2026-10-01（二）：本体三表落地——对象注册表、统一业务事件表（business_events）与独立工单表（tickets）

- **状态**：已接受（用户 2026-10-01 决策：按《概念落地对照表-总表》§六「先立三张表」落地；工单表采用**独立 `tickets` 表**，其余按方案）。
- **决定者**：用户（产品发起人）；KOL 业务专家（对象/属性/事件/票型口径，照录待确认）；智能体产品经理＋平台产品经理（载体口径）；后端专家（实现）；架构师（统一事件表与分域表关系）。
- **背景**：冷启动第 1 步的现状——工单表已建（`work_items` 四表）、事件表分域已建（`audit_events`/`task_events`/`crawl_job_events`/`cost_events`/`stage_transitions`）、对象注册表未建（GAP-01）；且事件清单 §0.3 的最小字段（发生/接收时间分离、幂等键、外部回执、前后 diff）分域表不覆盖。用户审阅方案后裁决：工单表立独立 `tickets` 表（按 ticket 方式，含客服/邮件等票型），其余采纳。
- **决定**：
  1. **对象注册表**：`config/objects-registry.yaml`（对象卡 63＋属性卡 214，全量自《对象清单》《属性清单》，来源空白照录）＋ `validate:registry` 校验收口；按《概念设计方案》§2.1 以 YAML＋Git 为唯一载体，本批不做 DB 表与读接口（管理端本体页随 GAP-21）。
  2. **事件表**：`config/event-catalog.yaml`（99 条事件类型目录）＋统一不可变表 `business_events`＋服务＋`GET /api/events`；本批接线两条——阶段写入（`confirmStage` 同事务）与邮件到达（`rememberItem`，仅 inbound）；其余域后续逐批迁入，分域表保持原职责不变。与《概念设计方案》§3.1「先读路径、不立即建表」的差异按用户「立表」指示执行并在此记录。
  3. **工单表**：独立表 `tickets`（票型目录 `config/ticket-types.yaml`：10 kinds × 4 channels）；每张工作项至多一张工单（`work_item_id` 部分唯一）；票面镜像列（status/priority/due_at/risk_level/title/assignee）由触发器 `work_items_ticket_mirror` 从 `work_items` 同步，应用层不重复写；创建只在唯一函数 `ensureTicketForWorkItem()`（5 处接线）＋启动对账 `reconcileTickets()` 兜底；删除工作项级联删票。
- **理由**：CONST-02（平台承载、业务专家定义）、CONST-03（规则有程序执行点）、CONST-06（事实/知识/记忆分离）、CONST-10（不伪造、空白照录）；「发送 ≠ 推进阶段」等不变量不变；独立表带来的双真相源风险以「单一创建函数＋触发器镜像＋启动对账＋测试」控制；扩展路径（票型=改配置、字段=加列、专属数据=卫星表）不依赖第二张主表。
- **影响资产**：`config/{objects-registry,event-catalog,ticket-types}.yaml`；`backend/scripts/validate-registry.mjs`、`backend/package.json`、`backend/scripts/release-gate.mjs`；`backend/src/db.ts`、`backend/migrations/018_business_events.sql`、`019_tickets.sql`；`backend/src/business-events.ts`、`routers/events.ts`、`tickets.ts`、`app.ts`、`seed.ts`、`adapters/starry.ts`、`starrykol/mail-sync.ts`、`routers/tasks.ts`、`host/today-plan-run.ts`、`routers/kol-memory.ts`、`discovery.ts`、`home-discovery.ts`；`backend/tests/{business-events,tickets,registry-config}.test.ts`；`docs/db-data-dictionary.md`、`docs/superpowers/specs/2026-10-01-ontology-three-tables-design.md`、`docs/implementation-registry.md`。
- **审宪记录**：需求「先立三张表：对象注册表＋事件表＋工单表；按照三份清单；工单表按 ticket 方式（客服、邮件等）；先出思路、确认后实施」→ 主责 KOL 业务专家＋智能体/平台产品经理＋后端专家 → CONST-02、CONST-03、CONST-05、CONST-06、CONST-08、CONST-09、CONST-10 → PROD-PLAT-02/03、PROD-AGENT-04~07；BIZ-01/02/10/11/12/14/16/18；TECH-BE-03/04/05/06；`07-mcp-data-contract.md`；`docs/AGENTS.md` §4/§5 → **符合**（照录＋机器可读化＋接线；空白照录不补；不新增业务口径）→ 下一步：全量验证（`validate:registry` / `validate:contracts` / `typecheck` / `npm test` / 发布门禁）与空白交业务专家确认。
- **限制**：`tickets` 本批不提供独立列表接口与前端呈现（票面 UI 批次再建）；镜像只覆盖票面主字段（`description` 等不随编辑同步）；目录条目的 `blank/designed` 为照录现状；事件接线仅 2 域，其余域迁入时逐域审宪。
- **修订（2026-10-01，同日，用户追加决策）**：用户要求「把 `work_items` 上的数据迁移到 `tickets`，并删除 `work_items`」→ 落地为**换表**：`migrateSchema` 新增 `mergeWorkItemsIntoTickets()`（丢弃旧镜像表 → 旧 `work_items` 重命名为 `tickets`，SQLite 同步改写 `task_runs`/`task_events`/`task_artifacts`/`employee_today_briefs`/`employee_todo_briefs` 的外键引用 → 补票型列 → 清理镜像触发器与旧索引名 → 重建 `tickets_*` 索引）；历史行票型分类由 `tickets.ts` `reconcileTickets()` 在启动时一次性回填（`app_state` 键 `tickets_classified_v1`）。迁移判定含防数据丢失分支（`tickets` 已有真实数据时保留 `tickets` 并告警丢弃 `work_items`）。镜像表与镜像触发器（`work_items_ticket_mirror`）整体删除；`tickets.status` 成为唯一状态源，接口的 `ticket_status` 改为派生展示值。**历史列名 `work_item_id` 与内部别名 `work_items`/`work_item_count` 保留**（避免二次大范围改名，登记为已知限制）。证据：`tests/tickets.test.ts` 8/8（含旧库合并迁移实证）、`npm run typecheck` 通过、全量套件复跑（见实施登记 ONT-03）。


## ADR-2026-10-01（三）：知识库分层重构（主题域族 → 主题域 → 知识库）与结构化优先

- **状态**：已接受（用户 2026-10-01 决策：方案 C ＋ WeKnora 承担非结构化层、结构化自建；知识按三层分类；前端重做；**先实现结构化**）。
- **决定者**：用户（产品发起人）；智能体产品经理＋平台产品经理（分类口径与 IA）；KOL 业务专家（主题域实例与内容）；后端专家（实现）；UI/UX 专家＋前端专家（前端重做）；架构师（非结构化接入，后续）。
- **背景**：知识治理链已建（`draft→pending_review→published→archived`、版本/回滚/`expected_version`、`knowledge_grants`、`knowledge_bindings`、`resolveForSkill`），但**没有分类层级**——全仓「主题域」零命中；而 `docs/superpowers/specs/2026-09-26-knowledge-base-skill-agent-design.md` 明文「不引入命名空间重表」（§12）并把外部命名空间映射为「范围＋grants」（§3.2）。用户要求：知识按「主题域族 → 主题域 → 知识库」分层、知识库再分结构化/非结构化、前端重做、流程遵循 WeKnora，且结构化先落地。
- **决定**：
  1. **分类层**：新表 `knowledge_domains`（族/域两级，邻接＋同父下 code 唯一）与 `knowledge_bases`（库＝容器＋策略，`kind ∈ structured|unstructured`，非结构化库留 `external_ref` 映射外部知识服务）；`knowledge` 增 `base_id`/`structured`(JSON)/`source_body`(不可变原稿)；`knowledge_versions` 补 `tags`/`in_market`/`effective_at`/`expires_at`（现状快照缺这四列，回滚会丢字段——一并修）。
  2. **分类不承载权限**：可见范围仍走组织/品牌/区域与 `knowledge_grants`；本 ADR 同时**作废**上述细则的「不引入命名空间重表」条款，并在该细则 §3.2 / §4.3 / §5.2 / §12 原位修订（CONST-09 修法记录）。
  3. **流程借 WeKnora、闸门保留本仓**：不可变原稿＋当前内容＋单调版本（乐观锁）＋快照＋**回滚即新版本**；非结构化阶段沿用其 `pending→processing→finalizing→completed` 与阶段时间线、卡死重试；**保留「审核后生效」**，不采用「索引即生效」。
  4. **实施顺序**：结构化（分类层＋条目字段＋库容器＋管理端/员工端重做）先落地；非结构化（解析/分块/索引/向量/ASR、WeKnora 接入）随后另案。
  5. **前端**：管理端知识治理子视图改为 `review|catalog|base|entry|ingest|bindings`（DOM 契约同步改）；员工端 `/kb` 增加「族→域→库」导航；**治理只在 Admin**、员工面不外露治理动作；不动管理端导航簇（导航密度）。
- **理由**：CONST-02/04（业务分类由业务专家定义）、CONST-03（分类与库类型由程序校验）、CONST-06（知识保留来源/版本/时间）、CONST-10（非结构化显式标注未实现）、TECH-ARCH-01（新增分类表须说明需求与迁移影响——本 ADR 即说明，且不引入新服务）；分类与权限分离，避免重复一遍组织/品牌维度。
- **影响资产**：`backend/src/db.ts`、`backend/migrations/020_knowledge_domains_bases.sql`、`backend/src/host/knowledge.ts`、`backend/src/routers/knowledge.ts`、`config/knowledge-kinds.yaml`、`frontend/src/pages/{AdminKnowledge,Knowledge}.tsx`、`frontend/src/admin/knowledge/*`、`frontend/src/knowledgeCopy.ts`、`docs/superpowers/specs/2026-09-26-knowledge-base-skill-agent-design.md`、`docs/ia-information-architecture.md`、`docs/domain-objects.md`、`docs/db-data-dictionary.md`、`docs/implementation-registry.md`。
- **审宪记录**：需求「知识分领域：主题域族→主题域→知识库；知识库分结构化/非结构化；遵循 WeKnora 流程；先实现结构化；前端重做」→ 主责 智能体产品经理＋平台产品经理（分类口径与 IA）＋KOL 业务专家（业务分类）＋后端/前端专家（实现）→ CONST-02/03/04/06/08/09/10、TECH-ARCH-01、PROD-PLAT-04/05、PROD-AGENT-04~07、BIZ-02/18、`ia-information-architecture.md` §1/§2#5/§3/§4、`org-permissions.md` 知识库行、`DESIGN.md` §1/§8/§11 → **符合（含一处细则修订）**：分类口径先在细则原位修订并留本记录，再动代码 → 下一步：按 P0→P6 分批实施，非结构化另案。
- **限制**：本批不做非结构化解析/分块/索引/向量/ASR 与 WeKnora 接入；不做域级权限；不改管理端导航；`kind` 字典仅增 `prompt`，其余扩展（faq/case）仍属业务口径空白。
- **修订（2026-10-02，用户决策）**：非结构化层引擎由「WeKnora 承担」改为 **PageIndex 本地模式 ＋ 多模态规整层**（用户评估后定调：「pageindex 够了，音视频有多模态大模型解决」），属本 ADR 第 4 条「非结构化另案」的落点。四项同批决策：① 检索直接使用 PageIndex 文档问答（答案＋页级引用；自带 LLM key、OpenAI 兼容端点）；② 文档级授权 v1 用「发布即可见＋品牌/范围」，文档级 grants 后续；③ 音视频产出全文转写稿＋摘要（可溯留档）；④ P1 先只开管理端（试算验证质量后再开 Worker 通道）。第 3 条中「沿用其 `pending→processing→finalizing→completed`」的流程语义保留为状态机设计参照（落为本仓 `uploaded→normalizing→indexing→pending_review→published→archived`，含失败/取消/重试与重启对账），**WeKnora 的平台、解析与向量能力不引入**；不采用 PageIndex Cloud（数据出本机）；不引向量库与 embedding。详细设计见 [specs/2026-10-02-knowledge-unstructured-pageindex-design.md](superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md)（含审宪记录与落档清单）。

## ADR-2026-10-04：管理端侧栏「治理」改名「Agent」（图标对齐员工端）

- **状态**：已接受（用户 2026-10-04 直接指定）
- **决定者**：用户（产品发起人）；UI/UX 专家负责导航文字与图标，平台产品经理负责管理端 IA 不降级。
- **背景**：`/admin/agents` 入口自 2026-09-27 起显示为「治理」（原「数字员工治理」），图标为独立机器人头；用户要求显示名改为「Agent」，图标同步调整。
- **决定**：`frontend/src/layout/adminNav.ts` 的 `agents` 条目 `label` 改为 `"Agent"`、`icon` 改用员工端 Agent 条目同一描边路径（`Workbench.tsx` 气泡机器人）；条目顺序、分簇、`id`、`href`、面板与权限闸门全部不变。parity spec §3 映射表此前即登记该行图标「同员工端」，本次使实现与该登记相符。
- **理由**：用户口径即产品口径；同名「Agent」在员工端与管理端使用同一图形，减少两套近似图标的分歧；管理页标题本就为「Agent 列表 / Agent 详情」，改名后菜单与页面口径一致。
- **影响**：`frontend/src/layout/adminNav.ts`（label / icon / 注释）、`frontend/src/layout/sidebarNav.test.ts`（labels 断言 + 图标同源断言）、`frontend/e2e/workbench.spec.ts`（管理端区块同步至 14 条并更换标题断言）、`frontend/src/pages/SimplePages.tsx`（遗留 `/admin/kol` 页链接文字）、`docs/org-permissions.md`（§导航规则·管理端信息架构行）、`docs/superpowers/specs/2026-09-26-admin-sidebar-shell-parity.md`（§3 映射表）。
- **审宪记录**：需求「管理端左栏导航治理菜单改名为 Agent，图标也修改」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04 / CONST-07 / CONST-08 / CONST-09 / CONST-10 → 细则：`ia-information-architecture.md` §4（组名仅读屏、无可见组标题）；`org-permissions.md` §管理端左侧菜单 / §管理端信息架构（本次同步）；parity spec §3 → **符合**：只动可见文字与图形，href / id / 面板 / 权限闸门不变；锁死文案的测试与文档显式同步（非偷改）→ 下一步以 typecheck / build / vitest `sidebarNav` / 管理端 E2E 取证。
- **限制**：「工单治理」「治理日常」（aria）「治理审计切片」等同词不同物不改；`docs/ontop/智能体-清单与定义.md`（非规范研究笔记）未随改。

## ADR-2026-10-04（二）：账户块头像端到端——`/api/me` 补 `avatar_url`，全员经组织人员关联解析

- **状态**：已接受（用户 2026-10-04 要求「左侧底部面板头像从员工信息表读取真实头像；所有的员工登录都取头像」）
- **决定者**：用户（产品发起人）；后端专家负责接口补全，UI/UX 专家负责回退与呈现（不变）。
- **背景**：445ff0b（2026-10-03）已建立 `organization_people.avatar_url`、`avatarUrlForUser()` 与前端 `AccountBar` 图片分支，并声明「/api/auth/status、/api/me、/api/admin/users 均带 avatar_url」；实际 `GET /api/me` 未返回该字段，而侧栏会在延迟后用 `/api/me` 覆盖 AuthGate 账号，导致左下头像恒为首字母。
- **决定**：`backend/src/routers/misc.ts` 的 `GET /api/me` 增加 `avatar_url: avatarUrlForUser(user.id)`（与 `auth.ts` `userPublic()`、`enterprise.ts` `safeUser()` 同口径）；前端不改（`AccountBar`、`styles.css`、`Account.avatar_url` 类型在 748e886 已就绪）。「所有员工」依赖既有组织人员关联（`organization_people.user_id` 为唯一权威）：已建库显式执行 `backend/scripts/org-registry-replay.ts --apply` 回填组织值，再执行 `import-org-accounts`（`npm run db:import:org-accounts -- --apply`）按工号邮箱精确匹配回填既有账号关联；两者均为既有工具与既有匹配规则。
- **理由**：完成既有承诺而非新增能力；头像与 `person_ref` / `employee_no` 等共用同一 `user_id` 关联口径（不新增读取期推断规则）；无头像 / 未关联保持首字母回退。
- **影响**：`backend/src/routers/misc.ts`、`backend/tests/enterprise-auth.test.ts`（`/api/me` 头像断言）；运行时数据按环境执行重放与账号导入（本次已在隔离 PG 验证库完整演练通过：重放 → 导入后 19/19 在册人员关联、18 张真实头像就位；目标环境按同一步骤执行）。
- **审宪记录**：需求同上 → 主责 后端专家 + UI/UX 专家 → CONST-08 / CONST-10 → 细则：TECHNOLOGY.md 前后端实施与测试登记；`organization-tree` 运行时契约为既有实现 → **符合**：只读自身信息，不涉 L2/L3 闸门；不以文档或测试冒充完成（CONST-10），以接口断言与实机核验取证 → 下一步：开发库重放 → 导入账号关联 → 登录核验。
- **限制**：不引入读取期的邮箱回退等新关联规则（关联规则变更须由责任角色另行裁定）；员工头像的写入接口（上传 / 编辑）不存在，属另立需求；Postgres 基线与 auth-disabled / Postgres-only 部署形态的侧栏可见性按部署环境另行核实。


## ADR-2026-10-06：技能「配好即可用」——工具对照已登记目录、展示元数据进技能文件、员工选智能体、后台作业执行身份

- **状态**：已接受（用户 2026-10-06：「都采纳，执行」，含四项决定按推荐）
- **决定者**：用户（产品发起人）；平台产品经理负责技能治理口径，后端/前端专家负责实现。
- **背景**：「连接器绑好工具 → 技能写好 md 并挂载工具 → 智能体装配技能」本应即可工作，但 `creator_library_all` 等技能还依赖多处按技能 ID 写死的代码：技能可声明工具的代码白名单（`ALLOWED_TASK_MCP`）、前端图标/来源/漏斗/填空模板常量、结果卡片标题与下一步动作、员工有多个可用 Agent 时被直接拒绝、首页红人库同步由 Host 直连远端（违背 `07-mcp-data-contract.md`「不得 Host 代调作为第二真相源」）。
- **决定**：
  1. **工具声明对照已登记目录**：技能 md 的 `mcp` 只校验 `<连接器>.<工具>` 引用格式；是否可用对照 `runtime_tool_policies`（连接器 tools/list 发现、管理员已定风险档）。编写时可存草稿并标注「未登记/未挂载」；**进入测试或发布时**（真实执行模式）若有未登记或未挂载的所需工具即拦截。原白名单更名为 `LOCAL_STUB_MCP_TOOLS`，只用于本地 stub 箱配置。
  2. **展示元数据进技能文件**：`icon`（图标库编号）、`badge`（来源徽章）、`starter`（填空模板）、`result_title`（结果卡片标题）与既有 `category`/`funnel`/`aliases`/`next_actions` 一起写在技能 md 文件头部；内置技能可在管理端经「草稿 → 发布」覆盖这些展示字段（`skill_presentation_overlays`），运行契约（工具、必填、权限）仍随代码发布。执行面（已挂载连接器，未挂载时为声明的连接器）与风险档（所需工具在目录里的最高档，受控动作下限一律 L3）**读取时派生、不存储**。
  3. **员工选择智能体**：员工发起任务时沿用当前会话最近使用、且仍可用的智能体；同一技能装在多个可用智能体上时返回 `runtime_agent_ambiguous`（409，附候选），由员工选择后按原内容重新提交。后台调用方仍优先技能声明的运行 Agent。
  4. **后台作业执行身份**（原规则空白，本 ADR 补齐）：设平台系统智能体 `agent:platform-sync`（不对应人员、不能绑定组织或人员、人员含管理员都不能使用）与系统主体 `system:platform-sync`（只能使用该智能体）。首页红人库同步改由它运行 `creator_library_all` 的 `listAllKolProfiles`，与员工技能执行同走「智能体 → 技能 → 连接器 → 工具」挂载与风险档闸门；后台作业不得执行需要确认的工具。凭据取连接器的组织级配置。
- **理由**：CONST-10（不以写死的代码冒充治理配置，未挂载时如实失败）、`07-mcp-data-contract.md` §工具风险目录与 §真实调用规则（工具经 tools/list 登记、风险档分级、不得 Host 代调）、CONST-05（人员资格经 Agent 绑定；系统主体不是人员，不进入人员覆盖）。
- **影响资产**：`backend/src/tasks/registry.ts`、`backend/src/tasks/result-presentation.ts`、`backend/src/host/skill-presentation.ts`、`backend/src/host/skill-publish.ts`、`backend/src/host/skill-lifecycle.ts`、`backend/src/host/skills-catalog.ts`、`backend/src/runtime/{skill-coverage,execution,store,managed-agents,organization-tree,platform-principal,platform-run}.ts`、`backend/src/starrykol/{service,library-sync}.ts`、`backend/src/worker/session-items.ts`、`backend/src/routers/{misc,tasks,admin-agents}.ts`、`backend/src/host/api.ts`、`backend/skills/*/SKILL.md`（迁入展示字段）、`frontend/src/skillIcons.ts`、`frontend/src/pages/{SkillCatalog,SkillHub,SkillLifecycle,SkillPresentationEditor,Chat,SimplePages}.tsx`、`frontend/src/{taskStarters,agentConfig,api}.ts`。
- **审宪记录**：需求「连接器绑工具、技能写 md 并挂载、智能体装配技能即可工作，不应另外开发」→ 主责 平台产品经理 + 后端/前端专家 → CONST-05 / CONST-08 / CONST-09 / CONST-10 → `07-mcp-data-contract.md` §工具风险目录、§真实调用规则；TECHNOLOGY 工具风险目录 → **符合（含一处规则空白补齐：后台作业执行身份，由用户裁定）** → 下一步：类型检查、构建、PostgreSQL 测试库上跑后端用例，目标环境挂载 `creator_library_all → starrykol.listAllKolProfiles` 后核验首页红人库同步。
- **限制**：结果卡片按技能 ID 写死的部分尚未全部迁移——`email_conversation_list`（按数据计算动作）、`creator_contact_decrypt`、写信与缺参提示等 L3/特殊流程仍在代码中；前端 `STARTERS` / `SKILL_REMOTE` / `SKILL_LABEL` 保留为拿不到目录数据的调用点兜底；红人库同步改用组织级凭据，目标环境若只有个人 Starry 令牌可用，需管理员补组织级凭据，否则同步如实失败。

## ADR-2026-10-08：发现搜索定时任务强行放过——解除采集门禁、系统模板与后台采集通道

- **状态**：已接受（用户 2026-10-08 明确指令「发现搜索必须每天定时跑，强行放过」；四项决策点全按推荐开工）
- **决定者**：用户（产品发起人）；KOL 业务专家负责发现/候选业务口径，后端专家负责采集队列与执行身份，平台产品经理负责定时任务通用功能。
- **背景**：系统定时任务 `discovery-search`（每天 6:00）被四道门禁拦住：POST 建任务 409、PATCH 发布 409（`routers/cron.ts`）、`assertHandlerGates` / `assertJobRunnable` 409（`cron/authz.ts`）、handler 永远返回 skipped（`cron/handlers.ts`），理由是代码级治理「禁止从定时作业调用采集器」。该治理只存在于代码注释与 stub 中，未写入三部基本法正文；发现流水线（request/run/candidate）仍在 SQLite 兼容层，cron 模块要求 handler 保持 PG 原生。
- **决定**：
  1. **废除「禁止从定时作业调用采集器」代码治理**：删除上述四处 409/skip 门禁。废除原因：用户明确指令发现搜索必须每天定时跑；替代治理见下（只产候选、排队不抢占、回执诚实）。
  2. **系统发现模板**：cron job `condition.system_template = {platform, keywords[], filters, dedup}`；系统作业条件只读的唯一例外——`discovery-search` 的 `system_template` 允许管理员经 PATCH 读写（前端模板编辑 UI 另案叠加，本次只开放接口）。种子默认空模板 + `disabled`；既有库由 `pgEnsureSystemCronJobs` 原地回填模板结构（保留已配模板、状态列不动）。
  3. **后台采集通道**（`backend/src/crawl/background-crawl.ts`，平台主体 `system:platform-sync` 专用窄口径例外）：免除「技能装配在可用 Agent 上」的人员使用资格校验——平台同步 Agent 按 bootstrap 只装只读技能（`side_effects === "none"`），本通道不触碰该治理；保留的闸门：工具参数口径校验（与交互式 `validateStart` 同口径）、连接器「已启用 + 已配置」校验、采集排队 FIFO、同一时间只跑一个采集的不变量、运行回执诚实。handler 保持 PG 原生：`enqueueSystemCrawl` 把采集需求写入 `runtime_crawl_jobs`（crawl job id 由 cron job/run 确定性派生，天然幂等），只入队不抢占，启动由 `drainCrawlQueue` 按 FIFO 决定；monitor / starter / results 的平台主体分支走直调 MCP 通道（不经过技能装配发现）。
  4. **候选归属与铁律**：候选写入系统发现池（`actor_id = system:platform-sync`），按员工授权范围可见（沿用 `applies: "employee_authorized"`）。铁律保留：定时跑只产候选，绝不自动创建 Collaboration、不做排他认领（BIZ-05；`homeDiscoveryFollowForbidden` 语义不动）。
  5. **采集位与失败语义**：每天 6:00 触发；忙时写入排队等待，不抢占；队列满（默认 20）或 MediaCrawler 连接器未配置/未启用时记 `skipped` 并写明原因；模板关键词为空时记 `skipped`（「系统发现模板未配置关键词」）；参数非法等配置错误记 `failed`（需管理员处理）。成功提交记 `succeeded`，回执含采集需求 id 与排队位置。
- **理由**：CONST-01（替员工完成已授权的简单重复劳动）；CONST-05（定时任务的发布即明确授权，覆盖已定义范围内的自动任务；不扩大授权——只产候选）；CONST-02（平台与业务分离：handler 只做采集需求提交，不定义业务口径；模板是配置不是写死）；CONST-07（后台事件独立入口）；CONST-10（回执诚实，不伪造运行）；BIZ-10（发现依据可追溯、不编造联系方式——handler 不编造结果）；BIZ-05（候选跟进需员工点击确认）；TECHNOLOGY.md §83（异步采集与定时任务持久化状态、终态、错误与回执）；`docs/AGENTS.md` §5（MediaCrawler 单任务异步作业——复用 runtime-gates 队列机制）；ADR-2026-10-06（后台作业执行身份——平台主体走相同挂载校验；本 ADR 的窄口径例外不扩大平台同步 Agent 的只读装配）。
- **影响资产**：`backend/src/crawl/background-crawl.ts`（新）、`backend/src/crawl/runtime-gates.ts`（`enqueueSystemCrawl`、starter/monitor/reconcile/callRemoteCrawlTool 的平台分支、`validateStart` 参数校验抽取共用）、`backend/src/crawl/results.ts`（`collectCrawlResults` 平台分支）、`backend/src/cron/{contracts,handlers,authz,postgres-store}.ts`、`backend/src/routers/cron.ts`、`docs/DECISIONS.md`（本条）。
- **审宪记录**：需求「发现搜索每天定时跑，强行放过既有门禁」→ 主责 KOL 业务专家 + 后端专家 + 平台产品经理 → CONST-01 / CONST-02 / CONST-05 / CONST-07 / CONST-08 / CONST-10 → 细则：BUSINESS.md BIZ-05 / BIZ-10；TECHNOLOGY.md §83；`docs/AGENTS.md` §5；ADR-2026-10-06（后台作业执行身份）→ **符合**（用户明确授权；废除的仅是代码级治理，未入基本法正文，以本 ADR 记录废除原因与替代治理；平台主体采集通道为窄口径例外，不触碰平台同步 Agent 只读装配）→ 下一步：后端 tsc、相关单测、patch 交付；目标环境配置模板关键词后发布启用。
- **限制**：前端系统模板编辑 UI 本次不做（另案叠加，`Cron.tsx` 另有并行改版）；系统池候选在员工端发现页的呈现随模板 UI 一并做；平台主体凭据取连接器的组织级配置，个人账号凭据会如实失败（见 ADR-2026-10-06）；连接器配置表目前只在 SQLite 兼容层维护，`assertCrawlConnectorAvailable` 是与 runtime action gate 相同的显式只读基础设施配置读取（非业务数据、非静默回退）。
