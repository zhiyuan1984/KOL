# 本体三表落地设计：对象注册表 / 事件表 / 工单表（tickets 独立表版）

> 整理时间：2026-10-01
> 定位：实施设计契约（非规范正文，不建立法律层级；与 `docs/` 正文冲突以正文为准）。
> 来源：《概念落地对照表-总表》§六「先立三张表」；三份清单（对象 / 属性 / 事件）；用户 2026-10-01 决策：工单表采用独立 `tickets` 表，其余按《三张表落地方案》。
> 实施状态记入 `docs/implementation-registry.md`；机器可读产物：`config/objects-registry.yaml`、`config/event-catalog.yaml`、`config/ticket-types.yaml`。

---

## 0. 审宪记录（CONST-08）

```text
需求：立三张表——对象注册表＋事件表＋工单表（用户决策：工单表=独立 tickets 表）；源=三份清单。
主责角色：KOL 业务专家（业务口径）；智能体产品经理＋平台产品经理（载体口径）；后端专家（实现）；架构师（事件/工单表与既有表关系）。
宪法条款：CONST-02（平台承载、业务专家定义）、CONST-03（确定的规则要有程序执行点）、CONST-05（授权与副作用分离）、CONST-06（事实/知识/记忆分离）、CONST-09（不改法）、CONST-10（不伪造、空白照录）。
基本法条款：PROD-PLAT-02/03、PROD-AGENT-04/05/06/07；BIZ-01/02/05/06/10/11/12/14/16/18；TECH-BE-03/04/05/06；07-mcp；docs/AGENTS.md §4/§5。
结论与证据：符合——只做「照录＋登记空白＋机器可读化」；事件表不可变、发生/接收时间分离、幂等；工单表独立后与 work_items 的镜像关系单一映射、由触发器＋启动对账保证；不涉及界面与 DESIGN。
下一步：实施 → 过验证（validate:registry / validate:contracts / typecheck / tests）→ 数据字典、实施登记、DECISIONS 同步。
```

## 1. 三张表与载体（最终口径）

| 表 | 载体 | 说明 |
|---|---|---|
| 对象注册表 | `config/objects-registry.yaml`＋`validate:registry` | 对象卡＋属性卡（全量自两份清单）；不建 DB 表、本批不做 HTTP/管理端（GAP-21 批次） |
| 事件表 | `config/event-catalog.yaml`＋DB 表 `business_events`（不可变）＋服务＋`GET /api/events`＋2 条接线 | 先接「阶段写入」「邮件已到达」；其余域后续迁入 |
| 工单表 | **独立 DB 表 `tickets`**＋`config/ticket-types.yaml`＋服务＋镜像同步＋启动对账 | `work_items` 保留为执行载体（技能运行/会话/产物）；`tickets.work_item_id` 唯一关联；任务接口只增票型字段 |

**独立表的防漂移纪律（本设计的核心约束）**：

1. `tickets` 行由 `ensureTicketForWorkItem()` 创建（单一创建函数），分类只来自 `config/ticket-types.yaml`；
2. 票面镜像列（`status` / `priority` / `due_at` / `risk_level` / `title` / `assignee_user_id`）由 SQLite 触发器 `work_items_ticket_mirror` 从 `work_items` 同步——应用层不重复写；映射表只有一处（触发器内 CASE），TS 侧映射仅供创建与对账，二者由测试对齐；
3. 启动时 `reconcileTickets()` 兜底：补缺失行、纠正状态偏差；
4. `work_items` 删除时 `tickets` 级联删除（FK ON DELETE CASCADE）。

## 2. `config/objects-registry.yaml` 结构（校验契约）

