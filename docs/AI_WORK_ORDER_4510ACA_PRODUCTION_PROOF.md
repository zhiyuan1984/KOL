# AI 工单自动化：`4510aca` 生产验收与试运行报告

**版本：** `4510aca feat: gate AI work order stage automation`  
**核验时间：** 2026-10-04 16:43（生产只读检查）  
**结论：** 功能代码、数据库迁移、Outbox 与 Worker 已部署并通过集成测试；但生产当前**没有模板、没有 release、没有已核验事件，且 `JEV_WORK_ORDER_ENABLED` 为关闭**。因此自动建单、自动分派和自动阶段推进**尚未开始处理真实业务**。这是当前安全状态，不是已产生业务效果的状态。

> 不能把“版本已部署”说成“生产自动化已经工作”。只有某个模板被发布并启用 release、Jev 被显式启用、出现符合模板的已核验事件，且所有闸门通过，系统才会自动落一张工单或写一个阶段事实。

---

## 1. 可复核证据

| 证据层 | 结果 | 证明什么 | 不证明什么 |
|---|---:|---|---|
| 部署版本 | 生产 `/api/version` 返回 `4510aca` | 当前服务确实在运行此版本 | 不代表业务自动化已被打开 |
| 服务健康 | `lingong.service`、2 个 `lingong-execution-worker@`、`lingong-outbox.service`、Redis 都为 `active` | PostgreSQL Outbox → Redis/BullMQ → Worker 的承载组件在运行 | 不代表已有 AI 工单消息被消费 |
| schema | 本版本 8 个 AI 工单 migration 已应用；复查无待执行 migration | Task 根、模板、release、事件、决策、工单、阶段事件等表已存在 | 不代表表中有生产数据 |
| 后端集成验证 | PostgreSQL 7 个测试文件、23 个测试通过 | 任务根、模板治理、Jev 决策、Outbox/Worker、A1/A2、A3 与权限/幂等的组合链可执行 | 不能替代一次真实生产试运行 |
| 前端验证 | typecheck、build 与 45 个任务中心相关测试通过 | 工作台入口、任务中心与治理页面可构建 | 不代表浏览器真实用户已操作 |

### 1.1 生产数据库当前计数（只读）

| 对象 | 当前记录数 | 含义 |
|---|---:|---|
| `work_order_templates` | 0 | 尚无任何实际工单类型/模板 |
| `work_order_automation_releases` | 0 | 没有 A1/A2/A3 自动化开关被开启 |
| `work_order_verified_events` | 0 | 没有可触发自动化的已核验事实 |
| `work_order_decisions` | 0 | 尚未发生 Jev 工单判断 |
| `execution_jobs`（`work_order.*`） | 0 | 尚未排队或消费 AI 工单持久作业 |
| `work_orders` | 0 | 尚未产生子工单 |
| `work_order_stage_events` | 0 | 尚未发生自动阶段写入 |

### 1.2 运行前提当前状态

| 前提 | 当前状态 | 影响 |
|---|---|---|
| PostgreSQL | 已配置 | 新 AI 任务/工单的权威存储可用 |
| Redis | 已配置且 `PONG` | BullMQ 作业传递可用 |
| OpenRouter API key | 已配置 | 可提供 Jev 调用凭据 |
| `JEV_WORK_ORDER_ENABLED` | **关闭** | 不能执行真实 Jev 判断；提交事件会保守进入不可自动执行的结果，而非自动建单 |
| 模板发布 | 0 个 | Jev 没有可选择的工单模板 |
| 自动化 release | 0 个 | 即使将来有决策，也不能自动物化/分派/推进 |

---

## 2. 工单从哪里来

当前实现分为“任务来源”“事实来源”和“工单实例来源”，三者不能混为一谈。

### 2.1 Task（业务目标根）的来源

当前只有一个生产入口：**已登录工作台用户在「任务中心 → AI 标准工单任务 → 新建业务任务」创建**。

- 写入 PostgreSQL `tickets`，但固定语义为 `task_type=business_task`、`profile=task-root`；它是 Task 根，不是子工单。
- 有幂等回执，重复点击不会创建第二个同键 Task。
- 新建 Task 不会自动变成“今日任务已完成”、不会因为任一子工单完成而完成。

### 2.2 已核验业务事件的来源

当前可用生产入口：**已登录工作台用户在 Task 详情中登记“已核验业务事件”**。

API 接受 8 个首批事件类型：

| 事件类型 | 业务含义 |
|---|---|
| `mail.reply_verified` | 已验证邮件回复 |
| `mail.commitment_verified` | 已验证邮件承诺 |
| `deadline.quote` | 报价期限 |
| `deadline.contract` | 合同期限 |
| `deadline.sample` | 样品期限 |
| `deadline.content` | 内容期限 |
| `risk.detected` | 风险事件 |
| `approval_or_material.missing` | 审批或资料缺失 |

