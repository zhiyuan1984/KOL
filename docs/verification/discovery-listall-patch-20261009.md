# 2026-10-09 发现候选 listAll 核对补丁验收

## 需求与授权

用户提供 `discovery-dedup-score-from-212cd3b6(7).patch`，要求合并到 main、push、deploy，并对原有两个候选重试跟进/加入公海；Starry 已有档案应复用真实编号认领，仍失败则返回审计中的 error_detail。不发邮件、不修改合作阶段、不解密联系方式、不修改其他候选归属。

## 审宪审法

需求 → 后端专家、测试经理 → CONST-05 明确对象范围的授权、CONST-06 权威事实、CONST-08 审查、CONST-10 可验证交付 → BIZ-01 精确身份、BIZ-02 Starry 档案事实源、BIZ-05 跟进排他、BIZ-10 导入与回执；TECH-BE-02 网关确认、TECH-BE-03 超时先核对不盲重试、TECH-BE-08 审计脱敏、TECH-TEST-03 区分模拟与真实验收 → **符合**：只恢复已经提交的导入，不取消确认或绕过员工权限；下一步类型检查、隔离 PostgreSQL 回归、部署和授权用户真实操作。

## 合并处理

- 累计补丁在原基线 `212cd3b6` 应用并提交，再三方合并到 main；保留 main 后续的页面、邮件、权限和部署修改。
- 保留 main 的底层 Starry `timeoutMs` 参数和 nginx 240 秒设置。
- 保留 main 已修复的迁移注册顺序；不重新引入 discovery/brand 两个重复迁移。
- 合并新增跟进前 uncertain/孤儿 dispatching 核对、入库失败公海文案、listAll 兜底、审计和 504 友好提示。

## 额外修正

1. 补丁使用 `employeeError(error)` 记录 error_detail 会把技术错误映射成通用员工文案；改用 `sanitizeSecret(error)`，仅审计记录真实脱敏错误，用户界面继续使用白名单文案。
2. 重复跟进原先因本人已有跟进关系而提前返回；当已有导入处于 uncertain/dispatching 时，保留原跟进关系并进入现有恢复路径。
3. 真实 Starry 编号回填到同一占位画像及有效跟进关系，避免本地保留 `candidate:` 编号而审计声称真实认领。
4. listAll 与 keyword 共用精确平台账号匹配，拒绝昵称或编号子串误认；listAll 有 30 秒底层超时。
5. 核对失败的审计独立落盘，外层业务事务回滚不丢失 error_detail。

## 验收方法

- 后端类型检查、契约校验、脱敏扫描。
- 前端完整类型检查和 Vite 构建。
- 使用 SSH 本机私有转发连接 PostgreSQL；测试从独立模板克隆临时数据库，不使用生产库作为测试夹具。
- 新增 listAll 精确命中、昵称误命中拒绝、listAll 失败传播、真实错误脱敏审计，以及重复跟进恢复的回归测试。
- 生产真实候选重试须使用正确员工登录，不得伪造会话、替换认证令牌或修改归属绕过权限。

实际测试和部署结果由本任务交付记录补充；本文件不将未执行的生产重试写为成功。

## 归属边界补充

真实 UID 按独立 advisory lock 串行核对，锁定目标画像及 source/target active follow。目标已有有效跟进、源跟进不是当前员工、平台身份不同均拒绝合并并保留原状态。存在独立 formal profile 时显式查询占位画像，迁移同一 follow_id 并将占位画像标记 closed。uncertain 核对在 formal profile 快路径前执行。

## 已执行验证

- 后端 `npm run typecheck`：通过。
- `npm run validate:contracts`：valid，无错误或警告。
- `npm run scan:redaction`：pass。
- 前端 `npm run build`：通过（含 TypeScript 检查）。
- 服务器独立 worktree + 临时 PostgreSQL 克隆库回归：3 个测试文件、25 项测试全部通过。
- 旧测试模板未包含线索及品牌可见性表，测试在独立克隆库补齐真实 schema；未更改生产 schema 或共享测试模板。
- 线索桥接的正式工单账户外键仍属夹具范围外的旁路提示；本轮测试不冒充完整线索工单桥接端到端验收。
- 生产候选重试尚待正确员工会话和候选身份确认。
