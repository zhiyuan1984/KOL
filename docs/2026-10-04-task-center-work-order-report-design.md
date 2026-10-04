# 任务中心：工单报表优先、任务行展开子工单设计

**日期：** 2026-10-04  
**状态：** 已实施并完成本地 PostgreSQL/前端验证；本次提交至 main，不部署  
**适用入口：** 员工端「任务中心」  
**数据权威：** PostgreSQL `tickets(task-root)`、`work_orders`、`work_order_execution_attempts`、`work_order_assignments`、`work_order_decisions`

---

## 1. 要解决的问题

当前任务中心将 AI 工单呈现为历史运行任务列表上方的一块“AI 标准工单任务”摘要。其问题是：

1. 用户首先看到的是 Agent 运行状态，而不是业务 Task 和工单执行负荷；
2. 只能看到每个 Task 的总数/阻塞数，无法回答“自动派了多少工单、什么类型最多、哪些需人工处理”；
3. 为看子工单必须打开抽屉，Task 与其工单没有形成列表内的层级关系；
4. 列表 API 当前用逐 Task 聚合读取，不能作为报表主数据源，也不适合扩大到日常运营量。

目标是把任务中心变成一个业务执行面：

```text
工单运营报表（先回答：有多少、自动化到哪里、什么类型、哪里卡住）
  ↓
业务任务列表（每行一个 Task，显示聚合事实）
  ↓ 点击“展开工单”
子工单明细（该 Task 的标准执行单元；不混入 Agent 运行）
  ↓
系统运行任务（历史 Agent/技能执行任务；保留但不抢占业务主视图）
```

> **Task 是列表一级对象；Work Order 是 Task 的子对象；Execution Job/Agent Run 是工单或系统的运行记录，不能冒充业务任务。**

---

## 2. 信息架构

### 2.1 页面顺序

| 区域 | 目的 | 默认状态 | 数据来源 |
|---|---|---|---|
| A. 工单运营报表 | 一眼看库存、自动化产出、类型与异常 | 始终展开 | 新增 PostgreSQL 聚合 read model |
| B. 业务任务 | 每行一个 Task，优先按阻塞/期限/更新时间排序 | 始终展开 | 新增 PostgreSQL 任务列表 read model |
| C. 行内子工单 | 展开指定 Task 后显示其 Work Orders | 按需加载 | 已有详情 API，补齐来源/分派事实 |
| D. 新建业务任务 | 创建 Task 根 | 触发后展开 | 已有 Task 根创建 API |
| E. 系统运行任务 | 历史 Agent、技能、队列执行记录 | 默认折叠 | 既有 `/api/workbench/tasks` |

### 2.2 员工端主视图草图

```text
任务中心

┌ 工单运营报表 · 我可访问的业务范围 · 截至 2026-10-04 16:55 ┐
│  业务任务  12  │  标准工单  36  │  自动生成  18  │  自动派单  11 │
│  待复核     3  │  阻塞       5  │  已完成      8  │                 │
├ 工单类型（按标准模板）──────────────────────────────────────────┤
│ 类型 / 版本          总计   自动生成   自动派单   开放   待复核 │
│ 报价期限跟进 v2       14      10          8        9      1   │
│ 样品签收核验 v1        8       4          0        3      2   │
│ 内容期限跟进 v1        6       4          3        4      0   │
└───────────────────────────────────────────────────────────────┘

┌ 业务任务 ───────────────────────────────────────── 新建业务任务 ┐
│ 任务 / 目标          工单       自动派单    当前阻塞 / 下一步    ▸ │
│ 推进 KOL 报价确认    3（2开）    1          报价期限跟进            │
│ 样品签收与测试       2（1开）    0          等待人工复核            │
│ 内容发布跟进         1（1开）    1          内容期限跟进            │
└───────────────────────────────────────────────────────────────┘

展开“推进 KOL 报价确认”
┌ 子工单明细 ────────────────────────────────────────────────────┐
│ 类型             标题              来源/等级     受理人   状态    │
│ 报价期限跟进 v2  报价期限跟进…      自动 · A2     王某     已分派  │
│ 资料核验 v1      核验报价附件…      人工 · A1     —       待复核  │
└───────────────────────────────────────────────────────────────┘

▸ 系统运行任务（历史 Agent / 技能执行记录）
```

