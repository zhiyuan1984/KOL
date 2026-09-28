# 公海工作台：中栏概要、右栏筛选与评分动作收敛

- **日期**：2026-09-27
- **模式**：Redesign · Preserve
- **范围**：Home「公海」模式。调整中栏摘要、分析动作与右栏第一行工具；不更改公开 DTO、选择上限、领取权限、阶段、后端命令或分析任务契约。

## 审宪记录（CONST-08）

| 需求 | 主责角色 | 宪法 / 基本法依据 | 结论与证据 | 下一步 |
|---|---|---|---|---|
| 将“公海对象 N”作为中栏首行概要；将搜索、两个状态筛选、三个可逆排序和全选迁回右栏第一行；中栏仅保留四条分析/评分动作 | UI/UX 专家、智能体产品经理、前端专家、KOL 业务专家 | CONST-03/04/05/08/10；PROD-AGENT-01/03/09；BIZ-07/14；TECH-FE-01/02/03；IA §1/§5；DESIGN §字号阶梯、控件尺寸、不变量 | **符合**：右栏仍只读取后端返回的公开资料；筛选、排序和选择不会推断权限。三条分析动作只预填既有 Agent 提问路径；Jev 评分继续调用已登记的公开索引评分接口；领取保持独立 L3 确认。 | 以目标 E2E 覆盖概要、右栏工具、即时预填、排序方向、Jev 接口与领取回归。 |

## 设计读与边界

```yaml
Mode: Redesign · Preserve
Preserve:
  - ?tab=pool、公开 DTO 白名单、最多选择 8 位
  - kol_analyze 入队、Jev 评分 API、领取确认与撤销
Improve:
  - 从“中栏设置面板”改为一行概要 + 四行清晰动作
  - 右栏将检索/筛选/排序/全选压缩到第一行，缩小搜索图标与文案
Remove:
  - 默认展示的引导段落、范围统计、补头像、清理无主页与独立“填入提问框”按钮
Protected contracts:
  - data-pool-* 锚点、键盘焦点、状态回执、L3 确认
Highest-risk change: 选择对象时即时更新 Composer，不得暗中提交或执行
Rollback: 仅恢复原组件呈现组合；已发生的评分、领取、清理仍按后端回执处理
```

## 最终信息布局

| 区域 | 显示内容 | 交互契约 |
|---|---|---|
| **中栏第 1 行** | `公海现有KOL共 N 位供你选择`（元信息档，非粗体） | 仅概要，不把筛选或维护信息复制到中栏。 |
| **中栏第 2 行起** | 高潜KOL分析、高风险KOL分析、检查资料完整度、KOL评分 | 四个入口都先读管理端知识库 `kind='question_template'` 的问题模板（`GET /api/knowledge/question-templates`），把已选名称 + 模板正文预填进 Composer；点击不提交、不执行。前三项要求至少选择一位 KOL。模板缺失时入口禁用并如实提示，不回落到写死的问题文案。 |
| **中栏评分确认** | KOL评分点击后：预填评分模板 + 确认条（取消 / 执行评分） | 只有员工点「执行评分」才调用 `/api/home/pool/jev-assess`（可带 `kol_uids` 指定单卡或已选，最多 8 位），写入 KOL 记忆 A 表 `kol_profile_index` 并回写公开评分信号。 |
| **右栏第 1 行** | 搜索框、未首次建联、14天未联系、入库时间↑↓、粉丝数↑↓、评分↑↓ | 搜索框宽度为缩短版的 2 倍（2026-09-27 第二轮回读；原「比首版缩短约三分之一」已废止）；两个筛选项可再次点击回到全部；排序项首击降序、再次点击切换升序；图标和 `data-sort-direction` 同时表达方向。控件字号使用比 KOL 名称更小的元信息档。 |
| **右栏第 2 行** | 全选（`data-pool-toolbar-row="secondary"`）排在最前，其余溢出项依次向右排列 | 工具栏为两行结构，换行由两个显式容器决定，不依赖 flex 换行的偶然结果。 |
| **右栏对象行** | 既有公开 KOL 行 + 「主页」之后接评分显示 + 独立领取动作 | 保留现有公开字段、可访问主页和 L3 领取确认；有评分显示「评分 N」（`data-pool-score="potential"`，紧跟 `主页`），无评分显示「未评分」。单卡「KOL评分」入口（`data-pool-score-kol`）已于 2026-09-27 第二轮回读废止：评分是记忆里的数值，不是行动入口，评分只从中栏发起。不呈现旧邮件、合同、价格、联系方式、私有笔记或新的维护杂项。 |

