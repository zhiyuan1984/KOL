# Expert / DigitalEmployee 首版后端（2026-09-14）

对照基准：`origin/main` @ `741bc83` 之后的 Expert 后端 PR。本文件记录命名、资产位置、缺字段和召唤边界。不宣称 LIVE，不重定义 `19` 并列能力面。

## 命名

| 名称 | 角色 |
|---|---|
| DigitalEmployee | `docs/02` 领域对象：岗位身份、目标、知识范围、权限、可用 Agent |
| Expert / ExpertManifest / `expert:kol` | 本版机器可读资产与 API 命名，映射到 DigitalEmployee |
| Agent / `agent:kol` | 发布包（skills / workflows / policies / mcp / employee_views）。`GET /api/agent-manifest` 不变 |

不要把 Expert 塞进 `employee_views.entries[].skillId`。

## 资产位置

选择 `experts/<id>/manifest.yaml`（当前 `experts/kol/manifest.yaml`），与 `docs/14` 顶层必备资产并列，而不是 `agents/kol/experts/`。这样 Agent 发布包保持独立。

## 已发布对象

仅 `expert:kol`，`publish_gate.state: published`。

从 `agent:kol` 自然带出的范围：`organization_scope` / `brand_scope` / `region_scope`，以及只读 `permissions.policy_refs`（`send_email` / `change_stage` / `import_creator`）。

## 缺字段（不伪造）

API 详情省略下列字段，并在 `missing_fields` 列出：

- `knowledge_scope`：仓库尚无 `knowledge/kol` 条目可引用；返回 `[]`
- `knowledge_manifest`
- `owner_ref`：不把 Agent 业务 owner 冒充成 DigitalEmployee owner
- `live_health`：无 LIVE 探活
- `runtime_projection`：`running_since` / `last_session_id` / `last_outcome` 未做
- `organization_unit_membership`：数字部门未做
- `exam_gate`

## API

| 方法 | 行为 |
|---|---|
| `GET /api/experts` | 已发布摘要；未认证走现有 `authMiddleware`（401） |
| `GET /api/experts/:id` | 全量投影；未知或对员工未发布 → 404 |
| `POST /api/experts/:id/summon` | 创建当前用户会话并写 `sessions.expert_id`；可选 `title` / `collaboration_id`（复用 `openKolSession`）；未发布 → 409 `expert_not_published` |

召唤不调用 `confirm-stage`、`compose-send`、LIVE 邮件或 Gateway LIVE。

## 与 `19` 并列能力面

本 API 让员工召唤已发布专家。`/agents` 仍是工作入口。不把专家升格为第五套 Home，不改知识库 / 审批 / 考试 / 连接器使用面的主权，也不做连接器治理。

## 请评审链到 agent **kol**
