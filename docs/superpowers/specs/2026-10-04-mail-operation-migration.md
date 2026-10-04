# 邮件入口收敛

审查：需求（移除邮件专用 HTTP 路由，接入注册式查询、技能、动作与作业）→ 主责角色（架构师、后端专家；前端专家迁移调用；测试经理限定回归）→ CONST-02/03/05/07/08/10 → TECH-ARCH-02/03、TECH-BE-01/02/03/04/07、TECH-TEST-02/04、PROD-AGENT-01/02、BIZ-04 → **符合**：只改变入口与执行承载，保留业务范围、保险柜凭据、发送确认快照、幂等与回执 → 实施并运行改动范围测试。

实施边界：当前邮件模块挂在 `createApp` 工作台入口。`createPostgresOnlyApp` 尚不支持邮件；本次不以挂载旧数据库适配层的方式绕过其隔离边界，也不宣称完成全量数据库迁移。

通用路由只允许调用服务端登记的操作，不能接收任意 URL、模块名或 MCP 工具名。查询不进入模型；技能继续调用已有授权和 harness；正式发送继续经过原发送网关。凭据不进入浏览器。

旧 `/api/mail/*` 及迁移的草稿发送专用入口退役，前后端须同时发布。同步作业使用 PostgreSQL 执行记录及既有队列，状态、重试和取消按当前操作者与邮箱绑定校验。

| 用途 | 新入口 |
|---|---|
| 邮箱、往来、正文、联系人摘要、模板目录、发送快照、导出 | `GET /api/queries/mail.<操作>` |
| 草稿准备、确认发送、草稿翻译、已读、星标 | `POST /api/actions/mail.<操作>` |
| 往来摘要、邮件翻译 | `POST /api/skills/:skillId/execute`，仅登记的技能可调用 |
| 提交邮件同步 | `POST /api/jobs/mail.sync/start` |
| 状态、取消、失败重试 | `GET /api/jobs/:id`、`POST /api/jobs/:id/cancel`、`POST /api/jobs/:id/retry` |

同步提交只入队，不在 HTTP 请求里发起远端调用。相同员工和邮箱的活动任务合并；Worker 重新加载身份、当前技能资格及邮箱绑定，使用该邮箱明确绑定的保险柜凭据。分页和正文读取之间检查取消与执行租约；失败或页数上限不能报告完成。取消保留已经索引的数据；旧 Worker 不得覆盖新租约或取消后的终态。摘要与翻译仍由独立技能生成。

运行依赖：已有 PostgreSQL schema、Redis、Outbox publisher 和 execution worker；Worker 须使用相同保险柜主密钥。工作台应用和 Worker 的运行模式须匹配。`postgres-only` 的邮件适配尚未迁移，本次保持拒绝执行并给出接管原因。

验证使用隔离 PostgreSQL 测试库和模拟邮件提供方，没有真实发信。只选择本次涉及的路由、邮件记忆、同步、草稿准备、发送确认、前端邮件客户端与入口契约回归；未运行全量发布门禁。

浏览器专项：同步提交/恢复/重试/取消 3 项通过；草稿准备和确认发送 8 项通过。另 1 项“模板候选时输入框应为空”断言失败：用提交 `49de285` 的原始前端源代码和原始测试在临时目录构建复现，相同断言仍失败（输入框已有技能占位提示）。该模板交互不属于本次路由迁移，未修改或弱化原断言。

实施资产：`backend/src/runtime/operations.ts`（通用注册入口）、`backend/src/mail/operations.ts`（邮件能力登记）、`backend/src/mail/sync-job.ts`（同步适配）、`backend/src/routers/operation-jobs.ts`（作业操作）、`backend/src/execution-jobs/`（持久化、去重与租约）、`frontend/src/api.ts` 与 `frontend/src/pages/Mail.tsx`（调用与状态恢复）。

类型检查：前后端 `tsc --noEmit` 均通过；前端构建通过。测试库清理使用有限并发并释放原生连接池，以适应 Windows PostgreSQL 的检查点等待；仅清理由当前测试进程创建的隔离库。

最终定向回归（2026-10-04）：`mail-memory`、`mail-send-confirmation`、`mail-compose-prepare`、`followed-mail-sync`、`operation-router`、前端 `mail/client` 与 `home/scopeParity` 共 90/90 通过，含测试库清理正常退出；原生 `postgres-execution-jobs.integration` 4/4 通过。合计 94 项。浏览器结果见上文，未宣称全量 E2E 通过。

首次实现时的交付状态：代码已验证（上述范围），部署另行执行；本次联合发布见 [采集切换记录](2026-10-04-crawler-vault-cutover.md)。真实邮件提供方与生产队列的联合验收未执行；个人账号绑定配置接口及现有后台事件触发器不在本次 HTTP 入口迁移范围内。