## 人机协作路径

```text
右栏：搜索 / 筛选 / 排序 / 勾选 KOL
  → 即时更新中栏下方的 AI 提问框：所有已选 KOL 名称 + 公海分析边界
  → 中栏：选择高潜 / 高风险 / 完整度分析，补充对应问题
  → 员工在 Composer 决定是否发送
  → 既有 kol_analyze 流程：真实排队 / 结果 / 恢复状态

中栏：KOL评分
  → 先填知识库评分模板（草稿，未执行）
  → 员工在确认条点「执行评分」
  → 原 Jev 公开索引评分接口（可指定 kol_uids）
  → 写入 kol_profile_index（KOL 记忆 A 表）
  → 右栏公开评分标记刷新 + 卡片「主页」后显示评分

中栏：右栏卡片「KOL评分」入口（无评分时）
  → 同一条确认条，目标锁定该 kol_uid
```

> **边界**：即时填入提问框不是执行、发送、领取或改阶段；KOL评分点击不等于执行，必须经员工确认；Jev 评分为公开资料的辅助信号；领取继续单独确认、不发信、不改阶段。

## 16:26 定向视觉收敛

- **我的红人中栏**：移除重复的“我的红人”标题和“分析临近失联对象”按钮；“建议先做”的序号改为与“需要关注”同一 `20px + gap` 网格，避免外置列表标记被裁切。
- **我的红人右栏**：结果条件按钮改为行内 flex 居中，保证诸如“0 位未有意向”的数值与文案垂直居中。
- **公海中栏**：四个分析/评分动作改为既有强调色的文本链接，并去掉每行下划线式分隔边框。
- **公海右栏**：工具明确拆成两行：搜索、全选、未首次建联、14天未联系；入库时间、粉丝数、评分。领取跟进维持原 L3 语义，视觉降至 28px / 76px 紧凑规格。

## 追加审宪记录（CONST-08，2026-09-27 第二次）

| 需求 | 主责角色 | 宪法 / 基本法依据 | 结论与证据 | 下一步 |
|---|---|---|---|---|
| 公海问题模板迁到管理端知识库 | 智能体产品经理、知识库治理、前端专家 | CONST-09/10；PROD-AGENT-01/03/09；`docs/AGENTS.md` §4 | **符合**：新增 `question_template` kind，走 draft→审批→published 与版本快照；四个槽位由 tags 约定；模板缺失时禁用入口并提示，不写死兜底。 | 种子 4 条已发布模板 + `GET /api/knowledge/question-templates` |
| KOL评分不点击即执行 | KOL 业务专家、前端专家 | BIZ-07/14；`docs/AGENTS.md` §5 | **符合**：先填模板（草稿态），再由确认条触发执行；执行走已登记的 `assess-pool-jev`，回执沿用现有接口。 | 中栏确认条（原每卡 `score-kol` 入口已于 2026-09-27 第二轮回读废止：评分是记忆数值，不是行动入口） |
| 无评分提示 + 评分落 KOL 记忆 | KOL 业务专家、后端专家 | BIZ-18 KOL 记忆索引；CONST-10 | **符合**：写入既有 A 表 `kol_profile_index`（未新增事实源）；接口按 `kol_uids` 收窄，权限仍在后端校验。 | 扩展 `assessPublicKolsWithJev({ kol_uids })` |
| 右栏两行工具、搜索框缩短三分之一 | UI/UX 专家、前端专家 | CONST-05；DESIGN §控件尺寸/不变量 | **符合**：控件高度仍为 28px（门禁断言），只改排布与宽度；右栏几何 token 未动。 | `PoolPane.tsx` 两行容器 + `styles.css` 追加规则 |

## 2026-09-27 第二轮回读（评审反馈，同日执行）