### 2.3 不做的事情

- 不把“自动生成”或“自动派单”解读为业务成功、成交、验收或员工绩效；
- 不用子工单状态自动完成父 Task；
- 不显示模型隐式推理、API key 或完整事件原文；
- 不把所有全局工单暴露给普通员工；
- 不删除历史 Agent 运行任务，只把它从业务 Task 主视图移出。

---

## 3. 报表口径：必须可审计

报表不能由前端对逐 Task 数据累加计算，必须由 PostgreSQL 单次服务端聚合，并和 Task 列表使用**相同授权范围**。

### 3.1 授权范围

| 当前访问者 | 可计入 Task / Work Order |
|---|---|
| 普通员工 | 自己创建的 Task；或自己是有效主受理人/协同受理人的 Task 下 Work Order |
| 管理员 | 当前 PostgreSQL 授权公司/组织范围内的 Task 与 Work Order |

响应必须返回 `scope`、`as_of`、`timezone`、`source`，避免数字被误读为全公司口径。

### 3.2 顶部 KPI 的精确定义

| 指标 | 统计对象 | 精确定义 |
|---|---|---|
| **业务任务** | Task 根 | 授权范围内 `task_type=business_task AND profile=task-root` 的数量 |
| **标准工单** | Work Order | 这些 Task 下所有 `work_orders` 数量 |
| **自动生成** | Work Order | 存在 `work_order_execution_attempts`，且 `execution_mode=automatic`、`status=created`、`work_order_id` 等于该工单的去重数量 |
| **自动派单** | Work Order | 同时满足“自动生成”与存在有效 `role=primary` 分派、且该分派带确定性 `routing_policy_code` 的去重数量；当前 A2/`task_owner` 是唯一可自动执行路由 |
| **开放** | Work Order | `proposed/pending_assignment/assigned/accepted/in_progress/waiting_external/waiting_approval/ready_for_acceptance/needs_review` |
| **阻塞** | Work Order | `needs_review/pending_assignment/waiting_external/waiting_approval` |
| **待复核** | Work Order | `needs_review` |
| **已完成** | Work Order | `completed`；不代表父 Task 完成 |

> “自动派单”不能只看 `automation_level=A2`，也不能只看有没有主受理人。它必须同时有**成功的自动执行尝试**与**有效的确定性路由分派事实**，才能防止历史人工补派被误算为自动派单。

### 3.3 工单类型表

“类型”使用稳定的 `template_code`，展示模板标题和版本；同一个代码的不同版本应可看见版本区分，不能悄悄合并掉审计边界。

| 列 | 说明 |
|---|---|
| 工单类型 | `template_title · template_code · vN` |
| 自动化等级 | A0 / A1 / A2 / A3 / L3 |
| 总计 | 该模板版本实例数 |
| 自动生成 | 严格按执行尝试事实计算 |
| 自动派单 | 严格按成功自动执行 + 有效主分派计算 |
| 开放 / 待复核 | 当前状态库存，而非期间流量 |

首期不展示“自动化成功率”“模型正确率”或“员工绩效”。这些需要单独定义分母、人工复核口径和观察窗口。

---

## 4. API 与 PostgreSQL read model

### 4.1 新增端点

```http
GET /api/task-work-orders/dashboard?limit=50&cursor=...
```

只读、工作台会话授权，不引入新的身份域。

建议响应：

