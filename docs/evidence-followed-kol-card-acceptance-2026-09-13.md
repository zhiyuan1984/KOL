# 首页「我跟进的红人」卡验收证据（2026-09-13）

> **Superseded as current law (2026-09-15):** `specs/UX-FOLLOWED-KOL-CARD.md` 与 `specs/UX-KOL.md`（含 `UX-SEND-NE-STAGE` 文件级 ID）已删除。现行派生见 `specs/UX-EMPLOYEE.md` 与 `docs/evidence-ux-rederive-from-constitution-2026-09-15.md`。下文是 PR #31 实现快照，不再当可执行合同。

## 总判

首页「我跟进的红人」工作卡已在 **PR #31** 落地，本 residual 补齐验收 PARTIAL。契约不再是「未实现」。

| 轮次 | 判定 |
|---|---|
| 改版前基线（同日文档 PR #30） | **FAIL**：五列字段表，不是下一步工作卡 |
| PR #31 主实现 | **PASS**：四带投影卡、行动责任人 Tab、1→8 排序、「确认进入「目标阶段」」打开既有确认卡 |
| 本 residual | 补齐 mailbox 芯片、状态带字段分离、首页去掉跟进风格标签、Journey / 首页去掉「发送不等于改阶段」通用 copy |
| 体验发布门禁 | 仍 **PARTIAL**：未写入 `specs/ux-traceability.json`，不能宣称 UX ID 验收通过 |

对照 `specs/UX-FOLLOWED-KOL-CARD.md`：Home 已按契约从现有 `/api/home/board` 投影工作卡。无 Host API 扩面、无 LIVE 写阶段、Home 不做第二套 Pipeline。

本文件保留改版前 FAIL 基线，并记录 PR #31 / residual 后的现状。

## 评分（当前 / 改版前）

| 维度 | 当前（PR #31 + residual） | 改版前 |
|---|---|---|
| 信息能否找到 | 按身份 / 范围 / 状态 / 事实 / 建议分层 | 尚可 |
| 业务分层（事实 / 推断 / 动作 / 证据） | 四带投影；无依据写「建议依据不足」 | 不通过 |
| 五秒内决定下一步 | 主阅读是建议动作 + 依据 + 显式 CTA | 不通过 |
| 视觉与阅读对齐 | 四带 + 芯片；阶段 / 停留 / 异常不再拼成一串 | 差 |
| 排序 / 优先级 | `visibleKols` 过滤后按 1→8 排序 | 无规则 |
| 首页 vs Pipeline 信息架构 | 主 Tab = 行动责任人；15 阶段为二次 `<select>` | 混淆 |
| 阶段确认上下文 | 「确认进入「目标阶段」」打开既有 `confirm_stage` | 缺失 |
| 「跟进 KOL」工作卡（对照 UX 宪法） | Home 主实现 PASS | 不通过 |
| 本首页卡生产资格 | 主实现可用；体验门禁仍 PARTIAL（无 UX ID） | **不通过** |

## 基线

| 项 | 值 |
|---|---|
| 日期 | 2026-09-13 |
| 员工面 | Home `mode=lifecycle`，「我跟进的红人」 |
| 实现入口 | `frontend/src/followedKolCard.ts`、`frontend/src/components/FollowedKolWorkCard.tsx`、`frontend/src/pages/Home.tsx`；源材料仍来自 `backend/src/host/home-board.ts` |
| 对照 | `docs/04-ux-ui-system.md`、`docs/19-ui-ux-constitution.md`、`specs/UX-KOL.md`（尤其 `UX-SEND-NE-STAGE`）、`specs/FS-KOL-006`、`specs/FS-KOL-010`、`specs/UX-FOLLOWED-KOL-CARD.md` |
| 主实现 | PR #31（`f4624e4` Merge） |
| 本 residual 范围 | 小前端 + 文档：mailbox 芯片、状态带、首页跟进风格标签、Journey copy、本证据与契约状态行。不改 Host API、不 LIVE、不把 Pipeline 复制进 Home |

## 当前对照契约