| 反馈 | 处理 | 证据 |
|---|---|---|
| 图1：右栏搜索框宽度增加 1 倍 | 从缩短版（84–96px）扩为 **2 倍**（168–192px）；高度仍为 `--control-h`（28px），两行工具结构与 ≤620px 整行规则不变 | `frontend/src/styles.css`（`.scope-task-rail .pool-toolbar-primary .pool-search`）；E2E 几何断言 |
| 图2：「KOL评分」是记忆里加载的评分数值，不是行动连接 | 删除单卡 `data-pool-score-kol` 行动入口；卡片只呈现事实：有评分「评分 N」（`data-pool-score="potential"`）、无评分「未评分」（`data-pool-score="missing"`）。评分能力保留在中栏 `assess-pool-jev`（先填知识库模板 → 确认条 → 执行）；双端登记表同步删除 `score-kol` | `frontend/src/home/PoolPane.tsx`、`frontend/src/home/entryRegistry.ts`、`backend/src/host/entry-registry.ts` |
| 图1：公海页「停留时间仍然太久，时间去哪里了」 | ① 公海读取（记忆读）是权威，不再空等 board；只有 404 回退（board-adapter）才等 board 并补读一次。② 空态改为「公海读到 0 条 + 红人库状态已知」两个事实都到位才下结论；读取期间显示 `data-pool-empty="loading"`（`role="status"`，无同步 CTA），不再在读到之前冒充「红人库还没有同步」。③ 同步/维护轮询先查一次回执再等 1s | `frontend/src/home/usePoolWorkspace.ts`、`frontend/src/home/PoolPane.tsx`、`frontend/src/home/kolSurfaceApi.ts`；回归用例 `frontend/e2e/home-pool-follow.spec.ts`（读取期不得声称未同步 / 对象卡不依赖 board） |

### 追加审宪记录（CONST-08，2026-09-27 第三次）

| 需求 | 主责角色 | 宪法 | 基本法 / 细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 搜索框宽度 ×2 | UI/UX 专家、前端专家 | CONST-04/05 | `DESIGN.md` §控件尺寸（高度档不变、不同类型控件可使用不同宽度）、§Home 工作台几何 | **符合**：只改宽度与死规则清理；换行仍由两个显式容器决定 | 已完成，E2E 宽高断言按真实几何更新 |
| 卡片评分=记忆数值、不是入口 | KOL 业务专家、前端专家 | CONST-06/10 | BIZ-18（KOL 记忆索引）；`docs/AGENTS.md` §5；CONST-07 登记表同构 | **符合**：评分数值来自 A 表 `kol_profile_index`（既有事实源）；取消的是入口而非能力 | 已完成，双端登记表删除 `score-kol` |
| 公海读取解耦与空态诚实化 | 智能体产品经理、前端专家 | CONST-10 | `DESIGN.md` §不变量 3、§内容密度（空态诚实区分）；PROD-AGENT-01 | **符合**：等待有原因、状态与恢复入口；未读到不再冒充「尚未同步」 | 已完成，两条回归用例钉住 |
| 应用外壳启动并发读（29 条/批）压缩 | 平台产品经理、前端专家 | CONST-05/10 | `TECHNOLOGY.md` TECH-FE-01；IA §使用≠治理；`DESIGN.md` §不变量 3 | **符合**（本轮补齐）：壳读让位首屏、按 tab 懒读、同一读单飞；公海首屏只剩自己需要的读 | 见「第三轮回读」 |

## 2026-09-27 第三轮回读（首屏读收敛，评审反馈「27 条排队」）