```json
{
  "report_version": "task-work-order-dashboard.v1",
  "as_of": "2026-10-04T08:55:00.000Z",
  "timezone": "Asia/Shanghai",
  "scope": "personal_authorized",
  "source": "postgresql_task_work_orders",
  "summary": {
    "tasks": { "total": 12, "open": 9, "blocked": 2, "waiting_review": 1, "completed": 1 },
    "work_orders": {
      "total": 36,
      "automatic_created": 18,
      "automatic_assigned": 11,
      "open": 25,
      "blocked": 5,
      "waiting_review": 3,
      "completed": 8
    }
  },
  "by_template": [
    {
      "template_code": "quote_deadline_followup",
      "template_version": 2,
      "template_title": "报价期限跟进",
      "automation_level": "A2",
      "total": 14,
      "automatic_created": 10,
      "automatic_assigned": 8,
      "open": 9,
      "waiting_review": 1
    }
  ],
  "tasks": {
    "items": [
      {
        "task": { "task_id": "task_…", "title": "推进 KOL 报价确认", "status": "open", "priority": "important", "due_at": null },
        "counts": { "total": 3, "open": 2, "blocked": 1, "waiting_review": 0, "completed": 1, "automatic_created": 2, "automatic_assigned": 1 },
        "current_blocking_work_order": { "work_order_id": "wo_…", "title": "报价期限跟进", "status": "waiting_external" },
        "next_work_order": { "work_order_id": "wo_…", "title": "报价期限跟进", "status": "assigned" }
      }
    ],
    "page": { "limit": 50, "next_cursor": null, "total": 12 }
  }
}
```

### 4.2 查询形态

1. 用一个 `authorized_tasks` CTE 统一表达当前主体可见范围；
2. 用一个 `work_order_facts` CTE 生成每个 Work Order 的布尔事实：
   - `was_automatically_created`：存在 automatic+created attempt；
   - `was_automatically_assigned`：自动生成且有效 primary assignment 有 routing policy；
   - `is_open`、`is_blocked`、`is_waiting_review`、`is_completed`；
3. 同一 CTE 产出顶部汇总、模板类型分组与任务行聚合；
4. Task 列表仅带聚合摘要和 `current_blocking_work_order`/`next_work_order`，不在首屏传全部子工单；
5. 用户点击展开时复用 `GET /api/task-work-orders/:taskId`，改造其子工单投影以返回 `creation_mode`、`automatic_created`、`automatic_assigned`、`routing_policy_code` 与 `assignment_origin`。

这样修正现有 `listTaskWorkOrderAggregates()` 对每个 Task 再查询详情的 N+1 模式，报表和首页 Task 列表均为服务端聚合。

---

## 5. 任务行与展开详情

### 5.1 Task 行

每行只展示帮助用户决定“下一步看什么”的信息：

| 列 | 内容 |
|---|---|
| 任务 / 目标 | 标题、简短业务目标、优先级与截止时间 |
| 工单进度 | `开放 / 总计`，另显示 `自动派单 n` |
| 当前阻塞 / 下一步 | 当前阻塞工单标题；无阻塞时显示下一张开放工单 |
| 任务状态 | Task 根状态；不镜像任意子工单终态 |
| 操作 | 展开工单；需要时打开 Task 详情抽屉 |

默认排序：**待复核/阻塞优先 → 有到期时间优先 → 最近更新时间倒序**。

### 5.2 展开的子工单表

| 列 | 说明 |
|---|---|
| 类型 | 模板标题、代码与版本 |
| 工单 | 标题、目标摘要、到期时间 |
| 来源 | `自动` / `人工`；自动时额外显示 A1/A2/A3 |
| 分派 | 主受理人、路由策略；明确“自动派单”或“待人工分派” |
| 状态 / 阶段 | 工单状态与当前可验证阶段 |
| 决策 | `create/advance_stage/needs_review` 与置信度，仅展示受控摘要 |
| 查看 | 打开现有 Task—Work Order 详情抽屉 |

展开是当前行的子表，不跳转、不新开第二个任务中心。窄屏下子表转为纵向事实块，保留“类型、状态、受理人、自动化来源、查看”五个必要字段。

---

## 6. 前端改造范围

### 保留

- 原工作台登录和会话；
- 新建业务 Task 与登记已核验事件；
- Task 详情抽屉中的事件、证据、子工单详情；
- 历史 Agent/技能执行任务列表与其筛选、取消、SSE。

### 调整

