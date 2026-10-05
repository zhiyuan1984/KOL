# 登录账户切换：鄢棽 → 黄启友（邮箱与权限复制）

> 2026-10-05，user-confirmed。需求原文：「将登录账户从鄢棽切换为黄启友，鄢棽所有的邮箱和权限黄启友都有」。

## 审宪记录（CONST-08）

- **需求**：登录账户从鄢棽（`sriphy`）切换为黄启友；黄启友获得鄢棽现有的全部邮箱与权限。
- **主责角色**：平台运维 / 产品经理（账号与授权运营）；不改变阶段、审批链、SOP 等业务规则。
- **宪法条款**：CONST-04（权限判定只在后端，前端只呈现）；CONST-05（授权与受控动作要可追溯并留审计）；CONST-08（审宪程序）；CONST-09（不偷偷改法——只改账号与授权数据，不改业务规则）；CONST-10（真实能力——复制真实凭据引用与保险柜副本，不造假）。
- **基本法条款**：`docs/PRODUCT.md` PROD-PLAT-04/05（Agent 使用资格与资源装配）；`docs/TECHNOLOGY.md` TECH-BE-01/02/07（权限、提交闸门、真实连接）；`docs/org-permissions.md`（授权与审计）；`docs/07-mcp-data-contract.md`（工具分档与物理闸门）。
- **结论与证据**：**符合**。`ensureDemoAdmin()` 本就是演示登录账户的维护入口（先例：把遗留 `test` 迁成鄢棽）；本次邮箱与权限采用「复制」而非「迁移」，鄢棽在用链路不受影响；全部写库动作记入审计。
- **下一步**：按「实施步骤」执行；上线后只做只读核验，不以外发邮件 / 阶段写入 / 导入 / 解密证明连通。

## 决策要点

1. **登录账户 = 黄启友现有账号**（`usr_org_huang_qiyou`，邮箱 `jeffrey.huang@amperetime.com`）。`DEMO_ADMIN` 切换为黄启友（handle `jeffrey`），服务重启时 `ensureDemoAdmin()` 会把该账号 username 改为 `jeffrey`、写入密码 `123456789` 与角色 `employee+admin`。登录可用邮箱 / 姓名「黄启友」/ 账号 `jeffrey`。
2. **复制而非迁移**：鄢棽账号（`sriphy`）、其邮箱绑定与权限保持不动；黄启友获得各自的副本。如需收回鄢棽的访问，另行指示。
3. **复制清单**：Starry 个人邮箱绑定 `larry.zhao@amperetime.com`（含 `mailbox_id`、owner、状态、分页游标；个人保险柜凭据为黄启友新建持密副本——`user_account` 凭据按 owner 校验，不能跨账号共用）；`roles` 并集（含 `admin`）；`brands` 并集；`approval_role_bindings`（`lead`）；连接器 / 技能个人授权（当前为空）；`person:yan_chen` 名下 active agent 绑定（`agent:kol`、产品专家 `agent_9d5314a7605b`）→ `person:huang_qiyou` 同款。
4. **不做**：不复制会话 / 工单 / 记忆等个人工作数据；不改远端 Starry 授权；不触发发送、阶段写入、导入、解密；不动 `test@163.com` 历史残留账号。
5. **handle 取 `jeffrey`**（邮箱本地部分，沿用 `sriphy` 短 handle 的先例）。

## 实施步骤

