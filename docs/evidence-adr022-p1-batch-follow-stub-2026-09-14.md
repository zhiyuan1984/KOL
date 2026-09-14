# Evidence: ADR-022 P1 勾选 / 条件批量加入跟进 → Starry（stub PASS）

- **Date:** 2026-09-14
- **PR:** https://github.com/zhiyuan1984/KOL/pull/92
- **Branch:** `cursor/adr-022-p1-batch-follow-eee6`
- **Mode:** `CODEX_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` default off / not used for judgment.
- **Focus:** 勾选批量（B）与条件批量（C）共用一张 L3 确认卡 / 一个 `source_batch`；Host 按 P0 单行管道逐条写入；部分成功不整批标已跟进。

## 总判

**PASS（stub）** — 采集仍只产线索；确认后才写主档；失败线索保持 `suggested`；成功路径不用 `disc_*`；本路径不发信、不改阶段、不解密、不编造邮箱。条件门槛在 Host 列表预览 + 写入前复核。平台 / 地区复用发现计划芯片。

## Authoritative run

```text
cd backend && npm test -- tests/discovery-follow-batch.test.ts tests/discovery-follow-import.test.ts tests/discovery.test.ts
```

| Suite | Tests | Result |
|---|---|---|
| `discovery-follow-batch.test.ts` | 9 | **PASS** |
| `discovery-follow-import.test.ts` | 10 | **PASS** |
| `discovery.test.ts` | 14 | **PASS** |
| **Total** | **33** | **33 passed / 0 failed** |

Companion (unchanged Starry stub surface still green after batch follow):

```text
cd backend && npm test -- tests/starrykol.test.ts tests/starrykol-read-never.test.ts
```

| Suite | Tests | Result |
|---|---|---|
| `starrykol.test.ts` | 41 | **PASS** |
| `starrykol-read-never.test.ts` | 6 | **PASS** |

Frontend: `cd frontend && npx tsc --noEmit` **PASS**.

## Coverage map

| ADR-022 P1 lock | How covered |
|---|---|
| B 勾选批量 | `POST /api/discovery/candidates/follow-batch` + `candidate_ids`；3 条各回真实 `kolUid`；共享 `source_batch` |
| C 条件批量 | `filter.min_followers` / `min_avg_views_10` / `min_score` + 计划平台 / 地区；`preview:true` 不写；写入只跟 Alpha/Gamma，Beta 失败仍 suggested |
| 一张确认 / 每 `source_batch` | FE 一张确认卡（人数、缺邮箱、门槛、只读计划芯片）；审计 `discovery.candidates.follow_batch`（`sent:false` / `stage_changed:false`） |
| 部分成功 | Beta 导入失败 → `failed[]`；另两条 followed；失败行 `status=suggested`；Discovery Collaboration=2 |
| 幂等 | 同 `source_batch` 再提交 → `skipped_duplicate[]=3`，Collaboration 仍 3 |
| 写入前复核 | 所选 + `min_followers:40000` → 409 语义进 `failed[]`，0 次 import |
| 缺地区 | 计划 `us`、线索无地区：审计 `discovery.candidate.region_unverified`，仍 follow |
| 同 handle 不串档 | 批量 follow 两个 SharedHandle：`KOLSHAREDA` / `KOLSHAREDB`；不改写 Starry 同行 |
| 禁发信 / 改阶段 / 解密 / 编造邮箱 | `sideEffects()` 全 0；factory 只允许 `importKolProfilesFromCrawler`；CSV 不含 contactEmail |
| LIVE 默认关 | 未确认 → 409；`CODEX_MODE=real` + `LIVE_REMOTE_SIDE_EFFECTS=0` → `import_creator_live_disabled`，不跟进 |
| 员工文案 | JSON 不含 MediaCrawler / MCP / Codex / Starry |
| 平台 / 地区复用计划芯片 | FE 只读 `data-discovery-plan-chip`，不另造一套 |

## Residual

- 历史 `disc_*` Collaboration 不在本 PR 全量迁移。
- 大批量走与 P0 相同的逐条单行导入（并发 3），不把 N 次远程调用包进同一 SQLite 事务。映射多行 CSV 的回填不如逐条可测，故未走「一张大 CSV 再拆 kolUid」。
- 本证据不是 LIVE / 生产放行。浏览器未对真实采集结果做端到端点击（无 LIVE 采集环境）；行为由 stub HTTP 测试覆盖。

## kol one-liner

`ADR-022 P1 stub: 33/33 PASS (selected+conditional batch follow; partial success; write-time recheck; same-handle no rewrite; missing region=audit warn; no disc_* steal/send/stage/decrypt/email); LIVE off.`
