# PostgreSQL 正式工单与调度运行手册

> **适用范围：** 正式工单、Cron、Outbox 与 execution worker。  
> **身份边界：** **工作台登录是唯一浏览器身份入口。** PostgreSQL 承载工单、组织、规则、作业和可审计的工作台主体映射；不提供工单账号、密码、首次管理员或第二个 Cookie 会话。

## 1. 发布前条件

| 项目 | 要求 | 校验方式 |
|---|---|---|
| 数据库 | `DATABASE_URL` 必须是 PostgreSQL URL，且对正式 schema 有读写权限 | `npm run db:apply:postgres-schema` 成功 |
| Redis | BullMQ/Outbox worker 使用的 Redis 已配置并可连接 | 按既有 worker 环境变量健康检查 |
| 工作台身份 | 原工作台 `/api/auth/status` 和已登录会话可用；正式请求会生成/刷新 PostgreSQL `workbench_principal_bindings` | 登录工作台后请求 `/api/tickets` 或 `/api/cron/jobs`，不应出现第二个登录页 |
| 组织授权 | 工作台主体已同步到 PostgreSQL，并在“工单治理”完成明确的主体—组织人员绑定 | 工单治理无阻断项后才允许创建、分派或自动关注 |
| CORS | 生产环境设置 `APP_ORIGIN` 或 `CORS_ORIGIN` 为唯一 HTTPS 来源 | 启动后检查同源工作台 cookie 与跨域请求 |
| 调度 tick | 设置高熵 `CRON_TICK_SECRET`，由可信调度器调用内部 tick 端点 | 见第 3 节 |

**禁止项：** 不设置 `DATABASE_URL`、不运行 schema migration、通过旧 `/api/tasks` 向正式工单写入、或新建 `/api/ticket-auth/*`、工单密码、工单 Cookie 作为登录回退。

## 2. 当前浏览器运行方式

当前工作台仍是历史兼容应用，因此浏览器正式路径应运行在**兼容模式**：

```bash
# 已有生产服务保持其工作台认证配置；只追加正式 PostgreSQL schema。
export DATABASE_URL='postgresql://…'
export APP_ORIGIN='https://your-approved-origin.example'
export CRON_TICK_SECRET='a-high-entropy-secret'

npm run db:apply:postgres-schema
npm run start
npm run worker:outbox
npm run worker:execution
```

兼容 HTTP 应用会在 `/api/tickets`、`/api/cron/*`、`/api/admin/scheduling/*` 与 `/api/admin/work-orders/*` 上：

1. 先验证已有工作台会话；
2. 用服务端会话主体创建或刷新 PostgreSQL `workbench_principal_bindings`；
3. 再执行 PostgreSQL 工单/调度授权与写入。

这不是把 SQLite 作为工单或调度业务数据源；它只是当前工作台的认证载体。工单、组织绑定、规则、作业、Outbox 和审计事实仍只写 PostgreSQL。

### `KOL_RUNTIME_MODE=postgres-only` 的限制

纯 PostgreSQL HTTP 模式在共享工作台身份提供方尚未迁移前，**不对浏览器开放**。它会返回 `workbench_identity_provider_required`，不会展示独立工单登录。仅可信内部 tick/worker 可按其专用凭据运行。

## 3. 健康检查与调度触发

```bash
# 兼容应用健康检查
curl -fsS "$BASE_URL/api/health"

# 可信调度器调用（不要从浏览器暴露或记录 secret）
curl -fsS -X POST "$BASE_URL/api/cron/internal/tick" \
  -H "x-cron-tick-secret: $CRON_TICK_SECRET"
```

- `/api/cron/internal/tick` 仅接受 `CRON_TICK_SECRET`，或已验证且有权限的工作台管理员会话。
- tick 只将到期 Cron run 写入 PostgreSQL `cron_runs`、`execution_jobs` 与 `execution_outbox`；真正执行由独立 worker 领取。
- 仍未完成原生迁移的业务写入类 handler 必须保持 disabled/`needs_takeover`，不能因启动模式切换而恢复旧逻辑。

## 4. 工作台主体与组织就绪

1. 员工使用原有工作台账号登录；访问正式工单或调度路径后，系统在 PostgreSQL 创建或刷新该主体的审计映射。
2. 管理员进入“工单治理”，只可从已经同步的**工作台主体**中选择对象，再与受控组织人员建立明确绑定并填写原因。
3. 页面显示的阻断项（工作台主体、组织或负责人主体缺失）必须修复后，再允许创建、分派或自动关注正式工单。

系统不根据浏览器显示名推断主体，不从 SQLite 人员数据自动迁移，也不使用第二套账号或密码。每次人员绑定都写入不可变的 `ticket_account_organization_bindings` 审计；每次工作台主体首次绑定或 claims 变化写入 `workbench_principal_binding_events`。

## 5. 回滚与故障边界

- **不回滚到 SQLite 工单数据。** 若 PostgreSQL 正式链发布失败，应停止相关正式入口、保留 PostgreSQL 证据与 worker 日志，再在隔离环境修复并重新进行 schema/集成测试。
- 恢复历史工作台页面不等于恢复独立工单登录；所有正式路径始终只接受工作台会话。
- 对已发送的 Outbox 事件、生命周期事件、验收历史、主体映射和组织绑定审计，不做无证据删除或覆盖。
