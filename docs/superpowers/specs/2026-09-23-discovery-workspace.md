# AI发现接入工作台骨架（中栏交互 / 右栏结果 + Codex 推理流）

> 日期：2026-09-23
> 范围：`frontend/src/home/*`、`frontend/src/pages/Home.tsx`、`frontend/src/styles.css`、`frontend/src/home/today-plan-board.css`、`frontend/e2e/*`、`backend/src/home-discovery.ts`、`backend/src/host/run-trace.ts`
> 目标：AI发现页签改用今日任务（`683c041`）刚收敛出来的两栏工作台骨架——**中栏 = 人机交互**（红人检索卡片 + AI 提问框 + 提交后的 Codex 过程流），**右栏 = Codex 结果区**（成功页 / 失败页 + 结果摘要 + 线索明细）。

## 1. 审宪记录（CONST-08）

| 项 | 内容 |
|---|---|
| 需求 | 发现面由「单列（卡片 + 过程 + 结果）」改为两栏：中栏交互与过程、右栏结果；提交后卡片消失并展示 Codex 过程；卡片需可召回。 |
| 主责角色 | 前端专家（外壳抽取与几何）、UI/UX 专家（一页一问、不变量 1/3/4/5）、后端专家（Codex 推理事件写入）、测试经理（一致性证据）、产品经理（卡片消失/召回口径）。 |
| 宪法条款 | CONST-04（前端只实现已定义规则：入库 L3、审批链、阶段判定仍由服务端返回，本页不重写）；CONST-09（未为迁就实现改法）；CONST-10（过程与结果必须真，不以截图代验收）。 |
| 基本法条款 | `TECHNOLOGY.md` TECH-FE-01/03、TECH-BE-01、TECH-TEST-01/02；`PRODUCT.md` PROD-PLAT-02（Home 模式与入口契约）；`docs/ia-information-architecture.md` §1/§5（四模式各自一页一问，「AI发现」是 KOL 试点挂件，不合并页签）；`docs/DESIGN.md` §不变量 1（同一视口 0–1 实底主 CTA）、3（真实等待须有原因/状态/恢复入口）、4、5、§三轴适配；`docs/07-mcp-data-contract.md`（MediaCrawler 是异步作业：必须有进度、取消、重试，不得伪装同步 Skill）；`docs/AGENTS.md` §5（Codex 思考与后台事件用不同入口契约）。 |
| 结论与证据 | **符合**。同时修两条既有偏差：① 发现面把过程与结果塞在同一列（`Home.tsx` 旧 `discovery-pane`），与今日/待办刚统一的工作台口径不一致；② 过程流事件映射漏了 `crawl.*`，且 `ranking_started` 被提前写成「已排出候选」——显示与事实不符，与 CONST-10 相悖。 |
| 规则空白 | 「卡片何时消失、何时召回」无条款来源，本文件按 §3 状态机落定并登记为产品口径。 |
| 下一步 | 见 §4 文件清单与 §5 验证证据。 |

## 2. 现状差距（改动前）

| 维度 | 今日本任务/我的待办 | AI发现（改前） |
|---|---|---|
| 骨架 | `ScopeWorkspace` 两栏（中列 AI 工作区 + 右栏可折叠） | 单列 `[data-home-pane="discovery"]` |
| 过程/结果 | 中列过程流，右栏任务板 | 同一列：过程 → 失败 → 结果 → 入库 |
| 提问框 | 中列底部（工作台 footer） | 页面级 dock |
| 卡片 | — | 常驻，提交后仍在 |
| 过程流 | `run.think` / `run.step` / `run.tool`（今日规划） | 只有粗粒度事件，`crawl.*` 全漏，`ranking_started` 抢跑 |
| 跑批中 | 有状态卡与等待说明 | 结果区空白（无状态） |

## 3. 目标态

```
Home(mode = discovery)  ← data-home-workspace="discovery"（与 today/todo 同一开关）
└─ WorkspaceShell（唯一几何来源：中列 / 右栏 / 折叠 / 页脚）
   ├─ 中栏 .scope-workspace-center[data-scope-ai-workspace]
   │   ├─ compose：红人检索卡片（技能输入参数）
   │   ├─ running/success/failure：过程流 [+ 「改条件再搜」]
   │   └─ footer：ComposerDock（AI 提问框，唯一提交入口）
   └─ 右栏 aside .scope-task-rail[data-scope-task-rail]
       └─ DiscoveryResultPane：运行状态卡 → 摘要（标题 · 原始 N · 入围 M）→
               工具栏（候选 N 位 · 全选 · 入库公海）→ 明细（可展开）
               失败页：原因 + 重试 + 检查采集服务
```

中栏状态机（`discoveryPhase.ts`，纯函数）：