```jsonc
{
  "version": 1,
  "generated_from": ["docs/ontop/KOL业务对象清单.md", "docs/ontop/KOL业务对象-属性（Property）清单.md"],
  "objects": [{
    "id": "B2",                          // 唯一。B 组=B1..B18；A 组=A<组>.<序>（如 A1.1）；C 组=C1..
    "code": "kol_profile",               // 唯一，小写 snake_case，供事件目录 object_type 引用
    "name": "KOL 画像",
    "name_en": "KOL",
    "group": "A|B|C",
    "layer": "platform|kol_business|org_governance",
    "stable_id": "平台 + 稳定外部 ID",
    "authority_source": "Starry 对应记录、工具回执及版本",   // 或 null
    "authority_source_status": "defined|blank",
    "clauses": ["BIZ-01", "BIZ-02"],
    "carrier": ["kol_profile_index"],
    "implementation_status": "built|partial|not_built|unknown",
    "source_ref": "对象清单 §四 B2",
    "properties": [{
      "name": "主平台", "code": "platformCode", "kind": "base|derived",
      "biz_type": "text|enum|datetime|amount|reference|boolean|structured",
      "lineage": "Starry 字典", "rule": "……",
      "clauses": ["domain-objects §2.1"], "gap": null,
      "source_ref": "属性清单 §2.2"
    }]
  }]
}
```

**对象 code 全集（事件目录 object_type 只能取这些）**（A 组 31＋B 组 18＋C 组 14）：

- A1：`task`、`work_item`、`session_thread`、`run_record`、`artifact`
- A2：`expert`、`agent`、`digital_team`、`skill`、`workflow`、`knowledge`、`skill_market`
- A3：`connector`、`mcp_tool`、`account_binding`
- A4：`approval_config`、`audit_record`、`config_version`、`cost_event`
- A5：`auto_job`、`notification`、`exam`、`file`、`remote_use`、`user_pref`
- A6：`memory_entry`、`business_event`、`kol_index`、`follow_index`、`mail_summary`、`task_summary`
- B：`creator_candidate`、`kol_profile`、`collaboration`、`follow_relation`、`follow_task`、`email`、`quote`、`contract`、`sample`、`content`、`settlement`、`approval`、`risk`、`project`、`campaign`、`mailbox`、`crawl_batch`、`report`
- C：`company`、`org_unit`、`user`、`membership`、`brand`、`region`、`brand_scope`、`region_scope`、`responsibility`、`role`、`skill_grant`、`skill_tool_binding`、`credential_ref`、`approval_assignment`

## 3. `config/event-catalog.yaml` 结构（校验契约）

```jsonc
{
  "version": 1,
  "generated_from": ["docs/ontop/KOL业务对象-事件（Event）清单.md"],
  "events": [{
    "code": "stage.advanced",           // 唯一，`^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$`；沿用现有 event_type 前缀习惯
    "name": "阶段已前进（相邻 +1）",     // 事实句原文（过去时）
    "category": "human_action|authorized_auto|external_fact|system_job|derived",
    "object_type": "collaboration",     // 必须∈对象注册表 code 集
    "payload": ["target_stage_code"],
    "producer": "confirm_stage",
    "clauses": ["BIZ-12", "stage-transitions §3"],
    "status": "built|partial|designed",
    "carrier": "stage_transitions",     // status=built 时非空
    "source_ref": "事件清单 §5.1"        // 覆盖 §2..§11
  }]
}
```

- 现有载体对号：`task.*`→`task_events`、`run.*`→`task_runs`/`task_events`、`crawl.*`→`crawl_job_events`、`stage.*`→`stage_transitions`、审批→`approvals`＋`audit_events`、成本→`cost_events`、邮件到达→`kol_mail_items`、记忆/索引→记忆族表；无专用载体的标 `designed`。
- 本批新接线后：`stage.*`、`email.received` 同时写入 `business_events`（carrier 记为 `stage_transitions + business_events` / `kol_mail_items + business_events`）。

## 4. DB：`business_events`（统一业务事件表，不可变）

