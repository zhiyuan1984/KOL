# PostgreSQL-only 工单与调度运行手册

> **适用范围：** 正式工单、Cron、Outbox 与 execution worker。  
> **边界：** 此模式不启动历史首页、邮件、发现、旧 `/tasks`、旧会话或 SQLite bridge；未迁移端点将返回 `404`，不会回退到 SQLite。

## 1. 发布前条件

| 项目 | 要求 | 校验方式 |
|---|---|---|
| 数据库 | `DATABASE_URL` 必须是 PostgreSQL URL，且对正式 schema 有读写权限 | `npm run db:apply:postgres-schema` 成功 |
| Redis | BullMQ/Outbox worker 使用的 Redis 已配置并可连接 | 按既有 worker 环境变量健康检查 |
| 工单身份 | 至少已完成一次 `/api/ticket-auth/setup`，并由工单管理员完成必要的“账号—组织人员”绑定 | 管理端“工单治理”无阻断项 |
| CORS | 生产环境设置 `APP_ORIGIN` 或 `CORS_ORIGIN` 为唯一 HTTPS 来源 | 启动后检查浏览器 cookie 与跨域请求 |
| 调度 tick | 设置高熵 `CRON_TICK_SECRET`，由可信调度器调用内部 tick 端点 | 见第 3 节 |

**禁止项：** 不设置 `DATABASE_URL`、不运行 schema migration、通过旧 `/api/tasks` 继续写入、或将历史 SQLite 文件作为回退/迁移来源。

## 2. 启动顺序

在 `backend/` 目录中执行。以下命令仅说明运行顺序；**不会自动发布或切换生产环境**。

```bash
# 1) 确认环境（示例变量不应提交到仓库）
export DATABASE_URL='postgresql://…'
export KOL_RUNTIME_MODE='postgres-only'
export APP_ORIGIN='https://your-approved-origin.example'
export CRON_TICK_SECRET='a-high-entropy-secret'

# 2) 只追加 PostgreSQL schema，不执行任何 SQLite 导入
npm run db:apply:postgres-schema

# 3) 启动 HTTP 正式子系统
npm run start

# 4) 另行启动可靠执行链（均使用相同 DATABASE_URL 与 Redis 配置）
npm run worker:outbox
npm run worker:execution
```

启动时，`postgres-only-app.ts` 会检查 `tickets`、`ticket_accounts`、`cron_jobs`、`execution_jobs`、`execution_outbox` 等正式表，并播种受发布约束保护的系统 Cron 作业。缺表即失败，绝不改开 SQLite bridge。

## 3. 健康检查与调度触发

```bash
# HTTP 权威模式确认
curl -fsS "$BASE_URL/api/health"
# 期望：runtime_mode=postgres-only、authority_store=postgresql、legacy_routes=retired

# 可信调度器调用（不要从浏览器暴露或记录 secret）
curl -fsS -X POST "$BASE_URL/api/cron/internal/tick" \
  -H "x-cron-tick-secret: $CRON_TICK_SECRET"
```

- `/api/cron/internal/tick` 仅接受 `CRON_TICK_SECRET`，或工单 PostgreSQL 管理员会话。
- tick 只将到期 Cron run 写入 PostgreSQL `cron_runs`、`execution_jobs` 与 `execution_outbox`；真正执行由独立 worker 领取。
- 仍未完成原生迁移的业务写入类 handler 必须保持 disabled/`needs_takeover`，不能因启动模式切换而恢复旧逻辑。

## 4. 工单身份与组织就绪

1. 首位管理员访问正式 UI 的“设置首位工单管理员”，或调用 `POST /api/ticket-auth/setup`。
2. 管理员进入“工单治理”，选择**已创建但未绑定**的 PostgreSQL 工单账号和**受控组织人员**，填写可审计原因后提交。
3. 页面显示的阻断项（账号、组织或负责人账号缺失）必须修复后再允许创建/分派正式工单。

系统不根据姓名、旧账号、SQLite 会话或显示名推断绑定关系。每次变更都写入不可变的 `ticket_account_organization_bindings`。

## 5. 回滚与故障边界

- **不回滚到 SQLite。** 若 PostgreSQL-only 发布失败，应停止该正式子系统、保留 PostgreSQL 证据与 worker 日志，再在隔离环境修复并重新进行 schema/集成测试。
- 需要恢复历史兼容应用时，必须作为单独、明确的运行模式决策；它不是 PostgreSQL-only 的自动 fallback，也不能接管正式工单/调度写入。
- 对已发送的 Outbox 事件、生命周期事件、验收历史和账号绑定审计，不做无证据删除或覆盖。