| 项 | 处理 | 证据 |
|---|---|---|
| 公海面不再为一句空态文案拉整个 board | `GET /api/home/pool` 随包返回 `library`（同一份 `app_state` 事实，非新增事实源）；公海页正常路径不再调用 `/api/home/board`，只有 404 回退（board-adapter）才需要 board | `backend/src/routers/kol-memory.ts`、`frontend/src/home/kolSurfaceApi.ts`、`frontend/src/home/usePoolWorkspace.ts` |
| board 改为壳级预热 | board 仍是「我的红人」旧协作对账与今日/待办推荐的共享来源，改为首屏之后预热一次（`SHELL_READ_DELAY_MS` 批次）；公海首屏的内容不再依赖它，测试只要求它让位到公海读之后 | `frontend/src/pages/Home.tsx`；`frontend/e2e/home-pool-follow.spec.ts` |
| 今日 / 待办计划读按 tab 激活才读 | `usePlanScope(scope, client, { enabled })`：未激活的作用域不发读；同一 tab 60 秒内切回复用屏上结果；显式刷新事件不受此限（原位废止早前「两个作用域常驻同读」的做法） | `frontend/src/home/usePlanScope.ts`、`frontend/src/pages/Home.tsx`、`frontend/src/home/todayPlan.test.ts` |
| 提问框技能/知识/项目/文件候选改为用到才读 | 8 条目录读延后到「＋ 菜单 / 技能选择器 / 聚焦 / 有输入 / 已锁定意图」之后的第一次交互 | `frontend/src/components/ComposerDock.tsx` |
| 壳读让位首屏 | 侧栏 badge（会话/审批/定时任务/邮件/账号/偏好/版本）与首页任务目录、任务定义延后 350ms（`SHELL_READ_DELAY_MS`）再发；同一份 `api.tasks()` 在一次刷新内两个消费者共享（3 条 → 1 条） | `frontend/src/home/firstPaint.ts`、`frontend/src/layout/Workbench.tsx`、`frontend/src/pages/Home.tsx` |
| 同一读不重复发 | `sharedRead(key, read)`：同一资源在飞行中的读共享同一个 promise（不做结果缓存，避免领取/释放后把旧快照贴回屏幕）；公海、我的红人、问题模板三处接入 | `frontend/src/home/sharedRead.ts` |
| 回归锁定 | 新增「pool first paint reads only what the pool needs」：公海首屏必须出现公海读与模板读；board/今日/待办/`view=open`/提问框目录一条都不许出现；壳读若发生必须排在公海读之后 | `frontend/e2e/home-pool-follow.spec.ts` |
| 「我的红人」首开不再为旧协作对账白等 board | 只有**确定不可能有旧协作**（reading 返回的范围未绑定邮箱）时才跳过对账：此时 B.active 索引即完整答案，名单、计数与空结论都立刻给出；范围未知或已绑定/过期的仍按原样等 board 合并（`日志：listEmployeeFollowing` 与 board 的 `follow_scope` 同源）。board 另外改为首屏之后预热一次，首次进入时通常已在内存 | `frontend/src/home/useFollowedWorkspace.ts`；`frontend/src/pages/Home.tsx`（`SHELL_READ_DELAY_MS` 批次里 `loadBoard("following")`）；`frontend/src/home/FollowedPane.tsx`（对账旁注） |
| 回归锁定（我的红人） | 新增「未绑定邮箱范围时，首开我的红人不为旧协作对账等 board」：board 延迟 3 秒时名单/计数/结论都要先出，且只发一次 following 读；旧用例的两端桩改为自洽的「已绑定范围」 | `frontend/e2e/home-followed-rail-layout.spec.ts` |
| 今日 / 待办列表不再用任务目录冒充 | 计划记忆（`GET /api/tasks?view=open`）未到之前，两个计划 tab 的列表为空，不再回落成任务目录：否则首屏会先出一批目录行与行内推荐动作（`采纳为待办`） | `frontend/src/pages/Home.tsx` |
| 一条按首帧抢时间的旧断言改稳 | 「今日面板全文不得含『待办』」原以 `expect.poll` 抢在右栏「下一步动作」渲染之前通过；首屏变快后暴露为必红。改为只看今日列表（`[data-today-list]`）不得出现推荐动作文案；右栏推荐的独立验收另行建立 | `frontend/e2e/home-today-pane.spec.ts` |

### 追加审宪记录（CONST-08，2026-09-27 第四次）

| 需求 | 主责角色 | 宪法 | 基本法 / 细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 首屏读收敛（按 tab 懒读 / 用到才读 / 让位首屏 / 读单飞） | 智能体产品经理、前端专家 | CONST-05/10 | `DESIGN.md` §不变量 3；`TECHNOLOGY.md` TECH-FE-01；IA §使用≠治理 | **符合**：只改「何时读、读几次」，不改任何数据契约与事实源；等待仍可见、可恢复 | 已完成，E2E 请求数用例锁定 |
| 公海 `library` 字段（空态文案的来源收窄到公海读） | 后端专家、KOL 业务专家 | CONST-06 | `docs/AGENTS.md` §5；`07-mcp-data-contract.md` 记忆读边界 | **符合**：读的是既有 `app_state.starry_library_sync`，未新增事实源，也未把公海读变成写入 | 已完成，`kol-memory.test.ts` 保持通过 |
| 计划作用域由「常驻同读」改为「按 tab 读 + 60s 复用」 | 智能体产品经理、前端专家 | CONST-10 | `todayPlan.test.ts`（原「switching reuses open-task memory」断言已按新语义更新） | **符合**：切 tab 不重复读的保证保留；显式刷新与任务编辑事件仍即时重读 | 已完成 |

