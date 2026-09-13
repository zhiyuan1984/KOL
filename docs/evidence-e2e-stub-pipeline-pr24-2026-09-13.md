# Evidence: stub E2E — Pipeline lifecycle cleanup (PR #24)

- **Date:** 2026-09-13
- **PR:** https://github.com/zhiyuan1984/KOL/pull/24
- **Branch:** `cursor/pipeline-page-role-9335` (local `pr-24`)
- **SHA:** `cd6ab81c9194a9ed3cc00aa9d0dbf648c3ba634b` (= PR headRefOid)
- **Commit:** Assert Pipeline brand filters close a stale lifecycle drawer.
- **Workdir:** `/workspace/KOL-real` (git worktree of `/workspace/KOL`)
- **Mode:** `E2E_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` not used for judgment. Not `E2E_MODE=real`.
- **Auth:** `E2E_AUTH_MODE=disabled`
- **Browser:** `PW_CHANNEL=chrome` (Linux Google Chrome)
- **Port:** `E2E_PORT=8893`
- **Focus:** FE Pipeline page role cleanup — docs/19 roles + Pipeline.tsx (no RELATED_HOME, no fake board chips, no auto-select first KOL, drawer detail, propose stage change only)

## Setup

1. `git fetch origin pull/24/head:pr-24` + `git fetch origin cursor/pipeline-page-role-9335` → checked out `pr-24` tracking tip SHA above.
2. Frontend rebuilt on tip (`unset E2E_SKIP_BUILD`; inherited env had `E2E_SKIP_BUILD=1`). Dist: `frontend/dist/assets/index-BuMX2Lul.js` (+ `index-AhiRyFyV.css`).
3. Stub-only Playwright via `scripts/e2e-server.mjs` (webServer rebuild confirmed same dist hash).

## Authoritative focused run

- **Output:** `/workspace/KOL-real/artifacts/e2e/pw-stub-pr24-pipeline-20260913-172033`
- **Grep:** `-g 'pipeline|Pipeline|lifecycle|阶段|milestone|pipeline-row|提出阶段|只看异常'`
- **Matched titles:** 3 (Playwright title grep; many `阶段` hits are assertion bodies, not titles)
- **Result:** **3 passed / 0 failed** (14.0s)
- **JSON:** `/workspace/KOL/artifacts/e2e/stub-pipeline-pr24-2026-09-13.json` (mirrored under `/workspace/KOL-real/artifacts/e2e/`)

| # | Test | Status |
|---|------|--------|
| 1 | pipeline review follows the common task flow with progress and a right-side result | **PASS** |
| 2 | pipeline shows a 15-stage milestone timeline and lifecycle drawer | **PASS** |
| 3 | home lifecycle followed KOL opens the mail rail not the task list | **PASS** |

### Coverage map (test 2 = primary PR#24 surface)

| Focus | How covered |
|-------|-------------|
| 15-stage milestone timeline | `[data-stage-axis] li` count 15; milestone `data-current` on 小美妆日记 / 数码老张 |
| No auto-select first KOL | `.pipeline-item.is-selected` count 0 until row click; drawer absent initially |
| Drawer detail | click `[data-pipeline-row]` → `[data-pipeline-drawer]` + creator ledger |
| Propose stage only | `[data-propose-stage]` text `提出阶段变更`; drawer not.toContainText `写合作邮件` / `记状态` |
| No RELATED_HOME / home chips | `[data-pipeline-related]` / `[data-pipeline-task]` count 0; page not.toContainText `首页任务` / `本页动作` |
| Brand filter closes stale drawer | select brand RO → drawer count 0; deep-link `?brand=RO` / `?kol=` covered |

## Negative / skim

- **Pipeline.tsx source:** no `RELATED_HOME`, no `首页任务`, no `本页动作`, no `data-pipeline-related` / `data-pipeline-task` markers.
- **workbench.spec tip:** negative expects already updated; no remaining RELATED_HOME / 首页任务 / 本页动作 / auto-select positives for Pipeline. No failures from stale expectations.
- **`只看异常`:** no match in tip frontend source or e2e titles (grep token unused).

## Not run

- Full stub suite
- `E2E_MODE=real` / LIVE remotes

## kol one-liner

`PR#24 cd6ab81 stub Pipeline lifecycle: 3/3 PASS (15-stage+drawer+no RELATED_HOME/首页任务/auto-select; propose-stage only); no LIVE; rebuild required (unset E2E_SKIP_BUILD).`
