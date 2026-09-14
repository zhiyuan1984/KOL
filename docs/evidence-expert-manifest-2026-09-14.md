# Expert / 数字员工 首版后端（2026-09-14）

对照 kol / 产品首版字段锁定。本文件记录命名、资产位置和召唤边界。不宣称 LIVE，不重定义 `19` 并列能力面。

## 命名

| 名称 | 角色 |
|---|---|
| 数字员工 | 员工端文案 / 侧栏用词 |
| DigitalEmployee | `docs/02` 领域对象 |
| Expert / ExpertManifest / `expert:kol` | 本版机器可读资产与 **API** 命名 |
| Agent / `agent:kol` | 内部发布包。`GET /api/agent-manifest` 不变；员工专家页不得用 `/profiles` + `/skills` + `/connectors` 拼装 |

## 资产位置

`experts/kol/manifest.yaml`，与 Agent 包分离。

## 已发布对象

仅 `expert:kol`，`status: published`，`display_name: KOL 合作专员`。

锁定字段：`id` / `version` / `status` / `display_name` / `profession` / `description` / `avatar` / `category` / `tags` / `mission` / `quick_prompts` / `entry_skill`。

本阶段明确不做：组织/部门/品牌授权、审批模型、专家团队成员。

## API

| 方法 | 行为 |
|---|---|
| `GET /api/experts` | **只**返回 `status=published`；未认证走现有 401 |
| `GET /api/experts/:id` | 锁定字段投影；未知或未发布 → 404 |
| `POST /api/experts/:id/summon` | 响应恰好 `{ session_id, expert_id, expert_version, intro }`；会话持久化 `expert_id` + `expert_version` |

`intro` 是给人看的中文说明。召唤不发信、不改阶段、不自动做高风险动作、不 LIVE。

## 与 `19` 并列能力面

本 API 让员工召唤已发布专家。页面路由可由 UI 决定（`/agents` 或 `/experts`）。不把专家升格为第五套 Home。

## 请评审链到 agent **kol**
