# 员工 Agent 与知识库统一浏览

状态：verified（2026-10-13，上传截图校正后），验证结果见下方；线上发布尚未进行。

用户于 2026-10-13 确认“查找 → 预览 → 选用 → 继续工作”及知识库同款中栏列表 / 右栏详情。现行规范为 [DESIGN.md §28.4](DESIGN.md)，本文件登记实现与证据，不另设视觉取值或权限规则。

## 本次截图校正

用户指出前版与员工知识库差距很大。前版只共享尺寸与两栏骨架，筛选只有类型，详情仍按岗位介绍分区，不能据此认定视觉目标已完成。本版以用户上传的知识页截图及实际 `/kb` 为基准，抽取整套 `EmployeeBrowseFilters` 与五字段 `BrowseDetailMetadata`，两页实际调用同一组件；没有重定义原知识页匹配或执行规则。

- 中栏六个筛选行同序：业务族、业务域、知识库、适用品牌、适用阶段、类型。空分类、条件计数、阶段加减、快捷视图、36px 标题＋类型列表与加载更多保持同款结构。
- 右栏五个来源字段同序并共用标签列与分隔；正文透明阅读，次级岗位资料改为展开阅读。按截图与 DESIGN §28 将共享右栏标题、正文、页脚的横向留白归回 `space-5`，纠正原代码偏小的 `space-3`；原功能、完整示例和草稿仍保留。
- Agent 范围来自已发布技能关联的可见知识；未知适用不推断为通用，不从知识分类创建新授权。各筛选须命中同一条关联知识，计数按 Agent 去重。
- 浏览器直接比较两页的六行标签顺序、来源五字段、标签列计算样式与内容对齐、搜索、行、收藏和主操作尺寸；同时保留键盘、触摸、窄容器与短高度回归。截图为本地 HTTP 呈现夹具，不代表线上真实业务数据。

审宪：需求 → 用户截图纠正及原已确认同款目标；主责 → 平台产品经理 / UI UX / 前后端 / 测试经理；宪法 → CONST-02/04/05/06/08/09/10；基本法 → PROD-AGENT-01/09、TECH-FE-01/03、TECH-BE-01、TECH-TEST-02/03/04；结论 → **符合**，复用知识可见性与技能授权内核，保留深链和 R2/R3 边界；证据 → 共享完整组件、真实 PostgreSQL 范围投影及下方验证；下一步 → 有写入权限后提交合并与发布验收。

## 字段与功能对账

| 原字段 / 功能 | 新位置 / 行为 |
|---|---|
| 名称、类型 | 中栏单行；右栏标题、入口元信息 |
| profession / who | 右栏岗位，沿用原优先级 |
| mission、working_style | 岗位使命、岗位说明；同样原文仅一次 |
| good_at、can_finish | 擅长、可以帮你；完整已提供条目 |
| how_to_start、quick_prompts、recommended_tasks | 如何开始与全部示例；点击预填可编辑草稿 |
| intro | 按需展开的开场说明 |
| expert_version、open_count | 来源元信息 / 工作入口之后的真实待处理数，不猜零 |
| 发布人、更新时间、关联知识适用 | 与知识页同款五字段来源区，缺记录明确未登记 |
| 业务族 / 域 / 库、品牌、阶段 | 共用员工知识筛选组件；上级清下级，去重条件计数 |
| 开始工作 | 唯一主操作，创建当前已授权 Agent 的绑定会话 |
| 今日任务、我的待办 | 详情底部工作链接 |
| 采集表单、模式、作业与候选确认 | 原 `/agents/crawler` 控制台嵌入右栏，业务操作保留 |
| 审批队列、风险说明 | 原 `/agents/approver` 控制台嵌入右栏，审批执行保留 |
| 新增搜索、收藏、最近查看 | 目录与同源筛选计数；偏好按用户持久保存 |
| 已发布技能与知识范围 | 服务端资格过滤后的技能名称 / 摘要与查询技能资料投影 |
| 继续已有工作、返回原任务 | 恢复既有会话；不发消息，不改变原 Agent 绑定 |

## 接口与恢复