事件写入前必须有：来源系统、来源事件 ID/版本、发生时间、事实摘要、证据引用与非空证据对象。相同 `task + source_system + source_event_id + source_version` 被拒绝重复写入；相同幂等键会返回原回执。

**尚未接通的来源：** 邮件、报价/合同/样品/内容期限、履约等外部系统尚未把事件自动写入此入口。因此当前不能声称“收到任何邮件就会自动创建工单”；目前是**人工核验后登记事实**的受控试运行入口。

### 2.3 工单实例的来源

已核验事件写入后，链路是：

```text
Task 根
  → 已核验事件（不可变事实）
  → 已发布模板候选 + Jev 受限选择
  → 不可变 work_order_decision
  → PostgreSQL execution_job + Outbox
  → Outbox Publisher → BullMQ
  → Execution Worker
  → 确定性物化器 / A3 阶段执行器
  → work_order / assignment / basis refs / stage event / audit
```

Jev 只能从**已发布模板、已发布路由策略和模板允许的目标阶段**中做 choice；它不接收人员名单，也不能直接写数据库、选择任意员工、编造事实或完成 Task。

---

## 3. 有多少种工单

### 3.1 真实工单类型：当前为 0 种

系统中的“工单类型”不是硬编码枚举，而是管理员发布的 `work_order_templates.template_code + version`。生产数据库当前没有模板，所以现在真实可用工单类型是 **0**。

这意味着：系统已经具备模板治理能力，但还没有给业务配置“报价期限跟进”“样品签收核验”等可执行类型。

### 3.2 自动化等级：固定 5 类

| 等级 | 自动化边界 | 当前代码行为 |
|---|---|---|
| `A0` | 仅观察/建议 | 不自动写工单 |
| `A1` | 自动生成草稿 | 通过 release、置信度、模板闸门后创建 `proposed` 工单；不自动主分派 |
| `A2` | 自动建单并分派 | 目前仅支持确定性 `task_owner` 路由；写 `assigned` 工单和唯一主受理人 |
| `A3` | 自动写可验证的阶段事实 | 只允许模板明确配置的非终态事实阶段；可跨阶段，但必须有完整中间事实、Jev 与确定性证据判断一致、版本与 release 同时通过 |
| `L3` | 高影响动作 | 外发、合同/费用、审批、取消、重开、验收等始终人工确认，不能自动执行 |

`A1/A2/A3` 的**模板发布**与**release 启用**是两道不同开关：发布只让模板进入候选；release 才允许写入。

---

## 4. 如何派单

### 4.1 当前实际可执行的派单方式

- **A1：** 创建 `proposed` 工单，不写主受理人。
- **A2：** 只接受 `routing_policy_code=task_owner`；执行器锁定 Task 根，读取其工作台主体/组织绑定，将该唯一有效主体写入 `work_order_assignments(role=primary,status=active)`。
- **A3：** 是阶段推进，不新增派单；必须绑定现有子工单。

因此目前不该宣传“Jev 自动找任意最合适员工”。它只能选择预发布的路由编码；当前真正实现、可自动执行的路由只有 **`task_owner`**。无有效负责人、主体未激活、路由不匹配、低置信度、未 release 时，写可审计的 `skipped` / `needs_review`，不会猜人。

### 4.2 为什么这样限制

自动分派是一项权限与组织动作，错误成本高。当前把“Jev 选择路由”与“确定性解析到具体人”拆开，确保每张自动分派工单都能追溯到：Task 负责人、模板版本、release、路由策略、事件和决策 ID。

---

## 5. 会影响哪些下游

| 下游 | 影响 | 明确不影响 |
|---|---|---|
| PostgreSQL 任务—工单聚合 | Task 详情可显示子工单数、阻塞工单、主受理人与核验事件 | 不改变历史工作台旧任务表的权威性 |
| 执行队列 | 写 `execution_jobs` 和 Outbox；Publisher 投递 BullMQ；Worker 写终态回执 | 作业成功不代表工单验收或 Task 完成 |
| 工单事实 | 写 `work_orders`、`work_order_assignments`、`work_order_basis_refs`、`work_order_execution_attempts`、`work_order_outbox` | 不写虚构的业务事实 |
| 阶段轨迹 | A3 可写 `work_order_stage_events` 与 `work_order_basis_refs` | 不可自动进入合同、审批、审核、结算、取消、重开、验收、终态 |
| 任务中心 | 以“AI 标准工单任务”并列区展示 Task 根和子工单 | 尚未写入历史 `/api/workbench/tasks` 的 Today / Todo 主投影 |
| 管理端工作战报 | 展示 Task 根、子工单数、阻塞/待复核原始摘要 | 不把子工单量当作业绩、成交或任务完成 |
| 外部系统 | 当前没有外发、没有合同/费用写入、没有邮件反向写入 | 不自动改变外部世界 |

