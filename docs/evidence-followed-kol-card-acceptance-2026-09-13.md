# 首页「我跟进的红人」卡验收证据（2026-09-13）

## 总判

当前首页「我跟进的红人」卡是**未组织的数据表 / 字段陈列**，**不是**用来决定下一步动作的工作卡。

- **信息完整度**：尚可（合作、阶段、任务历史、往来邮件都能在卡上找到碎片）。
- **业务分层**：**不通过**（事实 / 推断 / 动作 / 证据未分组）。
- **视觉对齐**：差（固定五列栅格、名称重复、标签无层级）。
- **排序**：无业务规则（`visibleKols` 只过滤、不排序）。
- **首页 vs 生命周期 IA**：混淆（Home `lifecycle` 页签用 17 个阶段 Tab 当主导航）。
- **高风险阶段确认**：缺上下文（「确认阶段」远离证据，无 current→suggested 依据与写入影响）。

对照 `docs/04-ux-ui-system.md`、`docs/19-ui-ux-constitution.md`、`specs/UX-KOL.md`：不能稳定支撑员工「跟进 KOL」。本首页卡生产资格：**不通过**。

本文件只记录验收事实与宪法冲突。**本 PR 仅文档，不实施改版**，不改前端 / 后端 / UI / JSX / CSS。目标契约见 `specs/UX-FOLLOWED-KOL-CARD.md`。

## 评分

| 维度 | 评价 |
|---|---|
| 信息能否找到 | 尚可 |
| 业务分层（事实 / 推断 / 动作 / 证据） | 不通过 |
| 五秒内决定下一步 | 不通过 |
| 视觉与阅读对齐 | 差 |
| 排序 / 优先级 | 无规则 |
| 首页 vs Pipeline 信息架构 | 混淆 |
| 阶段确认上下文 | 缺失 |
| 「跟进 KOL」工作卡（对照 UX 宪法） | 不通过 |
| 本首页卡生产资格 | **不通过** |

## 基线

| 项 | 值 |
|---|---|
| 日期 | 2026-09-13 |
| 员工面 | Home `mode=lifecycle`，「我跟进的红人」 |
| 实现入口 | `frontend/src/pages/Home.tsx`（`CardFields`、`visibleKols`、`kolPrimaryAction`、`FOLLOWED_KOL_TABS`）、`frontend/src/kolStages.ts`、`backend/src/host/home-board.ts`（`cardFields`、`suggestedStage`） |
| 对照 | `docs/04-ux-ui-system.md` 任务驱动与 L1–L3；`docs/19-ui-ux-constitution.md` 四页分工；`specs/UX-KOL.md`（尤其 `UX-SEND-NE-STAGE`）；`specs/FS-KOL-006`、`specs/FS-KOL-010` |
| 本 PR 范围 | 仅本证据、`specs/UX-FOLLOWED-KOL-CARD.md` 与索引一行；不改产品代码、不产生 LIVE 副作用 |

## 宪法冲突

首页卡应按「现在做什么」组织，而不是按 API 字段铺开。当前违约如下。

### 首页没有围绕下一步组织

宪法要求 Home 回答「现在做什么」：阶段、最新事实、员工动作、证据、下一步、异常。当前卡是五列 `dl`（KOL 名称 / 合作摘要 / 最近跟进 / 所处阶段 / 建议进入阶段），外加被挤到卡底的邮件预览。员工不能在约五秒内完成「谁、卡在哪、依据是什么、我该点哪」。

### 一张卡混了多种对象

同一 `data-followed-kol` 行同时承载：

| 对象 | 当前落点 |
|---|---|
| KOL 资产 | `@handle`、`kol_name`、`profile_tags`、`follow_style_tags` |
| 合作 | `collab_summary`（品牌 · 负责人 · notes 拼接） |
| 生命周期 | `current_stage`、`stage_code`、`days_in_stage`、17 个阶段 Tab |
| 邮件 | `mail_threads` 预览（在五列栅格之外） |
| 任务历史 | `recent_followup` ← `task_history`（标题 · 状态拼接） |
| 阶段建议 | `suggested_stage` / `suggested_stage_code`（默认下一正式格） |
| 阶段变更入口 | `data-kol-primary-action=confirm-stage` |

没有共享视图模型把这些对象收成「身份 / 状态 / 事实 / 建议动作 / 证据」。

### 当前阶段 vs 建议阶段缺少证据链

`home-board.suggestedStage` 与 `kolStages.suggestedStageLabel` 在缺显式建议时，按正式阶段枚举取下一格（异常则「需人选回到主流程」）。卡上「所处阶段」与「建议进入阶段」并列，**不链到来信、任务或版本**。高风险「确认阶段」按钮远离这些字段，也不展示 current→suggested、依据或写入影响。`runKolPrimary` 在无现成 `confirm_stage` 任务时只 `openKol` 进会话，并不打开带 diff 的确认卡。

