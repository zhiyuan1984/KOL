# Home AI发现后端（2026-09-14）

## 总判

Home **AI发现** 现在有独立的发现流水线，不再只靠 `buildRecommendedTasks` 启发式芯片，也不再只是把 crawl job 绑到 `work_items`。

对照 `docs/19-ui-ux-constitution.md`：AI发现 = 今天推荐 / 发现候选人，**预填 / 待确认**，不自动执行成待办。员工必须 **confirm-follow** 之后才创建 Collaboration。对照 `docs/04-ux-ui-system.md`：AI 发现不会自动变成员工待办。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/discovery/requests` | 创建 DiscoveryRequest；默认异步启动第一次 Run（202）。`start:false` 只建请求（201） |
| GET | `/api/discovery/requests` | 列出当前员工的请求 |
| GET | `/api/discovery/requests/:id` | 请求 + 最近一次 Run 摘要 + DiscoveryResult |
| POST | `/api/discovery/requests/:id/runs` | 启动 / 重试一次 Run（复用 `startCrawl` + MediaCrawler MCP） |
| GET | `/api/discovery/runs/:id` | Run 状态 + 结果摘要 |
| GET | `/api/discovery/runs/:id/candidates` | 分页 CreatorCandidate |
| GET | `/api/discovery/candidates/:id` | 候选人详情 |
| POST | `/api/discovery/candidates/:id/follow` | **唯一**可从候选人创建/关联 Collaboration 的路径 |
| POST | `/api/discovery/candidates/:id/dismiss` | 驳回；不创建 Collaboration |

## 不变量

- 不发 LIVE 邮件，不写 / 推进官方阶段。
- Crawl 完成只入库 `creator_candidates`（同时仍可写入既有 `claw_creators`），**不**自动建 Collaboration。
- 自动化测试只使用海外平台：`youtube` / `instagram` / `facebook`。
- 容器 `work_items.source=discovery` 不是待办，也不是 `source=ai` 的旧 insight 任务。
- `/api/home/board` 的 `workbench.discovery` 与 `recommendations`（`source:"ai"`）只展示待确认候选人。

## 代码入口

- `backend/src/discovery.ts`
- `backend/src/routers/discovery.ts`
- `backend/migrations/004_ai_discovery.sql`
- `backend/tests/discovery.test.ts`
