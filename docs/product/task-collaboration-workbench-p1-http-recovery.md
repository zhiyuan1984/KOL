# P1 接续：HTTP 失败与恢复证据

需求 → 主责角色 → 宪法条款 → 基本法条款 → 结论与证据 → 下一步：

修复发布门禁中HTML网关错误被当作JSON解析的波动 → 前端专家、测试经理 → CONST-04/08/10 → TECH-FE-02/03、TECH-TEST-01/02/03，PROD-AGENT-09、DESIGN §8.7 → **符合**：homeBoard绕过共用request解析器，502 HTML产生SyntaxError；其他跟进查询将同一响应转换为含HTTP状态的错误。统一使用现有解析器，保留缓存刷新、响应类型和业务权限；失败不得作为空数据返回 → 先复现502 HTML和403 JSON错误，再核验修复与现有失败恢复E2E。

本轮不新增外部采集。隔离响应与UI验证不替代真实空结果、外部异常/未知回执、人工接管、原生缩放或真实读屏验收。P1仍in_progress。

生产只读核验发现业务工单区域在已登录员工会话下返回workbench_authentication_required → 后端专家、测试经理 → CONST-04/05/08/10 → TECH-BE-01、TECH-TEST-01/02/03 → **符合**：app.ts的formalAuthorityPath遗漏/api/task-work-orders，而该路由要求requireTicketPrincipal；补入既有主体桥接，保持当前会话身份、对象范围与提交闸门，不新增身份或权限 → 在完整app入口复现并验证已登录员工可读取自己的任务、其他员工不泄漏及注销后拒绝。

生产浏览器读取已恢复：1ff5d98的AI发现入口可达，1280×600视口下document scrollWidth=1280，编辑完整请求与发送控件位于视口内。导航至任务中心成功；上述主体桥接缺口已截图记录，不宣称业务任务重开验收通过。临时视口已恢复；未提交发现请求或新增外部采集。原生200%缩放、真实读屏与完整对比度仍待验收。

主体桥接回归在完整createApp入口复现401；补齐路径后，登录员工创建、dashboard、详情通过，其他员工dashboard不含该任务且详情404，未登录和注销cookie返回401。完整enterprise-auth十五项通过（72.56s），后端typecheck通过。测试只使用本机55439独立PostgreSQL模板克隆库，无生产写入；完整CI与生产修复后只读复核尚待完成。

通过HTTP SSE核验客户端滚动 → 前端专家、测试经理 → CONST-04/08/10 → TECH-FE-03、TECH-TEST-02/03，DESIGN §10.2/13 → **符合**：本机HTTP服务器发送受控upsert，浏览器使用原生EventSource与现有消息处理器更新React；检查浅色/深色下底部跟随、用户上滚停止跟随、同ID更新不重复和主动返回底部后继续跟随。仅受控事件，不创建真实模型运行或调用外部采集 → 关闭重试执行客户端回归，记录运输层与业务验收边界。

复现：502 HTML产生SyntaxError、403 JSON被当作成功返回；修复后三个API定向测试通过，前端类型检查与构建通过。Linux预发236882c的原失败恢复三个场景重复三轮，9/9通过、retries=0；996b998的浅色/深色HTTP SSE场景各两轮4/4通过、retries=0，复用236882c同应用构建。发布前端集合新增presentation九项，CI与npm命令保持一致；不取消已有门禁。完整发布门禁与生产核验待完成。

剩余真实空结果验收的待授权范围：仅一次YouTube search，关键词tcw-p1-empty-20261005-d0f3ad1，max_notes_count=1，enable_comments=false，enable_sub_comments=false；现有真实harness提出动作并通过既有确认/持久执行链提交，随后仅读取该task_id的状态与结果。使用独立验收数据库和同一排他连接器，不导入、不发信、不改阶段、不重启外部服务；返回候选则如实记录，不能伪造空结果或追加采集。超时/未知状态保留，不盲重放。此前三次真实采集授权已用完，本范围尚未授权，未执行。

发布复核已完成：[CI 37255044842](https://github.com/zhiyuan1984/KOL/actions/runs/37255044842) 对bd1cb1c完整通过并自动部署；后端1589通过、27跳过，前端30+26全部首次通过。先前两轮门禁被更新版本取代，不作为通过证据。10:42:52生产核验git/API版本一致，44个资源哈希一致、HTML一致、API/两执行Worker/Outbox均active。生产浏览器同一员工的工单区域恢复显示0个业务任务、无登录错误；未创建生产工单。390×600无横向溢出，键盘移入底部工具栏后提交区可见；这是指针/键盘证据，不能代替触摸44px命中区验证。详见[脱敏证据](evidence/task-collaboration-workbench-p1-http-release-20261005.json)。P1保持in_progress，P2–P5不因工程发布而推进。
