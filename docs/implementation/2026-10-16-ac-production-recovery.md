# 2026-10-16 A/C 原生邮件恢复与依赖安全切片

## 授权、当前状态与发布基线

- 用户明确批准 A（公平阶段、长正文进度、中文/短文本业务定义、真实错误）和 C（依赖锁版本安全升级）。B 的 Starry 内层 DTO、Luna endpoint/凭据和上游外联没有批准，本切片不改。
- 初始基线为 `09bf29f6cf91017b6fc80ad3be610ac830c2d53b`；只读预检发现审批收件箱、员工徽标两次并发正式发布，当前基线改为 `d29bcfc85790534996cf6208e6508f88da32ad74`。
- 已原样保留并发 19 文件与 `20261016_review_badge_read_indexes`；其 migration 登记与 A 的 `20261016_049_mail_memory_progress` 三方合并。不会覆盖审批资格、UI 或旧 schema checksum。
- 本文记录冻结候选与发布流程，**不是宣称生产已经安装或历史已处理完**。最终运行版、自然业务回执及 audit 以发布证据为准。

## A：原生可恢复结构

1. PostgreSQL `kol_mail_memory_progress` 按 mailbox scope 持久保存 phase/cursor/cycle；每轮从前一轮留下的阶段开始，按 items→threads→persons 轮转，不让长正文永远占尽后续阶段。
2. `kol_mail_memory_chunk_progress` 保存完整成功 chunk 前缀。以精确原文 MD5、mailbox、chunk_count 和预期 prefix CAS 校验来源。来源变化不复用旧 actor/chunk，可从当前版本第 0 片安全重建；同源 append 不允许倒退或竞争覆盖。
3. 模型调用不长持 PG 事务。每片检查点独立短事务真实提交；完整译文、最终 checkpoint 清理、phase cursor 和 native run 计数在同一物理 PG client 事务内提交。失败或审计错误不产生假成功。
4. 仅明确纯中文原文标 `source_zh`，不生成假译文，`translated` 不增。含实质 Latin/混合文字仍走真实模型。短全英文合法中文可为 2 个汉字，正常/长正文仍 >=8；真实姓名、品牌和 URL 不因单个英文 token 被误拒。全文/连续英文句回显、占位和不完整 chunk 仍拒绝。
5. 保留旧成功会话/人员 AI 摘要，来源变更或 provider 失败标 stale/失败而不覆盖成规则文本；旧 AI 文本的保全不能计为新的 `body_analyzed`。回执区分 person/thread provider、source_changed、chunk 不可用、预算 yield 与剩余阶段。
6. 原每 10 分钟、240 秒软预算、45 秒单次模型等待、串行执行、跨进程 PG 互斥与真实权限保持。预算检查在下一片/下一项前，不强杀在途模型，不把中间前缀当完整译文。

## C：已锁定安全依赖与兼容

- 后端 @modelcontextprotocol/sdk、adm-zip、Hono 升至已核验修复版本；对 fast-uri、proxy-addr、ip-address、source-map-js 的传递链使用经完整锁验证的修复版本。
- 后端和前端 Vitest 均精确固定 5.0.5，消除 mocker/tinypool 同类告警。前端仅改 package/lock；d29 的全部 UI/配置/测试保全。
- 现有已删除 Vitest API 的机械迁移只将两处 `describe.sequential` 改为 `describe`；全局 fileParallelism=false、sequence.concurrent=false、30 秒 test/hook 阈值与权限断言不变。
- 后台失败夹具原先只在已退役同步 getConn 注入异常；增加在真实原生 createNativeMemoryRun 边界的相同故障注入，同步禁止、异步失败审计、单次并发和释放后重试断言原样保留。
- 不执行生产 `audit fix --force`，不配置 OAuth/Luna，不改任何凭据、员工、角色、组织资格或装配发布状态。

## 已取得证据与冻结门禁

- A 修正后原 6 文件 40 项真实 PG 全过；新增 7 项深边界覆盖跨轮/源变/完整 chunk、原子回滚、旧 digest 与真实 run/audit；79 manifest 的原生后台/计数 3 文件 15 项全过。
- d29 保全后的首次 28 文件回归：266 passed、2 failed、2 原有 skipped。两个失败均为旧同步故障注入失效；原生注入修正后上述 15 项通过。冻结版将再次统一运行 29 文件全部断言，不能仅相加分项结果冒称冻结通过。
- d29 保全的前端 9 个现有配置：全部通过；严格 typecheck、build、full/prod audit 都通过。具体总数以原 JSON 汇总为准。
- 运维严格 typecheck 后的真实 Codex 合成探测：Thanks→谢谢、保留 Nora/Amperetime 的真实中文均通过；45 秒上限不变，无生产数据/DB访问、无 Starry 翻译调用。
- 新 SDK 的只读 live tools/list：62 个工具、24 个已批准装配 schema 匹配，config 27/凭据/策略指纹不变。此结果不宣称 B 翻译 DTO 已可用。

## 安全发布与故障边界

1. 精确白名单冻结，完整 Git blob/树与沙箱回归副本一致；严格 type、contract、registry、本体真实 PG gate 和冻结统一回归通过才发布。
2. 在现有共同部署锁下确认生产仍为 d29、dirty tracked 为零、HEAD 祖先链正常；私有一致性 pg_dump + env 备份，恢复目录和 checksum 校验。
3. 停止新增 tick，有限只读排空真实在途 Execution 与 native 邮件，不 force-kill。不手动入队邮件、公海、人员或 AI。
4. 新依赖已经用 npm ci 在隔离树准备、audit=0。排空后短停四主服务；将旧 node_modules 移入私有回滚备份，已核验新依赖目录同文件系统原子移动到正式路径；不删除旧依赖或重下载影响正在运行的旧进程。
5. ff-only、正式 schema、既有 deploy（无 --sync）、五服务、精确 version/frontend release.json、新 heartbeat、79 项 ledger、已安装 full/prod audit 和原 Starry 只读兼容核验。
6. 只读等待最多 35 分钟自然三阶段回执；比对 native/Cron/Execution 完成时间与错误计数，保留真实失败及剩余，不因为依赖 audit 零声称全部邮件成功。
7. 运行启动前失败可按原 commit 正常 revert 保留历史并恢复旧依赖/服务，PG 的新增支持表保留，不自动覆盖/恢复生产业务库。自然业务失败不篡改回执或抹除部分结果，按事实诊断。

## 审宪登记

需求：A/C 邮件结构与安全升级 → 主责：后端、数据库、测试及运维 → 约束：CONST-06/08/10、PROD-AGENT-04/06/07/09、TECH-BE-03/04/06、TECH-TEST-01/02/03；不改基本法/权限 → 结论：候选符合上述边界，正式完成以冻结回归与真实生产证据为准 → 下一步：冻结、门禁、私有备份、正常快进与自然只读验收。

磁盘在只清本轮 C 中断后 8 个零连接合成测试库与未使用可重新下载 1228 浏览器二进制后恢复；1234 当前浏览器、profiles、业务库、PG 备份和并发 dist 备份全部保留。后续测试全部移至沙箱 PG18.6 localhost:55432，不再占用生产 PG 回归。
