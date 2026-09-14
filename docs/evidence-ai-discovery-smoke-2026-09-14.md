# Home AI发现 MediaCrawler smoke（2026-09-14）

## 总判

**PASS** — STUB 全路径通过；REAL 计划确认与采集中通过，结果入库/`加入跟进`因 Host↔本地 MCP `get_creators` 参数契约不一致 **BLOCKED**。远端 natapp MCP **BLOCKED**（connection refused）。未发信、未写阶段。

- Commit: `1c9bfe7` (`1c9bfe74bf23f0a20134ea55475e69125a3c59cc`)
- Worktree: `/workspace/KOL-real`（未新建 clone）
- Keywords: `portable power station` / `户外电源`
- Platform: `youtube` only（未启动 xhs/dy/ks/bili/wb/tieba/zhihu）
- `LIVE_REMOTE_SIDE_EFFECTS` 本进程覆盖为 `0`；未扩 LIVE_* allowlist；未调用 sendEmail/wecom

## MCP hosts（仅 host，无 token）

| 用途 | Host | 状态 |
|---|---|
| 远端 natapp（.env 默认） | `s636695a.natappfree.cc` | BLOCKED connection refused |
| STUB mock | `127.0.0.1:18000` | UP |
| REAL local | `127.0.0.1:8000` | UP `/health` ok；YouTube yt-dlp 完成 15 creators 落盘 |

## 结果表

| Item | Status |
|---|---|
| stub_plan | PASS |
| stub_progress | PASS |
| stub_results | PASS |
| stub_follow | PASS |
| real_plan | PASS |
| real_progress | PASS |
| real_results | BLOCKED |
| real_follow | BLOCKED |
| no_auto_send | PASS |
| no_stage_write | PASS |
| copy_no_mcp_job | PASS |
| overall | PASS |

## STUB（`CODEX_MODE=stub`，mock MCP `127.0.0.1:18000`）

1. **Plan confirm** — `POST /api/discovery/requests` → 201，`status=open`，`status_label=待确认`，`latest_run=null`（未自动开爬）。
2. **In progress** — `POST .../runs` → 202，`status=running`，`status_label=采集中`（非瞬间假完成）。
3. **Result list** — 2 candidates（`PortablePowerLab`, `OutdoorBatteryHQ`），`ready=true`，文案无 MCP/Job。
4. **加入跟进** — `POST /api/discovery/candidates/:id/follow` → `status=followed`，`collaboration.source=discovery`，`stage_code=INITIAL_CONTACT`（协作行初始码，**非** stage transition / starry_stage_writes）。
   - `starry_sends` Δ=0
   - `starry_stage_writes` Δ=0
   - `stage_transitions` Δ=0

## REAL（`CODEX_MODE=real`，local MCP `127.0.0.1:8000`，auth=sriphy）

1. **Plan confirm** — PASS（待确认，未自动开爬）。
2. **In progress** — PASS（持续 `采集中` / crawl `analyzing`，非假完成）。
3. **Result list** — **BLOCKED**。MCP 任务已 `idle` 且结果文件含 **15** 个 YouTube creators，但 Host `completeJob` → `get_creators` 传入 `task_id`/`offset`/`limit`，本地 MCP 仅接受 `platform`/`page`/`page_size`，pydantic 校验失败；Host 卡在 `analyzing`，`creator_candidates` 仍为 0。员工 API 仍只显示「采集中」，无引擎词泄漏。
4. **加入跟进** — **BLOCKED**（无已入库候选人可跟进）。

## 文案

- `frontend/src/home/DiscoveryPanel.tsx` 员工可见文案含「加入跟进 / 检索计划 / 检索中」，**不含** MCP / Job / job_id / task_id / MediaCrawler。
- `DISCOVERY_BANNED_JARGON` 为前端屏蔽表（非展示文案）。
- STUB/REAL 员工 JSON 抽检无 MediaCrawler/MCP/Job ID/crawl_job。

## 证据文件

- Markdown: `docs/evidence-ai-discovery-smoke-2026-09-14.md`
- JSON: `artifacts/evidence-ai-discovery-smoke-2026-09-14.json`
- Raw: `artifacts/ai-discovery-smoke-2026-09-14/stub-result.json`, `real-result.json`

## Blocker（一句）

REAL 结果入库被 Host 与本地 MediaCrawler MCP 的 `get_creators` 参数契约不一致挡住（Host 发 `task_id/offset/limit`，MCP 要 `page/page_size`），故候选人未进库、`加入跟进` 无法在 REAL 完成。

## Host 契约修复（本 PR）

`backend/src/crawl/service.ts` `fetchCreators` 改为 MCP 契约：

- 只传 `platform`（来自 crawl job）、`page`（1-based，与本地 `backend/mcp/tools.ts` 及 `docs/median_mcp_server.md` 一致）、`page_size`
- **不**传 `task_id` / `offset` / `limit`
- 分页：空页或 `has_more === false` 停止；尊重 `total`；无 `has_more` 时满页继续、短页结束

Discovery 仍走既有 `completeJob` → `ingestMediacrawler` → `onCrawlJobSettled` → `creator_candidates`。不另起爬虫栈。海外平台不变（YouTube only in this smoke）。员工 JSON 仍不得泄漏 MediaCrawler / MCP / Job ID。

### 验证

- `backend/tests/mediacrawler.test.ts`：断言 Host 调用 `get_creators` 的 args 为 `platform` / `page` / `page_size`；pydantic-strict mock 拒收 extra fields 时仍能分页拉全量并 `result_ready`
- `backend/tests/discovery.test.ts`：同一契约下 results + follow 通；无 LIVE send / 无 stage write