| 态 | 触发 | 中栏 | 右栏 |
|---|---|---|---|
| `compose` | 无 run、无结果、无失败 | 条件卡 + 提问框 | 空容器（保留 `data-discovery-panel`） |
| `running` | 提交后轮询中，或 run 仍在 queued/crawling/ranking | 卡片收起，显示过程流 + 等待说明 | 运行状态卡 |
| `success` | run 落定且无失败 | 过程流（可折叠） | 成功页（状态卡 + 摘要 + 工具栏 + 明细） |
| `failure` | crawl_failed / rank_failed / 服务不可用 | 过程流（含失败步） | 失败页（原因 + 重试 + 检查采集服务）；有原始候选则照列 |

差异白名单（其余视为回归）：请求路径与 L3 契约不变；条件卡 `data-discovery-*` 契约不变；过程/结果的全部 `data-discovery-*` 属性不变。

## 4. 文件变更清单

| 文件 | 变更 |
|---|---|
| `frontend/src/home/WorkspaceShell.tsx` | **新建**：两栏几何的唯一来源（中列三行网格、右栏折叠、`scrollAnchorEvent`、`railBadge`、`.scope-task-rail-body`） |
| `frontend/src/home/ScopeWorkspace.tsx` | 改为外壳的组合（今日/待办行为零变化） |
| `frontend/src/home/DiscoveryWorkspace.tsx` | **新建**：外壳 + `useDiscovery` + 卡片/过程流/结果区 |
| `frontend/src/home/useDiscovery.ts` | **新建**：自 `DiscoveryPanel` 搬来全部状态与副作用（轮询、候选、选择、L3 入库、终态提示） |
| `frontend/src/home/DiscoveryProcessPanel.tsx` | **新建**：中栏过程流 + Codex 推理块 + 「改条件再搜」 |
| `frontend/src/home/DiscoveryResultPane.tsx` | **新建**：右栏结果区（成功页/失败页/摘要/明细/L3 确认/终态提示） |
| `frontend/src/home/discoveryPhase.ts` | **新建**：阶段机 + 卡片可见性纯函数 |
| `frontend/src/home/discoveryEvents.ts` | 补 `crawl.*` 映射、`ranking_started` 不再抢跑、`run.step`/`run.think` 分流、计数从文案回退读取 |
| `frontend/src/home/streamText.ts` | **新建**：`thinkTail` 从 `TodayPlanProgress` 提为共用（行为不变） |
| `frontend/src/home/discovery-workspace.css` | **新建**：过程流/推理块样式（形态与 token 与今日规划过程流对齐）+ 窄中栏的卡片紧凑规则 |
| `frontend/src/home/DiscoveryPanel.tsx` | 删除（内容拆入 hook + 两个面板） |
| `frontend/src/pages/Home.tsx` | discovery 分支改 `<DiscoveryWorkspace>`；`data-home-workspace` 与 hero/页面级 dock 的条件改走 `workspacePane` |
| `frontend/src/home/today-plan-board.css` | 折叠隐藏 `.scope-task-rail-body`（不再只认 `.task-board`） |
| `frontend/src/styles.css` | 删死样式 `.discovery-pane*`；`.task-empty` 覆盖改挂新容器；暗色主题补发现过程流的 token |
| `backend/src/host/run-trace.ts` | **新建**：`planTraceRow` 提为共用（今日规划行为零变化） |
| `backend/src/host/today-plan-run.ts` | 改从共用模块导入 trace 映射 |
| `backend/src/home-discovery.ts` | 简报 worker 接 `onStream` → `upsertTaskEvent(..., "run.think"/"run.step", ...)`，批量写、按 item_key 去重、失败时收尾 |
| 测试 | 新增 `discoveryPhase.test.ts`、`discoveryEvents.test.ts`；`scopeParity.test.ts` 增外壳单一来源断言；`backend/vitest.config.ts` 登记；`e2e/home-discovery-pane.spec.ts` 增卡片收起/召回与两栏归属；`e2e/home-pane-parity.spec.ts` 增「第三个 pane 用同一外壳」几何断言 |

明确不动：`POST /home/discovery/run` 与全部既有响应契约、入库 L3（`/ingest` 404/422/409 语义）、轮询间隔、候选字段投影、`today-plan-*` 命名空间与 `data-today-plan-*` 属性。

## 5. 验证证据

| 类型 | 内容 |
|---|---|
| 单元 | `discoveryPhase.test.ts`（四态 + 卡片可见性真值表）、`discoveryEvents.test.ts`（真实事件映射、`ranking_started` 不再报「已排出候选」、推理分流与折叠）、`scopeParity.test.ts`（外壳被三处组合复用、内容组件不许再写骨架） |
| E2E | `home-pane-parity.spec.ts`：发现面 stage 不滚 / 中列与右栏各自滚 / 提问框贴视口底 / 结果容器只在右栏 / 实底 CTA ≤ 1；`home-discovery-pane.spec.ts`：提交后卡片计数 0、过程与推理在中栏、右栏仍是结果容器、「改条件再搜」把卡片调回；`home-four-panel.spec.ts` 的 `[data-home] h1` 计数 0 与 `data-discovery-live="false"` 保持 |
| 回归 | 全量 `frontend: npm run test:e2e`；`backend: npm test && npm run typecheck` |
| 人工 | `artifacts/ops/discovery-workspace-*.png`（compose/running/success/failure × 1280×900、1440×900，另加 1260×630 查页脚不裁切） |

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 中栏约 470–520px，条件卡拥挤 | 窄栏规则：标签列收窄、成对项改纵排、芯片换行；e2e 保留无横向滚动断言 |
| 提问框由页面级全宽变为中栏列宽 | 与今日/待办一致，属有意变化；人工证据对照 |
| 外壳抽取影响今日/待办几何 | 抽取后 `home-pane-parity` + `home-today-pane` + `home-plan-trace` 全绿为准 |
| 后端新增推理事件影响今日规划 | `planTraceRow` 提取为共用模块，今日规划用例必须全绿；发现侧独立提交、可单独回滚 |