### 「发送不等于改阶段」放错表面

`UX-SEND-NE-STAGE` / 宪法第 4 条：发送卡不得带阶段选择；阶段卡必须显示具体 `stage_code`、展示名、前后 diff、版本和确认按钮；只需一句安静说明，禁止当通用首页文案。当前「发送不等于改阶段」出现在 Journey / 首页引导（`frontend/src/journey.ts`），而首页确认 CTA 仍是模糊的「确认阶段」。该句应落在确认 / 发送 / 审批 / 结果卡，而不是首页通用 copy。

## 信息架构问题

| 问题 | 现状 |
|---|---|
| 固定五列栅格不适合工作卡 | `CardFields` 设 `data-kol-card-cols="5"`；阶段三字段再塞进 `data-kol-status-line` |
| KOL 名称重复 | `<strong>@{handle}</strong>` 与「KOL 名称」`kol_name \|\| handle` 同卡双显 |
| 标签无层级 | `follow_style_tags` 与 `profile_tags` 并列，不区分范围 / 风险 / 状态 |
| 邮件证据被埋 | 往来在五列 `button.task-main` 之外；邮件是事实，却不像事实那样链到建议 |
| 计数单位混乱 | Tab 显示 KOL `count`；标题「未读」累加邮件 `unread_count`；「最近跟进」是任务历史；board 另有未展示的 `task_count` |
| 17 个阶段 Tab 压过首页 | `FOLLOWED_KOL_TABS` = 全部 + 15 正式阶段 + 异常。宪法：正式 15 阶段资产板属 Pipeline（`FS-KOL-010`），Home 禁止当生命周期主导航 |

Home 已有 `todo` / `ai` / `lifecycle` 三模。「lifecycle」页签把跟进列表做成阶段漏斗，直接混淆 Home「现在做什么」与 Pipeline「合作坐落在哪一格」。

## 排序

`visibleKols` 仅为 `followedKols.filter(matchesKolTab)`。`matchesKolTab` 按 `all` / `exception` / `stage_code` 过滤。**没有**确定性业务排序（异常 / 待我确认 / 未读来信 / 逾期跟进 / 阶段停留 / 最新事实 / `last_updated` / KOL id）。列表顺序等于 board 返回顺序，不能稳定把「现在必须处理」顶到前面。

## 按钮与语义

- 主 CTA 在可确认时文案是单独的「确认阶段」，**不含目标阶段**，也不打开带 current→suggested、证据、写入影响的确认卡。
- 整块字段包在 `<button class="task-main">` 里（`openKol`），复杂块被当成一个按钮；邮件「查看原邮件」与主 CTA 再叠一层。这不是 `article` + 显式链接 / 按钮的工作卡语义，读屏与焦点都会把整卡当成单一控件。

## 根因

1. **API 字段直接倒进 UI**：`cardFields` 把 `collab_summary` / `recent_followup` / `current_stage` / `suggested_stage` 拼成展示串；前端再原样铺五列。
2. **功能堆积**：跟进列表上陆续加上标签、未读、邮件预览、阶段建议、确认 CTA，没有重做成决策卡。
3. **生命周期枚举当首页 IA**：15+2 个阶段 Tab 成为主筛选，而不是「谁必须行动」。
4. **没有五秒决策场景**：从未规定员工扫一眼必须得到的五元组（阶段 / 最新事实 / 我的动作 / 证据 / 下一步或异常）。
5. **没有共享视图模型**：Home、board、任务行 `CardFields` 共用同一套字段倾倒，前端各自补全缺省文案。

## 积压（只记录，不实施）

实现须遵守 `specs/UX-FOLLOWED-KOL-CARD.md`，本 PR 不改代码：

1. 用业务视图模型投影，停止把 `collab_summary` / `recent_followup` / `mail_threads` 当列。
2. 四带结构替换五列栅格。
3. 首页主分组改为行动责任人；15 阶段降为二次筛选。
4. 落地确定性排序与可选用户开关。
5. 「确认进入「目标阶段」」打开确认卡；禁止单独「确认阶段」。
6. 卡语义改为 `article` + 显式动作，去掉包裹复杂块的 `button.task-main`。

## 产品陈述

**已有**：跟进范围内的红人列表、阶段碎片、任务历史拼接、邮件预览、启发式主 CTA。  
**未做**：可决定下一步的工作卡、业务分层、证据链、确定性排序、与 Pipeline 分清的首页 IA。

不得把「我跟进的红人」写成已交付的跟进工作台，也不得用本卡通过生产发布资格。

## 发布影响

| 宣称 | 判定 |
|---|---|
| 员工能在首页稳定「跟进 KOL」 | **FAIL** |
| 本卡已按 UX 宪法组织下一步 | **FAIL** |
| 阶段确认具备目标 / 证据 / 写入影响 | **FAIL** |
| 本首页卡生产资格 | **不通过** |
