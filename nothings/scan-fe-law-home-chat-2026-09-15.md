# Frontend law scan — Home / Chat / Workbench chrome

Date: 2026-09-15  
Track: Home / Chat / Workbench chrome  
Baseline: `cursor/docs-org-domain-canons-a1e1` @ `f76512c` (PR #111; C/D canons present)  
Scope (read-only): `frontend/src/pages/Home.tsx`, `Chat.tsx`, `layout/Workbench.tsx`, `followedKolCard.ts`, `FollowedKolWorkCard.tsx`, `home/*`, `components/ChatBlocks.tsx`, `SideWorkbench.tsx`, `App.tsx` routes, `styles.css` (Home / Chat / chrome).  
Law: B `CONSTITUTION.md` §3–5; C `org-permissions.md` (use ≠ governance); E `business-rules/stage-transitions.md`; G `specs/UX-EMPLOYEE.md` (`SEND_NE_STAGE`, `L3_CONFIRM`); H `ia-information-architecture.md`; I `design.md` + `design-system/kol-workbench/MASTER.md`.

This file is a scan report. No patches. Suggestions only.

## Already aligned (no change asked)

- Home mode **labels** match B/H: 今日任务 | 我的待办 | AI发现 | 我跟进的红人 (`frontend/src/home/modes.ts`, Home tablist).
- Pipeline is **not** a default sidebar item. Employee「连接器」goes to `/connectors`. Skills catalog is debug-only. Admin is only「管理控制台」in `UserMenu`. Placeholders say「非本期」. `/teams` redirects to `/agents`.
- Followed-KOL **cards** are Collaboration-shaped (identity / latest fact / recommended action), not kanban cells. Stage CTA does **not** silent-write: `openConfirmStage` opens Chat with `confirm_stage` + concrete `stage_code` (`Home.tsx` ~707–799; `FollowedKolWorkCard.tsx`).
- Dedicated `confirm_stage_card` copy forbids「下一阶段」and requires a concrete code (`ChatBlocks.tsx` `ConfirmStageArtifact`).
- `DraftArtifact` send buttons have no in-card stage picker. Discovery「加入跟进」has an L3 confirm and says it will not send or write stage (`DiscoveryPanel.tsx` ~815–847).
- Wait vocabulary in `waitStatus.ts` is honest (`waiting` = 结果待确认, not 执行中). Home recognize timeout is honest. Chat process text strips MCP / Codex / Thread / Skill (`ChatBlocks.tsx` `employeeProcessLabel`). Debug-only `remoteLabel` on `RunHud`.

## P0

### P0-1 — 「我跟进的红人」is a 15-stage Pipeline board

**Change:** Stop using the full formal-stage strip as the primary IA of Home「我跟进的红人」. Organize by follow/collaboration (who needs me / waiting on them / approval / exception / recent). Stage may remain a **secondary** filter, not the only tablist. Kill Pipeline recovery as the Home fallback.

**Why:** H §5 / B §4.2 / G: this surface is a Collaboration follow face, not a second Pipeline asset board. Stage filters are allowed; cloning Pipeline’s 15+exception column IA is not. The model already has owner groups (`FOLLOWED_KOL_OWNER_TABS`) and never uses them. Empty copy teaches the Pipeline graph.

**Pointers:**

- `frontend/src/pages/Home.tsx` — `mode === "lifecycle"` pane; `FOLLOWED_KOL_TABS` tablist (~1391–1412); empty copy「正式阶段共 15 个，异常状态单独一栏」(~1451); `openKol` / `openConfirmStage` `catch` → `nav("/pipeline?kol=…")` (~694, ~798).
- `frontend/src/home/modes.ts` — internal key `lifecycle` (label is correct; key/query still say lifecycle).
- `frontend/src/kolStages.ts` — `FOLLOWED_KOL_TABS` = 全部 + 15 正式码 + 异常.
- `frontend/src/followedKolCard.ts` — `FOLLOWED_KOL_OWNER_TABS` unused by Home.

### P0-2 — Send / mail result surfaces include a stage picker (`SEND_NE_STAGE`)

**Change:** Remove stage selection and stage-write CTAs from the send card and from any artifact that is primarily send/reply. Stage write stays on its own L3 card. Same SideWorkbench pane must not stack「校验并发送原文 / 确认发送」with `StageFromDraft`.

**Why:** G `SEND_NE_STAGE`: 发送卡不得带阶段选择器; 确认发送不得隐式改写 `stage_code`. B §3: 发送 ≠ 推进阶段. `DraftArtifact` itself is clean, but the result chrome reattaches a picker whenever `draft.targets` exist, and inbound mail cards mix 回复 + 确认写入所选阶段.

**Pointers:**

- `frontend/src/components/SideWorkbench.tsx` ~545–548 — `{!stageMsg && draft && draft.targets?.length && <StageFromDraft … />}`; `.side-body [data-tab] + [data-tab]` in `styles.css` stacks sections, does not hide them.
- `frontend/src/components/ChatBlocks.tsx` `StageFromDraft` (~489–550) — stage `<select>` next to the draft/send path; defaults to `targets[0]`.
- `frontend/src/components/ChatBlocks.tsx` `KolMailCard` (~1461–1511) — same card: 回复 + `StageTrackSelect` +「确认写入所选阶段」.

## P1

### P1-1 — Chat chrome is a mini lifecycle board

**Change:** Keep Chat as one task + confirmable result. Drop or collapse the 8-phase SOP track,「本阶段 SOP」, and「在生命周期中打开」from default employee chrome. Pipeline remains reachable from a product CTA on the Collaboration face or a deep link, not as Chat header furniture.

**Why:** H / B §4.3: Chat answers「完成这一件」, not a global ops / Pipeline launcher. E allows an 8-segment **display fold**, not a second asset board. C: do not treat Chat as a governance or lifecycle console.

**Pointers:** `frontend/src/pages/Chat.tsx` ~953–1008 (`kol-journey`, `aria-label="八个阶段"`, `data-open-lifecycle`「在生命周期中打开」,「本阶段 SOP」); `journey.ts` `SOP_PHASES`.

### P1-2 — Home stage failure dumps the employee onto Pipeline

**Change:** If `openKolSession` fails, stay on Home with an honest error + retry. Do not `nav("/pipeline")`.

**Why:** Same as P0-1. Pipeline is a KOL-pilot asset page (deep link / CTA), not Home’s error sink. Copy already says「已转到生命周期页」(`Home.tsx` ~795).

**Pointers:** `Home.tsx` ~690–695, ~791–798.

### P1-3 — Thin L3 on send (`L3_CONFIRM`)

**Change:** Send confirm must show object / scope / consequence (including「发送不改阶段」) and a durable receipt. `ResultDraftPreview`「确认发送」must not be a one-click `api.sendDraft` with no consequences line. Reject/cancel of an already-opened L3 send should collect a reason where G requires it.

**Why:** G `L3_CONFIRM` / B §5: 外发 is L3; Toast cannot replace a receipt. `DraftArtifact` at least shows from/to/body; `ResultDraftPreview` (~973–1016) does not state consequences. Composer hint「发送不等于改阶段」(`Chat.tsx` ~1120–1123) is not the confirm card.

**Pointers:** `ChatBlocks.tsx` `ResultDraftPreview.confirmSend`; `DraftArtifact.send` (~374–387); compare Discovery follow confirm (`DiscoveryPanel.tsx` ~815+).

### P1-4 — Waiting items lose their honest bucket

**Change:** Keep「结果待确认」as its own Home 待办 group. Do not fold `awaiting_review` into `open`.

**Why:** B §3 / G: real wait must show why and the recover path. `waitStatus.ts` labels it correctly; Home then drops the bucket.

**Pointers:** `Home.tsx` `todoBucket` (~264) vs `TodoActionList` (~1787–1798: `if (bucket === "waiting") grouped.open.push(task)`); `HOME_TODO_BUCKETS` omits `waiting`.

### P1-5 — Employee-visible engine jargon on Chat chrome

**Change:** Do not put MCP / Codex / remote-backend names on employee-visible titles, tooltips, or default chrome. Gate `TeamRail` remote titles the same way `RunHud.remoteLabel` is debug-only.

**Why:** G 员工禁词; C: employee surface is not an engine legend.

**Pointers:** `frontend/src/components/TeamRail.tsx` ~31 — `title={`${step.label} · ${REMOTE_BACKEND_LABEL[…]}`}` (`agentConfig.ts`: `"Starry KOL MCP"`). `Chat.tsx` ~952 renders `TeamRail` whenever `team:${sessionId}` exists.

### P1-6 — Home chrome is a second header, not quiet workbench chrome

**Change:** Strip Home hero marketing and duplicate account/settings chrome. First screen = current mode + honest wait + one primary action (`pages/home.md` / MASTER §1, §4).

**Why:** I MASTER: 轻、安静; 避免营销落地页式大标题. B §3: do not crush the work area with decoration. Account + Settings already live in `Workbench` / `UserMenu`.

**Pointers:** `Home.tsx` ~1204–1268 (`home-chrome` account cluster, search/refresh/external/settings, `BrandLockup`); `BrandLockup.tsx` — LiTime slogans「Powering Outdoor Adventures…」; icon hit targets 28×28 (`styles.css` `.home-chrome-icon`) vs MASTER §6 44×44 / desktop 36–40.

### P1-7 — Stage pickers default to the first / suggested target

**Change:** Do not pre-select `targets[0]` or adjacent-next. Empty until the employee picks a concrete `stage_code`. Keep the full human target set (cross / back / exception + reason) per E §3.

**Why:** E: 前端不得把目标列表收成「只能选下一格」. G: 不能用「下一阶段」代替目标. Defaulting the first option is the old adjacent-default (see also `docs/17-code-conformance-scan.md` C-002).

**Pointers:** `ChatBlocks.tsx` `StageFromDraft` ~499; `ConfirmStageArtifact` ~565–567; `followedKolCard.ts` `heuristicTarget` ~221–224 (+1 `MAIN_STAGE_TABS`).

## P2

### P2-1 — Raw hex and migration aliases on this chrome

**Change:** Home / Chat / Workbench rules should use MASTER core tokens (`--bg`, `--text-muted`, `--warning`, `--danger`, `--border`, …). Stop new `--canvas` / `--line` / `--muted` / `--star` / `--red` / `--ok` / `--orange` and scattered hex on todo chips, followed-KOL chips, run-hud, team-rail.

**Why:** I `design.md` §2 / MASTER §2, §9: 迁移别名禁止出现在新代码; 无散落未说明 hex.

**Pointers:** `styles.css` `.todo-urgency.is-overdue/.is-today/.is-waiting` (~1425–1427); `.kol-chip.is-style` / followed-KOL amber (~2099–2101, ~1634–1689); `.run-hud` / `.status-dot` (~3035–3044, ~369–370); `.team-rail` (~3628, ~3675–3679); widespread `var(--canvas|--line|--star|--red)` in home/session rules.

### P2-2 — Internal / URL names still say「lifecycle」

**Change:** Rename Home mode key and `data-*` to follow-collaboration language (`followed` / `following`), not `lifecycle`. Keep the visible label「我跟进的红人」.

**Why:** H §5 names the mode; `lifecycle` teaches implementers that this pane *is* the stage graph.

**Pointers:** `home/modes.ts` `"lifecycle"`; `Home.tsx` `data-home-mode="lifecycle"`, `data-lifecycle-overview`, `?tab=lifecycle`; `Chat.tsx` `data-open-lifecycle`.

### P2-3 — I-layer page overlay still says「已关注创作者」

**Change:** Align `pages/home.md` mode name with B/H「我跟进的红人」. Do not reintroduce 已关注 / 关注 as the mode title.

**Why:** I overlay must not rewrite H/B names. Implementation labels are already correct; the overlay will mis-brief the next Home rewrite.

**Pointer:** `docs/design-system/kol-workbench/pages/home.md` §职责.

### P2-4 — Extra Home IA:「全部工作」drawer +「任务模板」on the mode tablist

**Change:** Do not add a fifth control or a second「今日任务」surface on Home. Templates are a starter, not a Home mode.

**Why:** H §1 / §5: four named modes only. B §4.3: one question per surface.

**Pointers:** `Home.tsx` ~1314–1316「任务模板」inside `role="tablist"`; ~1575–1610 `work-panel`「全部工作」with another 今日任务 tab.

### P2-5 — Chat / Home nested scroll +「标记完成」

**Change:** One main scroll per page (B §3). Chat currently scrolls `AgentTaskList` + `session-stream` + `SideWorkbench`. Treat「标记完成」as an explicit local close, never as implied mail/stage success; hide it while send/stage L3 is open.

**Why:** B §3 单一主滚动; 不得伪造完成. `Chat.tsx` ~822–835, ~1022–1024.

**Pointers:** `Chat.tsx` `session-shell` three panes; `styles.css` `.home-pane` / `.home-board` overflow; `TaskRow` raw `task.progress` % (`Home.tsx` ~1984) if that number is not a real host fact.

### P2-6 — Sidebar label「新工作任务」vs Home

**Change:** Employee default item should read as Home / 现在做什么, not「新工作任务」, if the next nav pass touches chrome.

**Why:** H §4 平台工作入口：Home / 进行中. Current aria-labels-only grouping (`今日` / `资产`) is already fine.

**Pointer:** `layout/Workbench.tsx` ~115–118.

## Out of track (noted, not scored)

Admin / Pipeline / SkillHub pages, backend `confirm_stage` gate, and LIVE Starry walk were not scored. C leftover「员工侧栏深链 /admin/connectors」is **not** present on this Workbench revision.