见 `backend/src/db.ts` initSchema（audit_events 之后）与 `backend/migrations/018_business_events.sql`。
列：`id`(evt_) / `event_type` / `object_type` / `object_id` / `occurred_at` / `received_at` / `source` / `source_version` / `actor_type`(human|agent|system|external) / `actor_id` / `action_ref` / `payload` / `evidence` / `receipt` / `diff` / `idempotency_key` / `correlation_id` / `created_at`。
索引：`(object_type, object_id, occurred_at)`、`(event_type, occurred_at)`、`(correlation_id)`、幂等部分唯一 `(idempotency_key) WHERE NOT NULL`。
触发器：`BEFORE UPDATE` / `BEFORE DELETE` → `RAISE(ABORT)`（仿 `stage_transitions`）。`seed.ts` 重置时临时 DROP 再重建。
服务：`backend/src/business-events.ts`（`appendBusinessEvent` / `listBusinessEvents` / 目录加载）。
接口：`GET /api/events`（登录鉴权；过滤 `object_type/object_id/event_type/limit/before`）。
接线：`adapters/starry.ts confirmStage()`（同事务，幂等键 `stage_transition:<trn>`）；`starrykol/mail-sync.ts rememberItem()`（入库成功后，仅 inbound，幂等键 `email.received:<providerMessageId|identity>`）。

## 5. DB：`tickets`（独立工单表）

见 `backend/src/db.ts` initSchema（task_artifacts 之后）与 `backend/migrations/019_tickets.sql`。
列：`id`(tkt_) / `work_item_id`(UNIQUE 部分索引) / `kind` / `channel` / `title` / `description` / `status` / `priority` / `requester_type` / `requester_id` / `assignee_user_id` / `object_type` / `object_id` / `collaboration_id` / `project_id` / `source` / `due_at` / `risk_level` / `kind_version` / `data_version` / `opened_at` / `closed_at` / `status_updated_at` / `created_at` / `updated_at` / `payload`。
FK：`work_item_id → work_items(id) ON DELETE CASCADE`。索引：`(status, updated_at)`、`(assignee_user_id, status)`、`(kind)`、`(channel)`。
触发器 `work_items_ticket_mirror`：`AFTER UPDATE OF status,priority,due_at,risk_level,title,owner_user_id ON work_items` → 同步镜像列＋`data_version+1`。

状态映射（TS 与触发器一致，测试对齐）：
`pending|needs_clarification→open`；`queued|starting|running|in_progress→in_progress`；`waiting|waiting_approval→waiting`；`completed|done→done`；`failed→failed`；`cancelled|stopped→cancelled`；未知值保持原状。
本批接线的阶段事件码：`stage.advanced`（相邻 +1）/ `stage.forward_skipped`（跨段）/ `stage.regressed` / `stage.exception_entered` / `stage.exception_left` / `stage.completed`。

创建接线（5 处，插行后调用 `ensureTicketForWorkItem`）：`routers/tasks.ts:429`、`host/today-plan-run.ts:68`、`routers/kol-memory.ts:407`、`discovery.ts:713`、`home-discovery.ts:588`。启动对账：`createApp()` 挂 `reconcileTickets()`（补行＋纠状态）。
`GET /api/tasks`、`GET /api/tasks/:id` 序列化只增：`ticket_id` / `ticket_kind` / `ticket_channel` / `ticket_status`。

## 6. `config/ticket-types.yaml`（票型目录）

kinds（业务类型）与 channels（渠道）：`service/客服工单`（邮件往来与沟通类）、`follow_up/跟进工单`、`delivery/履约交付工单`、`approval/审批工单`、`risk/风险工单`、`crawl/采集工单`、`discovery/发现工单`、`planning/规划工单`、`library/数据工单`、`general/通用工单`（兜底）；
channels：`email/邮件工单`（优先匹配邮件族 task_type）、`system/系统提单`（source∈schedule/planning/discovery/home_discovery）、`agent/Agent 提单`（source=ai）、`human/人工提单`（兜底，fallback）。
`match` 只允许引用**真实存在**的 task_type（`backend/skills/` 49 项＋内置 `today_plan/todo_plan/today_analyze/discovery_crawl`）。

## 7. 校验与验证

