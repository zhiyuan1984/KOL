# 邮件往来摘要：sticky fail 与失败可观测性（2026-09-13）

## 一行结论

`产品已批准后端两项`：① **sticky fail 恢复**（优先）；② **失败可观测性**。本文件是只读审查 + 批准范围。不批准 provider 策略、指纹重设计、寒暄过滤改动、超时加长。

**事实 vs 建议：** 带「事实」的段落陈述仓库现状；带「建议 / 落地」的段落是批准后的最小实现。

无 LIVE 发送 / 阶段写入。日志不得出现 API key。

---

## 问题（事实）

远程 Codex / Luna 往来摘要失败时，Host 把 `source=analysis_failed` 和规则文案 `analyzeThreadDigest` 写入 `app_state` 键 `mail_digest:<collaborationId>`。

`needsRemoteThreadDigest` 在指纹未变且 `retryFailed` 为 false 时直接跳过远程。普通会话重载 / SSE snapshot **不**传 `retryFailed`（只有 `GET /sessions/:sid?sync=1`、打开合作会话后的 mail sync、邮件变更刷新会传）。员工因此一直看到规则摘要，无法自动再试。

现有失败路径只打 `[mail-summary] <where>: <message>`，不带合作 id，也不把 timeout / HTTP 500 / no-key / greeting reject 写进存储或 journey。

---

## 现状锚点（事实）

| 位置 | 行为 |
|---|---|
| `backend/src/host/mail-summary.ts` `needsRemoteThreadDigest` | 同指纹 + `analysis_failed` + 无 `retryFailed` → 不调远程 |
| `ensureCodexThreadDigest` | 远程空 / 寒暄拒绝 → 写 `source=analysis_failed` + 规则正文 |
| `GET /api/sessions/:sid` | `retryFailed` 仅当 `sync=1` |
| `GET /api/sessions/:sid/events` SSE snapshot | 不传 `retryFailed` |
| `journey.mail_digest` | 仅 `text` / `source` / `mail_count` |
| FE `threadDigestView` | `analysis_failed` 显示「分析未完成」，不把规则文案标成 Codex / Luna 成功 |

寒暄 / poison 过滤必须保留：规则寒暄句不得标成 Codex 成功。`usableRemoteText` / `isGreetingDump` / `isRuleGreetingFallback` 不在本批准范围内改语义。

---

## 产品批准范围

| # | 项 | 状态 |
|---|---|---|
| 1 | Sticky fail 恢复 | **批准（优先）** |
| 2 | 失败可观测性 | **批准** |
| — | Provider 策略（Codex↔Luna 顺序等） | 不批准 |
| — | 指纹重设计 | 不批准 |
| — | 寒暄过滤改动 | 不批准 |
| — | 超时加长 | 不批准 |

---

## 落地：最小安全设计（本 PR）

### 1) Sticky fail 恢复

**选择：按 `failed_at` 冷却后再试**，而不是给每次 session GET / SSE 无条件 `retryFailed`。

无条件 light retry 会在每次 SSE 重连、页刷新时打远端，远端持续 500/超时时会放大失败。冷却更小、更安全。

规则：

1. 写入 `analysis_failed` 时记 `failed_at`（ISO）。
2. 同指纹 + `analysis_failed` + 无 `retryFailed`：若 `now - failed_at < MAIL_DIGEST_FAIL_RETRY_MS`（默认 5 分钟）→ 仍跳过远程。
3. 冷却到期后，普通 session GET / SSE snapshot 走既有 `needsRemoteThreadDigest` → `journeyPayloadWithMailMemory`，自动再试。
4. 显式 `retryFailed: true`（下拉 `sync=1`、邮件变更刷新）仍立即再试。
5. **历史记录没有 `failed_at`**：视为已过期，下次打开即可恢复（修当前已卡住的员工）。
6. 寒暄 / poison 拒绝仍写 `analysis_failed`，不写 `codex_memory` / `luna`。

环境变量：`MAIL_DIGEST_FAIL_RETRY_MS`（毫秒，默认 `300000`，上限 24h）。

### 2) 失败可观测性

持久化并随 `journey.mail_digest`（及 `mail_summaries`）带出：

| 字段 | 含义 |
|---|---|
| `error` | 稳定短码：`timeout` / `HTTP 500` / `no-key` / `greeting_reject` / `parse` / `missing_thread` |
| `attempted` | 实际试过的 provider，如 `["luna"]` 或 `["codex_memory","luna"]` |
| `failed_at` | 本次失败时间 |

日志统一为：

```text
[mail-summary] col=<collaborationId> <where>: <error>
```

禁止写 API key / Bearer。成功写入远程摘要时清掉 `error` / `attempted` / `failed_at`。

FE 只把 `error` 附在「分析未完成」状态上，**不**把规则正文标成 Codex 成功。

---

## 测试（无 LIVE）

`backend/tests/mail-summary.test.ts`：

- 新鲜 `analysis_failed` 在冷却内不重试；把 `failed_at` 调旧后自动再试成功。
- `error` / `attempted` / `failed_at` 出现在存储和 journey：HTTP 500、timeout、no-key、greeting_reject。
- `[mail-summary]` 行含 `col=` 且不含 key。

---

## 不决定

不改 Codex→Luna 顺序、不改指纹算法、不放宽寒暄过滤、不加长 `MAIL_ANALYSIS_TIMEOUT`、不 LIVE 发送/改阶段、不做完整 ADR（行为变更已记 `docs/DECISIONS.md` 近期记录）。

## 后续小修：Codex 模型与 Luna 端点（2026-09-13）

与 sticky-fail 无关、已另批的配置对齐：

- Codex 往来摘要 `thread/start` 与识别路径共用 `codexRecognizeThreadConfig()`：只传 `CODEX_MODEL`，否则用 CLI 默认模型。**不要**把 Luna 的 `gpt-5.6-luna` 传给 Codex digest。
- Luna digest（`INTENT_LLM_MODEL` 默认 `gpt-5.6-luna`）必须设 `OPENAI_BASE_URL` 为 Luna 兼容端点，并用该端点的 key。公共 OpenAI `sk-proj-*` 打 `api.openai.com` + `gpt-5.6-luna` 会 HTTP 401（key/endpoint 不匹配）。这不是 sticky-fail，也不是 provider 顺序变更。
