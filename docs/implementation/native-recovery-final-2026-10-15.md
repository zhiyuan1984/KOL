# PostgreSQL 原生调度恢复最终实施登记

## 范围与状态

本登记描述最后候选实现及发布约束，不把专属数据库测试当作生产成功。实际生产提交、账本和业务回执必须由发布后的只读证据确认。

候选在原生基线 `7cdf59c8` 上完成修复；发现并发生产提交 `9f3314c472591c4f4885c1ca312f6877cf08bb38` 后，已正常快进保留该提交的四个知识发布表单前端修复。最终发布目标必须是这个新生产基线的后继，且 `frontend/` 相对该基线没有源文件变更。禁止 `--sync`、hard reset、强推或未经授权向公开 GitHub 推送。

## 审宪与不变量

- **CONSTITUTION / TECHNOLOGY：** PostgreSQL 是唯一业务数据库；没有 SQLite 驱动或方言桥。跨表业务写入复用一个 PG client，模型与远端 API 调用在数据库事务外。正式 DDL 只能走版本化 manifest；旧 checksum 不改。成功必须来自真实提交、真实来源和可关联的回执。
- **PRODUCT：** 邮件增量只充实本地来源支持的记忆，不外发邮件、不改正式业务阶段。增量批次成功不等于所有历史邮件完成；预算、剩余、来源变化、失败和锁竞争单独报告。
- **BUSINESS：** 保留员工、组织、资格、审批、Agent、Skill、工具策略及凭据权限。14 天回公海继续使用原生资格判定和 CAS，不以缺失邮件证据推定可释放。公海对账仅同步来源完整快照，旧运行不得覆盖新运行。

## 实施

1. **正式缺表补迁移：** `047_pool_sync_native_schema` 补齐对账 run 表及支持列；`048_mail_memory_cache_native_schema` 以 actor_id + memory_key 主键补齐既有按需缓存。manifest 实测77项；两项只加支持结构，不改原事实、角色或旧迁移。
2. **公海快照：** 先在事务外收集并校验 total、分页与 UID，再同 client 原子替换索引、归属和 ready 状态。成功事务锁 state 并核对 last_run_id；旧运行明确 superseded，失败更新全局状态同样带 run ownership CAS。
3. **邮件增量：** PostgreSQL session advisory lock 防跨 worker 重叠，不持事务等待模型。默认240秒软预算不硬切已在飞模型调用；pending/公平选择、provider 全失败 fail-fast、真实 persisted/body_analyzed/model 计数。原文 MD5 不 trim；完整来源指纹覆盖模型输入和成员。线程/个人摘要模型后同 client 重读来源并 CAS，来源变化不计 generated 且 remaining_work=true。
4. **按需邮件：** 一次捕获 actor，inflight key 带 actor；共享译文/摘要与 actor cache 在一个 SQL-only PG transaction 内提交；失败状态与 audit 也同 client。不让他人的 promise 冒充本 actor 缓存完成。
5. **回执：** 增量携带 native_run_id，明确关联原生运行记录；任意业务 errors 真实 failed，锁竞争真实 skipped。needs_takeover 只用于实际超时、不确定性或需要人工核验的异常；删除不可达旧测试归属分支和误称隔离占位的注释，不改变现行权限入口。
6. **Starry：** 用户于2026-10-15T12:45:14Z明确允许启用既有连接器，保留配置、凭据和权限。只复用现有 verified / 同版本成功 Probe / 装配门禁切 enabled；配置版本27及配置hash CAS，组织凭据/权限事实摘要前后不变，同 client 审计。Live tools/list 只用现有组织保险柜引用，不更新策略或调用外部业务写工具。
7. **真正的异步截止时间：** 最终全套回归暴露授权读取在竞速数组中提前 await 上游，导致 timer 无法进入 race；同类 AST 审计又找出 Host AI runWorker 的提前 await。两处改为把未等待的任务 Promise 立即加入 race，保留原100ms测试边界、10秒授权默认、Host既有超时/Abort/权限/错误回执。测试自身的提前等待挂起Promise同时纠正，但不改一项deadline、anchor或权限断言，也不提高原30秒测试阈值。新增生产 race/any AST 防退化门禁；顺序原生PG读取不当作SQLite或竞速阻断。

## 验证与发布边界

已完成的定向专属PG验证：按需/摘要原子性7项、原邮件三套25项、公海原与并发9项、Starry受控启用4项。模型在测试中仅为明确合成夹具；真实生产连接和模型结果须另验。

冻结后必须再次运行严格typecheck、契约/registry、本体门禁及受影响Cron/归属回归。发布使用现有部署锁、私有一致性PG备份和环境副本、ff-only、正式schema、前端构建、五服务与新心跳。不得重复两条已审计时钟恢复；不得手动触发邮件或归属释放。仅允许为已知失败的公海索引通过既有durable入队重试一次，并保留原失败回执、原频率/范围和操作审计。
若本期公海已到时，由常驻Ticker自然合并入队，并复用该真实run；不再制造第二个人工并发补跑。是否人工入队按真实操作审计报告。

最终只读核对77项账本、引擎/无同步prepare、未来调度时间、Outbox→Execution Worker→Cron/原生业务run的真实终态及计数一致。历史失败/实际接管不抹除。生产仍0条用户配置AI定时任务时必须明确说明，不创建员工任务或伪造回执。

依赖审计的10项安全告警是单独升级事项，不用 `audit fix --force` 混入本次原生恢复，也不宣称已消除。

## 冻结前补充验证（2026-10-15，北京时间22:05）

显式、已声明任务原接收路径重复进行全Agent意图路由枚举，测试期探针确认增加约905ms；现只去掉该重复发现，保留提交期和下游PEP、实体提取、实际选定Agent资格、权限与202前durable running状态。原500ms、202、停止、发布拦截断言全通过，另增加资格撤销后即使admin仍403。探针已删除，没有权限缓存或全局Agent回退。

最后14文件合并中13文件100项通过，新增恢复程序的5项因夹具把job_key误当外键job_id未进入业务测试；仅改为使用真实系统作业主键，随后5/5独立专属PG通过。此构造修正不改变一项原子性、自然复用、历史失败、禁用保全断言。冻结提交后仍须统一14文件105项、严格类型/契约/registry和真实本体门禁再次通过；尚未进行本轮正式恢复发布。
