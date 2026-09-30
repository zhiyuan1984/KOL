# 成本与预算（Cost & Budget）设计稿

> 状态：方向已获用户裁决（2026-09-29；同日追加「覆盖员工个人」），实施按 `docs/superpowers/plans/2026-09-29-cost-and-budget.md`。
> 依据：[DECISIONS.md](../DECISIONS.md) ADR-2026-09-29（含同日修订）；`PRODUCT.md` PROD-PLAT-02 / PROD-PLAT-08；`TECHNOLOGY.md` TECH-TEST-04；`ia-information-architecture.md` §3。本稿不改法。
>
> **修订（2026-09-29，同日）**：汇总与预算范围增加**员工个人**（`cost_events.user_id`、汇总 `users`、预算 `scope=user`；运行前闸门判定顺序 公司 → Agent → 员工）。

## CONST-08 审宪记录

| 项 | 结论与证据 |
|---|---|
| 需求 | 记录每次模型运行的用量（估计值），按公司 / Agent / 员工个人 / 项目汇总；月预算三级（公司 / Agent / 员工）80% 警示、100% 硬停；管理端可查询与配置。 |
| 主责角色 | 平台产品经理（能力范围与口径）；后端专家（采集、闸门、存储、接口）；前端专家（治理面呈现）；测试经理（证据）。 |
| 宪法条款 | CONST-03（确定的规则由程序执行，不能只靠模型自觉）；CONST-05（不触碰发送 / 阶段 / 解密 / 删除闸门）；CONST-08（本记录）；CONST-10（不得伪造、缺口如实呈现）。 |
| 基本法条款 | PROD-PLAT-02（治理能力，成本与预算条目）；PROD-PLAT-08（成本与预算条款，含员工个人口径）；TECH-TEST-04（成本监控职责）；TECH-BE-08（可追溯）；`ia-information-architecture.md`（治理面坐落、使用 ≠ 治理）。 |
| 结论与证据 | **规则空白已补齐**：PRODUCT 增补能力条目与条款后实施；实现必须程序化（CONST-03），数据源必须真实（app-server `account/usage/read`），估计值与缺口显式标注。 |
| 下一步 | 按实施计划落地后端采集 / 闸门 / 接口与前端治理面；测试与发布证据见计划文件。 |

## 1. 范围与非目标

**Phase 1（本稿主体）**

- 记录：每次 `runCodex` 运行结束后采集线程级估计用量，落 `cost_events`（含发起员工 `user_id`）。
- 汇总：按公司、Agent、员工个人的月度用量（tokens）；事件明细可查。
- 预算：公司 / Agent / 员工个人三级；`limit_tokens` + `warn_percent`（默认 80）+ `hard_stop_percent`（默认 100）+ 启停；乐观锁版本。
- 闸门：命中硬停时阻止**新的**运行（不建箱、不启动 app-server），留下真实状态与恢复入口；判定顺序 **公司 → Agent → 员工**。
- 治理面：`/admin/cost` 只读汇总（含按个人）+ 预算配置 + 最近事件 + 诚实缺口清单。

**非目标（后续阶段）**

- 项目实体与 `by-project` 汇总（Phase 2，`cost_events.project_id` 已预留）。
- 员工本人查看自己的成本（属 IA 变更，未纳入；当前为治理面信息）。
- 辅助 Codex 调用点计量（邮件摘要 / 翻译 / 简报 / 意图识别等 5 处）；金额换算与价格表；`threadGoal.tokenBudget` 内层防线（协议已有，实测后另评）。

## 2. 数据源与真实性

- 唯一用量来源：Codex app-server `account/usage/read`（参数 `{ threadId }`，返回线程级 estimated 用量；协议见 `docs/codex/ClientRequest.json`，本机实测可用）。
- 每次运行都会 `thread/start` 全新线程（`runner.ts` 注释：「Always start with this run's capability set」），一运行一线程；采集窗口在 `turn/completed` 之后、`rpc.close()` 之前。
- 发起员工取运行上下文 `scopedUser()`；系统触发无员工时记 NULL（并入未归属总量，不进个人汇总）。
- 读失败不改变运行结果：只写 `contract_log`；事件内 `source = "codex_account_usage_estimated"`。
- `threadUsage` 具体字段形状以真实环境首次联调为准；形状不符或为空时按「缺口」处理，**不得以 0 冒充用量**。
- 金额：`cost_cents` 字段预留，Phase 1 恒为 NULL；只能来自版本化价格来源后才填充（PROD-PLAT-08）。