## 2026-09-28 回读：提交后立即执行（方案A）

| 项 | 处理 | 证据 |
|---|---|---|
| 「已入队，等待 Codex」之后没有任何执行者（Codex 不执行、中栏无推理） | 提交在入队成功后立即调既有 `POST /api/tasks/:id/run`（`text` 携带完整提问框正文）并进入会话；入队项保留为耐久凭据 | `frontend/src/pages/Home.tsx`（analyze 分支）；`docs/DECISIONS.md`「ADR-2026-09-28：公海分析提交后立即执行」 |
| 四个入口「点击不提交、不执行」 | 不变：按钮仍只预填；执行只发生在员工点提交之后，仍不走 from-text、不冒充副作用 | `frontend/e2e/home-pool-follow.spec.ts`（选卡预填 + 入队 + run + messages(ask) + 落到 `/s/:session`） |

## 2026-09-28 评分可解释与远端指标口径（评审反馈「这个 KOL 为什么没有评分」）

| 项 | 处理 | 证据 |
|---|---|---|
| 远端指标映射两路漂移 | 抽出 `backend/src/starrykol/remote-metrics.ts` 作为唯一口径（`followersOf/avgPlaysOf/engagementOf/geoOf`），board 同步与公海 A 表同步共用；公海粉丝数不再把「82 万」写成裸数字 `82` | `backend/src/starrykol/remote-metrics.ts`、`library-sync.ts`、`host/kol-memory-sync.ts` |
| 补远端键别名 | 互动率增加帖子口径 `avgPostEngagementRate10` 兜底；句柄增加 `accountHandle` 兜底；地区在 `countryName` 缺失时从 `audienceGeo` 对象取占比最高项 | 同上；`backend/tests/kol-memory.test.ts` |
| 远端补全失败不再静默 | `getKolProfileDetail` 失败写审计 `kol.memory.profile_detail_failed`，并在同步审计里汇总 `detail_failed` 与样本 uid | `backend/src/host/kol-memory-sync.ts` |
| 同步回执带体检 | `syncKolProfileIndex` 返回 `missing_metrics`（缺粉丝/均播/互动/方向的行数），回执 message 明说「其中 N 条缺公开指标，Jev 评分会判为资料不足」；前端在公海面显示该回执（`data-pool-sync-notice`） | 同上；`backend/src/routers/kol-memory.ts`、`frontend/src/home/usePoolWorkspace.ts`、`PoolPane.tsx` |
| 公海 DTO 说清评分状态 | `assessment_state`：`scored` / `low_confidence`（评过但置信度 <70%）/ `failed`（调用失败）/ `unscored`（从未评过）；不回显内部错误原文 | `backend/src/host/kol-memory.ts`、`frontend/src/home/kolContract.ts` |
| 卡片可解释 | `poolScorePlaceholder()`：三种「没分」分别显示「未评分（缺 X、Y）」/「已评估 · 置信度 55%」/「评分失败」，并给出口径 tooltip；`data-pool-score-state` 供断言 | `frontend/src/home/poolView.ts`、`PoolPane.tsx` |

### 追加审宪记录（CONST-08，2026-09-28 第一次）

| 需求 | 主责角色 | 宪法 | 基本法 / 细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 远端指标口径唯一化 + 别名补齐 | 后端专家、KOL 业务专家 | CONST-06 | `docs/AGENTS.md` §5；`07-mcp-data-contract.md` 只读白名单 | **符合**：只改远端→本地的映射口径，不新增事实源、不碰远端写操作 | 已完成，`kol-memory.test.ts` 覆盖契约键 |
| 同步体检与详情失败留痕 | 后端专家 | CONST-10 | `DESIGN.md` §不变量 3（真实等待与结果必须可解释） | **符合**：失败写审计、回执如实报缺指标条数 | 已完成 |
| 「未评分」必须说明原因 | 智能体产品经理、UI/UX 专家 | CONST-10 | `DESIGN.md` §不变量 3/4（状态不能只靠颜色、结论要可解释） | **符合**：三种原因各有文案与 tooltip，且不暴露内部错误原文 | 已完成，前端单测 + E2E 各一条 |

