# Home AI发现后端（2026-09-14）

## 总判

新「AI发现」是 **CreatorCandidate 红人线索管道**（ADR-018），不是旧「今日任务」推荐芯片。

对照 `docs/19-ui-ux-constitution.md` / ADR-018：员工先确认发现计划，再异步采集；**加入跟进** 才创建 Collaboration。不自动进「我的待办」，不发信，不写阶段，不指定负责人。

## Canonical API

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/discovery/requests` | 只持久化计划（`status=open` / 待确认）。**不**启动采集。201 |
| GET | `/api/discovery/requests/:id` | 请求摘要（员工文案：待确认 / 采集中 / 已完成 / 失败） |
| GET | `/api/discovery/requests/:id/results` | 面板就绪：request + latest run + candidates + counts |
| POST | `/api/discovery/candidates/:id/follow` | **唯一**可从线索创建/关联 Collaboration 的路径 |

配套：`GET /api/discovery/requests`、`POST /api/discovery/requests/:id/runs`（确认后启动 Run）、`GET /api/discovery/runs/:id`。

候选人字段与 Home 芯片重叠处对齐：`title`、`reason`、`source` / `source_label`、`handle`、`intent`，另有 `nickname`、`followers`、`score`、`avatar_url`、`summary`、`request_id`、`run_id`。默认平台 `youtube` + `instagram`。

## 不变量

- 创建请求 ≠ 启动 MediaCrawler；确认/start 才走既有 `startCrawl`。
- Crawl 完成只写 `creator_candidates`，不建 Collaboration。
- 员工 JSON 不含 MediaCrawler / MCP / Job ID / crawl_job_id。
- 不写入 `home-board.recommendations` / `buildRecommendedTasks`（那是今日任务）。
- 自动化测试只用 `youtube` / `instagram` / `facebook`。

## 代码入口

- `backend/src/discovery.ts`
- `backend/src/routers/discovery.ts`
- `backend/migrations/004_ai_discovery.sql`
- `backend/tests/discovery.test.ts`
