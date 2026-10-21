# 达人库查询上下文修复

任务：creator-query-context-20261020。基线：Codeup main cd12dd8。

修复已选技能不可用时被重新识别、澄清原因丢失，以及今日计划混入查询中栏和结果栏的问题。原页面及会话路由、业务权限和风险闸门保持。

验证：前后端类型检查、前端构建、后端 10 项契约测试、Chromium 6 项 HTTP 夹具测试（含四种宽高）通过；契约和登记校验通过。构建只有既有 chunk 大小提示。

用户在查看所展示的具体修复与截图后，明确指示“合并main分支，push，部署”。该发布接受记录于 user-release-approval.json，替代此前待用户复核的状态；不等同于独立 UX 专家全面验收。截图使用本地夹具，不能证明线上授权配置或真实达人查询成功；真实 PG/MCP 端到端验收仍单独记录。部署结果另附回执。

- [受阻状态](query-blocked.png)
- [窄屏状态](query-375.png)
- [源代码与审宪记录](source-review.json)
- [浏览器测试](browser-tests.json)
- [后端测试](backend-tests.json)