## 3. 数据模型（`backend/src/db.ts`）

```sql
CREATE TABLE IF NOT EXISTS cost_events (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    agent_id TEXT,
    user_id TEXT,
    skill_id TEXT,
    session_id TEXT,
    run_id TEXT,
    work_item_id TEXT,
    task_run_id TEXT,
    thread_id TEXT,
    project_id TEXT,
    source TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER,
    raw TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cost_events_window ON cost_events (occurred_at);
CREATE INDEX IF NOT EXISTS cost_events_agent_window ON cost_events (agent_id, occurred_at);
-- 员工维度索引在 migrateSchema 建立（老库先补列）：
-- CREATE INDEX IF NOT EXISTS cost_events_user_window ON cost_events (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS cost_budgets (
    scope TEXT NOT NULL,              -- 'company' | 'agent' | 'user'
    scope_ref TEXT NOT NULL,
    limit_tokens INTEGER,
    warn_percent INTEGER NOT NULL DEFAULT 80,
    hard_stop_percent INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (scope, scope_ref)
);
```

- 公司维度＝部署内主公司（`config/org-registry.yaml` 首个 `company` id）；公司预算行 `scope='company'`。
- **迁移**：新库由 `initSchema` 直接包含 `user_id`；老库由 `migrateSchema` 的 `add(cost_events, user_id)` 补列并建员工索引（先补列、后建索引，避免老库索引失败）。
- `project_id` 预留（Phase 2 挂接，不建外键以避耦）。

## 4. 采集与闸门（唯一权威点：`backend/src/worker/runner.ts` `runCodex`）

- **闸门**：`runCodex` 起始（`runtimeContext` 就绪后、`SkillExecution` / 建箱 / 建进程之前）调用 `budgetBlockFor(agentId, userId)`；命中 → `BudgetBlocked`：
  - 审计 `cost.budget.blocked`（不落 `workers` 行：被拦的运行未成为一次 worker 执行；痕迹由错误卡、任务终态与审计承担）；
  - 不建箱、不启动 app-server、不产生任何外部副作用；不误记为 `codex_unavailable`。
- **覆盖**：6 个 `runWorker` 调用点全部经 `runCodex`（host 任务链、compose-preview、today-plan ×2、home-discovery ×2）；`CODEX_MODE=stub` 不烧 token，不拦。
- **采集**：`turn/completed` 后调用 `captureThreadUsage(...)`（内部 `account/usage/read`，短超时；带 `agentId`、`userId`、skill/session/run 归因）；任何失败仅写 `contract_log`，绝不 throw。
- **会话呈现**：消息链 `execWorker` 捕获 `BudgetBlocked` → `error_card`（含原因与恢复入口）；HTTP 与 `CodexUnavailable` 同构（`unavailableOk`，`error.code = "budget_exceeded"`）。任务链 `finishBoundTask` 记 `failed` + 真实错误消息；compose-preview 返回 429 + 结构化错误。
- **不是**「Agent 自查预算」：闸门是 Host 程序行为（CONST-03）。

## 5. 预算与阈值判定

- 判定（整数运算，避免浮点）：`used_tokens * 100 >= limit_tokens * hard_stop_percent` → 停；`>= warn_percent` → 警示。
- 生效范围：公司行对全体生效；Agent 行只对该 Agent 生效；**员工行只对该员工触发的运行生效**；判定顺序 公司 → Agent → 员工；`enabled=0` 不判定；`limit_tokens` 为 NULL 视为不限。
- 状态词：`ok / warn / stopped / unconfigured / disabled`（界面同时给数值与状态词，不靠颜色）。
- 恢复入口：管理员提额（PUT + `expected_version`）或等待下月；被拦运行错误卡写明。
- 月窗口：`Asia/Shanghai` 自然月 `[start, end)`；窗口口径发布后保持稳定（PROD-PLAT-08）。

## 6. 接口（管理端，`requireAdmin`）

