# Chat 与发现任务工作台统一

## 审宪与审法记录

需求：落实“评审Chat与发现页差异”的交互与视觉建议。

主责角色：UI/UX 专家决定共享骨架、内容位置、强调与三轴适配；智能体产品经理决定任务状态、回答组织与恢复契约；前端专家实现；测试经理选择回归证据。

宪法条款：CONST-04（不在页面改业务规则）、CONST-05（确认与正式副作用分开）、CONST-07（不固定回答形式）、CONST-08（审查）、CONST-09（实施细则不改上位法）、CONST-10（交付证据）。

基本法条款：PROD-AGENT-03/09；TECH-FE-01~03、TECH-BE-02/03、TECH-TEST-01~04。涉及既有邮件与阶段确认只保留原接口，遵守 BIZ-10~14 及 org-permissions 的权限与副作用条款。

结论：符合。共享外壳仅改变呈现与恢复；风险来自服务端动作，确认继续提交服务端 confirmation_version；不合并发送、导入、停止与阶段动作；不调用真实外部写入作为验证。

具体差距与证据：Chat 独立 session-shell；SideWorkbench 存在独立折叠与抽屉断点；Chat 首次打开会自动贴底；回复分析与嵌入结构化结果可能在中栏渲染完整成果；发现链接只恢复 resume 参数而未读取 session_id。首次实施基于旧基线；合并最新 main 后保留 DESIGN §24~26，将通用会话扩展登记为 §27。

下一步：前端实施与界面验证已完成；本次按用户后续授权执行合并、push 和部署，发布以实际服务回执为准。

## 实施登记

- requirement_refs：上述 CONST / PROD / BIZ / TECH 条款；DESIGN §6/10/11/14/16/26/27。
- implementation_assets：WorkspaceShell、useWorkspaceScroll、Chat、SideWorkbench、ComposerDock、RuntimeActions、DiscoveryWorkspace、DiscoveryResultPane、discoveryTaskStatus、AgentAvatar、Home 恢复入口、styles.css 与共享工作台 CSS。
- owner：UI/UX 与智能体产品角色负责契约，前端负责实现，测试负责证据。
- status：verified（前端范围完成，界面验证通过）。
- evidence：`frontend` 下 `npm run build` 通过（含 TypeScript 检查）；`npx playwright test --config=playwright.presentation.config.ts e2e/discovery-presentation.spec.ts e2e/session-workspace-presentation.spec.ts --reporter=line` 第一轮 29/29 通过；整合最新 main 后 30/30 页面回归通过，新增批量入库确认回归通过，共覆盖 31 个用例；`git diff --check` 通过。
- known_gaps：界面测试使用截获 API 的固定数据及本地 HTTP SSE，不能证明线上登录、真实 harness 与外部采集/发送集成；未运行全量发布门禁，未发布。

## 验证覆盖与修正

- 共享骨架、成果仅在右栏完整呈现、折叠后定位成果、固定输入区与窄宽/短高视口。
- 中栏与右栏分别恢复阅读位置；晚到的首次成果从顶部呈现；读到底部后跟随更新，上翻与编辑时不抢滚动；真实 HTTP SSE 同一消息原位更新。
- 确认快照更新后提交当前版本，双击只提交一次；无快照时不能确认；回执保留，启动回执不冒充采集完成。
- 同一草稿仅一处编辑和发送入口；运行时确认、成果内确认与输入框发送按共享强调规则呈现。
- `/s/:sessionId` 与 Home 的 `session_id`/`resume` 按服务端工作台类型恢复同一发现任务；恢复不创建任务或确认采集。
- 邮件来源变化与权限撤销时保留人工草稿；候选忽略/恢复在采集终态后立即刷新；明暗主题文字对比度与命名通过。
- 修正空模板字段每次返回新数组引发的重复渲染，以及底部滚动事件与 SSE 更新同时到达时的跟随竞态。

## 合并与发布审查

需求：用户于 2026-10-08 明确授权合并 main、push 与 deploy。

