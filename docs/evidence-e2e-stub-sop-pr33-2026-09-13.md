# Evidence: stub E2E — SOP card densify (PR #33)

- **Date:** 2026-09-13
- **PR:** https://github.com/zhiyuan1984/KOL/pull/33 — **MERGED**
- **Branch:** `cursor/sop-card-density-448d`
- **Verified ref:** `origin/main` (detached in `/workspace/KOL-real`)
- **SHA:** `4af4b6904ff7deb1ed75022d644c0fb26f8abd85` (merge commit = current `origin/main`)
- **PR tip (ancestor):** `6847980445e27ca9c3e70f047c73d5f09558d730` — FE tree identical to merge (`git diff 6847980 origin/main -- frontend/` empty)
- **Commit:** Merge pull request #33 from zhiyuan1984/cursor/sop-card-density-448d
- **Workdir:** `/workspace/KOL-real` (git worktree of `/workspace/KOL`)
- **Mode:** `E2E_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` not used for judgment. Not `E2E_MODE=real`.
- **Auth:** `E2E_AUTH_MODE=disabled`
- **Browser:** `PW_CHANNEL=chrome` (Linux Google Chrome)
- **Port:** `E2E_PORT=8894`
- **Focus:** FE remove SOP「输入」, denser `KolPortraitFields`, CSS tighten; negatives on open SOP

## Setup

1. `git fetch origin pull/33/head` then `git fetch origin main` → checked out **detached `origin/main` @ `4af4b69`** (PR#33 merge). (`main` branch name is held by `/workspace/KOL` worktree.)
2. Frontend rebuilt on tip (`unset E2E_SKIP_BUILD`). Dist: `frontend/dist/assets/index-5GgQIXv4.js` (+ `index-C4Nejnl-.css`).
3. Stub-only Playwright via `scripts/e2e-server.mjs` (webServer rebuild confirmed same dist hash).

## Authoritative focused run

- **Output:** `/workspace/KOL-real/artifacts/e2e/pw-stub-pr33-sop-main-20260913-204214`
- **Screenshot:** `kol_session_digest_sop_journey.png`
- **Grep:** `-g 'ingested inbound|stage.sop|红人画像|confirm 有兴趣|data-stage-sop'`
- **Matched titles:** 1 (Playwright title grep)
- **Result:** **1 passed / 0 failed** (11.9s)
- **JSON:** `/workspace/KOL/artifacts/e2e/stub-sop-pr33-2026-09-13.json` (mirrored under `/workspace/KOL-real/artifacts/e2e/`)

| # | Test | Status |
|---|------|--------|
| 1 | ingested inbound mail appears in the KOL session and can confirm 有兴趣 | **PASS** |

### Grep workbench for other `输入` + stage-sop asserts

- Only this test asserts `输入` against `[data-stage-sop]` (both **negative**: `not.toContainText("输入")` at pre-confirm and post-confirm reopen).
- Other `[data-stage-sop]` uses: `openStageSop` helper; `session page has no coach next-step card…` (open=false / align only — title not matched by `-g`, no `输入` assert). No extra titles to add.

### Coverage map

| Focus | How covered |
|-------|-------------|
| Open SOP has 红人画像 | `openStageSop` → `[data-stage-sop]` contains `红人画像` (before + after confirm) |
| No SOP「输入」 | `[data-stage-sop]` `not.toContainText("输入")` ×2; `Chat.tsx` has no `输入` string |
| platform / brand chips | `[data-portrait-field='platform']=小红书`; `[data-portrait-field='brand']=LT` |
| Denser KolPortraitFields | followers `82万`; stay `12 天`; tags `.chip` ×2; portrait not `@小美妆日记` |
| confirm 有兴趣 | mail-confirm → stage `已回复-有兴趣` / `意向`; SOP still densified |

## Negatives / source skim

- **Open SOP must NOT contain「输入」:** **PASS** (e2e + `frontend/src/pages/Chat.tsx` has zero `输入`).
- **Still has 红人画像 / platform-brand chips:** **PASS** (`sop-summary-sub` 红人画像; platform/brand chips via `KolPortraitFields`).
- Tip e2e already flipped positives → `not.toContainText("输入")`; no stale「输入」expect failures.

## Not run

- Full stub suite
- `E2E_MODE=real` / LIVE remotes

## kol one-liner

`PR#33 MERGED 4af4b69 (main) stub SOP densify: 1/1 PASS (ingested inbound+confirm 有兴趣; open SOP no「输入」, has 红人画像+platform/brand chips); no LIVE; rebuild required.`
