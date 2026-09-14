# Evidence: ADR-022 P0 单个加入跟进 → 单行导入 → 真实 kolUid（stub PASS）

- **Date:** 2026-09-14
- **PR:** https://github.com/zhiyuan1984/KOL/pull/91
- **Branch:** `cursor/adr-022-p0-single-follow-03f2`
- **Mode:** `CODEX_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` default off / not used for judgment.
- **Focus:** 单个 CreatorCandidate 加入跟进 = 一张 `import_creator` 确认；Host 调 `importKolProfilesFromCrawler`；成功才跟进并回填真实 `kolUid`。

## 总判

**PASS（stub）** — 采集仍只产线索；确认后才写主档；失败不半跟进；成功路径不用 `disc_*`；本路径不发信、不改阶段、不解密、不编造邮箱。

## Authoritative run

```text
cd backend && npm test -- tests/discovery-follow-import.test.ts tests/discovery.test.ts
```

| Suite | Tests | Result |
|---|---|---|
| `discovery-follow-import.test.ts` | 10 | **PASS** |
| `discovery.test.ts` | 14 | **PASS** |
| **Total** | **24** | **24 passed / 0 failed** |

Companion (unchanged Starry stub surface still green after adding `importKolProfilesFromCrawler` mock):

```text
cd backend && npm test -- tests/starrykol.test.ts tests/starrykol-read-never.test.ts
```

| Suite | Tests | Result |
|---|---|---|
| `starrykol.test.ts` | 41 | **PASS** |
| `starrykol-read-never.test.ts` | 6 | **PASS** |

## Coverage map

| ADR-022 P0 lock | How covered |
|---|---|
| Crawl 只产 CreatorCandidate | `crawl still only creates candidates and does not write Starry`；`does not auto-create Collaboration when crawl completes` |
| 一张确认 / Policy `import_creator` | FE 既有确认卡 + `POST /follow`；审计 `host.import_creator`（`policy` / `source_batch` / `sent:false` / `stage_changed:false`） |
| 单行 crawler CSV，无编造邮箱 | mapper 单测 + factory 断言 `fileName`/`fileBase64` 含 YOUTUBE / 万粉 / 近10均播，不含 `contactEmail` |
| 成功才跟进，真实 `kolUid` | follow 回 `KOLOUTDOORPOWER`；`not.toMatch(/^disc_/)` |
| 失败诚实、线索仍 suggested | import throw → 502 员工文案；`collaboration_id` 仍 null |
| 回传无编号 | 502 `import_creator_no_kol_uid`；无 discovery Collaboration |
| 幂等 | 再 follow `created:false`，同一 collab / 同一 `kolUid`，count=1 |
| 门槛写入前复核 | P0 单个（mode A）：thresholds 可选，省略=放行，本 PR 不强制 FE 默认。Mode C（后续）才要求粉/均播/分 + 计划平台/地区。thresholds 409 且不调 import；省略仍可 follow |
| 同 handle 不串档 | 同显示名、不同 `platform_creator_id`：follow A 不改写 B / Starry 同行的 `kol_uid`；仅 `source=discovery` + 本线索 `disc_*` 才允许 handle 回填 |
| 计划地区有、线索无地区 | 审计 `discovery.candidate.region_unverified`，**不拒绝**，不编造 candidate.region |
| LIVE 默认关 | `CODEX_MODE=real` + `LIVE_REMOTE_SIDE_EFFECTS=0` → 409「当前未开启主档写入」 |
| 禁发信 / 改阶段 / 解密 | `sideEffects()` sends/stageWrites/transitions = 0；factory 只允许 `importKolProfilesFromCrawler` |
| 员工文案无引擎行话 | `assertEmployeeCopy` / JSON 不含 MediaCrawler / MCP / Codex |

## Residual

- 历史 `disc_*` Collaboration 不在本 PR 全量迁移。`isPlaceholderKolUid` / `discoveryPlaceholderKolUid` 只作识别；成功路径不得再用。
- P1/P2 勾选批量 / 条件批量未做。共享映射在 `backend/src/discovery-import.ts`。
- 本证据不是 LIVE / 生产放行。

## kol one-liner

`ADR-022 P0 stub: 24/24 PASS (confirm→import→real kolUid; same-handle no rewrite; omit thresholds=allow; missing region=audit warn; no disc_* steal/send/stage/decrypt/email); LIVE off.`
