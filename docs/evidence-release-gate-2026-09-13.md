# Stub production `release:gate` 证据（2026-09-13）

## 结论

`main` @ `9f9c5a8`（合并 PR #10 / #11 / #12 之后）的 stub production `release:gate` 判定为 **PASS**。`tb-binding` 由用户豁免，不计入阻断。**这不是生产上线。**

仓库内未见 `artifacts/release-gate-stub-2026-09-13-main-pr12.*`；本文件是该次门禁判定的文字记录。

## 基线

| 项 | 值 |
|---|---|
| 提交 | `9f9c5a8`（`9f9c5a8c95cfc6b41d0f3e45c541faf5692ea37a`） |
| 入口 | `backend` 下 `npm run release:gate`（production profile，`CODEX_MODE=stub`） |
| 宿主 | cloud Linux + Playwright Chromium |
| 总判定 | **PASS**（stub 门禁；非 go-live） |

## 门禁项

| 门禁项 | 结果 | 证据/限制 |
|---|---|---|
| 总体 `release:gate` | PASS | stub production 判定；TB 豁免后不阻断 |
| `tb-binding` | WAIVED | 用户豁免，不是本轮阻断；校验器未放宽、禁止品牌回退 |
| `frontend-e2e` | PASS | 78 PASS（stub Chromium） |
| `backend-full-tests` | PASS | 586 PASS |
| `contracts-production` | PASS | Agent 已发布后生产契约编译通过 |

未在本文件补记其它步骤的新计数。历史步骤结果仍以 [`16-production-test-plan.md`](16-production-test-plan.md) §2.1–2.10 为准。

## 仍不是生产上线

- Stub 门禁绿 ≠ 生产放行，也不是 Real 全量 78 条通过。
- 运行时 Gateway、`LIVE_*`、confirm-before-send/stage 未因本次判定放宽。
- TB 远端品牌字典仍未确认；豁免只影响本轮门禁结论。

## 既有 real-mode 证据（不新造数字）

下列条目只回指已入库文档，不在本文件追加新计数：

- 受控发信 PASS、测试 KOL 缺生命周期时的阶段写入阻断：[`evidence-kol-stage-write-2026-09-12.md`](evidence-kol-stage-write-2026-09-12.md)，见测试计划 §2.2。
- Real staging：Codex `initialize` / `account/read` / `thread/start` PASS；最小 `turn/start` 与首封建联 / 风险扫描 / 达人库查询 E2E BLOCKED；Starry 只读探针 62 工具 / 221 画像 / 5 邮箱 / 16 阶段：§2.8 与 `artifacts/e2e/real-staging-2026-09-13.json`。
- 相邻 LIVE `toStageCode` 写入（`KOL202607300002` lifecycle 16）：[`evidence-stage-request-shape-2026-09-13.md`](evidence-stage-request-shape-2026-09-13.md)，见 §2.10。
- Stub crawl E2E 仅 YouTube / Instagram：§2.9。
- 等待态只读审查（无 LIVE 副作用）：[`evidence-wait-status-plan-2026-09-13.md`](evidence-wait-status-plan-2026-09-13.md)。

现有 `docs/evidence-*.md` 没有带独立计数的 session-confirm、approval-gate、admin-smoke、skills-sample 或 claw real-mode 报告；这些场景只作为 stub `frontend-e2e` 78 条的一部分，不在此写成 real-mode PASS。
