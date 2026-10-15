# 邮件记忆公平调度与长正文可恢复翻译（隔离候选）

- **状态：** `in_progress`（隔离候选已实施，等待完整验证；未发布、未部署）
- **基线 / 分支：** `09bf29f6cf91017b6fc80ad3be610ac830c2d53b` / `ac-20261016-mail`
- **范围：** A；不执行未授权 B；不修改 package 文件（C 另行处理）

## CONST-08 实施登记

| requirement_refs | 主责角色 | 宪法与基本法依据 | 实施资产 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| CONST-03、CONST-05、CONST-08、TECH-ARCH-01、TECH-BE-03、TECH-BE-04、TECH-BE-06、TECH-TEST-01/02/03、PROD-AGENT-04/07/09、BIZ-02、BIZ-11、BIZ-18 | 后端专家（实施）、架构师（模块边界）、测试经理（证据） | PostgreSQL-only；后台作业必须持久化状态、错误、终态、恢复与回执；模型 I/O 在 SQL 事务外；源版本与权限/范围隔离；不得伪造成果 | `backend/migrations/20261016_049_mail_memory_progress.sql`；`src/postgres/mail-memory-progress-repository.ts`；`src/host/mail-memory-job.ts`；`src/postgres/mail-memory-repository.ts`；`src/starrykol/translate-zh.ts`；`src/cron/handlers.ts`（补全 phase/source/yield/error receipt 投影）；迁移 manifest；聚焦测试 | **符合。** 新表只保存本地邮件记忆调度游标和中间译文，不新增对象本体、权限、账号、审批、合作或阶段；最终写入仍 CAS，并同一客户端提交业务写、run checkpoint 和审计 finish。 | 完成独立 PG、合成 harness 与不扩大预算的验证；父代理串行汇总发布门禁。 |

## 设计与语义

1. **持久公平轮转：** `kol_mail_memory_progress` 以 mailbox（`*` 为全范围）持久保存 `items → threads → persons` 及各 phase 游标。一轮在 240 秒软预算内持续按单候选 phase turn 交替，可处理多封 item；连续三次 fresh/empty turn 立即有界退出，避免无限 wrap。任何接受、跳过、空 phase 和让出都会同事务持久化 cursor/next phase，正文积压不会饿死摘要 phase。
2. **预算：** 保持既有 **10 分钟频率、默认 240000 ms 总软预算、45 秒模型等待和既有单执行锁/并发**。预算让出不是 provider 失败：只提交 chunk/progress/run，不写 item 完成 fingerprint、attempt 或旧派生字段；下一 phase 已落库，长 item 可恢复。
3. **分片恢复：** `kol_mail_memory_chunk_progress` 绑定 **实际 item ID、当前 mailbox、原始 `body_text` MD5、实际 chunk_count 和连续 prefix**。每片以 expected-prefix CAS 追加，按 index 验证（不以重复译文 `indexOf` 推断）；失败只记录安全错误、不回写旧 prefix。单短正文不建 checkpoint。完成时 final CAS、checkpoint clear、cursor 和 run checkpoint 同一 SQL transaction，均重验 source/mailbox。
4. **中文与质量：** `source_zh` 仅限 Han/数字/标点/空白组成的原文；任何拉丁词、URL 或型号（例如 `我同意 deal`、`12V`）仍进模型。普通/长正文保留 >=8 Han 质量闸门并拒绝源英文 token/全文回显、前缀和 deterministic stub；只允许短纯英文 greeting 的 >=2 Han 真实短译（如 `thanks → 谢谢`）。
5. **诊断与终态：** receipt/stat 和 cron receipt 投影 phase、next phase、cursor、准确 pending/stale 候选、预算、chunk yield、source_zh 和 bounded error_types。Codex chunk/quality/disabled/provider 原因不被统一吞没。errors 与 budget 独立：`*_with_errors` 不会把 failed 隐藏成单纯 budget label；thread/person 刷新失败保留旧 successful fact 并标失败/过期。

## 边界与禁止项核对

- 未改 Starry DTO、MCP 路由/开关/凭据，`requestJson: JSON.stringify({ text })` 原样保留；未改 Luna BASE/模型，未新增凭据。
- 未改员工账号、资格、审批、合作 stage、ontology registry、基本法、权限或调度频率；未发信、未执行真实客户/生产业务、未访问生产业务库、未 push/deploy/reset。
- 只使用测试 runner 创建、命名并删除的自有 PostgreSQL 测试数据库；合成模型夹具在测试文件中显式标注，不能作为真实模型成功宣称。

## 验收证据与已知缺口

| 证据类别 | 资产 / 命令 | 状态 |
|---|---|---|
| 真正 PG 回归 | `tests/mail-memory-progress.postgres.test.ts`（同轮多 item + 三 phase、公平 cursor、fresh bounded exit、跨连接 checkpoint、source/scope 失配、中文/混合） | **待父任务已准备好的隔离 PG 环境统一运行**；本任务未 CREATE/DROP 本地或远端库。 |
| 合成文本 harness | `tests/translate-zh-progress.test.ts` + 旧 `translate-zh*.test.ts`（Unicode 无损、仅缺片调用、yield、任片失败、严格 pure/mixed/URL/model、短中文、占位/回显） | **已通过：22 tests / 3 files**（仅无业务副作用的合成 harness）。 |
| 历史回归 | 既有 `mail-memory*`、`translate-zh*`、cron tests | 待运行，不能跳过 |
| 类型 / 契约 / registry | `npm run typecheck`、`npm run validate:contracts`、`npm run validate:registry` | typecheck 已调用隔离 validation deps；仅报两处既有无关 `describe.sequential` Vitest 类型错误（`kol-scoring-criteria`、`kol-source-authority`），本变更未见类型诊断。contracts/registry/PG 回归待父任务统一执行。 |

**已知缺口：** 尚未进行真实 PostgreSQL 回归、有限 Codex synthetic probe、contracts/registry 或 production 验证；须由父任务在其隔离 PG 环境完成。候选仍未 scp、commit、push、deploy 或发布，不能把当前本地合成测试视为生产完成。
