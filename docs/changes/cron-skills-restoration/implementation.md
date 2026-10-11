# 定时任务与技能交互定向恢复交接

## 目标与边界

以生产及 GitHub main `2893c916afd998ef4894b0aea47e368af97451fc` 为基线。仅恢复已证实丢失的新版定时工作台、员工技能两维筛选与管理技能未保存保护；不整仓回滚，不恢复未证实丢失的 Agent 页面。

- 原 PR214 的三个 Cron 提交已在独立分支重放；唯一 Cron 页面冲突保留新版表格/抽屉，与当前共享搜索组件兼容。
- 员工技能：`mode` 与 `stage` 独立组合；兼容旧 `tab` 地址；浏览器返回恢复组合；保留真实 funnel、内部技能不可直接用和“仅填入提问框”。
- 管理技能：分段 dirty、保存失败不清空、保存成功只释放已提交版本；选项切换、关闭、侧栏/历史导航与刷新提示。保留现行发布检查、审批及 Agent/技能权限。
- 两类 Agent、当前邮件、个人设置、本体等文件保留基线；新增源码标志检查只确认恢复/保留契约存在，不代替 E2E、数据库与权限测试。

## 验证方式

1. 在 `~/kol-restore-0eFKM861` 独立工作树执行双端 typecheck、Cron 14 项单元与前端候选构建。
2. `python3 run-restoration-pg.py`：凭据在服务器原位加载，CREATE 本次独立测试库；所有测试写入仅在新库，结束清理。设置独立 TMPDIR，避免共享临时缓存 EDQUOT。
3. `node frontend/e2e/check-restoration-contracts.mjs`（从 frontend 执行：`node e2e/check-restoration-contracts.mjs`）。
4. `TMPDIR=<独立目录> PW_EXECUTABLE_PATH=/opt/google/chrome/chrome npx playwright test --config playwright.restoration.config.ts --reporter=line`：只服务候选 dist，所有 API 本地夹具；未拦截 API 一律 503，不代理生产。

### 已定位的基线失败

`tests/discovery-search-cron.test.ts` 的 `dedup 缺省为 platform_creator_id` 严格断言未包含现行 `window_days: 30`。生产基线及恢复分支的 contracts/test 文件 hash 完全一致，在生产基线也复现；本次不修改去重业务或掩盖该失败。其余相关 PG 与公开投影用例另列实际结果。

## 唯一发布人

邮件任务 BZ3EiEmP4d6YeBfGYdMlp6 已确认负责唯一生产收尾。本任务不执行生产 schema、systemd、代码/产物替换。恢复分支冻结、通过门禁、推送后交接完整 hash；发布人真合并邮件分支与恢复分支，重新联合验证再合入 main 与发布。

已知邮件分支：`feat/mail-redesign-labels-20261012`，`b24cd81911cdb99ec04c988a40e51dbebcb32095`，PR232。本任务不得用旧整仓 reset 覆盖邮件改版。