回滚：前端为纯搬迁（无数据迁移）；后端一处提交独立 revert。

## 7. 不做的事

- 不合并「今日任务/我的待办」与「AI发现」页签；不改四模式导航与 URL 契约。
- 不改 `发送/暂存/导入/解密/删除` 语义；入库仍是 L3（确认 + 回执），前端不推算审批链。
- 不改发现数据面：不新增接口、不改候选投影、不把 crawl 伪装成同步。
- 不新增几何常量，不为发现页新造骨架类名；过程流不塞进提问框。

## 8. 并行改动与基线对照（证据，2026-09-23）

全量 e2e 按「拆两段 + `--retries=0` + 独立 `LINGONG_DATA` + 不与其他负载并发」跑（该做法把单轮从 70+ 分钟压到 ~3–20 分钟）。暴露出的非本次失败项逐条做了 **HEAD 基线对照**：`git worktree add --detach .tmp-baseline HEAD`（= `2fc924e`，不含本次任何改动，跑完即删，node_modules 用目录联接复用）。

| 用例 | 现象 | HEAD 基线 | 判定 |
|---|---|---|---|
| `home-discovery-pane.spec.ts`（14 条）、`home-pane-parity.spec.ts`（5 条，含新增「AI发现 runs on the same shell」）、`home-four-panel`、`home-today-pane`、`home-plan-trace` | — | 绿（`--retries=0`、`--workers=1`、独立数据目录） | 本次改动域全绿 |
| `home-plan-cache.spec.ts:56/:84` | 计划按钮文案「启动今日任务」vs「重新生成今日计划」 | **同样失败**；`--repeat-each=3` 下两条用例红绿交替 | 固有竞态：stub 的 settled brief 一到，按钮文案本就应变成「重新生成」；仓库默认 `retries: 1` 吸收 |
| `home-pool-follow.spec.ts:230` | 页面自报「请指定要分析的红人」，`[data-analyze-queued]` 不出现 | **同样失败** | HEAD 既有红 |
| `composer-prompt-input.spec.ts:72/:254`、`shell-metrics.spec.ts:125`（766–768 宽断言） | 提问框实测 424.9 / 472.8 | **同样失败** | HEAD 既有红：提问框自 2026-09-22 固定视口工作台起就在中栏列宽内，断言未同步（本文件 §6 已登记，不改几何迁就它） |
| `shell-metrics.spec.ts:367`（styles.css 源码断言） | 命中 `scrollbar-gutter: stable` | **同样失败** | HEAD 既有红（该规则来自 2026-09-22 工作台，不是本次新增） |
| `mail.spec.ts:269/:315/:391`、`home-chat-send-ne-stage.spec.ts:69/:113` | 邮件/会话卡几何与可见性 | **同样失败** | HEAD 既有红 |
| `home-chat-send-ne-stage.spec.ts:89` | 邮件卡不可见 | 基线绿、本树单独复跑亦绿 | 并发负载下的 flake（`retries: 1` 吸收） |

结论：本次改动域 0 红；其余红项在 HEAD 上同样为红，与本次无关。

`workbench.spec.ts`（72 条）单独跑一遍（`--retries=0 --workers=2 --workers=1` 两种、独立数据目录）：**66 passed / 53 failed**。其中**与本次改动域相关的 5 条全绿**（`home today pane lists today items`、`sidebar 今日组 keeps discovery/pool/followed off the rail`、`/?tab=pool highlights in-page 公海 only`、`in-page AI发现 tab opens discovery pane without a sidebar item`、`creator discovery shows auto-started crawl progress in the middle and can stop`）；对失败集抽样 8 条（跨 home 提问框 / 关注列表 / 模型档位 / 导航 / 任务模板 / 达人检索 / cron）在**同一 HEAD 基线**上逐条复跑，**8/8 同样失败**，故这批红项判定为 HEAD 既有，不是本次引入。全量 e2e 因此不构成本次的通过证据；可用证据是上表的目标域用例。

复制本文件时的运行条件（供复现）：`--retries=0`、独立 `LINGONG_DATA`、不与其他重负载并发；三段命令见 `frontend/package.json` 的 `test:e2e` 与本节各表。
