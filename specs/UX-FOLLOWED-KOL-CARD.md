# 首页「我跟进的红人」工作卡契约

`docs/04-ux-ui-system.md` 的首页跟进卡实例，服从 `docs/CONSTITUTION.md` 表面职责、`docs/employee-surface-contracts.md` 与 `specs/UX-KOL.md`（尤其 `UX-SEND-NE-STAGE`、`UX-STATE-VISIBLE`）。阶段写入仍只走 `FS-KOL-006`；正式 15 阶段资产板仍只坐落在 Pipeline（`FS-KOL-010`）。

**状态：** 首页工作卡已在 PR #31 落地（`frontend/src/followedKolCard.ts` + `FollowedKolWorkCard`，从现有 `/api/home/board` 投影；无 Host API 扩面、无 LIVE 写阶段、Home 不做第二套 Pipeline）。本 residual PR 补齐验收 PARTIAL：`scope.mailbox` 芯片、状态带字段分离、首页去掉跟进风格标签、Journey / 首页不再用「发送不等于改阶段」通用 copy。

仍 **PARTIAL**（有意不做，不阻断本卡主实现）：未写入 `specs/ux-traceability.json`，故不能当体验验收通过；工作面板任务行仍用旧 `CardFields` 倾倒。历史 FAIL 基线见 `docs/evidence-followed-kol-card-acceptance-2026-09-13.md`。

## 目标与非目标

目标：员工在首页五秒内对每名跟进红人回答——这是谁、卡在哪、最新事实是什么、我是否该动、依据是什么、下一步点哪。

非目标：把 Home 做成第二套 15 阶段资产板；把 `collab_summary` / `recent_followup` / `mail_threads` 原样铺成列；在首页直接 LIVE 写阶段或发信；把「发送不等于改阶段」做成首页通用横幅。

## 业务视图模型

首页卡只渲染**投影后的工作卡模型**，不把 board 原始袋直接摊开。必填字段：

| 字段 | 含义 | 不得用下列原样倾倒代替 |
|---|---|---|
| `identity` | 一个显示名（`@handle` 或姓名择一）、平台 | 同卡再写一遍「KOL 名称」；不要 `kol_name` + `@handle` 双显 |
| `scope` | 品牌、区域、跟进邮箱 / 负责人 | 不要用 `collab_summary` 把品牌 · 负责人 · notes 拼成一句 |
| `current_state` | 正式 `stage_code` + 展示名、停留天数、是否异常 / 未绑定 | 不要把阶段 · 停留 · 异常拼进 `current_stage` 展示串 |
| `latest_fact` | 一条最新可观察事实（来信 / 去信 / 已确认事件）+ 时间 + 来源 | 邮件是事实，不是卡底预览；不要把 `mail_threads[]` 整段铺开 |
| `recommended_action` | 员工现在该做的一件事（确认进入「目标阶段」/ 起草 / 看来信 / 去审批） | 不要把枚举「下一正式格」或 `next_action: 进入…` 当成建议 |
| `evidence` | 支撑建议的指针（会话、邮件、任务、阶段版本） | 不要把 `recent_followup` / `task_history` / 原始 `tasks[]` 当证据 |
| `risk` | 异常、高风险、逾期、未绑定 | 不要只靠未分层的 `profile_tags` / `follow_style_tags` |
| `owner` | 现在谁必须动：我 / 对方 / 审批人 | 不要用生命周期枚举代替行动责任人 |
| `last_updated` | 最新事实或记录时间 | 排序与「最近更新」只认此字段或 `latest_fact.at` |

映射原则：board 仍可读取合作、任务、邮件，但 Host / 前端必须收成上表。`collab_summary`、`recent_followup`、`mail_threads` 是源材料，不是卡槽。

建议动作必须能指回 `latest_fact` 与 `evidence`。没有依据时，诚实写「建议依据不足」，禁止静默填下一阶段。

## 卡片结构（四带，不是五列）

禁止 `data-kol-card-cols="5"` 式字段表作为首页跟进卡。每张卡四条水平带：

1. **身份 / 范围 / 状态芯片** — `identity`、`scope`、风险 / 未读 / 异常芯片。名称只出现一次。
2. **当前状态 + 最新事实** — `current_state` 与 `latest_fact` 并读。来信 / 去信是事实，并链到第 3 带的建议（同一证据指针）。
3. **建议动作及依据** — `recommended_action` + 为何（事实摘要 + `evidence`）。无依据则空态，不编造下一格。
4. **显式动作** — 至少分开：查看详情；起草（若建议是邮件）；**确认进入「目标阶段」**（仅当建议是阶段写入）。确认入口必须打开确认卡，展示 current→suggested、证据、写入影响（版本 / 审批 / 不发信）。