---

## 6. 如何证明它开始工作

证明必须分三层，缺一不可。

### 层 1：部署与承载证明（已满足）

1. 生产版本是 `4510aca`；健康检查正常。
2. PostgreSQL migration 已应用。
3. Outbox Publisher、两个 Execution Worker、Redis 都为 `active`。
4. 本地全新 PostgreSQL 库上 23 个原生集成测试通过，覆盖 Task、模板、release、Jev、Outbox、Worker、A1/A2、A3、幂等与授权。

### 层 2：受控业务试运行证明（当前尚未做）

建议只用一个隔离的低风险试运行模板，例如 `uat_quote_due_4510aca`：

1. 管理端「工单治理」创建 **A2** 模板草稿：
   - 触发事件：`deadline.quote`
   - 路由：`task_owner`
   - 验收条件：例如“报价期限已核验”“下一步已记录”
2. 发布模板；确认版本、触发事件和验收条件正确。
3. 由有权限管理员**单独启用**该模板 release，最低置信度建议 `0.92`，并填写试运行原因。
4. 明确将 `JEV_WORK_ORDER_ENABLED=1` 后重启相应服务；当前生产该开关为关闭。
5. 在任务中心创建一个明确标记为 `UAT-4510aca` 的新业务 Task。
6. 在此 Task 下登记一条已核验的 `deadline.quote` 事件，证据引用使用可识别的测试值，例如 `uat:4510aca:quote:001`。不要用真实合同、金额、客户联系方式或对外动作。
7. 观察并保存以下链路证据：
   - `work_order_verified_events` 有事件；
   - `work_order_decisions` 有 Jev 的 choice/confidence/理由；
   - `execution_jobs` 有 `work_order.materialize`，最终为 `succeeded` 或可解释的 `skipped`；
   - 满足选择和阈值后，`work_orders` 有一张 A2 `assigned` 工单；
   - `work_order_assignments` 有且只有一个 `task_owner` 主受理人；
   - `work_order_basis_refs` 指向测试事件；
   - Task 根状态仍不是“自动完成”。
8. 禁用该模板 release，并在管理端保留 release event；后续同类事件不得再物化。

> Jev 是概率判断。试运行中若模型返回 `no_action` 或 `needs_review`，这不是系统故障；它说明自动化按保守边界拒绝写入。要证明 A2 正向物化，需要事件语义、模板候选和置信度共同满足门槛。

### 层 3：A3 阶段自动化证明（另做，不和 A2 首测混合）

在 A2 稳定后，创建单独的 A3 测试模板和测试子工单。必须同时验证：

- 模板显式列出目标阶段、允许事件与必需证据键；
- 模板显式允许跨阶段时，事件的 `completed_stages` 连续覆盖所有中间阶段；
- Jev 对目标阶段达到 release 阈值；
- `stage-judgment` 独立判断同一目标，且直接证据置信度为 `high`；
- Work Order 行锁版本未变化；
- `work_order_stage_events` 写入 `a3_verified_evidence_stage_advance`，但 Task 根仍不自动完成。

---

## 7. 当前不能证明、也不应承诺的事项

1. 不能证明已经从真实邮件、报价/合同/样品/内容期限系统自动流入事件——这些生产者尚未接入。
2. 不能证明“我的待办 / 今日任务”已经把 AI 子工单写进历史统一主投影——当前是任务中心并列投影。
3. 不能证明任意员工负载均衡、跨组选择或部门兜底已由 AI 自动执行——当前自动派单仅实现 `task_owner`。
4. 不能证明业务成功、成交、合同完成或员工绩效——系统只保存可审计事实、执行单元和原始计数。
5. 不能证明生产已自动建过工单——当前生产相关表计数均为 0，Jev 开关也未启用。

---

## 8. 建议的下一步

在用户确认具体模板、低风险试运行范围和允许启用 Jev 后，执行一次**隔离 UAT**，并输出一份只包含以下字段的生产回执：Task ID、事件 ID、决策 ID、执行作业 ID、Work Order ID、主受理人主体 ID、模板/版本、release 版本、最终作业状态、跳过原因（如有）。

在没有这些回执前，正确表述应是：**“4510aca 已部署 AI 工单自动化能力，但尚未配置或启用生产自动化。”**
