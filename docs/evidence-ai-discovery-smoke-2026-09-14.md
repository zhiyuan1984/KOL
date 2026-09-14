# Home AI发现 MediaCrawler smoke（2026-09-14）

## 总判

**PASS** — STUB 全路径通过；REAL 在 Host `get_creators` 契约修复（PR #66 / `98f1898`）后全路径通过。远端 natapp MCP **BLOCKED**（connection refused），本轮 REAL 使用本地 MCP。未发信、未写阶段。

- Commit: `98f1898` (`98f189814c8d41a15f7781ef9dcd09c8169d00d7`)
- Worktree: `/workspace/KOL-real`（未新建 clone；本 worktree checkout 到该 commit）
- Keywords: `portable power station` / `户外电源`
- Platform: `youtube` only（未启动 xhs/dy/ks/bili/wb/tieba/zhihu）
- `used_url`: `http://127.0.0.1:8000/mcp`
- `LIVE_REMOTE_SIDE_EFFECTS` 本进程覆盖为 `0`；未扩 LIVE_* allowlist；未调用 sendEmail/wecom

## MCP hosts（仅 host，无 token）

| 用途 | Host | 状态 |
|---|---|
| 远端 natapp（.env 默认） | `s636695a.natappfree.cc` | BLOCKED connection refused |
| STUB mock | `127.0.0.1:18000` | UP（先前 STUB 证据） |
| REAL local | `127.0.0.1:8000` | UP `/health` ok；`used_url` http://127.0.0.1:8000/mcp |

## 结果表

| Item | Status |
|---|---|
| stub_plan | PASS |
| stub_progress | PASS |
| stub_results | PASS |
| stub_follow | PASS |
| real_plan | PASS |
| real_progress | PASS |
| real_results | PASS |
| real_follow | PASS |
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

## REAL（`CODEX_MODE=real`，local MCP `127.0.0.1:8000`，auth=sriphy，commit `98f1898`）

1. **Plan confirm** — PASS（`dreq_abb69fb585a8`，待确认，未自动开爬）。
2. **In progress** — PASS（`drun_9f4c38af9d0b`，持续 `采集中`，非假完成）。
3. **Result list** — PASS。Host `completeJob` → `get_creators` 现传 `platform`/`page`/`page_size`；入库 **23** YouTube candidates（keyword portable power station / 户外电源），`ready=true`，`status_label=已完成`。员工 JSON 无 MCP/Job 泄漏。样本 handles：IEETek, SoreinPower, Portable Power Station, portable power station factory, LIPOWER Official, portable power station。
4. **加入跟进** — PASS（`cand_58974aa28bf6` → `followed`，`collaboration.source=discovery`，`stage_code=INITIAL_CONTACT`）。
   - `starry_sends` Δ=0
   - `starry_stage_writes` Δ=0
   - `stage_transitions` Δ=0

## 文案

- `frontend/src/home/DiscoveryPanel.tsx` 员工可见文案含「加入跟进 / 检索计划 / 检索中」，**不含** MCP / Job / job_id / task_id / MediaCrawler。
- `DISCOVERY_BANNED_JARGON` 为前端屏蔽表（非展示文案）。
- STUB/REAL 员工 JSON 抽检无 MediaCrawler/MCP/Job ID/crawl_job。

## 证据文件

- Markdown: `docs/evidence-ai-discovery-smoke-2026-09-14.md`
- JSON: `artifacts/evidence-ai-discovery-smoke-2026-09-14.json`
- Raw: `artifacts/ai-discovery-smoke-2026-09-14/stub-result.json`, `real-result.json`

## Blocker（一句）

无（REAL 此前 get_creators 契约 BLOCKED 已由 PR #66 / `98f1898` 解除；natapp 仍 DOWN，本轮用本地 MCP）。

## Host 契约修复（PR #66）

`backend/src/crawl/service.ts` `fetchCreators` 改为 MCP 契约：只传 `platform` / `page` / `page_size`，不传 `task_id` / `offset` / `limit`。本轮 REAL 复跑验证入库与 `加入跟进` 成功。