次要信息（完整任务史、多线程、画像标签）进详情，不进首页主阅读。

## 首页信息架构

Home 主分组按**谁必须行动**，不是按 15 个正式阶段：

| 主分组 | 收纳 |
|---|---|
| 需要我处理 | 待我确认阶段、待我起草 / 确认发送、未读来信需处理 |
| 等待对方 | 已去信或已进入等待对方的事实 |
| 等待审批 | 阶段 / 发送 / 商务审批在他人处 |
| 异常 | 争议、失联、旁路、高风险 |
| 最近更新 | 按 `last_updated` / 最新事实，不作主待办 |
| 全部 | 跟进范围内的完整列表 |

**15 个正式阶段 + 异常旁路**是二次筛选（或 Pipeline 主导航），不是首页主 Tab。禁止再用「全部 + 15 阶段 + 异常 = 17」作为首页主 IA。

计数单位：分组数字 = **红人数**。未读是邮件事实，标在卡上或「未读」开关，不与红人数、任务数混成一个 Tab 数字。

## 排序契约（确定性）

默认排序必须稳定、可测，键顺序如下（前一键不等才比下一键）：

1. 异常 / 高风险
2. 等待员工确认（阶段或发送）
3. 未读来信
4. 逾期跟进
5. 阶段停留最长
6. 最新事实最新
7. `last_updated` 最新
8. KOL / collaboration id 升序（稳定平局）

`visibleKols` 不得只 `filter` 不 `sort`。过滤后仍走本顺序。

可选用户开关（改比较键，不取消平局键 8）：

| 开关 | 效果 |
|---|---|
| 按需处理 | 回到上面 1→8 默认 |
| 最近更新 | 先 `last_updated` / 最新事实，再 1–5，再 id |
| 阶段停留 | 先停留天数，再 1–4，再 6–8 |
| 未读 | 先未读来信，再 1–2，再 4–8 |

## 确认阶段

- 按钮文案必须含**目标阶段**，例如「确认进入「已回复-有兴趣」」。禁止单独「确认阶段」。
- 点击打开既有 `confirm_stage` 确认卡（Chat / 结果区 L3），不得在首页就地写阶段。
- 确认卡必须具备 `UX-SEND-NE-STAGE`：具体 canonical `stage_code`、展示名、current→suggested diff、版本、确认 / 拒绝；拒绝要原因。
- 无目标码、无证据或无版本时，禁用写入并说明缺什么。

「发送不等于改阶段」只出现在确认卡、发送卡、审批卡、结果卡，且一句即可。不要作为首页跟进列表或 Journey 通用 copy。

## 卡片语义

- 外层是 `article`（或等价非交互容器），不是包住整块复杂内容的 `button.task-main`。
- 查看详情、查看原邮件、起草、确认进入「目标阶段」是各自的链接 / 按钮，带独立可访问名字。
- 整卡点击不得既打开会话又抢主 CTA。主 CTA 只做建议动作。
- 无横向滚动（宪法已在航运的 P0）。

## Given / When / Then（Home 已实现，PR #31 + residual）

```gherkin
Given 员工打开首页跟进列表
Then 每张卡能在一屏内读出身份、当前状态、最新事实、建议动作与依据
And 主分组是行动责任人，不是 17 个阶段 Tab
And 列表顺序遵守 1→8 排序键

Given 卡上建议写入阶段「已回复-有兴趣」且证据链完整
Then 主按钮文案含该目标阶段
And 点击打开确认卡，展示 current→suggested、证据与写入影响
And 首页不出现单独的「确认阶段」

Given 只有下一正式格启发式、没有邮件或任务证据
Then 不把「进入下一阶段」写成可确认建议
And 不启用阶段写入按钮
```

## 与现行 UX ID 的关系

本文件暂不新增已追踪 UX ID。实现 PR 若要进发布门禁，须先把可执行条写进 `specs/UX-KOL.md` 与 `specs/ux-traceability.json`，并绑定 `FS-KOL-006` / `FS-KOL-010`、红线与 E2E。在此之前，本契约指导改版，不构成「体验验收通过」。
