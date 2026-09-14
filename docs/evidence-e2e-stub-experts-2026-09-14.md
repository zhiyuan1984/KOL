# Evidence: stub E2E — Expert Center / 数字员工 (PR #55 / #54)

- **Date:** 2026-09-14
- **PR (FE):** https://github.com/zhiyuan1984/KOL/pull/55 — **MERGED** (`cursor/expert-center-v1-56fe`)
- **PR (BE):** https://github.com/zhiyuan1984/KOL/pull/54 — **MERGED** (`cursor/expert-backend-be6b`; ExpertManifest + `/api/experts` + summon)
- **Legislation:** PR #53 / ADR-016 (`docs/19`) — employee `/agents` only answers「找谁协作 / 召唤岗位专家」
- **Verified ref:** `origin/main`
- **SHA:** `c5abaf7e8401c66302d26e3c3fb232f977346013`
- **Commit:** Merge pull request #55 from zhiyuan1984/cursor/expert-center-v1-56fe
- **Mode:** `E2E_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` not used for judgment. Not `E2E_MODE=real`.
- **Auth:** `E2E_AUTH_MODE=disabled`
- **Spec:** `frontend/e2e/workbench.spec.ts`
- **JSON:** `artifacts/e2e/stub-experts-2026-09-14.json`
- **Focus:** discover → detail → summon identity (`expert:kol` / `KOL 合作专员`); no mail / no stage; no 专家团; no Skill / MCP / Profile

## Verdict

**PASS.** Primary **3/3 PASS**. Supplemental **3/3 PASS**. Jargon check **PASS**. Coverage **4/4 PASS**. **No LIVE.**

This is stub Expert Center evidence on `main@c5abaf7` after #54+#55. It is not a production go-live and not a full stub-suite or real-mode pass.

## Setup

