# P1 接续核验与确定拒绝状态修正（2026-10-05）

## CONST-08 审查

需求 → 主责角色 → 宪法条款 → 基本法条款 → 结论与证据 → 下一步：

让确定未派发的采集拒绝与高风险执行作业终态一致 → 后端专家、测试经理、项目经理（本聊天承担这些职责，不使用子智能体） → CONST-03/05/08/10 → TECH-BE-03/04/07/08、TECH-TEST-01/02/03、PROD-AGENT-09、BIZ-10；工具风险实施细则07-mcp-data-contract → **符合**：动作执行器只在自己成功领取动作、未调用副作用dispatch且拒绝已持久保存后提供确定未派发证据；其他高风险错误和租约到期仍保留uncertain且禁止自动重放 → 实施状态传播，使用独立PostgreSQL与本机MCP协议夹具验证，再通过既定发布门禁。

## 接续时的真实状态

恢复会话页到发现工作区的页面内导航 → 前端专家、测试经理 → CONST-04/08/10 → TECH-FE-03、TECH-TEST-01/02，DESIGN状态与恢复不变量 → **符合**：只在滚动测量值变化时更新React状态，保留原导航、条件恢复与副作用契约；不重写业务规则、不新增采集 → 用已有运行时E2E验证返回、继续原任务和跨页面导航。

- 主工作区存在其他聊天的未提交文档及管理端改动，全部保留；本轮继续使用干净的原P1工作树 `codex/task-collaboration-p1-release`。
- 上轮生产核验 `a7992cf` 与流水线37216439219已成功。Linux后端1563通过/27跳过；前端24项首轮通过、1项重试后通过。
- 本轮2026-10-05 02:20 CST只读生产核验得到HEAD `230793044da5d11ab09990c5646526f7f662a682`。旧用户采集 `20261004233711_d0ba2ed4` 已记录为 `failed/runtime_crawl_timeout`，结果仍pending；后续两个用户采集 `20261005005849_9fcf2f21`、`20261005014123_06c69239` 均succeeded/ready。这里只读取本平台持久状态，不证明外部进程当前状态，不对用户任务取消、重试或启动新采集。
- 旧问题回执：`job_390d56f9374b` uncertain/execution_handler_error，对应 `action_21d2ce71-7e45-4ae7-a245-11cfc0923ef0` rejected/runtime_probe_crawl_busy。修复面向新执行，不静默改写旧回执。

## 实施边界

动作层在确认已领取的动作失败时保存rejected或uncertain。只有成功保存rejected且本执行器的dispatch标志为false，才抛出内部类型 `ExecutionNotDispatched`；该类型保留原HttpFail状态与脱敏错误契约，不暴露新的员工确认参数。

dispatcher消费该内部证据，将作业保存为failed并保留具体拒绝code；无论剩余尝试次数多少，都不自动重试。更新仍核对Worker租约所有者。仅凭错误文案、远端isError、已存在的动作状态、未取得动作claim或租约超时，均不得推导为确定未派发。原有高风险unknown处理不变。

实施资产：`runtime/execution.ts`、`runtime/action-store.ts`、`execution-jobs/failure.ts`、`dispatcher.ts`、`postgres-store.ts`、`runtime-store.ts`；隔离验证在 `crawl-process-recovery.test.ts`，通过正式Worker子进程与MCP协议执行。

## 验证与阶段状态

本机类型检查、生产契约校验通过。隔离测试首次因缺少 `lingong_template` 未运行，随后按仓库schema与reference seed建立模板库重跑。恢复/拒绝8项与既有运行时48项共56项通过，包括starting/running/uncertain占用均零远端启动、拒绝终态且重复投递不执行；远端错误即使文案为runtime_probe_crawl_busy仍uncertain；旧Worker不能改写新租约；原3项实际SIGKILL恢复验证继续通过。既有确定性评价集合16项及红线行为测试11项通过，不代表新增真实模型或外部采集验收。生产只读状态见[接续回执](evidence/task-collaboration-workbench-p1-resumed-20261005.json)。发布门禁待完成，不能声明该修复已上线。

P1保持 `in_progress`，P2–P5保持 `not_started`。剩余真实空结果、外部异常/未知回执授权演练、人工接管恢复、原生200%缩放/真实读屏/完整语义对比/流式滚动、生产登录态浏览器，以及预发创建隔离会话ECONNRESET调查。既有三次真实采集授权已全部使用，本轮不新增外部运行；隔离测试不能替代这些验收。

## 合并最新主分支后的补充核验

已合并主分支2307930，恢复/拒绝8项、运行时执行49项与动作进度4项共61项隔离后端测试通过；类型检查与生产契约通过。

主分支流水线37223260187的预发运行时E2E失败，部署步骤跳过。本机独立PostgreSQL与stub服务复现：会话页返回链接改变地址，但页面仍停在会话，恢复标记不出现；同一任务在有无crypto.randomUUID两种环境均失败。原因是重建的时间线触发滚动效果，无变化的测量仍创建新的状态对象，持续渲染阻碍路由提交。Chat的滚动状态更新增加等值判断；同一任务的页面内返回已恢复成功，完整运行时E2E26项全部首轮通过（1.7分钟），包含条件恢复、键盘焦点、触摸及确认回执。该验证没有调用真实采集或外部写入。启动时日志仍出现一次PostgreSQL40001并发更新错误，未使测试失败，不能据此声明并发错误已修复。

部署主机的data/kol目录缺少验证所需的真实画像源文件，validate:kol-data失败；本机各工作树与预发也未找到。已向用户询问真实来源或明确废止决定，不补造数据、不绕过校验。修复仍在分支，发布与P1闭环均待完成。
