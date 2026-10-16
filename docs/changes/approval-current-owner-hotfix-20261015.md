# 单张 objects 审批：真实终审账号修复

## 授权与边界

用户于 2026-10-15 13:56（UTC+8）明确确认：**张慧玲是 appr_eb5335a2b424 的授权终审人**。管理员登录身份将在正式 API 调用时由 requireAdmin() 核验，记录实际 user ID，而不是伪造“张总批准”。

此修复只指派该单当前的孤立节点；不创建账号，不添加或删除全局审批角色，不修改管理员角色，不使用通配审批权限，不改变任何审批单的 pending/consumed 状态，不代张慧玲批准，不扩展到其他历史审批。

旧节点 emp_zhang 仅为 legacy defaultOrgSnapshot 内置角色；真实张慧玲账号是 usr_org_zhang_huiling / person:zhang_huiling。不能按同姓猜身份。

## 实施

新增 `POST /api/admin/approvals/:aid/assign-current-owner`，使用真实管理员认证；输入 target_user_id、reason、expected_version、idempotency_key。

仓库以 native PostgreSQL SERIALIZABLE 事务和行锁验证：单据存在且 pending、kind=ontology_change、scope=objects、版本匹配；旧节点在 legacy snapshot 可核验，且无可精确匹配的活动用户或有效审批绑定；目标为在职真实账号并具有唯一 active 组织人员关联。

仅将当前链节点换为 `user:<真实用户 ID>`，保存原节点与原步骤、指派历史、实际 actor、reason、时间及幂等键。version +1，status/current_index/uses_left 保持不变；scope/base_version/target_digest/change_ref 原样保留。

audit_events 与 approval_idempotency 在同一事务写入。审计失败必须回滚指派；同请求重放不重复写，不同请求复用 key 拒绝。

canonical 当前节点只允许同一 active 用户 ID 处理。其他管理员、同名账户、全局角色或旧姓名映射均不能代替该 ID。旧节点的兼容行为保留，canonical 历史参与者按精确 ID 查看。

## 验证范围

新单元与真实集成测试覆盖精确身份/同名拒绝、旧节点兼容、真实管理员 API 指派、单张与全局角色隔离、非法权限/缺少版本与幂等键拒绝、stale/非 pending/停用用户/非孤立节点拒绝、幂等和并发重放、审计失败回滚，以及仅在隔离库由目标账号执行正常终审和终审重放。

集成验证使用沙箱 PostgreSQL **16**，生产为 **18**；测试 clone/drop 只涉及自建沙箱库，未在生产跑测试或签发任何张慧玲生产会话。

## 限定热修复发布

修复基于当前已运行的 release/mail-special-20261015@b5bd14cb，不同步 main，不包含未批准 C15 注册表发布。代码补丁只有审批后端、测试和本说明；包依赖、前端源文件、技能/Worker 实现和四范围本体文件无变化。

后端热修复会有新的实际 Git/API 代码版本；现有前端产物不替换，其 manifest 继续指向未变化的 b5bd14cb 前端源码。交付须明确两者，不把后端补丁称为 main 已部署。

上线前仍调用原始严格本体检查，传入经 API 核实的原运行基线；四范围 registry 与现有 PG 发布账本的内容完全相同，所以没有新的 ontology publication。该后端限定发布不写入新的 registry ledger 行、不改这张 pending 单的基线或摘要，避免无关技术发布无故使原许可绑定失效。

现有主分支的 advisory 检查不在本修复中使用、修改或用于放行未审批变更。部署锁、干净工作区、代码路径白名单、原始严格检查、服务健康/实际 API 版本、静态前端 hash、原版本回滚引用均须核验。

热修复正常后，以已登录管理员通过上述接口只指派 appr_eb5335a2b424；对这张单只允许真实张慧玲随后通过正常决定接口终审。

## 同期现场故障

2026-10-15 13:45 左右，另一测试任务在生产机器克隆测试库时耗尽根分区，PostgreSQL 出现 No space left on device 并恢复失败，API 返回 502。本修复父任务仅清理可重建 APT/npm 包缓存并启动原 PostgreSQL 18 集群；未删除数据库、WAL、业务文件或审计记录，API 恢复。空间仍紧张，禁止在此生产机器上为本修复克隆测试库。

## 审查记录

需求 → 主责角色 → 宪法 → 基本法 → 结论与证据 → 下一步：

修复用户明确指定的单张终审身份 → 后端专家实现、测试经理验证，管理员确认具体业务责任 → CONST-04/05/08/10 → BIZ-14、TECH-BE-02/03/08、TECH-TEST-03/04、org-permissions → 在已确认的单张 objects 范围内实现真实、可审计的指派，保持决定权与正式状态 → 经隔离验证后作限定后端热修复，由目标本人决定；未声称 main 或本体变更已发布。
