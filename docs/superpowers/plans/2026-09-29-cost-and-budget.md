# 成本与预算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 记录每次 Codex 运行的估计用量（tokens），按公司与 Agent 汇总；提供月预算（80% 警示 / 100% 硬停）与运行前程序闸门；管理端 `/admin/cost` 可视化与配置。

**Architecture:** 新模块 `backend/src/costs.ts`（事件 / 窗口 / 聚合 / 预算 / 闸门 / 用量解析与采集）；`runCodex` 起始处加闸门、`turn/completed` 后采集；管理端 API 走新 `routers/costs.ts`；前端新增治理页与导航条目。金额字段预留恒 NULL（缺价格来源）。

**Tech Stack:** 后端 Hono + better-sqlite3（`backend/src`，vitest：`npm test`）；前端 React 19 + Vite（`frontend/src`，Playwright E2E）。样式 token 唯一来源 `docs/DESIGN.md` → `frontend/src/styles.css`。

**Spec:** `docs/superpowers/specs/2026-09-29-cost-and-budget-design.md`；修法记录 `docs/DECISIONS.md` ADR-2026-09-29。

## Global Constraints

- 用量必须来自真实数据源（app-server `account/usage/read`，估计值须标注）；读失败按缺口处理，**不得以 0 冒充**（CONST-10）。
- 闸门是程序行为（CONST-03）：命中硬停只阻止**新运行**，不建箱、不启动 app-server；已发生事实不隐藏。
- 不触碰发送 / 阶段 / 解密 / 删除闸门；不新增员工面入口。
- 状态不靠颜色；同一视口 0–1 个实底主 CTA；新增样式只用既有 token（新增数值须同步 `docs/DESIGN.md`）。
- 本仓库约定：**不自动 git commit**（提交需用户明确要求）。
- 验证命令：后端 `cd backend && npm run typecheck && npm test`；契约 `npm run validate:contracts`；前端 `cd frontend && npm run build`。

---

## 阶段 A：后端

### Task A1: 数据表（`backend/src/db.ts` initSchema）

- [x] `cost_events`（id/occurred_at/agent_id/skill_id/session_id/run_id/work_item_id/task_run_id/thread_id/project_id/source/provider/model/input_tokens/output_tokens/total_tokens/cost_cents/raw/created_at）+ 两个索引
- [x] `cost_budgets`（scope/scope_ref/limit_tokens/warn_percent/hard_stop_percent/enabled/version/updated_at/updated_by，主键 scope+scope_ref）

### Task A2: 核心模块 `backend/src/costs.ts`

**Interfaces（供 A3–A5 使用）:**

- `COST_MONTH_TZ = "Asia/Shanghai"`；`monthWindow(month?: string)` → `{ month, timezone, startIso, endIso }`
- `recordCostEvent(input)` → 行；`costsSummary(month?)` → 设计稿 §6 形状
- `budgetBlockFor(agentId: string): BudgetBlockReason | null`；`class BudgetBlocked`（`asDict()` 含 `code:"budget_exceeded"`、原因、next_action）
- `listBudgets()`；`upsertBudget({scope, scopeRef, limitTokens, warnPercent, hardStopPercent, enabled, expectedVersion, actor})`
- `parseThreadUsage(result)` → `{ inputTokens, outputTokens, totalTokens, model, provider } | null`
- `captureThreadUsage({ rpc, threadId, log, agentId, skillId, sessionId, runId, workItemId, taskRunId })` → `Promise<void>`（永不 throw）
- `companyScopeRef()`（`config/org-registry.yaml` 首个 company id，兜底 `"primary"`）

- [x] 实现 + `backend/tests/costs.test.ts`（窗口 +08:00 边界 / 聚合 / 预算版本冲突 / 闸门三态 / parse 三态 / capture 三态）

### Task A3: 运行闸门与采集（`backend/src/worker/runner.ts`）

- [x] `runCodex`：`runtimeContext` 就绪后、`SkillExecution`/建箱/建进程之前 → `budgetBlockFor`；命中 → 审计 `cost.budget.blocked`（不落 workers 行）+ `throw BudgetBlocked`
- [x] `turn/completed` 后（状态判定之前）→ `await captureThreadUsage(...)`（含 contract_log 记录）

### Task A4: 宿主错误呈现（`backend/src/host/api.ts`）

- [x] `execWorker` catch：`BudgetBlocked` → `error_card`（persistent）
- [x] `unavailableOk` 泛化为接受 `{ asDict(): Json }`；消息端点 catch 增 `BudgetBlocked` 分支（与 CodexUnavailable 同构返回）

### Task A5: 管理端路由（`backend/src/routers/costs.ts` + `app.ts`）

- [x] `GET /api/admin/costs/summary`（requireAdmin）
- [x] `GET /api/admin/costs/events?limit=&agent_id=`
- [x] `PUT /api/admin/costs/budget`（校验 + `expected_version` + 审计 `cost.budget.updated`；409 冲突）
- [x] `app.ts` 挂载 `costsRouter`
- [x] `backend/tests/costs-router.test.ts`（admin / 校验 / 409 / 形状）

### Task A6: fixture

- [x] `backend/tests/fixtures/fake-codex.mjs` 增 `account/usage/read`（返回 `threadUsage` 样例）

## 阶段 B：前端（治理面）

### Task B1: API 客户端（`frontend/src/api.ts`）

- [x] `adminCostsSummary(month?)` / `adminCostsEvents(limit?)` / `adminSaveBudget(body)`

### Task B2: 页面与导航

- [x] `frontend/src/pages/AdminCosts.tsx`（汇总 / 预算编辑 / 事件表 / 缺口清单；状态不靠颜色）
- [x] `frontend/src/layout/adminNav.ts`：「平台配置」簇加「成本」（数据 / 成本 / 配置）
- [x] `frontend/src/pages/AdminConsole.tsx`：分支 + 取数
- [x] `frontend/src/styles.css`：`.cost-*` 组件样式（只用既有 token）

### Task B3: 测试断言同步

- [x] `frontend/src/layout/sidebarNav.test.ts`（管理端条目顺序）
- [x] `frontend/e2e/workbench.spec.ts`（侧栏文字序列）
- [x] （可行时）`frontend/e2e/admin-costs.spec.ts` 最小用例

## 阶段 C：验证与登记

- [x] `cd backend && npm run typecheck && npm test`
- [x] `cd backend && npm run validate:contracts`
- [x] `cd frontend && npm run build`
- [x] 更新 `docs/implementation-registry.md`（status / evidence / known_gaps）

## 后续阶段（另行计划）

- Phase 2：项目 / 活动实体 + `cost_events.project_id` 挂接 + by-project 汇总（BIZ-19）。
- Phase 3：Agent 状态位 / 暂停恢复、唤醒原因、组织 × 数字员工只读归属视图。
