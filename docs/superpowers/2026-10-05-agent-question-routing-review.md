# 员工智能体目录与问题归属路由审查

日期：2026-10-05。本文为实施与验证记录，不新增或修改产品规则。

## 审宪与审法

需求 → 管理侧发布并授权的产品专家出现在员工目录；AI 提问按智能体职责及已装配技能选定回答者，并沿同一身份访问技能绑定知识库。

主责角色 → 平台产品经理、智能体产品经理；实现由后端与前端职责负责；测试经理负责验证边界。

宪法条款 → [CONST-02/03/05/07/08/10](../CONSTITUTION.md)：Agent 是使用资格锚点；知识库只经技能调用；复用统一 harness；使用资格与正式副作用闸门独立；交付证据区分模拟与真实执行。

基本法条款 → [PROD-PLAT-04/05、PROD-AGENT-01/03](../PRODUCT.md)、[TECH-ARCH-02/04、TECH-FE-01/03、TECH-BE-01/07/08、TECH-TEST-01/02/03](../TECHNOLOGY.md)。界面复用 [DESIGN.md](../DESIGN.md) 的既有样式；知识查询保持 [工具风险目录](../07-mcp-data-contract.md) 的 L1 只读契约。

结论 → **符合**。候选在发送给模型前按当前 Agent 使用资格、发布状态、技能装配与技能发布状态过滤；模型仅选择目录中的组合；提交与每次工具执行再次复核授权。

证据 → 原员工目录读取静态专家，前端仅遍历固定岗位；现接入管理侧发布的可用 Agent，保留已有专家入口的呈现。Jev、Luna、Codex 共用请求隔离的 Agent/技能候选目录；选择结果进入任务输入、排队请求、Worker、知识检索及来源引用。明确智能体会话与已保存任务从服务端恢复绑定，拒绝浏览器替换身份。

下一步 → 完成定向验证后交付代码；线上发布与真实产品资料检索须在实际部署环境核验。

## 实施资产

- 后端：`backend/src/tasks/agent-routing.ts`、`tasks/openai-intent.ts`、`tasks/recognize.ts`；`runtime/employee-agents.ts`；`routers/experts.ts`、`routers/tasks.ts`；`host/api.ts`、`worker/runner.ts`。
- 前端：`frontend/src/experts.ts`、`pages/Agents.tsx`、`pages/AgentKol.tsx`、`components/ChatBlocks.tsx`。
- 验证：`backend/tests/agent-routing.test.ts`、`experts.test.ts`、`task-recognize.test.ts`、`openai-intent.test.ts`、`admin-agents.test.ts`、`tasks-runtime.test.ts`；`frontend/e2e/agent-routing.spec.ts`。

## 验证范围与限制

使用独立的本地 PostgreSQL 集群及每用例克隆库，不读取或修改生产数据库。

数据库集成验证覆盖目录可见、使用撤权、停用与技能未发布、多 Agent 共用技能的归属选择、未知组合拒绝、低置信度澄清、任务排队身份保持及知识工具再授权。分类模型传输、Worker 运行和文档检索引擎使用明确的测试替身，验证契约及身份传递，不据此宣称已完成线上真实产品知识回答。

浏览器端到端验证覆盖管理侧创建、装配、绑定、发布后在员工目录出现，详情及召唤保留管理侧 Agent ID，空目录不补出静态占位专家。

保留既有未认证 stub 单元夹具，仅在测试运行时、stub 模式且没有指定身份时适用；真实运行与有身份的测试均校验完整 Agent/技能组合。该分支不产生真实 harness 或外部工具调用。

未实施线上部署；尚无线上“产品专家 → 产品咨询 → 产品知识库”的真实 harness 与检索回执。知识库有绑定也不等于每次回答已经检索，需以工具调用和文档页码引用判断。

## 验证结果

- 新增 Agent 路由与知识工具集成测试：8/8 通过；故意让 Worker 抛错的用例同时检查身份传递和任务失败收口，不伪造成功回答。
- Chromium 浏览器端到端：2/2 通过（独立 PostgreSQL 测试库，管理侧真实发布接口与员工侧真实目录、详情、会话接口）。
- 前后端类型检查、前端生产构建、契约校验、差异格式检查通过。
- 既有任务运行、模型意图、任务识别与管理侧 Agent 回归通过。目录回归在本地并发验证时出现三项 30 秒超时，使用 90 秒测试及准备超时单独复验，三项全部通过（共 74.73 秒）；详情读取已收窄为当前 Agent 的校验，避免重复扫描全目录。
