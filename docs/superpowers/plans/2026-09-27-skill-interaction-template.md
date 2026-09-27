# 技能与知识库交互模板同源实现

## 审查记录

需求 → 模板为员工描述功能、步骤和输入，SKILL.md 为 Codex 描述选择条件、工具、执行和输出，两者一对一且语义同源。

主责角色 → 智能体产品经理（入口契约）、架构师（单一发布源）、前后端专家（实施）、测试经理（定向验证）。

宪法条款 → CONST-02 / 03 / 06 / 07 / 08 / 10。基本法 → PROD-PLAT-04、PROD-AGENT-01 / 03 / 08 / 09、TECH-ARCH-03 / 04、TECH-FE-01 / 03、TECH-BE-01 / 07 / 08、TECH-TEST-01 / 03 / 04。

结论 → **符合**。不修改业务授权、阶段、审批或工具风险；模板使用仅产生未提交草稿；实际执行继续使用既有 Codex harness 与 Skill Runtime。复用现有紧凑工作台 token，不重设计导航。

## 契约与实施

- 一个技能对应一个稳定 `skill-template:<skill_id>`，由知识库模块提供只读投影；不再独立维护另一份可漂移的参数表。
- SKILL.md 的 `interaction` 声明功能、预计步骤、输出标题与边界；`input_schema` 为前后端共用参数源；`required_inputs` 必须与 schema 的必填项一致。
- 交互模板不等于邮件正文模板。邮件模板仍通过原知识库发布、引用与版本流程管理；新增投影不调用邮件模板的引用/编辑接口。
- `GET /api/knowledge/skill-templates` 仅返回员工可见且已获技能授权的模板；详情接口重新校验授权。员工 DTO 不含执行正文、文件路径或工具清单。
- 任务创建时存服务端模板快照，忽略客户端伪造的 `_skill_template`。任务详情通过 `skill_template` 恢复原说明；旧任务在首次运行时记录当前快照。
- 模板版本覆盖技能文件和生效 SOP 覆盖内容。创建、启动运行和排队转会话三个边界拒绝旧版本，防止展示一套说明却执行另一套。版本冲突需重新选用模板、核对参数后创建任务。
- Codex 的运行上下文增加共享输入 schema 与模板 ID/版本；即使存在 SOP 覆盖，也注入已登记的交互/执行契约及现有运行工具约束。
- 结构化输入的优先级是显式有效值 > 抽取实体 > schema 默认值。空字段和未填写占位符不被当成真实数据。分页字段必须为正整数，沿用现有每页上限。

### 达人库查询

已补全 `backend/skills/creator_library_query/SKILL.md`：触发条件、可选参数、执行步骤、真实空结果与失败区分、输出及只读边界。

**无必填参数**。关键词、合作阶段、风险标签均可选；默认第一页，每页 20 条，最多 50 条。仅提问标题也可提交，不能被前端硬编码的 `[关键词]` 阻塞。

### 兼容与真实边界

- 旧技能从已有 schema / required_inputs 投影，未登记 `interaction.steps` 的技能显示“步骤未登记”，不编造步骤；本次没有逐项重写全部历史技能的业务文案。
- 模板 ID、字段和版本一致可由程序保证；自由文本语义仍需在技能发布时审查，不能宣称哈希校验能够证明全部语义正确。
- 不新增授权、连接器或后台服务，不执行真实发信、导入、改阶段、解密操作。
- 本次只运行受影响用例与类型检查；单元/协议夹具通过不代表真实线上 Codex 与远端达人库性能已验收。

## 验证记录

后端已通过：

- `npm test -- tests/skill-interaction-template.test.ts`：21 项。
- `npm test -- tests/tasks-runtime.test.ts -t 'manifest task registry|task intent resolution|creates, runs, records|keeps tasks with missing'`：15 项，未选中的 8 项跳过。
- `npm test -- tests/skill-runtime-execution.test.ts -t 'wires the actual Worker'`：1 项，使用本地 fake-Codex 协议进程，不是线上 LLM 验收。
- `npm run typecheck`：通过。

前端定向运行 `skillTemplate.test.ts`、`skillTemplateTask.test.ts`、`composer/skillFill.test.ts`、`components/SkillTemplateContext.test.ts`：18 项通过；`npm run typecheck` 通过。前后端共 55 项受影响用例通过，没有运行全量测试、浏览器端到端测试或真实线上 MCP 调用。

前端实施包括：知识库的只读模板分组（折叠、检索、预览、失败重试、用于提问）；首页与任务中栏共享功能/预计步骤说明；必填参数直显、可选条件折叠；已触碰的有效值才作为显式参数提交，未修改的默认值由服务端兜底。提问框只填短标题与待补必填项，已有正文不覆盖。

任务页显式选择模板或编辑参数后提交，会创建有快照和版本校验的绑定任务，再提交带 run_id 的会话消息，不再绕过任务参数/版本检查。普通自由追问保持原会话路径，不因头部展示了某个模板而强制变成一次新的查询。邮件/发现专用交互保留既有链路。

模板快照恢复与组件静态渲染有定向测试；没有把这些结果描述为浏览器实测或生产部署完成。右栏继续使用既有真实结果组件，本次不伪造结果或修改远端数据。
