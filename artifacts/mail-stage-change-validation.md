# 通讯页阶段变更补丁验证记录

日期：2026-10-09（Asia/Shanghai）

## 需求与审查

需求：应用 `mail-stage-change-from-a39b05f0.patch`，合并 main、push、部署，并在通讯页验证「点绑定红人 → 选择目标阶段 → 提交」不再返回 422。

主责角色：前端专家、后端专家、测试经理；阶段规则沿用 KOL 业务专家既有规则。

适用条款：CONST-04/05/08/10；BIZ-08/12；TECH-FE-01/03、TECH-BE-01/02、TECH-TEST-01/03/04。

结论：**符合本次变更范围**。目标列表复用 `pipelineStageTargets`，提交显式携带合作 ID、handle、stage_code 与 proposed_stage；阶段变更仍由独立确认/审批闸门生效。阶段上下文为只读查询，不执行发送或正式阶段写入。

## 实施范围

原补丁 7 个文件：

- `backend/src/mail/operations.ts`
- `backend/src/routers/tasks.ts`
- `backend/tests/mail-collaboration-stage.test.ts`
- `frontend/src/api.ts`
- `frontend/src/components/ComposerDock.tsx`
- `frontend/src/pages/Mail.tsx`
- `frontend/src/styles.css`

验证补充：

- 将新增接口测试接入仓库既有 `freshTestDatabase()` PostgreSQL 隔离夹具，不使用 SQLite 测试数据库。
- `backend/tests/tasks-runtime.test.ts` 补充 422 可读 message 与实际阶段任务创建/运行回归。
- `frontend/e2e/mail.spec.ts` 补充红人点选替换草稿、目标选项、阶段文字同步、显式绑定提交及异步 202 跳转回归。
- 发布期间 main 有其它独立补丁进入；均通过普通 merge 保留，不覆盖或强推。

## 验证结果

- 前后端 TypeScript 类型检查：通过。
- 前端生产构建：通过。
- 普通/生产 contracts：通过，生产校验无错误/警告。
- PostgreSQL 后端影响域：**45/45 通过**（4 个测试文件）。
- 新增 Chromium 通讯阶段用例：**1/1 通过**，以 HTTP 夹具验证浏览器提交字段；不冒充真实生产外部集成。
- 实际 Hono + PostgreSQL 阶段任务链路：创建 201、运行 202 Accepted、返回 session_id；运行后合作阶段仍保持 QUOTE_PENDING，未进行正式确认。
- 扩展通讯相关 E2E：**32 通过 / 6 失败**。失败涉及旧模板清空断言、demo/reset 依赖的 `mail_sync_state` 测试表缺失、基线已不存在的 `data-mail-digest-tag` / `data-mail-list-footer` 选择器。不为消除失败而修改既有业务或 UI 契约；该扩展套件不能标记为全绿。

## 测试环境边界

使用 Sandbox 独立 PostgreSQL 库，模板来自预发模板的 **schema-only** 导出，未复制生产业务数据；参考数据由仓库种子脚本生成。正式数据、外部邮件、审批、阶段写入均未触碰。

初始化隔离库时发现既有 schema 初始化顺序和重复迁移问题；main 中随后合入的知识补丁已修复迁移列表前部重复注册，具体以该补丁的发布记录为准，本次不修改该领域代码。

## 生产验收限制

部署前只读核查生产 `kol_mail_threads`：`collaboration_id` 非空且非空串的会话数量为 **0**。当前浏览器用户已绑定邮箱的 30 条缓存会话也没有绑定合作记录，因此不能在现有生产数据上走完整红人点选路径。

不得为证明该路径而虚构生产合作/绑定、发送邮件或确认正式阶段。部署后核查版本、健康、服务与新增接口；完整生产点击验收仍需一个真实已绑定合作的会话。

## 发布方式

使用项目既有 ECS `./scripts/deploy.sh --sync`：前端先构建至 `dist.new`，成功后替换产物并重启 API、Outbox 与两个执行 Worker。部署前确认 tracked 工作区无改动、等待其它发布进程退出，保存旧 SHA 以供代码回滚。该补丁不含数据库 schema 迁移。
