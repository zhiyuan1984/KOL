# 首版 `/api/experts` 落实 ADR-016（2026-09-14）

立法：PR #53 / **ADR-016**（已入 `main`）：员工 `/agents`（专家中心 / 数字员工入口）只回答「找谁协作 / 召唤岗位专家」。本文件是该法律的第一版后端落地记录。不宣称 LIVE，不重定义 `19` 并列能力面（ADR-015）。

## 服从 ADR-016

| 法律 | 本后端 |
|---|---|
| 只列出已发布、可供召唤的岗位专家 | `GET /api/experts` 仅 `status=published` |
| 无专家团 | 无 list / members / placeholder 端点 |
| 召唤 = 绑定会话，≠ 发信 / 改阶段 | `POST /api/experts/:id/summon` 只写 `expert_id` + `expert_version` |
| 员工默认不见 Profile / Harness / MCP / Codex / Skill catalog / 连接器状态 | 专家 API 不投影这些字段；`/profiles` `/skills` `/connectors` `/api/agent-manifest` 不是专家中心 API |
| `/admin/agents` 是治理 | 本 PR 不改管理端 |
| 并列能力面仍解耦 | 不拥有知识库 / 审批 / 考试 / 连接器使用面 |

## 命名

| 名称 | 角色 |
|---|---|
| 数字员工 / 岗位专家 | 员工端文案（ADR-016） |
| DigitalEmployee | `docs/02` 领域对象 |
| Expert / ExpertManifest / `expert:kol` | 本版机器可读资产与 **API** 命名 |
| Agent / `agent:kol` | 内部发布包。`GET /api/agent-manifest` 不变 |

## 锁定字段（`expert:kol` / `KOL 合作专员`）

`id` / `version` / `status` / `display_name` / `profession` / `description` / `avatar` / `category` / `tags` / `mission` / `quick_prompts` / `entry_skill`

## 召唤响应

恰好 `{ session_id, expert_id, expert_version, intro }`。`intro` 是给人看的中文说明。

## 请评审链到 agent **kol**