- `GET /api/experts/browse`：当前合格 Agent 的发布来源、关联已发布知识范围和与知识页同源分类主数据；技能装配与使用资格在异步读后再次核对。
- `GET /api/experts/preferences`：仅返回当前账号当前有使用资格的 Agent 偏好。
- `PATCH /api/experts/:id/preference`：显式布尔收藏 / 服务端查看时间；不创建任务或调用模型。
- `GET /api/experts/:id/workspace`：已发布技能、经知识查询技能解析的个人可见资料范围、当前账号可恢复的原 Agent 会话。来源会话可优先匹配；无可访问资料明确为空。
- `POST /api/experts/:id/resume`：读取并复核原会话，不创建会话；拒绝撤权、异主、异 Agent、已归档 / 停用的会话。
- 新数据通过原生 PostgreSQL pool 和版本化 `038_employee_agent_preferences.sql`，由既有迁移脚本登记；不在请求中创建表，不引入 SQLite 回退。
- 目录查询参数保存 `q / family / domain / base / brand / stage / kind / view / agent / from_session`；草稿、展开条数、滚动和焦点按当前账号隔离。示例与浏览只产生个人偏好，不产生业务副作用。
- 启动失败保留输入和真实错误；删除原先 404 后创建未绑定会话的回退。模型、harness、权限与确认执行链沿用既有实现。

## 适用验证

浏览器使用 HTTP 夹具，验证实际 DOM、布局、状态、导航与请求次数；原生 PostgreSQL 套件使用独立临时库验证偏好隔离、资格撤销、已发布能力及恢复归属。两者都不证明生产 Codex 或远程业务 IO 已执行。

| 检查 | 结果 |
|---|---|
| `frontend: npm run build`（含类型检查） | 通过；既有大型 chunk 提示保留 |
| `backend: npm run typecheck` | 通过 |
| `node backend/scripts/check-design-tokens.mjs` | 通过；144 项登记一致，23 项既有待落地项如实保留 |
| 员工 Agent 浏览器呈现 / 交互 | 12 项通过；完整筛选层级与知识详情对齐、条件计数及分类恢复、范围读取失败恢复、知识库同款几何、完整能力与示例、搜索 / 计数、收藏及失败恢复、草稿恢复、单次启动、原会话继续、来源任务返回、两类控制台深链、窄容器 / 短高度 / 键盘 |
| 共享知识浏览呈现回归 | 14 项通过 |
| 原生 PostgreSQL Agent 路由与权限 | 15 项通过；新增基于实际知识绑定 / 发布版本 / 个人可见性 / 品牌的分类投影、引用停用与资格撤销后的范围移除；新增个人偏好、同 Agent 两个合格账号隔离、撤权、本人原 Agent 会话恢复 / 异主 / 异 Agent / 归档拒绝等；保留原路由与 harness 契约 |
| Agent 与知识库条件计数单测 | 7 项通过；Agent 4 项覆盖重复引用去重、同引用交集、品牌 / 阶段并集、未知适用及快捷视图条件计数，知识库 3 项保持原口径 |
| `git diff --check` | 通过 |

浏览器命令：`npx playwright test --config playwright.presentation.config.ts employee-agent-presentation.spec.ts knowledge-browse-presentation.spec.ts --workers=1`，使用本环境可用的 Chromium Shell 并加载中文字体。原生 PostgreSQL 命令：`vitest run tests/agent-routing.test.ts --pool=threads --maxWorkers=1 --minWorkers=1`，使用独立临时 PostgreSQL 18 集群和生产迁移生成模板。

原有文档调用测试没有合法分类或已发布资料，违反当前数据库与执行契约；修订为合法分类 / 空发布资料的拒绝边界，断言查询未发生。没有关闭发布或分类闸门来让夹具通过。未执行生产发信、采集、审批、部署或完整发布门禁；以上证据不将模拟 harness 描述为生产业务完成。

相关实施资产：`frontend/src/agents`、共享知识浏览组件、`pages/Agents.tsx` / `AgentCrawler.tsx` / `AgentApprover.tsx`、来源会话导航与输入保留；`backend/src/agents/employee-workspace.ts` / `employee-browse.ts`、专家路由、迁移脚本；共享接口与对应功能域测试。

远端状态：GitHub 集成创建分支曾返回 HTTP 403（Resource not accessible by integration），没有推送或部署。已确认授权继续有效，但当前连接未提供仓库写入能力；本地补丁包含完整实现，可审查与应用。
