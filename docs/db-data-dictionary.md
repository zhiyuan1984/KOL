# 数据库数据字典（SQLite `lingong.db`）

> **定位：事实登记。** 本文件描述仓库内现有 SQLite 库的**实际结构**与字段用途，不是规范条文，也不建立任何规则层级。涉及阶段、权限、审批、风险档位、数据范围的判断，一律以 [CONSTITUTION.md](./CONSTITUTION.md) 和 [BUSINESS.md](./BUSINESS.md)、[PRODUCT.md](./PRODUCT.md)、[TECHNOLOGY.md](./TECHNOLOGY.md) 为准；对象与字典值以 [domain-objects.md](./domain-objects.md) 为准。
>
> 本文记录的是**现状**，不表示现状合规。字段的中文解释由代码与规范推导，凡代码中找不到写入方或取值来源的，都明确标注「（未在代码中确认）」，不做推测。

---

## 一、范围与方法

### 1.1 覆盖范围

| 项 | 值 |
|---|---|
| 扫描的 db 文件 | **33 个** `*.db`（文件名全部为 `lingong.db`） |
| git 跟踪情况 | **0 个被跟踪**（`git ls-files` 命中 0；db 是运行期产物，已被忽略） |
| 基准库 | `data-e2e/lingong.db`（100 表 / 1018 字段，是全部 33 个文件的**超集**） |
| 覆盖表 | **100 张**（全部 db 文件的表名并集） |
| 覆盖字段 | **1018 个** |
| schema 变体 | **9 种**（见[附录 B](#附录-bschema-变体差异)） |

### 1.2 生成方法

1. **抽取结构**：用 Node 内置 `node:sqlite` 逐个打开 33 个 db，读 `sqlite_master` 与 `PRAGMA table_info / index_list / foreign_key_list`，得到表、字段、约束、索引、外键、触发器的原始事实。基准库 `data-e2e/lingong.db` 的表集与字段集等于全部文件的并集，故正文以它为准。
2. **追溯语义**：以代码为语义来源，读 `backend/src/db.ts`（`initSchema` / `migrateSchema`）、`backend/migrations/001..017*.sql`（18 个文件）、`backend/src/runtime/{store,credentials,organization}.ts`、`backend/src/host/*.ts`、`backend/src/routers/*.ts` 等，确认每张表由谁写、何时写、字段存什么。
3. **对照规范**：阶段值对照 [stage-transitions.json](../config/stage-transitions.json) 与 [business-rules/stage-transitions.md](./business-rules/stage-transitions.md)，风险档位对照 [07-mcp-data-contract.md](./07-mcp-data-contract.md)，对象与字典值对照 [domain-objects.md](./domain-objects.md)。
4. **校验**：逐表比对文档字段行与基准库字段清单——**100/100 张表的字段名、数量、顺序全部一致**。

### 1.3 schema 的权威来源

库文件会随部署和数据清理而重建，**不要以某个 db 文件当作 schema 契约**。权威 DDL 来源是代码：

- `backend/src/db.ts` → `initSchema()`（约 L186–L1093）与 `migrateSchema()`（约 L1418–L2106，含幂等 `ALTER TABLE ... ADD COLUMN`）。
- `backend/migrations/001..017*.sql`（18 个文件，留档用，实际应用在 `db.ts`）。
- `backend/src/runtime/store.ts`、`credentials.ts`、`organization.ts`、`backend/src/routers/connector-operations.ts`、`backend/src/host/{employee-memory,mail-send-confirmation}.ts`。

迁移文件中的 `kol_mail_threads_p0`、`kol_mail_items_p0`、`user_starry_bindings_p0` 是**表重建的临时表**，不是常驻业务表，因此不在本文正文。

### 1.4 字段表的读法

每张表的字段表固定五列：

| 列 | 含义 |
|---|---|
| 字段 | 数据库列名（SQLite 实际列名） |
| 类型 | SQLite 声明类型（`TEXT` / `INTEGER` / `REAL` / `BLOB`） |
| 约束与默认 | 主键、`NOT NULL`、`DEFAULT`、`UNIQUE` 等；无则写「可空」 |
| 中文名 | 字段的中文短名 |
| 说明 | 存什么、由谁写、何时变化、枚举取值；无法确认时标注「（未在代码中确认）」 |

约定：

- 所有时间字段都是 **ISO 8601 字符串**（如 `2026-10-01T12:00:00.000Z`），SQLite 没有原生日期类型。
- 布尔字段一律用 `INTEGER` 的 `0` / `1` 表示。
- 主键多为业务前缀 ID 字符串（如 `ses_`、`usr_`、`wi_`），由 `backend/src/ids.ts` 生成，不是自增整数。
- 除特别说明外，表没有 `FOREIGN KEY` 约束，关联由代码保证。

---

## 二、表分组索引

| # | 分组 | 表数 | 表 |
|---|---|---:|---|
| 1 | 身份·组织·权限基础 | 9 | `users`、`auth_sessions`、`orgs`、`teams`、`memberships`、`directory_users`、`user_preferences`、`user_uploads`、`app_state` |
| 2 | 会话·消息·草稿·协作 | 6 | `sessions`、`messages`、`drafts`、`collaborations`、`session_shares`、`workers` |
| 3 | 审批·幂等·审计·入站 | 5 | `approvals`、`approval_idempotency`、`approval_role_bindings`、`audit_events`、`inbound` |
| 4 | 授权与连接器目录 | 6 | `user_skill_grants`、`user_connector_grants`、`connector_tool_grants`、`connectors`、`user_starry_bindings`、`mailbox_owners` |
| 5 | KOL 主数据·协作·阶段 | 12 | `kol_profile_index`、`kol_follow_index`、`kol_thread_summary`、`claw_creators`、`creator_candidates`、`creator_snapshots`、`ingestion_batches`、`retention_policy`、`stage_transitions`、`starry_sends`、`starry_stage_writes`、`wecom_cards` |
| 6 | 采集与发现 | 7 | `crawl_jobs`、`crawl_job_events`、`discovery_requests`、`discovery_runs`、`discovery_memory_facts`、`discovery_ingest_receipts`、`discovery_ingest_confirms` |
| 7 | 邮件 | 3 | `kol_mail_items`、`kol_mail_threads`、`kol_mail_seen` |
| 8 | 任务运行时 | 3 | `task_runs`、`task_events`、`task_artifacts`（原 `work_items` 已并入 `tickets`，见分组 14） |
| 9 | 技能 | 12 | `skill_drafts`、`skill_flags`、`skill_grants`、`skill_lifecycle`、`skill_sops`、`skill_stage_history`、`skill_test_runs`、`skill_tests`、`skill_versions`、`runtime_agent_skills`、`runtime_skill_connectors`、`runtime_skill_tools` |
| 10 | 知识 | 13 | `knowledge`、`knowledge_domains`、`knowledge_bases`、`knowledge_documents`、`knowledge_document_jobs`、`knowledge_bindings`、`knowledge_citations`、`knowledge_deprecations`、`knowledge_extract_jobs`、`knowledge_grants`、`knowledge_proposals`、`knowledge_raw`、`knowledge_versions` |
| 11 | 连接器运行时治理 | 13 | `runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`runtime_bootstrap_migrations` |
| 12 | 评测考试 | 6 | `exams`、`exam_assignments`、`exam_attempts`、`exam_items`、`exam_qualifications`、`exam_snapshots` |
| 13 | 成本·定时任务·记忆简报 | 8 | `cost_budgets`、`cost_events`、`cron_jobs`、`cron_runs`、`memory_entries`、`employee_memory_items`、`employee_today_briefs`、`employee_todo_briefs` |
| 14 | 事实账本与工单（2026-10-01 本体三表） | 2 | `business_events`、`tickets`（工单表：原 `work_items` 已并入） |
| — | **合计** | **105** | 另有 `sqlite_sequence`（SQLite 内部表）与 `stage_transitions`、`business_events` 的不可变触发器，见正文与附录。§一 的基准库扫描快照生成于本体换表、知识分层与资料流水线之前，重扫前以分组 8 / 分组 10 / 分组 14 为准。 |

---

## 三、分组 1：身份·组织·权限基础（15 张表）

平台用户、认证会话、组织与团队、目录用户、个人偏好、上传文件与键值状态。

### users — 用户账号

- **用途**：登录主体表，同时承载员工/管理员身份、品牌站点范围与上下级关系；`/auth/setup` 首次初始化或管理端 `/admin/users` 创建用户时产生一行。
- **主键 / 唯一约束**：`id`（主键）；`username`（唯一）；自引用外键 `manager_user_id` → `users(id)`。
- **关键索引**：无显式索引（仅有主键与 `username` 唯一约束的隐式索引）。
- **写入方**：`backend/src/auth.ts`（`POST /auth/setup` 建首个管理员、`ensureDemoAdmin()`、`POST /auth/password` 改密、登录时补写演示管理员邮箱/手机）；`backend/src/routers/enterprise.ts`（`POST /admin/users` 新建、`PATCH /admin/users/:uid` 改姓名/站点/岗位/上级/角色/品牌/启用/密码、`DELETE /admin/users/:uid` 置 `active=0`）；`backend/src/routers/misc.ts`（`PATCH /me` 改姓名/邮箱/手机）；`backend/src/db.ts`（迁移期补 `email`/`phone`/`position` 列并做 legacy id 重写）。
- **备注**：`roles` 由 `backend/src/routers/enterprise.ts` 的 `roles()` 校验，只允许 `employee`/`admin`；`backend/src/auth.ts` 的 `findUserForLogin()` 只匹配 `active = 1` 的行，停用即无法登录。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 用户 ID | 用户唯一标识，管理端新建时用 `nid("usr")` 生成（`usr_` 前缀）；演示/固定账号为 `sriphy`、`usr_lead`、`usr_lingong`。 |
| `username` | TEXT | 非空，唯一 | 登录账号 | 登录用账号名（小写，正则 `^[a-z0-9._@-]{3,100}$`），也可写成邮箱形式；由 `/auth/setup`、`POST /admin/users` 写入，`ensureDemoAdmin()` 会把遗留的 `test` 改成演示管理员 handle。 |
| `name` | TEXT | 非空 | 姓名 | 界面展示姓名；`PATCH /me`、`PATCH /admin/users/:uid` 可改。 |
| `password_hash` | TEXT | 非空 | 口令散列 | scrypt 散列，格式 `scrypt$<base64 盐>$<base64 密钥>`（`backend/src/auth.ts`）；设置/改密时写入，明文不落库。 |
| `roles` | TEXT | 非空，默认 `'["employee"]'` | 角色列表 | JSON 字符串数组，取值 `employee` / `admin`；含 `admin` 即通过 `isAdmin()` 获得管理端与全量权限。 |
| `brands` | TEXT | 非空，默认 `'[]'` | 授权品牌 | JSON 字符串数组的品牌代码，代码中见 `LT` / `RO` / `PQ`（`backend/src/config.ts` 的 `DEMO_USER.brands`）；由 `/auth/setup`、`PATCH /admin/users/:uid` 写入。 |
| `site` | TEXT | 可空 | 站点 | 所属站点名，如「深圳站」（`backend/src/config.ts` 的 `PERSONAS[].site`）；管理端可改。 |
| `manager_user_id` | TEXT | 可空 | 直属上级 | 上级用户的 `users.id`，自引用外键（无级联）；`PATCH /admin/users/:uid` 的 `manager_user_id` 字段写入。 |
| `active` | INTEGER | 非空，默认 1 | 是否启用 | 0/1 布尔；`1` 可登录，`0` 为已停用（`DELETE /admin/users/:uid` 只置 0 不删除行）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），创建时写入，之后不变。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，任何字段更新同事务刷新。 |
| `email` | TEXT | 可空 | 邮箱 | 登录别名与联系方式，写入前小写规范化（`normalizeEmail`）；由 `/auth/setup`、`PATCH /me`、`ensureDemoAdmin()` 写入；`findUserForLogin()` 支持用它登录。 |
| `phone` | TEXT | 可空 | 手机号 | 登录别名，写入前规范化（`normalizePhone`），仅接受手机号格式；同上三处写入；登录时按规范化号码比对。 |
| `organization_units` | TEXT | 非空，默认 `'[]'` | 组织单元 | 计划存组织单元 JSON 数组（规范见 [org-permissions.md](./org-permissions.md) 的 `organization_units`）。现存库中该列已建且默认 `[]`，但本次检索未在任何后端代码中找到读写点（未在代码中确认）。 |
| `position` | TEXT | 可空 | 岗位 | 岗位名称自由文本；`POST /admin/users` 与 `PATCH /admin/users/:uid` 写入，其余场景为空。 |

### auth_sessions — 登录会话

- **用途**：服务端会话表；登录成功或首次 setup 后签发 cookie `lingong_session`，库中只保存该令牌的散列。
- **主键 / 唯一约束**：`id_hash`（主键）；外键 `user_id` → `users(id)` `ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/auth.ts`（`createSession()` 在 `POST /auth/login` 与 `POST /auth/setup` 后插入；`POST /auth/logout` 与 `POST /auth/password` 删除本会话/该用户全部会话）；`backend/src/routers/enterprise.ts`（`DELETE /admin/users/:uid` 停用用户时按 `user_id` 全删）。
- **备注**：`sessionUser()` 每次请求按 `id_hash` 查行并校验 `expires_at > now` 与 `users.active = 1`；无定时清理，过期行靠校验失效。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id_hash` | TEXT | 主键，非空 | 会话令牌散列 | 令牌原文的 SHA-256 十六进制摘要（`hashToken()`）；令牌原文只存在于 HttpOnly cookie `lingong_session`，不入库。 |
| `user_id` | TEXT | 非空 | 用户 ID | 会话所属用户，外键指向 `users.id`，用户删除时级联删除。 |
| `expires_at` | TEXT | 非空 | 过期时间 | ISO 8601 字符串，签发时刻 + 14 天（`backend/src/auth.ts` 的 `SESSION_DAYS = 14`）；到期后查询不再命中。 |
| `created_at` | TEXT | 非空 | 签发时间 | ISO 8601 字符串，登录/初始化时写入，之后不变。 |

### orgs — 组织

- **用途**：组织（部门/公司）目录，作为技能授权范围 `scope='org'` 的目标，并供授权界面下拉读取。
- **主键 / 唯一约束**：`id`（主键）；无唯一约束、无外键。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/grants.ts` 的 `seedDirectory()`（`INSERT OR REPLACE`，固定写一条 `org_litime` / 「LiTime」）。
- **备注**：读取方为 `backend/src/host/grants.ts` 的 `directory()`、`backend/src/host/skill-publish.ts`（校验 `org_litime` 存在）、`backend/src/host/knowledge.ts`（校验授权范围）。规范侧的组织树目前只在 [org-permissions.md](./org-permissions.md) 与 `config/org-registry.yaml` 描述，未落成此表的行。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 组织 ID | 组织唯一标识；当前仅种子值 `org_litime`。 |
| `name` | TEXT | 非空 | 组织名称 | 展示名，当前为「LiTime」。 |

### teams — 团队

- **用途**：组织下的小队目录，作为技能授权范围 `scope='team'` 的目标，并参与成员可见范围判定。
- **主键 / 唯一约束**：`id`（主键）；外键 `org_id` → `orgs(id)`（无级联）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/grants.ts` 的 `seedDirectory()`（`INSERT OR REPLACE`，固定写一条 `team_kol` / 「KOL 建联小队」）。
- **备注**：读取方同 `orgs`；人员与团队的挂接在 `memberships`（`scope='team'`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 团队 ID | 团队唯一标识；当前仅种子值 `team_kol`。 |
| `org_id` | TEXT | 非空 | 所属组织 | 指向 `orgs.id`，种子值为 `org_litime`。 |
| `name` | TEXT | 非空 | 团队名称 | 展示名，当前为「KOL 建联小队」。 |

### memberships — 组织成员关系

- **用途**：把人员目录中的 handle 挂到组织/团队上，用于技能可见范围过滤与授权范围校验（`scope='org'`/`'team'`）。
- **主键 / 唯一约束**：`id`（主键）；无唯一约束（种子写固定 id 并用 `INSERT OR IGNORE` 保证幂等）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/grants.ts` 的 `seedDirectory()`，固定四条：`mem_sriphy_org`、`mem_sriphy_team`、`mem_lead_org`、`mem_lingong_org`；除种子外未见其他写入点（未在代码中确认）。
- **备注**：读取方为 `backend/src/host/grants.ts` 的 `memberScopeIds()`、`backend/src/routers/misc.ts` 的 `visibleForRequest()`、`backend/src/host/knowledge.ts`；`memberScopeIds()` 在无行时回退为 `['org_litime']`。注意 `user_handle` 关联的是 `directory_users.handle`，不是 `users.id`，两套身份未在库中有外键绑定。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 成员关系 ID | 关系唯一标识，种子为 `mem_<handle>_<scope>` 形式。 |
| `user_handle` | TEXT | 非空 | 人员 handle | 对应 `directory_users.handle`（如 `sriphy`、`lead`、`lingong`），非 `users.id`。 |
| `scope` | TEXT | 非空 | 范围类型 | 枚举取值 `org` / `team`（`backend/src/host/grants.ts` 的 `GrantScope` 还声明了 `user`，但本表实际只写 `org`/`team`）。 |
| `scope_id` | TEXT | 非空 | 范围对象 ID | `scope='org'` 时指向 `orgs.id`，`scope='team'` 时指向 `teams.id`；本表无外键约束。 |

### directory_users — 人员目录

- **用途**：handle 维度的人员目录，供授权范围下拉、handle→用户解析使用；与登录账号表 `users` 是两个独立维度。
- **主键 / 唯一约束**：`id`（主键）；`handle`（唯一）；无外键。
- **关键索引**：无显式索引（仅有主键与 `handle` 唯一约束的隐式索引）。
- **写入方**：`backend/src/host/grants.ts` 的 `seedDirectory()`（`INSERT OR REPLACE`）：`sriphy`/鄢棽/`product_manager`、`usr_lead`/lead/陈组长/`operator`、`usr_lingong`/lingong/林工/`employee`；`backend/src/db.ts` 迁移期用 `UPDATE OR IGNORE` + `DELETE` 把 legacy id 收敛为 canonical id。
- **备注**：读取方为 `backend/src/host/grants.ts`、`backend/src/host/knowledge.ts`（按 `id` 反查 handle）。`role` 在代码中出现的取值是 `product_manager`、`operator`、`employee`，未找到完整枚举定义（未在代码中确认）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 人员 ID | 人员唯一标识，与 `users.id` 无外键关系；种子值为 `sriphy`、`usr_lead`、`usr_lingong`。 |
| `handle` | TEXT | 非空，唯一 | 人员 handle | 人员短标识，被 `memberships.user_handle` 与技能授权 `scope='user'` 引用。 |
| `name` | TEXT | 非空 | 姓名 | 展示姓名，如「鄢棽」「陈组长」「林工」。 |
| `role` | TEXT | 非空 | 目录角色 | 目录内角色标记；代码中见 `product_manager`、`operator`、`employee`，与 [org-permissions.md](./org-permissions.md) 的角色清单（`platform_admin`/`company_admin`/`department_admin`/`agent_operator`/`employee`/`auditor`）并不一致。 |

### user_preferences — 用户偏好

- **用途**：按用户保存偏好设置与 Cookie 同意状态，每个用户最多一行。
- **主键 / 唯一约束**：`user_id`（主键）；外键 `user_id` → `users(id)` `ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/routers/enterprise.ts` 的 `PATCH /preferences`（`INSERT ... ON CONFLICT(user_id) DO UPDATE`，整行 upsert）。
- **备注**：读取方为 `GET /preferences` 与 `GET /privacy/cookies`（同一文件）；无行时返回默认值（`analytics_cookies=false`、其余键为空）。前端入口见 `frontend/src/pages/AccountSettings.tsx`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键，非空 | 用户 ID | 外键指向 `users.id`，用户删除时级联删除；当前登录用户 `scopedUser().id` 写入。 |
| `analytics_cookies` | INTEGER | 非空，默认 0 | 分析 Cookie 同意 | 0/1 布尔：1 = 允许匿名产品分析 Cookie；`PATCH /preferences` 按 `analytics_cookies` 显式布尔写入，未传时保留原值。 |
| `preferences` | TEXT | 非空，默认 `'{}'` | 偏好集合 | JSON 对象，存放除 `analytics_cookies` 外的全部偏好键值（前端可见 `notifications` 等）；`PATCH` 时与既有值做浅合并后写回。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 `PATCH /preferences` 刷新。 |

### user_uploads — 上传附件

- **用途**：记录通过 `POST /api/attachments` 上传的文件元数据（文件本体落在 `data/uploads/`），供会话附件与「最近文件」使用。
- **主键 / 唯一约束**：`id`（主键）；`path`（唯一）；外键 `owner_user_id` → `users(id)` `ON DELETE SET NULL`。
- **关键索引**：无显式索引（仅有主键与 `path` 唯一约束的隐式索引）。
- **写入方**：`backend/src/routers/misc.ts` 的 `POST /attachments`（落盘后插入元数据）；`backend/src/host/attachments.ts` 的 `sanitizeAttachments()`（附件被引用时刷新 `last_used_at`）。
- **备注**：读取方为 `GET /files/recent`（`backend/src/routers/misc.ts`，按 `last_used_at` 倒序）；`sanitizeAttachments()` 以 `path` 反查行并按 `owner_user_id` 做归属校验，非本人附件返回 403。无删除接口，行与磁盘文件不会随会话删除而清理。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 附件 ID | 附件唯一标识，上传时用 `nid("att")` 生成（`att_` 前缀）。 |
| `owner_user_id` | TEXT | 可空 | 归属用户 | 上传时的 `scopedUser().id`；无登录（演示/关闭鉴权）环境写入 NULL；用户删除时置 NULL。 |
| `name` | TEXT | 非空 | 文件名 | 上传文件名清洗后的安全名（非字母数字、`.`、`-`、中文的字符替换为 `_`）。 |
| `path` | TEXT | 非空，唯一 | 磁盘路径 | 落盘的绝对路径 `<dataDir>/uploads/<id>_<安全名>`，是唯一约束也是附件越权校验的根路径基准。 |
| `size_bytes` | INTEGER | 非空 | 字节数 | 文件字节大小；超过 `MAX_ATTACHMENT_BYTES`（默认 10 MiB）时上传被 413 拒绝，不写行。 |
| `mime_type` | TEXT | 非空 | MIME 类型 | 浏览器上报的 MIME，缺省为 `application/octet-stream`。 |
| `created_at` | TEXT | 非空 | 上传时间 | ISO 8601 字符串，插入时写入，之后不变。 |
| `last_used_at` | TEXT | 非空 | 最近使用时间 | ISO 8601 字符串，插入时等于上传时间，此后每次被 `sanitizeAttachments()` 引用即刷新。 |

### app_state — 应用状态键值

- **用途**：无模式的全局键值状态表，存放当前 persona、旧版登录 handle、Starry 库/邮件同步游标、邮件摘要缓存与一次性数据迁移标记。
- **主键 / 唯一约束**：`key`（主键）；无唯一约束、无外键。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/persona.ts`（`persona` 键）；`backend/src/host/auth.ts`（`auth_handle` 键，登录写、登出删）；`backend/src/starrykol/mail-sync.ts`（`starry_followed_mail_sync`）；`backend/src/starrykol/library-sync.ts`（`starry_library_sync`）；`backend/src/host/mail-summary.ts`（`mail_digest:<collaborationId>`）；`backend/src/host/mail-memory-job.ts`（`mail_person_digest:<mailbox>:<peerEmail>`）；`backend/src/db.ts`（初始化 `persona`，迁移标记 `managed_connector_catalog_v1`、`work_items_priority_v2`）；`backend/src/seed.ts`（重置 `persona`）。
- **备注**：`value` 无 schema 校验，多为 JSON 字符串，少数为裸字符串标记（如 `done`、`sriphy`）。`backend/src/db.ts` 的迁移会把 `mail_digest:*` 复制为 thread 行的字段（原键保留不删）。读取入口分散在 `backend/src/host/persona-key.ts`、`backend/src/starrykol/*`、`backend/src/host/mail-*.ts`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `key` | TEXT | 主键，非空 | 状态键 | 状态键名；代码中出现的键有 `persona`、`auth_handle`、`starry_followed_mail_sync`、`starry_library_sync`、`mail_digest:<collaborationId>`、`mail_person_digest:<mailbox>:<peerEmail>`、`managed_connector_catalog_v1`、`work_items_priority_v2`。 |
| `value` | TEXT | 非空 | 状态值 | 键对应的值；`persona` 存 persona 名（`sriphy`/`exam_blocked`/`permission_blocked`/`employee`，见 `backend/src/config.ts` 的 `PERSONAS`），同步类存 JSON 结果快照，迁移标记存 `done`。 |

---

### organization_units — 组织单元（三级）

- **用途**：权威组织树的落库载体（中心／项目组／部门／组），承载层级、负责人引用、组织版本与来源；绑定目标可以是其中任意一级（CONST-05、ADR-2026-10-03 之二）。
- **主键 / 唯一约束**：`id`（主键，canonical `org:*`）；无其他唯一约束（展示名不作键，避免用姓名/名称当主键）。
- **关键索引**：`organization_units_parent_idx(company_id, parent_id, level)`。
- **写入方**：`backend/src/runtime/organization-tree.ts` 的 `reseedOrganizationTreeFromRegistry()`（启动一次性回填，`app_state` 键 `org_registry_v1` 门控；幂等 upsert）。声明来源为 `config/org-registry.yaml`。
- **备注**：读取方为 `listOrganizationUnits()` 与 `effectiveAgentUsers()`。`level` 直属公司为 1，其余按 parent 链加一；`head_person_ref` 指向 `organization_people.person_ref`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 组织单元 ID | canonical 引用，如 `org:brand_user_growth_center`。 |
| `company_id` | TEXT | 非空 | 公司 | canonical 公司引用（`company:amperetime`）。 |
| `display_name` | TEXT | 非空 | 显示名称 | 如「品牌与用户增长中心」「LT组」。 |
| `type` | TEXT | 非空 | 类型 | 声明来源取值 `center` / `project_group` / `department` / `team`；层级由 `level` 表达，不靠类型判断。 |
| `parent_id` | TEXT | 可空 | 上级单元 | 直属公司时为 NULL。 |
| `level` | INTEGER | 非空，`>= 1` | 层级 | 1／2／3 分别对应一／二／三级组织单元。 |
| `head_person_ref` | TEXT | 可空 | 负责人引用 | 指向 `organization_people.person_ref`；未登记负责人时为 NULL。 |
| `head_display_name` | TEXT | 可空 | 负责人姓名 | 组织系统未接入期间的展示副本；不作授权键。 |
| `status` | TEXT | 非空，默认 `active` | 状态 | `active` / `archived`。 |
| `org_version` | INTEGER | 非空，默认 1，`>= 1` | 组织版本 | 行所属的组织版本，配合 `org_versions` 复核。 |
| `source` | TEXT | 可空 | 来源 | 回填时写入 registry 的 revision；判断事实来源与证据。 |
| `created_at` / `updated_at` | TEXT | 非空 | 时间戳 | ISO 时间。 |

### organization_people — 人员外部引用

- **用途**：组织系统尚未接入时的**外部引用表**（`org-permissions.md` §Canonical 标识）：给出稳定 `person_ref`、显示名与账号对应关系，避免用姓名当主键。
- **主键 / 唯一约束**：`person_ref`（主键，canonical `person:*`）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`reseedOrganizationTreeFromRegistry()`（同 `organization_units`）。账号接入后由管理端回填 `user_id`。
- **备注**：`user_id` 为空表示此人尚无登录账号；`effectiveAgentUsers()` 只把有 `user_id` 的人算作可用使用者，其余仅出现在覆盖预览里。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `person_ref` | TEXT | 主键，非空 | 人员引用 | canonical 引用，如 `person:zhang_huiling`。 |
| `display_name` | TEXT | 非空 | 姓名 | 如「张慧玲」。 |
| `user_ref` | TEXT | 可空 | 外部 User 引用 | registry 声明的 `user:*`（如 `user:liu_min`），与 `users.id` 不同源。 |
| `user_id` | TEXT | 可空 | 登录账号 ID | 指向 `users.id`；未接入账号时为 NULL。 |
| `status` | TEXT | 非空，默认 `active` | 状态 | `active` / `left`。 |
| `source` | TEXT | 可空 | 来源 | 回填来源（含用户确认的组织图日期）。 |
| `created_at` / `updated_at` | TEXT | 非空 | 时间戳 | ISO 时间。 |

### organization_memberships — 组织成员关系

- **用途**：人员与组织单元的成员关系（主组织／协作组织），并承载岗位（职务）与生效期；人员不是组织树节点，因此在关系上表达（`org-permissions.md`）。
- **主键 / 唯一约束**：`id`（主键，`member:<person_ref>:<org_unit_id>:<relation>`）；部分唯一索引 `organization_memberships_active_uniq(person_ref, org_unit_id, relation) WHERE status='active'`。
- **关键索引**：同上的部分唯一索引。
- **写入方**：`reseedOrganizationTreeFromRegistry()`。
- **备注**：`effectiveAgentUsers()` 按本表求「成员集合」；`status='ended'` 立即不再覆盖（组织变动后旧授权失效）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 成员关系 ID | 稳定 id，保证回填幂等。 |
| `person_ref` | TEXT | 非空 | 人员引用 | 指向 `organization_people.person_ref`。 |
| `company_id` | TEXT | 非空 | 公司 | canonical 公司引用。 |
| `org_unit_id` | TEXT | 非空 | 组织单元 | 指向 `organization_units.id`（一／二／三级均可）。 |
| `relation` | TEXT | 非空，默认 `primary` | 关系 | `primary`（主组织）／`collaborative`（协作组织）。 |
| `position` | TEXT | 可空 | 岗位 / 职务 | 如「高级副总裁」「推广部主管」；自由文本，不作授权键。 |
| `status` | TEXT | 非空，默认 `active` | 状态 | `active` / `ended`。 |
| `effective_from` / `effective_to` | TEXT | 可空 | 生效期 | 组织图未提供时留空，不编造。 |
| `source` | TEXT | 可空 | 来源 | 回填来源。 |
| `created_at` / `updated_at` | TEXT | 非空 | 时间戳 | ISO 时间。 |

### scope_memberships — 品牌/区域范围关系

- **用途**：把「人能服务哪些品牌与区域」保存为带生效期的**关系**（而非人员标签），主体可以是人员或组织单元；对应对象 C7/C8。品牌与区域字典仍以 `config/brand-registry.yaml` 为唯一权威，本表只引用其 canonical id。
- **主键 / 唯一约束**：`id`（主键，`scope:<subject_type>:<subject_id>:brand:<brand|*>:region:<region|*>`）。
- **关键索引**：`scope_memberships_subject_idx(subject_type, subject_id, status)`。
- **写入方**：`reseedOrganizationTreeFromRegistry()`；组织单元的 `brand_scope` 落为 `region_id IS NULL` 的行。
- **备注**：范围**不继承**（普通员工不继承负责人公司级范围，BIZ-03）；负责人公司级范围来自 `department_head_scope_policy`，不写成本表行。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 范围记录 ID | 稳定 id。 |
| `subject_type` | TEXT | 非空 | 主体类型 | `person` / `organization_unit`。 |
| `subject_id` | TEXT | 非空 | 主体引用 | `person_ref` 或 `org:*`。 |
| `company_id` | TEXT | 非空 | 公司 | canonical 公司引用。 |
| `brand_id` | TEXT | 可空 | 品牌引用 | `brand:lt` 等；为 NULL 表示不限品牌。 |
| `region_id` | TEXT | 可空 | 区域引用 | `region:eu` / `region:us` / `region:ca_au`；为 NULL 表示不限区域。 |
| `status` | TEXT | 非空，默认 `active` | 状态 | `active` / `ended`。 |
| `effective_from` / `effective_to` | TEXT | 可空 | 生效期 | 组织图未提供时留空。 |
| `source` | TEXT | 可空 | 来源 | 回填来源（含标签原文，如「LT-EU」）。 |
| `created_at` / `updated_at` | TEXT | 非空 | 时间戳 | ISO 时间。 |

### agent_bindings — Agent 使用绑定

- **用途**：人员使用 Agent 的**唯一授权关系**（CONST-05）：绑定目标为任意组织单元（含三级组）或人员；有效使用者由服务端 `effectiveAgentUsers()` 统一计算。
- **主键 / 唯一约束**：`id`（主键，`binding:<agent_id>:<target_type>:<target_id>`）；部分唯一索引 `agent_bindings_active_uniq(agent_id, target_type, target_id) WHERE status='active'`。
- **关键索引**：同上的部分唯一索引。
- **写入方**：`createAgentBinding()` / `revokeAgentBinding()`（`backend/src/runtime/organization-tree.ts`）；回填**不**写绑定，试点绑定点需由用户确认后显式创建。
- **备注**：`effectiveAgentUsers()` 只读本表 + 组织表，不缓存；撤绑或组织变动后下一次请求立即复核。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 绑定 ID | 稳定 id。 |
| `agent_id` | TEXT | 非空 | Agent | 如 `agent:kol`。 |
| `target_type` | TEXT | 非空 | 绑定目标类型 | `organization_unit` / `person`。 |
| `target_id` | TEXT | 非空 | 绑定目标 | `org:*` 或 `person_ref`。 |
| `company_id` | TEXT | 非空 | 公司 | 绑定目标必须属于同一公司，跨公司拒绝。 |
| `status` | TEXT | 非空，默认 `active` | 状态 | `active` / `revoked`。 |
| `binding_version` | INTEGER | 非空，默认 1，`>= 1` | 绑定版本 | 变更计数。 |
| `org_version` | INTEGER | 非空，`>= 1` | 组织版本 | 建立绑定时依据的组织版本。 |
| `created_by` | TEXT | 可空 | 变更人 | 管理端操作者。 |
| `reason` | TEXT | 可空 | 原因 / 撤绑理由 | 变更留痕。 |
| `effective_from` / `effective_to` | TEXT | 可空 | 生效期 | 默认建立时间。 |
| `source` | TEXT | 可空 | 来源 | 如 `admin`；回填不产生本表行。 |
| `created_at` / `updated_at` | TEXT | 非空 | 时间戳 | ISO 时间。 |

### org_versions — 组织版本

- **用途**：组织事实的版本锚点（CONST-05 / PROD-PLAT-05 要求「依据的组织版本」）；组织变动后版本加一，旧授权按新版本复核。
- **主键 / 唯一约束**：复合主键 `(company_id, version)`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`reseedOrganizationTreeFromRegistry()` 落版本 1；`bumpOrgVersion()` 递增。
- **备注**：`currentOrgVersion()` 返回公司当前版本；`effectiveAgentUsers()` 回报该版本号，供覆盖预览与审计引用。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `company_id` | TEXT | 主键之一，非空 | 公司 | canonical 公司引用。 |
| `version` | INTEGER | 主键之一，非空，`>= 1` | 版本号 | 从 1 递增。 |
| `effective_at` | TEXT | 非空 | 生效时间 | ISO 时间。 |
| `note` | TEXT | 可空 | 说明 | 变更原因。 |
| `source` | TEXT | 可空 | 来源 | 如 `admin` 或 registry revision。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 时间。 |

## 四、分组 2：会话·消息·草稿·协作（6 张表）

Agent 会话与消息、邮件/内容草稿、协作记录、会话分享与后台 worker。

### sessions — 会话

- **用途**：员工端「一次对话/一个工作线程」的容器。首页会话列表、专家召唤、KOL 合作会话、今日规划、任务执行、AI 发现各开一条会话；`messages` / `drafts` / `workers` 都挂在它下面，删除会话时这三张表按 `session_id` 一起清理。
- **主键 / 唯一约束**：`id`（主键，前缀 `ses`，`nid("ses")`）。无其它唯一约束——同一 `collaboration_id` 允许存在多条会话（一个合作单可以有多条线，见 `backend/src/host/kol-journey.ts` 的按 `updated_at DESC` 取最新一条）。
- **关键索引**：`sessions_collaboration_updated`（`(collaboration_id, updated_at DESC)`，按合作单取最近会话）；`sessions_updated`（`updated_at DESC`，列表默认排序）；`sessions_owner_updated`（`(owner_user_id, updated_at DESC)`，`GET /api/sessions` 按当前账号取自己的会话）。三者都在 `backend/src/db.ts` 的 `migrateSchema` 末尾创建。
- **写入方**：`backend/src/host/api.ts`（`POST /api/sessions` 新建，`kind` 缺省 `work`；`syncSessionStageCopy` 改标题；归档/取消归档见 `backend/src/routers/enterprise.ts` 的 `POST`/`DELETE /sessions/:sid/archive`；`DELETE /sessions/:sid` 软删）。`backend/src/host/session-messages.ts`（每写一条消息就把 `updated_at` 推到当前时间）。`backend/src/host/kol-journey.ts`（`openKolSession` 建 `kind='kol'` 且带 `collaboration_id`）。`backend/src/host/today-plan-run.ts`（`createPlanningSession` 建 `today_plan` / `todo_plan` / `today_analyze`）。`backend/src/routers/tasks.ts`（建 `kind='task'`）。`backend/src/home-discovery.ts`（建 `kind='discovery'`）。`backend/src/experts.ts`（`summonExpert` 建 `kind='work'` 并写 `expert_id`/`expert_version`）。`backend/src/worker/runner.ts`（`setThread`/`clearThread` 写或清 `thread_ref`）。
- **备注**：无外键约束。列表接口只把 `id`/`title`/`archived_at` 序列化出去，`kind`/`disabled` 只用于过滤（`disabled=1`、`kind='platform_example'`、标题命中 `PLATFORM_EXAMPLE_TITLES`（`加班申请`/`华北分支` 同义文案，实为 `backend/src/config.ts` 里的 `["加班申请","华北渠道"]`）的行不展示）；`deleted_at` 非空即视为已删除，`assertSessionRowExists` 会当作 404 拒绝再写消息。删除是软删（保留行、置 `deleted_at`/`archived_at`、清 `thread_ref`），阶段转移记录不随会话删除。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 会话 ID | 会话唯一标识，`nid("ses")` 生成，形如 `ses_ab12cd34ef56`。 |
| `title` | TEXT | 非空 | 会话标题 | 展示名。新建默认 `新会话`；KOL 会话为 `显示名 · 阶段名`，并在阶段变更时由 `syncSessionStageCopy` 重写；任务会话取任务标题。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），建会话时写入，不再变更。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串。写消息、改标题、归档、删会话都会推进；会话列表默认按它倒序。 |
| `collaboration_id` | TEXT | 可空 | 合作单 ID | 逻辑指向 `collaborations.id`（无外键）。KOL 会话建会话时写入；`syncSessionStageCopy` 会把现有会话补挂到该合作单。普通会话为 NULL。 |
| `kind` | TEXT | 可空 | 会话类型 | 代码里实际写入的值：`work`（普通工作会话 / 专家召唤）、`kol`（KOL 合作会话）、`task`（任务执行）、`discovery`（AI 寻人发现）、`today_plan`、`todo_plan`、`today_analyze`（三类规划会话）。`platform_example` 只在读取侧被过滤（`backend/src/host/api.ts`），未在代码中确认有写入路径。 |
| `disabled` | INTEGER | 非空，默认 0 | 是否停用 | 布尔（0/1）。所有 INSERT 都写字面量 0，读取侧（`GET /api/sessions`）把非 0 当作不可见；**未在代码中确认有把它改成 1 的写入路径**。 |
| `thread_ref` | TEXT | 可空 | Codex 线程引用 | 该会话当前绑定的 Codex 对话线程 ID。`backend/src/worker/runner.ts` 的 `setThread` 写、`clearThread`（Codex 不可用时）置 NULL；`DELETE /sessions/:sid` 也会清空。用于多轮复用同一线程。 |
| `owner_user_id` | TEXT | 可空 | 归属账号 ID | 逻辑指向 `users.id`（无外键）。创建时取 `scopedUser()?.id`；关认证时为 NULL。`GET /api/sessions` 按它做「只看自己的会话」，迁移 `migrateSriphyIdentity` 会把历史值 `usr_sriphy` 统一改成 `sriphy`。 |
| `archived_at` | TEXT | 可空 | 归档时间 | ISO 8601 字符串。`POST /sessions/:sid/archive` 写入，`DELETE /sessions/:sid/archive` 置回 NULL；删会话时用 `COALESCE` 兜底补上。非空表示已归档，默认列表不返回（`include_archived=1` 才带）。 |
| `deleted_at` | TEXT | 可空 | 删除时间 | ISO 8601 字符串。`DELETE /sessions/:sid` 软删时写入，同时清空 `thread_ref`。非空即视为不存在：再往该会话写消息会被拒绝（404 `session_not_found`）。 |
| `expert_id` | TEXT | 可空 | 绑定专家 ID | `POST /api/experts/:id/summon` 创建专家会话时写入专家发布包 ID（当前只有 `expert:kol`）；`today_plan` 等规划会话也会写入运行期身份标识。普通会话为 NULL。 |
| `expert_version` | TEXT | 可空 | 绑定专家版本 | 与 `expert_id` 同时写入的发布包版本号（`manifest.version`）。规划会话（`backend/src/host/today-plan-run.ts`）显式写 NULL。类型是 TEXT 而非数字，比较时需按字符串处理。 |

### messages — 会话消息

- **用途**：一条会话里的逐条消息流，是会话详情的唯一数据源。用户发的话、助手回复、系统提示、结果卡、错误卡、阶段确认卡、进度追踪都写在这里；消息卡片的原地刷新也是改本表的 `payload`。
- **主键 / 唯一约束**：`id`（主键，前缀 `msg`，`nid("msg")`）。无其它唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）。所有查询都按 `session_id` 走全表扫描 + `ORDER BY created_at, id`，目前没有 `session_id` 索引。
- **写入方**：`backend/src/host/session-messages.ts`（`insertSessionMessage` 是唯一的标准写入函数：插入消息并在同一事务里校准 `sessions.updated_at`，随后向会话 SSE 通道 `publishSession` 推 `upsert`）。调用方：`backend/src/host/api.ts`（`addMsg` 门面，聊天、卡片、系统提示）；`backend/src/host/kol-journey.ts`（KOL 会话来信/阶段确认卡）；`backend/src/crawl/service.ts`（采集结果卡）。原地更新 `payload`：`backend/src/host/api.ts`（流式回复收尾、`email_card`、`task_result_card`、`process_trace`、`operation_trace`、`confirm_stage_card`）、`backend/src/host/kol-journey.ts`、`backend/src/host/mail-summary.ts`。删除：`backend/src/routers/enterprise.ts`（删会话时按 `session_id` 清空）、`backend/src/host/kol-journey.ts`、`backend/src/host/api.ts`（撤销最后一条用户消息）、`backend/src/seed.ts`。
- **备注**：有外键 `FOREIGN KEY(session_id) REFERENCES sessions(id)`（无级联）。写入前会先校验会话存在且未软删；外键报错被转成 404 `session_not_found` 而不是抛原始 SQLite 错误。会话被软删时消息行会被物理删除。分享快照在 `include_internal=false` 时会剔除 `steps`、`process_trace`、`job_status`、`confirm_stage_card`、`inbound_card`、`supplement_card` 这几类，并从 payload 里删掉 `body_zh_internal`/`path`/`approval_id`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 消息 ID | 消息唯一标识，`nid("msg")` 生成。 |
| `session_id` | TEXT | 非空 | 会话 ID | 所属会话，外键指向 `sessions.id`。 |
| `role` | TEXT | 非空 | 发言角色 | 代码中实际出现的只有三种：`me`（用户本人说话）、`assistant`（助手/卡片）、`system`（系统提示）。 |
| `kind` | TEXT | 非空 | 消息类型 | 决定前端如何渲染。实际写入值：`assistant`（普通回复）、`me`、`sys_msg`、`error_card`、`task_result_card`、`email_card`、`steps`、`process_trace`、`operation_trace`、`job_status`、`supplement_card`、`confirm_stage_card`、`crawl_plan`、`inbound_card`、`kol_mail_card`。 |
| `payload` | TEXT | 非空 | 消息体 | JSON 字符串。结构随 `kind` 变化：文本消息是 `{text}`，卡片带 `draft_id`/`collaboration_id`/`targets` 等。禁读字段（`body_zh_internal`、`path`、`approval_id`）只在对外分享时被剥掉。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，插入时写入，之后不再变更；消息按其 + `id` 升序排列。 |

### drafts — 邮件草稿

- **用途**：待发邮件的本地实体。所有外发邮件都必须先落成本表的一行，再由人工核对、确认后发送——「发送 ≠ 推进阶段」，发送只改本表状态，不动 `collaborations.stage_code`。邮件卡片、审批（`approvals.draft_id`）、发送回执都围绕本表。
- **主键 / 唯一约束**：`id`（主键，前缀 `dft`，`nid("dft")`）。无其它唯一约束。
- **关键索引**：`drafts_session_id`（`(session_id, id DESC)`，按会话取最新草稿，创建于 `backend/src/db.ts` `migrateSchema` 末尾）。无 `collaboration_id` 索引。
- **写入方**：`backend/src/host/api.ts`（`persistDraft` 插入；`reviseDraft` / `POST /drafts/:did` 改收件人、主题、正文、金额、`extra`、`fingerprint`；`applyAuthorizedFrom` 纠正发件邮箱；`setDraftStatus` 写状态与 `send_error`；`syncDraftArtifacts` 把改后的中文正文写回 `body_zh_internal`）。`backend/src/host/mail-send-confirmation.ts`（`claimMailSend` 置 `sending`、`completeMailSend` 置 `sent` 并写 `sent_at`、`markMailSendUnknown` 置 `send_unknown`）。`backend/src/gateway/wecom.ts`（建审批后回写 `approval_id`；审批被驳回时置 `discarded`）。删除：`backend/src/routers/enterprise.ts`（删会话时按 `session_id` 清空）。`backend/src/db.ts` 的 `migrateSchema` 做过 `proposed_stage`/`official_stage` 的历史阶段码重命名。
- **备注**：无外键约束。`keep_stage` 是「发送不推进阶段」这条不变量的落库标记，`persistDraft` 恒定写 1（worker 解析出的 `keep_stage` 并不会写进本列）。`fingerprint` 由当前待发内容（发件/收件/主题/正文/金额等）算出，用于发送前比对「你核对的是不是同一个草稿」，内容一变就重算；`extra.confirmation_revision` 每次改稿累加。`status` 不是一个封闭枚举：除默认 `draft` 外，代码会写 `sending`、`sent`、`send_unknown`、`discarded`，以及 PEP（政策执行点）校验失败的失败码（如 `blocked_exam` / `blocked_permission` / `blocked_template` / `missing_cc`，见 `backend/src/host/pep.ts`）；`waiting_approval` 在 `backend/src/host/mail-send-confirmation.ts` 与 `backend/src/host/api.ts` 被读取并用于禁用发送，**未在代码中确认有写它的路径**。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 草稿 ID | 草稿唯一标识，`nid("dft")` 生成；`approvals.draft_id` 与消息卡片的 `draft_id` 都指向它。 |
| `session_id` | TEXT | 非空 | 会话 ID | 所属会话（逻辑指向 `sessions.id`，无外键）。 |
| `collaboration_id` | TEXT | 可空 | 合作单 ID | 逻辑指向 `collaborations.id`；来自 worker 输出或当前会话绑定的合作单。不涉及具体 KOL 的草稿（如通用回信）为空。 |
| `skill` | TEXT | 非空 | 出草稿的技能 ID | 生成该草稿的技能目录名，如 `email_compose`、`quote_confirm`、`ship_notice`、`sop_initial_contact` 等（见 `backend/skills/`）。发送校验按它选模板与规则。 |
| `from_addr` | TEXT | 非空 | 发件邮箱 | 请求里写的发件人；写入后经 `applyAuthorizedFrom` 纠正为当前用户授权范围内的邮箱。品牌箱白名单见 `backend/src/config.ts` 的 `BRAND_MAILBOXES`。 |
| `to_addr` | TEXT | 非空 | 收件邮箱 | 收件人。由 `resolveMailTo` 解析（优先合作单邮箱、其次是入参），取不到时写空串。发送成功后若合作单邮箱为空会回填到 `collaborations.email`。 |
| `cc` | TEXT | 可空，默认 `''` | 抄送 | 抄送列表（逗号分隔字符串）。`quote_confirm` 且金额 < $350 时必须有内部抄送，否则 PEP 以 `missing_cc` 拒绝发送。 |
| `subject` | TEXT | 非空 | 邮件主题 | 主题原文（英文），为空时写空串。 |
| `body_en` | TEXT | 非空 | 英文正文 | 实际外发的正文原文。发送前校验的必须是它，改正文后必须重新确认。 |
| `body_zh_internal` | TEXT | 非空 | 中文内部预览 | 仅供内部阅读的中文版，不外发；缺失时由 `stubInternalZh` 生成占位。一键翻译会改写它。对外分享快照时会从 payload 里剥掉。 |
| `lang_label` | TEXT | 非空 | 语言标签 | 展示用语言说明。`persistDraft` 固定写 `English · 发送为原文`。 |
| `amount_usd` | REAL | 可空 | 金额（美元） | 报价/结算金额。为 NULL 表示本封不涉及金额；`quote_confirm` 的小额抄送规则按它判定。 |
| `keep_stage` | INTEGER | 非空，默认 1 | 是否保持阶段 | 布尔（0/1）。当前所有插入路径都写 1，含义是「发这封信不改变正式阶段」；改动它不会联动改阶段。 |
| `proposed_stage` | TEXT | 可空 | 建议阶段 | 草稿作者建议的下一阶段码（取值同 `collaborations.stage_code`）；只作提示，必须另走人工确认阶段才算数。 |
| `official_stage` | TEXT | 可空 | 出稿时的正式阶段 | 生成草稿那一刻合作单的正式阶段快照，发送校验与模板门禁按它比对。 |
| `approval_id` | TEXT | 可空 | 关联审批 ID | 逻辑指向 `approvals.id`；草稿需走审批时由 `backend/src/gateway/wecom.ts` 回写。非空且审批未通过时不允许发送。 |
| `fingerprint` | TEXT | 可空 | 内容指纹 | 由待发内容算出的指纹，发送前比对用；内容每次变动后重算。 |
| `template_id` | TEXT | 可空 | 模板 ID | 通常为 `<skill>.v1`。模板门禁（`templateGateOk`）按阶段校验它，不符则以 `blocked_template` 拒绝发送。 |
| `sent_at` | TEXT | 可空 | 发送成功时间 | ISO 8601 字符串，`completeMailSend` 置 `sent` 时同写。为空表示尚未成功外发。 |
| `status` | TEXT | 非空，默认 `draft` | 草稿状态 | 默认 `draft`；代码写入 `sending`（已认领发送）、`sent`（成功）、`send_unknown`（网关结果不可确认，禁止重发）、`discarded`（审批驳回后作废），以及 PEP 失败码。取值集合未封闭。 |
| `extra` | TEXT | 可空 | 扩展字段 | JSON 字符串。存放不进正式列的量：`currency`、`rate_unit`、`deliverables`、`brand`、`cpm`、`approval_policy`、`tracking`、`carrier`、`footer`、`knowledge_id`/`knowledge_version`、`confirmation_revision` 等。 |
| `send_error` | TEXT | 可空 | 发送失败原因 | 与 `status` 同时写；PEP 拒绝时存失败说明，成功发送后不清理（未在代码中确认）——读取侧只在卡片上按 `status` 判断禁用。 |
| `currency` | TEXT | 可空 | 币种 | 与 `amount_usd` 配套的币种码（如 `USD`）；未给金额时为 NULL。 |

### collaborations — KOL 合作单

- **用途**：一个「品牌 × 红人」合作对象的本地主档。阶段看板、首页项目列表、会话挂靠、发信解析、KOL 记忆与任务取数都以本行为中心；Starry 红人库全量同步也会灌入本表（只灌画像，不造邮件）。
- **主键 / 唯一约束**：`id`（主键，前缀 `col`，`nid("col")`）。**无唯一约束**——同一 `kol_uid` 在不同 `brand` 下可以各有一行，代码查询普遍是 `WHERE kol_uid=? AND brand=?` 再加兜底。
- **关键索引**：无显式索引（仅有主键的隐式索引）。列表与看板常见查询路径（`stage_code`、`kol_uid`、`brand`、`overdue`）都没有索引。
- **写入方**：`backend/src/adapters/starry.ts`（`confirmStage` **唯一的正式阶段写入路径**：`UPDATE collaborations SET stage_code=?, days_in_stage=0, stage_version=?`，带 `stage_version` 乐观锁，并同时写 `stage_transitions` 与 `starry_stage_writes`）。`backend/src/host/api.ts`（`POST /inbound/:iid/create` 建单；`persistHumanSkip` 写 `last_skip_kind`/`last_skip_reason`/`last_skipped_stages`）。`backend/src/host/kol-memory.ts`（`dualWriteOwner` 写 `owner_name`）。`backend/src/host/mail-to.ts`、`backend/src/host/pep.ts`、`backend/src/host/mail-send-confirmation.ts`（回填/纠正 `email`）。`backend/src/starrykol/library-sync.ts`（红人库同步 upsert：画像字段、`stage_code`、`source='starry'`、`duplicate_checked=1`、`owner_mailbox`、`follow_style_tags` 等）。`backend/src/discovery.ts`（`creator_discovery` 追人后建单，写 `source='discovery'`、`kol_uid`、`avg_views_10`）。`backend/src/starrykol/mail-sync.ts`（写 `conversation_id`）。`backend/src/follow-style-tags.ts`（写 `follow_style_tags`）。`backend/src/seed.ts`/`backend/src/seed-fixtures.ts`（演示数据与 `list_in_projects=1`）。
- **备注**：无外键约束。`stage_code` 取值来自 [`stage-transitions.json`](../config/stage-transitions.json) 的 `nodes`：主线 15 个（`INITIAL_CONTACT`→`SETTLING`）+ `exception`；异常细分 `PAUSED`/`DISPUTED`（可返回）与 `LOST`/`REJECTED`/`CANCELLED`（终态），`COMPLETED` 不是合法节点。历史阶段码由 `backend/src/db.ts` 的 `migrateSchema` 改写。`locked=1` 或处于承诺锁定期阶段时禁止人工改阶段（`locked_promise` 403）。`list_in_projects` 是「项目」列表的显式放进开关：不置 1 的合作单只有在有邮件/阶段转移/任务/草稿时才出现在默认列表里。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 合作单 ID | 唯一标识，`nid("col")` 生成（形如 `col_ab12cd34ef56`）；会话、草稿、阶段转移、邮件都靠它关联。 |
| `handle` | TEXT | 非空 | 红人账号名 | 平台账号 handle；发现/建信流程取不到时用昵称或平台创作者 ID 兜底。 |
| `display_name` | TEXT | 非空 | 显示名 | 界面展示名，通常等于 `handle`。 |
| `brand` | TEXT | 非空 | 归属品牌 | 字典取值 `LT`（LiTime）/ `RO`（Renogy）/ `PQ`（Power Queen），见 `backend/src/starrykol/remote-contract.ts` 的 `BRAND_DICTIONARY`；发现流程缺省写 `LT`。 |
| `platform` | TEXT | 可空 | 平台 | 平台码，如 `youtube`/`instagram`/`tiktok`/`facebook`/`bilibili`（`PLATFORM_DICTIONARY`）；来信建单时写 `inbound`。 |
| `followers` | TEXT | 可空 | 粉丝数 | 以字符串存（远端返回可能带单位或千分位），不做数值运算。 |
| `email` | TEXT | 非空 | 联系邮箱 | 对外发信地址。新建时写空串；发送成功后若为空会被回填，授权核对通过时也会被纠正。 |
| `mailbox_from` | TEXT | 非空 | 品牌发件箱 | 该合作单默认使用的品牌邮箱，建单/同步时按 `BRAND_MAILBOXES[brand]` 取值（如 `kol.lt@litime.example`）。 |
| `lifecycle_id` | TEXT | 非空 | 生命周期 ID | 远端（Starry）生命周期标识，同时是 `confirmStage` 的查询键；新单占位为 `lc_<合作单ID>`。 |
| `conversation_id` | TEXT | 非空 | 会话 ID（远端邮件） | 远端邮件会话标识，邮件同步时写入；新单占位为 `conv_<合作单ID>`。 |
| `stage_code` | TEXT | 非空 | 正式阶段码 | 当前正式阶段。取值见 [`stage-transitions.json`](../config/stage-transitions.json)；只由 `confirmStage`（唯一正式写入路径）在人/自动判定通过后改写，发邮件不会改它。 |
| `days_in_stage` | INTEGER | 可空，默认 0 | 阶段停留天数 | 进入当前阶段后累计的天数；`confirmStage` 每次改阶段都置 0。代码中另有读取计算，但**未在代码中确认有自动按天累加的写入路径**。 |
| `notes` | TEXT | 可空 | 备注 | 自由文本；建单时写来源说明（如 `from inbound`、`from ai discovery follow`）。 |
| `overdue` | INTEGER | 可空，默认 0 | 是否超期 | 布尔（0/1）。读取侧用 `WHERE overdue = 1` 出「超期」清单；写入只见于演示数据与红人库同步的 `overdue=excluded.overdue`（回写既有值），**未在代码中确认有按停留天数自动置 1 的路径**。 |
| `stage_version` | INTEGER | 非空，默认 0 | 阶段版本号 | 乐观锁：`confirmStage` 用 `WHERE stage_version = 旧值` 更新并 +1，冲突即抛错；前端确认卡也拿它做 `version_conflict` 比对。 |
| `recipient_name` | TEXT | 可空 | 收货人姓名 | 寄样收件信息，`ship_notice` 模板会读取（`backend/src/host/compose-loop.ts`）。当前只在演示数据与红人库同步兜底里出现，**未在代码中确认有面向用户的编辑入口**。 |
| `phone` | TEXT | 可空 | 联系电话 | 寄样联系方式，同上，未确认编辑入口。 |
| `address_line` | TEXT | 可空 | 收货地址 | 寄样地址，同上，未确认编辑入口。 |
| `country` | TEXT | 可空 | 国家/地区 | 收货国家，同上，未确认编辑入口。 |
| `postal` | TEXT | 可空 | 邮编 | 收货邮编，同上，未确认编辑入口。 |
| `sku` | TEXT | 可空 | 样品 SKU | 寄样品类，同上，未确认编辑入口。 |
| `qty` | TEXT | 可空 | 样品数量 | 以字符串存，同上，未确认编辑入口。 |
| `locked` | INTEGER | 非空，默认 0 | 是否锁定阶段 | 布尔（0/1）。非 0 时人工改阶段被拒绝（403 `locked_promise`）。 |
| `owner_name` | TEXT | 可空 | 负责人姓名 | 该红人的负责人；由 KOL 记忆的 `dualWriteOwner` 双写，红人库同步也会覆盖。非账号 ID，是姓名文本。 |
| `avg_views_10` | TEXT | 可空 | 近 10 条平均播放 | 以字符串存（远端可能带单位）；发现流程与红人库同步写入。 |
| `engagement_rate` | TEXT | 可空 | 互动率 | 以字符串存（如 `0.037`），不做数值运算。 |
| `audience_geo` | TEXT | 可空 | 受众地域 | 受众主要国家/地区，红人库同步写入。 |
| `duplicate_checked` | INTEGER | 非空，默认 0 | 是否已查重 | 布尔（0/1）。红人库同步恒置 1；首页把它折成「已查重」标签展示。 |
| `group_brand_overlap` | TEXT | 可空 | 集团品牌重合情况 | 自由文本（如 `未与RO/PQ合作`、`可接触RO`、`RO主责`），首页直接并入画像文案。 |
| `kol_uid` | TEXT | 可空 | 红人唯一 ID | Starry 侧红人标识，是同步与记忆的主键；发现流程可能先写占位值，后由同步替换。 |
| `source` | TEXT | 可空 | 来源 | 建单来源，代码写入 `starry`（红人库同步）、`discovery`（AI 寻人）；来信建单未写该列。 |
| `follow_style_tags` | TEXT | 可空 | 跟进偏好标签 | JSON 数组字符串（`[{id,label,custom?}]`，见 `backend/src/follow-style-tags.ts`）；红人库同步返回空数组时不覆盖操作员刚保存的值。 |
| `niche` | TEXT | 可空 | 内容领域标签 | 领域标签名拼接串（用 `；` 分隔），红人库同步写入。 |
| `risk_tag` | TEXT | 可空 | 风险标签 | 归一化后的风险码，取值 `DELAY`（延期）/ `CONTENT`（内容风险）/ `LOST_CONTACT`（失联）；别名如 `逾期`、`LOST`、`EXCEPTION_HANDLING` 会被 `normalizeRiskTag` 映射。 |
| `wechat` | TEXT | 可空 | 微信 | 联系方式补充字段，红人库同步写入。 |
| `kol_id` | TEXT | 可空 | 红人库内部 ID | Starry 侧的内部档案 ID，与 `kol_uid` 不同，红人库同步写入。 |
| `last_conversation_id` | TEXT | 可空 | 最近邮件会话 ID | 远端返回的最后一次会话标识，红人库同步写入，用于快速定位最近往来。 |
| `last_lifecycle_id` | TEXT | 可空 | 最近生命周期 ID | 远端返回的最后一次生命周期标识，红人库同步写入。 |
| `last_skip_kind` | TEXT | 可空 | 最近跳阶段的类型 | 人工跳阶段时写 `skip`（`persistHumanSkip`）；非跳阶段（相邻推进/回退）时清为 NULL。 |
| `last_skip_reason` | TEXT | 可空 | 最近跳阶段的原因 | 人工跳阶段填的原因原文；与 `last_skip_kind` 同写同清。 |
| `last_skipped_stages` | TEXT | 可空 | 被跳过的阶段 | JSON 数组字符串，记录该次跳阶段跳过了哪些阶段码。 |
| `contact_email_masked` | TEXT | 可空 | 脱敏联系邮箱 | 远端返回的掩码邮箱（如 `a***@x.com`），红人库同步写入，仅供展示。 |
| `owner_mailbox` | TEXT | 可空 | 负责人邮箱 | 红人库同步写入的负责人邮箱，与 `owner_name` 配套。 |
| `list_in_projects` | INTEGER | 非空，默认 0 | 是否放进「项目」列表 | 布尔（0/1）。`GET /api/projects` 默认只列它为 1 或「有邮件/阶段转移/任务/草稿」的合作单；演示数据会显式置 1。 |

### session_shares — 会话只读分享

- **用途**：把一条会话以只读链接分享给外部（无需登录）。分享是「快照式只读」，不授予写权限；令牌只存哈希，链接里的一次性明文只在创建响应里返回一次。
- **主键 / 唯一约束**：`id`（主键，前缀 `shr`，`nid("shr")`）；`token_hash` 唯一（建表时内联 `UNIQUE`，用于按令牌反查）。
- **关键索引**：无显式索引（仅有主键与 `token_hash` 唯一约束的隐式索引）。无 `session_id` 索引。
- **写入方**：`backend/src/routers/enterprise.ts`（`POST /sessions/:sid/share` 插入；`DELETE /sessions/:sid/share/:shareId` 单个撤销、`DELETE /sessions/:sid/share` 全部撤销，都写 `revoked_at`；`DELETE /sessions/:sid` 删会话时按 `session_id` 物理删除）。读取：`GET /api/shared/:token`（校验 `revoked_at IS NULL AND expires_at > now`，命中即返回 `sessionSnapshot`）。
- **备注**：有外键 `FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE`。有效期由 `expires_in_seconds` 决定，代码夹在 60 秒 ~ 30 天之间，缺省 86400 秒（1 天）。`include_internal` 决定快照是否包含内部内容（中文正文、内部卡片、附件路径、审批 ID）。每条分享动作都写 `audit_events`（`session.share.create` / `session.share.revoke` / `session.share.revoke_all`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 分享 ID | 分享记录唯一标识，`nid("shr")` 生成；撤销接口按它定位。 |
| `session_id` | TEXT | 非空 | 会话 ID | 被分享的会话，外键指向 `sessions.id`，随会话删除级联删除。 |
| `token_hash` | TEXT | 非空，唯一 | 令牌哈希 | 分享令牌的摘要（`tokenDigest`），明文令牌只在创建响应里返回一次，库中不可还原。 |
| `expires_at` | TEXT | 非空 | 过期时间 | ISO 8601 字符串，创建时按 `now + expires_in_seconds` 写入；过期后 `GET /api/shared/:token` 一律 404。 |
| `revoked_at` | TEXT | 可空 | 撤销时间 | ISO 8601 字符串；单个撤销或全部撤销时写入。非空即视为不可再用（即使未过期）。 |
| `include_internal` | INTEGER | 非空，默认 0 | 是否包含内部内容 | 布尔（0/1）。仅当创建请求显式传 `include_internal: true` 时为 1；为 0 时快照剔除内部卡片、中文正文、附件路径与审批 ID。 |
| `created_by` | TEXT | 非空 | 创建人 | 创建分享的账号 ID（`scopedUser()?.id`），关闭认证时写 `demo`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，写入后不再变更。 |

### workers — Skill 执行记录

- **用途**：一次 Skill 执行（一个「worker」）的运行档案。每跑一轮任务就插一行，记录这次跑的是哪个技能、用了哪个 Codex profile、产出了哪些 item、过程日志、工作箱目录与结束状态。任务运行、会话状态（`waiting_approval`）与执行审计都读它。
- **主键 / 唯一约束**：`id`（主键，前缀 `wrk`，`nid("wrk")`）。无其它唯一约束；同一会话可有任意多行（一任务一行）。
- **关键索引**：`workers_session_created`（`(session_id, created_at DESC)`，按会话取最近一次执行，见 `backend/src/host/api.ts` 的 `SELECT session_id, status FROM workers ... MAX(created_at)`）。
- **写入方**：`backend/src/worker/common.ts`（`persistWorker` 是唯一插入点，一次 INSERT 写全 10 列；`killBox` 置 `status='killed'` 并写 `killed_reason`；`markWaitingApproval` 先杀箱再置 `status='waiting_approval'`）。调用方 `backend/src/worker/runner.ts`（成功时 `status='done'`、`profile_id` 取 `profileFor()` 结果、`box_path` 为工作箱目录、`contract_log` 为 app-server 调用日志、`items` 为技能输出；Codex 不可用时落 `status='codex_unavailable'` 且 `killed_reason='codex_unavailable'`）。`backend/src/worker/stub.ts`（桩执行同样走 `persistWorker`）。删除：`backend/src/routers/enterprise.ts`（删会话时按 `session_id` 清空，并顺手删掉对应 `box_path` 目录）。
- **备注**：无外键约束（`session_id` 是逻辑指向）。`items` 里禁止出现 `send_mail`/`wecom_send`/`confirm_stage`/`starry_stage`/`ingest` 五类副作用项（`FORBIDDEN_ITEM_TYPES`），写入前由 `assertItemsSafe` 拦截——worker 只能出草稿和建议，不能自己外发或推进阶段。一任务一箱：`waiting_approval` 与 `killed` 都会物理删除工作箱目录。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 执行 ID | 本次 Skill 执行的唯一标识，`nid("wrk")` 生成；同时是工作箱目录名（`boxDir()/wrk_...`），也是运行时上下文里的 `runId`。 |
| `session_id` | TEXT | 非空 | 会话 ID | 该次执行所属会话（逻辑指向 `sessions.id`，无外键）；会话被删时本行也随之删除。 |
| `skill` | TEXT | 非空 | 技能 ID | 执行的技能目录名，如 `email_compose`、`quote_confirm`、`business_approval`、`reply_analysis`、`creator_discovery`、`sop_*` 等（见 `backend/skills/` 与 `data/skills/`）。 |
| `profile_id` | TEXT | 可空 | Codex 配置档 ID | 本轮使用的运行配置档，由 `profileFor(skill, stage_code)` 决定。取值：`commander`、`lead`、`opportunity`、`negotiation`、`execution`、`settlement-growth`（`backend/src/profiles.ts`）。该列是后加的，历史行可能为 NULL。 |
| `status` | TEXT | 非空 | 执行状态 | 代码写入：`done`（正常跑完）、`codex_unavailable`（Codex 不可用）、`killed`（被主动杀箱）、`waiting_approval`（等人工确认）。 |
| `contract_log` | TEXT | 非空 | 调用契约日志 | JSON 数组字符串，记录本轮与 Codex app-server 的方法调用与结果（如 `turn/completed` 与状态）。用于排障与审计，不对外展示。 |
| `items` | TEXT | 非空 | 技能产出项 | JSON 数组字符串。每项带 `type`（如 `task_result`、`create_draft`、`propose_stage`、`list_overdue`、`create_approval`、`text`）；禁止包含外发/改阶段/导入类副作用项。 |
| `box_path` | TEXT | 可空 | 工作箱目录 | 该次执行的沙箱目录绝对路径。人确认后是新 turn、不留长驻进程，因此 `killed`/`waiting_approval` 时目录会被删除；删会话时也按此列清理目录。 |
| `killed_reason` | TEXT | 可空 | 终止原因 | 写 `waiting_approval`（等人工确认而杀箱）、`codex_unavailable`（Codex 不可用）；其它调用方传入的原因字符串也会原样落库。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，`persistWorker` 写入的执行发起时间；「取最近一次执行」按其倒序。 |

---

## 五、分组 3：审批·幂等·审计·入站（5 张表）

审批请求与幂等键、审批角色绑定、审计事件、入站消息。

### approvals — 工作审批

- **用途**：承载所有需要人工确认的受控动作（费用审批、阶段审批、内容审核、结算审批）。由 Host 规则引擎或企微事件发起，一次审批 = 一条多级审批链记录，逐级推进直到驳回或办结。
- **主键 / 唯一约束**：`id`（主键，`nid("appr")` 生成）。除主键外无其它唯一约束；`chain_id` 当前恒等于 `id`，不是独立约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）。列表查询依赖 `ORDER BY created_at DESC` 全表扫描。
- **写入方**：`backend/src/gateway/wecom.ts`（`createWorkApproval` 插入，`decide` 更新推进/驳回/办结）；调用方 `backend/src/routers/approvals.ts`（费用审批 HTTP 入口）、`backend/src/host/api.ts`（会话内费用审批 L2812、阶段确认审批 L3025）。`backend/src/db.ts` 的 `migrateSchema` 负责补列。
- **备注**：状态机只有 `pending → rejected` 和 `pending → consumed` 两条路径，没有独立「已通过」态——最后一级同意即为 `consumed`。所有 `UPDATE` 都带 `AND status = 'pending' AND version = ?` 做乐观锁，`changes=0` 时抛 409 `stale`。仓库清理见 `backend/src/seed.ts`（删除 `kind IN ('quote','stage','ingest','content','settlement')` 的审批及其企微卡）。审批人只来自 Host 规则引擎传入的 `chain`，本表不点名。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 审批 ID | 审批唯一标识，创建时由 `nid("appr")` 生成，同时复用为 `chain_id` 和 `wecom_card_id`。 |
| `draft_id` | TEXT | 非空 | 草稿 ID | 关联的邮件/内容草稿 ID；无草稿时写空串。创建后回写 `drafts.approval_id`，驳回时把草稿置为 `discarded`。 |
| `brand` | TEXT | 非空 | 品牌 | 品牌代码，创建时默认 `LT`（费用审批固定 `LT`，阶段审批取合作单的 `brand`）。 |
| `amount_usd` | REAL | 非空 | 审批金额 | 存的是折合基准币的金额（费用审批传 `plan.amount_base`，单位为人民币元）；字段名沿用了历史 USD 命名，非 USD 时无单独汇率字段。无金额的审批写 0。 |
| `status` | TEXT | 非空 | 审批状态 | 取值 `pending`（待处理）、`rejected`（驳回）、`consumed`（最后一级同意并办结，`uses_left` 同时置 0）。 |
| `chain` | TEXT | 非空 | 审批链 | JSON 数组，元素为员工 ID（如 `["emp_wang"]`），按顺序逐级审批；空数组的审批不会落库。 |
| `current_index` | INTEGER | 非空，默认 0 | 当前环节下标 | 指向 `chain` 中当前待决人的下标；每级同意后 +1，最后一级同意时不再 +1（改置 `consumed`）。 |
| `uses_left` | INTEGER | 非空，默认 1 | 剩余可用次数 | 一次审批默认只能用一次；办结时置 0。 |
| `fingerprint` | TEXT | 非空 | 内容指纹 | 创建时默认 `JSON.stringify(payload)`，用于标识审批内容版本；更新时不重算。 |
| `need_manual_band` | INTEGER | 非空，默认 0 | 是否需人工分档 | 布尔（0/1）。插入时固定写 0，代码中未见其它写入路径。 |
| `wecom_card_id` | TEXT | 非空 | 企微卡片 ID | 关联的企微模板卡 ID，创建时等于审批 `id`；卡片状态由 `wecom_cards` 表维护。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），创建时写入，不再变更。 |
| `chain_id` | TEXT | 可空 | 审批链 ID | 迁移补列；创建时等于 `id`，读取时 `getApproval` 兜底为 `id`。用于把同一条链的多张卡片归组。 |
| `kind` | TEXT | 非空，默认 `'quote'` | 审批类型 | 枚举见 `WorkApprovalKind`（`backend/src/stages.ts`）：`expense` 费用、`stage` 阶段、`content` 内容审核、`settlement` 结算。DDL 默认值 `'quote'` 与 `'ingest'`（`seed.ts` 清理列表中出现）均为历史遗留值，当前新建只写上述四种。读取时 `getApproval` 对空值兜底为 `expense`。 |
| `payload` | TEXT | 可空 | 审批载荷 | JSON 对象：承载审批业务上下文（费用审批含 `amount`/`currency`/`amount_base`/`steps`/`purpose` 等；阶段审批含 `collaboration_id`/`stage_code`/`current_stage`/`expected_version` 等）。驳回时追加 `reject_reason`、`rejected_by` 后整体回写。 |
| `title` | TEXT | 可空 | 审批标题 | 展示用标题，如「张三申请 CNY 5000，折合人民币 5000」；未传时按「类型标签 · 申请人/品牌」生成。 |
| `submitted_by` | TEXT | 可空 | 提交人 handle | 创建时取 `currentUser().handle`，取不到时写 `host`；用于「我提交的」审批箱筛选。 |
| `version` | INTEGER | 非空，默认 0 | 乐观锁版本 | 每次状态变更 +1，与请求的 `expected_version` 比较，不符返回 409 `stale`。 |
| `updated_at` | TEXT | 可空 | 更新时间 | ISO 8601 字符串；每次 decide 更新时写当前时间，读取时兜底为 `created_at`。 |

### approval_idempotency — 审批幂等回执

- **用途**：记录审批创建与决定操作的幂等回执，保证同一 `idempotency_key` 重复提交时返回首次结果而不产生重复副作用。
- **主键 / 唯一约束**：`id`（主键，`nid("aidem")`）；`UNIQUE(action, approval_id, idempotency_key)`（真正用于防重的约束）。
- **关键索引**：无显式索引（`UNIQUE` 约束自带隐式索引）。
- **写入方**：`backend/src/gateway/wecom.ts`：`saveCreateReceipt`（创建回执，`INSERT OR IGNORE`）、`insertDecideReceipt`（决定回执，`INSERT OR IGNORE`）。读取方为 `createReceipt` / `decideReceipt`。
- **备注**：创建回执的 `approval_id` 固定写 `'*'`（查找时同样按 `'*'` 命中），因为创建请求本身还没有审批 ID；决定回执的 `approval_id` 为真实审批 ID。回执永不删除、无 TTL。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 回执 ID | 主键，`nid("aidem")` 生成。 |
| `action` | TEXT | 非空 | 动作 | 取值 `create`（创建审批）、`decide`（审批决定）。与 `approval_id`、`idempotency_key` 组成唯一键。 |
| `approval_id` | TEXT | 非空 | 审批 ID | `action='create'` 时固定为 `'*'`；`action='decide'` 时为真实审批 ID。 |
| `idempotency_key` | TEXT | 非空 | 幂等键 | 调用方传入的幂等键（HTTP body 的 `idempotency_key`），同一动作+审批下重复即命中回执。 |
| `result_json` | TEXT | 非空 | 结果快照 | 首次执行结果的 JSON：创建回执存 `{"id": "<审批ID>"}`，决定回执存完整的 decide 返回对象。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，写入回执时生成。 |

### approval_role_bindings — 审批角色绑定

- **用途**：把平台用户绑定到审批角色，供权限判定使用；一个用户可有多个审批角色。管理员在后台授予/回收。
- **主键 / 唯一约束**：`PRIMARY KEY(user_id, approval_role)`；外键 `user_id → users(id) ON DELETE CASCADE`。
- **关键索引**：无显式索引（复合主键自带隐式索引；外键无自动索引）。
- **写入方**：`backend/src/routers/enterprise.ts`：`PUT /admin/users/:uid/approval-roles/:role`（`INSERT OR IGNORE`）、`DELETE .../:role`（删除单条）、`PUT /admin/users/:uid/approval-roles`（tx 内先删后插批量替换）。读取方为 `backend/src/auth.ts`（组装用户权限）、`backend/src/routers/enterprise.ts`（用户详情）。`backend/src/db.ts` 的 `migrateSriphyIdentity` 会把历史 `usr_sriphy` 归一到 `sriphy`。
- **备注**：批量替换接口的取值白名单是 `lead`、`manager`、`zhang`（`enterprise.ts` 内联常量），单条绑定接口不校验取值。删除用户时由外键级联清理。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键之一，非空 | 用户 ID | 指向 `users.id`，删除用户时级联删除本行。 |
| `approval_role` | TEXT | 主键之一，非空 | 审批角色 | 审批角色标识；批量接口白名单为 `lead`、`manager`、`zhang`，单条接口未做校验。 |
| `created_at` | TEXT | 非空 | 绑定时间 | ISO 8601 字符串，绑定时写入。 |

### audit_events — 审计事件

- **用途**：全平台操作审计流水，所有受控动作（登录、审批、外发、导入、管理员操作、运行时引导等）都在此留痕，也是 connector 活动面板的数据源。
- **主键 / 唯一约束**：`id`（`INTEGER PRIMARY KEY AUTOINCREMENT`，自增，无独立 UNIQUE 约束）。
- **关键索引**：无显式索引；`connector-operations.ts` 的查询依赖 `json_extract(payload,'$.connector_id')` 与 `event_type LIKE 'runtime.%'`，均无索引支撑。
- **写入方**：`backend/src/db.ts` 的 `audit()`（全仓库统一入口，约 200+ 调用点分布在 `routers/`、`host/`、`runtime/`、`skills/` 等）；`backend/src/runtime/store.ts` 的两处运行时引导迁移直接插入（actor `system:runtime-bootstrap`）。`backend/src/db.ts` 的 `migrateSriphyIdentity` 会回改历史 actor/payload。读取方为 `listAudit()` 与 `backend/src/routers/connector-operations.ts` 的活动接口。
- **备注**：`audit()` 内部会把 actor `usr_sriphy` 归一写为 `sriphy`。表只增不改不删（除身份归一迁移外无 UPDATE/DELETE）。payload 恒为 JSON 字符串，查询侧用 `json_valid` / `json_extract` 过滤。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER | 主键，自增 | 事件序号 | `INTEGER PRIMARY KEY AUTOINCREMENT`，单调递增，列表按此排序。 |
| `ts` | TEXT | 非空 | 发生时间 | ISO 8601 字符串，`audit()` 写入时取 `nowIso()`。 |
| `actor` | TEXT | 非空 | 操作者 | 操作主体标识；常见取值有用户 ID / handle（如 `sriphy`）、服务身份（`host`、`gateway`、`worker`、`system`、`starry`、`claw`）与 `system:runtime-bootstrap`。 |
| `event_type` | TEXT | 非空 | 事件类型 | 点分层级的事件名。前缀分布包括 `admin.`、`knowledge.`、`skill.`、`host.`、`runtime.`、`task.`、`kol.`、`discovery.`、`session.`、`starrykol.`、`worker.`、`gateway.`、`approval.`、`memory.`、`cron.`、`cost.`、`auth.`、`wecom.`、`exam.` 等（完整清单以代码中 `audit(...)` 调用为准）。 |
| `payload` | TEXT | 非空 | 事件载荷 | 事件上下文的 JSON 字符串（如 `{approval_id, decision, ...}`）；无字段时写 `{}`。 |

### inbound — 未绑定来信

- **用途**：存放入站邮件中尚未归属到合作单（KOL 跟进）的来信，作为「待人选归属」的收件箱；支撑会话内展示、暂缓、绑定到已有合作单或新建合作单。
- **主键 / 唯一约束**：`id`（主键，`nid("inb")`）；`CREATE UNIQUE INDEX inbound_provider_message_id ON inbound(provider_message_id) WHERE provider_message_id IS NOT NULL AND provider_message_id != ''`（部分唯一索引，防同一外部邮件重复入库）。
- **关键索引**：`inbound_provider_message_id`（上述部分唯一索引，用于按邮件 Message ID 去重）、`inbound_identity_hash`（按内容指纹去重与查找）。
- **写入方**：`backend/src/host/mail-memory.ts` 的 `projectUnboundInbound`（插入，`inboundByIdentity` 判重后跳过重复），由 `backend/src/starrykol/mail-sync.ts` 调用；`backend/src/host/api.ts` 的 `/inbound/:iid/defer`、`/resume`、`/bind`、`/create` 接口更新 `deferred` / `bound` / `collaboration_id` / `brand`；`backend/src/seed-fixtures.ts` 写入演示数据；`backend/src/seed.ts` 在删除合作单时把对应 `collaboration_id` 置空。去重键由 `backend/src/host/inbound-identity.ts` 计算。
- **备注**：本表只覆盖「未绑定」来信，已绑定邮件正文另存 `kol_mail_items` / `kol_mail_threads`。`session_id`、`confidence`、`candidates`、`summary` 为迁移补列：当前插入路径恒写 `null` / `"low"` / `"[]"` / `""`，代码中未见后续 UPDATE 写入（`session_id` 的写入路径未在代码中确认），读取端仅做透传展示。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 来信 ID | 唯一标识，`nid("inb")` 生成。 |
| `from_addr` | TEXT | 可空 | 发件人地址 | 来信发件邮箱；缺失时写空串。 |
| `from_name` | TEXT | 可空 | 发件人名称 | 发件人显示名；缺失时写空串。 |
| `subject` | TEXT | 可空 | 邮件主题 | 来信主题；缺失时写空串。 |
| `snippet` | TEXT | 可空 | 摘要片段 | 正文片段的截断（最多 280 字符，优先 `snippet`，否则取 `body`）。 |
| `summary` | TEXT | 可空 | 来信摘要 | 摘要列；当前插入路径恒写空串，仅 `seed-fixtures.ts` 的演示数据填了中文摘要。 |
| `bound` | INTEGER | 非空，默认 0 | 是否已绑定 | 布尔（0/1）。0 = 未归属；绑定到合作单或新建合作单后置 1。 |
| `deferred` | INTEGER | 非空，默认 0 | 是否暂缓 | 布尔（0/1）。`/inbound/:iid/defer` 置 1、`/resume` 置 0。 |
| `collaboration_id` | TEXT | 可空 | 合作单 ID | 绑定的合作单 ID；未绑定时为 null，绑定/新建后写入。 |
| `session_id` | TEXT | 可空 | 会话 ID | 关联会话 ID；插入路径恒写 null，写入路径未在代码中确认。 |
| `confidence` | TEXT | 可空 | 匹配置信度 | 插入路径恒写 `low`；代码中未见其它取值写入（未在代码中确认完整枚举）。 |
| `candidates` | TEXT | 可空 | 候选合作单 | JSON 数组字符串；插入路径恒写 `[]`，仅演示数据写入了候选列表。 |
| `ts` | TEXT | 非空 | 来信时间 | ISO 8601 字符串；优先取邮件发生时间，缺失时取 `nowIso()`。列表按 `ts DESC, id DESC` 游标分页。 |
| `provider_message_id` | TEXT | 可空 | 外部邮件 ID | 邮件服务商的 Message ID，用于部分唯一索引去重；无该 ID 时为 null。 |
| `identity_hash` | TEXT | 可空 | 身份指纹 | `inboundIdentity` 计算的 SHA-256：有 Message ID 时按 `mid:<id>`，否则按 `collaboration:subject:body前80:conversation` 指纹。 |
| `brand` | TEXT | 可空 | 品牌 | 绑定到合作单时由 `COALESCE(brand, ?)` 回填合作单品牌。 |
| `mailbox` | TEXT | 可空 | 收件邮箱 | 收到该信的品牌邮箱地址；缺失时写空串。 |

---

## 六、分组 4：授权与连接器目录（6 张表）

按人/按技能的授权、连接器目录、用户与 Starry 的绑定、他人邮箱归属。

### user_skill_grants — 用户技能授权

- **用途**：员工与技能（Skill）的一对多授权表，是「人员授权唯一单位＝技能」的落库形态（[DECISIONS.md](./DECISIONS.md) ADR-2026-09-27「对外只暴露技能」）；管理员在员工目录放行某人的某个技能时产生一行，撤销即删行。
- **主键 / 唯一约束**：`PRIMARY KEY(user_id, skill_id)` 复合主键；外键 `user_id` → `users(id)` `ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/routers/enterprise.ts`（`PUT /admin/users/:uid/skills/:skill` 单条 `INSERT OR IGNORE`；`DELETE /admin/users/:uid/skills/:skill` 单条撤销；`PUT /admin/users/:uid/skills` 整体替换——先按 `user_id` 全删再逐条插入）；`backend/src/db.ts` 的 `migrateSriphyIdentity()` 在历史账号 id 重写时对本表做 `UPDATE OR IGNORE` / `DELETE`。
- **备注**：读方为 `backend/src/auth.ts` 的 `permissions()`（返回 `skills` 数组）与 `requireSkill()`、`backend/src/runtime/execution.ts` 的 `assertRuntimeSkill()` / `userHoldsSkill()`、`backend/src/routers/misc.ts`、`backend/src/routers/tasks.ts`、`backend/src/routers/enterprise.ts` 的员工目录。`roles` 含 `admin` 的用户绕过本表全量放行；`skill_id` 必须是 `SKILL_CATALOG`（`backend/src/host/skills-catalog.ts`）中存在的技能 id，无固定枚举。注意不要与 `skill_grants`（技能→组织范围）混淆。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键（复合 PK1），非空 | 用户 ID | 被授权员工的 `users.id`，外键指向 `users(id)`，用户删除时级联删行。 |
| `skill_id` | TEXT | 主键（复合 PK2），非空 | 技能 ID | 被放行的技能标识；写入前由 `enterprise.ts` 用 `SKILL_CATALOG` 校验存在性，取值为当前技能目录的 id（无固定枚举）。 |
| `created_at` | TEXT | 非空 | 授权时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），仅插入时写入，之后不变；撤销靠删行而非改状态。 |

### user_connector_grants — 用户连接器授权

- **用途**：历史「按人给连接器 read/write/admin」的授权表。ADR-2026-09-27 已决定该按人授权语义退役，但代码现状仍在运行时读取它做档位校验，管理端已无按人授权入口。
- **主键 / 唯一约束**：`PRIMARY KEY(user_id, connector_id)` 复合主键；外键 `user_id` → `users(id)` `ON DELETE CASCADE`，外键 `connector_id` → `connectors(id)` `ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/db.ts` 的 `enforceManagedConnectorCatalog()`（把旧别名 `claw`/`kolclaw`、`starrykol`/`starry`/`emailmcp`/`enterprise_mail` 上的授权 `INSERT OR IGNORE` 归并到规范 id `claw` / `starrykol`，并把 `admin`/`write` 统一改写为 `write`）；`backend/src/db.ts` 的 `migrateSriphyIdentity()`（账号 id 重写）。当前工作区**未见任何 HTTP 路由写入本表**（未在代码中确认）；管理端如再按人授权需另立入口。
- **备注**：读方为 `backend/src/auth.ts` 的 `permissions()`（返回 `connectors` 映射）与 `requireConnector()`（档位比较 `read=1 / write=2 / admin=3`，不给或低于所需档即 403 `connector_not_granted`）、`requireStageWrite()`（要求 `starrykol` 或遗留 `starry` 上不低于 `write`）、`backend/src/routers/enterprise.ts` 的 `GET /connectors`（`JOIN` 本表过滤员工可见连接器）。调用点分布在 `backend/src/routers/crawl.ts`、`backend/src/routers/approvals.ts`、`backend/src/host/api.ts`、`backend/src/host/mail-send-confirmation.ts`、`backend/src/cron/authz.ts`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键（复合 PK1），非空 | 用户 ID | 被授权员工的 `users.id`，外键指向 `users(id)`，用户删除时级联删行。 |
| `connector_id` | TEXT | 主键（复合 PK2），非空 | 连接器 ID | 被授权的 `connectors.id`，外键指向 `connectors(id)`，连接器删除时级联删行。 |
| `access` | TEXT | 非空 | 访问档位 | 枚举 `read` / `write` / `admin`，`requireConnector()` 按 1/2/3 数值比较；历史别名归并时会把 `admin`、`write` 统一写成 `write`（`backend/src/db.ts`）。 |
| `created_at` | TEXT | 非空 | 授权时间 | ISO 8601 字符串；归并迁移写入迁移时刻，单条授权写入授权时刻，之后不变。 |

### connector_tool_grants — 连接器工具范围授权

- **用途**：连接器级「某个 MCP 工具对谁开放」的范围表，按 `(连接器, 工具, 范围类型, 范围值)` 落一行；语义上是**附加限制**，只能收窄、不得放大——ADR-2026-09-27 已决定工具级授权语义退役，本表保留但不参与运行时校验。
- **主键 / 唯一约束**：`PRIMARY KEY(connector_id, tool_name, scope_type, scope_value)` 复合主键；外键 `connector_id` → `connectors(id)` `ON DELETE CASCADE`；`created_by` 无外键。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：**当前工作区（HEAD）代码中无任何读写点（未在代码中确认）**。本表由未合入 HEAD 的连接器工具授权分支 `wip/account-bar-connectors`（commit `f950a4d`）引入：该实现里 `PUT /admin/connectors/:id/tools/:tool/grants` 先按 `(connector_id, tool_name)` 全删再批量插入，`created_by` 写管理员 id；连接器配置变更（`configurationChanged`）或删除连接器时按 `connector_id` 清空/级联删除。
- **备注**：`scope_type` 的取值集合来自上述分支实现——`all`（`scope_value` 固定空串）、`user`（值为 `users.id`，存在性校验）、`position`（值为岗位文本，≤120 字）、`department_level_1` / `department_level_2`（值为组织单元 id，且层级必须匹配）；其他值报 `invalid scope_type`。该表出现在 `data-e2e/lingong.db` 等运行库中，但当前 `backend/src/db.ts` 已无对应建表语句，属未合入分支的持久化残留。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 主键（复合 PK1），非空 | 连接器 ID | 授权所属的 `connectors.id`，外键指向 `connectors(id)`，连接器删除时级联删行。 |
| `tool_name` | TEXT | 主键（复合 PK2），非空 | 工具名 | 远端 MCP 工具名；写入前需能在该连接器已发现的工具目录中找到，否则报 404。 |
| `scope_type` | TEXT | 主键（复合 PK3），非空 | 范围类型 | 枚举 `all` / `user` / `position` / `department_level_1` / `department_level_2`（见备注）。 |
| `scope_value` | TEXT | 主键（复合 PK4），非空，默认 `''` | 范围值 | 随 `scope_type` 变化：`all` 固定为空串，`user` 为用户 id，`position` 为岗位文本，`department_level_*` 为组织单元 id。 |
| `created_by` | TEXT | 可空 | 授权人 | 执行授权的管理员 `users.id`（该分支实现写入）；无外键约束。 |
| `created_at` | TEXT | 非空 | 授权时间 | ISO 8601 字符串；该分支的整表替换会先删后插，故时间随每次替换刷新。 |

### connectors — 连接器目录

- **用途**：平台管理的连接器目录（内置 MediaCrawler、Starry KOL 与管理端自建 MCP / 自定义 HTTP API），每行一个连接器，承载启用态、验证态、凭据引用、图标与接入协议声明；是技能运行时可用的外部资源清单。
- **主键 / 唯一约束**：`id`（主键）；无唯一约束、无外键（`user_connector_grants` / `connector_tool_grants` 反向引用本表）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/db.ts` 的 `enforceManagedConnectorCatalog()`（按 `BUILTIN_CONNECTORS` 为 `claw` / `starrykol` 做 `INSERT OR IGNORE` 后回写 `label` / `purpose`；一次性把这两个置 `draft`；删除退休别名 `enterprise_mail` / `emailmcp` / `kolclaw` / `starry` / `wecom`）与 `migrateSchema()`（补列 `purpose` / `last_verified_at` / `last_error` / `icon_ref` / `declared_protocol`）；`backend/src/routers/enterprise.ts`（`POST /admin/connectors` 建草稿、`PATCH /admin/connectors/:id` 改 `label` / `purpose` / `status` / `credential_ref` / `enabled`、`DELETE /admin/connectors/:id` 删行）；`backend/src/routers/connector-import.ts`（MCP JSON 导入建 `pending_verification` 行，配置校验失败即回删）；`backend/src/routers/connector-operations.ts`（探测后写 `enabled` / `status` / `last_verified_at` / `last_error` / `updated_at`）；`backend/src/routers/skill-runtime.ts`（运行时配置变更后置 `enabled=0`、`status='pending_verification'`）；`backend/src/routers/connector-icons.ts`（写 `icon_ref`）。
- **备注**：`status` 取值为 `configured`（默认）、`draft`、`pending_verification`、`verified`、`verification_failed`。启用闸门（`backend/src/routers/enterprise.ts` 的 `PATCH`）要求 `status='verified'` 且该连接器已被至少一个技能绑定其工具，否则返回 `connector_verification_required` / `connector_skill_binding_required`（ADR-2026-09-27 的启用门禁）。MCP 端点与 headers 不存本表，存 `runtime_connector_config.config_json`（`backend/src/runtime/store.ts`）；工具策略存 `runtime_tool_policies`。`mcp_config` / `tools_json` / `last_tested_at` 三列在当前工作区代码中无任何读写点（未在代码中确认），来自未合入 HEAD 的连接器分支。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键 | 连接器短名 | 连接器唯一标识，正则 `^[a-z][a-z0-9_-]{2,63}$`（`backend/src/connectors/catalog.ts` 的 `CONNECTOR_ID`）；内置为 `claw`（MediaCrawler MCP）、`starrykol`（Starry KOL MCP），自建沿用管理员给定的 id。 |
| `label` | TEXT | 非空 | 名称 | 界面显示名（创建时 ≤120 字）；种子来自 `BUILTIN_CONNECTORS`，管理端 `PATCH` 可改。 |
| `enabled` | INTEGER | 非空，默认 1 | 是否启用 | 0/1 布尔，1 为可用；种子插入时给 0，之后由 `PATCH /admin/connectors/:id` 或探测流程写入；探测失败、配置变更、目录迁移都会把它置 0。 |
| `status` | TEXT | 非空，默认 `'configured'` | 验证状态 | 枚举 `configured` / `draft` / `pending_verification` / `verified` / `verification_failed`；由管理端增改、JSON 导入、探测与运行时配置变更写入。 |
| `credential_ref` | TEXT | 可空 | 凭据引用 | 指向凭据保险库 `runtime_credentials.id`（形如 `cred_…`，`nid("cred")` 生成），**不是**明文密钥；`PATCH` 只接受该字段并显式拒绝 `secret` / `password`；JSON 导入为每个 header 各建一条 `organization_secret` 凭据后写其 id。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，任何写入路径都会刷新。 |
| `mcp_config` | TEXT | 可空 | 旧 MCP 配置 | 计划存 MCP 端点与鉴权 JSON（未在代码中确认）；当前代码无读写点，实际配置存 `runtime_connector_config.config_json`。 |
| `tools_json` | TEXT | 非空，默认 `'[]'` | 旧工具清单 | 计划存已发现工具的 JSON 数组（未在代码中确认）；当前代码无读写点，工具目录实存 `runtime_connector_tool_inventory` / `runtime_tool_policies`。 |
| `last_tested_at` | TEXT | 可空 | 最近测试时间 | 计划记录最近一次连通性测试时间（未在代码中确认）；当前代码无读写点，实际用 `last_verified_at`。 |
| `last_error` | TEXT | 可空 | 最近错误 | 最近一次探测失败的错误码或文案；由 `connector-operations.ts` 写入，探测成功时写 NULL，目录一次性迁移也会清空。 |
| `purpose` | TEXT | 非空，默认 `''` | 用途 | 连接器用途说明（管理端创建时必填且 ≤280 字）；内置值来自 `BUILTIN_CONNECTORS.purpose`，由 `enforceManagedConnectorCatalog()` 回写。 |
| `last_verified_at` | TEXT | 可空 | 最近验证时间 | ISO 8601 字符串，探测成功或失败都写本次探测时刻（`connector-operations.ts`）；目录一次性迁移会置 NULL。 |
| `icon_ref` | TEXT | 可空 | 图标文件引用 | 管理员上传图标后落在 `<dataDir>/connector-icons/` 下的文件名（`<connectorId>-<随机 hex>.png\|jpg`），**不是路径**；为空时前端回退内置图标（`claw` / `starrykol` 有随包图标）。 |
| `declared_protocol` | TEXT | 可空 | 声明接入类型 | 创建弹窗声明的协议，仅允许 `mcp` / `http`（`backend/src/routers/enterprise.ts` 校验）；仅在尚无 `runtime_connector_config` 时作为 `protocol` 兜底，未声明为 NULL。 |

### user_starry_bindings — 用户 Starry 邮箱挂载

- **用途**：员工与 Starry 邮箱的一对多挂载关系，同时承载该邮箱的增量同步游标；员工在「绑定 Starry 邮箱」时产生一行，是写邮件默认发件箱（`backend/src/host/compose-sender.ts`）与跟进邮件范围（`currentFollowScope()`）的依据。
- **主键 / 唯一约束**：`PRIMARY KEY(user_id, mailbox_email)` 复合主键；外键 `user_id` → `users(id)` `ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/starry-bind.ts` 的 `saveStarryBinding()`（`INSERT … ON CONFLICT(user_id, mailbox_email) DO UPDATE` 写 `mailbox_id` / `owner_name` / `bearer_token` / `status` / `updated_at`）、`clearStarryBinding()`（删行并在删掉默认箱后把最旧一行 `is_default` 置 1）；调用入口为 `backend/src/routers/misc.ts` 的 `POST /me/starry-binding` 与 `DELETE /me/starry-binding`；`backend/src/host/mail-memory.ts` 的 `updateBindingSyncCursor()`（更新 `sync_cursor_at` / `sync_cursor_id` / `sync_page_no` / `synced_at` / `last_error` / `last_tool` / `updated_at`）；`backend/src/db.ts` 的 `rebuildUserStarryBindings()`（把单列主键老库重建成复合主键，并把每用户唯一一行标为默认箱）与 `migrateSchema()` 补列。
- **备注**：不变量是「每个用户至多一个默认箱」——首个挂载箱为默认，新增箱不改默认，删除默认箱后按 `is_default DESC, updated_at ASC, mailbox_email ASC` 顺序把第一行提升为默认。多邮箱读取统一按上述排序取第一行（`starryBindingRow()`）。`bearer_token` 是明文令牌（未加密存储），接口只回传 `has_token` 布尔。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键（复合 PK1），非空 | 用户 ID | 挂载所属员工的 `users.id`，外键指向 `users(id)`，用户删除时级联删行。 |
| `mailbox_email` | TEXT | 主键（复合 PK2），非空 | 挂载邮箱 | 小写规范化后的 Starry 发件邮箱（`normalizeEmail`）；绑定前必须由 `listStarryMailboxes()` 探测且能在当前身份的可用邮箱列表里命中，否则 422。 |
| `is_default` | INTEGER | 非空，默认 0 | 是否默认箱 | 0/1 布尔；写邮件未指定发件箱时取该用户 `is_default=1`（无则取排序第一行）的邮箱。 |
| `mailbox_id` | TEXT | 可空 | Starry 邮箱 ID | Starry 侧的邮箱标识（`mailboxFromStarryRow()` 取 `row.id` / `row.mailboxId`）；随绑定写入，取不到时退化为空串。 |
| `owner_name` | TEXT | 可空 | 邮箱负责人 | Starry 侧邮箱负责人姓名；`backend/src/host/pep.ts` 用它比对「本人姓名」以判断共用邮箱是否可作发件箱。 |
| `bearer_token` | TEXT | 可空 | 访问令牌 | 该邮箱的 Starry bearer 令牌**明文**（未加密）；绑定表单提交时写入，接口只回传 `has_token` 布尔，不回传原文。 |
| `status` | TEXT | 非空，默认 `'connected'` | 挂载状态 | 库内见 `connected` / `expired`（`StarryBindingStatus`）；`publicStarryBinding()` 把 `expired` 以外一律归一为 `connected`，前端另有未挂载展示态 `unbound`（非库内取值）。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串；绑定、解绑补位、同步游标更新都会刷新。 |
| `sync_cursor_at` | TEXT | 可空 | 同步时间游标 | 最近一次成功同步覆盖到的远端会话时间；`backend/src/starrykol/mail-sync.ts` 的 `conversationNeedsDetail()` 用它判断远端是否有新变化。 |
| `sync_cursor_id` | TEXT | 可空 | 同步会话游标 | 最近一次同步处理的会话 id（`mail-sync.ts` 的 `cursorId`）；为空表示尚无游标。 |
| `sync_page_no` | INTEGER | 非空，默认 1 | 同步页码 | 后台分页同步的断点页号，下次同步从该页继续（前台只同步当前页前若干条）；缺省 1。 |
| `synced_at` | TEXT | 可空 | 最近同步时间 | 本邮箱最近一次同步完成时间，ISO 8601 字符串，由 `updateBindingSyncCursor()` 写入。 |
| `last_error` | TEXT | 可空 | 最近同步错误 | 最近一次同步失败的错误文案；同步成功时写入空串。 |
| `last_tool` | TEXT | 可空 | 最近调用工具 | 最近一次同步调用的 Starry 工具名；代码中固定写 `pageEmailConversations`。 |

### mailbox_owners — 品牌邮箱登记

- **用途**：品牌／部门邮箱的登记表，回答「这个邮箱属于哪个品牌、谁在用、是个人箱还是共用箱」，供发件箱授权核对与邮箱列表合并展示。
- **主键 / 唯一约束**：`email`（主键）；无唯一约束、无外键。注意该主键列在 DDL 中未写 `NOT NULL`（SQLite 对非 INTEGER 主键的历史行为），实际业务不允许空地址。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/seed.ts` 的 `seedMailboxOwners()`（`INSERT OR REPLACE` 固定写 5 条演示登记：LT/RO/PQ 的 `kol.*` 个人箱与 2 个共用箱）；**除种子外未见其他写入点（未在代码中确认）**，当前没有维护本表的管理端接口。
- **备注**：读方为 `backend/src/host/pep.ts` 的 `authorizedSenderBrand()`（用 `brand` / `account_type` / `status` / `shared_with` 判定挂载邮箱能否作为发件箱，见 BIZ-04）、`backend/src/host/mail-memory.ts`（取品牌与负责人）、`backend/src/starrykol/service.ts` 的 `email_mailbox_list`（把本表行并入远端邮箱列表返回 `mailbox_owners` 与 `list`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `email` | TEXT | 主键 | 邮箱地址 | 品牌／员工邮箱地址（小写）；种子值为 `kol.lt@litime.example`、`kol.ro@renogy.example`、`kol.pq@powerqueen.example`、`marketing.de@litime.com`、`amperetimemarketing.de@gmail.com`。 |
| `brand` | TEXT | 非空 | 品牌代码 | 枚举由 `normalizeBrandCode()` 收窄为 `LT` / `RO` / `PQ`（别名 `LITIME` → `LT`、`RENOGY` → `RO`、`POWERQUEEN` / `POWER QUEEN` → `PQ`）。 |
| `owner_name` | TEXT | 非空 | 负责人姓名 | 该邮箱归属人；共用箱场景下用于比对「本人是否是 owner」。 |
| `dept` | TEXT | 可空 | 部门 | 部门名，种子值为「推广部」。 |
| `account_type` | TEXT | 可空 | 账号类型 | 枚举 `personal`（个人箱）/ `shared`（共用箱）；`shared` 时要求本人姓名等于 `owner_name` 或出现在 `shared_with` 中。 |
| `status` | TEXT | 可空 | 状态 | 仅 `active` 视为可用；`pep.ts` 中 `String(status \|\| "active") !== "active"` 即拒绝该邮箱，故未填等同 `active`。 |
| `shared_with` | TEXT | 可空 | 共用人 | 共用箱的另一个使用人姓名，与 `owner_name` 一起构成可使用者集合。 |
| `permission_scope` | TEXT | 可空 | 权限范围 | 给人看的中文范围说明（如「LT品牌往来邮件」）；代码中未参与判定（未在代码中确认）。 |
| `notes` | TEXT | 可空 | 备注 | 自由文本备注，如「主要红人建联邮箱」「两个邮箱两个人都在用」；不参与判定。 |

---

## 七、分组 5：KOL 主数据·协作·阶段（12 张表）

KOL 画像与关注索引、会话摘要、抓取到的创作者与快照、阶段转移留痕、寄样与企微卡片。

### kol_profile_index — KOL 公海正式档案（A 表）

- **用途**：KOL 记忆三表之一（A 表，公海正式档案）。存放从 Starry 远端档案、爬虫发现导入或人工录入得到的「公开资料 + 当前是否在公海 + Jev 评分」；`pool_status='open'` 的行构成工作台公海池，被领取后转 `claimed` 退出公海。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(company_id, kol_uid)` —— 同公司同红人编号只允许一行，`ON CONFLICT(company_id, kol_uid)` 是唯一 upsert 入口。
- **关键索引**：无显式索引（仅有主键与 `UNIQUE(company_id, kol_uid)` 的隐式索引）；按 `kol_uid` 查询靠该唯一索引，按公海列表查询是 `pool_status='open'` 的全表扫描。
- **写入方**：`backend/src/host/kol-memory.ts` 的 `upsertPublicProfile()` / `ingestFormalProfile()`（合并写入的唯一入口）；调用它的有 `backend/src/host/kol-memory-sync.ts`（Starry 档案同步）、`backend/src/host/discovery-ingest.ts`（AI 发现导入，`pool_status='open'`）、`backend/src/discovery.ts`（跨库导入正式档案）。字段级更新：`backend/src/host/kol-jev-assessment.ts`（Jev 潜力/风险评分）、`backend/src/host/kol-avatar-enrichment.ts`（公开头像抓取）。状态翻转：同一文件的 `claimFollow()`（→`claimed`）、`applyFollowRelease()`（→`open`）、`deleteProfilesWithoutHomepage()`（删除）。路由层在 `backend/src/routers/kol-memory.ts`。DDL 见 `backend/migrations/007_kol_memory.sql`，后补列见 `backend/migrations/015`、`016` 与 `backend/src/db.ts` 的 `migrateSchema()`。
- **备注**：行级权限口径为「公司层面共享、公海可见」，敏感字段（email/quote/contract/notes 等）在返回前端前由 `trimPrivate()` 剥离。删除只允许「公海 + 无主页 + 无 active follow」的行，且必须带 `expected_count` 预览核对。Jev 评分是显式批量动作（上限 12 条），无定时调度；`assessed_at` 为空表示「未评分」，有 `assessment_error` 表示评分失败。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 档案行 ID | 行唯一标识，新建时用 `nid("kpi")` 生成，重名冲突按 `(company_id, kol_uid)` 复用旧行。 |
| `company_id` | TEXT | 非空 | 所属公司 ID | 组织隔离键，代码常量默认 `company:amperetime`（`memoryCompanyId()`）。 |
| `kol_uid` | TEXT | 非空 | 红人编号 | 业务主键，与 `company_id` 组成唯一约束；来自 Starry `kolUid` 或爬虫稳定外部 ID。 |
| `handle` | TEXT | 可空 | 账号名 | 平台账号句柄，upsert 时为空串则不覆盖旧值。 |
| `display_name` | TEXT | 可空 | 展示名 | 展示用昵称；未传时回退 `handle`。 |
| `platform` | TEXT | 可空 | 平台 | 内容平台标识（爬虫平台集见 `backend/src/crawl/platforms.ts`）。 |
| `homepage_url` | TEXT | 可空 | 主页链接 | 公开主页地址；为空是「清理无主页档案」的判定条件之一。 |
| `followers` | TEXT | 可空 | 粉丝数 | 存字符串而非数字（远端口径为「万」，如 `82万`），统一映射见 `backend/src/starrykol/remote-metrics.ts`。 |
| `avg_plays` | TEXT | 可空 | 10 期均播 | 同样存字符串；远端字段 `avgVideoViews10`。 |
| `engagement` | TEXT | 可空 | 互动率 | 字符串形式的互动率，可能是远端真值或「均播/粉丝」代理值。 |
| `direction` | TEXT | 可空 | 内容方向 | 红人内容赛道/垂直方向，来自远端 `niche`。 |
| `region` | TEXT | 可空 | 受众地区 | 受众地区，取自远端受众地理分布占比最高项。 |
| `style` | TEXT | 可空 | 风格标签 | 跟进/内容风格标签，来自远端 `followStyleTags`。 |
| `ingest_source` | TEXT | 可空 | 摄取来源 | 写明数据从哪来；代码可见取值 `starry`（默认）、`starry.pageKolProfiles`、`ingest`、`crawler`。 |
| `ingested_at` | TEXT | 可空 | 首次摄取时间 | ISO 8601 字符串；upsert 时只在旧值为空时写入，之后不再刷新。 |
| `public_stage` | TEXT | 可空 | 公开阶段 | 展示用的合作阶段（远端阶段名/码或本地 `collaboration.stage_code`）；公海列表在 `release_reason='ownership-release'` 时显示为「14天无回复」。 |
| `pool_status` | TEXT | 非空，默认 `'open'` | 公海状态 | 枚举：`open`（公海可领取）/ `claimed`（已被领取）；由 `claimFollow()` 与 `applyFollowRelease()` 翻转。 |
| `idle` | INTEGER | 非空，默认 `0` | 空闲标记 | 0/1 布尔；领取时置 0，被释放回公海时置 1。 |
| `source_version` | TEXT | 可空 | 来源版本 | 同步批次标识，Starry 档案同步写入同步时刻 ISO 字符串。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，首行插入时写入，后续 upsert 不覆盖。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 upsert 或字段级更新都会刷新。 |
| `source_batch` | TEXT | 可空 | 来源批次 | 爬虫/发现导入的批次号，用于回溯一次导入写了哪些档案。 |
| `platform_creator_id` | TEXT | 可空 | 平台创作者 ID | 平台侧稳定创作者标识，用于与 `claw_creators` 的 `(platform, platform_creator_id)` 对齐。 |
| `avatar_url` | TEXT | 可空 | 头像链接 | 公开头像地址；由 `kol-avatar-enrichment.ts` 从主页 HTML 抓取，仅在已为空时写入。 |
| `avatar_checked_at` | TEXT | 可空 | 头像检查时间 | ISO 8601 字符串，每次头像抓取（成功或失败）都会刷新。 |
| `avatar_error` | TEXT | 可空 | 头像抓取错误 | 抓取失败原因，截断至 180 字；成功时写空串。 |
| `potential_score` | INTEGER | 可空 | 潜力分 | Jev 模型给出的 0–100 潜力分；>=80 记为高潜；为空表示未评分。 |
| `potential_confidence` | REAL | 可空 | 潜力置信度 | Jev 返回的 0–1 置信度。 |
| `risk_score` | INTEGER | 可空 | 风险分 | Jev 模型给出的 0–100 风险分；>=80 记为高风险。 |
| `risk_confidence` | REAL | 可空 | 风险置信度 | Jev 返回的 0–1 置信度。 |
| `assessment_model` | TEXT | 可空 | 评分模型 | 模型名，来自环境变量 `JEV_MODEL`，默认 `jev-1.13`。 |
| `assessment_version` | TEXT | 可空 | 评分口径版本 | 评分常量版本，当前为 `jev-kol-v1`。 |
| `assessed_at` | TEXT | 可空 | 评分时间 | ISO 8601 字符串；失败时也会写入，用于把失败行排到队尾不再优先重试。 |
| `assessment_error` | TEXT | 可空 | 评分错误 | 评分失败原因（截断 180 字）；成功时写空串。 |
| `assessment_criteria` | TEXT | 可空 | 评分口径摘要 | 本次评分使用的目标条件摘要（`criteriaSummary()` 生成）；空串表示按公开资料通用口径。 |
| `engagement_source` | TEXT | 可空 | 互动率来源 | 枚举：`remote`（远端真值）/ `view_follower_proxy`（均播÷粉丝的代理值）/ 空串（无）。 |
| `potential_probabilities` | TEXT | 可空 | 潜力概率分布 | JSON 字符串，Jev 返回的各潜力档位概率。 |
| `risk_probabilities` | TEXT | 可空 | 风险概率分布 | JSON 字符串，Jev 返回的各风险档位概率。 |

### kol_follow_index — KOL 跟进关系（B 表）

- **用途**：KOL 记忆三表之二（B 表），记录「哪个员工在哪个品牌范围内独家跟进哪个红人」。是跟进归属、14 天无回复释放、有效往来时钟的权威事实源。
- **主键 / 唯一约束**：`id`（主键）；部分唯一索引 `kol_follow_index_active_uniq(company_id, kol_uid, scope_brand) WHERE status='active'` —— 同公司同红人同品牌同时最多一条 active。
- **关键索引**：`kol_follow_index_employee(employee_id, status)` —— 「我的跟进」列表；`kol_follow_index_active_uniq` 见上。
- **写入方**：`backend/src/host/kol-memory.ts` 的 `claimFollow()`（领取，写 active）、`applyFollowRelease()`（释放，写 `status='released'`）、`recordEffectiveCorrespondence()`（刷新有效往来时钟）、`recordFollowedMailMemory()` 的调用链。定时/自动释放经 `backend/src/gateway/ownership-release.ts` 调 `applyFollowRelease()`；路由在 `backend/src/routers/kol-memory.ts`。DDL 见 `backend/migrations/007_kol_memory.sql`。
- **备注**：领取动作本身**不等于**有效往来 —— 新建时 `last_effective_mail_at`/`release_due_at` 均为 NULL；缺 `last_effective_mail_at` 时释放任务一律 skip，卡片不显示倒计时。只有「网关成功 + 方向为 in/outbound + 人类回复」才算有效往来（自动回复/退信/投递失败不续期）。释放只改 B/A，不改正式阶段。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 跟进 ID | 行标识，领取时用 `nid("kfi")` 生成。 |
| `company_id` | TEXT | 非空 | 所属公司 ID | 组织隔离键，默认 `company:amperetime`。 |
| `kol_uid` | TEXT | 非空 | 红人编号 | 指向 `kol_profile_index.kol_uid`（无外键约束，逻辑关联）。 |
| `scope_brand` | TEXT | 非空 | 跟进品牌范围 | 独家范围键（如 `LT`/`RO`/`PQ`）；未显式指定时取员工第一个品牌，兜底 `LT`。 |
| `employee_id` | TEXT | 非空 | 跟进员工 ID | 归属人；只有本人或 admin 能释放。 |
| `employee_name` | TEXT | 可空 | 跟进员工姓名 | 冗余展示名，领取时写入。 |
| `status` | TEXT | 非空，默认 `'active'` | 状态 | 枚举：`active`（有效跟进）/ `released`（已释放）。 |
| `claimed_at` | TEXT | 非空 | 领取时间 | ISO 8601 字符串；明确**不是**有效往来时间。 |
| `last_effective_mail_at` | TEXT | 可空 | 最近有效往来时间 | ISO 8601 字符串；只有网关成功的人类往来才刷新；为 NULL 时释放任务 skip。 |
| `release_due_at` | TEXT | 可空 | 释放到期时间 | ISO 8601 字符串，= `last_effective_mail_at` + 14 天（`FOLLOW_IDLE_DAYS`）。 |
| `released_at` | TEXT | 可空 | 释放时间 | ISO 8601 字符串，`applyFollowRelease()` 写入。 |
| `release_reason` | TEXT | 可空 | 释放原因 | 代码可见取值：`manual_release`（人工释放，默认）/ `ownership-release`（超时自动释放）。 |
| `collaboration_id` | TEXT | 可空 | 关联合作 ID | 领取时尽量按 `kol_uid + brand` 解析出的 `collaborations.id`；解析不到为 NULL。 |
| `data_version` | INTEGER | 非空，默认 `1` | 数据版本 | 乐观锁/审计计数；领取后每次刷新或释放 +1。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次变更刷新。 |

### kol_thread_summary — KOL 往来摘要（C 表）

- **用途**：KOL 记忆三表之三（C 表），按「跟进关系 + 会话」保存邮件往来摘要，供工作台右栏直接读取本地已观测到的沟通结果，不需要实时回远端拉取。
- **主键 / 唯一约束**：`id`（主键）。业务上是 `(follow_id, conversation_id)` 幂等 upsert（代码用先查后写实现，**没有**数据库唯一约束）。
- **关键索引**：`kol_thread_summary_follow(follow_id, effective)` —— 按跟进关系取有效/全部往来。
- **写入方**：`backend/src/host/kol-memory.ts` 的 `upsertThreadSummary()`；调用方为 `recordFollowedMailMemory()`（网关发送回执/邮箱同步的增量落库）与 `backend/src/host/kol-memory-sync.ts`（Starry 会话分页同步）。
- **备注**：`effective` 只标注这条往来是否算「有效人类往来」，与 `kol_follow_index.last_effective_mail_at` 的判定口径一致。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 摘要 ID | 行标识，用 `nid("kts")` 生成。 |
| `company_id` | TEXT | 非空 | 所属公司 ID | 组织隔离键，默认 `company:amperetime`。 |
| `follow_id` | TEXT | 非空 | 跟进 ID | 指向 `kol_follow_index.id`（无外键约束）。 |
| `kol_uid` | TEXT | 非空 | 红人编号 | 冗余字段，来自所属 follow。 |
| `conversation_id` | TEXT | 可空 | 会话 ID | 远端会话标识；调用方未提供时生成 `local:{direction}:{occurredAt}`。 |
| `subject` | TEXT | 可空 | 邮件主题 | 会话主题。 |
| `participants` | TEXT | 可空 | 参与方 | 收件邮箱/信箱邮箱等参与标识。 |
| `time_range` | TEXT | 可空 | 时间范围 | 会话覆盖的时间区间（由同步方给出，可为空）。 |
| `last_at` | TEXT | 可空 | 最近消息时间 | ISO 8601 字符串，会话最近一条消息的时间。 |
| `effective` | INTEGER | 非空，默认 `0` | 是否有效往来 | 0/1；1 表示网关成功且方向合法的真实人类往来。 |
| `key_agreements` | TEXT | 可空 | 关键共识 | 正文预览（`mailPreview()` 截断后的摘要）。 |
| `open_questions` | TEXT | 可空 | 未决问题 | 待确认问题（同步路径当前未写值，`recordFollowedMailMemory` 传空串）。 |
| `next_step` | TEXT | 可空 | 下一步 | 下一步动作（同步路径当前未写值，传空串）。 |
| `mail_refs` | TEXT | 可空 | 邮件引用 | 指向源邮件的引用，增量写入时等于 `conversation_id`。 |
| `source_version` | TEXT | 可空 | 来源版本 | 写明来源；增量路径写 `local.increment`，同步路径写同步时刻 ISO 字符串。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 upsert 刷新。 |

### claw_creators — 爬虫创作者库（Claw 适配）

- **用途**：MediaCrawler 采集结果归一化后的「创作者主档」，是发现候选与评分快照的宿主对象；也作为发现流程按平台查候选的来源。
- **主键 / 唯一约束**：`id`（主键）；部分唯一索引 `claw_creators_platform_identity(platform, platform_creator_id) WHERE platform_creator_id IS NOT NULL`。
- **关键索引**：`claw_creators_platform_identity`（见上）。
- **写入方**：`backend/src/adapters/claw.ts` 的 `ingestMediacrawler()`（存在则 UPDATE、不存在则 INSERT，`creatorId = cr_{platform}_{base64url(id)}`）与 `createCreator()`;状态单改在 `patchStatus()`（经 `backend/src/adapters/httpMount.ts` 的 `PATCH /api/v1/creators/:cid/status` 暴露）。DDL 见 `backend/migrations/002_mediacrawler.sql` 与 `backend/src/db.ts`。
- **备注**：本表不含时间戳列（无 `created_at`/`updated_at`），只能通过 `creator_snapshots.created_at` 或 `payload` 推断时间。`payload` 保存整条原始采集项，读取时被展开合并到返回对象上。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 创作者 ID | 形如 `cr_{platform}_{safeId}`，或调用方显式传入的 id。 |
| `handle` | TEXT | 可空 | 账号名 | 采集项昵称；更新时写为 `nickname`。 |
| `name` | TEXT | 可空 | 名称 | 与 `handle` 同为昵称（代码用同一值写入）。 |
| `platform` | TEXT | 可空 | 平台 | 小写平台标识，必须在 `CRAWL_PLATFORM_SET` 内，否则该条被计为 rejected。 |
| `platform_creator_id` | TEXT | 可空 | 平台创作者 ID | 平台侧稳定标识（取 `platform_creator_id`/`creator_id`/`user_id`/`sec_uid`/`id`），唯一索引的组成列。 |
| `followers` | INTEGER | 可空 | 粉丝数 | 非负整数，非法或负数归一为 0。 |
| `score` | REAL | 可空 | 创作者评分 | `calculateCreatorScore()` 算出的 0–100 分（粉丝分 + 均播分 + 比值分 + 稳定性 + 样本置信度）。 |
| `status` | TEXT | 可空 | 状态 | 摄取与更新写死 `'discovered'`；`patchStatus()` 可写任意调用方值，**未在代码中限定枚举**。 |
| `outreach_script` | TEXT | 可空 | 建联话术 | 外联脚本；摄取新建时写空串。 |
| `payload` | TEXT | 可空 | 原始载荷 | JSON 字符串，保存整条采集项加平台/昵称/粉丝/近期播放/采集时间/source/task_id/score_details。 |

### creator_candidates — AI 发现候选

- **用途**：一次 AI 发现运行（MediaCrawler）产出的候选创作者，供员工在自己私域里「忽略 / 关注」；只有员工确认关注才会创建合作与正式档案，采集完成本身不写阶段、不发信。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(request_id, platform, platform_creator_id)` —— 同一请求内同平台同创作者只一条。
- **关键索引**：`creator_candidates_run(run_id, status)` —— 按运行列出/统计候选；`creator_candidates_owner_status(owner_user_id, status, score)` —— 按属主取候选并排序。
- **写入方**：`backend/src/discovery.ts` 与 `backend/src/home-discovery.ts` 的候选落库（同一套 `INSERT ... status='suggested'` / `UPDATE` upsert 逻辑）；状态流转在同一文件：`status='followed'`（员工确认关注，同时绑定 `collaboration_id`、写 `followed_at`）、`status='dismissed'`（忽略，写 `dismissed_at`）。DDL 见 `backend/migrations/004_ai_discovery.sql`，后补列见 `backend/migrations/009_home_discovery.sql`。
- **备注**：`creator_candidates.run_id`/`request_id` 有外键且 `ON DELETE CASCADE`（删除请求或运行会连带删候选）。候选只是建议，不代表已建联，也不是事实源。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 候选 ID | 行标识，用 `nid("cand")` 生成。 |
| `request_id` | TEXT | 非空 | 发现请求 ID | 外键 → `discovery_requests.id`，级联删除。 |
| `run_id` | TEXT | 非空 | 发现运行 ID | 外键 → `discovery_runs.id`，级联删除。 |
| `owner_user_id` | TEXT | 非空 | 属主用户 ID | 候选归属员工，决定可见范围。 |
| `platform` | TEXT | 非空 | 平台 | 采集平台标识。 |
| `platform_creator_id` | TEXT | 非空 | 平台创作者 ID | 平台侧稳定标识，与 `platform`、`request_id` 组成唯一约束。 |
| `claw_creator_id` | TEXT | 可空 | 创作者库 ID | 指向 `claw_creators.id`（无外键约束），可能为空。 |
| `handle` | TEXT | 可空 | 账号名 | 展示用句柄。 |
| `nickname` | TEXT | 可空 | 昵称 | 展示用昵称。 |
| `followers` | INTEGER | 非空，默认 `0` | 粉丝数 | 采集到的粉丝数。 |
| `score` | REAL | 非空，默认 `0` | 候选评分 | 采集评分，用于排序。 |
| `signals` | TEXT | 非空，默认 `'{}'` | 信号 | JSON 字符串，采集/归一化得到的判断信号（如地区等）。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 原始载荷 | JSON 字符串，保留采集原始字段（含 avatar_url 等）。 |
| `status` | TEXT | 非空，默认 `'suggested'` | 状态 | 枚举：`suggested`（待处理）/ `followed`（已关注）/ `dismissed`（已忽略）。 |
| `collaboration_id` | TEXT | 可空 | 关联合作 ID | 确认关注时写入的合作记录 ID。 |
| `dismissed_at` | TEXT | 可空 | 忽略时间 | ISO 8601 字符串，首次忽略时用 `COALESCE` 写入，之后不覆盖。 |
| `followed_at` | TEXT | 可空 | 关注时间 | ISO 8601 字符串，首次关注时用 `COALESCE` 写入。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串。 |
| `order_index` | INTEGER | 可空 | 排序序号 | 保留的展示顺序（home 发现路径写入，legacy 路径可空）。 |
| `metrics_missing` | INTEGER | 非空，默认 `0` | 指标缺失标记 | 0/1，1 表示该候选缺公开指标，评分参考价值低。 |
| `avg_views_10` | REAL | 可空 | 10 期均播 | 数值形式的近 10 期平均播放，供排序与导入 `avg_plays` 使用。 |

### creator_snapshots — 创作者采集快照

- **用途**：每次 MediaCrawler 摄取为每条创作者留一份历史快照（含近期播放与评分明细），用于回溯指标随时间的变化、并作为爬虫服务读取「最新指标」的来源。
- **主键 / 唯一约束**：`id`（主键）。无业务唯一约束，同一创作者每次摄取新增一行。
- **关键索引**：`creator_snapshots_creator(creator_id, created_at)` —— 取某创作者的最新快照 / 历史趋势。
- **写入方**：`backend/src/adapters/claw.ts` 的 `ingestMediacrawler()`，每条 accepted 项末尾插入一行；读取方见 `backend/src/crawl/service.ts`（按 `created_at DESC LIMIT 1` 取最新）。DDL 见 `backend/migrations/002_mediacrawler.sql`。
- **备注**：`creator_id` 外键 `ON DELETE CASCADE`（删创作者连带删快照），`crawl_job_id` 外键 `ON DELETE SET NULL`（删采集作业保留快照）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 快照 ID | 行标识，用 `nid("snap")` 生成。 |
| `creator_id` | TEXT | 非空 | 创作者 ID | 外键 → `claw_creators.id`，级联删除。 |
| `ingestion_batch_id` | TEXT | 可空 | 摄取批次 ID | 指向 `ingestion_batches.id`（无外键约束），标记本次快照属于哪批。 |
| `crawl_job_id` | TEXT | 可空 | 采集作业 ID | 外键 → `crawl_jobs.id`，`ON DELETE SET NULL`。 |
| `platform` | TEXT | 非空 | 平台 | 采集平台标识。 |
| `platform_creator_id` | TEXT | 非空 | 平台创作者 ID | 平台侧稳定标识。 |
| `nickname` | TEXT | 非空 | 昵称 | 采集时的昵称。 |
| `followers` | INTEGER | 非空，默认 `0` | 粉丝数 | 采集时的粉丝数。 |
| `recent_views` | TEXT | 非空，默认 `'[]'` | 近期播放 | JSON 数组字符串，最多保留最近 10 期播放量。 |
| `score` | REAL | 非空，默认 `0` | 评分 | 本次快照的创作者评分。 |
| `score_details` | TEXT | 非空，默认 `'{}'` | 评分明细 | JSON 字符串，`calculateCreatorScore()` 的完整返回（样本量、中位数、均值、播粉比、稳定性、置信度）。 |
| `source` | TEXT | 可空 | 来源 | 摄取来源，默认 `mediacrawler`（截断 120 字）。 |
| `task_id` | TEXT | 可空 | 远端任务 ID | MediaCrawler 侧任务标识。 |
| `collected_at` | TEXT | 非空 | 采集时间 | ISO 8601 字符串，来自采集项的 `collected_at`，非法则回退摄取时刻。 |
| `created_at` | TEXT | 非空 | 落库时间 | ISO 8601 字符串，摄取写入时刻。 |

### ingestion_batches — 摄取批次台账

- **用途**：每次 MediaCrawler 摄取写一条批次台账，记录该批收了多少、新增多少、更新多少、拒收多少，用于对账与审计。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/adapters/claw.ts` 的 `ingestMediacrawler()` 事务末尾插入一行；同时写审计事件 `claw.ingest.mediacrawler`。DDL 见 `backend/migrations/002_mediacrawler.sql`。
- **备注**：本表只追加不修改。`crawl_job_id` 外键 `ON DELETE SET NULL`，删除采集作业不会删批次台账。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 批次 ID | 行标识，用 `nid("ing")` 生成。 |
| `source` | TEXT | 非空 | 来源 | 摄取来源，默认 `mediacrawler`（截断 120 字）。 |
| `task_id` | TEXT | 可空 | 远端任务 ID | 取自 `task_id`/`remote_task_id`。 |
| `crawl_job_id` | TEXT | 可空 | 采集作业 ID | 外键 → `crawl_jobs.id`，`ON DELETE SET NULL`。 |
| `accepted` | INTEGER | 非空 | 接收条数 | 通过平台/ID/昵称校验并成功写入的条数。 |
| `inserted` | INTEGER | 非空 | 新增条数 | 本次新建的 `claw_creators` 行数。 |
| `updated` | INTEGER | 非空 | 更新条数 | 本次命中原有创作者并更新其指标的行数。 |
| `rejected` | INTEGER | 非空 | 拒收条数 | 非对象、平台不在白名单、缺平台 ID 或缺昵称而被跳过的条数。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，摄取写入时刻。 |

### retention_policy — 数据留存策略（单行配置）

- **用途**：企业治理配置，保存会话数据与审计数据的保留天数；由管理员在后台调整。
- **主键 / 唯一约束**：`id`（主键），且有 `CHECK (id = 1)` —— 全表只允许一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：初始化用 `INSERT OR IGNORE ... VALUES (1,365,730,?)`（见 `backend/src/db.ts` 的 `migrateSchema()`）；修改在 `backend/src/routers/enterprise.ts` 的 `PATCH /admin/retention-policy`（仅管理员，天数必须为正，并写审计 `admin.retention.update`）。读取在 `GET /admin/retention-policy`。
- **备注**：本表是配置而非业务事实源；写入不会自动清理历史数据，只作为留存口径的记录。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER | 主键，非空（`CHECK (id = 1)`） | 固定行 ID | 常量 1，用于保证单行配置。 |
| `session_days` | INTEGER | 非空，默认 `365` | 会话保留天数 | 会话数据保留天数，管理员可改，必须 ≥ 1。 |
| `audit_days` | INTEGER | 非空，默认 `730` | 审计保留天数 | 审计数据保留天数，管理员可改，必须 ≥ 1。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次修改刷新。 |

### stage_transitions — 正式阶段转移记录（不可变合规记录）

- **用途**：每一次正式合作阶段转移的完整记录：从哪个阶段到哪个阶段、依据什么理由码和证据、由谁推荐、由谁批准、转移前后数据版本与推进模式。是阶段变更的审计事实源。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `collaboration_id` / `lifecycle_id` 查询为全表扫描。
- **写入方**：`backend/src/adapters/starry.ts` 的 `confirmStage()`（唯一插入点，与 `collaborations.stage_code` 更新、`starry_stage_writes` 插入在同一事务）；宿主侧唯一调用链为 `backend/src/host/api.ts` 的 confirm-stage → `backend/src/gateway/starry.ts` → `backend/src/adapters/clients.ts`。读取在 `backend/src/routers/misc.ts` 的 `GET /stage-transitions` 与 `backend/src/starrykol/library-sync.ts`（回读已记录阶段）。
- **备注**：有 `BEFORE UPDATE` 与 `BEFORE DELETE` 触发器，命中即 `RAISE(ABORT,'stage_transitions are immutable')` —— 本表只能插入，不能修改或删除（`backend/src/seed.ts` 在重置演示数据时会临时 DROP 触发器再重建）。`from_stage`/`to_stage` 取值即 15 个正式阶段码加侧边码 `PAUSED`/`LOST`/`REJECTED`/`CANCELLED`/`DISPUTED`/`COMPLETED`（见 `backend/src/stages.ts` 与 [stage-transitions.json](../config/stage-transitions.json)）；发送邮件不写本表，不推进阶段。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 转移记录 ID | 行标识，用 `nid("trn")` 生成。 |
| `collaboration_id` | TEXT | 非空 | 合作记录 ID | 指向 `collaborations.id`（无外键约束）。 |
| `lifecycle_id` | TEXT | 非空 | 生命周期 ID | Starry 侧生命周期标识，写阶段用。 |
| `from_stage` | TEXT | 非空 | 原阶段码 | 转移前阶段，写入前已经过 `normalizeStage()` 归一。 |
| `to_stage` | TEXT | 非空 | 目标阶段码 | 转移后阶段码，取自正式阶段集合。 |
| `reason_code` | TEXT | 非空 | 理由码 | 代码可见取值：`HUMAN_CONFIRMED`（人工确认；带跳过时为 `HUMAN_SKIP`）、`EXTERNAL_FACT`（Starry 适配层默认）、`FINANCE_APPROVED`（付款事实）。 |
| `evidence` | TEXT | 非空 | 证据 | JSON 字符串，形如 `{reason, source:"workbench"}`，或调用方传入的结构化证据。 |
| `recommender` | TEXT | 非空 | 推荐者 | 推荐来源；人工确认为 `Commander`，自动事实路径为 `fact_advance`。 |
| `approver` | TEXT | 非空 | 批准者 | 批准人句柄，默认当前登录用户 `handle`。 |
| `occurred_at` | TEXT | 非空 | 发生时间 | ISO 8601 字符串，未传时取当前时刻。 |
| `data_version_before` | INTEGER | 非空 | 变更前数据版本 | 对应 `collaborations.stage_version` 的旧值，用于乐观锁校验。 |
| `data_version_after` | INTEGER | 非空 | 变更后数据版本 | 写入成功后的新版本，等于旧值 + 1。 |
| `capability_profile` | TEXT | 非空 | 能力域 | 目标阶段所属能力域（`Lead`/`Opportunity`/`Negotiation`/`Execution`/`Settlement-Growth`），缺失时写 `Commander`。 |
| `advancement_mode` | TEXT | 非空 | 推进模式 | 目标阶段的推荐推进模式（如「必须审批」「事实触发」「旁路」「终态」等，见 `backend/src/stages.ts`）。 |

### starry_sends — Starry 外发邮件留痕

- **用途**：在 Starry 适配层记录一次会话发信的信封与正文快照，用于演示/适配层对账；正式外发必须走网关并先落发送回执（`mail_send_confirmation`），本表只是适配层的写记录。
- **主键 / 唯一约束**：`id`（主键，`INTEGER` + `AUTOINCREMENT`）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/adapters/starry.ts` 的 `sendConversation()`；`stub` 模式下由 `backend/src/gateway/send.ts` 的 `sendDraft()` 调用（真实 `codex` 模式走远期任务，不落本表）。
- **备注**：本表**不**承载「已发送」的业务事实 —— 发送状态以 `mail_send_*` 回执为准。写本表不会推进阶段。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER | 主键，非空（AUTOINCREMENT） | 自增 ID | 数据库自增主键。 |
| `conversation_id` | TEXT | 非空 | 会话 ID | 目标会话标识；草稿无会话时形状为 `conv_{draftId}`。 |
| `from_addr` | TEXT | 可空 | 发件地址 | 发件邮箱，取自 `from`/`from_addr`。 |
| `to_addr` | TEXT | 可空 | 收件地址 | 收件邮箱，取自 `to`/`to_addr`。 |
| `cc` | TEXT | 可空 | 抄送 | 抄送字符串，缺省为空串。 |
| `subject` | TEXT | 可空 | 主题 | 邮件主题，缺省为空串。 |
| `body` | TEXT | 可空 | 正文 | 正文，取 `body`/`html`，缺省为空串。 |
| `ts` | TEXT | 非空 | 写入时间 | ISO 8601 字符串，写入时取当前时刻。 |

### starry_stage_writes — Starry 阶段写入流水

- **用途**：适配层每次向 Starry 写阶段时的轻量流水（生命周期 + 阶段码 + 执行者 + 时刻），用于迁移归一与「最近一次写入」诊断；正式合规记录在 `stage_transitions`。
- **主键 / 唯一约束**：`id`（主键，`INTEGER` + `AUTOINCREMENT`）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/adapters/starry.ts` 的 `confirmStage()`（与 `stage_transitions` 同事务插入）；另外 `backend/src/db.ts` 的 `migrateSchema()` 会执行一次 `UPDATE ... SET stage_code=? WHERE stage_code=?` 把历史旧阶段码归一为现行码（见 `backend/src/stages.ts` 的 `LEGACY_STAGE_ALIASES`）。读取在 `backend/src/starrykol/library-sync.ts`。
- **备注**：本表没有唯一约束，同一 lifecycle 可有多行；判断「当前阶段」需 `ORDER BY ts DESC, id DESC` 取最新一行。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER | 主键，非空（AUTOINCREMENT） | 自增 ID | 数据库自增主键。 |
| `lifecycle_id` | TEXT | 非空 | 生命周期 ID | Starry 生命周期标识。 |
| `stage_code` | TEXT | 非空 | 阶段码 | 本次写入的阶段码（已归一为现行阶段码）。 |
| `actor` | TEXT | 可空 | 执行者 | 发起写入的执行者，宿主路径为 `host`。 |
| `ts` | TEXT | 非空 | 写入时间 | ISO 8601 字符串，写入时用转移的 `occurred_at`。 |

### wecom_cards — 企业微信审批卡片

- **用途**：审批流程中的卡片快照：审批标题、当前卡片正文、卡片状态与当前处理人。与 `approvals` 一一对应（卡片 ID 与审批 ID 同值），用于工作台展示审批卡片与投影审批详情。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `approval_id` 更新是全表扫描。
- **写入方**：`backend/src/gateway/wecom.ts` 的 `createWorkApproval()`（与 `approvals` 行同事务插入，初始 `status='waiting'`）；同一文件的状态推进写 `status='forwarded'`（转下一级审批人）、`status='rejected'`（驳回）、`status='sent'`（审批通过并消费）。读取在 `listWecomCards()` 与审批详情投影。删除见 `backend/src/seed.ts`（重置演示数据）。
- **备注**：`approval_id` 指向 `approvals.id`（无外键约束）；审批种类 `kind` 取值 `expense`/`stage`/`content`/`settlement`（见 `backend/src/stages.ts` 的 `WorkApprovalKind`），它存在 `payload` 里而非独立列。本表是审批队列的展示快照，不是审批权威状态（权威状态在 `approvals.status`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 卡片 ID | 与审批 ID 同值（`nid("appr")`）。 |
| `approval_id` | TEXT | 非空 | 审批 ID | 指向 `approvals.id`。 |
| `title` | TEXT | 可空 | 卡片标题 | 形如「{审批种类} · {申请人或品牌}」或调用方传入的标题。 |
| `body` | TEXT | 可空 | 卡片正文 | 由 `approvalNotice()` 生成的中文通知文案，随状态推进重写。 |
| `status` | TEXT | 非空 | 卡片状态 | 枚举：`waiting`（待处理）/ `forwarded`（已转交下一级）/ `rejected`（已驳回）/ `sent`（已通过并消费）。 |
| `assignee` | TEXT | 可空 | 当前处理人 | 当前审批链节点上的处理人姓名，转交时更新。 |
| `payload` | TEXT | 非空 | 卡片载荷 | JSON 字符串，含 `approval_id`/`chain_id`/`kind`/`brand`/`amount_usd`/`chain`/`assignee`/`draft_id` 等，转交时重写为新处理人信息。 |
| `ts` | TEXT | 非空 | 时间戳 | ISO 8601 字符串，创建或最近一次转交时刷新。 |

---

## 八、分组 6：采集与发现（7 张表）

MediaCrawler 采集作业与事件、AI 发现的请求/运行/记忆/入库回执。

### crawl_jobs — 采集作业

- **用途**：一次异步 MediaCrawler 采集的执行记录（媒体采集作业），承载“远程任务已启动 / 已停止 / 结果已就绪”等状态；AI发现（legacy 与 home 两条路径）与普通任务页的「启动采集」都复用它。采集是异步作业，必须有进度、取消、重试。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(idempotency_key)`（同一幂等键重复请求返回已存在作业并标 `duplicate: true`）；`UNIQUE ... WHERE` 的部分唯一索引 `crawl_jobs_one_active` 保证同一时刻全库最多一个活跃采集作业。
- **关键索引**：`crawl_jobs_one_active`（函数索引 `((1))`，仅覆盖活跃状态），是「同一时间只跑一个 MediaCrawler 采集任务」这条不变量的物理闸门；`idempotency_key` 的唯一约束另有隐式索引。
- **写入方**：`../backend/src/crawl/service.ts`（建行、远程状态轮询、完成/失败/停止、重试上传）；`../backend/src/routers/crawl.ts` 提供对应 HTTP 入口（`POST /tasks/:id/actions/start-crawl`、`stop-crawl`、`POST /admin/crawl-jobs/:id/retry-upload`），`../backend/src/discovery.ts` 与 `../backend/src/home-discovery.ts` 通过 `startCrawl` 间接写入。
- **备注**：`ON DELETE CASCADE` 到 `work_items`、`ON DELETE SET NULL` 到 `sessions`；`crawl_job_events`、`ingestion_batches`、`creator_snapshots` 通过 `crawl_job_id` 反向引用。进程重启后由 `restoreActiveCrawlJobs()` 恢复监控。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 采集作业 ID | `nid("crawl")` 生成，形如 `crawl_...`。 |
| `idempotency_key` | TEXT | 非空，唯一 | 幂等键 | 来自 HTTP `Idempotency-Key` 头或调用方生成；重复提交命中已有行并直接返回。 |
| `owner_user_id` | TEXT | 非空 | 发起人用户 ID | 发起该采集的员工；发现路径等于 `discovery_runs.owner_user_id`。 |
| `work_item_id` | TEXT | 非空，外键 → `work_items(id)` ON DELETE CASCADE | 承载任务 ID | 采集挂在哪个 Task 上；启动时同步把 `work_items.status` 置为 `running`，完成置 `waiting`，失败置 `failed`。 |
| `session_id` | TEXT | 外键 → `sessions(id)` ON DELETE SET NULL | 会话 ID | 可选；`session_id` 不存在时写入 NULL。home 发现路径会传入新会话，结果卡片回写该会话。 |
| `platform` | TEXT | 非空 | 平台代码 | 取值来自 `../backend/src/crawl/platforms.ts`：海外 `youtube`/`instagram`/`facebook`，另有遗留国内码 `xhs`/`dy`/`ks`/`bili`/`wb`/`tieba`/`zhihu`；非集合内值直接 400 `invalid_crawl_platform`。 |
| `mode` | TEXT | 非空 | 采集方式 | `search` / `detail` / `creator` 三选一，其他值 400 `invalid_crawl_mode`。 |
| `parameters` | TEXT | 非空 | 采集参数 | JSON 字符串。`search` 必填 `keywords`，`detail` 必填 `specified_ids`，`creator` 必填 `creator_ids`；缺必填项在启动前即被拒绝。 |
| `remote_task_id` | TEXT | 可空 | 远程任务 ID | `start_crawl` 返回的 `task_id`；为空时进程重启会把该作业判失败（`Process restarted before remote task id was persisted`）。 |
| `status` | TEXT | 非空 | 作业状态 | 本仓库代码写入：`queued`（已排队，尚未拿到远程任务号）、`crawling`、`analyzing`（拉取并写入达人库中）、`result_ready`（结果卡片已生成）、`error`、`stopping`、`stopped`；轮询时还会把远程活跃状态归一化为 `queued`/`uploading`/`analyzing`/`crawling`。活跃集合（索引谓词与 `ACTIVE` 常量）为 `queued,crawling,uploading,analyzing,starting,running,stopping`。 |
| `upload_error` | TEXT | 可空 | 上传失败原因 | 远程「自动上传创作者数据」失败的脱敏文本；远程状态为 error/failed 但仅上传失败时，Host 会改用 `get_creators` 主动拉取并清空该字段。 |
| `error` | TEXT | 可空 | 失败原因 | 失败时经 `persistableEmployeeError` + `sanitize` 处理后的员工可读文案（脱敏 Bearer/token，截断 1000 字符）；成功时不写。 |
| `data_version` | INTEGER | 非空，默认 1 | 数据版本 | 乐观并发/变更计数，每次字段更新 `data_version+1`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`）。 |
| `started_at` | TEXT | 可空 | 远程启动时间 | 拿到 `remote_task_id` 时写入；建行到远程启动之间的失败可能保持 NULL。 |
| `last_checked_at` | TEXT | 可空 | 最近轮询时间 | 每次 `get_crawl_status` 轮询后写入。 |
| `updated_at` | TEXT | 非空 | 更新时间 | 任何状态变更都刷新。 |
| `completed_at` | TEXT | 可空 | 完成时间 | 仅在 `result_ready`、`error`、`stopped` 时写入。 |

### crawl_job_events — 采集作业事件

- **用途**：一次采集作业的时序日志流（排队、启动、远程操作、状态变化、日志片段、失败、结果就绪等），供任务页与 SSE 增量拉取（`after` 游标为 `sequence`）；每产生一条事件同时追加一条 `task_events`。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(crawl_job_id, sequence)`。
- **关键索引**：`crawl_job_events_job(crawl_job_id, sequence)`，支持按作业增量拉取（`sequence > ?` 且有序）。
- **写入方**：`../backend/src/crawl/service.ts` 的 `event()`（唯一写入口，内含 `MAX(sequence)+1` 的事务自增与 `sanitize` 脱敏）；读取在 `crawlEvents()` 与 `../backend/src/routers/crawl.ts` 的 `GET /tasks/:id/crawl-job/events`。
- **备注**：`ON DELETE CASCADE` 到 `crawl_jobs`，作业删除即级联清空；`summary` 被强制截断到 1000 字符且脱敏，事件里不得出现凭证。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 事件 ID | `nid("cev")` 生成。 |
| `crawl_job_id` | TEXT | 非空，外键 → `crawl_jobs(id)` ON DELETE CASCADE | 采集作业 ID | 所属作业。 |
| `sequence` | INTEGER | 非空 | 序号 | 作业内单调递增，写入时取 `COALESCE(MAX(sequence),0)+1`；与作业 ID 组成唯一键。 |
| `event_type` | TEXT | 非空 | 事件类型 | 代码写入值：`queued`、`started`、`operation`（远程调用开始/完成/失败）、`status`（远程状态快照）、`logs`（远程日志片段，最多末 20 行）、`analyzing`、`result_ready`、`upload_fallback`、`upload_retried`、`error`、`stopped`、`monitor_error`。 |
| `status` | TEXT | 非空 | 事件时状态 | 事件发生时的作业/阶段状态文本（如 `queued`、`crawling`、`analyzing`、`result_ready`、`error`）。 |
| `summary` | TEXT | 可空 | 摘要 | 脱敏后的事件说明（中文标签或远程原文），截断 1000 字符；同时作为 `task_events` 的摘要。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 事件负载 | JSON 字符串。`operation` 事件含 `operation`（如 `claw.start_crawl`、`host.ingest_creators`）、`label`、`operation_status`（`running`/`done`/`failed`）、`duration_ms`；`upload_fallback` 含 `upload_error`；`started` 含 `remote_task_id`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |

### discovery_requests — 发现请求（Brief）

- **用途**：员工提交的「AI发现」意图（关键词、平台、地区、内容方向、目标人数等），是发现流程的容器与 Brief 版本载体；一次请求可发起多次 `discovery_runs`（每次一个平台一次执行）。legacy 路径写入待确认态，home 路径直接进入采集。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：`discovery_requests_owner(owner_user_id, updated_at)`，支持按属主倒序列出。
- **写入方**：`../backend/src/discovery.ts`（`createDiscoveryRequest` 插入；`startDiscoveryRun`、`refreshRequestStatus` 更新状态与 `latest_run_id`）；`../backend/src/home-discovery.ts`（`startHomeDiscoveryRun` 插入，`updateRunStatus` 同步状态/错误）。读取方包括 `../backend/src/host/today-plan-context.ts`、`../backend/src/host/kol-scoring-criteria.ts`。
- **备注**：`scope` 为 `{"kind":"home"}` 时属于 home 路径，该路径禁止 follow 创建 Collaboration。`brief_version` 由 `../backend/src/db.ts` 的 `migrateSchema()`（约 L2057）追加，用于 L3 入库确认时的「Brief 已变化则作废确认」校验。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 发现请求 ID | `nid("dreq")` 生成。 |
| `owner_user_id` | TEXT | 非空 | 属主用户 ID | 发起员工；非管理员只能看到自己的请求。 |
| `keywords` | TEXT | 非空 | 关键词 | JSON 数组字符串，如 `["fitness"]`；`mode=search` 时至少一个，否则 400。 |
| `platforms` | TEXT | 非空 | 平台列表 | JSON 数组，仅允许海外 `youtube`/`instagram`/`facebook`；传空数组时落库为默认 `["youtube","instagram"]`（不代表「全部平台」）。 |
| `mode` | TEXT | 非空，默认 `'search'` | 采集方式 | `search` / `detail` / `creator`；非法值 400 `invalid_crawl_mode`。 |
| `filters` | TEXT | 非空，默认 `'{}'` | 筛选条件 | JSON。legacy 为 `{region,directions}`（`region` ∈ `all`/`us`/`ca`/`eu`/`au`/`na`/`sea`；`directions` 最多 8 个、每个 ≤30 字，旧字段 `niche` 会合并进 `directions`）；home 路径另含 `thresholds`（目标人数等）。 |
| `brand` | TEXT | 可空 | 品牌代码 | 可选品牌；follow 建 Collaboration 时缺省用 `LT`。 |
| `scope` | TEXT | 非空，默认 `'{}'` | 作用域 | JSON。home 路径写 `{"kind":"home"}`；legacy 路径为 `{}` 或调用方传入对象。 |
| `status` | TEXT | 非空，默认 `'open'` | 请求状态 | legacy 取值：`open`（待确认）、`running`、`succeeded`、`failed`、`cancelled`；home 取值：`queued`、`crawling`、`ranking`、`completed`、`crawl_failed`、`rank_failed`、`cancelled`（home 的状态由 run 直接同步而来）。 |
| `latest_run_id` | TEXT | 可空 | 最新运行 ID | 指向 `discovery_runs.id`；无外键约束，由代码维护。 |
| `error` | TEXT | 可空 | 错误信息 | 最新一次 run 的员工可读错误（`persistableEmployeeError`），成功后清空。 |
| `data_version` | INTEGER | 非空，默认 1 | 数据版本 | 变更计数，每次更新 +1。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | 任何状态或 Brief 变更时刷新。 |
| `brief_version` | INTEGER | 非空，默认 1 | Brief 版本 | Brief 版本号；L3 入库确认需携带 `expected_brief_version`，与当前值不一致则作废原确认并 409。 |

### discovery_runs — 发现运行

- **用途**：一次异步采集的执行实例（DiscoveryRun = 一次 MediaCrawler 执行，复用 `crawl_jobs`），记录该平台该次采集的排队、采集、候选写入与排名状态及候选计数。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(idempotency_key)`。
- **关键索引**：`discovery_runs_request(request_id, created_at)`，支持按请求倒序列出运行。
- **写入方**：`../backend/src/discovery.ts`（`startDiscoveryRun` 插入并回填 `crawl_job_id`/`remote_task_id`；`persistRunFromCrawl` 从作业同步状态；`upsertCandidatesFromJob` 写 `candidate_count`；失败分支写 `failed`）；`../backend/src/home-discovery.ts`（`startHomeDiscoveryRun` 插入、`startHomeCrawl` 回填作业、`persistFilteredCandidates` 写 `raw_count`/`candidate_count`、`updateRunStatus` 写 home 状态机、`retryHomeDiscoveryRun` 重置）。`../backend/src/routers/tasks.ts` 依据 `work_item_id + kind='home'` 反查运行。
- **备注**：外键 `request_id → discovery_requests(id) ON DELETE CASCADE`、`crawl_job_id → crawl_jobs(id) ON DELETE SET NULL`、`work_item_id → work_items(id) ON DELETE SET NULL`；`session_id`、`kind`、`brief_version`、`raw_count` 依次由 `../backend/migrations/009_home_discovery.sql`、`011_home_discovery_raw_count.sql` 与 `../backend/src/db.ts` 迁移（约 L2056）追加。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 运行 ID | `nid("drun")` 生成。 |
| `request_id` | TEXT | 非空，外键 → `discovery_requests(id)` ON DELETE CASCADE | 发现请求 ID | 所属请求；请求删除级联删运行。 |
| `owner_user_id` | TEXT | 非空 | 属主用户 ID | 取自请求的属主。 |
| `crawl_job_id` | TEXT | 外键 → `crawl_jobs(id)` ON DELETE SET NULL | 采集作业 ID | 关联的真实采集作业；作业删除后置空，home 重试时会先置 NULL。 |
| `work_item_id` | TEXT | 外键 → `work_items(id)` ON DELETE SET NULL | 承载任务 ID | legacy 与 home 都会创建容器任务；home 用它承载会话与事件。 |
| `platform` | TEXT | 非空 | 平台代码 | 单次运行只用一个平台；取自请求平台列表或调用方指定，必须在该请求的 `platforms` 内。 |
| `mode` | TEXT | 非空 | 采集方式 | 透传请求的 `mode`（`search`/`detail`/`creator`）。 |
| `parameters` | TEXT | 非空，默认 `'{}'` | 运行参数 | JSON。legacy：`{region,directions,keywords,brief_version}`；home：`{keywords,directions,region,thresholds,skill_contract?}`。 |
| `remote_task_id` | TEXT | 可空 | 远程任务 ID | 与 `crawl_jobs.remote_task_id` 同步。 |
| `idempotency_key` | TEXT | 非空，唯一 | 幂等键 | legacy 形如 `disc:<requestId>:<platform>:<nid>`，home 形如 `home:<requestId>:<platform>:<nid>`；重复提交返回已存在运行并标 `duplicate:true`。 |
| `status` | TEXT | 非空，默认 `'queued'` | 运行状态 | legacy：`queued`/`running`/`succeeded`/`failed`/`cancelled`（由作业状态 `runStatusFromCrawl` 映射）；home：`queued`/`crawling`/`ranking`/`completed`/`crawl_failed`/`rank_failed`/`cancelled`。 |
| `error` | TEXT | 可空 | 错误信息 | 失败原因（脱敏/员工可读）；home 失败时会拼接 Host 的 `next_action` 提示。 |
| `candidate_count` | INTEGER | 非空，默认 0 | 候选人数 | 本次运行写入/保留的 `creator_candidates` 数量（home 为过滤+截断后的数量）。 |
| `data_version` | INTEGER | 非空，默认 1 | 数据版本 | 变更计数，每次更新 +1。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `started_at` | TEXT | 可空 | 开始时间 | 关联作业开始或被同步时写入。 |
| `updated_at` | TEXT | 非空 | 更新时间 | 任何状态/计数变更时刷新。 |
| `completed_at` | TEXT | 可空 | 完成时间 | 终态（`succeeded`/`failed`/`cancelled`/`completed`/`crawl_failed`/`rank_failed`）时写入，重试时清空。 |
| `session_id` | TEXT | 可空 | 会话 ID | home 路径创建会话后写入（简报生成为该会话产物）。 |
| `kind` | TEXT | 非空，默认 `'legacy'` | 运行类型 | `legacy`（AI发现页旧路径）或 `home`（首页 AI发现一等流程，常量 `HOME_KIND="home"`，见 `../backend/src/home-discovery.ts`）。 |
| `brief_version` | INTEGER | 非空，默认 1 | Brief 版本 | 运行开始时的 Brief 版本；`briefVersionOf()` 依次回退到 `parameters.brief_version`、请求的 `brief_version`/`data_version`、最后 1。 |
| `raw_count` | INTEGER | 可空 | 原始候选数 | 仅 home：过滤前从采集快照读到的原始候选条数（legacy 路径保持 NULL）。 |

### discovery_memory_facts — 发现记忆事实

- **用途**：发现流程的运行事实与推断记录（不是第三套 A/B/C 记忆模型）。入职回执、Brief、审批结果等属事实，评分为推断；`public_sea` 可见性下会剥掉评分与私密字段。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：`discovery_memory_facts_object(company_id, object_type, object_id, kind)`，用于按对象拉取事实链。
- **写入方**：`../backend/src/host/discovery-facts.ts` 的 `recordDiscoveryFact()`（唯一写入口）；调用点包括 `../backend/src/discovery.ts`（`run_create`、`brief`、`crawl_idle`）与 `../backend/src/host/discovery-ingest.ts`（`ingest_receipt`、`approval_result`）。
- **备注**：只追加不更新（无 `updated_at`）；`visibility='public_sea'` 时 `payload` 经 `publicSeaPayload()` 删除 `score`/`score_details`/`signals` 并裁剪私密字段。`company_id` 当前由 `memoryCompanyId()` 固定返回 `company:amperetime`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 事实 ID | `nid("dmf")` 生成。 |
| `company_id` | TEXT | 非空 | 公司 ID | 当前恒为 `company:amperetime`（`memoryCompanyId()`）。 |
| `kind` | TEXT | 非空 | 事实类别 | 取值来自 `../backend/src/host/discovery-facts.ts` 的 `DiscoveryFactKind`：`run_create`、`crawl_idle`、`brief`、`ingest_receipt`、`approval_result`、`score_inference`。 |
| `object_type` | TEXT | 非空 | 对象类型 | 代码使用 `discovery_run` 或 `discovery_request`。 |
| `object_id` | TEXT | 非空 | 对象 ID | 对应的 `discovery_runs.id` 或 `discovery_requests.id`（无外键，仅逻辑引用）。 |
| `fact_kind` | TEXT | 非空，默认 `'fact'` | 事实/推断 | `fact` 或 `inference`；`kind='score_inference'` 时默认 `inference`。 |
| `visibility` | TEXT | 非空，默认 `'public_sea'` | 可见性 | `public_sea`（公开海域，写入前裁剪评分与私密字段）或 `restricted`。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 负载 | JSON。如 `run_create` 含 `request_id`/`platform`/`brief_version`，`ingest_receipt` 含 `candidate_id`/`kol_uid`/`source_batch`/`platform`/`platform_creator_id`，`approval_result` 含 `result`（`l3_confirmed`/`cancelled`/`voided`）。 |
| `source_version` | TEXT | 可空 | 来源版本 | 一般写 `brief_version` 字符串或 `source_batch`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |

### discovery_ingest_receipts — 发现入库回执

- **用途**：home 发现 L3 确认入库后的「已入库」回执，按（公司 + 批次 + 平台 + 平台创作者 ID）去重，防止同一条线索在重试时被重复建档；也是 `already_imported` 判定的依据。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(company_id, source_batch, platform, platform_creator_id)`。
- **关键索引**：无显式索引（仅有主键/唯一约束的隐式索引）。
- **写入方**：`../backend/src/host/discovery-ingest.ts`（`writeReceipt()`，在 `ingestOne()` 建档并写入公海成功后调用；唯一约束冲突时 `ON CONFLICT ... DO NOTHING`）；HTTP 入口为 `../backend/src/routers/kol-memory.ts` 的 `POST /home/discovery/ingest`（L3）。
- **备注**：无外键；`source_batch` 在 home 路径即 `run.id`。L3 动作需先确认，且不发送邮件、不推进阶段。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 回执 ID | `nid("dir")` 生成。 |
| `company_id` | TEXT | 非空 | 公司 ID | 恒为 `memoryCompanyId()`（`company:amperetime`）。 |
| `source_batch` | TEXT | 非空 | 来源批次 | 入库批次标识；home 路径为 `discovery_runs.id`；与平台+创作者 ID 一起构成去重键。 |
| `platform` | TEXT | 非空 | 平台代码 | 来自候选的平台（`withYoutube` 等海外码）。 |
| `platform_creator_id` | TEXT | 非空 | 平台创作者 ID | 平台侧稳定 ID，来自 `requireStableExternalId()`；缺失则入库直接失败。 |
| `kol_uid` | TEXT | 非空 | 红人编号 | 建档/导入后取得的真实 `kol_uid`（`importKolProfilesFromCrawler` 返回值优先，回退 `addKolProfile` 的 uid）。 |
| `candidate_id` | TEXT | 可空 | 候选人 ID | 对应的 `creator_candidates.id`（无外键）。 |
| `run_id` | TEXT | 可空 | 运行 ID | 对应的 `discovery_runs.id`（无外键）。 |
| `status` | TEXT | 非空，默认 `'imported'` | 回执状态 | 默认 `imported`；当前代码仅在入库成功时写回执，失败不入表，因此实际取值只有 `imported`（未在代码中确认有其他取值）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |

### discovery_ingest_confirms — 发现入库确认

- **用途**：L3 入库确认动作的回执与状态机记录：待确认（`pending`）、已确认（`confirmed`）、已取消（`cancelled`）、因 Brief 变化作废（`voided`）；入库前需校验 `expected_brief_version`。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）；代码按 `run_id + source_batch` 取 `created_at` 最新一条。
- **写入方**：`../backend/src/host/discovery-ingest.ts`（`writeConfirm()` 在 `ingestDiscoveryBatch()` 的 pending / cancelled / confirmed 三个分支插入；`voidConfirms()` 把 `pending`/`confirmed` 批量改为 `voided`）；HTTP 入口为 `../backend/src/routers/kol-memory.ts` 的 `POST /home/discovery/ingest`。
- **备注**：无外键。流程不变量：`onDelete` 不级联，确认记录长期保留；已取消或已作废的确认会阻止再次入库（409 `l3_cancelled` / `l3_voided`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 确认 ID | `nid("dic")` 生成；`needs_confirmation` 响应里以 `confirmation_id` 返回。 |
| `company_id` | TEXT | 非空 | 公司 ID | 恒为 `memoryCompanyId()`（`company:amperetime`）。 |
| `run_id` | TEXT | 非空 | 运行 ID | 被确认入库的 `discovery_runs.id`（无外键）。 |
| `source_batch` | TEXT | 非空 | 来源批次 | 入库批次；home 路径等于 `run_id`。 |
| `expected_brief_version` | INTEGER | 非空 | 期望 Brief 版本 | 调用方声明的 Brief 版本；必须 ≥1，否则 400 `expected_brief_version_required`；与当前值不符则本批确认被作废并 409。 |
| `candidate_ids` | TEXT | 非空，默认 `'[]'` | 候选人 ID 列表 | 本次确认的 `creator_candidates.id` JSON 数组；取消分支也会原样记录。 |
| `status` | TEXT | 非空，默认 `'pending'` | 确认状态 | `pending`（待确认）、`confirmed`（已确认）、`cancelled`（员工取消）、`voided`（Brief 变化或审批结果作废）。 |
| `actor_id` | TEXT | 可空 | 操作人 ID | 发起确认/取消的员工（未启用鉴权时为演示用户）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | 通常等于 `created_at`，被 `voidConfirms` 改写状态时刷新。 |

---

## 九、分组 7：邮件（3 张表）

KOL 往来邮件主线、会话线与已读标记。

### kol_mail_threads — 邮件会话（线程）

- **用途**：员工邮箱里「一个邮箱 + 一个远端会话」在本地的一行投影。邮件页会话列表、未读数、会话摘要（digest）与星标都读这张表；同步时先落线程再落消息。
- **主键 / 唯一约束**：`id`（主键，前缀 `thr`，`nid("thr")`）；`UNIQUE(mailbox, conversation_id)`（索引 `kol_mail_threads_mailbox_conv`，同一会话在不同邮箱下各占一行，迁移时会删掉重复行只留 `updated_at` 最新的一条）。
- **关键索引**：`kol_mail_threads_mailbox_conv`（UNIQUE，`(mailbox, conversation_id)`，upsert 与按会话查线程）；`kol_mail_threads_mailbox`（`mailbox`，邮箱维度筛会话/统计未读）。历史索引 `kol_mail_threads_key`、`kol_mail_threads_conv` 已在 `backend/src/db.ts` 的 `migrateSchema` 中 `DROP`。
- **写入方**：`backend/src/starrykol/mail-sync.ts`（`upsertThread` 插入或更新会话壳；`hydrateMailThread` 回填 `subject`/`last_snippet`/`last_preview`/`last_from`/`last_from_name`/`last_at`/`updated_at`）。`backend/src/host/mail-memory.ts`（`markCollaborationMailRead`、`markConversationMailRead` 置 `unread_count=0`；`setConversationStarred` 写 `starred`；`persistThreadDigest` 写 `digest_*`）。`backend/src/host/mail-memory-job.ts`（`ensureThreadDigest` 经 `persistThreadDigest` 写 digest）；`backend/src/host/mail-summary.ts`（`writeThreadDigest` 把同一合作单下所有线程的 digest 一起回写）；建表/补列/去重/回填见 `backend/src/db.ts`；删除见 `backend/src/seed.ts`、`backend/src/host/kol-journey.ts`。
- **备注**：无外键约束（`collaboration_id` 只是逻辑指向 `collaborations.id`，可空表示未匹配）。邮件只读接口 `GET /api/mail/conversations` 直接读本表，不发模型、不开会话。`digest_text` 故意不进列表投影（`LIST_COLUMNS`），只在会话详情返回。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 线程 ID | 会话唯一标识，`nid("thr")` 生成；同一 `(mailbox, conversation_id)` 复用已有行。 |
| `collaboration_id` | TEXT | 可空 | 合作单 ID | 匹配到的 KOL 合作单（`collaborations.id`）；未匹配写 NULL。同步后 `db.ts` 迁移会按有无该值回填 `match_state`。 |
| `conversation_id` | TEXT | 非空 | 远端会话 ID | 邮件供应商的会话标识，是线程的业务键之一（与 `mailbox` 组成唯一键）。 |
| `subject` | TEXT | 非空，默认 `''` | 会话主题 | 会话主题；远端无主题时写 `(无主题)`（`mail-sync.ts` 兜底）。 |
| `mailbox` | TEXT | 可空 | 所属邮箱 | 本轮同步使用的员工邮箱（绑定邮箱优先），或远端会话自带的 mailbox；列表按它筛邮箱。 |
| `last_direction` | TEXT | 可空 | 最新一封方向 | 取值 `inbound`（来信）/ `outbound`（去信）；无消息时写空串。 |
| `last_snippet` | TEXT | 可空 | 最新一封正文摘要 | 最新一封来信的正文（`messageBody` 结果），供列表/详情首屏展示。 |
| `unread_count` | INTEGER | 非空，默认 0 | 未读数 | 以远端返回的会话未读数为准，缺失时按未读来信条数计算；读信（`mark*MailRead`）后置 0。 |
| `last_at` | TEXT | 可空 | 最新一封时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），取最新来信时间；缺失时用同步时间兜底；列表按其倒序。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，首次建线程时写入，不再变更。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 upsert、读信、加/取消星标时更新。 |
| `last_from` | TEXT | 可空 | 最新发件人邮箱 | 最新来信的发件人邮箱（`messageFrom().email`）。 |
| `last_from_name` | TEXT | 可空 | 最新发件人姓名 | 最新来信的发件人显示名，未取到写空串。 |
| `peer_email` | TEXT | 可空 | 对方邮箱 | 会话对端邮箱（upsert 时取最新来信发件人）；摘要任务按 `(mailbox, peer_email)` 聚合同一人往来。 |
| `peer_name` | TEXT | 可空 | 对方姓名 | 会话对端显示名，未取到写空串。 |
| `last_preview` | TEXT | 可空 | 最新预览文案 | `mailPreview(snippet)` 截断后的短预览；优先取含中文的候选预览。 |
| `match_state` | TEXT | 可空 | 匹配状态 | 实际写入值只有 `matched`（已匹配合作单）/ `unbound`（未匹配）；`deferred`、`ignored` 定义在 `MATCH_STATES` 白名单中但（未在代码中确认）有写入路径。 |
| `last_receipt` | TEXT | 可空 | 最新回执文案 | `upsertThread` 接受 `lastReceipt` 参数，但现有两处调用都未传，实际恒为空串；列表投影会读取它（未在代码中确认有其它写入路径）。 |
| `digest_text` | TEXT | 可空 | 会话摘要正文 | 会话级人话摘要；来源见 `digest_source`，为规则兜底文本时也会落库。 |
| `digest_source` | TEXT | 可空 | 摘要来源 | 取值 `codex_memory` / `luna`（远端模型，视为可信）、`analysis_failed`（远端失败后写规则兜底并记 `digest_error`/`digest_failed_at`）、`body_analysis`（本地规则分析）；空串表示尚未生成。 |
| `digest_fingerprint` | TEXT | 可空 | 摘要指纹 | 由会话内消息的 `id:occurred_at:正文长度` 拼接串算出；指纹一致才复用旧摘要，正文变了就重算。 |
| `digest_error` | TEXT | 可空 | 摘要失败原因 | 远端不可用时的错误标记（如 `unavailable`/`disabled`），成功时写空串。 |
| `digest_failed_at` | TEXT | 可空 | 摘要失败时间 | ISO 8601 字符串；配合 `mailDigestFailRetryMs()` 决定失败后多久允许重试。 |
| `digest_mail_count` | INTEGER | 可空 | 摘要覆盖邮件数 | 参与生成该摘要的、正文非空的邮件条数。 |
| `starred` | INTEGER | 非空，默认 0 | 是否星标 | 布尔（0/1），由 `PUT /api/mail/conversations/:id` 的 `starred` 写入（`backend/src/routers/mail.ts`）。 |

### kol_mail_items — 邮件消息

- **用途**：会话里的一封封邮件。存正文、发件/收件人、方向、未读标记，以及本地生成的翻译、单封摘要和「记忆」元数据；打开会话详情与生成摘要都以本表为输入。
- **主键 / 唯一约束**：`id`（主键，前缀 `kmi`，`nid("kmi")`）；`UNIQUE(provider_message_id)`（部分唯一索引 `kol_mail_items_mid`，仅约束非空且非空串的值）。
- **关键索引**：`kol_mail_items_mid`（UNIQUE、部分索引，`provider_message_id`，防同一封邮件重复入库）；`kol_mail_items_thread`（`thread_id`，会话详情与消息计数）；`kol_mail_items_conversation`（`conversation_id`，按会话取消息）；`kol_mail_items_collab`（`collaboration_id`，合作单维度取邮件）。
- **写入方**：`backend/src/starrykol/mail-sync.ts`（`rememberItem` 插入新邮件；对已有 `provider_message_id` 的行补写 `title`；`ensureThreadItemTranslations` 写 `translation_zh`/`translation_source`；`markThreadTranslationsPending` 标 `pending`）。`backend/src/host/mail-memory.ts`（`persistItemMemory` 写摘要/翻译/`memory_*`；`markItemMemoryPending`、`markThreadTranslationsPending` 标 `pending`；`markCollaborationMailRead`、`markConversationMailRead` 置 `unread=0`）。`backend/src/host/mail-memory-job.ts`（`ensureItemMemory` 批量补翻译与摘要并累加 `memory_attempts`）。`backend/scripts/repair-mail-translations.ts`（一次性修复脚本，改写内容被包成 JSON 的旧译文）。删除见 `backend/src/seed.ts`。
- **备注**：无外键约束；`collaboration_id` 为逻辑关联，未匹配写 NULL。`provider_message_id` 在远端没有消息 ID 时写入身份哈希（`sha256` 十六进制），因此该列既有原始 ID 也有哈希值。`title IS NULL` 被用作「旧缓存行需要回填标题」的判据，空串表示远端确实没有标题。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 消息 ID | 邮件唯一标识，`nid("kmi")` 生成。 |
| `thread_id` | TEXT | 非空 | 线程 ID | 所属 `kol_mail_threads.id`（逻辑外键，无约束）。 |
| `collaboration_id` | TEXT | 可空 | 合作单 ID | 匹配到的 `collaborations.id`；未匹配写 NULL。 |
| `conversation_id` | TEXT | 非空 | 远端会话 ID | 供应商会话标识，同一会话的消息共享该值。 |
| `provider_message_id` | TEXT | 可空 | 供应商消息 ID | 远端消息 ID（`messageId`/`message_id`/`id`/`mailId` 取首个）；取不到时写身份哈希，用于去重。 |
| `direction` | TEXT | 可空 | 收发方向 | 取值 `inbound`（来信）/ `outbound`（去信）；读取时非 `outbound` 一律按 `inbound` 处理。 |
| `subject` | TEXT | 可空 | 主题 | 邮件主题，取同步时算出的会话主题。 |
| `snippet` | TEXT | 可空 | 正文摘要片段 | 正文前 280 个字符（`body.slice(0,280)`），列表用。 |
| `unread` | INTEGER | 非空，默认 1 | 是否未读 | 布尔（0/1）：来信插入时恒为 1，去信恒为 0；读信时由 `mark*MailRead` 置 0。 |
| `occurred_at` | TEXT | 可空 | 发生时间 | ISO 8601 字符串，取远端的 `sentAt`/`createdAt`/`time`/`ts`，都取不到时写同步时间；消息按此升序排列。 |
| `created_at` | TEXT | 非空 | 入库时间 | ISO 8601 字符串，本地写入该行的时间，不再变更。 |
| `from_addr` | TEXT | 可空 | 发件人邮箱 | `messageFrom().email`。 |
| `from_name` | TEXT | 可空 | 发件人姓名 | `messageFrom().name`。 |
| `to_addr` | TEXT | 可空 | 收件人邮箱 | `messageTo().email`。 |
| `body_text` | TEXT | 可空 | 正文全文 | 去 HTML 后的纯文本正文（`messageBody`），是翻译与摘要的输入。 |
| `summary` | TEXT | 可空 | 单封摘要（原文） | 单封邮件摘要；远端模型结果或规则兜底文本，来源见 `summary_source`。 |
| `summary_zh` | TEXT | 可空 | 单封摘要（中文） | 中文摘要；远端模型只给一份文本时与 `summary` 同文。 |
| `summary_source` | TEXT | 可空 | 摘要来源 | 取值 `codex_memory` / `luna` / `starry_mcp`（远端，视为可信）、`analysis_failed`（远端失败，写规则文本）、`body_analysis`（本地规则分析）；空串表示未生成。 |
| `receipt_status` | TEXT | 可空 | 回执状态 | 插入时固定写空串，其后（未在代码中确认）有写入路径；发送回执目前只在发送链路的返回值里出现，未落到本表。 |
| `receipt_at` | TEXT | 可空 | 回执时间 | 插入时固定写 NULL，其后（未在代码中确认）有写入路径。 |
| `effective` | INTEGER | 可空 | 是否有效往来 | 布尔语义（`messageRowOf` 读为 `Boolean(Number(...))`）；插入时固定写 0。是否算「有效往来」的判定在 `kol_follow_index`/`kol_thread_summary` 一侧（`backend/src/host/kol-memory.ts`），本列（未在代码中确认）有写入路径。 |
| `translation_zh` | TEXT | 可空 | 中文译文 | 正文的中文内部译稿（不含内部译稿头），供员工阅读；由 `translateMailBodyZh` 生成。 |
| `translation_source` | TEXT | 可空 | 译文来源 | 取值 `starry_mcp` / `codex_memory` / `luna`（`backend/src/starrykol/translate-zh.ts`）、`pending`（待生成或远端不可用）、`repaired_json_envelope`（修复脚本回写）、空串（未生成）。 |
| `memory_fingerprint` | TEXT | 可空 | 正文指纹 | `body_text` 的 `sha256` 前 32 位十六进制；与当前正文不一致即触发重译/重摘要。 |
| `memory_source` | TEXT | 可空 | 记忆状态来源 | 取值 `pending`（排队等待生成）、`codex_memory`（本次生成成功）、`analysis_failed`（生成失败只剩兜底）、空串或原值（无需重算时保留）。 |
| `memory_generated_at` | TEXT | 可空 | 记忆生成时间 | ISO 8601 字符串，每次记忆任务写入的时间；被标 `pending` 时置 NULL。 |
| `memory_error` | TEXT | 可空 | 记忆生成错误 | 最近一次生成失败的异常消息；标 `pending` 时清空为空串。 |
| `memory_attempts` | INTEGER | 可空 | 记忆尝试次数 | 每次进入 `ensureItemMemory` 时在旧值上 +1（旧值缺失按 0 计）。 |
| `title` | TEXT | 可空 | 邮件标题 | 远端邮件标题（`messageTitle`）；迁移补列，旧行的 NULL 表示待回填，空串表示远端确实没有标题（前端渲染为 `—`）。 |

### kol_mail_seen — 邮件去重指纹

- **用途**：记录「这件事已经在某个 KOL 会话里处理过」，给来信摄入做幂等。指纹命中即视为重复，不再生成新的来信卡，避免同一封邮件被反复计入会话。
- **主键 / 唯一约束**：`fingerprint`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/inbound-identity.ts` 的 `markMailSeen`（`INSERT OR IGNORE`，逐条写 `seen_keys`）；唯一调用点是 `backend/src/host/kol-journey.ts` 的 `ingestKolMail`（判重后、落卡前写入）。读取为同文件的 `mailAlreadySeen`（另经 `backend/src/starrykol/mail-sync.ts` 的 `rememberItem` 判重）。清除见 `backend/src/seed.ts`（按合作单删）与 `backend/src/host/kol-journey.ts`（重开合作单旅程时整表清空）。
- **备注**：一次来信会写两行——`mid:<供应商消息 ID>` 与 `<合作单ID>:<主题>:<正文前80字>:<会话ID>`（`mailFingerprint`）；远端没有消息 ID 时只写后一行。本表是 `inbound` 表之外的本地会话级判重，`mailAlreadySeen` 同时还会回查 `inbound.provider_message_id`。无外键、无 TTL，记录只增不删（除整表/按合作单清理）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `fingerprint` | TEXT | 主键，非空 | 去重指纹 | 两种形态：`mid:<供应商消息 ID>` 或 `<合作单ID>:<主题>:<正文前80字>:<会话ID>`。 |
| `session_id` | TEXT | 非空 | 会话 ID | 写入时该合作单的 KOL 会话 ID（调用方传入的 `session_id`，否则用 `openKolSession` 新建的会话）。 |
| `collaboration_id` | TEXT | 非空 | 合作单 ID | 该来信归属的合作单；按合作单清理时用它删除。 |
| `created_at` | TEXT | 非空 | 记录时间 | ISO 8601 字符串，判重通过、准备落卡时写入。 |

---

## 十、分组 8：任务运行时（4 张表）

工作项、任务运行、任务事件与任务产物。

### work_items → tickets — 工单（任务运行与工单的统一记录）

> 换表（2026-10-01，DECISIONS ADR-2026-10-01 二）：原 `work_items` 已重命名为 `tickets`，票型列并入同表；`work_items` 表不再存在。
> 本节字段说明适用于 `tickets` 的既有列；票型列（`kind`/`channel`/`requester_type`/`requester_id`/`object_type`/`object_id`/`kind_version`）见分组 14。

- **用途**：一张「工单 / 任务」的正式记录，是员工端待办、今日任务与执行排队的唯一事实源。用户提交任务（文本、表单、定时、采纳推荐）、AI 发现生成容器任务、今日/待办规划生成规划任务时都会在此落一行；`task_runs`、`task_events`、`task_artifacts` 全部挂在它下面。
- **主键 / 唯一约束**：`id`（主键）；另有两条**部分唯一索引**：`one_running_today_plan`（同一 owner 最多一个未结束的 `today_plan`）与 `one_running_todo_plan`（同一 owner 最多一个未结束的 `todo_plan`），谓词均为 `status IN ('pending','queued','running','in_progress','starting')`。
- **关键索引**：`tickets_owner_updated`（`owner_user_id, updated_at DESC`）——`GET /api/tasks` 列表按 owner 排序读取；`tickets_owner_status`（`owner_user_id, status, updated_at`）——按状态筛选；两条部分唯一索引兼作规划任务的并发闸门。外键 `session_id→sessions(id)` 无显式索引。
- **写入方**：
  - `backend/src/routers/tasks.ts` — `createWorkItem()`（`POST /api/tasks`、`POST /api/tasks/from-text`）创建；`applyTaskUpdate()`（`PATCH /api/tasks/:id`、`POST /api/tasks/:id/edit`）更新 `title/content/status/priority/risk_level/start_date/due_at`；`POST /api/tasks/:id/run` 写 `session_id/input/status='pending'`；`/acknowledge`、`/promote`、`/dismiss`、`/cancel`、`/complete` 分别写 `last_acted_at`+`acknowledged_at`、`promoted_at`、`dismissed_at`、`status='cancelled'`、终态。
  - `backend/src/host/api.ts` — 会话执行期把任务推进到 `running`/`queued`/`stopped`/`failed`/`waiting`/`needs_clarification`（`startBoundTask`/`queueBoundTask`/`failBoundTask`/`cancelBoundTask`/`stoppedBoundTask`/`finishBoundTask`）。
  - `backend/src/host/today-plan-run.ts`、`backend/src/routers/kol-memory.ts`、`backend/src/discovery.ts`、`backend/src/home-discovery.ts`、`backend/src/crawl/service.ts` — 规划任务、KOL 分析、AI 发现容器任务各自的建行与状态推进。
  - `backend/src/host/task-run-recovery.ts`、`backend/src/host/today-brief.ts`、`backend/src/host/kol-memory.ts` — 启动时把中断的 `running` 收敛为 `failed`；简报写入成功置 `completed`。
  - `backend/src/seed-fixtures.ts`（`INSERT OR REPLACE`）、`backend/src/seed.ts`（清库）— 仅测试/演示数据。
- **备注**：DDL 里 `owner_user_id` **没有**外键（只有 `session_id→sessions(id) ON DELETE SET NULL`）；`task_runs`/`task_events` 对它的外键是 `ON DELETE CASCADE`，删任务会级联删运行与事件。`pinned/planning` 类任务通过 `source='planning'` 或 `task_type IN ('today_plan','todo_plan','today_analyze')` 被排除在员工待办列表之外（`backend/src/host/home-board.ts` 的 `OPEN_WORK_ITEM_SQL`）。`source IN ('ai','discovery')` 的行必须 `promoted_at IS NOT NULL` 才算正式待办。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 任务 ID | 唯一标识，创建时由 `nid("tsk")` 生成，形如 `tsk_...`；`task_runs`/`task_events`/`task_artifacts` 通过它级联。 |
| `owner_user_id` | TEXT | 非空 | 归属员工 ID | 任务所属员工，创建时取 `ownerId()`（登录用户，鉴权关闭时为 `DEMO_USER`）。列表查询与两条部分唯一索引都以它分区；**无外键约束**。 |
| `task_type` | TEXT | 非空 | 任务类型 | 技能 ID，创建时 = `taskDefinition(id)`，取值来自 `backend/skills/` 目录（如 `creator_discovery`、`email_compose`、`kol_analyze`、`discovery_plan`）与内置规划类型 `today_plan`/`todo_plan`/`today_analyze`。创建时校验存在，否则 400 `unknown_task_type`。 |
| `title` | TEXT | 非空 | 标题 | 任务标题，创建时取 `body.title` 或技能默认标题，截断 200 字符；`PATCH` 可按 200 字符上限改写。 |
| `source` | TEXT | 非空，默认 `'manual'` | 来源 | 记录入口渠道。实际写入值：`manual`（表单/采纳推荐）、`text`（`/tasks/from-text`）、`schedule`（定时任务）、`discovery`（AI 发现容器任务）、`home_discovery`（首页发现）、`planning`（今日/待办规划）、`kol-analyze-enqueue`（KOL 分析入队）、`ai`（仅 `seed-fixtures.ts` 演示数据）。`ai`/`discovery` 来源在未 `promoted_at` 前不算正式待办。 |
| `status` | TEXT | 非空，默认 `'pending'` | 状态 | 枚举（写入方见上）：`pending`、`needs_clarification`、`queued`、`running`、`in_progress`、`starting`、`waiting`、`failed`、`stopped`、`completed`、`cancelled`；`POST /api/tasks` 的合法集合还接受 `waiting`，`PATCH` 另接受 `done`。读取口径：`completed`/`done`/`cancelled` 视为已关闭（`CLOSED_STATUSES`）。 |
| `priority` | TEXT | 非空，默认 `'normal'` | 优先级 | 枚举：`important_urgent`、`important`、`urgent`、`normal`、`low`（`TASK_PRIORITY_CODES`）。写入前经 `normalizePriority()`：`high`→`important`、`medium`→`normal`；`db.ts` 迁移已把历史 `high/urgent/medium` 批量改写为 `important/important_urgent/normal`。 |
| `skill` | TEXT | 非空 | 技能 ID | 创建时固定写入 `definition.id`，与 `task_type` 同值；列表页合并技能定义时用它（回退 `task_type`）做匹配。 |
| `profile` | TEXT | 非空 | 岗位画像 | 技能声明的 profile，取值 `commander`/`lead`/`opportunity`/`negotiation`/`execution`/`settlement-growth`；`GET /api/tasks` 支持按它筛选。 |
| `project_id` | TEXT | 可空 | 项目/合作 ID | 实际存的是 `collaborations.id`：单条读取时用它在 `collaborations` 里查 `display_name` 作为 `project` 展示名。创建时取 `body.project_id`，多数创建路径写 NULL。 |
| `collaboration_id` | TEXT | 可空 | 合作 ID | 关联的合作（红人）ID，创建时取 `body.collaboration_id` 或 `input.collaboration_id`；列表页面板装饰（阶段、红人名）以此为准。无外键约束。 |
| `session_id` | TEXT | 可空 | 会话 ID | 外键 `→ sessions(id) ON DELETE SET NULL`。`/tasks/:id/run` 时若为空则新建会话并回写；`GET /api/tasks/by-session/:sid` 按它反查任务。 |
| `due_at` | TEXT | 可空 | 截止时间 | 任务结束日期/时间，创建时默认写当天（`todayDateStr()`），截断 40 字符；`PATCH` 中传 `null` 可清空。用于逾期/临期派生状态（`display_status` 的 `overdue`/`due_soon`）。 |
| `promoted_at` | TEXT | 可空 | 转为待办时间 | ISO 8601；`POST /tasks/:id/promote`、`POST /tasks/adopt-recommendation` 写入，采用 `COALESCE` 幂等（只记首次）。AI 推荐行必须有它才进待办列表。 |
| `dismissed_at` | TEXT | 可空 | 忽略时间 | ISO 8601；`POST /tasks/:id/dismiss` 写入（`COALESCE` 幂等）。非空的行走项一律不再出现在开放列表；`promote`/采纳会把已忽略的行重新置 NULL。 |
| `started_at` | TEXT | 可空 | 开始时间 | ISO 8601；首次真正开始执行时写入（`startBoundTask`、`crawl/service.ts` 启动采集），`COALESCE` 保留首次值。`display_status` 用它区分「未开始/进行中」。 |
| `completed_at` | TEXT | 可空 | 完成时间 | ISO 8601；终态（`completed`/`failed`/`cancelled`/`stopped`）或取消时写入。注意 `finishBoundTask` 成功时反而把它置 NULL（任务进入 `waiting` 等人工确认）。 |
| `input` | TEXT | 非空，默认 `'{}'` | 输入（JSON） | 运行输入快照。含 `prompt`、`attachments`、`model_tier`、`collaboration_id`、`knowledge_id`、`skill_template_version`、`compose_input`，以及内部字段 `_skill_template`（技能模板快照，对外投影时剥离）。`/tasks/:id/run` 会并入本次参数后整体重写。 |
| `entities` | TEXT | 非空，默认 `'{}'` | 实体（JSON） | 意图解析出的结构化实体，如 `handle`、`recommendation_id`、`kol_uids`、`platform`、`keywords`；`findDuplicateTodoRow()` 用它做去重比对。 |
| `data_version` | INTEGER | 非空，默认 1 | 数据版本 | 乐观并发/缓存指纹计数；任何字段更新都伴随 `data_version=data_version+1`，`GET /api/tasks` 的轮询缓存用 `MAX(updated_at)+COUNT(*)` 与它共同判定失效。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），创建时由 `nowIso()` 写入，之后不变。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串；任一写路径都会刷新，列表默认排序字段（`updated_desc`）。`work_items_owner_updated` 索引服务于它。 |
| `last_acted_at` | TEXT | 可空 | 最近处理时间 | ISO 8601；`POST /tasks/:id/acknowledge` 写入，表示员工「打开/处理」过。**不创建会话**，也不等于推进阶段。 |
| `acknowledged_at` | TEXT | 可空 | 首次确认时间 | ISO 8601；`acknowledge` 时 `COALESCE` 写入（只记首次）；同时把 `pending`/`queued` 推进为 `in_progress`。 |
| `content` | TEXT | 非空，默认 `''` | 任务内容 | 补充正文，创建时取 `body.content` 截断 2000 字符；`PATCH` 可改写（同样 2000 字符上限）。 |
| `start_date` | TEXT | 可空 | 开始日期 | `YYYY-MM-DD`（10 字符）；创建时默认当天，`PATCH` 可改或置 NULL。用于「今天任务」判定（`datePartOf(start_date) === today`）。 |
| `risk_level` | TEXT | 非空，默认 `'none'` | 风险等级 | 枚举：`none`、`low`、`medium`、`high`（`TASK_RISK_LEVELS`）。创建与 `PATCH` 均校验；`high` 会让任务进「高风险」项（`isHighRiskWorkItem`），影响首页置顶。读取时会回退非法值为 `none`。这是任务展示风险，与工具 L1/L2/L3 分档不是同一套取值。 |

### task_runs — 任务运行（一次执行尝试）

- **用途**：一个工作项的一次执行尝试。`/tasks/:id/run` 建一条 `pending` 运行，会话真正开始执行时转 `running`，模型返回后写终态与产物归属；规划任务（`today_plan`/`todo_plan`/`today_analyze`）建行即 `running`。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：`task_runs_work_item`（`work_item_id, created_at`）——`GET /api/tasks/:id` 按工作项取全部运行并按创建时间排序。
- **写入方**：
  - `backend/src/routers/tasks.ts:948` — `POST /api/tasks/:id/run` 插入 `pending` 运行。
  - `backend/src/host/today-plan-run.ts:101` — `createPlanningRun()` 插入 `running` 运行。
  - `backend/src/host/api.ts` — `startBoundTask`（→`running`，写 `started_at`，清 `error`）、`queueBoundTask`（→`queued`）、`resolveBoundTask`（模板过期→`failed`）、`failBoundTask`（→`failed`）、`cancelBoundTask`（→`cancelled`）、`stoppedBoundTask`（→`cancelled`，error 记 `worker_stopped`）、`finishBoundTask`（终态并回填 `worker_id/thread_id/turn_id`）。
  - `backend/src/host/task-run-recovery.ts`、`backend/src/host/today-brief.ts`、`backend/src/host/kol-memory.ts` — 启动收敛中断、简报终态、非法动词失败。
- **备注**：`work_item_id→work_items(id) ON DELETE CASCADE`，`session_id→sessions(id) ON DELETE SET NULL`。`error` 存 JSON 字符串（对外投影时反序列化）。同一工作项可有多条运行（重试/停止后重跑），最新那条由 `created_at` 排序决定。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 运行 ID | 唯一标识，由 `nid("run")` 生成，形如 `run_...`；`task_events.run_id` 与 `task_artifacts.run_id` 指向它。 |
| `work_item_id` | TEXT | 非空 | 工作项 ID | 外键 `→ work_items(id) ON DELETE CASCADE`；所属任务，写入后不变。 |
| `session_id` | TEXT | 可空 | 会话 ID | 外键 `→ sessions(id) ON DELETE SET NULL`；执行该运行的会话。 |
| `thread_id` | TEXT | 可空 | Codex 线程 ID | 由 worker 结果回填（`finishBoundTask` 取 `worker.thread_id`）；未开始或 worker 未返回时为 NULL。 |
| `turn_id` | TEXT | 可空 | Codex 轮次 ID | 同上，取 `worker.turn_id`；用于把一次运行对到具体推理轮次。 |
| `worker_id` | TEXT | 可空 | Worker ID | 执行该运行的工作进程 ID，`finishBoundTask` 回填（`worker.id`）。 |
| `status` | TEXT | 非空，默认 `'pending'` | 运行状态 | 枚举：`pending`（入队）、`queued`（等前一任务）、`running`、`completed`、`failed`、`cancelled`。终态由 `completed_at` 一并写入。 |
| `input` | TEXT | 非空，默认 `'{}'` | 运行输入（JSON） | 本次运行的输入快照，含 `_skill_template`；模板版本冲突时据此判 409 `skill_template_version_conflict`。 |
| `entities` | TEXT | 非空，默认 `'{}'` | 实体（JSON） | 本次运行解析出的实体，与工作项的 `entities` 合并后使用。 |
| `error` | TEXT | 可空 | 错误（JSON） | JSON 字符串，形如 `{"code":"not_started","message":"..."}`；成功运行时清为 NULL（`startBoundTask` 与 `queueBoundTask` 都会重置）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，建行时由 `nowIso()` 写入，之后不变；是取「最新一次运行」的排序依据。 |
| `started_at` | TEXT | 可空 | 开始时间 | ISO 8601 字符串；`startBoundTask` 用 `COALESCE` 写首次开始时间，规划运行建行时即写入。 |
| `completed_at` | TEXT | 可空 | 结束时间 | ISO 8601 字符串；终态（`completed`/`failed`/`cancelled`）时写入。 |

### task_events — 任务事件（处理过程时间线）

- **用途**：工作项的处理过程日志——按 `sequence` 递增追加，驱动前端「处理过程 / Codex 推理」块和列表的 `history_summary`。既有业务事件（创建、更新、转待办、忽略、取消、确认、完成/失败），也有运行时事件（入队、开始、排队、进度、推理、工具调用、结束）。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(work_item_id, sequence)`（同一工作项内序号唯一）；部分唯一索引 `task_events_item_key`（`work_item_id, item_key`，`WHERE item_key IS NOT NULL`）保证同一工作项内同一键盘位只有一行。
- **关键索引**：`task_events_work_item`（`work_item_id, sequence`）——按工作项读尾部事件与 `MAX(sequence)` 聚合都走它；`task_events_item_key`（部分唯一）服务于 `upsertTaskEvent` 的原地更新。
- **写入方**：
  - `backend/src/routers/tasks.ts` — `appendTaskEvent()`（追加，`nid("tev")`，先算 `MAX(sequence)+1`）与 `upsertTaskEvent()`（按 `item_key` 命中则 UPDATE，否则 INSERT）；被 `/tasks` 全系列端点、`backend/src/host/api.ts`、`backend/src/host/task-run-recovery.ts`、`backend/src/host/today-plan-run.ts`、`backend/src/crawl/service.ts`、`backend/src/home-discovery.ts` 调用。
  - `backend/src/host/run-trace.ts` — 把 harness 的推理/步骤/MCP 调用转成 `run.think`/`run.step`/`run.tool` 行，400ms 合批，同一 `item_key` 原地更新。
  - `backend/src/seed-fixtures.ts`、`backend/src/seed.ts` — 演示数据与清库。
- **备注**：`work_item_id→work_items(id) ON DELETE CASCADE`（删任务清空时间线）；`run_id→task_runs(id) ON DELETE CASCADE`（**注意**：删运行会连带删掉该运行的事件行）。`appendTaskEvent` 对外键错误静默返回 NULL——采集/worker 的异步后续可能落在已删任务上。`safe_summary` 只放脱敏摘要，原始 `reasoning_text` 不落库。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 事件 ID | 唯一标识，由 `nid("tev")` 生成，形如 `tev_...`。 |
| `work_item_id` | TEXT | 非空 | 工作项 ID | 外键 `→ work_items(id) ON DELETE CASCADE`；事件归属的任务。 |
| `run_id` | TEXT | 可空 | 运行 ID | 外键 `→ task_runs(id) ON DELETE CASCADE`；运行时事件填本次运行，业务事件（创建/更新/转待办）为 NULL。AI 发现类没有 `task_runs` 行，也传 NULL。 |
| `sequence` | INTEGER | 非空 | 序号 | 工作项内自增序号，写入时取 `COALESCE(MAX(sequence),0)+1`；与 `work_item_id` 组成唯一约束，`GET /api/tasks/:id/events?after=N` 用它增量拉取。 |
| `event_type` | TEXT | 非空 | 事件类型 | 开放取值（无 CHECK），按域前缀命名。业务：`task.created`、`task.updated`、`task.promoted`、`task.adopted`、`task.dismissed`、`task.acknowledged`、`task.cancelled`、`task.completed`、`task.failed`、`task.clarification`。运行：`run.pending`、`run.queued`、`run.started`、`run.completed`、`run.failed`、`run.stopped`、`run.progress`、`run.think`、`run.step`、`run.tool`、`run.template_changed`。记忆：`memory.write_skipped`、`memory.write_failed`。采集：`crawl.<eventType>`、`crawl.start_failed`。发现：`discovery.queued`、`discovery.plan_started`、`discovery.target_clamped`、`artifact_ready`、`crawl_started`、`crawl_progress`、`crawl_idle`、`ranking_started`、`failed`。 |
| `label` | TEXT | 非空 | 事件标题 | 员工可读短标题（如「任务已创建」「Codex 推理」「已排队」），写入时按 160 字符截断（`upsertTaskEvent` 的 `label.slice(0,160)` 只在已有行的 UPDATE 分支生效；INSERT 分支由调用方保证）。 |
| `status` | TEXT | 非空 | 事件状态 | 该事件发生时的状态快照，取值与工作项/运行状态同域（`pending`、`queued`、`running`、`completed`、`failed`、`cancelled`、`needs_clarification`、`waiting`），外加 trace 的 `done` 与发现域的 `crawling`/`ranking`/`crawl_failed`/`rank_failed`。 |
| `safe_summary` | TEXT | 可空 | 脱敏摘要 | 一句话说明，写入时截断 1000 字符；对外同时以 `summary`/`safe_summary` 两个键返回。只放脱敏内容，不存原始推理文本。 |
| `time` | TEXT | 非空 | 事件时间 | ISO 8601 字符串。`upsertTaskEvent` 原地更新时**保留首次写入值**（即该步骤的开始时刻），因此增长中的推理行不会跳时钟；对外投影时同时作为 `created_at` 返回。该列是后加列，`db.ts` 迁移用 `UPDATE ... SET time=created_at WHERE time IS NULL` 回填历史行。 |
| `created_at` | TEXT | 非空 | 落库时间 | ISO 8601 字符串，INSERT 时由 `nowIso()` 写入，之后不变。 |
| `item_key` | TEXT | 可空 | 事件键盘位 | 运行时 trace 的稳定键（推理项 id、`op:<操作id>`、`host:writing_brief` 等），写入时截断 120 字符。非空时受部分唯一索引保护，`upsertTaskEvent` 靠它把同一逻辑步骤合并成一行；业务事件不填。 |

### task_artifacts — 任务产物

- **用途**：任务产出的结构化产物（结果卡、邮件卡、阶段确认卡、来信卡、错误卡、发现简报、发现 spec、今日简报、今日/待办展示任务）。会话结束时会话内产生的卡片消息会被复制成产物行；发现与规划路径直接写产物，并另有 `employee_today_briefs`/`employee_todo_briefs` 指针表指向最新一条。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `work_item_id` 查询为全表扫描。
- **写入方**：
  - `backend/src/host/api.ts:787` — `finishBoundTask` 把本次运行期间的 `messages`（`kind IN ('task_result_card','email_card','confirm_stage_card','inbound_card','error_card')`）逐条复制为产物，`artifact_type` 即消息 `kind`，`message_id` 指向原消息。
  - `backend/src/crawl/service.ts:469` — 采集完成写 `task_result_card`（并同步插一条 `messages`）。
  - `backend/src/home-discovery.ts:891`（`discovery_brief`）、`backend/src/home-discovery.ts:1169`（`discovery_spec`）。
  - `backend/src/host/today-brief.ts:197`（`today_brief`）、`backend/src/host/today-tasks.ts:101`（`today_tasks` / `todo_tasks`）。
- **备注**：外键 `work_item_id→work_items(id) ON DELETE CASCADE`、`run_id→task_runs(id) ON DELETE SET NULL`、`message_id→messages(id) ON DELETE SET NULL`。`employee_today_briefs`/`employee_todo_briefs` 对 `artifact_id` 的外键是 `ON DELETE CASCADE`，所以删除产物会连带清掉指针。本表**无 UPDATE 路径**（只追加）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 产物 ID | 唯一标识，由 `nid("art")` 生成，形如 `art_...`；被 `employee_today_briefs.artifact_id`/`employee_todo_briefs.artifact_id` 引用。 |
| `work_item_id` | TEXT | 非空 | 工作项 ID | 外键 `→ work_items(id) ON DELETE CASCADE`；产物归属的任务。 |
| `run_id` | TEXT | 可空 | 运行 ID | 外键 `→ task_runs(id) ON DELETE SET NULL`；发现/规划类的直接写入方传 NULL，会话结束复制类传本次运行 ID。 |
| `artifact_type` | TEXT | 非空 | 产物类型 | 开放取值（无 CHECK）。卡片类 = `messages.kind`：`task_result_card`、`email_card`、`confirm_stage_card`、`inbound_card`、`error_card`；直接写入类：`discovery_brief`、`discovery_spec`、`today_brief`、`today_tasks`、`todo_tasks`。KOL 分析的产物类型标识为 `kol_analyze_brief`（见 `backend/src/routers/kol-memory.ts`；本表内未见直接的插入点，实际落库路径未在代码中确认）。 |
| `message_id` | TEXT | 可空 | 消息 ID | 外键 `→ messages(id) ON DELETE SET NULL`；仅卡片复制类填写，指向来源消息。 |
| `version` | INTEGER | 非空，默认 1 | 产物版本 | 现所有插入点都写死 `1`，未见自增或版本切换逻辑（未在代码中确认后续是否会演进）。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 产物内容（JSON） | 产物正文。卡片类直接复制 `messages.payload`；`discovery_brief` 为发现简报，`discovery_spec` 形如 `{schema:"discovery_spec/v1",...}`，`today_brief` 为今日简报，`today_tasks`/`todo_tasks` 为 `{memory_kind, items, planned_at}`。读取方按 JSON 解析。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，写入时由 `nowIso()` 写入；`GET /api/tasks/:id` 按它升序返回产物列表。 |

---

## 十一、分组 9：技能（12 张表）

技能草稿、版本、用例与运行记录、生命周期与 SOP、技能挂载的连接器与工具。

### skill_drafts — 技能未发布草稿

- **用途**：保存技能包（Published Skill 的 `SKILL.md` 内容或内置技能的 SOP 覆盖文本）的**候选编辑**，不改变目录、运行包和员工当前使用版本；只在「发布上线」流转时由 `applySkillDraft()` 落盘生效。
- **主键 / 唯一约束**：`skill_id`（主键，即技能 id）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/skill-publish.ts`（`saveSkillDraft()` 以 `ON CONFLICT(skill_id) DO UPDATE` 覆盖写入；`applySkillDraft()` 应用后 `DELETE`；`deletePublishedSkill()` 删除技能时连带删除）；`backend/src/routers/misc.ts` 的 `PUT /skills/:id/sop`、`DELETE /skills/:id/sop`、`PUT /admin/skills/:id/draft`、`PATCH /admin/skills/:id` 都经 `saveSkillDraft()` 写入（前三个与 `/skills/:id/sop` 需 PM 角色）。
- **备注**：草稿一旦应用即被删除，因此本表只存「有未应用修改」的技能，最多每技能一行；建表见 `backend/migrations/017_skill_drafts.sql`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `skill_id` | TEXT | 主键，非空 | 技能 ID | 被编辑技能的 id，与技能目录键一致。 |
| `payload` | TEXT | 非空 | 草稿负载 | JSON 对象，存待应用的字段补丁。普通发布技能允许的键为 `title`/`description`/`category`/`profile`/`output`/`funnel`/`mcp`/`required_inputs`/`input_schema`/`result_type`/`result_schema`/`next_actions`/`memory_policy`/`supports`/`permissions`/`actions`/`aliases`/`body`；内置（bundled）技能只允许 `_sop_summary` / `_sop_body` 两个键。每次保存与旧 payload 合并（后者覆盖同名字段），由 `saveSkillDraft()` 写入。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，如 `2026-10-01T12:00:00.000Z`，最近一次保存草稿的时间。 |

### skill_flags — 技能上架标志

- **用途**：记录技能在「技能市场 / 员工可选列表」中的上架（可见）开关，覆盖 `SKILL.md` frontmatter 里的 `in_market` 默认值；无本表行时目录回落到声明值（见 `backend/src/host/skills-catalog.ts` 的 `marketFlags()`）。
- **主键 / 唯一约束**：`id`（主键，即技能 id）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/skill-publish.ts` 的 `setMarketFlag()`（`INSERT ... ON CONFLICT(id) DO UPDATE`），由 `createPublishedSkill()`、`setSkillInMarket()`、`updatePublishedSkill()` 调用；`deletePublishedSkill()` 删除技能时删除本行。
- **备注**：`in_market` 只影响目录展示，不参与运行期鉴权；运行期准入看 `runtime_agent_skills` 与 `skill_lifecycle`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 技能 ID | 技能 id。 |
| `in_market` | INTEGER | 非空，DEFAULT 1 | 是否上架 | 布尔：`1` 上架、`0` 下架。管理端 `PATCH /admin/skills/:id`（`in_market` 字段）或技能创建时写入。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，最近一次改动上架标志的时间。 |

### skill_grants — 技能可见范围授权

- **用途**：管理员在技能治理台配置的**技能可见范围**（组织 / 团队 / 单用户三档），决定员工端技能目录里能看到哪些技能；管理端每保存一次即整表重写该技能的全部授权行。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `skill_id`、`scope_id` 全表扫描（授权表规模小，`visibleSkillIds()` 一次性全表读取）。
- **写入方**：`backend/src/host/grants.ts` 的 `setSkillGrants()`（先 `DELETE FROM skill_grants WHERE skill_id=?` 再逐条 `INSERT`，由 `PUT /admin/skills/:id/grants` 调用）、`seedDirectory()`（以确定性 id `gr_org_<skill_id>` `INSERT OR IGNORE` 为每个内置技能建一条 `org` 授权）；`backend/src/host/skill-publish.ts` 的 `grantDefaultOrg()` 在创建技能时默认授权 `org_litime`；`deletePublishedSkill()` 删除技能时清空本技能授权。
- **备注**：与员工个人技能授权表 `user_skill_grants` 是**不同**的表——本表是目录可见性，`user_skill_grants` 是运行期个人授权（`backend/src/runtime/execution.ts` 的 `userHoldsSkill()`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 授权行 ID | 由 `nid("gr")` 生成的随机 id；种子数据用 `gr_org_<skill_id>`。 |
| `skill_id` | TEXT | 非空 | 技能 ID | 被授权的技能 id，必须在技能目录中存在。 |
| `scope` | TEXT | 非空 | 授权范围类型 | 枚举：`org`（组织）、`team`（团队）、`user`（单个用户），类型定义见 `backend/src/host/grants.ts` 的 `GrantScope`。 |
| `scope_id` | TEXT | 非空 | 范围对象 ID | 当 `scope=org` 时是组织 id（如 `org_litime`）；`scope=team` 时是团队 id（如 `team_kol`）；`scope=user` 时是用户 handle（如 `sriphy`）。写入前会校验对象存在。 |
| `granted_by` | TEXT | 非空 | 授权人 | 操作者 handle（`currentUser().handle`）；种子数据固定为 `sriphy`。 |
| `granted_at` | TEXT | 非空 | 授权时间 | ISO 8601 字符串；整批重写时所有行使用同一时间戳。 |

### skill_lifecycle — 技能生命周期状态

- **用途**：技能的生命周期当前态：所处阶段、来源、负责人、业务阶段标签与标记，是运行期准入（`stage` 必须为 `published`）和技能治理台展示的权威来源。
- **主键 / 唯一约束**：`skill_id`（主键）；无其它唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/skill-lifecycle.ts` 的 `transitionSkillStage()`（阶段流转，`ON CONFLICT(skill_id) DO UPDATE SET stage`）、`updateSkillLifecycleMeta()`（负责人 / 业务阶段 / 标签）、`setSkillOrigin()`（来源）；`backend/src/runtime/store.ts` 的 `bootstrapWorkspacePlanner()` 与 `bootstrapAgentManifestBindings()` 在启动时对受审技能 `INSERT ... WHERE NOT EXISTS` 并把仍为 `draft` 的行提升为 `published`；`backend/src/host/skill-publish.ts` 的 `deletePublishedSkill()` 删行。迁移 `backend/migrations/016_skill_origin.sql` 增加 `origin` 列并回填。
- **备注**：读取方包括 `backend/src/runtime/execution.ts`（阶段非 `published` 即拒绝运行，错误码 `runtime_skill_not_published`）、`backend/src/runtime/skill-coverage.ts`、`backend/src/routers/misc.ts`（`/admin/skills` 列表）。**本表允许缺行**：无行时 `currentStage()` 视作 `draft`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `skill_id` | TEXT | 主键，非空 | 技能 ID | 技能 id。 |
| `stage` | TEXT | 非空，DEFAULT 'draft' | 生命周期阶段 | 枚举：`draft`（新建草稿）、`editing`（编辑配置）、`testing`（测试验证）、`published`（发布上线）、`disabled`（已停用），取值来自 `backend/src/host/skill-lifecycle.ts` 的 `SKILL_STAGES`；合法流转为 draft→editing→testing→published→disabled，允许带原因回退一步。 |
| `owner` | TEXT | 可空 | 负责人 | 管理员在治理台设置的负责人标识（自由文本，前端用输入框填写，未在代码中限定枚举）；可空。 |
| `business_stage` | TEXT | 可空 | 业务阶段 | 管理员填写的业务阶段说明（自由文本，`PATCH /admin/skills/:id/lifecycle` 写入；代码未定义枚举取值）；可空。 |
| `tags` | TEXT | 可空 | 标签 | JSON 字符串数组，例如 `["本地导入"]`；由管理端打标签或 `updateSkillLifecycleMeta()` 写入（`JSON.stringify`）。导入第三方技能时默认写 `["本地导入"]`，第三方来源也通过 `tags` 包含「第三方」的旧数据回填识别（见迁移 016）。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，最近一次阶段或元数据变更时间。 |
| `origin` | TEXT | 非空，DEFAULT 'official' | 来源 | 枚举：`official`（官方）、`third_party`（第三方，如本地 Markdown 导入）。管理员编辑第三方技能内容后会由 `misc.ts` 调 `setSkillOrigin(id, "official")` 转回官方。 |

### skill_sops — 技能 SOP 覆盖层

- **用途**：技能的 SOP（说明 + 正文）覆盖行：内置技能的 `SKILL.md` 内容不可改写，运营在技能页保存的 SOP 改动以本表行覆盖 `SKILL.md` 的 summary/body，并同时刷新运行期技能文件。
- **主键 / 唯一约束**：`id`（主键，即技能 id），每技能最多一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/host/skill-sop.ts` 的 `saveSkillSop()`（`INSERT ... ON CONFLICT(id) DO UPDATE`，写入后调用 `writeRuntimeSkill()` 重写 `data/skills/<id>/SKILL.md`）、`resetSkillSop()`（`DELETE`，恢复内置原文）；`backend/src/host/skill-lifecycle.ts` 的 `rollbackSkillVersion()`（回滚内置技能版本快照时，用快照里的 `.skill-sop-overlay.json` 覆盖或删除本行）；`backend/src/host/skill-publish.ts` 的 `updatePublishedSkill()`（改 `body` 时删行）、`applySkillDraft()`（内置技能草稿经 `saveSkillSop()` 落盘）、`deletePublishedSkill()`（删行）。
- **备注**：缺行表示「未覆盖」，读取方回落 `SKILL.md`（`effectiveSkillBody()` / `effectiveSummary()`）；本表内容参与运行期技能哈希（`backend/src/runtime/execution.ts` 的 `assertRuntimeSkill()`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 技能 ID | 被覆盖的技能 id。 |
| `summary` | TEXT | 非空 | SOP 简介 | 员工面技能说明的短摘要，最长 200 字符（`MAX_SUMMARY`），保存时去首尾空白且不能为空。 |
| `body` | TEXT | 非空 | SOP 正文 | Markdown 正文，最长 32000 字符（`MAX_BODY`），不能为空。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，最近一次保存/覆盖时间；回滚时可能取自版本快照里的 `updated_at`。 |

### skill_stage_history — 技能阶段流转历史

- **用途**：追加式记录每一次技能生命周期阶段变更（含创建时的首条 `null → draft`），供治理台「阶段历史」查看与审计追溯。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `skill_id` 全表过滤并按 `at DESC` 排序。
- **写入方**：`backend/src/host/skill-lifecycle.ts` 的 `transitionSkillStage()`（每次合法流转插入一条，id 前缀 `ssh`）；`backend/src/host/skill-publish.ts` 的 `createPublishedSkill()`（插入 `null → draft`、`reason='created'` 的首条）；`deletePublishedSkill()` 删除技能时清空本技能历史。
- **备注**：本表只追加、不改写（除技能整体删除外）；`from_stage` 与 `to_stage` 取值同 `skill_lifecycle.stage` 的五档枚举。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 记录 ID | 由 `nid("ssh")` 生成。 |
| `skill_id` | TEXT | 非空 | 技能 ID | 发生流转的技能 id。 |
| `from_stage` | TEXT | 可空 | 原阶段 | 流转前阶段；技能创建时的首条记录为 `NULL`。 |
| `to_stage` | TEXT | 非空 | 目标阶段 | 流转后阶段，取值 `draft`/`editing`/`testing`/`published`/`disabled`。 |
| `operator` | TEXT | 非空 | 操作人 | 操作者 handle（`currentUser().handle`）。 |
| `reason` | TEXT | 可空 | 原因 | 流转原因；从 `published` 转 `disabled` 时必填（服务端强制），其余场景可空。 |
| `at` | TEXT | 非空 | 发生时间 | ISO 8601 字符串，流转发生时间。 |

### skill_test_runs — 技能测试运行记录

- **用途**：逐用例记录一次手动测试运行的结果（通过/失败、失败原因、耗时），用于治理台的通过率与最近运行时间统计。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `skill_id` 过滤，并按 `test_id` 取每个用例最新一条（`MAX(id)` 分组）。
- **写入方**：`backend/src/host/skill-lifecycle.ts` 的 `recordSkillTestRun()`（在一个事务里为每个结果插入一行，id 前缀 `str`；由 `POST /admin/skills/:id/tests/run` 调用）；`deleteSkillTest()` 删除用例时按 `test_id` 清掉其运行记录；`deletePublishedSkill()` 删除技能时清空全部记录。
- **备注**：当前版本是「操作员人工判定」，尚未接自动评分（代码注释明确为后续工作）；`test_name` 是写入时的用例名快照，用例改名不影响历史。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 运行记录 ID | 由 `nid("str")` 生成。 |
| `skill_id` | TEXT | 非空 | 技能 ID | 被测技能 id。 |
| `test_id` | TEXT | 可空 | 测试用例 ID | 对应 `skill_tests.id`；服务端写入时必定存在（未知用例直接报 404），用例删除后其运行记录同时被删，故实际不会留下悬空值。 |
| `test_name` | TEXT | 非空 | 用例名快照 | 运行时从 `skill_tests.name` 抄录，供用例删除后仍可读。 |
| `version` | INTEGER | 可空 | 被测版本号 | 请求可选的技能版本号（`skill_versions.version`）；未指定时为 `NULL`。 |
| `passed` | INTEGER | 非空，DEFAULT 0 | 是否通过 | 布尔：`1` 通过、`0` 未通过（写入时由 `r.passed ? 1 : 0` 生成）。 |
| `fail_reason` | TEXT | 可空 | 失败原因 | 未通过时写入请求给的 `fail_reason`，缺省写 `"未通过"`；通过时为 `NULL`。 |
| `ran_by` | TEXT | 可空 | 执行人 | 操作者 handle（`currentUser().handle`），代码中总是写入（列本身允许空）。 |
| `ran_at` | TEXT | 非空 | 运行时间 | ISO 8601 字符串。 |
| `duration_ms` | INTEGER | 可空 | 耗时（毫秒） | 请求可选的单用例耗时；未提供时为 `NULL`。 |

### skill_tests — 技能测试用例

- **用途**：管理员为技能维护的测试用例清单（名称 + 输入 + 期望结果），是「测试验证」阶段的检查项来源。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `skill_id` 过滤并按 `created_at DESC` 排序。
- **写入方**：`backend/src/host/skill-lifecycle.ts` 的 `createSkillTest()`（id 前缀 `st`，由 `POST /admin/skills/:id/tests` 调用）、`deleteSkillTest()`（按 `id` + `skill_id` 双条件删除，并连带删除其 `skill_test_runs`）；`backend/src/host/skill-publish.ts` 的 `deletePublishedSkill()` 删除技能时清空。
- **备注**：用例不参与自动执行，仅作为人工测试勾选清单；`input` / `expected` 为自由文本（前端通常填 JSON 文本），服务端不做 JSON 校验，缺省写空串。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 用例 ID | 由 `nid("st")` 生成。 |
| `skill_id` | TEXT | 非空 | 技能 ID | 所属技能 id。 |
| `name` | TEXT | 非空 | 用例名称 | 必填，去首尾空白后不得为空，否则 400。 |
| `input` | TEXT | 非空，DEFAULT '' | 输入 | 用例输入文本（自由格式），缺省空串。 |
| `expected` | TEXT | 非空，DEFAULT '' | 期望结果 | 期望输出文本（自由格式），缺省空串。 |
| `created_by` | TEXT | 可空 | 创建人 | 创建者 handle（`currentUser().handle`），代码中总是写入。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |

### skill_versions — 技能发布版本

- **用途**：每次技能发布上线时生成的版本快照记录：版本号、快照目录、发布人/时间，支持查看历史与回滚到指定版本。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(skill_id, version)`——同一技能同一版本号只能有一行。
- **关键索引**：`UNIQUE(skill_id, version)` 的隐式唯一索引（用于 `ON CONFLICT(skill_id, version)` 覆盖写与按版本查询）；无其它显式索引。
- **写入方**：`backend/src/host/skill-lifecycle.ts` 的 `publishSkillVersion()`（`INSERT ... ON CONFLICT(skill_id, version) DO UPDATE SET status='published', ...`，同时把技能包 `fs.cpSync` 到 `data/skill-versions/<skill_id>/v<version>`，id 前缀 `sv`）；由 `transitionSkillStage()` 转 `published` 时、以及 `POST /admin/skills/:id/versions` 调用；`rollbackSkillVersion()` 只读并按 `snapshot_path` 恢复文件；`deletePublishedSkill()` 删除该技能全部版本行与快照目录。
- **备注**：存在本表不代表快照文件仍在磁盘上（`rollbackSkillVersion()` 会再校验 `snapshot_path/SKILL.md` 是否存在）；内置技能的额外 SOP 覆盖会以 `.skill-sop-overlay.json` 写进快照目录。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 版本记录 ID | 由 `nid("sv")` 生成；同一 `(skill_id, version)` 重复发布时 id 会被覆盖为新值。 |
| `skill_id` | TEXT | 非空 | 技能 ID | 被发布技能 id。 |
| `version` | INTEGER | 非空 | 版本号 | 单调递增整数，缺省取当前最大值 +1（也可显式传入）。 |
| `status` | TEXT | 非空，DEFAULT 'published' | 版本状态 | 代码中只写入 `published`（发布即生效），所有读取（如 `skill-coverage.ts`、`skill-lifecycle.ts` 取当前版本）都按 `status='published'` 过滤；其它取值未在代码中出现。 |
| `description` | TEXT | 可空 | 版本说明 | 发布时传入的说明（阶段流转场景下为流转原因）；未提供时为 `NULL`。 |
| `snapshot_path` | TEXT | 可空 | 快照目录 | 发布时技能包被复制的绝对路径，通常为 `<dataDir>/skill-versions/<skill_id>/v<version>`；回滚依此路径恢复文件。 |
| `published_by` | TEXT | 可空 | 发布人 | 发布者 handle（`currentUser().handle`），代码中总是写入。 |
| `published_at` | TEXT | 非空 | 发布时间 | ISO 8601 字符串。 |

### runtime_agent_skills — 运行时 Agent 技能绑定

- **用途**：运行期唯一的「Agent → 技能」可执行绑定表。一个 Agent 只有存在且 `enabled=1` 的绑定行，才被允许执行对应技能（`assertRuntimeSkill()`）。
- **主键 / 唯一约束**：`PRIMARY KEY (agent_id, skill_id)` 复合主键；`enabled` 有 `CHECK (enabled IN (0,1))`，`version` 有 `CHECK (version >= 0)`。
- **关键索引**：复合主键的隐式索引（用于按 agent_id 前缀查询）；无显式索引。
- **写入方**：`backend/src/runtime/store.ts` 的 `setAgentSkill()`（经 `versionedUpsert()` 做乐观并发写：版本不符返回冲突）；HTTP 入口 `backend/src/routers/skill-runtime.ts` 的 `PUT /admin/runtime/agents/:agentId/skills/:skillId`（需管理员）；启动引导 `bootstrapWorkspacePlanner()` 与 `bootstrapAgentManifestBindings(db, "agent:kol")` 以 `INSERT ... WHERE NOT EXISTS` 写入 `version=1`（已存在的行包括禁用行一律保留）。建表见 `backend/src/runtime/store.ts` 的 `ensureRuntimeSchema()`，由 `backend/src/app.ts` 启动时调用。
- **备注**：`agent_id` 实际取值形如 `agent:kol`、`agent:workspace-planner`（来自 `agents/*/manifest.yaml` 的 `runtime_agent_id`）；读取方包括 `backend/src/runtime/execution.ts`、`backend/src/runtime/skill-coverage.ts`、`backend/src/routers/runtime-discovery.ts`、`backend/src/costs.ts`。本表无外键（`skill_id` 是目录内的技能 id，不建库级外键）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `agent_id` | TEXT | 非空，复合主键第 1 列 | Agent ID | 运行期 Agent 标识，如 `agent:kol`。 |
| `skill_id` | TEXT | 非空，复合主键第 2 列 | 技能 ID | 被绑定技能 id，写入前由 `assertTaskDefinition()` 校验存在。 |
| `enabled` | INTEGER | 非空，CHECK 取值 0/1 | 是否启用 | 布尔：`1` 启用、`0` 停用。禁用行会被保留且启动引导不会复活。 |
| `version` | INTEGER | 非空，CHECK >= 0 | 乐观并发版本 | 每次写入自增；调用方须提交 `expected_version`，不匹配即拒绝（`runtime governance version conflict`）。首次插入为 `1`。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次写入刷新。 |

### runtime_skill_connectors — 运行时技能连接器绑定

- **用途**：运行期「技能 → 连接器」绑定：技能只有在存在且 `enabled=1` 的连接器绑定、且连接器本身可用时，才被允许调用该连接器的工具。
- **主键 / 唯一约束**：`PRIMARY KEY (skill_id, connector_id)`；`CHECK (enabled IN (0,1))`、`CHECK (version >= 0)`；外键 `connector_id → connectors(id) ON DELETE CASCADE`。
- **关键索引**：复合主键的隐式索引；外键列无独立显式索引（连接器删除时级联删除本表行）。
- **写入方**：`backend/src/runtime/store.ts` 的 `setSkillConnector()`（`versionedUpsert()` 乐观并发，写入前校验技能定义与连接器存在；非测试环境还要求连接器属于受管目录）；HTTP 入口 `backend/src/routers/skill-runtime.ts` 的 `PUT /admin/runtime/skills/:skillId/connectors/:connectorId`，以及 `POST /admin/runtime/connectors/:connectorId/mount-declared` 的 `mountDeclaredTools()`（幂等：已启用行不重写、版本号不涨）。
- **备注**：工具绑定必须先有启用的父连接器绑定（`setSkillTool()` 强制校验）；`connectorInUseBySkill()` 用本表与 `runtime_skill_tools` 联表判断连接器是否被启用技能使用。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `skill_id` | TEXT | 非空，复合主键第 1 列 | 技能 ID | 技能 id，写入前经 `assertTaskDefinition()` 校验。 |
| `connector_id` | TEXT | 非空，复合主键第 2 列 | 连接器 ID | `connectors.id`，外键级联删除。 |
| `enabled` | INTEGER | 非空，CHECK 取值 0/1 | 是否启用 | 布尔：`1` 启用、`0` 停用。 |
| `version` | INTEGER | 非空，CHECK >= 0 | 乐观并发版本 | 每次写入自增，调用方须带 `expected_version`；首次插入为 `1`。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次写入刷新。 |

### runtime_skill_tools — 运行时技能工具绑定

- **用途**：运行期最细粒度的「技能 → 连接器 → 工具」挂载表：只有为某工具显式建了 `enabled=1` 的行，该技能才被允许调用该工具（仅父级连接器绑定不够）。
- **主键 / 唯一约束**：`PRIMARY KEY (skill_id, connector_id, tool_name)`；`CHECK (enabled IN (0,1))`、`CHECK (version >= 0)`；外键 `connector_id → connectors(id) ON DELETE CASCADE`。
- **关键索引**：复合主键的隐式索引；无其它显式索引。
- **写入方**：`backend/src/runtime/store.ts` 的 `setSkillTool()`（`versionedUpsert()` 乐观并发；写入前强制要求父级 Skill→Connector 绑定为启用状态，且 `runtime_tool_policies` 中已有该工具策略，否则 409）；HTTP 入口 `backend/src/routers/skill-runtime.ts` 的 `PUT /admin/runtime/skills/:skillId/tools/:connectorId/:toolName` 与 `mountDeclaredTools()`（按技能声明逐条挂载，已启用行保持不变）。
- **备注**：`connectorInUseBySkill()` 用本表（`t.enabled=1`）联 `runtime_skill_connectors`（`c.enabled=1`）判断连接器是否被启用技能使用，是连接器禁用的前置闸门；工具风险分级（L1/L2/L3）不存本表，存 `runtime_tool_policies`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `skill_id` | TEXT | 非空，复合主键第 1 列 | 技能 ID | 技能 id，写入前经 `assertTaskDefinition()` 校验。 |
| `connector_id` | TEXT | 非空，复合主键第 2 列 | 连接器 ID | `connectors.id`，外键级联删除。 |
| `tool_name` | TEXT | 非空，复合主键第 3 列 | 工具名称 | 连接器上的工具名（写入前须在 `runtime_tool_policies` 中有对应策略，否则拒绝挂载）；长度上限见 `MAX_TOOL_NAME_LENGTH`。 |
| `enabled` | INTEGER | 非空，CHECK 取值 0/1 | 是否启用 | 布尔：`1` 启用、`0` 停用。 |
| `version` | INTEGER | 非空，CHECK >= 0 | 乐观并发版本 | 每次写入自增，调用方须带 `expected_version`；首次插入为 `1`。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次写入刷新。 |

---

## 十二、分组 10：知识（13 张表）

知识分类（主题域族 → 主题域 → 知识库）、知识条目、非结构化资料流水线（2026-10-02：`knowledge_documents` / `knowledge_document_jobs`）、版本、引用、废止、原始素材、抽取作业、提案、授权与绑定。分类只做业务归类，不承载权限（权限仍走 `knowledge_grants` / 品牌 / 组织范围）；知识库分结构化（按键取用的受控条目）与非结构化（资料由 PageIndex 本地模式规整与检索，先接入 PDF）。

### knowledge — 知识条目（Wiki 层）

- **用途**：知识库主表。一条记录是一个知识资产（邮件模板、制度、模式、术语、提问模板），承载「Raw → Wiki → Skill 注入」三层中的 Wiki 层；由管理端上传/提取后经人工审批发布，运行时被技能解析并编译成注入载荷（模板编译为 `subject`/`body_en`/`placeholders`，不让模型读原文正文）。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）；检索与分类过滤在 SQL 层做（`knowledgeWhereClauses` + `list/knowledgeWhereClauses`，base/domain/family 接受 id 或 code），范围/授权/阶段/品牌仍在代码中逐行过滤（`knowledgeListFilters`）。
- **写入方**：`backend/src/host/knowledge.ts` —— `createKnowledge`（新建草稿/直接发布，新建必填 `base_id`）、`editKnowledge`（编辑，版本 +1）、`approveKnowledge`（审批发布并写 `published_version`）、`archiveKnowledge`（归档）、`rollbackKnowledge`（按历史版本生成新草稿）、`handleFeedback`（转修订时置 `status='draft'`）、`seedKnowledge`（内置种子，`id` 形如 `kb_*`，统一落默认结构化库）；`backend/src/routers/knowledge.ts` 暴露上述管理端接口（`POST/PUT/DELETE /admin/knowledge...`）。`backend/src/db.ts` 迁移阶段回填 `published_version` 与分层相关列（`base_id` / `source_body`，见 `knowledge_taxonomy_v1`），不新增业务行。
- **备注**：无数据库外键；与 `knowledge_versions`（版本快照）、`knowledge_citations`（个人启用）、`knowledge_deprecations`（个人隐藏）、`knowledge_grants`（范围授权）、`knowledge_bindings`（技能绑定）逻辑关联，经 `base_id` 归属 `knowledge_bases` → `knowledge_domains`。物理删除仅限 `draft` 且未被已发送邮件引用（`hardDeleteKnowledge`），同时清理 versions/citations/deprecations 三表；`published`/`archived` 只能归档。运行时取用需同时满足四闸：`status='published'` + `in_market=1` + 个人已 cite + 个人未 deprecate + 品牌/范围匹配；且条目所属库必须是结构化库（否则 `assertUsableKnowledge` 以 `knowledge_wrong_base_type` 拒绝、解析器记为跳过原因 `wrong_base_type`）。写入时校验 kind 与库类型匹配，不匹配返回 400 `knowledge_kind_base_mismatch`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 知识 ID | 唯一标识；新建时由 `nid("kb")` 生成，也可显式指定；种子数据为 `kb_followup`、`kb_mail_kol` 等。 |
| `title` | TEXT | NOT NULL | 标题 | 知识标题；邮件模板的标题同时作为 `composerStarter` 前缀展示。 |
| `body` | TEXT | NOT NULL | 正文 | 知识正文（可为中文）；邮件模板的结构化正文在 `body_en`，本列保留原文。 |
| `tags` | TEXT | 可空 | 标签 | 逗号分隔字符串（非 JSON），如 `email_compose,policy`；提问模板带 `pool-question:<slot>,kol-pool`，解析器按前缀识别槽位。 |
| `in_market` | INTEGER | NOT NULL DEFAULT 1 | 是否上架 | 0/1；解析与发送校验要求 `=1`，为 0 时按「已停用知识」拒绝进入会话（`knowledge_disabled`）。 |
| `kind` | TEXT | NOT NULL DEFAULT 'policy' | 知识类型 | 枚举 `mail_template` / `prompt` / `policy` / `pattern` / `glossary` / `question_template`（代码常量 `KNOWLEDGE_KINDS`）；写库前经 `normalizeKind` 校验；各类型的结构化字段与适用库类型见 `config/knowledge-kinds.yaml`。 |
| `skill_id` | TEXT | 可空 | 关联技能 | 归属技能 ID（现值主要是 `email_compose`）；提问模板为空串。 |
| `brand` | TEXT | NOT NULL DEFAULT '*' | 品牌 | 品牌码或 `*` 通配；取值来自品牌 From 白名单（如 `LT`、`RO`）。 |
| `lang` | TEXT | NOT NULL DEFAULT 'en' | 语言 | 知识语言；当前写入恒为 `en`。 |
| `subject` | TEXT | 可空 | 邮件主题模板 | 仅邮件模板使用，含 `[占位符]`；编译时经 `fillTemplate` 填充。 |
| `body_en` | TEXT | 可空 | 英文正文模板 | 仅邮件模板使用；发送时的底稿正文（优先于 `body`）。 |
| `placeholders` | TEXT | 可空 | 占位符列表 | JSON 数组字符串，如 `["[发件邮箱]","[收件邮箱]"]`；由 `placeholdersJson()` 归一化写入，读取时 `parseJsonArray`。 |
| `stage_codes` | TEXT | 可空 | 适用阶段码 | JSON 数组字符串，如 `["INITIAL_CONTACT"]`；空数组代表全阶段适用。取值见 [stage-transitions.json](../config/stage-transitions.json)。 |
| `status` | TEXT | NOT NULL DEFAULT 'draft' | 状态 | 枚举 `draft` / `pending_review` / `published` / `archived`（`KNOWLEDGE_STATUSES`）；由 `normalizeStatus` 校验，只读列表接口只返回 `published`。 |
| `current_version` | INTEGER | NOT NULL DEFAULT 1 | 当前版本号 | 初始 1；每次 `editKnowledge`、`rollbackKnowledge`、反馈转修订时 +1；审批需携带 `expected_version` 与之比对，不一致返回 409。 |
| `created_by` | TEXT | 可空 | 创建人 | 创建者用户 ID（种子为 `system`）。 |
| `approved_by` | TEXT | 可空 | 审批人 | 审批通过时写入审批人用户 ID。 |
| `approved_at` | TEXT | 可空 | 审批时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`）。 |
| `created_at` | TEXT | 可空 | 创建时间 | ISO 8601 字符串；创建时写入，之后不变。 |
| `updated_at` | TEXT | 可空 | 更新时间 | ISO 8601 字符串；编辑、审批、归档、回滚、反馈转修订时刷新。 |
| `effective_at` | TEXT | 可空 | 生效时间 | 由迁移 `012_knowledge_governance` 新增；仅用于展示与筛选，不做自动删除或自动生效。 |
| `expires_at` | TEXT | 可空 | 到期时间 | 同上；到期只做标记与提示，「是否拦截检索/谁续期」在规范中仍是空白项。 |
| `published_version` | INTEGER | 可空 | 已发布版本号 | 当前对外生效的 `knowledge_versions.version` 指针；审批时置为当时的 `current_version`；编辑只加 `current_version` 不动本列，因此使用者始终跟随已批准快照。 |
| `base_id` | TEXT | 可空（新建必填） | 所属知识库 | 指向 `knowledge_bases.id`；新建/搬家时校验库存在、启用且类型允许该 `kind`（否则 400 `knowledge_kind_base_mismatch`）。历史行由迁移回填默认库 `kbase_legacy`。 |
| `source_body` | TEXT | 可空 | 原稿正文 | 新建时默认取当时的 `body`（WeKnora source_content 语义），此后编辑只改 `body`，本列不动；由迁移对历史行按 `body` 回填。 |
| `structured` | TEXT | 可空 | 结构化字段 | JSON 对象字符串，字段表按 `kind` 由 `config/knowledge-kinds.yaml` 定义（`validateStructuredFields` 校验，失败 400 `knowledge_structured_invalid` 带 `errors[]`）；无结构化字段的类型为 NULL。 |

### knowledge_domains — 知识主题域族 / 主题域

- **用途**：知识分类树的两级节点：`level='family'` 是主题域族，`level='domain'` 是主题域（必须挂在族下）。分类只做业务归类，不承载权限（权限仍走 `knowledge_grants` / 品牌 / 组织范围）。
- **主键 / 唯一约束**：`id`（主键）；唯一索引 `knowledge_domains_code` —— `ON knowledge_domains(IFNULL(parent_id,''), code)`，即同一父级下 `code` 唯一（族父级为空，等价全局唯一）。
- **关键索引**：`knowledge_domains_parent` —— `(parent_id, sort)`。
- **写入方**：`backend/src/host/knowledge.ts` 的 `createDomain` / `editDomain`（HTTP `GET/POST/PUT /api/admin/knowledge/domains`，PUT 只改 `name/sort/status/note`，不允许改层级与父级）；`backend/src/db.ts` 迁移一次性建默认 族 `未分类`（`kdom_uncategorized`）→ 域 `未分类`（`kdom_legacy`）。
- **备注**：归档（`status='archived'`）前校验无子域且无知识库，否则 409 `knowledge_domain_in_use`；同父级 code 冲突 409 `knowledge_domain_code_conflict`。审计事件 `knowledge.domain.save`。无数据库外键。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 分类 ID | `nid("kdom")` 生成。 |
| `code` | TEXT | NOT NULL | 编码 | 小写字母开头的 `a-z0-9_`（正则 `^[a-z][a-z0-9_]*$`）；同一父级下唯一。 |
| `name` | TEXT | NOT NULL | 名称 | 展示名。 |
| `level` | TEXT | NOT NULL | 层级 | `family`（族）/ `domain`（域）；域必须带 `parent_id`，族的父级为 NULL。 |
| `parent_id` | TEXT | 可空 | 父级 | 域的父级是族 `id`；族为 NULL。 |
| `sort` | INTEGER | NOT NULL DEFAULT 0 | 排序 | 同层排序；默认分类用 999 置后。 |
| `status` | TEXT | NOT NULL DEFAULT 'active' | 状态 | `active` / `archived`。 |
| `note` | TEXT | 可空 | 备注 | 原样保存。 |
| `created_by` | TEXT | 可空 | 创建人 | 创建者用户 ID。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | NOT NULL | 更新时间 | ISO 8601 字符串。 |

### knowledge_bases — 知识库

- **用途**：域的下一级容器。`kind='structured'` 是结构化库（按键取用的受控条目，本阶段唯一可写入、可被会话/Worker 注入的类型）；`kind='unstructured'` 是非结构化库（占位与接口预留：解析、分块、索引、向量、ASR 未实现，页面显式标注）。
- **主键 / 唯一约束**：`id`（主键）；`code` UNIQUE。
- **关键索引**：`knowledge_bases_domain` —— `(domain_id, status)`。
- **写入方**：`backend/src/host/knowledge.ts` 的 `createBase` / `editBase`（HTTP `GET/POST/PUT /api/admin/knowledge/bases`）；`backend/src/db.ts` 迁移一次性建默认库 `历史知识`（`kbase_legacy`，`code=legacy`，结构化）。
- **备注**：编辑需携带 `expected_version`（不一致 409 `knowledge_base_version_conflict`）并递增 `version`；不允许改 `domain_id` 与 `kind`；结构化库禁止 `external_ref`（400 `knowledge_base_external_ref_forbidden`）；归档库不能写入条目（400 `knowledge_base_archived`）。审计事件 `knowledge.base.save`。无数据库外键。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 知识库 ID | `nid("kbase")` 生成；默认库为 `kbase_legacy`。 |
| `code` | TEXT | NOT NULL，UNIQUE | 编码 | 全局唯一；冲突 409 `knowledge_base_code_conflict`。 |
| `name` | TEXT | NOT NULL | 名称 | 展示名。 |
| `domain_id` | TEXT | NOT NULL | 所属主题域 | 必须是 `level='domain'` 的分类。 |
| `kind` | TEXT | NOT NULL DEFAULT 'structured' | 库类型 | `structured` / `unstructured`；创建后不可改。 |
| `description` | TEXT | 可空 | 说明 | 原样保存。 |
| `owner_user_id` | TEXT | 可空 | 负责人 | 创建时写入 actor，当前不参与权限。 |
| `status` | TEXT | NOT NULL DEFAULT 'active' | 状态 | `active` / `archived`；归档库不再接受新条目。 |
| `settings` | TEXT | NOT NULL DEFAULT '{}' | 设置 | JSON 对象字符串（本阶段仅留位）。 |
| `external_ref` | TEXT | 可空 | 外部引用 | JSON 字符串；预留 WeKnora 等外部知识库引用；结构化库禁止携带。 |
| `version` | INTEGER | NOT NULL DEFAULT 1 | 版本 | 乐观锁；每次编辑 +1，与 `expected_version` 比对。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | NOT NULL | 更新时间 | ISO 8601 字符串。 |

### knowledge_documents — 非结构化资料（P1，2026-10-02）

- **用途**：非结构化库里的一份源文件及其加工状态：`uploaded → normalizing → indexing → pending_review → published → archived`（含 `failed` / `cancelled`）。上传 → 规整（多模态模型 / 直通）→ 索引（PageIndex 本地，经 `backend/tools/pageindex-bridge/` 侧车）→ 待审 → 发布才参与检索（审核后生效）。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：`knowledge_documents_base`（`base_id, status`）、`knowledge_documents_updated`（`updated_at DESC`）。
- **写入方**：`backend/src/host/knowledge-documents.ts` —— `uploadDocument`（落盘 + 建行 + 入队）、流水线执行器（阶段状态与进度）、`publishDocument` / `archiveDocument` / `deleteDocument`（后者级联删作业与本地文件）；HTTP 入口见 `backend/src/routers/knowledge.ts` 的 `/admin/knowledge/documents*`。
- **备注**：无数据库外键。`base_id` 逻辑指向非结构化且 `active` 的 `knowledge_bases`（创建时校验，400 `knowledge_base_not_unstructured` / `knowledge_base_archived`）；P1 只接受 PDF（其余格式 400 `knowledge_format_not_implemented`）。`source_path` 存相对 data 根的路径（越出 data 根时存绝对路径）；`artifacts` 为 JSON：`normalize`（mode/model/留档稿路径/页数/成本）与 `index`（engine/version/doc_id/library/pages）。彻底删除仅限未发布（`published` / `archived` 只能归档）；`normalizing` / `indexing` 需先取消。审计事件 `knowledge.document.upload|normalize|index|retry|cancel|publish|archive|delete`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 资料 ID | `nid("kdoc")` 生成。 |
| `base_id` | TEXT | NOT NULL | 所属知识库 | 必须是非结构化且启用的库。 |
| `title` | TEXT | NOT NULL | 标题 | 默认取文件名（去扩展名）。 |
| `filename` | TEXT | NOT NULL | 文件名 | 清洗后的原始文件名。 |
| `media_type` | TEXT | NOT NULL | 类型 | P1 实际只写入 `pdf`；枚举 `pdf` / `pptx` / `image` / `audio` / `video`（后四类 P2 接入）。 |
| `mime` | TEXT | 可空 | MIME | 浏览器给出的类型，未知为空。 |
| `size_bytes` | INTEGER | NOT NULL DEFAULT 0 | 字节数 | 超过 `KNOWLEDGE_DOC_MAX_BYTES`（默认 512 MiB）时 413。 |
| `source_path` | TEXT | NOT NULL | 原文件路径 | 相对 data 根（例 `knowledge/bases/<base>/documents/<id>/source.pdf`）。 |
| `status` | TEXT | NOT NULL DEFAULT 'uploaded' | 状态 | `uploaded` / `normalizing` / `indexing` / `pending_review` / `published` / `archived` / `failed` / `cancelled`；转移由代码强制（见设计 §5）。 |
| `error` | TEXT | 可空 | 最近失败原因 | 失败时写入；重试/重新加工时清空。 |
| `retry_count` | INTEGER | NOT NULL DEFAULT 0 | 重试次数 | `retryDocument` 每次 +1。 |
| `artifacts` | TEXT | 可空 | 加工产物 | JSON（见备注）。 |
| `created_by` | TEXT | 可空 | 上传人 | 创建者用户 ID。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601。 |
| `updated_at` | TEXT | NOT NULL | 更新时间 | ISO 8601；每次状态/产物变化刷新。 |
| `published_by` | TEXT | 可空 | 发布人 | 审批发布时写入。 |
| `published_at` | TEXT | 可空 | 发布时间 | ISO 8601。 |

### knowledge_document_jobs — 资料加工作业

- **用途**：记录每次「规整 / 索引」尝试（含重试历史与真实进度）。同一时间最多 1 个作业在跑（单并发队列，与 MediaCrawler 同级约束）；`progress_done / progress_total` 只为真实计量单位（音视频分段、扫描件页），索引阶段无细分进度时保持 `0/0` 并在页面写明。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：`knowledge_document_jobs_doc`（`document_id, created_at DESC`）、`knowledge_document_jobs_status`（`status`）。
- **写入方**：仅 `backend/src/host/knowledge-documents.ts`（入队建 `queued` → 执行置 `running` → 终态 `done` / `failed` / `cancelled`）；启动对账把 `running` 置 `failed(interrupted)` 并重新入队 `queued`。
- **备注**：无外键；`document_id` 逻辑指向 `knowledge_documents.id`；删除资料时级联删除本表行。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 作业 ID | `nid("kdjob")` 生成。 |
| `document_id` | TEXT | NOT NULL | 资料 ID | 指向 `knowledge_documents.id`。 |
| `kind` | TEXT | NOT NULL | 作业类型 | `normalize`（规整）/ `index`（索引）。 |
| `status` | TEXT | NOT NULL | 状态 | `queued` / `running` / `done` / `failed` / `cancelled`。 |
| `progress_done` / `progress_total` | INTEGER | NOT NULL DEFAULT 0 | 真实进度 | 分子/分母；`0/0` 表示无细分进度。 |
| `detail` | TEXT | 可空 | 阶段细节 | JSON：`mode`（stub / text-passthrough / scanned-ocr）、模型、备注等。 |
| `error` | TEXT | 可空 | 失败原因 | 失败时写入（人类可读，截断 500 字符）。 |
| `attempt` | INTEGER | NOT NULL DEFAULT 1 | 尝试序号 | 同一资料同一 `kind` 的第几次尝试。 |
| `created_by` | TEXT | 可空 | 触发人 | 资料创建者。 |
| `created_at` | TEXT | NOT NULL | 入队时间 | ISO 8601。 |
| `started_at` | TEXT | 可空 | 开始时间 | `running` 时写入。 |
| `finished_at` | TEXT | 可空 | 结束时间 | 终态时写入。 |

### knowledge_bindings — 知识-技能绑定

- **用途**：管理端配置「哪个技能会取哪一类知识」的选择器；运行时 `resolveForSkill` 读启用中的绑定，命中后按 `ids > 阶段精确 > 品牌精确 > 更新时间` 排序解析，并在命中不到时回退旧的「个人启用集合 + 阶段优先」逻辑。
- **主键 / 唯一约束**：`id`（主键）。无唯一约束（`skill_id` 可重复，同一技能可配多条绑定）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；`bindingRows` 按 `skill_id` / `enabled` 过滤，走全表扫描后排序。
- **写入方**：`backend/src/host/knowledge.ts` 的 `saveBinding`（新增或按 `id` 更新）与 `deleteBinding`；HTTP 入口为 `backend/src/routers/knowledge.ts` 的 `POST/PATCH/DELETE /admin/knowledge/bindings`。
- **备注**：`selector` 是 JSON 对象，只允许键 `ids` / `kinds` / `tags` / `stage_codes` / `brand` / `lang`（`BINDING_SELECTOR_KEYS`）；`kinds` 取值受 `KNOWLEDGE_KINDS` 约束，越界或未知键直接 400。`tag` 匹配为「行 tags 含任一选择器 tag」，`brand` 通配规则为「行 `*` 或相等」。绑定本身不行使权限，命中结果仍要过四闸。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 绑定 ID | 新建时 `nid("kbind")` 生成。 |
| `skill_id` | TEXT | NOT NULL | 技能 ID | 绑定的技能，如 `email_compose`；保存时必填。 |
| `selector` | TEXT | NOT NULL | 选择器 | JSON 对象字符串，如 `{"kinds":["mail_template"],"stage_codes":["QUOTE_PENDING"]}`；写入前经 `normalizeSelector` 规范化并做键白名单校验。 |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | 是否启用 | 0/1；仅 `enabled=1` 参与运行时解析，禁用绑定的命中项会以跳过原因 `binding_disabled` 出现在试算结果里。 |
| `note` | TEXT | 可空 | 备注 | 配置说明文本，原样保存。 |
| `created_by` | TEXT | 可空 | 创建人 | 创建者用户 ID；更新时不改写。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | NOT NULL | 更新时间 | ISO 8601 字符串；每次 `saveBinding` 更新都刷新。 |

### knowledge_citations — 知识个人启用（cite）

- **用途**：记录「某用户个人启用了某条已发布知识」。运行时四闸之一：未 cite 的知识不能进入会话或发送（跳过原因 `not_cited`）；同时用于列表页的 `cited` 标记与 `cite_count` 统计。
- **主键 / 唯一约束**：`PRIMARY KEY (user_id, knowledge_id)`（复合主键，天然去重）。
- **关键索引**：无显式索引（仅有复合主键的隐式索引）；反向按 `knowledge_id` 计数时会全表扫描。
- **写入方**：`backend/src/host/knowledge.ts` 的 `cite`（`INSERT OR REPLACE`）与 `uncite`（删除）；`hardDeleteKnowledge` 会连带删除该知识的所有引用行；`backend/src/db.ts` 的 `migrateSriphyIdentity` 会改写过期用户 ID。
- **备注**：无外键；知识行删除时由代码级联清理。表行数上限即「用户 × 已发布知识」。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键（第 1 列），非空 | 用户 ID | 启用者用户 ID（个人范围，非组织/团队）。 |
| `knowledge_id` | TEXT | 主键（第 2 列），非空 | 知识 ID | 被启用的 `knowledge.id`。 |
| `cited_at` | TEXT | NOT NULL | 启用时间 | ISO 8601 字符串；`cite` 每次调用都会覆盖（`INSERT OR REPLACE`），重复启用会刷新时间。 |

### knowledge_deprecations — 知识个人隐藏与反馈

- **用途**：记录「某用户对某条知识点了隐藏（反馈）」，兼作反馈处置工单。隐藏后该知识对该用户退出解析与发送（跳过原因 `deprecated_by_user`）；管理端按三原因聚合统计，并可逐条处置（转修订 / 归档 / 忽略）。
- **主键 / 唯一约束**：`PRIMARY KEY (user_id, knowledge_id)`（同一用户对同一知识只有一条反馈）。
- **关键索引**：无显式索引（仅有复合主键的隐式索引）。
- **写入方**：`backend/src/host/knowledge.ts` 的 `deprecate`（`INSERT OR REPLACE`，仅写前 5 列）、`undeprecate`（删除）、`handleFeedback`（写 `handled_*` 四列）、`hardDeleteKnowledge`（连带删除）；读取聚合见 `deprecateStats` / `listFeedback`。HTTP 入口 `backend/src/routers/knowledge.ts` 的 `POST/DELETE /knowledge/:id/deprecate` 与 `POST /admin/knowledge/:id/feedback-handle`。
- **备注**：`deprecate` 用 `INSERT OR REPLACE` 重建行，会把已处置的 `handled_*` 清空（重新反馈即回到待处置）；`handleFeedback` 对已处置行返回 409。`deprecateStats` 固定按三个标准原因给零基数，历史别名外的原因会以原值兜底展示。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `user_id` | TEXT | 主键（第 1 列），非空 | 用户 ID | 隐藏者用户 ID。 |
| `knowledge_id` | TEXT | 主键（第 2 列），非空 | 知识 ID | 被隐藏的 `knowledge.id`。 |
| `reason` | TEXT | NOT NULL | 隐藏原因码 | 枚举 `outdated`（内容过时）/ `brand_mismatch`（品牌用不上）/ `pep_risk`（发出去容易被拦）；写入前经 `mapDeprecateReason` 把中文别名归一化，非法值 400。 |
| `reason_note` | TEXT | 可空 | 原因补充 | 用户填写的自由文本备注。 |
| `deprecated_at` | TEXT | NOT NULL | 隐藏时间 | ISO 8601 字符串；`INSERT OR REPLACE` 会刷新。 |
| `handled_at` | TEXT | 可空 | 处置时间 | 由迁移 `012_knowledge_governance` 新增；管理端处置时写入，非空即视为已处置。 |
| `handled_by` | TEXT | 可空 | 处置人 | 处置管理员用户 ID。 |
| `handle_action` | TEXT | 可空 | 处置动作 | 枚举 `to_revision`（转修订，知识回落为 `draft` 并 +1 版本）/ `archive`（归档）/ `ignore`（忽略）；`handleFeedback` 强制校验。 |
| `handle_note` | TEXT | 可空 | 处置备注 | 处置说明文本。 |

### knowledge_extract_jobs — 知识提取作业

- **用途**：记录一次「从 `knowledge_raw` 抽取候选知识」的同步作业。当前实现为同步执行，`queued` 只是插入瞬间的初值，随即被改写为 `done` 或 `failed`。
- **主键 / 唯一约束**：`id`（主键）。无唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）；管理端列表按 `created_at DESC` 排序读取。
- **写入方**：仅 `backend/src/host/knowledge.ts` 的 `extractFromRaw`（插入 `queued` → 更新 `done`/`failed`）；HTTP 入口 `backend/src/routers/knowledge.ts` 的 `POST /admin/knowledge/extract/:raw_id`。
- **备注**：无外键；`raw_id` 逻辑指向 `knowledge_raw.id`，`result_knowledge_id` 逻辑指向新生成的 `knowledge.id`。`extractFromRaw` 抛错时会先把作业置 `failed` 并记录 `error`，再把异常抛给调用方。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 作业 ID | `nid("kjob")` 生成。 |
| `raw_id` | TEXT | NOT NULL | 原始素材 ID | 指向 `knowledge_raw.id`。 |
| `status` | TEXT | NOT NULL | 作业状态 | 取值 `queued`（插入初值，实际不停留）/ `done`（抽取成功并产出候选知识）/ `failed`（抽取抛错）。 |
| `result_knowledge_id` | TEXT | 可空 | 产出知识 ID | 成功时写入新生成的 `knowledge.id`（状态为 `pending_review` 的候选），失败为 NULL。 |
| `error` | TEXT | 可空 | 失败原因 | 失败时写入错误消息文本。 |
| `created_by` | TEXT | 可空 | 触发人 | 触发抽取的管理员用户 ID。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `finished_at` | TEXT | 可空 | 结束时间 | ISO 8601 字符串；`done`/`failed` 时写入，`queued` 期间为 NULL。 |

### knowledge_grants — 知识范围授权

- **用途**：按对象（组织 / 团队 / 用户）收窄一条已发布知识的可见范围。语义是「增量收窄」：某知识只要有授权行，就仅授权范围内的人可见；没有授权行则维持「已发布即可见」。命中结果直接影响列表可见性与运行时 `scope_mismatch` 跳过。
- **主键 / 唯一约束**：`id`（主键）。无唯一约束（同一知识同一 `scope_id` 理论上可重复，但保存路径先整表删除再插入，实际不会重复）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；`canSeeKnowledge` 按 `knowledge_id` 全表扫描。
- **写入方**：`backend/src/host/knowledge.ts` 的 `setKnowledgeGrants`（事务内先 `DELETE FROM knowledge_grants WHERE knowledge_id=?`，再按 org/team/user 三次批量插入，属全量替换）；HTTP 入口 `backend/src/routers/knowledge.ts` 的 `PUT /admin/knowledge/:id/grants`。
- **备注**：无外键；保存前用 `directory()` 校验 `org`/`team` 存在性与 `user` handle 合法性，未知值直接 400。读取侧 `memberScopeIds` 从 `memberships` 取用户的 org/team。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 授权 ID | 每次插入由 `nid("kgr")` 生成。 |
| `knowledge_id` | TEXT | NOT NULL | 知识 ID | 被授权的 `knowledge.id`。 |
| `scope` | TEXT | NOT NULL | 范围类型 | 枚举 `org` / `team` / `user`（`grantsForKnowledge` 按此三分组）。 |
| `scope_id` | TEXT | NOT NULL | 范围对象 ID | `scope='org'` 时为组织 ID（如 `org_litime`），`'team'` 时为团队 ID，`'user'` 时为用户 handle。 |
| `granted_by` | TEXT | 可空 | 授权人 | 执行授权的管理员用户 ID。 |
| `granted_at` | TEXT | NOT NULL | 授权时间 | ISO 8601 字符串；本次替换动作的统一写入时间。 |

### knowledge_proposals — 知识演化提案（shadow）

- **用途**：承载「知识/技能演化」候选与跨品牌转移申请。AI 与管理员只产候选，一律 `profile='shadow'`、人审后才变更状态，永不自动改写生产主文档。`brand_transfer` 审批通过时会复制源知识为一份新的 `pending_review` 知识。
- **主键 / 唯一约束**：`id`（主键）。无唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）；管理端列表按 `created_at DESC` 读取。
- **写入方**：`backend/src/host/knowledge.ts` 的 `proposeEvolve`（插入 `status='pending'`、`profile='shadow'`）、`reviewProposal`（置 `approved`/`rejected` 并写 `reviewed_*`）、`transferBrand`（以 `kind='brand_transfer'` 调 `proposeEvolve`）；HTTP 入口 `backend/src/routers/knowledge.ts` 的 `POST /admin/knowledge/evolve/propose`、`POST /admin/knowledge/evolve/:id/review`、`POST /admin/knowledge/:id/transfer`。
- **备注**：无外键。`kind='brand_transfer'` 时 `to_brand` 必须在品牌 From 白名单中（提案与审批各校验一次）。`reviewProposal` 对非 `pending` 行返回 409；`assertSkillMdUntouched()` 是空实现，仅作「本路径不写生产 SKILL.md」的语义标记。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 提案 ID | `nid("kprop")` 生成。 |
| `kind` | TEXT | NOT NULL | 提案类型 | 枚举 `skill_patch` / `template_patch` / `brand_transfer`（默认 `skill_patch`）；其他值 400。 |
| `skill_id` | TEXT | 可空 | 目标技能 | 相关技能 ID，未填时写空串。 |
| `knowledge_id` | TEXT | 可空 | 目标知识 | 相关 `knowledge.id`，未填时写空串；`brand_transfer` 用它定位复制源。 |
| `from_brand` | TEXT | 可空 | 源品牌 | 跨品牌转移的来源品牌码。 |
| `to_brand` | TEXT | 可空 | 目标品牌 | 跨品牌转移的目标品牌码，须命中品牌 From 白名单。 |
| `proposed_diff` | TEXT | 可空 | 变更说明 | 提案正文/差异描述；`transferBrand` 会写入形如 `transfer brand From whitelist → <品牌>` 的文本。 |
| `status` | TEXT | NOT NULL | 提案状态 | 取值 `pending`（新建）/ `approved`（审批通过）/ `rejected`（否决）；仅 `pending` 可被审。 |
| `profile` | TEXT | NOT NULL DEFAULT 'shadow' | 执行档位 | 固定 `shadow`（影子模式，不直接落生产）；由代码硬编码写入。 |
| `created_by` | TEXT | 可空 | 提交人 | 提案人用户 ID。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `reviewed_by` | TEXT | 可空 | 审核人 | 审核管理员用户 ID；未审为 NULL。 |
| `reviewed_at` | TEXT | 可空 | 审核时间 | ISO 8601 字符串；未审为 NULL。 |
| `reject_reason` | TEXT | 可空 | 否决理由 | 仅拒绝时写入；调用方未给值时写 `rejected`。 |

### knowledge_raw — 知识原始素材（Raw 层）

- **用途**：知识三层中最底层的原始素材池，只由系统写入。来源有两类：管理员上传文件（`upload`）与失败会话留档（`failed_session`）。Raw 正文不进入模型上下文，仅供管理端抽取候选。
- **主键 / 唯一约束**：`id`（主键）。无唯一约束。
- **关键索引**：无显式索引（仅有主键的隐式索引）；管理端列表按 `created_at DESC` 读取。
- **写入方**：`backend/src/host/knowledge.ts` 的 `ingestRaw`（唯一插入点），调用者为其上的 `storeUploadRaw`（上传，落盘到 `data/uploads/knowledge-raw/` 并抽取正文）与 `recordFailedSession`；后者由 `backend/src/host/api.ts`（失败发送留档，`uploaded_by='system'`）调用。HTTP 入口为 `backend/src/routers/knowledge.ts` 的 `POST /admin/knowledge/upload`。
- **备注**：无外键；`session_id` / `task_id` 为逻辑关联。本表未见删除路径（代码中只有查询），属只增不改的素材池。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 素材 ID | `nid("kraw")` 生成。 |
| `source` | TEXT | NOT NULL | 来源 | 枚举 `upload`（管理员上传）/ `failed_session`（失败会话留档）；由调用方传入。 |
| `filename` | TEXT | 可空 | 文件名 | 上传时为清洗后的原始文件名；失败会话时为 `meta.reason` 或 `meta.code`。 |
| `content_type` | TEXT | 可空 | MIME 类型 | 上传时取浏览器给的 `file.type`（缺省 `application/octet-stream`）；失败会话固定 `application/json`。 |
| `body` | TEXT | 可空 | 抽取正文 | 上传件经 `extractTextFromUpload` 抽取的纯文本（md/txt/eml/pdf/docx，超出工具能力时为空）；失败会话为序列化后的 meta 或调用方给定文本。 |
| `path` | TEXT | 可空 | 落盘路径 | 仅上传来源有值，指向 `data/uploads/knowledge-raw/<katt 前缀>_<安全文件名>`。 |
| `uploaded_by` | TEXT | 可空 | 上传人 | 上传者用户 ID；失败会话固定 `system`。 |
| `created_at` | TEXT | NOT NULL | 创建时间 | ISO 8601 字符串。 |
| `session_id` | TEXT | 可空 | 会话 ID | 失败会话留档时关联的会话；上传来源为 NULL。 |
| `task_id` | TEXT | 可空 | 任务 ID | 逻辑关联的任务 ID；当前 `ingestRaw` 的调用点未传值（未在代码中确认有实际写入）。 |
| `meta` | TEXT | 可空 | 元数据 | JSON 对象字符串；上传为 `{ext, bytes}`，失败会话为原始 meta 对象。 |

### knowledge_versions — 知识版本快照

- **用途**：知识每次创建、编辑、审批、归档、回滚、反馈转修订时写入一条不可变快照，构成版本历史；运行时不读 `knowledge` 主行正文，而是按 `knowledge.published_version` 到本表取「已批准快照」编译注入载荷。
- **主键 / 唯一约束**：`id`（主键）。无 `UNIQUE(knowledge_id, version)` 约束（同一知识同一版本号理论上可重复，由代码逻辑保证唯一）。
- **关键索引**：无显式索引（仅有主键的隐式索引）；按 `knowledge_id (+ version)` 查询为全表扫描。
- **写入方**：`backend/src/host/knowledge.ts` 的 `writeVersion`（唯一通用写入点，被 create/edit/approve/archive/rollback/handleFeedback 调用）与 `seedKnowledge`（种子 v1，`note` 形如 `seed policy v1`）；`hardDeleteKnowledge` 按 `knowledge_id` 整批删除版本行。
- **备注**：无外键。`note` 同时是语义标记：只有 `note='approve'`、`'create'` 或 `LIKE 'seed %'` 的版本才被 `publishedSnapshot` 视为可用的已发布快照——`edit`、`archive`、`rollback from v{n}`、`feedback to_revision` 产生的快照不参与发布解析。`tags` / `in_market` / `effective_at` / `expires_at` 四列由 `knowledge_taxonomy_v1` 迁移按所属 `knowledge` 当前值一次性回填（老库），此后随 `writeVersion` 逐次快照。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 版本行 ID | `nid("kv")` 生成；种子为 `kv_<知识ID>_1`。 |
| `knowledge_id` | TEXT | NOT NULL | 知识 ID | 所属 `knowledge.id`。 |
| `version` | INTEGER | NOT NULL | 版本号 | 写入时的 `knowledge.current_version`（种子固定 1）。 |
| `title` | TEXT | 可空 | 标题快照 | 快照时的标题。 |
| `body` | TEXT | 可空 | 正文快照 | 快照时的正文。 |
| `subject` | TEXT | 可空 | 主题快照 | 快照时的邮件主题模板；主行为 NULL 时写空串。 |
| `body_en` | TEXT | 可空 | 英文正文快照 | 快照时的英文正文模板。 |
| `placeholders` | TEXT | 可空 | 占位符快照 | JSON 数组字符串。 |
| `stage_codes` | TEXT | 可空 | 阶段码快照 | JSON 数组字符串。 |
| `skill_id` | TEXT | 可空 | 技能快照 | 快照时的 `skill_id`。 |
| `brand` | TEXT | 可空 | 品牌快照 | 快照时的品牌码。 |
| `lang` | TEXT | 可空 | 语言快照 | 快照时的语言（当前恒为 `en`）。 |
| `kind` | TEXT | 可空 | 类型快照 | 快照时的 `kind`。 |
| `status` | TEXT | 可空 | 状态快照 | 该版本对应的知识状态；发布解析要求 `status='published'`。 |
| `created_by` | TEXT | 可空 | 写入人 | 触发这次快照的操作用户 ID（`writeVersion` 的 actor 参数）。 |
| `created_at` | TEXT | 可空 | 创建时间 | ISO 8601 字符串。 |
| `note` | TEXT | 可空 | 变更备注 | 变更来源标记：`create` / `edit` / `approve` / `archive` / `rollback from v{n}` / `feedback to_revision` / `seed xxx v1`；同时决定该快照能否被发布解析取用。 |
| `tags` | TEXT | 可空 | 标签快照 | 快照时的 `knowledge.tags`。 |
| `in_market` | INTEGER | 可空 | 上架快照 | 快照时的 `knowledge.in_market`；默认 1。 |
| `effective_at` | TEXT | 可空 | 生效时间快照 | 快照时的 `knowledge.effective_at`。 |
| `expires_at` | TEXT | 可空 | 到期时间快照 | 快照时的 `knowledge.expires_at`。 |

---

## 十三、分组 11：连接器运行时治理（13 张表）

连接器配置、凭据、探测、组织范围节点与工具策略/范围绑定。

### runtime_connector_config — 连接器运行时配置

- **用途**：保存每个连接器的运行时接入配置（MCP 或 JSON HTTP 端点、传输方式、超时、凭据**引用**），在探测与执行时被读取；配置里只允许写环境变量名和保险库里的凭据 ID，不允许写明文 header / bearer 值。
- **主键 / 唯一约束**：`connector_id`（主键，同时是 `connectors(id)` 的外键，`ON DELETE CASCADE`）。每连接器最多一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/store.ts` 的 `setConnectorConfig()`（走 `versionedUpsert()` 做乐观锁写入）。调用入口：`backend/src/routers/skill-runtime.ts` 的 `PUT /admin/runtime/connectors/:connectorId/config`（写成功后把连接器置回 `pending_verification` 并要求重新测试）；`backend/src/routers/connector-import.ts`（批量导入 MCP JSON 时以 `expected_version=0` 首次写入）。读取方：`backend/src/runtime/execution.ts`（执行时解析端点与凭据）、`backend/src/worker/runner.ts`（汇总私有环境变量）、`backend/src/routers/enterprise.ts` 的 `connectorRuntimeFacts()`、`backend/src/runtime/credentials.ts` 的 `credentialReferencedByRuntimeConfig()`。
- **备注**：建表语句在 `backend/src/runtime/store.ts` 的 `ensureRuntimeSchema()`；表内 `config_json` 的合法形态由 `validateConnectorConfig()` 强校验（协议只允许 `mcp`/`http`，`transport` 只允许 `streamable-http`/`sse` 且仅 MCP 可用；`url` 与 `url_env` 二选一；无任何凭据引用时必须 `allow_unauthenticated: true`）。删除连接器时本行随 `connectors` 级联删除。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 主键，非空 | 连接器 ID | 取 `connectors.id`；写入前 `setConnectorConfig()` 会校验连接器存在，否则 404。 |
| `config_json` | TEXT | 非空 | 配置 JSON | 校验后配置的序列化文本，可含 `protocol`/`transport`/`url`/`url_env`/`headers_env`/`bearer_env`/`credential_provider`/`credential_account_id`/`allow_unauthenticated`/`timeout_ms`/`headers_secret_refs`/`bearer_secret_ref`/`http_tools`。`url_env`/`headers_env` 存环境变量名，`headers_secret_refs`/`bearer_secret_ref`/`credential_account_id` 存 `runtime_credentials.id`；`credential_provider` 目前只接受 `user-account`；`timeout_ms` 取值 1–120000。 |
| `version` | INTEGER | 非空，`CHECK (version >= 0)` | 配置版本 | 乐观锁版本：首次写入为 `1`，每次成功更新 `+1`；请求必须带 `expected_version`，不匹配返回 409 `runtime governance version conflict`。探测记录会引用该版本号做并发判定。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），每次写入由 `nowIso()` 更新。 |

### runtime_connector_organization_nodes — 连接器组织节点

- **用途**：某个连接器下的组织范围树节点（一级部门 → 二级部门 → 岗位），工具级/连接器级范围绑定都指向这里的节点；节点可由管理员手工新增，也可来自组织同步。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, id)`。外键：`connector_id → connectors(id) ON DELETE CASCADE`；`local_user_id → users(id) ON DELETE SET NULL`。
- **关键索引**：`runtime_connector_org_nodes_parent_idx (connector_id, parent_id, level)`，用于按连接器展开父子层级与按层级取节点。
- **写入方**：`backend/src/runtime/organization.ts` —— `ensureOrganizationScopeSchema()` 建表建索引，`addOrganizationScopeNode()` 插入节点（含层级与父节点校验、`nid("scope")` 生成节点 ID），并对旧库执行 `ALTER TABLE ... ADD COLUMN is_person` 补列与回填。
- **备注**：该模块（`backend/src/runtime/organization.ts`）在当前仓库中**没有被任何已挂载路由导入**（`backend/src/app.ts` 挂载的路由里没有组织范围入口），因此本表及同模块的 `runtime_connector_*_scope_*` / `runtime_tool_*_scope*` 目前只有模块内写入路径，HTTP 入口与初次建表时机未在代码中确认。权限判定语义：`userHasToolScope()` 用递归 CTE 从绑定节点向下展开子树，节点命中规则为 `local_user_id = 用户 id`，或 `is_person = 0 AND level = 3 AND name = users.position`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `id` | TEXT | 非空，复合主键第 2 列 | 节点 ID | 手工新增时由 `nid("scope")` 生成；节点在「同一连接器」内唯一。 |
| `parent_id` | TEXT | 可空 | 上级节点 ID | 同一连接器内的上级节点 `id`；`level=1` 必须为空，`level>1` 必须指向 `level-1` 的节点，否则 400 `runtime_organization_invalid_hierarchy`。 |
| `name` | TEXT | 非空 | 节点名称 | 部门或岗位名称；当节点绑定用户时取该用户的 `users.name`，否则取请求里的名称（≤240 字符）。 |
| `level` | INTEGER | 非空，`CHECK (level IN (1,2,3))` | 层级 | `1` 一级部门、`2` 二级部门、`3` 岗位；绑定人员的节点只允许 `level=3`。 |
| `is_person` | INTEGER | 非空，`DEFAULT 0`，`CHECK (is_person IN (0,1))` | 是否人员节点 | 布尔：`1` 表示该节点代表某个具体人员（写入时 `user_id` 非空）；`0` 表示部门/岗位。旧库补列时按 `local_user_id IS NOT NULL` 回填为 `1`。 |
| `external_id` | TEXT | 非空 | 外部标识 | 外部系统里的标识；绑定用户时写该 `users.id`，手工节点无外部标识时回退为节点自身 `id`。 |
| `local_user_id` | TEXT | 可空 | 本地用户 ID | 已匹配的本地用户，取 `users.id`；为空即未匹配（`getOrganizationScopeSnapshot()` 将其呈现为 `unmatched`）。用户被删除时置 `NULL`（`ON DELETE SET NULL`）。 |
| `synced_at` | TEXT | 非空 | 同步时间 | ISO 8601 字符串，该节点最近一次写入/同步时间。 |

### runtime_connector_organization_sync — 连接器组织同步状态

- **用途**：记录某连接器组织范围最近一次的来源与时间，同时被 `connectorHasOrganizationScopes()` 当作「该连接器已配置过组织范围」的标记之一。
- **主键 / 唯一约束**：`connector_id`（主键，外键 `→ connectors(id) ON DELETE CASCADE`）。每连接器最多一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `addOrganizationScopeNode()`，在同一事务里以 `INSERT ... ON CONFLICT(connector_id) DO UPDATE` 写入（每次手工新增节点都会刷新）。
- **备注**：与 `runtime_connector_scope_modes` 一样是「是否已配置范围」的存在性标记，本身不携带授权信息。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 主键，非空 | 连接器 ID | 取 `connectors.id`。 |
| `source` | TEXT | 非空 | 同步来源 | 来源标识；代码中手工新增组织节点时固定写 `manual-department-position`。其他来源取值（未在代码中确认）。 |
| `synced_at` | TEXT | 非空 | 同步时间 | ISO 8601 字符串，最近一次同步时间。 |

### runtime_connector_probes — 连接器探测记录

- **用途**：管理员每点一次连接器「测试」就追加一行，记录该次探测的类型、结果、工具数与耗时；用于连接器详情页的活动时间线（`GET /admin/runtime/connectors/:connectorId/activity`）。
- **主键 / 唯一约束**：`id`（INTEGER 主键，`AUTOINCREMENT`）。外键：`connector_id → connectors(id) ON DELETE CASCADE`（内联 REFERENCES）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/routers/connector-operations.ts` —— `schema()` 惰性建表；`POST /admin/runtime/connectors/:connectorId/probe` 在探测结束后 `INSERT` 一行，并同步更新 `connectors` 的 `status`/`enabled`/`last_verified_at`/`last_error`。读取方为同文件的 activity 接口。
- **备注**：建表不在 `store.ts`/`organization.ts` 的既有 schema 里，而是由该 router 首次调用时创建。探测只验证「已保存的配置」，**不等于**启用动作：成功后不改变已有启用状态，失败则把连接器置为 `verification_failed` 并关闭 `enabled`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | INTEGER | 主键，非空，自增 | 探测记录 ID | 自增主键，仅用于排序与展示。 |
| `connector_id` | TEXT | 非空 | 连接器 ID | 被测连接器，取 `connectors.id`。 |
| `config_version` | INTEGER | 非空 | 配置版本 | 探测开始前 `runtime_connector_config.version` 的快照；探测途中配置被改动会以 409 `runtime_binding_changed` 失败。 |
| `actor_id` | TEXT | 非空 | 操作人 | 发起探测的管理员用户 ID。 |
| `checked_at` | TEXT | 非空 | 探测时间 | ISO 8601 字符串，探测开始时间（写入时与 `connectors.last_verified_at` 同值）。 |
| `status` | TEXT | 非空 | 探测结果 | 枚举：`succeeded`（无错误码）或 `failed`（有错误码）。 |
| `probe_kind` | TEXT | 非空 | 探测类型 | 枚举：`mcp_tools_list`（MCP 连接器，真实调用工具目录）、`http_definition`（HTTP 连接器，只校验动作定义，不调用外部业务接口）。 |
| `tool_count` | INTEGER | 非空 | 工具数量 | 本次探测取回的工具条数；失败时为 `0`。 |
| `duration_ms` | INTEGER | 非空 | 耗时（毫秒） | 探测从开始到结束的毫秒数。 |
| `error_code` | TEXT | 可空 | 错误码 | 失败时的运行时错误码（`runtimeErrorCode()` 归一化）；成功为 `NULL`。 |

### runtime_connector_scope_bindings — 连接器级范围绑定

- **用途**：连接器级（整连接器）可达范围的逐节点绑定，标记每个组织节点是 `read` 还是 `write`；判断用户可达性时按节点子树递归继承，取子树中最高级别。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, node_id)`。复合外键 `(connector_id, node_id) → runtime_connector_organization_nodes(connector_id, id) ON DELETE CASCADE`。
- **关键索引**：`runtime_connector_scope_bindings_idx (connector_id)`，按连接器取全部绑定（快照与覆盖率统计用）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `replaceConnectorScope()` —— 每次保存先 `DELETE FROM runtime_connector_scope_bindings WHERE connector_id=?` 再逐条插入；`mode='unset'` 时只删不插。
- **备注**：只在 `runtime_connector_scope_policies.mode='selected'` 时参与判定；`mode='all'` 时读取路径直接对所有在职用户返回 `read`，不查本表。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `node_id` | TEXT | 非空，复合主键第 2 列 | 组织节点 ID | 必须是同连接器下已存在的 `runtime_connector_organization_nodes.id`，否则保存时报 400 `runtime_connector_scope_node_unknown`。 |
| `access` | TEXT | 非空，`CHECK (access IN ('read','write'))` | 可达级别 | `read` 只读、`write` 读写；同一用户被多个节点覆盖时取 `write`（子树取 MAX）。 |
| `created_by` | TEXT | 非空 | 设置人 | 执行保存的管理员用户 ID。 |
| `created_at` | TEXT | 非空 | 设置时间 | ISO 8601 字符串；整批重写时所有行使用同一时间戳。 |

### runtime_connector_scope_modes — 连接器工具级范围启用标记

- **用途**：只要某连接器被保存过一次**工具级**范围（`replaceToolScope()`），就写一行作为「已有组织范围配置」的存在性标记，参与 `connectorHasOrganizationScopes()` 判定。
- **主键 / 唯一约束**：`connector_id`（主键，外键 `→ connectors(id) ON DELETE CASCADE`）。每连接器最多一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `replaceToolScope()`，以 `INSERT OR IGNORE` 写入，只在第一次配置时生效。之后不再更新（因此保留的是「首次配置」的人与时间）。
- **备注**：按代码注释，本表属于**工具级**治理；连接器级治理用的是 `runtime_connector_scope_policies`，两者互不写入。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 主键，非空 | 连接器 ID | 取 `connectors.id`。 |
| `created_by` | TEXT | 非空 | 首次配置人 | 第一次保存该连接器工具级范围的管理员用户 ID。 |
| `created_at` | TEXT | 非空 | 首次配置时间 | ISO 8601 字符串，只在插入时写入，后续配置不刷新。 |

### runtime_connector_scope_policies — 连接器级范围策略

- **用途**：保存连接器级可达范围模式——`all`（全体在职用户可读）或 `selected`（按 `runtime_connector_scope_bindings` 的节点授权）；**无本表行 = 未配置（unset）**。
- **主键 / 唯一约束**：`connector_id`（主键，外键 `→ connectors(id) ON DELETE CASCADE`）。每连接器最多一行。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `replaceConnectorScope()`，以 `INSERT ... ON CONFLICT(connector_id) DO UPDATE` 写入 `mode/updated_by/updated_at`；模式置为 `unset` 时 `DELETE` 本行（连同该连接器的 `runtime_connector_scope_bindings`）。
- **备注**：读取侧 `getConnectorScopeSnapshot()` 把无行情况归一化为 `mode: "unset"`、`updated_by/updated_at: null`。`mode='all'` 时覆盖率统计直接取 `users` 表中 `active=1` 的人数（全部计为 read，write 计 0）。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 主键，非空 | 连接器 ID | 取 `connectors.id`。 |
| `mode` | TEXT | 非空，`CHECK (mode IN ('all','selected'))` | 范围模式 | `all` 全体在职用户可读；`selected` 仅绑定节点覆盖的用户（按 `runtime_connector_scope_bindings` 子树判定）。`unset` 不落库，仅存在于读取侧快照。 |
| `updated_by` | TEXT | 非空 | 最后修改人 | 最近一次保存该策略的管理员用户 ID。 |
| `updated_at` | TEXT | 非空 | 最后修改时间 | ISO 8601 字符串。 |

### runtime_connector_tool_inventory — 连接器工具清单

- **用途**：保存发现（探测）得到的外部工具原始清单——工具名、描述、输入 schema 指纹与输入 schema 原文，是工具目录的「发现事实」留档。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, tool_name)`。外键：`connector_id → connectors(id) ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `recordToolInventory()`，以 `INSERT ... ON CONFLICT(connector_id,tool_name) DO UPDATE` 刷新 `description`/`schema_hash`/`input_schema`/`discovered_at`；只登记同时具备 `name`、`schema_hash` 与对象型 `inputSchema` 的条目。该函数在当前仓库中无调用方（未在代码中确认 HTTP 入口）。
- **备注**：**发现不等于授权**——真正决定工具能否被技能挂载的是 `runtime_tool_policies`（`setSkillTool()` 要求策略行存在）。探测路径目前走的是 `backend/src/runtime/tool-catalog.ts` 的 `registerDiscoveredToolPolicies()`，它写 `runtime_tool_policies`，不写本表。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `tool_name` | TEXT | 非空，复合主键第 2 列 | 工具名 | 远端工具的原始名称。 |
| `description` | TEXT | 非空，`DEFAULT ''` | 工具描述 | 远端返回的描述文本；缺失时写空字符串。 |
| `schema_hash` | TEXT | 非空 | Schema 指纹 | 输入 schema 的指纹（64 位十六进制，由运行时哈希函数计算）；本表无格式 `CHECK`（`runtime_tool_policies.schema_hash` 才有）。 |
| `input_schema` | TEXT | 非空 | 输入 Schema | 输入 JSON Schema 的序列化文本。 |
| `discovered_at` | TEXT | 非空 | 发现时间 | ISO 8601 字符串，最近一次登记/刷新时间（一次批量写入共用同一时间戳）。 |

### runtime_credentials — 凭据保险库

- **用途**：服务端凭据保险库，存**加密后**的组织密钥（`organization_secret`）或用户账号令牌（`user_account`）。连接器配置只引用凭据 ID，执行外呼前才解密；元数据接口永不返回密文。
- **主键 / 唯一约束**：`id`（主键，形如 `cred_xxxx`）。表级 `CHECK`：`organization_secret` 必须 `owner_user_id IS NULL`，`user_account` 必须 `owner_user_id IS NOT NULL`。外键：`owner_user_id → users(id) ON DELETE RESTRICT`（有凭据的用户不可直接删除）。
- **关键索引**：`runtime_credentials_owner_idx (owner_user_id, status, updated_at)`，按归属人与状态取凭据。
- **写入方**：`backend/src/runtime/credentials.ts` —— `createCredential()`（`nid("cred")` 生成 ID、AES-256-GCM 加密后插入）、`updateCredentialMetadata()`（只改 `label`/`purpose`/`status`，带 `expected_version` 乐观锁）、`deleteCredential()`（先检查是否被 `runtime_connector_config` 引用，被引用返回 409 `runtime_credential_referenced`）。HTTP 入口 `backend/src/routers/connector-credentials.ts`（`GET/POST /admin/runtime/credentials`、`PUT/DELETE /admin/runtime/credentials/:id`，均需管理员）；导入路径 `backend/src/routers/connector-import.ts` 会把导入 JSON 里的明文 header 值落成 `organization_secret`。
- **备注**：加密密钥来自环境变量 `RUNTIME_CREDENTIAL_MASTER_KEY`（32 字节，hex 或 base64），未配置或非法时保险库整体返回 503；AAD 为 `runtime-credential-v1:<id>:<owner_user_id|organization>`，因此密文与 ID、归属人绑定。解析规则：`status` 必须为 `active`；`user_account` 还要求调用者就是 `owner_user_id` 且该用户 `active=1`，没有「默认账号」回退。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 凭据 ID | 创建时由 `nid("cred")` 生成或调用方显式传入，须匹配 `^cred_[A-Za-z0-9_-]{8,160}$`。 |
| `type` | TEXT | 非空，`CHECK (type IN ('organization_secret','user_account'))` | 凭据类型 | `organization_secret` 组织共享密钥（`owner_user_id` 必须为空）；`user_account` 个人账号令牌（`owner_user_id` 必须有值且为在职用户）。 |
| `owner_user_id` | TEXT | 可空 | 归属用户 | `users.id`；仅 `user_account` 使用。该用户被引用后不可删除（`ON DELETE RESTRICT`）。 |
| `label` | TEXT | 非空，`DEFAULT ''` | 显示名 | 人类可读标签，最长 240 字符；导入时形如「连接器名 · Header 名」。 |
| `purpose` | TEXT | 非空，`DEFAULT ''` | 用途说明 | 自由文本（≤240 字符）；导入路径固定写「由 JSON 导入写入」。 |
| `status` | TEXT | 非空，`CHECK (status IN ('active','disabled'))` | 状态 | `active` 可用于解析；`disabled` 解析时报 403 `runtime_credential_unavailable`。 |
| `ciphertext` | TEXT | 非空 | 密文 | AES-256-GCM 密文的 base64 文本。 |
| `nonce` | TEXT | 非空 | 随机数 | 12 字节随机 nonce 的 base64 文本。 |
| `auth_tag` | TEXT | 非空 | 认证标签 | 16 字节 GCM 认证标签的 base64 文本。 |
| `key_version` | INTEGER | 非空，`CHECK (key_version >= 1)` | 主密钥版本 | 加密所用主密钥版本；当前 `createCredential()` 固定写 `1`，密钥轮换逻辑（未在代码中确认）。 |
| `version` | INTEGER | 非空，`CHECK (version >= 1)` | 版本号 | 乐观锁版本，创建为 `1`，每次元数据更新 `+1`；不匹配返回 409 `runtime_credential_version_conflict`。 |
| `created_by` | TEXT | 非空 | 创建人 | 创建者的用户 ID（管理员）；用于审计，不参与解密鉴权。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，元数据更新时刷新；解密与引用解析不看此字段。 |

### runtime_tool_global_scopes — 工具全局可达标记

- **用途**：标记某连接器下的某个工具对「所有人」可用（工具级范围里的 `all` 形态），与逐节点授权的 `runtime_tool_scope_bindings` 互为替代。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, tool_name)`。外键：`connector_id → connectors(id) ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/organization.ts` 的 `replaceToolScope()` —— 每次保存先按 `connector_id + tool_name` 清空本表与 `runtime_tool_scope_bindings`，再根据 `all` 决定在本表写一行或往绑定表逐条插入。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。
- **备注**：读取侧 `toolHasGlobalScope()` 一旦命中即直接放行（`userHasToolScope()` 的第一道判断），不再查节点绑定；`connectorHasScopedTools()` 用它判断连接器是否有「已启用且有范围」的工具。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `tool_name` | TEXT | 非空，复合主键第 2 列 | 工具名 | 被设为全局可用的工具名（≤320 字符）。 |
| `created_by` | TEXT | 非空 | 设置人 | 执行保存的用户 ID（调用方传入的 actorId）。 |
| `created_at` | TEXT | 非空 | 设置时间 | ISO 8601 字符串。 |

### runtime_tool_policies — 工具策略

- **用途**：按「连接器 × 工具」保存治理策略（是否启用、风险档、访问方向、schema 指纹）；既是技能挂载工具的前置条件，也是运行时的门禁依据（指纹不一致即视为工具不可用）。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, tool_name)`。外键：`connector_id → connectors(id) ON DELETE CASCADE`。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/store.ts` 的 `setToolPolicy()`（走 `versionedUpsert()` 乐观锁）。调用入口：`backend/src/routers/skill-runtime.ts` 的 `PUT /admin/runtime/connectors/:connectorId/tools/:toolName`（管理员手工审批/覆盖）；`backend/src/runtime/tool-catalog.ts` 的 `registerDiscoveredToolPolicies()`（探测成功后自动登记：新工具按 `deriveToolPolicy()` 推导风险，**L3 自动 `enabled=0`**；已有行保留原风险档与启用状态，仅当远端指纹变化时刷新指纹）。读取方：`backend/src/runtime/execution.ts`（暴露前比对风险、方向与指纹）、`backend/src/runtime/skill-coverage.ts`（覆盖度读模型）、`backend/src/routers/enterprise.ts`（`approved_tool_count`）。
- **备注**：风险档口径见 `docs/07-mcp-data-contract.md`（画像读取/邮件读取/爬虫状态 L1，草稿与预览 L2，`sendEmailNow`、`changeLifecycleStage`、联系方式解密、导入、删除按 L3 处理）；推导规则实现于 `backend/src/runtime/tool-catalog.ts` 的 `deriveToolPolicy()`。`setSkillTool()` 要求本表已存在对应行（含已禁用行），否则 409 `tool policy is required before binding a tool`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `tool_name` | TEXT | 非空，复合主键第 2 列 | 工具名 | 远端工具名（≤320 字符）。 |
| `enabled` | INTEGER | 非空，`CHECK (enabled IN (0,1))` | 是否启用 | 布尔：`1` 已批准可用、`0` 未批准（L3 工具自动登记时固定为 `0`）。 |
| `risk` | TEXT | 非空，`CHECK (risk IN ('L1','L2','L3'))` | 风险档 | `L1` 只读直接执行；`L2` 草稿/预览类；`L3` 外发/导入/删除/解密等敏感或不可逆动作，需确认与回执（依据 `docs/07-mcp-data-contract.md`）。 |
| `access` | TEXT | 非空，`CHECK (access IN ('read','write'))` | 访问方向 | 该工具的读写属性，由平台推导或管理员指定。 |
| `schema_hash` | TEXT | 非空，`CHECK (length=64 且仅含 0-9a-f)` | 输入 Schema 指纹 | 64 位小写十六进制；运行时把实际工具 schema 的哈希与之比对，不一致即不暴露该工具。 |
| `version` | INTEGER | 非空，`CHECK (version >= 0)` | 版本号 | 乐观锁版本：首次写入为 `1`，每次成功更新 `+1`；请求方需带 `expected_version`，不匹配返回 409。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串。 |

### runtime_tool_scope_bindings — 工具级范围绑定

- **用途**：把某个工具的可用范围限定到若干组织节点（节点子树继承），是工具级 `selected` 范围的内容表。
- **主键 / 唯一约束**：`PRIMARY KEY (connector_id, tool_name, node_id)`。复合外键 `(connector_id, node_id) → runtime_connector_organization_nodes(connector_id, id) ON DELETE CASCADE`。
- **关键索引**：`runtime_tool_scope_bindings_tool_idx (connector_id, tool_name)`，按工具取绑定节点。
- **写入方**：`backend/src/runtime/organization.ts` 的 `replaceToolScope()` —— 保存时先 `DELETE FROM runtime_tool_scope_bindings WHERE connector_id=? AND tool_name=?`，再对去重后的节点 ID 逐条 `INSERT`；`all=true` 时该表保持为空。当前无已挂载路由调用该模块（见 `runtime_connector_organization_nodes` 备注）。
- **备注**：保存前会校验所有 `node_id` 都属于该连接器已存在的节点，否则 400 `runtime_organization_scope_node_unknown`；`all=true` 与传节点列表互斥（同时传报 400）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `connector_id` | TEXT | 非空，复合主键第 1 列 | 连接器 ID | 取 `connectors.id`。 |
| `tool_name` | TEXT | 非空，复合主键第 2 列 | 工具名 | 被限定范围的工具名。 |
| `node_id` | TEXT | 非空，复合主键第 3 列 | 组织节点 ID | 同连接器下 `runtime_connector_organization_nodes.id`；删除节点时级联删除本行。 |
| `created_by` | TEXT | 非空 | 设置人 | 执行保存的用户 ID（actorId）。 |
| `created_at` | TEXT | 非空 | 设置时间 | ISO 8601 字符串；整批重写共用同一时间戳。 |

### runtime_bootstrap_migrations — 运行时引导迁移记录

- **用途**：记录已在本地库执行过的运行时引导（bootstrap）迁移 ID，保证启动时的引导逻辑幂等——每个 ID 只执行一次。
- **主键 / 唯一约束**：`id`（主键）。无外键。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/runtime/store.ts` —— `bootstrapWorkspacePlanner()` 写 `runtime.workspace-planner.v1`（为平台自带的 `agent:workspace-planner` 挂载 `today_plan`/`todo_plan`/`today_analyze` 三个只读技能），`bootstrapAgentManifestBindings()` 写 `runtime.agent-manifest-bindings.<manifest.id>.<version>`（按已评审的 Agent 清单补齐 Agent→Skill 绑定）。两者都只在 `ensureRuntimeSchema()` 首次初始化时运行，且执行前先查本表跳过已应用的迁移。
- **备注**：引导迁移**只补齐缺失行**，不会覆盖管理员已有的决定（已存在的禁用绑定、生命周期、策略一律保留）；每次成功应用还会向 `audit_events` 写一条 `runtime.workspace_planner.migrated` 或 `runtime.agent_manifest.migrated` 事件。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 迁移 ID | 迁移标识；当前取值形如 `runtime.workspace-planner.v1`、`runtime.agent-manifest-bindings.<manifest.id>.<version>`。 |
| `applied_at` | TEXT | 非空 | 应用时间 | ISO 8601 字符串，该迁移首次成功应用的时间（同一事务内写入）。 |

---

## 十四、分组 12：评测考试（6 张表）

考试、指派、作答、题目、资格与快照。

### exams — 考试题卷

- **用途**：一张「考试题卷」的元数据（标题、合格分、版本、发布状态与生效效果）。管理员在治理端创建，默认 `draft`，发布后可供分配；员工端 `/exams` 的「学习考试」（如「数据安全与最小权限」）即由本表驱动。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/exam.ts` — `createExam()` 新建题卷（`POST /api/admin/exams`，`nid("exm")`，固定写入 `status='draft'`、`version=0`、`published_at=NULL`）；`publishExam()` 在发布事务里把 `status` 改为 `published`、`version` 自增 1、写入 `published_at`（`POST /api/admin/exams/:id/publish`）。
- **备注**：`status='published' 且 version>0` 是代码里判定「题卷已发布」的唯一口径（`isPublishedPaper()`）；只有已发布题卷才能被分配和作答（否则 409 `draft papers cannot assign`）。分配/作答不会修改本表。合格判定对员工授权的影响见 `docs/PRODUCT.md`（PROD-PLAT-04/05/07）与 `docs/org-permissions.md` 的「考试闸门」：`backend/src/host/pep.ts` 的 `enforceSend()` 在未通过必需考试时返回 403 `blocked_exam`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 题卷 ID | 题卷唯一标识，创建时由 `nid("exm")` 生成，形如 `exm_...`。 |
| `title` | TEXT | 非空 | 题卷标题 | 题卷名称，创建时取自请求 `title`，缺省写 `"Exam"`（不做唯一性校验）。 |
| `description` | TEXT | 可空 | 题卷说明 | 题卷描述，创建时取自请求 `description`，缺省写空字符串；前端分配列表中展示。 |
| `active` | INTEGER | 非空，默认 1 | 是否启用 | 0/1 布尔；创建时 `body.active === false` 写 0，否则写 1。仅随 `publicExam()` 原样回传给管理端，未在代码中确认是否参与筛选或阻断逻辑。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，创建题卷时由 `nowIso()` 写入，之后不变。 |
| `status` | TEXT | 非空，默认 `'draft'` | 发布状态 | 枚举：`draft`（草稿，创建时固定写入）、`published`（已发布，仅 `publishExam()` 写入）。发布后不可回退为草稿（代码中无回退路径）。 |
| `pass_score` | INTEGER | 非空，默认 80 | 合格分 | 百分制合格线（0–100，创建时校验，越界返回 400 `invalid pass_score`）。作答评分时用的是发布快照里的同一数值，改本字段不影响已发布版本的成绩判定。 |
| `version` | INTEGER | 非空，默认 0 | 题卷版本 | 0 表示未发布；每次 `publishExam()` 成功自增 1，并与 `exam_snapshots.version` 一一对应。`exam_assignments`/`exam_attempts` 的作答复用该版本号取快照。 |
| `effects` | TEXT | 非空，默认 `'{}'` | 生效效果（JSON） | 创建时由请求体 `effects` 对象序列化写入（非对象则写 `{}`）；`publicExam()` 反序列化后原样返回给管理端。未在代码中确认除返回之外的执行/授权语义（当前未见读取点）。 |
| `published_at` | TEXT | 可空 | 发布时间 | ISO 8601 字符串；创建时为 NULL，仅在 `publishExam()` 发布事务中写入当前时间。 |

### exam_assignments — 考试分配

- **用途**：把某张已发布题卷分配给某个员工（可按需/必需、可设截止时间），是员工「待完成考试」和考试闸门的来源。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(exam_id, user_id)`（同一人对同一题卷只有一条分配）。
- **关键索引**：无显式索引（`UNIQUE(exam_id, user_id)` 提供隐式唯一索引）。
- **写入方**：`backend/src/exam.ts` — `assignExam()`（`POST /api/admin/exams/:id/assign`、`POST /api/admin/exam-assignments`，`nid("exa")`）。仅追加，无更新/删除路径；对已存在的 (exam_id,user_id) 直接返回既有行而不改写。
- **备注**：仅允许分配已发布题卷（`status='published' 且 version>0`），否则 409。外键 `exam_id → exams(id)`（无级联）、`user_id → users(id) ON DELETE CASCADE`。`backend/src/db.ts` 迁移会把遗留用户 `usr_sriphy` 的分配行改挂到 `sriphy`。是否必需由查询 `MISSING_REQUIRED_SQL` 判定（`required=1` 且未通过才算待办）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 分配 ID | 分配唯一标识，创建时由 `nid("exa")` 生成，形如 `exa_...`。 |
| `exam_id` | TEXT | 非空 | 题卷 ID | 外键指向 `exams.id`；写入时必须指向已发布题卷，之后不变。 |
| `user_id` | TEXT | 非空 | 员工 ID | 外键指向 `users.id`；被分配人，写入后不变。 |
| `required` | INTEGER | 非空，默认 1 | 是否必需 | 0/1 布尔；`body.required === false` 写 0，否则写 1。`required=1` 且无通过记录时会计入 `exam_todo_count` 并触发发送闸门。 |
| `due_at` | TEXT | 可空 | 截止时间 | ISO 8601 字符串，取自请求 `due_at`，未传写 NULL；前端仅作展示，未在代码中确认是否有到期强制或逾期阻断逻辑。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，分配时由 `nowIso()` 写入；列表按此倒序/正序排列。 |

### exam_attempts — 考试作答记录

- **用途**：一次作答的全过程记录：开始（`started`）时建立空作答行，提交后由服务端阅卷并置为 `graded`，保存成绩、逐题明细与幂等键。是所有成绩查询与合格判定的数据源。
- **主键 / 唯一约束**：`id`（主键）；部分唯一索引 `exam_attempts_idempotency ON (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != ''`。
- **关键索引**：`exam_attempts_idempotency`（部分唯一索引）用于提交幂等，防止同一员工用同一幂等键重复交卷。
- **写入方**：`backend/src/exam.ts` — `startAttempt()`（`POST /api/exams/:id/start`，`nid("ext")`，写入 `answers='{}'`、`passed=0`、`status='started'`）与 `submitAttempt()`（`POST /api/exams/:id/submit`：有进行中的 `started` 行则 UPDATE，否则 INSERT；写入服务端计算的 `answers/passed/score/total/paper_version/idempotency_key/breakdown_json` 并置 `status='graded'`）。
- **备注**：`passed`、`score`、`total` 一律由服务端按已发布快照阅卷得出，客户端自报的 `passed/score/pass_score` 被忽略（PROD-PLAT-07）。外键 `assignment_id → exam_assignments(id)`（无级联）、`user_id → users(id) ON DELETE CASCADE`。`backend/src/routers/enterprise.ts` 统计用户作答数；`backend/src/db.ts` 迁移会改写遗留用户 `usr_sriphy` 的行。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 作答 ID | 作答唯一标识，开始时由 `nid("ext")` 生成，形如 `ext_...`；提交时复用同一 ID。 |
| `assignment_id` | TEXT | 非空 | 分配 ID | 外键指向 `exam_assignments.id`，标明本次作答对应的分配；写入后不变。 |
| `user_id` | TEXT | 非空 | 员工 ID | 外键指向 `users.id`，作答人；同时参与幂等索引，写入后不变。 |
| `answers` | TEXT | 非空 | 作答内容（JSON） | 开始时 `'{}'`；提交时写 JSON 对象 `{题项id: 归一化答案}`（`yes`/`no` 或自定义选项串）。 |
| `passed` | INTEGER | 非空 | 是否通过 | 0/1 布尔；开始时 0，提交时由服务端按「正确率 ≥ 快照 `pass_score`」计算写入。 |
| `submitted_at` | TEXT | 非空 | 提交时间 | ISO 8601 字符串；开始时先写当前时间，提交时更新为阅卷时间。成绩列表按此倒序。 |
| `status` | TEXT | 非空，默认 `'graded'` | 作答状态 | 枚举：`started`（已开始未提交，由 `startAttempt()` 写入）、`graded`（已阅卷，由 `submitAttempt()` 写入）。仅 `status='graded' AND passed=1` 视为通过。 |
| `score` | INTEGER | 可空 | 得分 | 答对题数；开始时 NULL，提交时写入。 |
| `total` | INTEGER | 可空 | 总分题数 | 本次快照题目总数；开始时 NULL，提交时写入。合格率 = `score/total*100`。 |
| `paper_version` | INTEGER | 非空，默认 0 | 题卷版本 | 本次作答对应的 `exams.version`（取开始时的版本，保证改卷后仍用旧快照）；开始时写入。 |
| `idempotency_key` | TEXT | 可空 | 幂等键 | 客户端提交时传入的幂等键；为空/NULL 时不计入部分唯一索引。提交前按 (user_id, key) 查已 `graded` 记录，命中则直接返回旧结果。 |
| `started_at` | TEXT | 可空 | 开始时间 | ISO 8601 字符串；开始与提交时都写入当前时间。查询「进行中作答」时按 `started_at DESC` 取最近一条。 |
| `breakdown_json` | TEXT | 可空 | 逐题明细（JSON） | 提交时写入数组 `[{id, prompt, kind, chosen, correct}]`；开始时为 NULL。结果接口原样返回。 |

### exam_items — 题卷题目

- **用途**：题卷下的单道题目：题干、题型、选项、标准答案、是否采纳、来源（手工录入或按已发布知识生成）。只有全部题目被采纳后题卷才能发布。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **写入方**：`backend/src/exam.ts` — `addManualItem()`（`POST /api/admin/exams/:id/items`，`nid("exi")`，`source='manual'`、`accepted=0`）；`generateCandidates()`（`POST /api/admin/exams/:id/generate`，按已发布知识切句批量插入，`source='generated'`、`kind='true_false'`、`answer='yes'`、`accepted=0`）；`acceptItem()`（`POST /api/admin/exam-items/:id/accept`，`UPDATE ... SET accepted=1`）。
- **备注**：外键 `exam_id → exams(id)`（无级联，代码未做级联删除）。`knowledge_id` 无外键约束，仅在生成时记录来源知识 ID。生成题目是候选（`live: false`），未采纳不得进入发布快照（PROD-PLAT-04/05）。发布后 `exam_items` 仍可继续改动，但已发布版本的成绩以 `exam_snapshots` 为准。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 题目 ID | 题目唯一标识，由 `nid("exi")` 生成，形如 `exi_...`。 |
| `exam_id` | TEXT | 非空 | 题卷 ID | 外键指向 `exams.id`，所属题卷；写入后不变。 |
| `knowledge_id` | TEXT | 可空 | 来源知识 ID | 手工录入时取请求 `knowledge_id`（无则 NULL）；生成时写来源 `knowledge.id`。无外键约束。 |
| `prompt` | TEXT | 非空 | 题干 | 题目正文，必填（为空返回 400 `prompt required`）；生成题目的题干形如「根据已发布知识「标题」：<句子> 该陈述是否符合现行制度？」。 |
| `kind` | TEXT | 非空，默认 `'true_false'` | 题型 | 枚举：`true_false`（判断题，选项固定 `[{id:"yes",label:"是"},{id:"no",label:"否"}]`）、`choice`（选择题，选项来自请求 `options`）。其他取值返回 400 `invalid item kind`。 |
| `options_json` | TEXT | 非空，默认 `'[]'` | 选项（JSON） | 选项数组 `[{id,label}]`；判断题写入固定两项，选择题写入请求提供的非空数组（为空返回 400 `options required`）。 |
| `answer` | TEXT | 非空 | 标准答案 | 标准答案字符串；判断题归一化为 `yes`/`no`（缺省 `yes`），选择题取请求 `answer` 去空格（为空返回 400 `answer required`）。阅卷时与作答归一化后比对。 |
| `accepted` | INTEGER | 非空，默认 0 | 是否采纳 | 0/1 布尔；插入时固定 0，仅 `acceptItem()` 置 1。发布时要求该题卷所有题目 `accepted=1`，否则 409 `unaccepted items cannot publish`；快照只取 `accepted=1` 的题目。 |
| `source` | TEXT | 非空，默认 `'manual'` | 题目来源 | 枚举：`manual`（管理员手工录入，默认值）、`generated`（由已发布知识生成，仅 `generateCandidates()` 写入）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，插入时由 `nowIso()` 写入；题目与快照均按 `created_at, id` 排序。 |

### exam_qualifications — 考试资格

- **用途**：员工通过考试后授予的资格记录（谁、在哪个题卷哪个版本、以哪次作答通过、何时授予），是「通过」的持久凭证；重考通过会覆盖同一 (user_id, exam_id, paper_version) 的旧记录。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(user_id, exam_id, paper_version)`（同一人对同一题卷同一版本只有一条资格）。
- **关键索引**：无显式索引（`UNIQUE(user_id, exam_id, paper_version)` 提供隐式唯一索引）。
- **写入方**：`backend/src/exam.ts` — `submitAttempt()`：仅当服务端阅卷 `graded.passed` 为真时，在同一事务里 `INSERT ... ON CONFLICT(user_id, exam_id, paper_version) DO UPDATE` 更新 `attempt_id/passed/score/total/awarded_at`；未通过不写。
- **备注**：外键 `user_id → users(id) ON DELETE CASCADE`、`exam_id → exams(id)`。代码中暂未见读取本表的查询（通过与否由 `exam_attempts` 实时派生），本表是留痕凭证；未在代码中确认其是否参与授权判定。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 资格 ID | 资格唯一标识，授予时由 `nid("exq")` 生成，形如 `exq_...`。 |
| `user_id` | TEXT | 非空 | 员工 ID | 外键指向 `users.id`，被授予人；参与唯一约束。 |
| `exam_id` | TEXT | 非空 | 题卷 ID | 外键指向 `exams.id`，通过的是哪张题卷；参与唯一约束。 |
| `assignment_id` | TEXT | 可空 | 分配 ID | 通过时所用的分配 ID（提交时传入），无外键约束。 |
| `attempt_id` | TEXT | 可空 | 作答 ID | 通过的那次 `exam_attempts.id`；重考通过时被覆盖（`excluded.attempt_id`）。 |
| `paper_version` | INTEGER | 非空 | 题卷版本 | 通过时对应的 `exams.version`；参与唯一约束，改卷后新版本会另生成一条资格。 |
| `passed` | INTEGER | 非空 | 是否通过 | 0/1 布尔；写入恒为 1（仅在通过分支插入），无写 0 的路径。 |
| `score` | INTEGER | 可空 | 得分 | 通过那次作答的答对题数（来自服务端阅卷）。 |
| `total` | INTEGER | 可空 | 总分题数 | 通过那次作答的总题数。 |
| `awarded_at` | TEXT | 非空 | 授予时间 | ISO 8601 字符串，阅卷通过时写入当前时间；重考通过时更新为新时间。 |

### exam_snapshots — 题卷发布快照

- **用途**：题卷每次发布时冻结的一份不可变题卷（版本、合格分、当时已采纳的全部题目），供作答取题与阅卷使用；保证发布后改题不影响已发布成绩的判定。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(exam_id, version)`（同一题卷同一版本只有一份快照）。
- **关键索引**：无显式索引（`UNIQUE(exam_id, version)` 提供隐式唯一索引）。
- **写入方**：`backend/src/exam.ts` — `publishExam()`（`POST /api/admin/exams/:id/publish`，`nid("exs")`）：先校验题目非空且全部已采纳，再在同一事务里插入快照并把 `exams` 置为 `published`、版本自增。只增不改不删。
- **备注**：外键 `exam_id → exams(id)`（无级联）。读取方为 `loadSnapshot()`：按 (exam_id, version) 取快照，缺失或题目为空则 409 `published snapshot not found`。`items_json` 为 `exam_items` 中 `accepted=1` 题目的冻结副本（含 `id/knowledge_id/prompt/kind/options/answer`）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 快照 ID | 快照唯一标识，发布时由 `nid("exs")` 生成，形如 `exs_...`。 |
| `exam_id` | TEXT | 非空 | 题卷 ID | 外键指向 `exams.id`；与 `version` 组成唯一键。 |
| `version` | INTEGER | 非空 | 版本号 | 等于发布后 `exams.version`（原版本 + 1）；作答提交按 `exam_attempts.paper_version` 取对应快照。 |
| `pass_score` | INTEGER | 非空 | 合格分 | 发布时刻 `exams.pass_score` 的冻结值，阅卷时以此判定是否通过。 |
| `items_json` | TEXT | 非空 | 题目快照（JSON） | 冻结的题目数组 `[{id,knowledge_id,prompt,kind,options,answer}]`，只含发布时已采纳题目；为空视为无题卷（409）。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，发布时由 `nowIso()` 写入，之后不变。 |

---

## 十五、分组 13：成本·定时任务·记忆简报（8 张表）

成本预算与事件、定时任务与运行、记忆条目与今日/待办简报。

### cost_budgets — 成本预算

- **用途**：为「公司 / Agent / 员工个人」三个范围按自然月配置 token 预算与警示、硬停阈值；管理员在成本治理面维护，运行前由预算闸门读取判定是否放行。
- **主键 / 唯一约束**：`PRIMARY KEY (scope, scope_ref)`。
- **关键索引**：无显式索引（仅有复合主键的隐式索引）。
- **写入方**：`backend/src/costs.ts` 的 `upsertBudget()`（INSERT … ON CONFLICT(scope, scope_ref) DO UPDATE，版本号 +1），由 `backend/src/routers/costs.ts` 的 `PUT /admin/costs/budget` 调用（需管理员）。
- **备注**：`scope_ref` 的取值口径：`company` → `config/org-registry.yaml` 中第一个公司 id（读取失败退化为 `primary`，见 `companyScopeRef()`）；`agent` → `agent_id`；`user` → `users.id`。`version` 为乐观锁，写入口要求携带 `expected_version`，冲突返回 `cost_budget_version_conflict`。运行前闸门 `budgetBlockFor()` 按 公司 → Agent → 员工 顺序判定，只拦硬停。金额/价格不在本表。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `scope` | TEXT | 主键（联合），非空 | 预算范围 | 枚举 `company` / `agent` / `user`，表示预算作用在哪一级；写入口校验非法值返回 400。 |
| `scope_ref` | TEXT | 主键（联合），非空 | 范围引用 | 与 `scope` 配套的对象标识：公司 id、`agent_id` 或 `users.id`；写入口要求非空。 |
| `limit_tokens` | INTEGER | 可空 | 月度 token 上限 | 当月 token 预算上限，正整数；为 NULL 表示未配置（状态 `unconfigured`，不拦截）。 |
| `warn_percent` | INTEGER | 非空，默认 80 | 警示阈值百分比 | 用量达到上限的该百分比时进入 `warn` 展示态；取值 0–100 的整数，且不得大于 `hard_stop_percent`。 |
| `hard_stop_percent` | INTEGER | 非空，默认 100 | 硬停阈值百分比 | 用量达到上限的该百分比时拒绝新运行；取值 0–100 的整数，必须 ≥ `warn_percent`。 |
| `enabled` | INTEGER | 非空，默认 1 | 是否启用 | 0/1 布尔：0 时状态为 `disabled`，只展示百分比不拦截运行。 |
| `version` | INTEGER | 非空，默认 0 | 版本号 | 乐观锁版本；新建为 0，每次成功更新在事务内 +1，用于检测并发覆盖。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串（如 `2026-10-01T12:00:00.000Z`），每次 upsert 写入当前时间。 |
| `updated_by` | TEXT | 可空 | 最后修改人 | 写入者身份（管理员 `user.id`，即 API 的 `actor`）；由 `upsertBudget()` 落库。 |

### cost_events — 成本用量事件

- **用途**：逐次记录模型线程的 token 用量估计与归属（公司 / Agent / 员工 / 技能 / 会话 / 工作项 / 线程），是月度汇总与预算判定的唯一事实来源。
- **主键 / 唯一约束**：`id`（主键）。无其他唯一约束。
- **关键索引**：`cost_events_window (occurred_at)`（跨范围按月取数）；`cost_events_agent_window (agent_id, occurred_at)`（Agent 维度月度汇总）；`cost_events_user_window (user_id, occurred_at)`（员工维度月度汇总，随 `user_id` 列在 `migrateSchema()` 中追加）。
- **写入方**：`backend/src/costs.ts` 的 `recordCostEvent()`，由同文件 `captureThreadUsage()` 在 app-server `account/usage/read` 返回可解析用量后调用；采集失败只写会话 `contract_log`，绝不 throw。
- **备注**：用量为**估计值**，`source` 常量 `COST_SOURCE_THREAD_USAGE = "codex_account_usage_estimated"`。`cost_cents` 在缺少版本化价格来源时恒为 NULL，不得以估算金额冒充（PROD-PLAT-08）。月度窗口按 `Asia/Shanghai`（`+08:00`）计算，`occurred_at >= start AND < end`。`raw` 原样保留 `account/usage/read` 响应，入库前截断到 2000 字符。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，可空列定义（SQLite 主键） | 事件 ID | 唯一标识，`nid("cost")` 生成（`cost_` 前缀）。 |
| `occurred_at` | TEXT | 非空 | 发生时间 | ISO 8601 字符串；采集时可传入 `occurredAt`，否则取写入时的 `nowIso()`。月度汇总按此列过滤。 |
| `agent_id` | TEXT | 可空 | Agent ID | 归属 Agent；Agent 维度预算与汇总按此列聚合。 |
| `skill_id` | TEXT | 可空 | 技能 ID | 产生用量的技能标识。 |
| `session_id` | TEXT | 可空 | 会话 ID | 归属的 `sessions.id`。 |
| `run_id` | TEXT | 可空 | 运行 ID | 归属的技能/任务运行标识。 |
| `work_item_id` | TEXT | 可空 | 工作项 ID | 归属的 `work_items.id`。 |
| `task_run_id` | TEXT | 可空 | 任务运行 ID | 归属的任务运行标识。 |
| `thread_id` | TEXT | 可空 | 线程 ID | app-server 线程 id，`account/usage/read` 的查询键。 |
| `project_id` | TEXT | 可空 | 项目 ID | 归属项目标识（调用方传入）。 |
| `source` | TEXT | 非空 | 用量来源 | 用量采集来源常量；当前只写 `codex_account_usage_estimated`。 |
| `provider` | TEXT | 可空 | 模型提供方 | 从 `account/usage/read` 响应解析（`provider` 字段），解析不到为 NULL。 |
| `model` | TEXT | 可空 | 模型名 | 从 `account/usage/read` 响应解析的模型标识，解析不到为 NULL。 |
| `input_tokens` | INTEGER | 可空 | 输入 token 数 | 线程输入（prompt）token 数；不可用时 NULL（不以 0 冒充）。 |
| `output_tokens` | INTEGER | 可空 | 输出 token 数 | 线程输出（completion）token 数；不可用时 NULL。 |
| `total_tokens` | INTEGER | 非空，默认 0 | 总 token 数 | 总用量；优先取响应的 total，缺省时回退为 `input_tokens + output_tokens`（各按 0 计）。 |
| `cost_cents` | INTEGER | 可空 | 费用（分） | 预留金额字段；缺版本化价格来源时恒为 NULL，不写估算金额。 |
| `raw` | TEXT | 可空 | 原始响应 | `account/usage/read` 返回的 JSON 文本，入库前 `slice(0, 2000)`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，写入时的 `nowIso()`。 |
| `user_id` | TEXT | 可空 | 员工 ID | 用量归属的员工 `users.id`；由 `migrateSchema()` 追加列并建 `cost_events_user_window` 索引，用于个人预算判定与汇总。 |

### cron_jobs — 定时作业定义

- **用途**：持久化定时作业（平台内置系统作业 + 员工自建作业），保存调度表达式、执行身份、适用范围、生效条件、重试与接管策略，是 `cron_runs` 的定义来源。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(job_key)`。
- **关键索引**：`cron_jobs_status_next (status, next_run_at)`，供调度器扫描到期的已发布作业。
- **写入方**：`backend/src/cron/store.ts` 的 `ensureSystemCronJobs()`（`INSERT OR IGNORE` 写入 5 个内置作业：`overdue-scan`、`daily-task-snapshot`、`ownership-release`、`discovery-search`、`mail-memory-increment`）；`backend/src/routers/cron.ts` 的 `POST /cron/jobs` 与 `PATCH /cron/jobs/:id` 负责创建与修改；`backend/src/cron/worker.ts` 在入队/收尾时更新 `next_run_at`、`last_run_at`、`last_terminal_status`。
- **备注**：DDL 见 `backend/migrations/005_cron_jobs.sql`，与 `backend/src/db.ts` 中同名 `CREATE TABLE IF NOT EXISTS` 等价。`status` 枚举：`draft` / `published` / `paused` / `disabled`（`PATCH` 校验并拒绝其他值；`paused`/`disabled` 时清空 `next_run_at`）。`handler_key` 枚举：`overdue-scan` / `daily-task-snapshot` / `ownership-release` / `discovery-search` / `mail-memory-increment` / `ai-task`。系统作业（`owner_account_id` 为空或 `execute_as = 'system'`）的 `handler_key`/`execute_as`/`job_key`/`capability_expert_id`/`owner_account_id` 为法定只读字段。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键 | 作业 ID | 唯一标识，`nid("cjob")` 生成；内置作业使用固定 id（如 `cjob_overdue_scan`）。 |
| `job_key` | TEXT | 非空，唯一 | 作业键 | 人可读的稳定键（如 `overdue-scan`）；唯一约束保证幂等，`jobById()` 可按 id 或 job_key 查询。 |
| `title` | TEXT | 非空 | 作业名称 | 展示名称；系统作业只读，员工作业可由 `PATCH` 修改。 |
| `owner_account_id` | TEXT | 可空 | 归属账户 ID | 作业归属者；为空（或空串）表示系统作业，`isSystemJob()` 据此判定。 |
| `execute_as` | TEXT | 非空 | 执行身份 | 执行主体：系统作业为 `"system"`（`SYSTEM_EXECUTE_AS`），员工作业为归属者 id 或 `"employee"`；同时作为 handler 的 `actor` 与审计主体。 |
| `capability_expert_id` | TEXT | 可空 | 能力专家 ID | 执行该作业的能力专家；缺省 `expert:kol`（`DEFAULT_EXPERT`）。 |
| `handler_key` | TEXT | 非空 | 处理器键 | 枚举 `overdue-scan` / `daily-task-snapshot` / `ownership-release` / `discovery-search` / `mail-memory-increment` / `ai-task`；写入口用 `isCronHandlerKey()` 校验，未登记即 400。 |
| `scope_json` | TEXT | 非空，默认 `'{}'` | 适用范围（JSON） | JSON 文本，如 `{"applies":"employee_authorized","label":"适用于我的授权范围"}`；限定作业作用于哪些员工/数据范围。 |
| `condition_json` | TEXT | 非空，默认 `'{}'` | 生效条件（JSON） | JSON 文本，含 handler 专属条件与可选的 `schedule`（`kind=once`/`interval` 及 `once_at`/`interval_minutes`）；系统作业该字段只读。 |
| `cron_expr` | TEXT | 非空 | cron 表达式 | 5 段 cron（如 `0 8 * * *`）；修改会递增 `published_rev` 并重算 `next_run_at`。 |
| `timezone` | TEXT | 非空，默认 `'Asia/Shanghai'` | 时区 | 调度所用时区，默认 `Asia/Shanghai`；修改会递增 `published_rev`。 |
| `status` | TEXT | 非空，默认 `'draft'` | 状态 | 枚举 `draft` / `published` / `paused` / `disabled`；只有 `published` 且 `next_run_at` 到期的作业会被入队。 |
| `retry_policy_json` | TEXT | 非空，默认 `'{}'` | 重试策略（JSON） | JSON 文本，默认 `{"max_attempts":1,"backoff_sec":0}`（`DEFAULT_RETRY`）。 |
| `takeover_policy_json` | TEXT | 非空，默认 `'{}'` | 接管策略（JSON） | JSON 文本，默认 `{"after_minutes":30,"action":"needs_takeover"}`；超过 `after_minutes` 仍 `running` 的运行会被标记 `needs_takeover`。 |
| `published_rev` | INTEGER | 非空，默认 1 | 发布版本 | 作业定义修订号；`cron_expr`/`timezone`/`scope`/`condition` 任一变更即 +1，初始为 1。 |
| `next_run_at` | TEXT | 可空 | 下次执行时间 | ISO 8601 字符串；按 `cron_expr`+`timezone`+`condition.schedule` 计算，非 `published` 时清空。 |
| `last_run_at` | TEXT | 可空 | 上次执行时间 | ISO 8601 字符串，由 worker 在运行收尾时写入。 |
| `last_terminal_status` | TEXT | 可空 | 上次终态 | 最近一次运行的终态：`succeeded` / `failed` / `skipped` / `needs_takeover`，由 worker 写回。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串；任何创建/修改/调度推进都会刷新。 |

### cron_runs — 定时作业运行

- **用途**：一次作业触发对应一行，记录排队、开始、结束时间与终态、错误、回执和产物引用，是定时作业的执行流水与审计依据。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(job_id, scheduled_for)`（保证同一时间槽只入队一次）。
- **关键索引**：`cron_runs_job (job_id, created_at)`（按作业查运行历史）；`cron_runs_status (status, scheduled_for)`（扫描 queued/running 与过期运行）。
- **外键**：`job_id` → `cron_jobs(id) ON DELETE CASCADE`（删除作业级联删除其运行记录）。
- **写入方**：`backend/src/cron/worker.ts`：`enqueueDueJobs()` / `enqueueManualRun()` 插入 `queued` 行，随后 `UPDATE … status='running'` 认领；`executeCronRun()` 写入终态、错误、回执与 `session_id`；`markStaleRunning()` 将超时 `running` 标为 `needs_takeover`（`error_code='stale_run'`）。
- **备注**：`status` 枚举：`queued` / `running` / `succeeded` / `failed` / `skipped` / `needs_takeover`（终态集合 `TERMINAL` 在 worker 中定义，非终态一律回落为 `failed`）。`trigger` 枚举：`schedule`（定时到期）与 `manual`（人工触发，`scheduled_for` 形如 `<ISO>#<runId>`）。除 `ai-task` 的 handler 外，运行结束会清空 `session_id`——定时作业不得创建会话。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键 | 运行 ID | 唯一标识，`nid("crun")` 生成（`crun_` 前缀）。 |
| `job_id` | TEXT | 非空，外键 | 作业 ID | 指向 `cron_jobs.id`；级联删除。 |
| `trigger` | TEXT | 非空 | 触发方式 | 枚举 `schedule`（到期自动入队）/ `manual`（人工触发）。 |
| `status` | TEXT | 非空，默认 `'queued'` | 运行状态 | 枚举 `queued` / `running` / `succeeded` / `failed` / `skipped` / `needs_takeover`；由 worker 用条件 UPDATE 翻转，保证多 worker 下只有一个能认领。 |
| `scheduled_for` | TEXT | 非空 | 计划执行时间 | 计划槽位时间：定时触发为 `job.next_run_at`，人工触发为 `<nowIso>#<runId>`；与 `job_id` 组成唯一键防止重复入队。 |
| `started_at` | TEXT | 可空 | 开始时间 | ISO 8601 字符串，`queued → running` 认领时写入。 |
| `finished_at` | TEXT | 可空 | 结束时间 | ISO 8601 字符串，进入任一终态时写入。 |
| `error_code` | TEXT | 可空 | 错误码 | 失败/接管原因码，如 `unknown_handler`、`handler_error`、`stale_run`；成功为 NULL。 |
| `error_summary` | TEXT | 可空 | 错误摘要 | 错误或接管的人类可读说明（如 `运行超时，等待接管`）。 |
| `receipt_json` | TEXT | 可空 | 执行回执（JSON） | JSON 文本，记录 `handler_key`、`side_effect`、`created_session` 等副作用事实；由 handler 结果序列化。 |
| `artifact_refs` | TEXT | 可空 | 产物引用（JSON） | JSON 文本，handler 产出的 artifact 引用集合；无产物为 NULL。 |
| `session_id` | TEXT | 可空 | 会话 ID | 仅 `ai-task` 类 handler 可能创建会话并回写；其余 handler 结束时清空。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串，入队时写入。 |

### memory_entries — 员工记忆条目

- **用途**：员工自助维护的 Markdown 记忆条目（私人或团队可见），在会话运行时被拼接进上下文；对应「记忆查询/记录/修改/删除」快捷入口。
- **主键 / 唯一约束**：`id`（主键）。
- **关键索引**：无显式索引（仅有主键的隐式索引；读取按 `owner_user_id`/`scope` 过滤）。
- **外键**：`owner_user_id` → `users(id) ON DELETE CASCADE`（用户删除时级联清理）。
- **写入方**：`backend/src/routers/enterprise.ts`：`POST /memory`（创建）、`PATCH /memory/:id`（更新，`version + 1`）、`DELETE /memory/:id`（删除），均写 `audit`。读取方：同文件 `GET /memory`，以及 `backend/src/worker/runner.ts` 在拼装模型记忆时读取 `enabled=1 AND (owner_user_id=? OR scope='team')` 的最近 20 条。
- **备注**：`scope` 枚举 `private` / `team`（API 接受 `workspace` 并归一为 `team`，其他值返回 400）。`title` 列由 `migrateSchema()` 追加，默认 `记忆`。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键 | 记忆 ID | 唯一标识，创建时 `nid("mem")` 生成。 |
| `owner_user_id` | TEXT | 非空，外键 | 归属员工 ID | 记忆拥有者 `users.id`；级联删除。 |
| `title` | TEXT | 非空，默认 `'记忆'` | 标题 | 记忆条目标题；创建时取 `body.title`，缺省 `记忆`。 |
| `body_md` | TEXT | 非空 | 正文（Markdown） | 记忆正文，Markdown 文本；创建/更新取 `body_md` 或兼容字段 `content`。 |
| `scope` | TEXT | 非空，默认 `'private'` | 可见范围 | 枚举 `private`（仅本人）/ `team`（团队可见，`runner.ts` 按 `scope='team'` 纳入他人上下文）。 |
| `enabled` | INTEGER | 非空，默认 1 | 是否启用 | 0/1 布尔；仅 `enabled=1` 的记忆会被拼进模型上下文。 |
| `version` | INTEGER | 非空，默认 1 | 版本号 | 创建为 1，每次 `PATCH` 更新 `version = version + 1`。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串；创建与每次更新刷新，读取按此列倒排。 |

### employee_memory_items — 员工记忆项

- **用途**：按「员工 + 记忆类型 + 条目键」存储结构化的增量记忆项（任务、摘要、待办的原始/展示层，以及技能结果），支持按内容哈希做增量合并、删除与版本递增。
- **主键 / 唯一约束**：`id`（主键）；`UNIQUE(owner_user_id, memory_kind, item_key)`。
- **关键索引**：`idx_employee_memory_items_kind (owner_user_id, memory_kind)`（按员工与记忆类型列取）。
- **写入方**：`backend/src/host/employee-memory.ts`：表由 `ensureEmployeeMemoriesTable()` 运行时 `CREATE TABLE IF NOT EXISTS` 建立；`persistIncrement()` 执行插入/更新/删除（更新仅当内容哈希变化，`revision + 1`）；`backend/src/host/skill-result-memory.ts` 写 `memory_kind='skill_result'`（id 为 `mem_${runId}`，item_key 按 run 前缀）。
- **备注**：`memory_kind` 由家族 + 层组合而来（`memoryKindOf(family, layer)`），枚举：`task_raw`、`task_display`、`summary_raw`、`summary_display`、`todo_raw`、`todo_display`、`skill_result`（家族 `MemoryFamily = task|summary|todo`，层 `MemoryLayer = raw|display`）。`content_hash` 为 `payload` JSON 的 SHA-256 十六进制，用于判断是否需要更新。本表无外键约束（用户删除不级联，由业务逻辑保证一致）。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键 | 条目 ID | 唯一标识；增量合并用 `nid("mem")`，技能结果用 `mem_${runId}`。 |
| `owner_user_id` | TEXT | 非空 | 归属员工 ID | 记忆项拥有者 `users.id`（无外键约束）。 |
| `memory_kind` | TEXT | 非空 | 记忆类型 | 枚举 `task_raw` / `task_display` / `summary_raw` / `summary_display` / `todo_raw` / `todo_display` / `skill_result`。 |
| `item_key` | TEXT | 非空 | 条目键 | 同一类型下的稳定条目标识（如 work_item 或 run 相关键）；与 owner、kind 组成唯一键。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 条目内容（JSON） | JSON 文本，记忆项的结构化内容。 |
| `content_hash` | TEXT | 非空 | 内容哈希 | `payload` 规范化 JSON 的 SHA-256；仅当哈希变化才更新 payload 并递增 `revision`。 |
| `revision` | INTEGER | 非空，默认 1 | 修订号 | 新建为 1；内容变化时 +1，相同内容不写。 |
| `created_at` | TEXT | 非空 | 创建时间 | ISO 8601 字符串。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次内容更新刷新；列表按此列倒排。 |

### employee_today_briefs — 今日简报指针

- **用途**：每个员工一行，指向该员工「今日」最新生成的简报 artifact 及其产生该简报的 planning 工作项；读取简报时先查本表指针再取 `task_artifacts.payload`。
- **主键 / 唯一约束**：`owner_user_id`（主键，每人至多一行）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **外键**：`artifact_id` → `task_artifacts(id) ON DELETE CASCADE`；`work_item_id` → `work_items(id) ON DELETE CASCADE`。
- **写入方**：`backend/src/host/today-brief.ts` 的 `upsertTodayBriefPointer(owner, artifactId, workItemId, scope='today')`（`ON CONFLICT(owner_user_id) DO UPDATE`）；`result_artifact_id` 由 `backend/src/host/today-tasks.ts` 的今日任务结果回写更新。
- **备注**：表名由 `briefPointerTable('today')` 映射得到（对应 `PlanScope = 'today'`，task type `today_plan`）。`result_artifact_id` 列不在初始 DDL 中，由 `today-tasks.ts` 的 `ensureResultArtifactColumn()` 运行时 `ALTER TABLE … ADD COLUMN` 追加。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `owner_user_id` | TEXT | 主键，非空 | 归属员工 ID | 员工 `users.id`，每人一行；同时是 upsert 冲突键。 |
| `artifact_id` | TEXT | 非空，外键 | 简报产物 ID | 指向 `task_artifacts.id` 的今日简报（brief）产物；级联删除。 |
| `work_item_id` | TEXT | 非空，外键 | 工作项 ID | 生成该简报的 planning 工作项 `work_items.id`；级联删除。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 upsert 指针时刷新。 |
| `result_artifact_id` | TEXT | 可空 | 结果产物 ID | 指向今日任务执行结果 artifact；由 `today-tasks.ts` 回写，未执行过为 NULL。 |

### employee_todo_briefs — 待办简报指针

- **用途**：每个员工一行，指向该员工「待办（todo）」最新生成的简报 artifact 及产生该简报的 planning 工作项；读取待办简报时先查本表指针再取 `task_artifacts.payload`。
- **主键 / 唯一约束**：`owner_user_id`（主键，每人至多一行）。
- **关键索引**：无显式索引（仅有主键的隐式索引）。
- **外键**：`artifact_id` → `task_artifacts(id) ON DELETE CASCADE`；`work_item_id` → `work_items(id) ON DELETE CASCADE`。
- **写入方**：`backend/src/host/today-brief.ts` 的 `upsertTodayBriefPointer(owner, artifactId, workItemId, scope='todo')`（`ON CONFLICT(owner_user_id) DO UPDATE`）；`result_artifact_id` 由 `backend/src/host/today-tasks.ts` 的待办任务结果回写更新。
- **备注**：表名由 `briefPointerTable('todo')` 映射得到（对应 `PlanScope = 'todo'`，task type `todo_plan`，记忆类型 `todo_cover` / `todo_result`）。结构与 `employee_today_briefs` 完全相同，仅用途（scope）不同；`result_artifact_id` 同样由运行时 `ALTER TABLE` 追加。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `owner_user_id` | TEXT | 主键，非空 | 归属员工 ID | 员工 `users.id`，每人一行；同时是 upsert 冲突键。 |
| `artifact_id` | TEXT | 非空，外键 | 简报产物 ID | 指向 `task_artifacts.id` 的待办简报（brief）产物；级联删除。 |
| `work_item_id` | TEXT | 非空，外键 | 工作项 ID | 生成该待办简报的 planning 工作项 `work_items.id`；级联删除。 |
| `updated_at` | TEXT | 非空 | 更新时间 | ISO 8601 字符串，每次 upsert 指针时刷新。 |
| `result_artifact_id` | TEXT | 可空 | 结果产物 ID | 指向待办任务执行结果 artifact；由 `today-tasks.ts` 回写，未执行过为 NULL。 |

---

## 十六、分组 14：事实账本与工单（2 张表，2026-10-01 本体三表新增）

统一业务事件账本与独立工单表。设计契约：`docs/superpowers/specs/2026-10-01-ontology-three-tables-design.md`；机器可读目录：`config/objects-registry.yaml`、`config/event-catalog.yaml`、`config/ticket-types.yaml`。两表由 `backend/src/db.ts` `initSchema()` 与 `backend/migrations/018_business_events.sql`、`019_tickets.sql` 建立（本节的表数 / 字段数为本节事实，§一 的基准库扫描快照生成于新增两表之前）。

### business_events — 统一业务事件（不可变事实账本）

- **用途**：业务事实的统一账本（一表三用：触发器 / 账本 / 记忆源）。事件类型目录见 `config/event-catalog.yaml`（99 条，事件清单 §2–§11 全量）。本批接线两条：「阶段已前进 / 已回退 / 已进入异常 / 已离开异常 / 已完成 / 跨段前进」（`backend/src/adapters/starry.ts` `confirmStage()` 同事务）与「邮件已到达」（`backend/src/starrykol/mail-sync.ts` `rememberItem()`，仅 inbound）。
- **主键 / 唯一约束**：`id`（主键，`nid("evt")`）；`business_events_idempotency` 为 `idempotency_key` 的部分唯一索引（非空时生效，重复提交以 `INSERT OR IGNORE` 去重、不落第二条）。
- **关键索引**：`business_events_object`（`object_type, object_id, occurred_at`）；`business_events_type`（`event_type, occurred_at`）；`business_events_correlation`（`correlation_id`）。
- **不可变**：`business_events_no_update` / `business_events_no_delete` 两个触发器，命中即 `RAISE(ABORT,'business_events are immutable')`；`backend/src/seed.ts` 重置演示数据时临时 DROP 再重建（仿 `stage_transitions`）。
- **写入方**：`backend/src/business-events.ts` `appendBusinessEvent()`（目录白名单校验：默认容错并告警、`strict` 模式抛错；幂等键去重）；调用点见上。读取方：`listBusinessEvents()` 与 `GET /api/events`（`backend/src/routers/events.ts`，支持 `object_type` / `object_id` / `event_type` / `before` / `limit`，limit ≤ 200）。
- **备注**：`occurred_at`（发生时间）与 `received_at`（接收时间）分开记录（TECH-BE-05）；本表是事实账本，正式状态仍以权威记录核验（BIZ-18）；其余域（任务 / 审批 / 采集 / 成本 / 发现）后续逐域迁入，分域表保持原职责不变。

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `id` | TEXT | 主键，非空 | 事件 ID | `nid("evt")` 生成，形如 `evt_...`。 |
| `event_type` | TEXT | 非空 | 事件类型 | 取自 `config/event-catalog.yaml`（如 `stage.advanced`、`email.received`）；服务层白名单校验。 |
| `object_type` | TEXT | 非空 | 主体对象类型 | 对象注册表 code（如 `collaboration`、`email`、`follow_task`）。 |
| `object_id` | TEXT | 非空 | 主体对象 ID | 与 `object_type` 配对。 |
| `occurred_at` | TEXT | 非空 | 发生时间 | ISO 8601；外部事实取来源时间，本地事实取写入时刻。 |
| `received_at` | TEXT | 非空 | 接收时间 | ISO 8601；入库 / 接收时刻，与发生时间分开。 |
| `source` | TEXT | 非空 | 来源 | 如 `starry`、`host`、`system`。 |
| `source_version` | TEXT | 可空 | 来源版本 | 来源系统版本或快照标识；缺省 NULL。 |
| `actor_type` | TEXT | 非空 | 执行者类型 | `human` / `agent` / `system` / `external`。 |
| `actor_id` | TEXT | 可空 | 执行者 | 员工 handle、服务身份或外部来源标识。 |
| `action_ref` | TEXT | 可空 | 关联动作 | Skill / 工具 / 命令名（如 `confirm_stage`）。 |
| `payload` | TEXT | 非空，默认 `'{}'` | 载荷（JSON） | 事件关键字段快照。 |
| `evidence` | TEXT | 非空，默认 `'{}'` | 证据（JSON） | 证据指针 / 结构化证据。 |
| `receipt` | TEXT | 可空 | 外部回执（JSON） | 外部提交回执；无则 NULL。 |
| `diff` | TEXT | 可空 | 前后 diff（JSON） | 变更类事件的前后差异；无则 NULL。 |
| `idempotency_key` | TEXT | 可空 | 幂等键 | 非空时受部分唯一索引保护（重复提交被忽略、不重复副作用事件）。 |
| `correlation_id` | TEXT | 可空 | 关联链 ID | 串联同一业务链（如 `lifecycle_id`、`thread_id`）。 |
| `created_at` | TEXT | 非空 | 落库时间 | ISO 8601，写入时刻。 |

### tickets — 工单（任务运行与工单的统一表）

- **用途**：任务运行与工单的**唯一表**（2026-10-01 换表：原 `work_items` 已重命名并入本表，见「work_items → tickets」一节）。票型分类只来自 `config/ticket-types.yaml`（10 kinds × 4 channels；`kind` 含「客服工单」等业务类型，`channel` 含「邮件工单」）；执行运行 / 会话 / 产物由 `task_runs` / `sessions` / `task_artifacts` 承载。
- **主键 / 唯一约束**：`id`（主键，`nid("tsk")`）；两条部分唯一索引 `one_running_today_plan` / `one_running_todo_plan`（见上一节）。
- **关键索引**：`tickets_owner_updated`；`tickets_owner_status`；`tickets_status_updated`（`status, updated_at`）；`tickets_kind`；`tickets_channel`。
- **外键**：`session_id → sessions(id) ON DELETE SET NULL`；子表 `task_runs` / `task_events` / `task_artifacts` / `employee_today_briefs` / `employee_todo_briefs` 的 `work_item_id` → `tickets(id)`（列名保留历史命名，语义即 tickets.id）。
- **写入方**：任务创建 / 状态推进路径（`routers/tasks.ts`、`host/api.ts`、`host/today-plan-run.ts`、`crawl/service.ts`、`home-discovery.ts` 等）直接写本表；创建后由 `backend/src/tickets.ts` `ensureTicketForWorkItem()` 就地落票型分类（`kind`/`channel`/`requester_*`/`object_*`/`kind_version`，接线 5 处：建任务、规划任务、KOL 分析入队、AI 发现容器、首页发现）；历史行分类由 `reconcileTickets()` 启动时一次性回填（`app_state` 键 `tickets_classified_v1`），挂 `backend/src/app.ts` `createApp()`。
- **迁移**：`backend/src/db.ts` `mergeWorkItemsIntoTickets()`（丢弃旧镜像表 → `work_items` 重命名为 `tickets` 并同步改写外键引用 → 补票型列 → 清理镜像触发器与旧索引名 → 重建 `tickets_*` 索引）；老库由首次启动自动完成。
- **读取方**：`GET /api/tasks`、`GET /api/tasks/:id` 序列化附 `ticket_id`（= 行 id）/ `ticket_kind` / `ticket_channel` / `ticket_status`（后三者为表内列与派生展示值，只增字段）。本批未提供独立工单列表接口与前端呈现（票面 UI 批次再建）。

本表列 = 「work_items → tickets」一节的既有列 + 下列票型列：

| 字段 | 类型 | 约束与默认 | 中文名 | 说明 |
|---|---|---|---|---|
| `kind` | TEXT | 非空，默认 `general` | 票型（业务类型） | `config/ticket-types.yaml` 的 kind（service / follow_up / delivery / approval / risk / crawl / discovery / planning / library / general）。 |
| `channel` | TEXT | 非空，默认 `human` | 渠道 | email / system / agent / human（目录规则按序派生）。 |
| `requester_type` | TEXT | 非空，默认 `human` | 提单方类型 | human / system / agent（由渠道派生）。 |
| `requester_id` | TEXT | 可空 | 提单人 | 系统单为 NULL；否则为创建时的 `owner_user_id`。 |
| `object_type` | TEXT | 可空 | 主体对象类型 | 有合作关系时为 `collaboration`。 |
| `object_id` | TEXT | 可空 | 主体对象 ID | 同 `collaboration_id`。 |
| `kind_version` | INTEGER | 非空，默认 `1` | 票型目录版本 | 分类时 `config/ticket-types.yaml` 的 version。 |

---

## 附录 A：仓库内全部 db 文件清单

共 **33** 个 `.db` 文件，文件名全部为 `lingong.db`，**均未被 git 跟踪**（`git ls-files` 命中 0 个，属运行期产物）。每一行都按「表名 + 字段名」指纹归入附录 B 的一个 schema 变体。

| # | 文件路径 | 表数 | 字段数 | schema 变体 | 文件修改日期 |
|---|---|---:|---:|---:|---|
| 1 | `backend/data-e2e-check/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 2 | `backend/data-e2e/lingong.db` | 78 | 833 | 变体 1 | 2026-10-01 |
| 3 | `data-e2e-ab/lingong.db` | 88 | 934 | 变体 2 | 2026-10-01 |
| 4 | `data-e2e-check/lingong.db` | 55 | 509 | 变体 3 | 2026-09-26 |
| 5 | `data-e2e-clean/lingong.db` | 89 | 945 | 变体 4 | 2026-10-01 |
| 6 | `data-e2e-iso1/lingong.db` | 88 | 934 | 变体 2 | 2026-10-01 |
| 7 | `data-e2e-iso2/lingong.db` | 88 | 934 | 变体 2 | 2026-10-01 |
| 8 | `data-e2e-iso3/lingong.db` | 88 | 934 | 变体 2 | 2026-10-01 |
| 9 | `data-e2e-iso4/lingong.db` | 89 | 945 | 变体 4 | 2026-10-01 |
| 10 | `data-e2e-ws/iso/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 11 | `data-e2e-ws/iso2/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 12 | `data-e2e-ws/iso3/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 13 | `data-e2e-ws/iso4/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 14 | `data-e2e-ws/iso5/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 15 | `data-e2e-ws/lingong.db` | 78 | 834 | 变体 5 | 2026-10-01 |
| 16 | `data-e2e-ws/probe/lingong.db` | 77 | 823 | 变体 6 | 2026-10-01 |
| 17 | `data-e2e-ws/ref4-panel/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 18 | `data-e2e-ws/ref4-parity/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 19 | `data-e2e-ws/ref4-pool/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 20 | `data-e2e-ws/ref4-surface/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 21 | `data-e2e-ws/ref5-chat/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 22 | `data-e2e-ws/ref5-followed/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 23 | `data-e2e-ws/ref5-panel/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 24 | `data-e2e-ws/ref5-parity/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 25 | `data-e2e-ws/ref5-pool/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 26 | `data-e2e-ws/ref5-surface/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 27 | `data-e2e-ws/ref6-panel/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 28 | `data-e2e-ws/ref6-parity/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 29 | `data-e2e-ws/ref6-pool/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 30 | `data-e2e-ws/ref7-evidence/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 31 | `data-e2e-ws/ref7-evidence2/lingong.db` | 78 | 839 | 变体 0 | 2026-10-01 |
| 32 | `data-e2e/lingong.db` | 100 | 1018 | 变体 7 | 2026-10-01 |
| 33 | `data/lingong.db` | 90 | 955 | 变体 8 | 2026-10-01 |

> 变体 7（`data-e2e/lingong.db`，100 表 / 1018 字段）是全部文件的**超集**，正文数据字典以它为准。变体 8（`data/lingong.db`，主开发库）与正文的差异见附录 B。

## 附录 B：schema 变体差异

按「表名 + 字段名」指纹，33 个文件归为 **9 种变体**。下表列出每种变体相对正文基准（变体 7 / `data-e2e/lingong.db`）**缺失的表**与**字段差异**。差异只说明这些库是不同时间点、不同代码路径下的残留，不代表任何规划。

### 变体 0（16 个文件，78 表 / 839 字段）

- **文件**：`backend/data-e2e-check/lingong.db`、`data-e2e-ws/ref4-panel/lingong.db`、`data-e2e-ws/ref4-parity/lingong.db`、`data-e2e-ws/ref4-pool/lingong.db`、`data-e2e-ws/ref4-surface/lingong.db`、`data-e2e-ws/ref5-chat/lingong.db`、`data-e2e-ws/ref5-followed/lingong.db`、`data-e2e-ws/ref5-panel/lingong.db`、`data-e2e-ws/ref5-parity/lingong.db`、`data-e2e-ws/ref5-pool/lingong.db`、`data-e2e-ws/ref5-surface/lingong.db`、`data-e2e-ws/ref6-panel/lingong.db`、`data-e2e-ws/ref6-parity/lingong.db`、`data-e2e-ws/ref6-pool/lingong.db`、`data-e2e-ws/ref7-evidence/lingong.db`、`data-e2e-ws/ref7-evidence2/lingong.db`
- **缺失表**（22 张）：`connector_tool_grants`、`cost_budgets`、`cost_events`、`knowledge_bindings`、`knowledge_grants`、`runtime_agent_skills`、`runtime_bootstrap_migrations`、`runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_skill_connectors`、`runtime_skill_tools`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`skill_drafts`
- **字段差异**（7 张表）：
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`、`last_error`、`purpose`、`last_verified_at`、`icon_ref`、`declared_protocol`
  - `knowledge`：缺 `effective_at`、`expires_at`、`published_version`
  - `knowledge_deprecations`：缺 `handled_at`、`handled_by`、`handle_action`、`handle_note`
  - `kol_mail_items`：缺 `title`
  - `kol_profile_index`：缺 `avatar_url`、`avatar_checked_at`、`avatar_error`、`potential_score`、`potential_confidence`、`risk_score`、`risk_confidence`、`assessment_model`、`assessment_version`、`assessed_at`、`assessment_error`、`assessment_criteria`、`engagement_source`、`potential_probabilities`、`risk_probabilities`
  - `skill_lifecycle`：缺 `origin`
  - `users`：缺 `organization_units`、`position`

### 变体 1（1 个文件，78 表 / 833 字段）

- **文件**：`backend/data-e2e/lingong.db`
- **缺失表**（22 张）：`connector_tool_grants`、`cost_budgets`、`cost_events`、`knowledge_bindings`、`knowledge_grants`、`runtime_agent_skills`、`runtime_bootstrap_migrations`、`runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_skill_connectors`、`runtime_skill_tools`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`skill_drafts`
- **字段差异**（8 张表）：
  - `collaborations`：缺 `list_in_projects`
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`、`last_error`、`purpose`、`last_verified_at`、`icon_ref`、`declared_protocol`
  - `knowledge`：缺 `effective_at`、`expires_at`、`published_version`
  - `knowledge_deprecations`：缺 `handled_at`、`handled_by`、`handle_action`、`handle_note`
  - `kol_mail_items`：缺 `memory_fingerprint`、`memory_source`、`memory_generated_at`、`memory_error`、`memory_attempts`、`title`
  - `kol_profile_index`：缺 `avatar_url`、`avatar_checked_at`、`avatar_error`、`potential_score`、`potential_confidence`、`risk_score`、`risk_confidence`、`assessment_model`、`assessment_version`、`assessed_at`、`assessment_error`、`assessment_criteria`、`engagement_source`、`potential_probabilities`、`risk_probabilities`
  - `skill_lifecycle`：缺 `origin`
  - `users`：缺 `organization_units`、`position`

### 变体 2（4 个文件，88 表 / 934 字段）

- **文件**：`data-e2e-ab/lingong.db`、`data-e2e-iso1/lingong.db`、`data-e2e-iso2/lingong.db`、`data-e2e-iso3/lingong.db`
- **缺失表**（12 张）：`connector_tool_grants`、`employee_memory_items`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_tool_global_scopes`、`runtime_tool_scope_bindings`
- **字段差异**（4 张表）：
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`
  - `employee_today_briefs`：缺 `result_artifact_id`
  - `employee_todo_briefs`：缺 `result_artifact_id`
  - `users`：缺 `organization_units`

### 变体 3（1 个文件，55 表 / 509 字段）

- **文件**：`data-e2e-check/lingong.db`
- **缺失表**（45 张）：`approval_idempotency`、`connector_tool_grants`、`cost_budgets`、`cost_events`、`creator_candidates`、`cron_jobs`、`cron_runs`、`discovery_ingest_confirms`、`discovery_ingest_receipts`、`discovery_memory_facts`、`discovery_requests`、`discovery_runs`、`employee_memory_items`、`employee_today_briefs`、`employee_todo_briefs`、`exam_items`、`exam_qualifications`、`exam_snapshots`、`knowledge_bindings`、`knowledge_grants`、`kol_follow_index`、`kol_profile_index`、`kol_thread_summary`、`runtime_agent_skills`、`runtime_bootstrap_migrations`、`runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_skill_connectors`、`runtime_skill_tools`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`skill_drafts`、`skill_lifecycle`、`skill_stage_history`、`skill_test_runs`、`skill_tests`、`skill_versions`
- **字段差异**（14 张表）：
  - `approvals`：缺 `version`、`updated_at`
  - `collaborations`：缺 `last_lifecycle_id`、`last_skip_kind`、`last_skip_reason`、`last_skipped_stages`、`list_in_projects`
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`、`last_error`、`purpose`、`last_verified_at`、`icon_ref`、`declared_protocol`
  - `exam_attempts`：缺 `status`、`score`、`total`、`paper_version`、`idempotency_key`、`started_at`、`breakdown_json`
  - `exams`：缺 `status`、`pass_score`、`version`、`effects`、`published_at`
  - `knowledge`：缺 `effective_at`、`expires_at`、`published_version`
  - `knowledge_deprecations`：缺 `handled_at`、`handled_by`、`handle_action`、`handle_note`
  - `kol_mail_items`：缺 `from_addr`、`from_name`、`to_addr`、`body_text`、`summary`、`summary_zh`、`summary_source`、`receipt_status`、`receipt_at`、`effective`、`translation_zh`、`translation_source`、`memory_fingerprint`、`memory_source`、`memory_generated_at`、`memory_error`、`memory_attempts`、`title`
  - `kol_mail_threads`：缺 `peer_email`、`peer_name`、`last_preview`、`match_state`、`last_receipt`、`digest_text`、`digest_source`、`digest_fingerprint`、`digest_error`、`digest_failed_at`、`digest_mail_count`、`starred`
  - `sessions`：缺 `expert_id`、`expert_version`
  - `task_events`：缺 `item_key`
  - `user_starry_bindings`：缺 `is_default`、`sync_cursor_at`、`sync_cursor_id`、`sync_page_no`、`synced_at`、`last_error`、`last_tool`
  - `users`：缺 `organization_units`、`position`
  - `work_items`：缺 `last_acted_at`、`acknowledged_at`、`content`、`start_date`、`risk_level`

### 变体 4（2 个文件，89 表 / 945 字段）

- **文件**：`data-e2e-clean/lingong.db`、`data-e2e-iso4/lingong.db`
- **缺失表**（11 张）：`connector_tool_grants`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_tool_global_scopes`、`runtime_tool_scope_bindings`
- **字段差异**（2 张表）：
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`
  - `users`：缺 `organization_units`

### 变体 5（6 个文件，78 表 / 834 字段）

- **文件**：`data-e2e-ws/iso/lingong.db`、`data-e2e-ws/iso2/lingong.db`、`data-e2e-ws/iso3/lingong.db`、`data-e2e-ws/iso4/lingong.db`、`data-e2e-ws/iso5/lingong.db`、`data-e2e-ws/lingong.db`
- **缺失表**（22 张）：`connector_tool_grants`、`cost_budgets`、`cost_events`、`knowledge_bindings`、`knowledge_grants`、`runtime_agent_skills`、`runtime_bootstrap_migrations`、`runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_skill_connectors`、`runtime_skill_tools`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`skill_drafts`
- **字段差异**（7 张表）：
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`、`last_error`、`purpose`、`last_verified_at`、`icon_ref`、`declared_protocol`
  - `knowledge`：缺 `effective_at`、`expires_at`、`published_version`
  - `knowledge_deprecations`：缺 `handled_at`、`handled_by`、`handle_action`、`handle_note`
  - `kol_mail_items`：缺 `memory_fingerprint`、`memory_source`、`memory_generated_at`、`memory_error`、`memory_attempts`、`title`
  - `kol_profile_index`：缺 `avatar_url`、`avatar_checked_at`、`avatar_error`、`potential_score`、`potential_confidence`、`risk_score`、`risk_confidence`、`assessment_model`、`assessment_version`、`assessed_at`、`assessment_error`、`assessment_criteria`、`engagement_source`、`potential_probabilities`、`risk_probabilities`
  - `skill_lifecycle`：缺 `origin`
  - `users`：缺 `organization_units`、`position`

### 变体 6（1 个文件，77 表 / 823 字段）

- **文件**：`data-e2e-ws/probe/lingong.db`
- **缺失表**（23 张）：`connector_tool_grants`、`cost_budgets`、`cost_events`、`employee_memory_items`、`knowledge_bindings`、`knowledge_grants`、`runtime_agent_skills`、`runtime_bootstrap_migrations`、`runtime_connector_config`、`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_skill_connectors`、`runtime_skill_tools`、`runtime_tool_global_scopes`、`runtime_tool_policies`、`runtime_tool_scope_bindings`、`skill_drafts`
- **字段差异**（9 张表）：
  - `connectors`：缺 `mcp_config`、`tools_json`、`last_tested_at`、`last_error`、`purpose`、`last_verified_at`、`icon_ref`、`declared_protocol`
  - `employee_today_briefs`：缺 `result_artifact_id`
  - `employee_todo_briefs`：缺 `result_artifact_id`
  - `knowledge`：缺 `effective_at`、`expires_at`、`published_version`
  - `knowledge_deprecations`：缺 `handled_at`、`handled_by`、`handle_action`、`handle_note`
  - `kol_mail_items`：缺 `memory_fingerprint`、`memory_source`、`memory_generated_at`、`memory_error`、`memory_attempts`、`title`
  - `kol_profile_index`：缺 `avatar_url`、`avatar_checked_at`、`avatar_error`、`potential_score`、`potential_confidence`、`risk_score`、`risk_confidence`、`assessment_model`、`assessment_version`、`assessed_at`、`assessment_error`、`assessment_criteria`、`engagement_source`、`potential_probabilities`、`risk_probabilities`
  - `skill_lifecycle`：缺 `origin`
  - `users`：缺 `organization_units`、`position`

### 变体 7（1 个文件，100 表 / 1018 字段）

- **文件**：`data-e2e/lingong.db`
- **缺失表**：无（与基准表集一致）
- **字段差异**：无

### 变体 8（1 个文件，90 表 / 955 字段）

- **文件**：`data/lingong.db`
- **缺失表**（10 张）：`runtime_connector_organization_nodes`、`runtime_connector_organization_sync`、`runtime_connector_probes`、`runtime_connector_scope_bindings`、`runtime_connector_scope_modes`、`runtime_connector_scope_policies`、`runtime_connector_tool_inventory`、`runtime_credentials`、`runtime_tool_global_scopes`、`runtime_tool_scope_bindings`
- **字段差异**：无

---

## 附录 C：跨表共用的枚举与字典值索引

同一套枚举往往散落在多张表里。本附录只做**索引**（这份值在哪里定义、出现在哪些列），具体取值已写在对应表的小节中，避免同一枚举在两处各写一份数值。

| 枚举家族 | 定义位置 | 主要出现的列 |
|---|---|---|
| 合作阶段（15 个主节点 + `exception`） | [stage-transitions.json](../config/stage-transitions.json)、[stage-transitions.md](./business-rules/stage-transitions.md) | `collaborations.stage_code`、`stage_transitions.from_stage` / `to_stage`、`starry_stage_writes.stage_code`、`drafts.proposed_stage` / `official_stage`、`knowledge.stage_codes` |
| 工具风险档位 L1 / L2 / L3 | [07-mcp-data-contract.md](./07-mcp-data-contract.md) | `work_items.risk_level`、`runtime_tool_policies.risk`（L1 只读直接执行；L2 草稿必须标注；L3 外发/导入/删除/解密执行前必须确认并留回执） |
| 数据范围与访问档（公司 / 组织 / 品牌 / 区域 / 读写） | [org-permissions.md](./org-permissions.md) | `user_connector_grants.access`、`knowledge_grants.scope` / `scope_id`、`connector_tool_grants.scope_type` / `scope_value`、`runtime_connector_scope_policies.mode`、`runtime_connector_scope_bindings.node_id`、`runtime_tool_scope_bindings.node_id`、`runtime_tool_global_scopes` |
| 应用层业务字典（`data_dictionary` 接口返回的枚举，如主平台、商务语言、邮箱品牌归属） | [domain-objects.md](./domain-objects.md) §2 | 不落在本库固定列上，由接口按请求返回；不要在页面或库表里另立一份取值 |
| 审批状态与类型 | [BUSINESS.md](./BUSINESS.md)、[org-permissions.md](./org-permissions.md) | `approvals.status` / `kind`、`approval_idempotency`、`approval_role_bindings.role` |
| 邮件发送与回执状态 | 代码：`backend/src/routers/mail.ts`、`backend/src/host/mail-send-confirmation.ts` | `drafts.status`、`kol_mail_items.receipt_status`、`kol_mail_threads.match_state` / `last_receipt`；发送不等于推进阶段 |
| 任务与工作项状态 | 代码：`backend/src/routers/tasks.ts`、`backend/src/tasks/` | `work_items.status`、`task_runs.status`、`task_events.event_type` |
| 采集与发现状态 | 代码：`backend/src/crawl/service.ts`、`backend/src/discovery.ts`、`backend/src/home-discovery.ts` | `crawl_jobs.status`、`crawl_job_events.event_type`、`discovery_requests.status`、`discovery_runs.status` / `kind` |
| 技能生命周期 | 代码：`backend/src/host/skill-lifecycle.ts`、`backend/src/routers/skill-runtime.ts` | `skill_lifecycle.stage`、`skill_versions.status`、`skill_drafts.status`、`skill_flags` |
| 知识治理状态 | 代码：`backend/src/routers/knowledge.ts` | `knowledge.status`、`knowledge_proposals.status`、`knowledge_deprecations.handle_action`、`knowledge_extract_jobs.status` |
| 连接器运行时 | 代码：`backend/src/runtime/store.ts`、`backend/src/runtime/tool-catalog.ts` | `connectors.status`、`runtime_connector_config`、`runtime_connector_probes`、`runtime_bootstrap_migrations` |
| 定时任务 | 代码：`backend/src/cron/store.ts`、`backend/src/cron/worker.ts` | `cron_jobs.status`、`cron_runs.status` / `trigger` |
| 成本与计量 | 代码：`backend/src/costs.ts`、[PRODUCT.md](./PRODUCT.md)（PROD-PLAT-08） | `cost_events.source` / `provider` / `model` / `total_tokens`；`cost_events.cost_cents` 在缺少版本化定价来源时恒为 `NULL`，不得用估算金额冒充 |