| 契约 | PR #31 + residual |
|---|---|
| 业务视图模型 | `projectFollowedKolCard` 收成 `identity` / `scope` / `current_state` / `latest_fact` / `recommended_action` / `evidence` / `risk` / `owner` / `last_updated`。`collab_summary` / `recent_followup` / `mail_threads` 只作源材料 |
| 四带结构 | `article[data-kol-work-card]`：身份芯片 → 当前状态 + 最新事实 → 建议 + 依据 → 显式动作。已去掉 `data-kol-card-cols="5"` 与包裹复杂块的 `button.task-main` |
| `scope.mailbox` | 视图模型有值时渲染 `data-kol-chip="mailbox"`（本 residual） |
| 状态带 | 阶段展示名单独 `data-stage-label`；停留天数单独芯片；异常 / 未绑定只走风险芯片，不再拼进 `current_stage` 串（本 residual） |
| 跟进风格标签 | 首页卡不渲染；仍在会话详情 `FollowStyleTags`（本 residual） |
| 首页 IA | 需要我处理 / 等待对方 / 等待审批 / 异常 / 最近更新 / 全部。计数 = 红人数。未读是芯片 + 开关 |
| 排序 | 默认 1→8；开关：按需处理 / 最近更新 / 阶段停留 / 未读 |
| 确认阶段 | CTA「确认进入「目标阶段」」；点击走既有 `confirm_stage`，Home 不 POST 阶段 |
| 「发送不等于改阶段」 | 不出现在首页跟进列表或 Journey 通用 copy（`journey.ts` / `JourneyGuide`）。仍留在会话发送提示与确认 / 发送 / 审批 / 结果卡（本 residual） |

## 仍 PARTIAL / 有意不做

1. **未写入 `ux-traceability.json`**：只能当设计契约指导改版，不能当体验验收通过。本 residual 不补 UX ID。
2. **工作面板任务行**仍用旧 `CardFields` 倾倒，不是首页跟进卡。
3. **无 LIVE、无 Host 投影 API、Home 无第二套 15 阶段板**（契约非目标）。

## 改版前 FAIL 基线（PR #30，保留）

以下是同日改版前的验收事实，用来对照 PR #31 改了什么。不再代表当前 Home。

### 首页没有围绕下一步组织

当时卡是五列 `dl`（KOL 名称 / 合作摘要 / 最近跟进 / 所处阶段 / 建议进入阶段），外加被挤到卡底的邮件预览。员工不能在约五秒内完成「谁、卡在哪、依据是什么、我该点哪」。

### 一张卡混了多种对象

同一 `data-followed-kol` 行同时承载 KOL 资产、合作拼接、17 个阶段 Tab、邮件预览、任务历史、启发式「进入下一格」。没有共享视图模型。

### 当前阶段 vs 建议阶段缺少证据链

`home-board.suggestedStage` 缺显式建议时按正式阶段取下一格。卡上「所处阶段」与「建议进入阶段」并列，不链到来信、任务或版本。主 CTA 是单独的「确认阶段」。

### 「发送不等于改阶段」放错表面

当时该句出现在 Journey / 首页引导（`frontend/src/journey.ts`），而首页确认 CTA 仍是模糊的「确认阶段」。

### 信息架构与排序

`CardFields` 设 `data-kol-card-cols="5"`；`FOLLOWED_KOL_TABS` = 全部 + 15 正式阶段 + 异常；`visibleKols` 只过滤不排序。

### 当时积压（PR #31 已落地，本 residual 补尾项）

1. 用业务视图模型投影 — **已做**。
2. 四带结构替换五列栅格 — **已做**。
3. 首页主分组改为行动责任人 — **已做**。
4. 落地确定性排序 — **已做**。
5. 「确认进入「目标阶段」」打开确认卡 — **已做**。
6. `article` + 显式动作 — **已做**。
7. mailbox 芯片 / 状态带分离 / 首页去掉跟进风格标签 / Journey 通用 copy — **本 residual**。

## 产品陈述

**已有（Home）：** 按下一步组织的跟进工作卡、行动责任人分组、确定性排序、带目标阶段的确认入口（打开既有确认卡，不在首页写阶段）。  
**未做（有意）：** UX ID 追踪、工作面板任务行改版、Host 投影 API、LIVE 发送 / 阶段写入。

可以把「我跟进的红人」写成已落地的首页工作卡；在写入 `ux-traceability.json` 并跑绑定 E2E 前，不得用本卡宣称体验发布门禁通过。

## 发布影响

| 宣称 | 判定 |
|---|---|
| 员工能在首页按下一步「跟进 KOL」 | **PASS**（PR #31；stub Home，非 LIVE） |
| 本卡已按 UX 宪法组织下一步 | **PASS**（主结构）；residual 已清四带杂串与错位 copy |
| 阶段确认具备目标 / 证据 / 写入影响 | **PASS**（打开既有确认卡；Home 不写阶段） |
| 本首页卡生产资格 | 主实现可用；体验门禁 **PARTIAL**（无 UX ID） |