- `backend/scripts/validate-registry.mjs`（npm `validate:registry`，纳入 `release-gate.mjs` 步骤 `registry`）：三份目录结构＋跨文件（事件 object_type ∈ 注册表 code；票型 match ∈ 真实 task_type；对象覆盖 B1–B18 与属性清单 §2.1–2.15 / §3.1–3.7 / §4.1–4.6）。
- 测试：`backend/tests/business-events.test.ts`（不可变触发器、幂等、白名单、读过滤）、`backend/tests/tickets.test.ts`（创建/分类/触发镜像/对账/级联）、`backend/tests/registry-config.test.ts`（校验脚本 0 errors）。
- 全量：`validate:registry` / `validate:contracts` / `typecheck` / `npm test`；端到端实证（stub）：阶段写入与邮件同步落 `business_events`；`GET /api/events` 可读；`GET /api/tasks` 带票型字段。

## 8. 迁移代价清单（独立 tickets 表的改动面）

| # | 改动点 | 文件 | 风险与控制 |
|---|---|---|---|
| 1 | `tickets` 表＋镜像触发器＋建表迁移 | `db.ts`、`migrations/019_tickets.sql` | 低；`CREATE TABLE/TRIGGER IF NOT EXISTS` 幂等 |
| 2 | 票型目录＋分类服务 | `config/ticket-types.yaml`、`src/tickets.ts` | 目录是唯一真相源 |
| 3 | 创建接线（5 处） | tasks.ts / today-plan-run.ts / kol-memory.ts / discovery.ts / home-discovery.ts | 漏接由启动对账兜底 |
| 4 | 状态镜像（0 处应用代码） | 触发器统一完成 | 与应用写点解耦；测试覆盖映射全枚举 |
| 5 | 启动对账 | `tickets.ts reconcileTickets()`、`app.ts` | 幂等；每次启动扫描无票 work_items |
| 6 | 任务接口字段 | `routers/tasks.ts`（list＋detail 序列化） | 只增字段；E2E 不回归 |
| 7 | seed 重置 | `seed.ts`（business_events 清库＋触发器重建；tickets 随 work_items 级联） | E2E 隔离 |
| 8 | 文档 | 数据字典＋实施登记＋DECISIONS | 与实现同步提交 |

回归范围：`tasks-runtime`、`run-queue`、`task-run-recovery`、`today-plan`、`crawl`、`discovery`、`home-discovery` 相关测试；前端 E2E 无契约变化（只增字段）。

## 9. 明确不做

不补业务空白（来源空白、公海、14 天、费用/合规/报表照录）；不改 work_items 既有行为；不做派单规则（GAP-05）；不做管理端页面与前端呈现；不做向量检索；`tickets` 本批不暴露独立列表接口（随票面 UI 批次）。

---

## 10. 修订（2026-10-01，实施中·用户决策）：`work_items` 并入 `tickets`（换表）

- 用户要求：**把 `work_items` 上的数据迁移到 `tickets`，并删除 `work_items`**。
- 落地：`tickets` 成为任务运行与工单的**唯一表**——原 `work_items` 直接重命名并入（SQLite 同步改写子表外键引用），票型列 `kind` / `channel` / `requester_type` / `requester_id` / `object_type` / `object_id` / `kind_version` 并入同表。
- 取代本文件 §5 的「独立表＋镜像触发器」设计：镜像表、镜像触发器 `work_items_ticket_mirror`、`tickets_work_item` / `tickets_assignee_status` 索引全部删除；`tickets.status` 为唯一状态源，接口 `ticket_status` 改为派生展示值（`ticketStatusFromWorkItem` 保留）。
- 迁移：`backend/src/db.ts` `mergeWorkItemsIntoTickets()`（丢旧镜像表 → 重命名 → 补列 → 清理旧索引名/触发器 → 重建 `tickets_*` 索引；含防丢数据分支）；历史行分类回填由 `backend/src/tickets.ts` `reconcileTickets()` 启动时一次性执行（`app_state` 键 `tickets_classified_v1`）。
- 保留（已登记限制）：历史列名 `work_item_id`（指向 `tickets.id`）与内部 API 别名字段 `work_items` / `work_item_count`。
- 证据：`tests/tickets.test.ts` 8/8（含旧库 `work_items` → `tickets` 合并迁移实证）；`npm run typecheck` 通过；全量套件复跑见 `docs/implementation-registry.md` ONT-03。
