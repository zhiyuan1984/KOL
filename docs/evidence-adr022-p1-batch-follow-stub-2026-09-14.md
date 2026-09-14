# Evidence: ADR-022 P1 勾选 / 条件批量加入跟进 → Starry（stub）

- **Date:** 2026-09-14
- **PR:** (pending)
- **Branch:** `cursor/adr-022-p1-batch-follow-eee6`
- **Mode:** `CODEX_MODE=stub`. **No LIVE.** `LIVE_REMOTE_SIDE_EFFECTS` default off / not used for judgment.
- **Focus:** 勾选批量（B）与条件批量（C）共用一张 L3 确认卡 / 一个 `source_batch`；Host 按 P0 单行管道逐条写入；部分成功不整批标已跟进。

## 总判

**PENDING（stub）** — 测试跑完后回填。

## Authoritative run

```text
cd backend && npm test -- tests/discovery-follow-batch.test.ts tests/discovery-follow-import.test.ts tests/discovery.test.ts
```

## Coverage map

| ADR-022 P1 lock | How covered |
|---|---|
| B 勾选批量 | `POST /api/discovery/candidates/follow-batch` + `candidate_ids`；每条真实 `kolUid` |
| C 条件批量 | `filter.min_followers` / `min_avg_views_10` / `min_score` + 计划平台 / 地区；列表 `preview:true` + 写入前复核 |
| 一张确认 / 每 `source_batch` | 确认卡摘要（人数、缺邮箱、门槛）；审计 `discovery.candidates.follow_batch` |
| 部分成功 | 失败线索仍 `suggested`；不把整批标成 followed |
| 幂等 | 再提交 → `skipped_duplicate[]`，不双建 Collaboration |
| 缺地区 | 计划有地区、线索无地区：审计 warn，不拒绝、不编造 |
| 同 handle 不串档 | 批量仍不改写 Starry 同行 `kol_uid` |
| 禁发信 / 改阶段 / 解密 / 编造邮箱 | `sideEffects()` 全 0；CSV 不含 contactEmail |
| LIVE 默认关 | `CODEX_MODE=real` + `LIVE_REMOTE_SIDE_EFFECTS=0` → 失败项，不跟进 |
| 员工文案 | JSON 不含 MediaCrawler / MCP / Codex |
| 平台 / 地区复用计划芯片 | FE 只读计划芯片，不另造一套 |

## Residual

- 历史 `disc_*` Collaboration 不在本 PR 全量迁移。
- 大批量走与 P0 相同的逐条单行导入（有限并发），不把 N 次远程调用包进同一 SQLite 事务。不 LIVE。

## kol one-liner

`ADR-022 P1 stub: pending (selected+conditional batch follow; partial success; write-time recheck; no disc_* steal/send/stage/decrypt/email); LIVE off.`