- `GET /api/admin/costs/summary?month=YYYY-MM`
  ```json
  {
    "month": "2026-09", "timezone": "Asia/Shanghai",
    "window": { "start": "...Z", "end": "...Z" },
    "totals": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "events": 0 },
    "agents": [ { "agent_id": "agent:kol", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "events": 0 } ],
    "users": [ { "user_id": "usr_x", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "events": 0 } ],
    "budgets": [ { "scope": "company|agent|user", "scope_ref": "...", "limit_tokens": null, "warn_percent": 80, "hard_stop_percent": 100, "enabled": 1, "version": 0, "used_tokens": 0, "percent": null, "state": "unconfigured" } ],
    "notes": ["usage_estimated_source", "auxiliary_codex_calls_unmetered", "cost_cents_unavailable"]
  }
  ```
  - `users` 只统计有 `user_id` 的事件；`budgets` 候选：公司 +（运行时 Agent ∪ 事件 Agent ∪ 已配 Agent 预算）+（事件员工 ∪ 已配个人预算）。
- `GET /api/admin/costs/events?limit=50&agent_id=` → `{ "events": [ ... 含 user_id ... ] }`（按时间倒序）。
- `PUT /api/admin/costs/budget` body `{ scope, scope_ref, limit_tokens, warn_percent, hard_stop_percent, enabled, expected_version }`（scope ∈ company/agent/user）→ 行；审计 `cost.budget.updated`；版本冲突 409。
- 错误风格：`HttpFail`（`{detail}`）；`expected_version` 用 `host/version.ts` 的解析。

## 7. 前端（治理面，`/admin/cost`）

- 导航：管理端侧栏「平台配置」簇加一条「成本」（顺序：数据 / 成本 / 配置；其余文字与顺序不变）。
- 页面（`AdminCosts.tsx`）：本月窗口与时区标注；公司总量与预算状态；**按个人**用量表（`api.adminUsers()` 做 id→name 映射，失败回落原始 id）；各 Agent / 员工预算表（进度条 + 数值 + 状态词；员工行注明判定顺序）；预算编辑（含 409 冲突提示与重试）；最近事件表（含发起员工）；缺口清单（估计值 / 辅助未计量 / 无金额）。
- 样式：复用 `.admin-*` / `.panel` / `.chip` 既有类；新增 `.cost-*` 组件样式只用现有 token（`--cost-meter-h` 已登记 `docs/DESIGN.md`）；状态不靠颜色（数值 + 文字 + 形状）。

## 8. 测试与证据

- 后端单测：月窗口 +08:00 边界（含跨月）、聚合、预算校验与版本冲突、闸门（警示不拦 / 命中硬停拦 / 公司级 / Agent 级 / **员工级** / 停用放行）、`parseThreadUsage`（含 null / 缺省 / snake_case）、`captureThreadUsage`（正常 / 读失败 / 无用量三态，含 **user_id 写入**）。
- 路由测试：summary（含 users）/ events / budget（admin 门、校验、409、**scope=user**、非法 scope 拒绝）。
- fixture：`backend/tests/fixtures/fake-codex.mjs` 增 `account/usage/read`。
- 前端：typecheck / build；导航断言更新（`sidebarNav.test.ts`、`e2e/workbench.spec.ts`）；`e2e/admin-costs.spec.ts`（含按个人表与个人预算行）。
- 验证命令：`cd backend && npm run typecheck && npm test`；`cd backend && npm run validate:contracts`；`cd frontend && npm run build`。

## 9. 缺口与后续（登记于 `docs/implementation-registry.md`）

- 辅助 Codex 调用点未计量（mail-summary / result-revise / profile-briefing / translate-zh / openai-intent）。
- 个人归因仅覆盖 `runCodex` 主链路；系统触发（无员工上下文）的用量并入未归属总量，不计入个人。
- 金额换算与价格表未建；`cost_cents` 恒 NULL。
- `threadUsage` 字段语义待真实环境联调；不符时按缺口呈现。
- 中止（abort）运行的用量不可补采（连接已关闭）。
- Phase 2：项目实体 + `cost_events.project_id` 挂接 + by-project 汇总（活动隶属项目，BIZ-19）。
- Phase 3：Agent 状态位 / 暂停恢复、唤醒原因、组织 × 数字员工只读归属视图。
