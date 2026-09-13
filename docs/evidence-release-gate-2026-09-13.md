# Stub production `release:gate` 证据（2026-09-13）

## 结论

`main` @ `9f9c5a8`（Merge PR #12 之后）在 `CODEX_MODE=stub` 下跑 production `release:gate`，判定 **pass**。`tb-binding` 由用户批准 **WAIVED**；校验器本身仍 **blocked**（远端品牌字典仅 LT/RO/PQ）。**这不是生产上线。**

机器产物名：`artifacts/release-gate-stub-2026-09-13-main-pr12.{log,json,judgment.json}`。本工作区检出未见这些文件；本文件按已完成门禁判定落档。

## 基线

| 项 | 值 |
|---|---|
| 提交 | `9f9c5a8`（`9f9c5a8c95cfc6b41d0f3e45c541faf5692ea37a`，Merge PR #12） |
| 入口 | `backend` 下 `npm run release:gate`（production profile，`CODEX_MODE=stub`） |
| Agent manifest | 官方已发布（PR #3）：`status: production` / `publish_gate.state: published` / `employee_submission: true`（非本地 unlock） |
| 总判定 | **pass**（stub 门禁；非 go-live） |

## 门禁项

| 门禁项 | 结果 | 证据/限制 |
|---|---|---|
| 总体 `release:gate` | pass | stub production 判定；TB 豁免后不阻断 |
| `tb-binding` | WAIVED | 用户批准豁免。校验器仍 blocked：远端仅 LT/RO/PQ。校验器未放宽、禁止品牌回退 |
| `contracts-production` | PASS | 生产契约编译通过 |
| `backend-full-tests` | PASS | 586 passed / 1 skipped |
| `frontend-e2e` | PASS | 78 passed（stub Chromium） |
| `kol-evals` | PASS | 门禁步骤通过；本文件不另写新计数 |
| `kol-data` | PASS | 门禁步骤通过；本文件不另写新计数 |
| typecheck / build / redaction / rollback | PASS | 前后端 typecheck、frontend build、redaction scan、rollback rehearsal 均通过 |

## 仍不是生产上线

- Stub 门禁 pass ≠ 生产放行，也不是 Real 全量 78 条通过。
- 运行时 Gateway、`LIVE_*`、confirm-before-send/stage 未因本次判定放宽。
- TB 远端品牌字典仍未确认（仅 LT/RO/PQ）；豁免只影响本轮门禁结论。

## 既有 real-mode 索引（不新造数字）

只回指已入库文档，不追加新计数：

- session-confirm / approval / admin / stage `toStageCode`：**ready**（相邻 LIVE hop 见 [`evidence-stage-request-shape-2026-09-13.md`](evidence-stage-request-shape-2026-09-13.md)；受控发信见 [`evidence-kol-stage-write-2026-09-12.md`](evidence-kol-stage-write-2026-09-12.md) §2.2）。
- mediacrawler / 完整 stage-write：**仍 blocked**（缺生命周期时的写入阻断仍见 stage-write 证据；skip-walk / 非 allowlist 未宣称 LIVE PASS）。
- Real staging 握手 PASS、Turn/业务 E2E BLOCKED、Starry 只读 62/221/5/16：测试计划 §2.8。
- Stub crawl 仅 YouTube / Instagram：§2.9。