1. 代码与配置：`backend/src/config.ts`（`DEMO_ADMIN`、`PERSONAS.sriphy / exam_blocked / permission_blocked` 的 name/handle）、`backend/src/auth.ts` 与 `backend/src/host/identity.ts` 注释、`backend/src/routers/misc.ts`（stub `/api/me` 邮箱）、`frontend/src/components/AuthGate.tsx`、`frontend/src/pages/Admin.tsx`、`frontend/src/pages/AccountSettings.tsx`。
2. 组织声明：`config/org-registry.yaml` —— revision 追加变更说明；`person:huang_qiyou` 增 `account_username: "jeffrey"`；`agent_bindings` 追加 `agent:kol → person:huang_qiyou`（source `user-confirmed 2026-10-05`）；鄢棽既有条目保留为历史。
3. 运维脚本：`backend/scripts/copy-account-access.ts`（默认 dry-run，`--apply` 写库并记审计；逻辑在 `backend/src/runtime/account-access.ts`，同 `org-account-import` 的结构；幂等可重跑）。
4. 测试：`backend/tests/copy-account-access.test.ts`（新增）；既有身份字面量改为 `DEMO_ADMIN` 常量（identity-starry-bind、host-contracts、knowledge-wikiskill、skill-publish、skill-lifecycle、approval-inbox、discovery-ingest-gate、followed-mail-sync、tickets）；前端 e2e：`global-setup.ts` 默认账号改为 `jeffrey`，`workbench.spec.ts` 账号栏与 PM 登录改「黄启友」。
5. 文档：README 登录说明与演示人格文案、`docs/db-data-dictionary.md` 用户表说明。
6. 发布与线上操作：推送 `github` `main`（release-gate → deploy-production 自动部署）→ 服务器 `npx tsx scripts/copy-account-access.ts`（dry-run → `--apply`）→ 只读核验。
7. 连带修正（登录身份切换的直接后果）：
   - `PERSONAS.permission_blocked` 的 `name` 改为「受限演示账号」：若仍叫「黄启友」，会命中 `departmentHeadAccessForUser` 的姓名匹配，拿到公司级全品牌授权，`blocked_permission` 演示失效（黄启友本人按政策本就不可被品牌范围拦截）。
   - `host/grants.ts seedDirectory()` 为 `jeffrey` 补目录与范围行（org_litime + team_kol）：`memberScopeIds()` 按 handle 取知识/技能范围，切换后需与「演示管理员」保持等价；鄢棽原有行保留。

## 验证证据（本地，2026-10-05）

- 后端门禁：`npm run typecheck` 通过；`npm run validate:registry` 通过（objects 63 / events 99 / tickets 10，0 告警）；`npm run validate:contracts` 通过（status valid，0 errors / 0 warnings）。
- 后端测试（PostgreSQL 模板库克隆，TEST_DATABASE_URL 指向本机嵌入式 PG）：共 42 个套件、537 项用例通过，覆盖全部受影响面：
  - 账户与身份：`copy-account-access`（新增，含幂等与凭据副本断言）、`identity-starry-bind`、`org-account-import`、`organization-tree`（含新增试点绑定的覆盖语义更新）。
  - 邮箱与发送：`mail-compose-prepare`、`larry-zhao-email-scenarios`、`first-touch-empty-to`、`followed-mail-sync`、`mail-memory`、`conformance-redlines`。
  - 权限与知识范围：`knowledge-governance`、`knowledge-bases`、`knowledge-wikiskill`、`knowledge-documents`、`contract-scope`、`enterprise-auth`、`home-discovery-auth`、`skill-*` 系列、`admin-agents`、`admin-work-report`。
  - 其余回归：`host-contracts`、`tickets`、`task-run-recovery`、`costs`、`poll-endpoints-perf`、`kol-memory`、`today-plan`、`task-fields` 等。
  - 期间发现并修正 3 处真实回归：受限演示人格与部门负责人政策交互（2 处断言）、恢复演示后 handle 断言；另 2 次 `freshTestDatabase()` hook 超时属本机嵌入式 PG 负载抖动，单独复跑均通过。
- 前端门禁：`npm run typecheck` 与 `npm run build` 通过（stub 构建 10.87s）。
- 前端 E2E（stub + PostgreSQL，data-e2e_local）：账号栏显示「黄启友」且不含 `jeffrey`（workbench.spec 账号栏用例的断言全部通过）；「产品经理登录」用例通过。`workbench.spec.ts:428` 的后续步骤因 2026-09-22 起已移除的 `[data-open-work-panel]` 选择器超时——该陈旧用例早于本次变更存在，且不在发布门禁的 E2E 子集内。

## 线上操作与核验（执行记录）

（推送 main → release-gate → deploy-production 后，在服务器执行 `backend/scripts/copy-account-access.ts`（先 dry-run 再 `--apply`），随后只做只读核验：登录、`/api/auth/status`、`/api/me`、admin agents 覆盖、首页跟进范围；核验结果追加到本文件。）

## 回滚

- 代码：`git revert` 同一提交并走同一发布通道（`ensureDemoAdmin` 回到 `sriphy` 维护口径）。
- 数据：删除黄启友新增的邮箱绑定行及其个人凭据、撤销新增 agent 绑定（`revokeAgentBinding`）与审批角色行；鄢棽侧从未改动。
- 黄启友账号的 username 由 `jeffrey` 改回邮箱形式即可恢复组织导入态。
