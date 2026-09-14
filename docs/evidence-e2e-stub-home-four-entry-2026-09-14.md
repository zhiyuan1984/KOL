# Evidence: stub E2E — Home four-entry (PR #61 / #63 / #62)

- **Date:** 2026-09-14
- **PR (legislation):** https://github.com/zhiyuan1984/KOL/pull/61 — **MERGED** (`cursor/home-four-modes-legislation-0f32`; ADR-018)
- **PR (BE):** https://github.com/zhiyuan1984/KOL/pull/63 — **MERGED** (`cursor/ai-discovery-backend-3d65`; `/api/discovery/*`)
- **PR (FE):** https://github.com/zhiyuan1984/KOL/pull/62 — **MERGED** (`cursor/home-four-panel-workbench-6446`; four-panel workbench)
- **Legislation:** PR #61 / ADR-018 (`docs/DECISIONS.md`, `docs/19`) — Home **内**四入口：今日任务 / 我的待办 / AI发现 / 我跟进的红人
- **Verified ref:** `origin/main`
- **SHA:** `1c9bfe74bf23f0a20134ea55475e69125a3c59cc` (short `1c9bfe7`)
- **Commit:** Merge pull request #62 from zhiyuan1984/cursor/home-four-panel-workbench-6446
- **After:** PRs **#61 + #63 + #62**
- **Mode:** `E2E_MODE=stub`. `LIVE_REMOTE_SIDE_EFFECTS=0`. **No LIVE.** Not `E2E_MODE=real`.
- **Auth:** `E2E_AUTH_MODE=disabled`
- **Spec:** `frontend/e2e/home-four-panel.spec.ts` + `frontend/e2e/workbench.spec.ts`
- **JSON:** `artifacts/e2e/stub-home-four-entry-2026-09-14.json`
- **Focus:** Home four-entry IA + discovery plan→runs gate + 我的待办 no regress; no auto send/stage

## Verdict

**PASS.** Tip tests **6/6 PASS** (~15.2s). Coverage **PASS**. `LIVE_REMOTE_SIDE_EFFECTS=0`. **No LIVE.**

This is stub Home four-entry evidence on `main@1c9bfe7` after #61+#63+#62. It is not a production go-live and not a full stub-suite or real-mode pass.

## Setup

1. `git fetch origin main` → tip **`1c9bfe74bf23f0a20134ea55475e69125a3c59cc`** (merge of PR #62 onto `main` that already contains PR #61 and PR #63).
2. Stub-only Playwright (`E2E_MODE=stub`). `LIVE_REMOTE_SIDE_EFFECTS=0`. Judgment does not use LIVE remotes, send, or stage write.
3. Focused tip tests only (titles below). Full stub suite and `E2E_MODE=real` were **not** run.

## Tip tests — 6/6 PASS (~15.2s)

| # | Test | Status |
|---|------|--------|
| 1 | home four-panel tab order and pane visibility | **PASS** |
| 2 | home discovery persists plan and requires confirm before crawl or follow | **PASS** |
| 3 | today suggestion convert to todo dedupes | **PASS** |
| 4 | home waiting work item is labeled 结果待确认 not 等待中 | **PASS** |
| 5 | home todo buckets fold after 6 items and keep wait-status labels | **PASS** |
| 6 | home AI insight is confirmed into 我的待办 and 立即处理 opens the KOL session | **PASS** |

### How-covered

| Test | How covered |
|------|-------------|
| 1 home four-panel tab order | `[data-home-mode]` count 4, order `today` / `todo` / `discovery` / `lifecycle`; labels 今日任务 / 我的待办 / AI发现 / 我跟进的红人; default `aria-selected` on 今日任务; today pane only (h1「今天有什么工作要处理？」; 今天推荐; today `not.toContainText("AI发现")`); other panes count 0 until tab click |
| 2 home discovery persists plan… | fill query + youtube/na → `[data-discovery-plan]` persists `POST /api/discovery/requests` (`status=open` / `status_label=待确认` / `latest_run=null`); no `/runs` until `[data-discovery-confirm-plan]`; no `/follow`; `LIVE_SIDE_EFFECT` watcher `[]`; after confirm, `/runs` fires; lifecycle still `data-followed-origin=collaboration` and `[data-discovery-candidate]` count 0 |
| 3 today suggestion convert dedupe | 今日任务 `[data-suggestion-to-todo]`「加入待办」→ 我的待办 shows that title count 1; CTA becomes「已在待办」disabled; second convert does not add another card |
| 4 waiting labeled 结果待确认 | 我的待办 card 写报价信 `data-wait-status=结果待确认`; not「等待中」; no `[data-todo-bucket="waiting"]`; no「后续」; queued/running/approval/failed keep 已入队 / 执行中 / 等审批 / 失败 |
| 5 todo buckets fold after 6 | 9 waiting items → `[data-todo-card]` count 6 + `[data-fold-more]`; expand → 9; no later bucket /「后续」 |
| 6 AI insight confirmed into 我的待办 | 今日任务 lists 今天推荐 (not「AI发现」); insight 失联跟进 confirm → 我的待办 +1; 立即处理 on 数码老张 (`data-wait-status=结果待确认`) opens `/s/…` |

## Coverage table — PASS

| # | Focus | Status | Proof |
|---|-------|--------|-------|
| 1 | 今日任务 rename | **PASS** | Tip 1 + 6: old「AI发现」chip is now **今日任务**; today pane source copy is **今天推荐**; today pane `not.toContainText("AI发现")`; default tab is 今日任务 |
| 2 | 我的待办 no regress | **PASS** | Tip 3 + 4 + 5 + 6: convert dedupe; waiting = 结果待确认; fold after 6; insight confirm lands in 我的待办; no「后续」bucket |
| 3 | AI发现 plan→runs gated (confirm before crawl/follow) | **PASS** | Tip 2: plan persist ≠ crawl; `/runs` only after confirm-plan; `/follow` never auto-fired |
| 4 | followed excludes unconfirmed candidates | **PASS** | Tip 1 + 2: 我跟进的红人 `data-followed-origin=collaboration`; `[data-discovery-candidate]` count 0 after unconfirmed plan |
| 5 | no auto send/stage | **PASS** | Tip 2: plan copy「不会自动发信或改阶段」; watcher for `/send` / `/confirm-stage` / crawl-start is `[]`; `LIVE_REMOTE_SIDE_EFFECTS=0` |

## Negative / out of scope (explicit)

- **No auto send:** plan / confirm-plan must not POST `/send`.
- **No auto stage:** plan / confirm-plan must not POST `/confirm-stage`.
- **No auto crawl/follow:** persist plan only; crawl/follow require confirm.
- **No LIVE:** `E2E_MODE=stub`; `LIVE_REMOTE_SIDE_EFFECTS=0`.
- **Not claimed:** full stub suite; `E2E_MODE=real`; LIVE send; LIVE stage write; LIVE MediaCrawler.

## Not run

- Full stub Playwright suite
- `E2E_MODE=real` / LIVE remotes
- LIVE send / LIVE stage / LIVE crawl

## kol one-liner

`main@1c9bfe7 (PR#61/#63/#62) stub Home four-entry: 6/6 tip PASS (~15.2s); 今日任务 rename; 我的待办 no regress; AI发现 plan→runs gated (confirm before crawl/follow); followed excludes unconfirmed candidates; no auto send/stage; verdict PASS; E2E_MODE=stub LIVE_REMOTE_SIDE_EFFECTS=0; no LIVE.`