主责角色：前端专家负责与最新 main 整合；测试经理负责受影响回归与发布门禁证据；后端专家负责既有部署流程、健康与版本核对；项目经理登记发布结果。

宪法条款：CONST-05/08/10。基本法条款：TECH-TEST-01/03/04、TECH-BE-09。

结论：符合。先保存本次独立提交，合并最新远端 main 并验证；不修改其他工作树的未提交内容；发布固定提交并核对服务版本与健康；保留上一版构建与回滚入口。当前仅已获发布授权，发布成功以实际回执为准。

下一步：合并与验证后 push，执行既有发布流程并登记结果。

## 最新 main 整合记录

基线：`6c71dca958d1e3ff9dde84be34fb16da8ddf6742`。保留 main 的固定结果头、生命周期筛选、智能体选择、排队取消及过期草稿只读保护；完整成果改由共享右栏承载。runtime 候选复用既有快照版本与受控动作接口，不再走旧发现运行接口；批量入库只在确认后逐条取回执，部分成功保留已取得回执。

发布阻断修正：上游 release-gate #420 在空库初始化时报 `relation kol_leads does not exist`。将 `20261008_discovery_dedup_score` 与 `20261008_pool_brand_visibility` 排到线索/合作主对象建表之后；迁移 ID 与 SQL 内容不变，保持现有账本 checksum。需求 → 解除现行发布门禁的数据库初始化失败；主责 → 后端专家、测试经理；依据 → CONST-08/10、TECH-BE-09、TECH-TEST-03/04；结论 → 符合，须以真实空库门禁通过作为验证。

本地整合验证：前后端 TypeScript 检查、前端生产构建、pilot/production 契约、对象注册表、106 个设计 token 对账及 diff 空白检查通过。GitHub 发布流水线增加通用会话回归用例，与 `test:e2e:release` 同步。生产发布和空数据库验证尚待该固定提交的实际流水线回执。


## 恢复后的运行时兼容核对

需求 → 合并后保留原发现会话的排队取消、服务端进度、候选分析与独立停止确认；主责 → 前端专家与测试经理；依据 → CONST-03/04/05/08/10、PROD-AGENT-03/09、TECH-FE-02/03、TECH-TEST-01/03/04、DESIGN §26/27；结论 → 符合。恢复只投递服务端仍 pending 的原 run，失败保留重试入口；取消排队复用服务端命令；候选分析绑定当前 task/session 与持久候选快照，简报在右栏恢复；非 start 的 R3 动作继续由既有 RuntimeActions 按当前快照确认，不增加第二份轮询。旧 `/s` E2E 改为验证恢复后的任务身份、同一回执、键盘/触摸可达性与无重复新建任务；新增独立停止确认恢复用例。

证据 → 更新后的 TypeScript 与生产构建通过；31/31 页面回归通过。下一步 → push 固定修正提交并运行预发运行时回归，通过发布门禁后核对生产实际版本与健康。


预发几何核对 → 390px × 700px 触摸视口，中栏实际可滚动高度约 112px，旧固定 Composer 的 80px scroll-padding 仍生效，导致 Chromium 定位 44px 按钮后上沿被裁剪。Composer 已独立占一行，取消旧覆盖补偿，滚动留白复用 `--space-2` / `--space-4`。依据 → CONST-08/10、TECH-FE-02/03、DESIGN §10/11/27；结论 → 符合，保留真实触摸命中断言验证修正。运行时用例按既有 `ses_discovery_` 直达 session_id 和普通会话按服务端任务恢复 resume 两条入口核对；候选分析固定数据同时拦截 session 同步读取与 SSE，避免真实初始空快照覆盖测试报告。


触摸命中续核 → 修正留白后，390px 视口地区选项的边缘仍被悬浮滚动按钮命中区覆盖。共享滚动容器为跳转控件预留旁侧空间，按指针模态分别取 `--workspace-arrow-button-size` / `--touch-hit-min` 与既有间距 token；不缩小触摸命中区，也不放宽实际 elementFromPoint 检查。最新 main 同期候选证据修正已完整合入（`e7d61338`），保持后端事实来源与权限修正。