1. `git fetch origin main` → detached / branch tip **`c5abaf7e8401c66302d26e3c3fb232f977346013`** (merge of PR #55 onto `main` that already contains PR #54).
2. Stub-only Playwright (`E2E_MODE=stub`). Summon is a bound session. Judgment does not use LIVE remotes, send, or stage write.
3. Focused greps only (titles below). Full stub suite and `E2E_MODE=real` were **not** run.

## Primary run — 3/3 PASS

Discover (list IA) → detail → summon identity. Home must not pile expert tasks.

| # | Test | Status |
|---|------|--------|
| 1 | agents expert center has recommend/mine/all/search and one KOL expert | **PASS** |
| 2 | home does not pile expert task lists | **PASS** |
| 3 | expert center list → detail → summon binds a session without send/stage | **PASS** |

### Primary how-covered

| Test | How covered |
|------|-------------|
| 1 discover / list IA | `/agents` default `data-expert-view='recommend'` selected; one card `data-expert-card='expert:kol'`; QA 谁 / 擅长 / 能完成 / 怎么开始; published tag `建联`; views 推荐 / 我的数字员工 / 全部数字员工 / 搜索; empty mine + empty search; no `stage_sop` / `关联技能` on the expert page |
| 2 home isolation | `[data-home]` visible; `[data-expert-card]` count 0; home not.toContainText `召唤专家` / `你可以这样说` |
| 3 list → detail → summon identity | list card → `/agents/kol` detail (使命 / 擅长 / 你可以这样说 / 工作方式 / 召唤); `POST /api/experts/…/summon` body keys exactly `expert_id`, `expert_version`, `intro`, `session_id`; `expert_id=expert:kol`; bound `/s/…` shows `[data-expert-identity='expert:kol']` + `[data-expert-name]=KOL 合作专员` + intro + 3 `[data-expert-task]`; side-effect watcher for `POST/PUT/PATCH` `/messages`, `/drafts/…/send`, `/confirm-stage` is `[]` |

## Supplemental run — 3/3 PASS

Employee chrome around the expert center: no 最近 list, employee persona, docs/21 sidebar lock.

| # | Test | Status |
|---|------|--------|
| 1 | sidebar does not list 最近 sessions | **PASS** |
| 2 | employee persona hides admin chrome and connector config | **PASS** |
| 3 | docs/21 employee sidebar has no admin connectors deep-link | **PASS** |

### Supplemental how-covered

| Test | How covered |
|------|-------------|
| 1 no 最近 | `[data-recents]` / recent search toggles / `筛选最近` / sidebar label `最近` count 0; `nav[aria-label="今日"]` + `数字员工` + `资产` remain |
| 2 employee persona | persona `employee`; no `/admin/connectors` deep-link; `/agents` is 数字员工 expert center with `expert:kol` / `KOL 合作专员` / CTA `召唤专家`; 数字员工 cluster `[data-nav]` count 1; `/teams` redirects to `/agents`; no 数字团队 heading |
| 3 docs/21 sidebar | `[data-nav="agents"]` text `数字员工` href `/agents`; cluster count 1; no `[data-nav="skills"]` / `技能目录` in sidebar; connectors href `/connectors` not `/admin/connectors`; no `数字团队` / `专家团` / teams nav |

## Jargon check — PASS

Employee Expert Center and default digital-employee chrome must not show engine catalog or 专家团. Summon identity is the published role expert only.

| Check | Status | How covered |
|-------|--------|-------------|
| No 专家团 | **PASS** | Employee `/agents` page and sidebar `not.toContainText("专家团")`; no teams / 数字团队 entry; `/teams` → `/agents` |
| No Skill catalog as employee expert surface | **PASS** | Expert page `not.toContainText("技能目录")` / `关联技能`; sidebar `[data-nav="skills"]` count 0; CTA is `召唤专家` not `在会话里用` |
| No MCP | **PASS** | Employee `/agents` body `not.toContainText("Starry KOL MCP")` / `Host +` |
| No Profile / Harness / Codex | **PASS** | `[data-agent-profile]` count 0; detail `not.toContainText("Harness")`; body `not.toContainText("Codex")` |
| Summon identity `expert:kol` / `KOL 合作专员` | **PASS** | Primary test 3: summon JSON `expert_id=expert:kol`; session `[data-expert-identity='expert:kol']`; `[data-expert-name]` = `KOL 合作专员` |

Skill hub `/market/skills` still has catalog chrome for non-expert surfaces; that is not the employee Expert Center. This record does not treat the skill hub as in-scope Expert Center jargon.

## Coverage table — 4 PASS

| # | Focus | Status | Proof |
|---|-------|--------|-------|
| 1 | discover → detail → summon identity | **PASS** | Primary 1 + 3: list `expert:kol` → `/agents/kol` → summon `{ session_id, expert_id, expert_version, intro }` → bound session identity `expert:kol` / `KOL 合作专员` |
| 2 | no mail / no stage | **PASS** | Primary 3: no `/messages`, `/drafts/…/send`, or `/confirm-stage` on summon; ADR-016 / #54 summon is bind-session only |
| 3 | no 专家团 | **PASS** | Jargon + supplemental 2/3: no 专家团 / 数字团队 on employee `/agents` or sidebar |
| 4 | no Skill / MCP / Profile | **PASS** | Jargon: no 技能目录 / 关联技能 as expert chrome; no Starry KOL MCP / Host + / Codex / Profile / Harness on employee expert surface |

## Negative / out of scope (explicit)

- **No mail:** summon must not POST session messages or draft send.
- **No stage:** summon must not call `confirm-stage` or write lifecycle.
- **No 专家团:** no list/members/placeholder employee surface.
- **No Skill / MCP / Profile:** employee Expert Center is not a Skill picker, MCP directory, or Agent Profile/Harness page.
- **Not claimed:** full stub suite; `E2E_MODE=real`; LIVE send; LIVE stage write; admin connector governance as employee chrome.

## Not run

- Full stub Playwright suite
- `E2E_MODE=real` / LIVE remotes
- LIVE send / LIVE stage

## kol one-liner

`main@c5abaf7 (PR#55/#54) stub Expert Center: primary 3/3 PASS + supplemental 3/3 PASS + jargon PASS; discover→detail→summon identity expert:kol / KOL 合作专员; no mail/stage; no 专家团; no Skill/MCP/Profile; verdict PASS; no LIVE.`