## 2026-09-28 评分口径：把 AI 发现条件注入 Jev（评审反馈「把这个注入到 jef 打分模型」）

| 项 | 处理 | 证据 |
|---|---|---|
| 口径对象 | 新增 `backend/src/host/kol-scoring-criteria.ts`：`normalizeScoringCriteria`（收客户端的条件：平台/地区必须命中字典、方向≤8、关键词≤8、文本≤40、门槛保持 min≤max 并把非法值夹回默认）、`latestDiscoveryCriteria`（员工最近一次 `discovery_requests` 的条件）、`criteriaState`（提交给模型的 JSON 文本）、`criteriaSummary`（一行口径摘要） | 同上 |
| 注入模型 | `assessPublicKolWithJev(row, criteria)`：`state` 增加 `target_criteria`；**只有存在口径时才提交**——没有条件时模型不得自己编"匹配"；潜力题改为「量级是否达门槛 + 与目标方向/地区/关键词是否匹配」；风险题改为「只判可核对的不一致（粉丝与均播/互动自相矛盾）或与目标明显冲突；资料缺失一律 insufficient」 | `backend/src/host/kol-jev-assessment.ts` |
| 口径落库 | `kol_profile_index.assessment_criteria` 存本次口径摘要（migration 与既有 `avatar_error` 同处）；审计 `kol.memory.jev_assessment` 记录完整口径 | `backend/src/db.ts`、`kol-jev-assessment.ts` |
| 路由与回执 | `POST /api/home/pool/jev-assess` 接受可选 `criteria`（显式传入优先，其次最近一次 AI 发现请求）；回执 message 追加「评分口径：…」或「未设置 AI 发现条件，按公开资料通用口径评分」，响应体带 `criteria_summary` | `backend/src/routers/kol-memory.ts` |
| 前端 | 评分确认条说明口径（设过条件 / 未设置两版）；卡片 tooltip 展示本次口径；`Home.confirmPoolScore` 把当前 `discoveryBrief` 作为 `criteria` 提交 | `frontend/src/home/PoolInteraction.tsx`、`PoolPane.tsx`、`poolView.ts`、`pages/Home.tsx` |
| 测试 | 后端新增「Jev 评分把 AI 发现条件作为评分口径提交给模型并如实回执」（含超限字段被收紧）；前端单测新增口径 tooltip；E2E 新增「scoring confirm bar states which criteria the score will use」并在卡片用例断言 tooltip 带口径 | `backend/tests/kol-memory.test.ts`、`frontend/src/home/poolView.test.ts`、`frontend/e2e/home-pool-follow.spec.ts` |

### 追加审宪记录（CONST-08，2026-09-28 第二次）

| 需求 | 主责角色 | 宪法 | 基本法 / 细则 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 把 AI 发现条件作为评分口径注入 Jev | KOL 业务专家、智能体产品经理、后端专家 | CONST-06 | `docs/AGENTS.md` §5；`07-mcp-data-contract.md` 工具风险；`jev-openrouter.md`（模型固定、置信度分档） | **符合**：口径来自员工自己写下的条件（会话内草稿或最近一次发现请求），服务端校验收紧后提交；不新增事实源、不改写远端、评分仍是辅助信号 | 已完成，注入与回执均有回归 |
| 评分必须能说清"按什么口径" | UI/UX 专家、智能体产品经理 | CONST-10 | `DESIGN.md` §不变量 3（结论必须可解释） | **符合**：回执、确认条、卡片 tooltip 三处一致展示口径；未设置时如实说明是通用口径 | 已完成 |
| rubric 调整（缺资料≠风险） | KOL 业务专家 | CONST-10 | 同上 | **符合**：高风险只判可核对的不一致/与目标冲突；资料缺失仍是 insufficient | 已完成，提示词内写明 |