1. `Tasks.tsx` 顶部首先加载 dashboard，而不是把 AI Task 根作为一块插入式摘要；
2. `AI 标准工单任务` 改名为 **业务任务与标准工单**；
3. 报表 KPI + 模板类型表置顶；
4. Task rows 成为主列表；展开行按需读取已授权的 Work Order 明细；
5. 历史运行任务区改为 **系统运行任务** 可折叠区，默认折叠，避免混淆业务执行与模型/技能运行。

---

## 7. 验收与测试

### 后端 PostgreSQL 集成测试

至少覆盖：

1. A2 成功自动建单且 `task_owner` 自动派单：`automatic_created=1`、`automatic_assigned=1`；
2. A1 成功自动建单但没有主分派：`automatic_created=1`、`automatic_assigned=0`；
3. 人工创建/人工补派不计入自动生成或自动派单；
4. `skipped`/`failed` attempt 不计入自动生成；
5. 同一 Work Order 的 stage attempt 不会让自动生成/派单重复累加；
6. 模板版本分别计数；
7. 普通员工只能看到自己负责/受理的 Task 与子工单；管理员范围按 PostgreSQL 授权扩大；
8. Task 子工单完成后，Task 根计数和状态不被错误改为完成；
9. 首屏 dashboard 查询不随 Task 数量产生 N+1 查询。

### 前端测试

1. 报表位于业务 Task 列表前；
2. 模板类型计数与 API 返回精确对应；
3. 行展开只请求该 Task 的详情一次；
4. 展开行显示自动生成/自动派单的区别；
5. 空数据明确显示“尚无工单”，不制造零以外的演示数据；
6. 历史运行任务仍可展开、筛选和取消；
7. 窄屏不出现横向内容截断。

---

## 8. 实施顺序

1. **P1：** 后端新增 dashboard read model 与授权 CTE，补充计数集成测试；
2. **P2：** 扩展 Task 行摘要与子工单来源/分派事实字段，消除列表 N+1；
3. **P3：** 调整任务中心信息架构：报表 → Task 行 → 展开子工单 → 折叠系统运行任务；
4. **P4：** 前后端 typecheck/build、全新 PostgreSQL 迁移/集成测试、相关导航测试；
5. **P5：** 仅在明确要求后合并、推送、部署；不自动启用任何模板 release 或 Jev。

---

## 9. 需要确认的产品决策

本设计建议采用以下默认值：

1. 员工任务中心的报表范围是**当前用户有权访问的 Task/Work Order**，不是全公司；
2. “类型”按**模板代码 + 版本**计数，以保留发布审计；
3. “自动派单”严格指成功自动物化、并由确定性路由写入有效主受理人的工单；
4. 历史 Agent/技能运行任务保留，但收纳到业务 Task 列表之后的折叠区；
5. 不展示未经定义的自动化成功率或绩效指标。

## 10. 2026-10-04 实现记录

已完成 P1–P4，未部署，也没有改变任何模板自动化发布开关：

1. 新增 `GET /api/task-work-orders/dashboard`。它在一次 PostgreSQL CTE 查询中统一计算授权范围、KPI、模板代码/版本统计、业务任务行和阻塞/下一工单摘要；`cursor` 是有界的服务端分页偏移令牌。
2. `work_order_execution_attempts(execution_mode='automatic', status='created')` 是唯一的“自动生成”事实；“自动派单”还必须存在当前有效、带 `routing_policy_code` 的主受理分派。重复 attempt 不会重复计数。
3. 行内展开复用授权详情 `GET /api/task-work-orders/:taskId`，并显示自动生成、自动派单、路由策略和受理人；不由模板等级猜测自动化结果。
4. 员工任务中心顺序已调整为：**工单运营报表 → 业务任务行与展开子工单 → 默认折叠的系统运行任务**。工作台既有登录、运行任务筛选、取消和 SSE 均保留。
5. 后端使用全新 PostgreSQL 数据库执行 `apply-postgres-schema.ts` 后，`postgres-task-work-orders.integration.test.ts` **9/9 通过**；新增用例覆盖自动 A2、自动未派单 A1、人工工单、重复 attempt、模板版本和协同受理授权。前端 `typecheck`、`build` 与 45 个既有导航/首页回归测试通过。

后续仅需按用户明确指令提交、推送或部署；本阶段不自动执行这些操作。
