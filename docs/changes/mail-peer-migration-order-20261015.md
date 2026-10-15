# 邮件标签迁移 042 顺序修复（2026-10-15）

## 需求与审查

需求 → 补齐 compact workbench 文档并部署邮件变更；修复部署前检出的 PostgreSQL 空库初始化失败。

主责 → 后端专家（迁移注册顺序）、测试经理（真实 PostgreSQL 升级与回归）、项目经理（区分已验证与已部署）。

宪法 → CONST-03（确定规则由程序执行）、CONST-05（不扩大授权或代人审批）、CONST-08（审查记录）、CONST-09（不为代码通过改法）、CONST-10（交付可验证）。

基本法 → TECHNOLOGY.md TECH-ARCH-01（原生 PostgreSQL、版本化 migration）、TECH-BE-03（幂等）、TECH-TEST-01/02/03/04（按影响范围验证、发布证据与回滚）。

结论 → **符合**。仅修复技术依赖顺序及测试初始化，不改迁移 SQL、ID、校验和、本体配置、权限、审批规则或邮件业务断言。

## 根因

main@7d02eaef 的 `20261015_mail_labels_peer_email` 注册在数组前部，先于数组末部的 `20261012_mail_private_labels`。空库先执行迁移 042 的 ALTER TABLE，但迁移 035 尚未创建 `mail_private_label_assignments`，报 `42P01: relation public.mail_private_label_assignments does not exist`。

GitHub release-gate run 38648760845 在 Prepare PostgreSQL test template 步骤失败，Deploy production 被跳过。沙箱 PostgreSQL 16 通过正式 runner 复现相同错误。

此外，两个标签集成测试在已包含 042 的模板上重放原始 035/042 SQL。035 试图为已被 042 删除的 conversation_id 列建索引，导致 setup 失败。测试应使用正式 runner 生成的当前模板，而不是越过账本重放历史 SQL。

## 实施

1. 将迁移 042 注册移至迁移 035 后，亦在邮件线程基座创建之后。
2. 增加注册顺序回归，保留迁移 ID 唯一性检查。
3. 两个标签 PG 集成测试使用当前模板，删除重复执行旧 SQL 的 setup；所有业务断言保留。
4. 新增真实 PG 升级回归：在临时测试库重建迁移前指派表和账本状态，通过正式 runner 的 `--only=20261015_mail_labels_peer_email` 升级；验证同人跨会话合并、最早时间保留、发件会话错误 peer 修正、不可解析孤行清理、跨用户隔离、新主键、conversation_id 删除及已记账的重复运行跳过。

## 验证

- 正式 runner 空库初始化：通过。
- 同一库全量 runner 第二次执行：`applied: []`，通过。
- 四个相关测试文件：28 passed，1 skipped；跳过的是 opt-in live Codex 测试，未声称完成真实模型或外部写入验证。
- 两组现有标签业务集成：10 + 14 项通过。
- 新增 populated pre-042 升级：1 项通过。
- 注册顺序：3 项通过。
- 所有数据库写入、DDL 和夹具清理仅发生在沙箱隔离数据库；生产核查为只读。

## 发布边界

原始文档补丁已独立补交 main@519a19e0，仅修改 DESIGN.md 和 DECISIONS.md，52 行新增。文档内容按用户指定补丁原样应用，原作者历史证据未改写；本轮新验证记录在此。

本修复通过本地验证不代表完整 CI 或生产发布成功。部署仍须：

1. 保留并协调生产分叉提交 92e72241、ed8c6114；不能直接用 --sync 丢弃。
2. 完成 master_data 迁移 035_master_data.sql 的 runner 接入（当前 main 缺失），该旧问题不在本顺序修复中改动。
3. 对 objects 注册表目标持有同真实已发布基线、同目标摘要的 consumed ontology_change 审批；不得改库或修改门禁绕过。
4. 相关修复合并并满足发布验证后，再备份、准备产物、安排不兼容 schema 切换、执行迁移 042 和现有 systemd 部署流程。

042 会删除旧 conversation_id 列；不能先迁移生产，再让仍加载旧标签代码的进程继续服务。后端使用 tsx 加载源文件，无独立 npm build，正式 deploy.sh 在旧进程运行时构建前端并统一重启 API、Outbox 和两个执行 Worker。
