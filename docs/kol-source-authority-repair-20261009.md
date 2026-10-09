# 2026-10-09 红人来源与授权名单修复

## 审查记录

需求：纠正我的红人跨负责人混入、历史身份漏读及邮件同步 SQL 错误。主责：后端归属与数据来源；前端仅消费服务端投影。

- 宪法：CONST-04（服务端业务和权限）、CONST-08（审查）、CONST-10（真实回执）。
- 业务：BIZ-01/02（正式事实与阶段）、BIZ-05/06（归属与有效互动时钟）、BIZ-07/18（私有记忆和来源）。
- 技术：TECH-BE 的 PostgreSQL 原生查询与事实边界；TECH-TEST-01/02/03/04 的相关边界测试、发布和回滚证据。
- 结论：符合。未修改法条、正式阶段、账号权限、远端负责人或发送邮件。

## 单一读取契约

`GET /api/home/following` 是唯一员工名单来源。服务端组合本地 active 跟进和已核验 Starry 绑定历史，并标注 `source_kind=local_follow/starry_binding`。前端不得合并 board 或任意 profile，也不因未知状态或存在 id 将档案判成 active。

远端历史必须来自结构化 `starry_profile_ownership`：稳定负责人 ID 对应已核验绑定，或远端明确的 owner mailbox 精确匹配。旧 collaboration 发件箱、占位邮箱、姓名、同邮箱前缀及 caller extras 都不构成授权。远端负责人字段仅为可核验来源证据，不自动创建排他跟进。

同步先验证结构、分页总数、稳定 UID、重复和 owner 字段能力，完整快照事务替换。失败保留旧证据并记录失败状态，不新增历史授权；响应标记 `incomplete-source`，仅可展示当前员工合法本地跟进，不将空数组误报完整答案。公海保守保护已核实归属对象，来源故障不自动开放它们；撤绑/过期按有效绑定范围失效。

## 修复范围

- public pool 排除已核验当前历史归属及排他 active，对显式 released 记录沿用现行释放规则。
- PostgreSQL 邮件同步仅更新存在的 conversation_id，移除不存在的 collaborations.updated_at。
- 有效互动时间单调更新；缺失、非法或迟到时间不重置时钟。
- `repair-follow-identity.ts` 是固定 `usr_sriphy → sriphy` 的管理员迁移命令，默认只预览。`--apply --actor=...` 在明确 canonical 用户验证、事务和 advisory lock 下纠正归属并留审计，不改远端负责人。
- schema 032、033 为新增派生证据、绑定验证和同步健康结构，不删除正式档案。

## 验证与发布

相关验证包含真实本地 PostgreSQL 来源/归属/公海/邮件/发现导入回归，前端名单契约测试与 Chromium 页面、失败、布局及深链用例；生产发布需在候选版本上重新构建，保留线上其他任务的未提交变更。

本次**不启用 ownership-release 自动任务**。现行口径为连续14天无有效往来，而非领取后14天未建联；无有效时间不启动计时。该完整自动释放闭环另行验收，不能通过简单打开 disabled 掩盖迁移待完成状态。

回滚只切回原运行目录和 systemd override；新结构向后兼容保留。已核实的 canonical 身份纠正和审计不删除、不回退成悬空用户。
